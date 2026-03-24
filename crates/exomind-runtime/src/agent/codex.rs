use super::{Agent, ChatChunk, ChatRequest, SessionInfo};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::stream::{self, BoxStream, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionStatus {
    Idle,
    Processing,
}

impl SessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Processing => "processing",
        }
    }
}

#[derive(Debug, Clone)]
struct SessionSnapshot {
    session_id: String,
    status: SessionStatus,
    created_at: Instant,
    created_wall: DateTime<Utc>,
    last_active_wall: DateTime<Utc>,
    message_count: u64,
}

impl SessionSnapshot {
    fn new(session_id: String) -> Self {
        let created_at = Instant::now();
        let created_wall = Utc::now();
        Self {
            session_id,
            status: SessionStatus::Idle,
            created_at,
            created_wall,
            last_active_wall: created_wall,
            message_count: 0,
        }
    }

    fn to_session_info(&self) -> SessionInfo {
        SessionInfo {
            session_id: self.session_id.clone(),
            status: self.status.as_str().to_string(),
            created_at: format_utc_iso8601(self.created_wall),
            last_active: format_utc_iso8601(self.last_active_wall),
            message_count: self.message_count,
            uptime_secs: self.created_at.elapsed().as_secs(),
        }
    }
}

#[derive(Debug)]
enum CodexStreamEvent {
    ThreadStarted { thread_id: String },
    AgentMessage { text: String },
    TurnCompleted,
}

/// Managed Codex CLI agent（可动态创建的 Codex CLI Agent）.
#[derive(Debug, Clone)]
pub struct CodexAgent {
    id: String,
    name: String,
    description: String,
    command: String,
    base_args: Vec<String>,
    session_snapshots: Arc<StdMutex<HashMap<String, SessionSnapshot>>>,
}

impl CodexAgent {
    pub fn new() -> Self {
        Self::managed("codex", None, None)
    }

    pub fn managed(
        id: impl Into<String>,
        name: Option<String>,
        description: Option<String>,
    ) -> Self {
        Self::with_metadata_and_command(
            id.into(),
            name,
            description,
            resolve_codex_command(),
            vec![],
        )
    }

    pub fn with_command_and_args(command: impl Into<String>, base_args: Vec<String>) -> Self {
        Self::with_metadata_and_command("codex".to_string(), None, None, command.into(), base_args)
    }

    fn with_metadata_and_command(
        id: String,
        name: Option<String>,
        description: Option<String>,
        command: String,
        base_args: Vec<String>,
    ) -> Self {
        let default_name = if id == "codex" {
            "Codex Agent".to_string()
        } else {
            format!("Codex Agent ({id})")
        };
        let default_description = if id == "codex" {
            "通过 Codex CLI 提供流式对话".to_string()
        } else {
            format!("通过 Codex CLI 提供流式对话（{id}）")
        };

        Self {
            id,
            name: name.unwrap_or(default_name),
            description: description.unwrap_or(default_description),
            command,
            base_args,
            session_snapshots: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    fn lock_session_snapshots(&self) -> StdMutexGuard<'_, HashMap<String, SessionSnapshot>> {
        match self.session_snapshots.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn mark_existing_session_processing(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.lock_session_snapshots();
        let Some(session) = sessions.get_mut(session_id) else {
            return Err(format!("Codex 会话不存在: {session_id}"));
        };
        if matches!(session.status, SessionStatus::Processing) {
            return Err("Codex 会话正在处理中，请稍后重试".to_string());
        }
        session.status = SessionStatus::Processing;
        session.last_active_wall = Utc::now();
        session.message_count = session.message_count.saturating_add(1);
        Ok(())
    }

    fn insert_new_session_processing(&self, session_id: &str) {
        let mut snapshot = SessionSnapshot::new(session_id.to_string());
        snapshot.status = SessionStatus::Processing;
        snapshot.message_count = 1;
        snapshot.last_active_wall = Utc::now();
        self.lock_session_snapshots()
            .insert(session_id.to_string(), snapshot);
    }

    fn mark_session_idle(&self, session_id: &str) {
        if let Some(session) = self.lock_session_snapshots().get_mut(session_id) {
            session.status = SessionStatus::Idle;
            session.last_active_wall = Utc::now();
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
        let requested_session_id = normalize_session_id(request.session_id.as_deref());
        if let Some(session_id) = requested_session_id.as_deref()
            && let Err(message) = self.mark_existing_session_processing(session_id)
        {
            emit_error_chunk(&sender, message).await;
            return;
        }

        let mut child = match self.spawn_process(requested_session_id.as_deref()).await {
            Ok(child) => child,
            Err(message) => {
                if let Some(session_id) = requested_session_id.as_deref() {
                    self.mark_session_idle(session_id);
                }
                emit_error_chunk(&sender, message).await;
                return;
            }
        };

        let Some(mut stdin) = child.stdin.take() else {
            if let Some(session_id) = requested_session_id.as_deref() {
                self.mark_session_idle(session_id);
            }
            emit_error_chunk(&sender, "Codex stdin 不可用".to_string()).await;
            return;
        };
        let Some(stdout) = child.stdout.take() else {
            if let Some(session_id) = requested_session_id.as_deref() {
                self.mark_session_idle(session_id);
            }
            emit_error_chunk(&sender, "Codex stdout 不可用".to_string()).await;
            return;
        };

        if let Err(error) = write_prompt(&mut stdin, &request.message).await {
            if let Some(session_id) = requested_session_id.as_deref() {
                self.mark_session_idle(session_id);
            }
            emit_error_chunk(&sender, format!("Codex 输入写入失败: {error}")).await;
            return;
        }

        drop(stdin);

        let mut stdout = BufReader::new(stdout);
        let mut resolved_session_id = requested_session_id.clone();
        let mut saw_turn_completed = false;

        loop {
            match read_next_codex_event(&mut stdout).await {
                Ok(Some(CodexStreamEvent::ThreadStarted { thread_id })) => {
                    if resolved_session_id.is_none() {
                        resolved_session_id = Some(thread_id.clone());
                        self.insert_new_session_processing(&thread_id);
                        if sender
                            .send(ChatChunk {
                                content: String::new(),
                                session_id: Some(thread_id),
                            })
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                }
                Ok(Some(CodexStreamEvent::AgentMessage { text })) => {
                    let session_id = resolved_session_id.clone();
                    if sender
                        .send(ChatChunk {
                            content: text,
                            session_id: None,
                        })
                        .await
                        .is_err()
                    {
                        if let Some(session_id) = session_id.as_deref() {
                            self.mark_session_idle(session_id);
                        }
                        return;
                    }
                }
                Ok(Some(CodexStreamEvent::TurnCompleted)) => {
                    saw_turn_completed = true;
                    if let Some(session_id) = resolved_session_id.as_deref() {
                        self.mark_session_idle(session_id);
                    }
                    break;
                }
                Ok(None) => {
                    break;
                }
                Err(error) => {
                    if let Some(session_id) = resolved_session_id.as_deref() {
                        self.mark_session_idle(session_id);
                    }
                    emit_error_chunk(&sender, format!("Codex 输出读取失败: {error}")).await;
                    return;
                }
            }
        }

        let exit_status = child.wait().await.ok();
        if let Some(session_id) = resolved_session_id.as_deref() {
            self.mark_session_idle(session_id);
        }

        if !saw_turn_completed {
            let message = match exit_status.and_then(|status| status.code()) {
                Some(code) => format!("Codex 进程提前退出，退出码: {code}"),
                None => "Codex 输出流提前结束".to_string(),
            };
            emit_error_chunk(&sender, message).await;
        }
    }

    async fn spawn_process(
        &self,
        session_id: Option<&str>,
    ) -> Result<tokio::process::Child, String> {
        let mut command = Command::new(&self.command);
        command
            .args(&self.base_args)
            .args(build_codex_exec_args(session_id))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        command
            .spawn()
            .map_err(|error| format!("Codex 启动失败: {error}"))
    }
}

impl Default for CodexAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for CodexAgent {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        let receiver = self.spawn_streaming_task(request);
        stream::unfold(receiver, |mut receiver| async move {
            receiver.recv().await.map(|chunk| (chunk, receiver))
        })
        .boxed()
    }

    fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut sessions = self
            .lock_session_snapshots()
            .values()
            .map(SessionSnapshot::to_session_info)
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    fn get_session(&self, session_id: &str) -> Option<SessionInfo> {
        self.lock_session_snapshots()
            .get(session_id)
            .map(SessionSnapshot::to_session_info)
    }

    fn close_session(&self, session_id: &str) -> bool {
        self.lock_session_snapshots().remove(session_id).is_some()
    }
}

fn resolve_codex_command() -> String {
    let command = std::env::var("EXOMIND_CODEX_COMMAND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "codex".to_string());
    normalize_codex_command(command)
}

fn normalize_codex_command(command: String) -> String {
    #[cfg(target_os = "windows")]
    {
        if command.eq_ignore_ascii_case("codex") {
            return "codex.cmd".to_string();
        }
    }

    command
}

fn build_codex_exec_args(session_id: Option<&str>) -> Vec<String> {
    let mut args = vec!["exec".to_string()];
    if let Some(session_id) = session_id {
        args.push("resume".to_string());
        args.push(session_id.to_string());
    }
    args.push("--json".to_string());
    args.push("--skip-git-repo-check".to_string());
    args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
    args.push("-".to_string());
    args
}

fn normalize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn write_prompt(stdin: &mut tokio::process::ChildStdin, prompt: &str) -> std::io::Result<()> {
    stdin.write_all(prompt.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await
}

async fn read_next_codex_event(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
) -> std::io::Result<Option<CodexStreamEvent>> {
    loop {
        let mut line = String::new();
        let read_bytes = stdout.read_line(&mut line).await?;
        if read_bytes == 0 {
            return Ok(None);
        }

        let normalized = line.trim();
        if normalized.is_empty() {
            continue;
        }
        if let Some(event) = parse_codex_stream_event_line(normalized) {
            return Ok(Some(event));
        }
    }
}

fn parse_codex_stream_event_line(line: &str) -> Option<CodexStreamEvent> {
    let value: Value = serde_json::from_str(line).ok()?;
    let event_type = value.get("type").and_then(Value::as_str)?;

    match event_type {
        "thread.started" => {
            let thread_id = value.get("thread_id").and_then(Value::as_str)?.to_string();
            Some(CodexStreamEvent::ThreadStarted { thread_id })
        }
        "item.completed" => {
            let item = value.get("item")?;
            let item_type = item.get("type").and_then(Value::as_str)?;
            if item_type != "agent_message" {
                return None;
            }
            let text = item
                .get("text")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| {
                    item.get("message")
                        .and_then(|message| message.get("text"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })?;
            Some(CodexStreamEvent::AgentMessage { text })
        }
        "turn.completed" => Some(CodexStreamEvent::TurnCompleted),
        _ => None,
    }
}

async fn emit_error_chunk(sender: &mpsc::Sender<ChatChunk>, message: String) {
    let _ = sender.send(ChatChunk::content_only(message)).await;
}

fn format_utc_iso8601(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_codex_command_defaults_to_cmd_on_windows() {
        let original = std::env::var_os("EXOMIND_CODEX_COMMAND");
        unsafe {
            std::env::remove_var("EXOMIND_CODEX_COMMAND");
        }

        let resolved = resolve_codex_command();

        match original {
            Some(value) => unsafe {
                std::env::set_var("EXOMIND_CODEX_COMMAND", value);
            },
            None => unsafe {
                std::env::remove_var("EXOMIND_CODEX_COMMAND");
            },
        }

        assert_eq!(resolved, "codex.cmd");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolve_codex_command_normalizes_bare_alias_on_windows() {
        let original = std::env::var_os("EXOMIND_CODEX_COMMAND");
        unsafe {
            std::env::set_var("EXOMIND_CODEX_COMMAND", "codex");
        }

        let resolved = resolve_codex_command();

        match original {
            Some(value) => unsafe {
                std::env::set_var("EXOMIND_CODEX_COMMAND", value);
            },
            None => unsafe {
                std::env::remove_var("EXOMIND_CODEX_COMMAND");
            },
        }

        assert_eq!(resolved, "codex.cmd");
    }

    #[test]
    fn normalize_codex_command_keeps_explicit_command_path() {
        assert_eq!(
            normalize_codex_command("/custom/bin/codex".to_string()),
            "/custom/bin/codex"
        );
    }
}
