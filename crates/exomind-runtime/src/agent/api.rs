use super::{Agent, ChatChunk, ChatRequest, SessionInfo};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::stream::{self, BoxStream, StreamExt};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard};
use std::time::Instant;
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
struct ApiChatMessage {
    role: String,
    content: String,
}

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
struct ApiSessionSnapshot {
    session_id: String,
    status: SessionStatus,
    created_at: Instant,
    created_wall: DateTime<Utc>,
    last_active_wall: DateTime<Utc>,
    message_count: u64,
    history: Vec<ApiChatMessage>,
}

impl ApiSessionSnapshot {
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
            history: Vec::new(),
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

#[derive(Debug, Clone)]
pub struct ApiProviderProfile {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: String,
}

/// Managed API agent（运行在 Runtime 中的 API Agent）.
#[derive(Debug, Clone)]
pub struct ApiAgent {
    id: String,
    name: String,
    description: String,
    profile: ApiProviderProfile,
    sessions: Arc<StdMutex<HashMap<String, ApiSessionSnapshot>>>,
    client: reqwest::Client,
}

impl ApiAgent {
    pub fn managed(
        id: impl Into<String>,
        name: Option<String>,
        description: Option<String>,
        profile: ApiProviderProfile,
    ) -> Self {
        let id = id.into();
        let default_name = format!("API Agent ({id})");
        let default_description = format!(
            "通过 {} / {} 提供流式对话（{id}）",
            profile.provider, profile.model
        );

        Self {
            id,
            name: name.unwrap_or(default_name),
            description: description.unwrap_or(default_description),
            profile,
            sessions: Arc::new(StdMutex::new(HashMap::new())),
            client: reqwest::Client::new(),
        }
    }

    fn lock_sessions(&self) -> StdMutexGuard<'_, HashMap<String, ApiSessionSnapshot>> {
        match self.sessions.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn prepare_session(
        &self,
        requested_session_id: Option<&str>,
        message: &str,
    ) -> Result<(String, bool, Vec<ApiChatMessage>), String> {
        let now = Utc::now();
        let mut sessions = self.lock_sessions();

        let session_id = requested_session_id
            .map(ToString::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let is_new = requested_session_id.is_none();

        let snapshot = sessions
            .entry(session_id.clone())
            .or_insert_with(|| ApiSessionSnapshot::new(session_id.clone()));

        if matches!(snapshot.status, SessionStatus::Processing) {
            return Err("API 会话正在处理中，请稍后重试".to_string());
        }

        snapshot.status = SessionStatus::Processing;
        snapshot.last_active_wall = now;
        snapshot.message_count = snapshot.message_count.saturating_add(1);
        snapshot.history.push(ApiChatMessage {
            role: "user".to_string(),
            content: message.to_string(),
        });

        Ok((session_id, is_new, snapshot.history.clone()))
    }

    fn mark_session_idle_with_assistant(
        &self,
        session_id: &str,
        assistant_content: Option<String>,
    ) {
        if let Some(snapshot) = self.lock_sessions().get_mut(session_id) {
            snapshot.status = SessionStatus::Idle;
            snapshot.last_active_wall = Utc::now();
            if let Some(content) = assistant_content.filter(|value| !value.is_empty()) {
                snapshot.history.push(ApiChatMessage {
                    role: "assistant".to_string(),
                    content,
                });
            }
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
        let (session_id, is_new, history) =
            match self.prepare_session(requested_session_id.as_deref(), &request.message) {
                Ok(result) => result,
                Err(message) => {
                    emit_error_chunk(&sender, message).await;
                    return;
                }
            };

        if is_new
            && sender
                .send(ChatChunk {
                    content: String::new(),
                    session_id: Some(session_id.clone()),
                })
                .await
                .is_err()
        {
            self.mark_session_idle_with_assistant(&session_id, None);
            return;
        }

        let stream_result = match self.profile.provider.as_str() {
            "openai" => self.stream_openai_turn(&sender, &history).await,
            "anthropic" => self.stream_anthropic_turn(&sender, &history).await,
            other => Err(format!("不支持的 API provider: {other}")),
        };

        match stream_result {
            Ok(assistant_content) => {
                self.mark_session_idle_with_assistant(&session_id, Some(assistant_content));
            }
            Err(message) => {
                self.mark_session_idle_with_assistant(&session_id, None);
                emit_error_chunk(&sender, message).await;
            }
        }
    }

    async fn stream_openai_turn(
        &self,
        sender: &mpsc::Sender<ChatChunk>,
        history: &[ApiChatMessage],
    ) -> Result<String, String> {
        let url = build_openai_endpoint(self.profile.base_url.as_deref());
        let response = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(AUTHORIZATION, format!("Bearer {}", self.profile.api_key))
            .json(&json!({
                "model": self.profile.model,
                "messages": history,
                "stream": true,
            }))
            .send()
            .await
            .map_err(|error| format!("OpenAI 请求失败: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("OpenAI HTTP {}: {}", status, body));
        }

        let mut assistant_content = String::new();
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();

        while let Some(next) = stream.next().await {
            let bytes = next.map_err(|error| format!("OpenAI 流读取失败: {error}"))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            let events = split_sse_events(&mut buffer);

            for event in events {
                let Some(data) = extract_sse_data(&event) else {
                    continue;
                };
                if data == "[DONE]" {
                    return Ok(assistant_content);
                }
                if let Some(delta) = extract_openai_content_delta(&data) {
                    assistant_content.push_str(&delta);
                    if sender.send(ChatChunk::content_only(delta)).await.is_err() {
                        return Ok(assistant_content);
                    }
                }
            }
        }

        if !buffer.is_empty()
            && let Some(data) = extract_sse_data(&buffer)
            && data != "[DONE]"
            && let Some(delta) = extract_openai_content_delta(&data)
        {
            assistant_content.push_str(&delta);
            let _ = sender.send(ChatChunk::content_only(delta)).await;
        }

        Ok(assistant_content)
    }

    async fn stream_anthropic_turn(
        &self,
        sender: &mpsc::Sender<ChatChunk>,
        history: &[ApiChatMessage],
    ) -> Result<String, String> {
        let url = build_anthropic_endpoint(self.profile.base_url.as_deref());
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.profile.api_key)
                .map_err(|error| format!("Anthropic API key 无效: {error}"))?,
        );
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

        let response = self
            .client
            .post(url)
            .headers(headers)
            .json(&json!({
                "model": self.profile.model,
                "max_tokens": 4096,
                "messages": history,
                "stream": true,
            }))
            .send()
            .await
            .map_err(|error| format!("Anthropic 请求失败: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic HTTP {}: {}", status, body));
        }

        let mut assistant_content = String::new();
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();

        while let Some(next) = stream.next().await {
            let bytes = next.map_err(|error| format!("Anthropic 流读取失败: {error}"))?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            let events = split_sse_events(&mut buffer);

            for event in events {
                let Some(data) = extract_sse_data(&event) else {
                    continue;
                };
                if let Some(delta) = extract_anthropic_content_delta(&data) {
                    assistant_content.push_str(&delta);
                    if sender.send(ChatChunk::content_only(delta)).await.is_err() {
                        return Ok(assistant_content);
                    }
                }
            }
        }

        if !buffer.is_empty()
            && let Some(data) = extract_sse_data(&buffer)
            && let Some(delta) = extract_anthropic_content_delta(&data)
        {
            assistant_content.push_str(&delta);
            let _ = sender.send(ChatChunk::content_only(delta)).await;
        }

        Ok(assistant_content)
    }
}

impl Agent for ApiAgent {
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
            .lock_sessions()
            .values()
            .map(ApiSessionSnapshot::to_session_info)
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }

    fn get_session(&self, session_id: &str) -> Option<SessionInfo> {
        self.lock_sessions()
            .get(session_id)
            .map(ApiSessionSnapshot::to_session_info)
    }

    fn close_session(&self, session_id: &str) -> bool {
        self.lock_sessions().remove(session_id).is_some()
    }
}

fn normalize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_openai_endpoint(base_url: Option<&str>) -> String {
    let base = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn build_anthropic_endpoint(base_url: Option<&str>) -> String {
    let base = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.anthropic.com")
        .trim_end_matches('/');
    if base.ends_with("/v1/messages") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

fn split_sse_events(buffer: &mut String) -> Vec<String> {
    let normalized = buffer.replace("\r\n", "\n");
    let mut events = normalized
        .split("\n\n")
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    let tail = events.pop().unwrap_or_default();
    *buffer = tail;
    events
}

fn extract_sse_data(raw_event: &str) -> Option<String> {
    let chunks = raw_event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if chunks.is_empty() {
        return None;
    }

    Some(chunks.join("\n"))
}

fn extract_openai_content_delta(data: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(data).ok()?;
    parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_anthropic_content_delta(data: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(data).ok()?;
    let event_type = parsed.get("type").and_then(Value::as_str)?;

    match event_type {
        "content_block_delta" => parsed
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        "content_block_start" => parsed
            .get("content_block")
            .and_then(|block| block.get("text"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

async fn emit_error_chunk(sender: &mpsc::Sender<ChatChunk>, message: String) {
    let _ = sender.send(ChatChunk::content_only(message)).await;
}

fn format_utc_iso8601(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}
