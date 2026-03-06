use super::provider::AgentProvider;
use super::{Agent, ChatRequest, RuntimeAgentEvent, SessionInfo};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::stream::{self, BoxStream, StreamExt};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex as AsyncMutex, mpsc};

const DEFAULT_CODEX_NOTIFICATION_OPTOUTS: &[&str] = &[
    "turn/diff/updated",
    "turn/plan/updated",
    "thread/tokenUsage/updated",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/summaryTextDelta",
];

type SharedCodexProcess = Arc<AsyncMutex<CodexProcess>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexSessionStatus {
    Idle,
    Processing,
    Crashed,
}

impl CodexSessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            CodexSessionStatus::Idle => "idle",
            CodexSessionStatus::Processing => "processing",
            CodexSessionStatus::Crashed => "crashed",
        }
    }
}

#[derive(Debug, Clone)]
struct CodexSessionSnapshot {
    session_id: String,
    status: CodexSessionStatus,
    created_at: Instant,
    created_wall: DateTime<Utc>,
    last_active_wall: DateTime<Utc>,
    message_count: u64,
    current_turn_id: Option<String>,
}

impl CodexSessionSnapshot {
    fn new(session_id: String) -> Self {
        let created_at = Instant::now();
        let created_wall = Utc::now();
        Self {
            session_id,
            status: CodexSessionStatus::Idle,
            created_at,
            created_wall,
            last_active_wall: created_wall,
            message_count: 0,
            current_turn_id: None,
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
struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
    buffered_notifications: VecDeque<Value>,
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// Built-in Codex agent（内置 Codex Agent，通过 codex app-server 输出流式事件）.
#[derive(Debug, Clone)]
pub struct CodexAgent {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    command: String,
    process_args: Vec<String>,
    process_slot: Arc<StdMutex<Option<SharedCodexProcess>>>,
    process_init_lock: Arc<AsyncMutex<()>>,
    session_snapshots: Arc<StdMutex<HashMap<String, CodexSessionSnapshot>>>,
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
            build_codex_app_server_args(),
        )
    }

    pub fn with_command_and_args(command: impl Into<String>, process_args: Vec<String>) -> Self {
        Self::with_metadata_and_command(
            "codex".to_string(),
            None,
            None,
            command.into(),
            process_args,
        )
    }

    fn with_metadata_and_command(
        id: String,
        name: Option<String>,
        description: Option<String>,
        command: String,
        process_args: Vec<String>,
    ) -> Self {
        fn leak_owned(value: String) -> &'static str {
            Box::leak(value.into_boxed_str())
        }

        let id = leak_owned(id);
        let default_name = format!("Codex Agent ({id})");
        let default_description = format!("通过 Codex CLI 提供流式对话（{id}）");
        let name = leak_owned(name.unwrap_or(default_name));
        let description = leak_owned(description.unwrap_or(default_description));

        Self {
            id,
            name,
            description,
            command,
            process_args,
            process_slot: Arc::new(StdMutex::new(None)),
            process_init_lock: Arc::new(AsyncMutex::new(())),
            session_snapshots: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    fn lock_process_slot(&self) -> StdMutexGuard<'_, Option<SharedCodexProcess>> {
        match self.process_slot.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn lock_session_snapshots(&self) -> StdMutexGuard<'_, HashMap<String, CodexSessionSnapshot>> {
        match self.session_snapshots.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn session_snapshot(&self, session_id: &str) -> Option<CodexSessionSnapshot> {
        self.lock_session_snapshots().get(session_id).cloned()
    }

    fn upsert_session_snapshot(&self, snapshot: CodexSessionSnapshot) {
        self.lock_session_snapshots()
            .insert(snapshot.session_id.clone(), snapshot);
    }

    fn update_session_snapshot(
        &self,
        session_id: &str,
        updater: impl FnOnce(&mut CodexSessionSnapshot),
    ) {
        if let Some(snapshot) = self.lock_session_snapshots().get_mut(session_id) {
            updater(snapshot);
            snapshot.last_active_wall = Utc::now();
        }
    }

    fn remove_session_snapshot(&self, session_id: &str) -> Option<CodexSessionSnapshot> {
        self.lock_session_snapshots().remove(session_id)
    }

    fn mark_all_sessions_crashed(&self) {
        let now = Utc::now();
        for snapshot in self.lock_session_snapshots().values_mut() {
            snapshot.status = CodexSessionStatus::Crashed;
            snapshot.current_turn_id = None;
            snapshot.last_active_wall = now;
        }
    }

    fn clear_process_slot(&self) {
        self.lock_process_slot().take();
    }

    async fn spawn_streaming_task(&self, request: ChatRequest) -> mpsc::Receiver<RuntimeAgentEvent> {
        let (sender, receiver) = mpsc::channel(64);
        let agent = self.clone();

        tokio::spawn(async move {
            agent.handle_chat_request(request, sender).await;
        });

        receiver
    }

    async fn handle_chat_request(
        &self,
        request: ChatRequest,
        sender: mpsc::Sender<RuntimeAgentEvent>,
    ) {
        let normalized_session_id = normalize_session_id(request.session_id.as_deref());
        let is_new_session = normalized_session_id.is_none();

        if let Some(session_id) = normalized_session_id.as_deref()
            && self.session_snapshot(session_id).is_none()
        {
            let _ = sender
                .send(RuntimeAgentEvent::error(format!("Codex 会话不存在: {session_id}")))
                .await;
            return;
        }

        let shared_process = match self.ensure_process().await {
            Ok(process) => process,
            Err(message) => {
                let _ = sender.send(RuntimeAgentEvent::error(message)).await;
                return;
            }
        };

        let mut process = shared_process.lock().await;
        let session_id = match normalized_session_id {
            Some(session_id) => session_id,
            None => match self.start_thread(&mut process).await {
                Ok(session_id) => {
                    self.upsert_session_snapshot(CodexSessionSnapshot::new(session_id.clone()));
                    if sender
                        .send(RuntimeAgentEvent::session_started(session_id.clone()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                    session_id
                }
                Err(message) => {
                    let _ = sender.send(RuntimeAgentEvent::error(message)).await;
                    return;
                }
            },
        };

        if let Some(snapshot) = self.session_snapshot(&session_id) {
            if matches!(snapshot.status, CodexSessionStatus::Processing) {
                let _ = sender
                    .send(RuntimeAgentEvent::error(
                        "Codex 会话正在处理中，请稍后重试".to_string(),
                    ))
                    .await;
                return;
            }
        }

        let turn_id = match self.start_turn(&mut process, &session_id, &request.message).await {
            Ok(turn_id) => {
                self.update_session_snapshot(&session_id, |snapshot| {
                    snapshot.status = CodexSessionStatus::Processing;
                    snapshot.current_turn_id = Some(turn_id.clone());
                    snapshot.message_count = snapshot.message_count.saturating_add(1);
                });
                turn_id
            }
            Err(message) => {
                if is_new_session {
                    self.remove_session_snapshot(&session_id);
                }
                let _ = sender.send(RuntimeAgentEvent::error(message)).await;
                return;
            }
        };

        if let Err(message) = self
            .stream_turn_events(&mut process, &session_id, &turn_id, &sender)
            .await
        {
            self.update_session_snapshot(&session_id, |snapshot| {
                snapshot.status = CodexSessionStatus::Crashed;
                snapshot.current_turn_id = None;
            });
            self.mark_all_sessions_crashed();
            drop(process);
            self.clear_process_slot();
            let _ = sender.send(RuntimeAgentEvent::error(message)).await;
        }
    }

    async fn ensure_process(&self) -> Result<SharedCodexProcess, String> {
        let _guard = self.process_init_lock.lock().await;

        let existing = { self.lock_process_slot().as_ref().cloned() };
        if let Some(existing) = existing {
            let mut process = existing.lock().await;
            match process.child.try_wait() {
                Ok(None) => {
                    drop(process);
                    return Ok(existing);
                }
                Ok(Some(_)) | Err(_) => {
                    drop(process);
                    self.clear_process_slot();
                }
            }
        }

        let process = Arc::new(AsyncMutex::new(self.spawn_process().await?));
        self.lock_process_slot().replace(process.clone());
        Ok(process)
    }

    async fn spawn_process(&self) -> Result<CodexProcess, String> {
        let mut command = Command::new(&self.command);
        command
            .args(&self.process_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("Codex 启动失败: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex stdin 不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex stdout 不可用".to_string())?;

        let mut process = CodexProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_request_id: 1,
            buffered_notifications: VecDeque::new(),
        };

        self.initialize_process(&mut process).await?;
        Ok(process)
    }

    async fn initialize_process(&self, process: &mut CodexProcess) -> Result<(), String> {
        let initialize_params = json!({
            "clientInfo": {
                "name": "exomind-runtime",
                "title": "ExoMind Runtime",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": {
                "experimentalApi": true,
                "optOutNotificationMethods": DEFAULT_CODEX_NOTIFICATION_OPTOUTS
            }
        });

        send_request(process, "initialize", initialize_params).await?;
        send_notification(process, "initialized", None).await?;
        Ok(())
    }

    async fn start_thread(&self, process: &mut CodexProcess) -> Result<String, String> {
        let response = send_request(process, "thread/start", build_thread_start_params()).await?;
        response
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| "Codex thread/start 响应缺少 thread.id".to_string())
    }

    async fn start_turn(
        &self,
        process: &mut CodexProcess,
        thread_id: &str,
        message: &str,
    ) -> Result<String, String> {
        let response = send_request(
            process,
            "turn/start",
            build_turn_start_params(thread_id, message),
        )
        .await?;

        response
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| "Codex turn/start 响应缺少 turn.id".to_string())
    }

    async fn stream_turn_events(
        &self,
        process: &mut CodexProcess,
        session_id: &str,
        turn_id: &str,
        sender: &mpsc::Sender<RuntimeAgentEvent>,
    ) -> Result<(), String> {
        loop {
            let Some(message) = next_notification(process).await? else {
                return Err("Codex 输出流提前结束".to_string());
            };

            let method = message
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let params = message.get("params").cloned().unwrap_or(Value::Null);

            match method {
                "turn/started" => {
                    if notification_thread_id(&params) == Some(session_id) {
                        self.update_session_snapshot(session_id, |snapshot| {
                            snapshot.status = CodexSessionStatus::Processing;
                            snapshot.current_turn_id = params
                                .get("turn")
                                .and_then(|turn| turn.get("id"))
                                .and_then(Value::as_str)
                                .map(ToString::to_string)
                                .or_else(|| Some(turn_id.to_string()));
                        });
                    }
                }
                "item/agentMessage/delta" => {
                    if notification_thread_id(&params) == Some(session_id)
                        && params.get("turnId").and_then(Value::as_str) == Some(turn_id)
                        && let Some(delta) = params.get("delta").and_then(Value::as_str)
                    {
                        let _ = sender.send(RuntimeAgentEvent::output_delta(delta)).await;
                    }
                }
                "item/reasoning/textDelta" => {
                    if notification_thread_id(&params) == Some(session_id)
                        && params.get("turnId").and_then(Value::as_str) == Some(turn_id)
                        && let Some(delta) = params.get("delta").and_then(Value::as_str)
                    {
                        let _ = sender
                            .send(RuntimeAgentEvent::ThinkingDelta {
                                content: delta.to_string(),
                                session_id: None,
                            })
                            .await;
                    }
                }
                "item/started" => {
                    if notification_thread_id(&params) == Some(session_id)
                        && params.get("turnId").and_then(Value::as_str) == Some(turn_id)
                        && let Some(event) = build_tool_call_event(&params)
                    {
                        let _ = sender.send(event).await;
                    }
                }
                "item/completed" => {
                    if notification_thread_id(&params) == Some(session_id)
                        && params.get("turnId").and_then(Value::as_str) == Some(turn_id)
                        && let Some(event) = build_tool_result_event(&params)
                    {
                        let _ = sender.send(event).await;
                    }
                }
                "error" => {
                    if let Some(message_text) = params.get("message").and_then(Value::as_str) {
                        let _ = sender.send(RuntimeAgentEvent::error(message_text)).await;
                    }
                }
                "turn/completed" => {
                    if notification_thread_id(&params) != Some(session_id) {
                        continue;
                    }
                    if params
                        .get("turn")
                        .and_then(|turn| turn.get("id"))
                        .and_then(Value::as_str)
                        != Some(turn_id)
                    {
                        continue;
                    }

                    if params
                        .get("turn")
                        .and_then(|turn| turn.get("status"))
                        .and_then(Value::as_str)
                        == Some("failed")
                        && let Some(message_text) = params
                            .get("turn")
                            .and_then(|turn| turn.get("error"))
                            .and_then(|error| error.get("message"))
                            .and_then(Value::as_str)
                    {
                        let _ = sender.send(RuntimeAgentEvent::error(message_text)).await;
                    }

                    self.update_session_snapshot(session_id, |snapshot| {
                        snapshot.status = CodexSessionStatus::Idle;
                        snapshot.current_turn_id = None;
                    });
                    let _ = sender.send(RuntimeAgentEvent::done()).await;
                    return Ok(());
                }
                _ => {}
            }
        }
    }

    async fn interrupt_and_unsubscribe(
        process: SharedCodexProcess,
        session_id: String,
        turn_id: Option<String>,
    ) {
        let mut process = process.lock().await;
        if let Some(turn_id) = turn_id {
            let _ = send_request(
                &mut process,
                "turn/interrupt",
                json!({
                    "threadId": session_id,
                    "turnId": turn_id
                }),
            )
            .await;
        }

        let _ = send_request(
            &mut process,
            "thread/unsubscribe",
            json!({
                "threadId": session_id
            }),
        )
        .await;
        let _ = send_request(
            &mut process,
            "thread/archive",
            json!({
                "threadId": session_id
            }),
        )
        .await;
    }
}

impl Default for CodexAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentProvider for CodexAgent {
    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, RuntimeAgentEvent> {
        let agent = self.clone();
        stream::once(async move {
            let receiver = agent.spawn_streaming_task(request).await;
            stream::unfold(receiver, |mut receiver| async move {
                receiver.recv().await.map(|event| (event, receiver))
            })
        })
        .flatten()
        .boxed()
    }

    fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut sessions = self
            .lock_session_snapshots()
            .values()
            .map(CodexSessionSnapshot::to_session_info)
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    fn get_session(&self, session_id: &str) -> Option<SessionInfo> {
        self.lock_session_snapshots()
            .get(session_id)
            .map(CodexSessionSnapshot::to_session_info)
    }

    fn close_session(&self, session_id: &str) -> bool {
        let Some(snapshot) = self.remove_session_snapshot(session_id) else {
            return false;
        };

        if let Some(process) = self.lock_process_slot().as_ref().cloned()
            && let Ok(runtime) = tokio::runtime::Handle::try_current()
        {
            runtime.spawn(Self::interrupt_and_unsubscribe(
                process,
                snapshot.session_id,
                snapshot.current_turn_id,
            ));
        }

        true
    }
}

impl Agent for CodexAgent {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn description(&self) -> &'static str {
        self.description
    }
}

fn resolve_codex_command() -> String {
    std::env::var("EXOMIND_CODEX_COMMAND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "codex".to_string())
}

fn build_codex_app_server_args() -> Vec<String> {
    vec![
        "app-server".to_string(),
        "--listen".to_string(),
        "stdio://".to_string(),
    ]
}

fn build_thread_start_params() -> Value {
    json!({
        "cwd": current_workdir_string(),
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "experimentalRawEvents": false,
        "persistExtendedHistory": false
    })
}

fn build_turn_start_params(thread_id: &str, message: &str) -> Value {
    json!({
        "threadId": thread_id,
        "input": [
            {
                "type": "text",
                "text": message,
                "text_elements": []
            }
        ]
    })
}

fn current_workdir_string() -> String {
    std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn normalize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn format_utc_iso8601(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

async fn send_notification(
    process: &mut CodexProcess,
    method: &str,
    params: Option<Value>,
) -> Result<(), String> {
    let payload = match params {
        Some(params) => json!({ "method": method, "params": params }),
        None => json!({ "method": method }),
    };
    write_json_line(&mut process.stdin, &payload).await
}

async fn send_request(
    process: &mut CodexProcess,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request_id = process.next_request_id;
    process.next_request_id = process.next_request_id.saturating_add(1);
    let request = json!({
        "id": request_id,
        "method": method,
        "params": params
    });
    write_json_line(&mut process.stdin, &request).await?;

    loop {
        let Some(message) = read_next_json_message(&mut process.stdout).await? else {
            return Err(format!("Codex 在响应 {method} 时提前结束"));
        };

        if is_notification(&message) {
            process.buffered_notifications.push_back(message);
            continue;
        }

        if is_server_request(&message) {
            handle_server_request(process, &message).await?;
            continue;
        }

        if !response_matches_id(&message, request_id) {
            continue;
        }

        if let Some(result) = message.get("result") {
            return Ok(result.clone());
        }

        let message_text = message
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Codex 返回未知错误");
        return Err(format!("Codex {method} 失败: {message_text}"));
    }
}

async fn next_notification(process: &mut CodexProcess) -> Result<Option<Value>, String> {
    loop {
        if let Some(message) = process.buffered_notifications.pop_front() {
            return Ok(Some(message));
        }

        let Some(message) = read_next_json_message(&mut process.stdout).await? else {
            return Ok(None);
        };

        if is_notification(&message) {
            return Ok(Some(message));
        }

        if is_server_request(&message) {
            handle_server_request(process, &message).await?;
            continue;
        }
    }
}

async fn handle_server_request(process: &mut CodexProcess, message: &Value) -> Result<(), String> {
    let Some(id) = message.get("id").cloned() else {
        return Ok(());
    };
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let response = json!({
        "id": id,
        "error": {
            "code": -32601,
            "message": format!("ExoMind runtime does not support server request: {method}")
        }
    });
    write_json_line(&mut process.stdin, &response).await
}

async fn write_json_line(stdin: &mut ChildStdin, payload: &Value) -> Result<(), String> {
    let encoded = serde_json::to_string(payload)
        .map_err(|error| format!("Codex JSON 编码失败: {error}"))?;
    stdin
        .write_all(encoded.as_bytes())
        .await
        .map_err(|error| format!("Codex stdin 写入失败: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| format!("Codex stdin 换行写入失败: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Codex stdin flush 失败: {error}"))
}

async fn read_next_json_message(stdout: &mut BufReader<ChildStdout>) -> Result<Option<Value>, String> {
    loop {
        let mut line = String::new();
        let read_bytes = stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("Codex stdout 读取失败: {error}"))?;
        if read_bytes == 0 {
            return Ok(None);
        }

        let normalized = line.trim();
        if normalized.is_empty() {
            continue;
        }

        let message = serde_json::from_str::<Value>(normalized)
            .map_err(|error| format!("Codex JSON 解码失败: {error}; line={normalized}"))?;
        return Ok(Some(message));
    }
}

fn is_notification(message: &Value) -> bool {
    message.get("method").is_some() && message.get("id").is_none()
}

fn is_server_request(message: &Value) -> bool {
    message.get("method").is_some() && message.get("id").is_some()
}

fn response_matches_id(message: &Value, expected_id: u64) -> bool {
    message
        .get("id")
        .and_then(Value::as_u64)
        .map(|value| value == expected_id)
        .unwrap_or(false)
}

fn notification_thread_id(params: &Value) -> Option<&str> {
    params.get("threadId").and_then(Value::as_str)
}

fn build_tool_call_event(params: &Value) -> Option<RuntimeAgentEvent> {
    let item = params.get("item")?;
    let item_type = item.get("type")?.as_str()?;

    match item_type {
        "commandExecution" => Some(RuntimeAgentEvent::ToolCall {
            name: "commandExecution".to_string(),
            payload: Some(json!({
                "command": item.get("command").cloned().unwrap_or(Value::Null),
                "cwd": item.get("cwd").cloned().unwrap_or(Value::Null),
            })),
            session_id: None,
        }),
        "mcpToolCall" => Some(RuntimeAgentEvent::ToolCall {
            name: item
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("mcpToolCall")
                .to_string(),
            payload: Some(json!({
                "server": item.get("server").cloned().unwrap_or(Value::Null),
                "arguments": item.get("arguments").cloned().unwrap_or(Value::Null),
            })),
            session_id: None,
        }),
        _ => None,
    }
}

fn build_tool_result_event(params: &Value) -> Option<RuntimeAgentEvent> {
    let item = params.get("item")?;
    let item_type = item.get("type")?.as_str()?;

    match item_type {
        "commandExecution" => Some(RuntimeAgentEvent::ToolResult {
            name: "commandExecution".to_string(),
            payload: Some(json!({
                "status": item.get("status").cloned().unwrap_or(Value::Null),
                "aggregatedOutput": item.get("aggregatedOutput").cloned().unwrap_or(Value::Null),
                "exitCode": item.get("exitCode").cloned().unwrap_or(Value::Null),
                "durationMs": item.get("durationMs").cloned().unwrap_or(Value::Null),
            })),
            session_id: None,
        }),
        "mcpToolCall" => Some(RuntimeAgentEvent::ToolResult {
            name: item
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("mcpToolCall")
                .to_string(),
            payload: Some(json!({
                "server": item.get("server").cloned().unwrap_or(Value::Null),
                "status": item.get("status").cloned().unwrap_or(Value::Null),
                "result": item.get("result").cloned().unwrap_or(Value::Null),
                "error": item.get("error").cloned().unwrap_or(Value::Null),
            })),
            session_id: None,
        }),
        _ => None,
    }
}
