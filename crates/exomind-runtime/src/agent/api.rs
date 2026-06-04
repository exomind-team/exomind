use super::tools::{ToolDef, ToolResult, ToolUse};
use super::{Agent, ChatChunk, ChatRequest, SessionInfo};
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::stream::{self, BoxStream, StreamExt};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
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
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderProfile {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderConversationTurn {
    User {
        text: String,
    },
    Assistant {
        text: Option<String>,
        tool_uses: Vec<ToolUse>,
    },
    ToolResults {
        results: Vec<ToolResult>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderCompletion {
    pub text: String,
    pub tool_uses: Vec<ToolUse>,
    pub stop_reason: Option<String>,
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

pub async fn complete_turn_with_tools(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    history: &[ProviderConversationTurn],
    tools: &[ToolDef],
) -> Result<ProviderCompletion, String> {
    match profile.provider.as_str() {
        "openai" => complete_openai_turn(client, profile, system_prompt, history, tools).await,
        "anthropic" => {
            complete_anthropic_turn(client, profile, system_prompt, history, tools).await
        }
        other => Err(format!("不支持的 API provider: {other}")),
    }
}

async fn complete_openai_turn(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    history: &[ProviderConversationTurn],
    tools: &[ToolDef],
) -> Result<ProviderCompletion, String> {
    let mut messages = build_openai_messages(history);
    if let Some(system_prompt) = system_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        messages.insert(0, json!({ "role": "system", "content": system_prompt }));
    }

    let mut body = json!({
        "model": profile.model,
        "messages": messages,
        "stream": false,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(build_openai_tool_defs(tools));
    }

    let response = client
        .post(build_openai_endpoint(profile.base_url.as_deref()))
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", profile.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OpenAI 请求失败: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("OpenAI 响应读取失败: {error}"))?;
    if !status.is_success() {
        return Err(format!("OpenAI HTTP {}: {}", status, body));
    }

    parse_openai_completion_body(&body)
}

async fn complete_anthropic_turn(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    history: &[ProviderConversationTurn],
    tools: &[ToolDef],
) -> Result<ProviderCompletion, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(&profile.api_key)
            .map_err(|error| format!("Anthropic API key 无效: {error}"))?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

    let mut body = json!({
        "model": profile.model,
        "max_tokens": 4096,
        "messages": build_anthropic_messages(history),
        "stream": false,
    });
    if let Some(system_prompt) = system_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["system"] = Value::String(system_prompt.to_string());
    }
    if !tools.is_empty() {
        body["tools"] = Value::Array(build_anthropic_tool_defs(tools));
    }

    let response = client
        .post(build_anthropic_endpoint(profile.base_url.as_deref()))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Anthropic 请求失败: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Anthropic 响应读取失败: {error}"))?;
    if !status.is_success() {
        return Err(format!("Anthropic HTTP {}: {}", status, body));
    }

    let parsed: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Anthropic 响应解析失败: {error}; body={body}"))?;
    parse_anthropic_completion(&parsed)
}

fn normalize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn build_openai_endpoint(base_url: Option<&str>) -> String {
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

pub(crate) fn build_anthropic_endpoint(base_url: Option<&str>) -> String {
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

fn build_openai_messages(history: &[ProviderConversationTurn]) -> Vec<Value> {
    let mut messages = Vec::new();
    for turn in history {
        match turn {
            ProviderConversationTurn::User { text } => {
                messages.push(json!({ "role": "user", "content": text }));
            }
            ProviderConversationTurn::Assistant { text, tool_uses } => {
                let content = text
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null);
                let mut message = json!({
                    "role": "assistant",
                    "content": content,
                });
                if !tool_uses.is_empty() {
                    message["tool_calls"] =
                        Value::Array(tool_uses.iter().map(build_openai_tool_call).collect());
                }
                messages.push(message);
            }
            ProviderConversationTurn::ToolResults { results } => {
                for result in results {
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": result.tool_use_id,
                        "content": result.content,
                    }));
                }
            }
        }
    }
    messages
}

fn build_anthropic_messages(history: &[ProviderConversationTurn]) -> Vec<Value> {
    let mut messages = Vec::new();
    for turn in history {
        match turn {
            ProviderConversationTurn::User { text } => {
                messages.push(json!({
                    "role": "user",
                    "content": [{ "type": "text", "text": text }],
                }));
            }
            ProviderConversationTurn::Assistant { text, tool_uses } => {
                let mut content = Vec::new();
                if let Some(text) = text
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    content.push(json!({ "type": "text", "text": text }));
                }
                content.extend(tool_uses.iter().map(|tool_use| {
                    json!({
                        "type": "tool_use",
                        "id": tool_use.id,
                        "name": tool_use.name,
                        "input": tool_use.input,
                    })
                }));
                messages.push(json!({
                    "role": "assistant",
                    "content": content,
                }));
            }
            ProviderConversationTurn::ToolResults { results } => {
                let content = results
                    .iter()
                    .map(|result| {
                        json!({
                            "type": "tool_result",
                            "tool_use_id": result.tool_use_id,
                            "content": result.content,
                        })
                    })
                    .collect::<Vec<_>>();
                messages.push(json!({
                    "role": "user",
                    "content": content,
                }));
            }
        }
    }
    messages
}

fn build_openai_tool_defs(tools: &[ToolDef]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect()
}

fn build_anthropic_tool_defs(tools: &[ToolDef]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect()
}

fn build_openai_tool_call(tool_use: &ToolUse) -> Value {
    json!({
        "id": tool_use.id,
        "type": "function",
        "function": {
            "name": tool_use.name,
            "arguments": tool_use.input.to_string(),
        }
    })
}

fn parse_openai_completion(parsed: &Value) -> Result<ProviderCompletion, String> {
    let choice = parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| "OpenAI 响应缺少 choices[0]".to_string())?;
    let message = choice
        .get("message")
        .ok_or_else(|| "OpenAI 响应缺少 message".to_string())?;
    Ok(ProviderCompletion {
        text: extract_openai_message_text(message),
        tool_uses: parse_openai_tool_calls(message)?,
        stop_reason: choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn parse_openai_completion_body(body: &str) -> Result<ProviderCompletion, String> {
    match serde_json::from_str::<Value>(body) {
        Ok(parsed) => parse_openai_completion(&parsed),
        Err(json_error) => parse_openai_sse_completion(body).map_err(|sse_error| {
            format!("OpenAI 响应解析失败: {json_error}; sse_error={sse_error}; body={body}")
        }),
    }
}

fn parse_openai_sse_completion(body: &str) -> Result<ProviderCompletion, String> {
    #[derive(Default)]
    struct PartialToolCall {
        id: Option<String>,
        name: Option<String>,
        arguments: String,
    }

    let mut buffer = body.to_string();
    let mut text = String::new();
    let mut stop_reason = None;
    let mut tool_calls = BTreeMap::<usize, PartialToolCall>::new();
    let mut saw_choice_payload = false;

    for event in split_sse_events(&mut buffer) {
        let Some(data) = extract_sse_data(&event) else {
            continue;
        };
        if data == "[DONE]" {
            break;
        }

        let parsed: Value = serde_json::from_str(&data)
            .map_err(|error| format!("OpenAI SSE 事件解析失败: {error}; data={data}"))?;
        let Some(choices) = parsed.get("choices").and_then(Value::as_array) else {
            continue;
        };
        if choices.is_empty() {
            continue;
        }
        saw_choice_payload = true;

        for choice in choices {
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                stop_reason = Some(reason.to_string());
            }

            let Some(delta) = choice.get("delta") else {
                continue;
            };
            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                text.push_str(content);
            }
            if let Some(delta_tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for delta_tool_call in delta_tool_calls {
                    let index = delta_tool_call
                        .get("index")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize;
                    let entry = tool_calls.entry(index).or_default();
                    if let Some(id) = delta_tool_call.get("id").and_then(Value::as_str) {
                        entry.id = Some(id.to_string());
                    }
                    if let Some(function) = delta_tool_call.get("function") {
                        if let Some(name) = function.get("name").and_then(Value::as_str) {
                            entry.name = Some(name.to_string());
                        }
                        if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                            entry.arguments.push_str(arguments);
                        }
                    }
                }
            }
        }
    }

    if !buffer.trim().is_empty() {
        let data = extract_sse_data(&buffer)
            .ok_or_else(|| format!("OpenAI SSE 尾块缺少 data 字段: {buffer}"))?;
        if data != "[DONE]" {
            let parsed: Value = serde_json::from_str(&data)
                .map_err(|error| format!("OpenAI SSE 尾块解析失败: {error}; data={data}"))?;
            let Some(choices) = parsed.get("choices").and_then(Value::as_array) else {
                return Err(format!("OpenAI SSE 尾块缺少 choices: {data}"));
            };
            if !choices.is_empty() {
                saw_choice_payload = true;
                for choice in choices {
                    if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                        stop_reason = Some(reason.to_string());
                    }
                    if let Some(delta) = choice.get("delta") {
                        if let Some(content) = delta.get("content").and_then(Value::as_str) {
                            text.push_str(content);
                        }
                    }
                }
            }
        }
    }

    if !saw_choice_payload {
        return Err("OpenAI SSE 响应未提供可解析的 choices".to_string());
    }

    let mut parsed_tool_uses = Vec::with_capacity(tool_calls.len());
    for (_, partial) in tool_calls {
        let id = partial
            .id
            .ok_or_else(|| "OpenAI SSE tool_call 缺少 id".to_string())?;
        let name = partial
            .name
            .ok_or_else(|| "OpenAI SSE tool_call 缺少 function.name".to_string())?;
        let input = if partial.arguments.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&partial.arguments)
                .map_err(|error| format!("OpenAI SSE tool arguments 解析失败: {error}"))?
        };
        parsed_tool_uses.push(ToolUse { id, name, input });
    }

    Ok(ProviderCompletion {
        text,
        tool_uses: parsed_tool_uses,
        stop_reason,
    })
}

fn parse_anthropic_completion(parsed: &Value) -> Result<ProviderCompletion, String> {
    let content = parsed
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "Anthropic 响应缺少 content[]".to_string())?;
    let mut text_parts = Vec::new();
    let mut tool_uses = Vec::new();

    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_parts.push(text.to_string());
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Anthropic tool_use 缺少 id".to_string())?;
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Anthropic tool_use 缺少 name".to_string())?;
                let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                tool_uses.push(ToolUse {
                    id: id.to_string(),
                    name: name.to_string(),
                    input,
                });
            }
            _ => {}
        }
    }

    Ok(ProviderCompletion {
        text: text_parts.join(""),
        tool_uses,
        stop_reason: parsed
            .get("stop_reason")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
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

fn extract_openai_message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn parse_openai_tool_calls(message: &Value) -> Result<Vec<ToolUse>, String> {
    let Some(tool_calls) = message.get("tool_calls") else {
        return Ok(Vec::new());
    };
    if tool_calls.is_null() {
        return Ok(Vec::new());
    }
    let array = tool_calls
        .as_array()
        .ok_or_else(|| format!("OpenAI tool_calls 必须是数组或 null: {tool_calls}"))?;
    let mut parsed = Vec::with_capacity(array.len());
    for tool_call in array {
        let id = tool_call
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "OpenAI tool_call 缺少 id".to_string())?;
        let function = tool_call
            .get("function")
            .ok_or_else(|| "OpenAI tool_call 缺少 function".to_string())?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "OpenAI tool_call 缺少 function.name".to_string())?;
        let arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let input = if arguments.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(arguments)
                .map_err(|error| format!("OpenAI tool arguments 解析失败: {error}"))?
        };
        parsed.push(ToolUse {
            id: id.to_string(),
            name: name.to_string(),
            input,
        });
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use axum::response::Response;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::Value;
    use tokio::net::TcpListener;

    #[test]
    fn parse_openai_completion_collects_text_and_tool_calls() {
        let parsed = json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": "先看一下近期事件。",
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "get_recent_events",
                            "arguments": "{\"limit\":2}"
                        }
                    }]
                }
            }]
        });

        let completion = parse_openai_completion(&parsed).unwrap();
        assert_eq!(completion.text, "先看一下近期事件。");
        assert_eq!(completion.tool_uses.len(), 1);
        assert_eq!(completion.tool_uses[0].name, "get_recent_events");
        assert_eq!(completion.tool_uses[0].input["limit"], 2);
    }

    #[test]
    fn parse_openai_completion_treats_null_tool_calls_as_empty() {
        let parsed = json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": "已经完成处理。",
                    "tool_calls": null
                }
            }]
        });

        let completion = parse_openai_completion(&parsed).unwrap();
        assert_eq!(completion.text, "已经完成处理。");
        assert!(completion.tool_uses.is_empty());
        assert_eq!(completion.stop_reason.as_deref(), Some("stop"));
    }

    async fn sse_completion_handler(Json(payload): Json<Value>) -> Response {
        assert_eq!(payload["stream"], false);
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"今天\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"是阴天，气温21.45度\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";
        Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/event-stream")
            .body(Body::from(body))
            .unwrap()
    }

    async fn sse_tool_call_completion_handler(Json(payload): Json<Value>) -> Response {
        assert_eq!(payload["stream"], false);
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-weather\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"\"}}]}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"date\\\":\\\"today\\\"}\"}}]}}]}\n\n\
data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n\
data: [DONE]\n\n";
        Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/event-stream")
            .body(Body::from(body))
            .unwrap()
    }

    async fn spawn_completion_test_server(path: &'static str) -> String {
        let app = Router::new()
            .route("/chat/completions", post(sse_completion_handler))
            .route(
                "/tool/chat/completions",
                post(sse_tool_call_completion_handler),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{addr}{path}")
    }

    #[tokio::test]
    async fn complete_openai_turn_accepts_sse_text_body_when_stream_is_false() {
        let client = reqwest::Client::new();
        let completion = complete_openai_turn(
            &client,
            &ApiProviderProfile {
                provider: "openai".to_string(),
                model: "gpt-test".to_string(),
                base_url: Some(spawn_completion_test_server("").await),
                api_key: "sk-test".to_string(),
            },
            None,
            &[ProviderConversationTurn::User {
                text: "今天是什么天气".to_string(),
            }],
            &[],
        )
        .await
        .unwrap();

        assert_eq!(completion.text, "今天是阴天，气温21.45度");
        assert!(completion.tool_uses.is_empty());
        assert_eq!(completion.stop_reason.as_deref(), Some("stop"));
    }

    #[tokio::test]
    async fn complete_openai_turn_accepts_sse_tool_call_body_when_stream_is_false() {
        let client = reqwest::Client::new();
        let completion = complete_openai_turn(
            &client,
            &ApiProviderProfile {
                provider: "openai".to_string(),
                model: "gpt-test".to_string(),
                base_url: Some(spawn_completion_test_server("/tool").await),
                api_key: "sk-test".to_string(),
            },
            None,
            &[ProviderConversationTurn::User {
                text: "今天是什么天气".to_string(),
            }],
            &[ToolDef {
                name: "get_weather".to_string(),
                description: "返回天气".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "date": { "type": "string" }
                    }
                }),
            }],
        )
        .await
        .unwrap();

        assert_eq!(completion.text, "");
        assert_eq!(completion.tool_uses.len(), 1);
        assert_eq!(completion.tool_uses[0].id, "call-weather");
        assert_eq!(completion.tool_uses[0].name, "get_weather");
        assert_eq!(completion.tool_uses[0].input["date"], "today");
        assert_eq!(completion.stop_reason.as_deref(), Some("tool_calls"));
    }

    #[test]
    fn build_anthropic_messages_keeps_tool_results_in_user_turn() {
        let messages = build_anthropic_messages(&[
            ProviderConversationTurn::User {
                text: "分析最近事件".to_string(),
            },
            ProviderConversationTurn::Assistant {
                text: Some("我先读取一下。".to_string()),
                tool_uses: vec![ToolUse {
                    id: "tool-1".to_string(),
                    name: "get_recent_events".to_string(),
                    input: json!({ "limit": 2 }),
                }],
            },
            ProviderConversationTurn::ToolResults {
                results: vec![ToolResult {
                    tool_use_id: "tool-1".to_string(),
                    content: "event 1".to_string(),
                }],
            },
        ]);

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][1]["type"], "tool_use");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
    }
}
