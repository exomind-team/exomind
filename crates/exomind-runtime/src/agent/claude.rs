use super::{Agent, ChatChunk, ChatRequest};
use futures_util::stream::{self, BoxStream, StreamExt};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;

/// Session status（会话状态）.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionStatus {
    Idle,
    Processing,
    Crashed,
}

/// Claude process session（Claude 子进程会话）.
#[derive(Debug)]
struct ClaudeSession {
    session_id: String,
    claude_session_id: Option<String>,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    status: SessionStatus,
    created_at: Instant,
    message_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionAction {
    CreateNew,
    Reuse { session_id: String },
    Missing { session_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ClaudeStreamEvent {
    System { claude_session_id: Option<String> },
    AssistantChunk { content: String },
    Result,
}

type SharedClaudeSession = Arc<Mutex<ClaudeSession>>;

/// Built-in Claude agent (内置 Claude Agent，通过 Claude CLI 输出流式文本).
#[derive(Debug, Clone)]
pub struct ClaudeAgent {
    command: String,
    sessions: Arc<Mutex<HashMap<String, SharedClaudeSession>>>,
}

impl ClaudeAgent {
    pub fn new() -> Self {
        Self {
            command: "claude".to_string(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn spawn_streaming_task(&self, request: ChatRequest) -> mpsc::Receiver<ChatChunk> {
        let (sender, receiver) = mpsc::channel(64);
        let agent = self.clone();

        tokio::spawn(async move {
            agent.handle_chat_request(request, sender).await;
        });

        receiver
    }

    async fn handle_chat_request(&self, request: ChatRequest, sender: mpsc::Sender<ChatChunk>) {
        let normalized_session_id = normalize_session_id(request.session_id.as_deref());
        let existing_session = if let Some(session_id) = normalized_session_id.as_deref() {
            self.find_session(session_id).await
        } else {
            None
        };

        let action = decide_session_action(normalized_session_id.as_deref(), existing_session.is_some());

        let (session_id, session_handle, needs_session_chunk) = match action {
            SessionAction::CreateNew => match self.create_session().await {
                Ok(created) => (created.0, created.1, true),
                Err(error_message) => {
                    emit_error_chunk(&sender, error_message).await;
                    return;
                }
            },
            SessionAction::Reuse { session_id } => {
                let Some(handle) = existing_session else {
                    emit_error_chunk(&sender, format!("Claude 会话不存在: {session_id}")).await;
                    return;
                };
                (session_id, handle, false)
            }
            SessionAction::Missing { session_id } => {
                emit_error_chunk(&sender, format!("Claude 会话不存在: {session_id}")).await;
                return;
            }
        };

        self.process_turn(
            session_id,
            session_handle,
            request.message,
            needs_session_chunk,
            sender,
        )
        .await;
    }

    async fn find_session(&self, session_id: &str) -> Option<SharedClaudeSession> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    async fn create_session(&self) -> Result<(String, SharedClaudeSession), String> {
        let session_id = Uuid::new_v4().to_string();
        let mut child = Command::new(&self.command)
            .args(build_claude_persistent_args())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Claude 启动失败: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Claude stdin 不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Claude stdout 不可用".to_string())?;

        let session = ClaudeSession {
            session_id: session_id.clone(),
            claude_session_id: None,
            child,
            stdin,
            stdout: BufReader::new(stdout),
            status: SessionStatus::Idle,
            created_at: Instant::now(),
            message_count: 0,
        };

        let shared_session = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), shared_session.clone());
        Ok((session_id, shared_session))
    }

    async fn process_turn(
        &self,
        session_id: String,
        session_handle: SharedClaudeSession,
        message: String,
        needs_session_chunk: bool,
        sender: mpsc::Sender<ChatChunk>,
    ) {
        let mut session = session_handle.lock().await;

        if let Err(error_message) = ensure_session_ready_for_turn(&mut session) {
            session.status = SessionStatus::Crashed;
            emit_error_chunk(&sender, error_message).await;
            return;
        }

        session.status = SessionStatus::Processing;
        session.message_count += 1;

        let input_line = build_stream_json_user_input(&message);
        if let Err(error) = write_user_input_line(&mut session.stdin, &input_line).await {
            session.status = SessionStatus::Crashed;
            emit_error_chunk(&sender, format!("Claude 输入写入失败: {error}")).await;
            return;
        }

        let mut pending_session_chunk = needs_session_chunk;
        loop {
            match read_next_stream_event(&mut session.stdout).await {
                Ok(Some(ClaudeStreamEvent::System { claude_session_id })) => {
                    if let Some(value) = claude_session_id {
                        session.claude_session_id = Some(value);
                    }
                }
                Ok(Some(ClaudeStreamEvent::AssistantChunk { content })) => {
                    let chunk = ChatChunk {
                        content,
                        session_id: if pending_session_chunk {
                            pending_session_chunk = false;
                            Some(session_id.clone())
                        } else {
                            None
                        },
                    };

                    if sender.send(chunk).await.is_err() {
                        session.status = SessionStatus::Idle;
                        return;
                    }
                }
                Ok(Some(ClaudeStreamEvent::Result)) => {
                    if pending_session_chunk {
                        let _ = sender
                            .send(ChatChunk {
                                content: String::new(),
                                session_id: Some(session_id.clone()),
                            })
                            .await;
                    }
                    session.status = SessionStatus::Idle;
                    return;
                }
                Ok(None) => {
                    session.status = SessionStatus::Crashed;
                    let message = build_session_ended_error_message(&mut session);
                    emit_error_chunk(&sender, message).await;
                    return;
                }
                Err(error) => {
                    session.status = SessionStatus::Crashed;
                    emit_error_chunk(&sender, format!("Claude 输出读取失败: {error}")).await;
                    return;
                }
            }
        }
    }
}

impl Default for ClaudeAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for ClaudeAgent {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn name(&self) -> &'static str {
        "Claude Agent"
    }

    fn description(&self) -> &'static str {
        "通过 Claude Code CLI 提供流式对话"
    }

    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        let receiver = self.spawn_streaming_task(request);
        stream::unfold(receiver, |mut receiver| async move {
            receiver.recv().await.map(|chunk| (chunk, receiver))
        })
        .boxed()
    }
}

fn normalize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn decide_session_action(session_id: Option<&str>, has_existing_session: bool) -> SessionAction {
    match session_id {
        Some(value) if has_existing_session => SessionAction::Reuse {
            session_id: value.to_string(),
        },
        Some(value) => SessionAction::Missing {
            session_id: value.to_string(),
        },
        None => SessionAction::CreateNew,
    }
}

fn ensure_session_ready_for_turn(session: &mut ClaudeSession) -> Result<(), String> {
    match session.status {
        SessionStatus::Idle => {}
        SessionStatus::Processing => return Err("Claude 会话正在处理中，请稍后重试".to_string()),
        SessionStatus::Crashed => return Err("Claude 会话已崩溃，请新建会话".to_string()),
    }

    match session.child.try_wait() {
        Ok(Some(status)) => Err(build_exit_status_error_message(status.code())),
        Ok(None) => Ok(()),
        Err(error) => Err(format!("Claude 进程状态检查失败: {error}")),
    }
}

async fn write_user_input_line(stdin: &mut ChildStdin, line: &str) -> std::io::Result<()> {
    stdin.write_all(line.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await
}

async fn read_next_stream_event(
    stdout: &mut BufReader<ChildStdout>,
) -> std::io::Result<Option<ClaudeStreamEvent>> {
    loop {
        let mut line = String::new();
        let read_bytes = stdout.read_line(&mut line).await?;
        if read_bytes == 0 {
            return Ok(None);
        }

        let normalized_line = line.trim();
        if normalized_line.is_empty() {
            continue;
        }

        if let Some(event) = parse_stream_event_line(normalized_line) {
            return Ok(Some(event));
        }
    }
}

async fn emit_error_chunk(sender: &mpsc::Sender<ChatChunk>, message: String) {
    let _ = sender.send(ChatChunk::content_only(message)).await;
}

fn build_claude_persistent_args() -> Vec<String> {
    vec![
        "-p".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
    ]
}

fn build_stream_json_user_input(message: &str) -> String {
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": message
        }
    })
    .to_string()
}

fn build_session_ended_error_message(session: &mut ClaudeSession) -> String {
    let uptime_seconds = session.created_at.elapsed().as_secs();
    match session.child.try_wait() {
        Ok(Some(status)) => build_exit_status_error_message(status.code()),
        Ok(None) => format!(
            "Claude 输出流提前结束，会话已中断: {}（运行 {} 秒）",
            session.session_id, uptime_seconds
        ),
        Err(error) => format!("Claude 进程状态检查失败: {error}"),
    }
}

fn build_exit_status_error_message(code: Option<i32>) -> String {
    match code {
        Some(value) => format!("Claude 进程异常退出，退出码: {value}"),
        None => "Claude 进程异常退出，退出码未知".to_string(),
    }
}

fn parse_stream_event_line(line: &str) -> Option<ClaudeStreamEvent> {
    let event: Value = serde_json::from_str(line).ok()?;
    let event_type = event.get("type").and_then(Value::as_str)?;

    match event_type {
        "text" | "assistant" => {
            let content = extract_text_content(&event)?;
            Some(ClaudeStreamEvent::AssistantChunk { content })
        }
        "system" => Some(ClaudeStreamEvent::System {
            claude_session_id: extract_claude_session_id(&event),
        }),
        "result" => Some(ClaudeStreamEvent::Result),
        _ => None,
    }
}

#[cfg(test)]
fn parse_stream_json_line(line: &str) -> Option<ChatChunk> {
    match parse_stream_event_line(line)? {
        ClaudeStreamEvent::AssistantChunk { content } => Some(ChatChunk::content_only(content)),
        _ => None,
    }
}

fn extract_claude_session_id(event: &Value) -> Option<String> {
    event
        .get("session_id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            event
                .get("session")
                .and_then(|session| session.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn extract_text_content(event: &Value) -> Option<String> {
    if let Some(text) = event.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    if let Some(content) = event.get("content").and_then(Value::as_str) {
        return Some(content.to_string());
    }

    let message = event.get("message")?;

    if let Some(text) = message.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    let content = message.get("content")?;

    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    if let Some(items) = content.as_array() {
        let merged = items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<String>();

        if !merged.is_empty() {
            return Some(merged);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect_chunks_from_mock_stdout(mock_stdout: &str) -> Vec<ChatChunk> {
        mock_stdout
            .lines()
            .filter_map(parse_stream_json_line)
            .collect()
    }

    #[test]
    fn build_exit_status_error_message_with_code() {
        assert_eq!(
            build_exit_status_error_message(Some(7)),
            "Claude 进程异常退出，退出码: 7".to_string()
        );
    }

    #[test]
    fn build_exit_status_error_message_without_code() {
        assert_eq!(
            build_exit_status_error_message(None),
            "Claude 进程异常退出，退出码未知".to_string()
        );
    }

    #[test]
    fn parse_stream_json_line_accepts_text_event() {
        let line = r#"{"type":"text","text":"你好"}"#;
        let chunk = parse_stream_json_line(line);
        assert_eq!(chunk, Some(ChatChunk::content_only("你好")));
    }

    #[test]
    fn parse_stream_json_line_accepts_assistant_event() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"有"},{"type":"text","text":"什么"}]}}"#;
        let chunk = parse_stream_json_line(line);
        assert_eq!(chunk, Some(ChatChunk::content_only("有什么")));
    }

    #[test]
    fn parse_stream_json_line_rejects_non_text_types() {
        let line = r#"{"type":"tool_use","text":"ignore"}"#;
        assert_eq!(parse_stream_json_line(line), None);
    }

    #[test]
    fn parse_stream_json_line_rejects_invalid_json() {
        let line = r#"{"type":"text","text":"hello""#;
        assert_eq!(parse_stream_json_line(line), None);
    }

    #[test]
    fn collect_chunks_from_mock_stdout_only_forwards_textual_events() {
        let mock_stdout = r#"{"type":"system","text":"Initializing..."}
{"type":"text","text":"你好"}
{"type":"thinking","text":"hidden"}
{"type":"assistant","message":{"content":[{"type":"text","text":"！"}]}}
{"type":"result","usage":{"input_tokens":10,"output_tokens":15}}"#;

        let chunks = collect_chunks_from_mock_stdout(mock_stdout);
        assert_eq!(
            chunks,
            vec![ChatChunk::content_only("你好"), ChatChunk::content_only("！")]
        );
    }

    #[test]
    fn build_claude_persistent_args_uses_stream_json_input_and_output() {
        let args = build_claude_persistent_args();
        assert_eq!(
            args,
            vec![
                "-p".to_string(),
                "--input-format".to_string(),
                "stream-json".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn build_stream_json_user_input_returns_json_line_payload() {
        let line = build_stream_json_user_input("你好，我叫小明");
        assert_eq!(
            line,
            r#"{"message":{"content":"你好，我叫小明","role":"user"},"type":"user"}"#.to_string()
        );
    }

    #[test]
    fn parse_stream_event_line_extracts_system_session_id() {
        let event =
            parse_stream_event_line(r#"{"type":"system","session_id":"claude-session-123"}"#);
        assert_eq!(
            event,
            Some(ClaudeStreamEvent::System {
                claude_session_id: Some("claude-session-123".to_string())
            })
        );
    }

    #[test]
    fn parse_stream_event_line_detects_result_event() {
        let event = parse_stream_event_line(r#"{"type":"result","stop_reason":"end_turn"}"#);
        assert_eq!(event, Some(ClaudeStreamEvent::Result));
    }

    #[test]
    fn decide_session_action_returns_reuse_for_existing_session() {
        let action = decide_session_action(Some("exo-session-1"), true);
        assert_eq!(
            action,
            SessionAction::Reuse {
                session_id: "exo-session-1".to_string()
            }
        );
    }

    #[test]
    fn decide_session_action_returns_missing_for_unknown_session() {
        let action = decide_session_action(Some("exo-session-404"), false);
        assert_eq!(
            action,
            SessionAction::Missing {
                session_id: "exo-session-404".to_string()
            }
        );
    }

    #[test]
    fn decide_session_action_returns_create_for_empty_session_id() {
        let action = decide_session_action(normalize_session_id(Some("   ")).as_deref(), false);
        assert_eq!(action, SessionAction::CreateNew);
    }
}
