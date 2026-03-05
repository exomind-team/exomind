use super::{Agent, ChatChunk, ChatRequest, SessionInfo};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::stream::{self, BoxStream, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex as AsyncMutex, mpsc};
use uuid::Uuid;

const MAX_CLAUDE_SESSIONS: usize = 64;

/// Token usage snapshot（Token 用量快照）.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
struct TokenUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
}

impl TokenUsage {
    fn accumulate(&mut self, other: &TokenUsage) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
    }

    fn estimated_cost_usd(&self) -> f64 {
        const PER_MILLION_INPUT_USD: f64 = 3.0;
        const PER_MILLION_OUTPUT_USD: f64 = 15.0;
        const PER_MILLION_CACHE_READ_USD: f64 = 0.30;
        const PER_MILLION_CACHE_WRITE_USD: f64 = 3.75;

        (self.input_tokens as f64 * PER_MILLION_INPUT_USD
            + self.output_tokens as f64 * PER_MILLION_OUTPUT_USD
            + self.cache_read_tokens as f64 * PER_MILLION_CACHE_READ_USD
            + self.cache_write_tokens as f64 * PER_MILLION_CACHE_WRITE_USD)
            / 1_000_000.0
    }
}

/// Claude stats payload（Claude 统计响应载荷）.
#[derive(Debug, Clone, Serialize, PartialEq)]
struct ClaudeAgentStats {
    session_id: Option<String>,
    session_count: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    message_count: u64,
    uptime_secs: u64,
    total_cost_usd: f64,
}

/// Session status（会话状态）.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionStatus {
    Idle,
    Processing,
    Crashed,
}

impl SessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Processing => "processing",
            SessionStatus::Crashed => "crashed",
        }
    }
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
    created_wall: DateTime<Utc>,
    last_active: Instant,
    message_count: u64,
    token_usage: TokenUsage,
    total_cost_usd: f64,
}

impl Drop for ClaudeSession {
    fn drop(&mut self) {
        // Best-effort process termination（尽力终止子进程，避免僵尸/泄漏）.
        let _ = self.child.start_kill();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionAction {
    CreateNew,
    Reuse { session_id: String },
    Missing { session_id: String },
}

#[derive(Debug, Clone, PartialEq)]
enum ClaudeStreamEvent {
    System {
        claude_session_id: Option<String>,
    },
    AssistantChunk {
        content: String,
    },
    Result {
        usage: Option<TokenUsage>,
        total_cost_usd: Option<f64>,
    },
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
    fn from_session(session: &ClaudeSession) -> Self {
        Self {
            session_id: session.session_id.clone(),
            status: session.status,
            created_at: session.created_at,
            created_wall: session.created_wall,
            last_active_wall: compute_last_active_wall(session),
            message_count: session.message_count,
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

type SharedClaudeSession = Arc<AsyncMutex<ClaudeSession>>;

/// Built-in Claude agent (内置 Claude Agent，通过 Claude CLI 输出流式文本).
#[derive(Debug, Clone)]
pub struct ClaudeAgent {
    command: String,
    persistent_args: Vec<String>,
    sessions: Arc<StdMutex<HashMap<String, SharedClaudeSession>>>,
    session_snapshots: Arc<StdMutex<HashMap<String, SessionSnapshot>>>,
}

impl ClaudeAgent {
    pub fn new() -> Self {
        Self::with_command_and_args("claude", build_claude_persistent_args())
    }

    pub fn with_command_and_args(command: impl Into<String>, persistent_args: Vec<String>) -> Self {
        Self {
            command: command.into(),
            persistent_args,
            sessions: Arc::new(StdMutex::new(HashMap::new())),
            session_snapshots: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    fn lock_sessions(&self) -> StdMutexGuard<'_, HashMap<String, SharedClaudeSession>> {
        match self.sessions.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn lock_session_snapshots(&self) -> StdMutexGuard<'_, HashMap<String, SessionSnapshot>> {
        match self.session_snapshots.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn upsert_snapshot_from_session(&self, session: &ClaudeSession) {
        let snapshot = SessionSnapshot::from_session(session);
        let sessions = self.lock_sessions();
        let mut snapshots = self.lock_session_snapshots();
        if sessions.contains_key(&session.session_id) {
            snapshots.insert(snapshot.session_id.clone(), snapshot);
        } else {
            snapshots.remove(&session.session_id);
        }
    }

    fn remove_snapshot(&self, session_id: &str) {
        self.lock_session_snapshots().remove(session_id);
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
            self.find_session(session_id)
        } else {
            None
        };

        let action =
            decide_session_action(normalized_session_id.as_deref(), existing_session.is_some());

        let (session_id, session_handle, needs_session_chunk) = match action {
            SessionAction::CreateNew => match self.create_session() {
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

    fn find_session(&self, session_id: &str) -> Option<SharedClaudeSession> {
        self.lock_sessions().get(session_id).cloned()
    }

    fn create_session(&self) -> Result<(String, SharedClaudeSession), String> {
        self.evict_dead_sessions();

        let session_id = Uuid::new_v4().to_string();
        let mut command = Command::new(&self.command);
        command
            .args(&self.persistent_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
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

        let created_at = Instant::now();
        let mut session = ClaudeSession {
            session_id: session_id.clone(),
            claude_session_id: None,
            child,
            stdin,
            stdout: BufReader::new(stdout),
            status: SessionStatus::Idle,
            created_at,
            created_wall: Utc::now(),
            last_active: created_at,
            message_count: 0,
            token_usage: TokenUsage::default(),
            total_cost_usd: 0.0,
        };

        let mut sessions = self.lock_sessions();
        if sessions.len() >= MAX_CLAUDE_SESSIONS {
            let _ = session.child.start_kill();
            return Err(format!(
                "Claude 会话数已达上限({MAX_CLAUDE_SESSIONS})，请复用已有会话"
            ));
        }

        self.lock_session_snapshots()
            .insert(session_id.clone(), SessionSnapshot::from_session(&session));
        let shared_session = Arc::new(AsyncMutex::new(session));
        sessions.insert(session_id.clone(), shared_session.clone());
        Ok((session_id, shared_session))
    }

    async fn collect_stats(&self, session_id: Option<&str>) -> Option<ClaudeAgentStats> {
        let target_sessions = {
            let sessions = self.lock_sessions();
            match session_id {
                Some(id) => {
                    let handle = sessions.get(id)?.clone();
                    vec![handle]
                }
                None => sessions.values().cloned().collect::<Vec<_>>(),
            }
        };

        let session_count = target_sessions.len() as u64;
        let mut usage = TokenUsage::default();
        let mut message_count = 0_u64;
        let mut uptime_secs = 0_u64;
        let mut total_cost_usd = 0.0_f64;

        for handle in target_sessions {
            let session = handle.lock().await;
            usage.accumulate(&session.token_usage);
            message_count = message_count.saturating_add(session.message_count);
            uptime_secs = uptime_secs.saturating_add(session.created_at.elapsed().as_secs());
            total_cost_usd += session.total_cost_usd;
        }

        Some(ClaudeAgentStats {
            session_id: session_id.map(ToString::to_string),
            session_count,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_tokens: usage.cache_read_tokens,
            cache_write_tokens: usage.cache_write_tokens,
            message_count,
            uptime_secs,
            total_cost_usd,
        })
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

        match session.status {
            SessionStatus::Idle => {}
            SessionStatus::Processing => {
                emit_error_chunk(&sender, "Claude 会话正在处理中，请稍后重试".to_string()).await;
                return;
            }
            SessionStatus::Crashed => {
                drop(session);
                self.cleanup_session(&session_id).await;
                emit_error_chunk(&sender, "Claude 会话已崩溃，请新建会话".to_string()).await;
                return;
            }
        }

        if let Err(error_message) = ensure_session_process_alive(&mut session) {
            session.status = SessionStatus::Crashed;
            drop(session);
            self.cleanup_session(&session_id).await;
            emit_error_chunk(&sender, error_message).await;
            return;
        }

        session.status = SessionStatus::Processing;
        session.message_count += 1;
        session.last_active = Instant::now();
        self.upsert_snapshot_from_session(&session);

        let input_line = build_stream_json_user_input(&message);
        if let Err(error) = write_user_input_line(&mut session.stdin, &input_line).await {
            session.status = SessionStatus::Crashed;
            self.upsert_snapshot_from_session(&session);
            drop(session);
            self.cleanup_session(&session_id).await;
            emit_error_chunk(&sender, format!("Claude 输入写入失败: {error}")).await;
            return;
        }

        let mut pending_session_chunk = needs_session_chunk;
        loop {
            match read_next_stream_event(&mut session.stdout).await {
                Ok(Some(ClaudeStreamEvent::System { claude_session_id })) => {
                    session.last_active = Instant::now();
                    if let Some(value) = claude_session_id {
                        session.claude_session_id = Some(value);
                    }
                    self.upsert_snapshot_from_session(&session);
                }
                Ok(Some(ClaudeStreamEvent::AssistantChunk { content })) => {
                    session.last_active = Instant::now();
                    self.upsert_snapshot_from_session(&session);
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
                        self.upsert_snapshot_from_session(&session);
                        return;
                    }
                }
                Ok(Some(ClaudeStreamEvent::Result {
                    usage,
                    total_cost_usd,
                })) => {
                    session.last_active = Instant::now();
                    let turn_cost_usd = resolve_turn_cost_usd(usage.as_ref(), total_cost_usd);

                    if let Some(turn_usage) = usage {
                        session.token_usage.accumulate(&turn_usage);
                    }
                    session.total_cost_usd += turn_cost_usd;
                    if pending_session_chunk {
                        let _ = sender
                            .send(ChatChunk {
                                content: String::new(),
                                session_id: Some(session_id.clone()),
                            })
                            .await;
                    }
                    session.status = SessionStatus::Idle;
                    self.upsert_snapshot_from_session(&session);
                    return;
                }
                Ok(None) => {
                    session.status = SessionStatus::Crashed;
                    self.upsert_snapshot_from_session(&session);
                    let message = build_session_ended_error_message(&mut session);
                    drop(session);
                    self.cleanup_session(&session_id).await;
                    emit_error_chunk(&sender, message).await;
                    return;
                }
                Err(error) => {
                    session.status = SessionStatus::Crashed;
                    self.upsert_snapshot_from_session(&session);
                    drop(session);
                    self.cleanup_session(&session_id).await;
                    emit_error_chunk(&sender, format!("Claude 输出读取失败: {error}")).await;
                    return;
                }
            }
        }
    }

    async fn cleanup_session(&self, session_id: &str) {
        let removed = self.lock_sessions().remove(session_id);
        self.remove_snapshot(session_id);
        if let Some(handle) = removed {
            let mut session = handle.lock().await;
            session.status = SessionStatus::Crashed;
            session.last_active = Instant::now();
            let _ = session.child.start_kill();
        }
    }

    fn evict_dead_sessions(&self) {
        let snapshots = {
            let sessions = self.lock_sessions();
            sessions
                .iter()
                .map(|(id, handle)| (id.clone(), handle.clone()))
                .collect::<Vec<_>>()
        };

        let mut stale_ids = Vec::new();
        for (id, handle) in snapshots {
            if let Ok(mut session) = handle.try_lock() {
                let dead = matches!(session.status, SessionStatus::Crashed)
                    || matches!(session.child.try_wait(), Ok(Some(_)) | Err(_));
                if dead {
                    let _ = session.child.start_kill();
                    stale_ids.push(id);
                }
            }
        }

        if stale_ids.is_empty() {
            return;
        }

        let mut sessions = self.lock_sessions();
        for id in stale_ids {
            sessions.remove(&id);
            self.remove_snapshot(&id);
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

    fn list_sessions(&self) -> Vec<SessionInfo> {
        self.evict_dead_sessions();
        let mut sessions = self
            .lock_session_snapshots()
            .values()
            .map(SessionSnapshot::to_session_info)
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    fn get_session(&self, session_id: &str) -> Option<SessionInfo> {
        self.evict_dead_sessions();
        self.lock_session_snapshots()
            .get(session_id)
            .map(SessionSnapshot::to_session_info)
    }

    fn close_session(&self, session_id: &str) -> bool {
        let removed = self.lock_sessions().remove(session_id);
        let Some(handle) = removed else {
            return false;
        };
        self.remove_snapshot(session_id);

        if let Ok(mut session) = handle.try_lock() {
            session.status = SessionStatus::Crashed;
            session.last_active = Instant::now();
            let _ = session.child.start_kill();
        } else if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let mut session = handle.lock().await;
                session.status = SessionStatus::Crashed;
                session.last_active = Instant::now();
                let _ = session.child.start_kill();
            });
        }

        true
    }

    fn stats(
        &self,
        session_id: Option<String>,
    ) -> futures_util::future::BoxFuture<'_, Option<Value>> {
        Box::pin(async move {
            let stats = self.collect_stats(session_id.as_deref()).await?;
            serde_json::to_value(stats).ok()
        })
    }
}

fn compute_last_active_wall(session: &ClaudeSession) -> DateTime<Utc> {
    let since_created = session
        .last_active
        .saturating_duration_since(session.created_at);
    let offset =
        chrono::Duration::from_std(since_created).unwrap_or_else(|_| chrono::Duration::zero());
    session.created_wall + offset
}

fn format_utc_iso8601(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
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

fn ensure_session_process_alive(session: &mut ClaudeSession) -> Result<(), String> {
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
        "--replay-user-messages".to_string(),
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
        "result" => Some(ClaudeStreamEvent::Result {
            usage: extract_token_usage(&event),
            total_cost_usd: extract_total_cost_usd(&event),
        }),
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

fn extract_total_cost_usd(event: &Value) -> Option<f64> {
    event.get("total_cost_usd").and_then(Value::as_f64)
}

fn extract_token_usage(event: &Value) -> Option<TokenUsage> {
    let usage = event.get("usage")?;
    Some(TokenUsage {
        input_tokens: read_u64_field(usage, &["input_tokens"]),
        output_tokens: read_u64_field(usage, &["output_tokens"]),
        cache_read_tokens: read_u64_field(usage, &["cache_read_input_tokens", "cache_read_tokens"]),
        cache_write_tokens: read_u64_field(
            usage,
            &["cache_creation_input_tokens", "cache_write_tokens"],
        ),
    })
}

fn read_u64_field(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_u64))
        .unwrap_or(0)
}

fn resolve_turn_cost_usd(usage: Option<&TokenUsage>, total_cost_usd: Option<f64>) -> f64 {
    total_cost_usd
        .or_else(|| usage.map(TokenUsage::estimated_cost_usd))
        .unwrap_or(0.0)
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
            vec![
                ChatChunk::content_only("你好"),
                ChatChunk::content_only("！")
            ]
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
                "--replay-user-messages".to_string(),
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
        assert_eq!(
            event,
            Some(ClaudeStreamEvent::Result {
                usage: None,
                total_cost_usd: None,
            })
        );
    }

    #[test]
    fn token_usage_accumulate_adds_all_fields() {
        let mut total = TokenUsage {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_tokens: 30,
            cache_write_tokens: 40,
        };
        let delta = TokenUsage {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_tokens: 3,
            cache_write_tokens: 4,
        };

        total.accumulate(&delta);

        assert_eq!(
            total,
            TokenUsage {
                input_tokens: 11,
                output_tokens: 22,
                cache_read_tokens: 33,
                cache_write_tokens: 44,
            }
        );
    }

    #[test]
    fn token_usage_estimated_cost_usd_uses_claude_3_5_sonnet_pricing() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_tokens: 1_000_000,
            cache_write_tokens: 1_000_000,
        };

        let cost = usage.estimated_cost_usd();
        let expected = 3.0 + 15.0 + 0.30 + 3.75;
        assert!((cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_stream_event_line_extracts_result_usage_and_cost() {
        let line = r#"{
            "type":"result",
            "usage":{
                "input_tokens":1250,
                "output_tokens":340,
                "cache_creation_input_tokens":200,
                "cache_read_input_tokens":500
            },
            "total_cost_usd":0.042
        }"#;
        let event = parse_stream_event_line(line);

        assert_eq!(
            event,
            Some(ClaudeStreamEvent::Result {
                usage: Some(TokenUsage {
                    input_tokens: 1250,
                    output_tokens: 340,
                    cache_read_tokens: 500,
                    cache_write_tokens: 200,
                }),
                total_cost_usd: Some(0.042),
            })
        );
    }

    #[test]
    fn resolve_turn_cost_usd_prioritizes_cli_reported_cost() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
        };
        let resolved = resolve_turn_cost_usd(Some(&usage), Some(0.5));
        assert!((resolved - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn resolve_turn_cost_usd_falls_back_to_estimation() {
        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
        };
        let resolved = resolve_turn_cost_usd(Some(&usage), None);
        assert!((resolved - 3.0).abs() < f64::EPSILON);
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

    #[test]
    fn list_sessions_returns_empty_initially() {
        let agent = ClaudeAgent::with_command_and_args("unused-command", vec![]);
        assert_eq!(agent.list_sessions(), Vec::new());
    }

    #[test]
    fn get_session_returns_none_for_unknown() {
        let agent = ClaudeAgent::with_command_and_args("unused-command", vec![]);
        assert_eq!(agent.get_session("missing-session"), None);
    }

    #[test]
    fn close_session_returns_false_for_unknown() {
        let agent = ClaudeAgent::with_command_and_args("unused-command", vec![]);
        assert!(!agent.close_session("missing-session"));
    }
}
