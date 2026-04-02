use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use super::api::{ApiProviderProfile, build_anthropic_endpoint, build_openai_endpoint};
use super::tools::eventlog::get_recent_events_tool;
use super::tools::{GET_RECENT_EVENTS_TOOL, ToolDef, ToolRegistry, ToolUse};
use crate::AppState;
use crate::config::types::USER_CONFIG_SCOPE;

const DEFAULT_MAX_TOKENS: u32 = 4096;
const CONFIG_KEY_PROVIDER: &str = "exomind:agentApiProvider";
const CONFIG_KEY_MODEL: &str = "exomind:agentApiModel";
const CONFIG_KEY_BASE_URL: &str = "exomind:agentApiBaseUrl";
const CONFIG_KEY_API_KEY: &str = "exomind:agentApiApiKey";

#[derive(Clone)]
pub struct AgentSessionRuntime {
    pub config_store: Arc<crate::config::ConfigStore>,
    pub eventlog_store: Arc<crate::eventlog::EventLogStore>,
    pub agent_api_session_store: Arc<AgentSessionStore>,
}

impl AgentSessionRuntime {
    pub fn new(
        config_store: Arc<crate::config::ConfigStore>,
        eventlog_store: Arc<crate::eventlog::EventLogStore>,
        agent_api_session_store: Arc<AgentSessionStore>,
    ) -> Self {
        Self {
            config_store,
            eventlog_store,
            agent_api_session_store,
        }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(
            Arc::clone(&state.config_store),
            Arc::clone(&state.eventlog_store),
            Arc::clone(&state.agent_api_session_store),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub tool_name: String,
    pub input: Value,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub session_id: String,
    pub trigger_source: String,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub content: String,
    pub tool_calls: Vec<ToolCallRecord>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone)]
pub enum AgentTrigger {
    Internal { source: String },
    HttpRequest,
}

impl AgentTrigger {
    fn as_str(&self) -> String {
        match self {
            AgentTrigger::Internal { source } => source.clone(),
            AgentTrigger::HttpRequest => "http-request".to_string(),
        }
    }
}

#[derive(Debug, Error)]
pub enum AgentSessionStoreError {
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

enum AgentSessionStoreBackend {
    Memory(RwLock<HashMap<String, AgentSessionRecord>>),
    Sqlite(SqliteAgentSessionStore),
}

pub struct AgentSessionStore {
    backend: AgentSessionStoreBackend,
}

impl Default for AgentSessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentSessionStore {
    pub fn new() -> Self {
        Self {
            backend: AgentSessionStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, AgentSessionStoreError> {
        Ok(Self {
            backend: AgentSessionStoreBackend::Sqlite(SqliteAgentSessionStore::open(path)?),
        })
    }

    pub fn upsert(
        &self,
        record: AgentSessionRecord,
    ) -> Result<AgentSessionRecord, AgentSessionStoreError> {
        match &self.backend {
            AgentSessionStoreBackend::Memory(map) => {
                let mut map = map.write().unwrap();
                map.insert(record.session_id.clone(), record.clone());
                Ok(record)
            }
            AgentSessionStoreBackend::Sqlite(store) => {
                store.upsert(&record)?;
                Ok(record)
            }
        }
    }

    pub fn get(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentSessionRecord>, AgentSessionStoreError> {
        match &self.backend {
            AgentSessionStoreBackend::Memory(map) => {
                Ok(map.read().unwrap().get(session_id).cloned())
            }
            AgentSessionStoreBackend::Sqlite(store) => store.get(session_id),
        }
    }
}

struct SqliteAgentSessionStore {
    connection: Mutex<Connection>,
}

impl SqliteAgentSessionStore {
    fn open(path: &Path) -> Result<Self, AgentSessionStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.init()?;
        Ok(store)
    }

    fn init(&self) -> Result<(), AgentSessionStoreError> {
        let conn = self.connection();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_api_sessions (
                session_id      TEXT PRIMARY KEY,
                trigger_source  TEXT NOT NULL,
                provider        TEXT NOT NULL,
                model           TEXT NOT NULL,
                prompt          TEXT NOT NULL,
                content         TEXT NOT NULL,
                tool_calls_json TEXT NOT NULL DEFAULT '[]',
                status          TEXT NOT NULL DEFAULT 'completed',
                error_message   TEXT,
                created_at      TEXT NOT NULL,
                completed_at    TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_api_sessions_completed_at
                ON agent_api_sessions(completed_at DESC);",
        )?;
        Ok(())
    }

    fn upsert(&self, record: &AgentSessionRecord) -> Result<(), AgentSessionStoreError> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO agent_api_sessions (
                session_id, trigger_source, provider, model, prompt, content,
                tool_calls_json, status, error_message, created_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(session_id) DO UPDATE SET
                trigger_source = excluded.trigger_source,
                provider = excluded.provider,
                model = excluded.model,
                prompt = excluded.prompt,
                content = excluded.content,
                tool_calls_json = excluded.tool_calls_json,
                status = excluded.status,
                error_message = excluded.error_message,
                created_at = excluded.created_at,
                completed_at = excluded.completed_at",
            params![
                record.session_id,
                record.trigger_source,
                record.provider,
                record.model,
                record.prompt,
                record.content,
                serde_json::to_string(&record.tool_calls)?,
                record.status,
                record.error_message,
                record.created_at,
                record.completed_at,
            ],
        )?;
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Option<AgentSessionRecord>, AgentSessionStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT
                session_id, trigger_source, provider, model, prompt, content,
                tool_calls_json, status, error_message, created_at, completed_at
             FROM agent_api_sessions
             WHERE session_id = ?1",
        )?;

        stmt.query_row(params![session_id], map_session_row)
            .optional()
            .map_err(AgentSessionStoreError::from)
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().unwrap()
    }
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSessionRecord> {
    let tool_calls_json: String = row.get(6)?;
    let tool_calls =
        serde_json::from_str::<Vec<ToolCallRecord>>(&tool_calls_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(AgentSessionRecord {
        session_id: row.get(0)?,
        trigger_source: row.get(1)?,
        provider: row.get(2)?,
        model: row.get(3)?,
        prompt: row.get(4)?,
        content: row.get(5)?,
        tool_calls,
        status: row.get(7)?,
        error_message: row.get(8)?,
        created_at: row.get(9)?,
        completed_at: row.get(10)?,
    })
}

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("unsupported tool: {0}")]
    UnsupportedTool(String),
    #[error("invalid provider profile: {0}")]
    InvalidProviderProfile(String),
    #[error("missing runtime config: {0}")]
    MissingRuntimeConfig(String),
    #[error("request failed: {0}")]
    RequestFailed(String),
    #[error("invalid provider response: {0}")]
    InvalidProviderResponse(String),
    #[error("persist session failed: {0}")]
    Persist(#[from] AgentSessionStoreError),
}

pub fn scope_key(profile_id: Option<&str>, user_id: Option<&str>) -> Option<String> {
    profile_id
        .and_then(normalize_optional_text)
        .or_else(|| user_id.and_then(normalize_optional_text))
}

pub fn resolve_provider_profile(
    state: &AppState,
    explicit: Option<ApiProviderProfile>,
) -> Result<ApiProviderProfile, SessionError> {
    resolve_provider_profile_with_runtime(&AgentSessionRuntime::from_state(state), explicit)
}

pub fn resolve_provider_profile_with_runtime(
    runtime: &AgentSessionRuntime,
    explicit: Option<ApiProviderProfile>,
) -> Result<ApiProviderProfile, SessionError> {
    match explicit {
        Some(profile) => normalize_provider_profile(profile),
        None => resolve_provider_profile_from_runtime(runtime),
    }
}

pub fn load_agent_session(
    state: &AppState,
    session_id: &str,
) -> Result<Option<AgentSessionRecord>, SessionError> {
    load_agent_session_with_runtime(&AgentSessionRuntime::from_state(state), session_id)
}

pub fn load_agent_session_with_runtime(
    runtime: &AgentSessionRuntime,
    session_id: &str,
) -> Result<Option<AgentSessionRecord>, SessionError> {
    runtime
        .agent_api_session_store
        .get(session_id)
        .map_err(SessionError::Persist)
}

pub fn build_tool_registry(
    state: &AppState,
    user_id: Option<String>,
    requested_tools: &[String],
) -> Result<ToolRegistry, SessionError> {
    build_tool_registry_for_runtime(&AgentSessionRuntime::from_state(state), user_id, requested_tools)
}

pub fn build_tool_registry_for_runtime(
    runtime: &AgentSessionRuntime,
    user_id: Option<String>,
    requested_tools: &[String],
) -> Result<ToolRegistry, SessionError> {
    let mut registry = ToolRegistry::new();
    for tool_name in requested_tools
        .iter()
        .filter_map(|tool_name| normalize_optional_text(tool_name))
    {
        match tool_name.as_str() {
            GET_RECENT_EVENTS_TOOL => {
                let (def, tool_fn) =
                    get_recent_events_tool(Arc::clone(&runtime.eventlog_store), user_id.clone());
                registry.register(def, tool_fn);
            }
            other => {
                return Err(SessionError::UnsupportedTool(other.to_string()));
            }
        }
    }

    Ok(registry)
}

pub fn resolve_provider_profile_from_config(
    state: &AppState,
) -> Result<ApiProviderProfile, SessionError> {
    resolve_provider_profile_from_runtime(&AgentSessionRuntime::from_state(state))
}

pub fn resolve_provider_profile_from_runtime(
    runtime: &AgentSessionRuntime,
) -> Result<ApiProviderProfile, SessionError> {
    let provider = config_value(runtime, CONFIG_KEY_PROVIDER)?.ok_or_else(|| {
        SessionError::MissingRuntimeConfig(format!("missing config key `{CONFIG_KEY_PROVIDER}`"))
    })?;
    let model = config_value(runtime, CONFIG_KEY_MODEL)?.ok_or_else(|| {
        SessionError::MissingRuntimeConfig(format!("missing config key `{CONFIG_KEY_MODEL}`"))
    })?;
    let api_key = config_value(runtime, CONFIG_KEY_API_KEY)?.ok_or_else(|| {
        SessionError::MissingRuntimeConfig(format!("missing config key `{CONFIG_KEY_API_KEY}`"))
    })?;

    normalize_provider_profile(ApiProviderProfile {
        provider,
        model,
        base_url: config_value(runtime, CONFIG_KEY_BASE_URL)?,
        api_key,
    })
}

pub fn normalize_provider_profile(
    profile: ApiProviderProfile,
) -> Result<ApiProviderProfile, SessionError> {
    let provider = profile.provider.trim().to_ascii_lowercase();
    if provider != "openai" && provider != "anthropic" {
        return Err(SessionError::InvalidProviderProfile(format!(
            "unsupported provider: {}",
            profile.provider
        )));
    }

    let model = profile.model.trim().to_string();
    if model.is_empty() {
        return Err(SessionError::InvalidProviderProfile(
            "model must not be empty".to_string(),
        ));
    }

    let api_key = profile.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(SessionError::InvalidProviderProfile(
            "api_key must not be empty".to_string(),
        ));
    }

    Ok(ApiProviderProfile {
        provider,
        model,
        base_url: profile
            .base_url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        api_key,
    })
}

fn config_value(runtime: &AgentSessionRuntime, key: &str) -> Result<Option<String>, SessionError> {
    Ok(runtime
        .config_store
        .get(USER_CONFIG_SCOPE, key)
        .map_err(|error| SessionError::MissingRuntimeConfig(error.to_string()))?
        .map(|entry| entry.value)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn normalize_optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub async fn run_agent_session(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    user_prompt: String,
    tools: &ToolRegistry,
    trigger: AgentTrigger,
    state: &AppState,
) -> Result<AgentSessionRecord, SessionError> {
    run_agent_session_with_runtime(
        profile,
        system_prompt,
        user_prompt,
        tools,
        trigger,
        &AgentSessionRuntime::from_state(state),
    )
    .await
}

pub async fn run_agent_session_with_runtime(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    user_prompt: String,
    tools: &ToolRegistry,
    trigger: AgentTrigger,
    runtime: &AgentSessionRuntime,
) -> Result<AgentSessionRecord, SessionError> {
    let profile = normalize_provider_profile(profile)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let client = reqwest::Client::new();

    let execution = match profile.provider.as_str() {
        "openai" => {
            run_openai_single_shot(
                &client,
                &profile,
                system_prompt.as_deref(),
                &user_prompt,
                tools,
            )
            .await
        }
        "anthropic" => {
            run_anthropic_single_shot(
                &client,
                &profile,
                system_prompt.as_deref(),
                &user_prompt,
                tools,
            )
            .await
        }
        other => Err(SessionError::InvalidProviderProfile(format!(
            "unsupported provider: {other}"
        ))),
    };

    match execution {
        Ok((content, tool_calls)) => {
            let record = AgentSessionRecord {
                session_id,
                trigger_source: trigger.as_str(),
                provider: profile.provider,
                model: profile.model,
                prompt: user_prompt,
                content,
                tool_calls,
                status: "completed".to_string(),
                error_message: None,
                created_at,
                completed_at: chrono::Utc::now().to_rfc3339(),
            };
            runtime.agent_api_session_store.upsert(record.clone())?;
            Ok(record)
        }
        Err(error) => {
            let record = AgentSessionRecord {
                session_id,
                trigger_source: trigger.as_str(),
                provider: profile.provider,
                model: profile.model,
                prompt: user_prompt,
                content: String::new(),
                tool_calls: Vec::new(),
                status: "failed".to_string(),
                error_message: Some(error.to_string()),
                created_at,
                completed_at: chrono::Utc::now().to_rfc3339(),
            };
            let _ = runtime.agent_api_session_store.upsert(record);
            Err(error)
        }
    }
}

async fn run_openai_single_shot(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    user_prompt: &str,
    tools: &ToolRegistry,
) -> Result<(String, Vec<ToolCallRecord>), SessionError> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = system_prompt.filter(|value| !value.trim().is_empty()) {
        messages.push(json!({
            "role": "system",
            "content": system_prompt,
        }));
    }
    messages.push(json!({
        "role": "user",
        "content": user_prompt,
    }));

    let response = send_openai_request(client, profile, &messages, tools.list_defs()).await?;
    let mut tool_uses = response.tool_uses()?;
    if tool_uses.is_empty() {
        return Ok((response.text_content(), Vec::new()));
    }

    let mut tool_calls = Vec::new();
    messages.push(response.assistant_message_json());
    for tool_use in tool_uses.drain(..) {
        let result = tools.dispatch(&tool_use).await;
        tool_calls.push(ToolCallRecord {
            tool_name: tool_use.name.clone(),
            input: tool_use.input.clone(),
            output: result.content.clone(),
        });
        messages.push(json!({
            "role": "tool",
            "tool_call_id": result.tool_use_id,
            "content": result.content,
        }));
    }

    let final_response = send_openai_request(client, profile, &messages, tools.list_defs()).await?;
    Ok((final_response.text_content(), tool_calls))
}

async fn run_anthropic_single_shot(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    user_prompt: &str,
    tools: &ToolRegistry,
) -> Result<(String, Vec<ToolCallRecord>), SessionError> {
    let mut messages = vec![json!({
        "role": "user",
        "content": [{ "type": "text", "text": user_prompt }],
    })];

    let response =
        send_anthropic_request(client, profile, system_prompt, &messages, tools.list_defs())
            .await?;
    let mut tool_uses = response.tool_uses();
    if tool_uses.is_empty() {
        return Ok((response.text_content(), Vec::new()));
    }

    let mut tool_calls = Vec::new();
    messages.push(json!({
        "role": "assistant",
        "content": response.content,
    }));

    let mut tool_results = Vec::new();
    for tool_use in tool_uses.drain(..) {
        let result = tools.dispatch(&tool_use).await;
        tool_calls.push(ToolCallRecord {
            tool_name: tool_use.name.clone(),
            input: tool_use.input.clone(),
            output: result.content.clone(),
        });
        tool_results.push(json!({
            "type": "tool_result",
            "tool_use_id": result.tool_use_id,
            "content": result.content,
        }));
    }

    messages.push(json!({
        "role": "user",
        "content": tool_results,
    }));

    let final_response =
        send_anthropic_request(client, profile, system_prompt, &messages, tools.list_defs())
            .await?;
    Ok((final_response.text_content(), tool_calls))
}

async fn send_openai_request(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<OpenAiResponseMessage, SessionError> {
    let url = build_openai_endpoint(profile.base_url.as_deref());
    let body = if tools.is_empty() {
        json!({
            "model": profile.model,
            "messages": messages,
            "stream": false,
        })
    } else {
        json!({
            "model": profile.model,
            "messages": messages,
            "tools": tools.iter().map(openai_tool_schema).collect::<Vec<_>>(),
            "tool_choice": "auto",
            "stream": false,
        })
    };

    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", profile.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|error| SessionError::RequestFailed(format!("OpenAI request failed: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(SessionError::RequestFailed(format!(
            "OpenAI HTTP {status}: {body}"
        )));
    }

    let payload: OpenAiResponse = response.json().await.map_err(|error| {
        SessionError::InvalidProviderResponse(format!("invalid OpenAI JSON: {error}"))
    })?;

    payload
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .ok_or_else(|| {
            SessionError::InvalidProviderResponse("OpenAI returned no choices".to_string())
        })
}

async fn send_anthropic_request(
    client: &reqwest::Client,
    profile: &ApiProviderProfile,
    system_prompt: Option<&str>,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<AnthropicResponse, SessionError> {
    let url = build_anthropic_endpoint(profile.base_url.as_deref());
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(&profile.api_key).map_err(|error| {
            SessionError::InvalidProviderProfile(format!("invalid Anthropic API key: {error}"))
        })?,
    );
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

    let body = if tools.is_empty() {
        json!({
            "model": profile.model,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "messages": messages,
            "system": system_prompt,
        })
    } else {
        json!({
            "model": profile.model,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "messages": messages,
            "system": system_prompt,
            "tools": tools.iter().map(anthropic_tool_schema).collect::<Vec<_>>(),
        })
    };

    let response = client
        .post(url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            SessionError::RequestFailed(format!("Anthropic request failed: {error}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(SessionError::RequestFailed(format!(
            "Anthropic HTTP {status}: {body}"
        )));
    }

    response.json().await.map_err(|error| {
        SessionError::InvalidProviderResponse(format!("invalid Anthropic JSON: {error}"))
    })
}

fn openai_tool_schema(def: &ToolDef) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": def.name,
            "description": def.description,
            "parameters": def.input_schema,
        }
    })
}

fn anthropic_tool_schema(def: &ToolDef) -> Value {
    json!({
        "name": def.name,
        "description": def.description,
        "input_schema": def.input_schema,
    })
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OpenAiResponseMessage {
    role: String,
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCall>,
}

impl OpenAiResponseMessage {
    fn text_content(&self) -> String {
        self.content.clone().unwrap_or_default()
    }

    fn tool_uses(&self) -> Result<Vec<ToolUse>, SessionError> {
        self.tool_calls
            .iter()
            .map(|call| {
                let input =
                    serde_json::from_str::<Value>(&call.function.arguments).map_err(|error| {
                        SessionError::InvalidProviderResponse(format!(
                            "invalid OpenAI tool arguments for {}: {error}",
                            call.function.name
                        ))
                    })?;
                Ok(ToolUse {
                    id: call.id.clone(),
                    name: call.function.name.clone(),
                    input,
                })
            })
            .collect()
    }

    fn assistant_message_json(&self) -> Value {
        json!({
            "role": self.role,
            "content": self.content,
            "tool_calls": self.tool_calls,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OpenAiToolCall {
    id: String,
    #[serde(rename = "type")]
    _kind: String,
    function: OpenAiFunctionCall,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OpenAiFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicContentBlock>,
}

impl AnthropicResponse {
    fn text_content(&self) -> String {
        self.content
            .iter()
            .filter_map(|block| match block {
                AnthropicContentBlock::Text { text } => Some(text.as_str()),
                AnthropicContentBlock::ToolUse { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("")
    }

    fn tool_uses(&self) -> Vec<ToolUse> {
        self.content
            .iter()
            .filter_map(|block| match block {
                AnthropicContentBlock::ToolUse { id, name, input } => Some(ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                }),
                AnthropicContentBlock::Text { .. } => None,
            })
            .collect()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::{
        GET_RECENT_EVENTS_TOOL, ToolRegistry, eventlog::get_recent_events_tool,
    };
    use crate::eventlog::{EventLogStore, EventRecord};
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;
    use axum::extract::State;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::Value;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;
    use tokio::net::TcpListener;

    #[derive(Clone)]
    struct MockLlmState {
        calls: Arc<AtomicUsize>,
    }

    async fn openai_mock_handler(
        State(state): State<MockLlmState>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let call_index = state.calls.fetch_add(1, Ordering::SeqCst);
        if call_index == 0 {
            assert_eq!(
                payload["tools"][0]["function"]["name"],
                GET_RECENT_EVENTS_TOOL
            );
            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "get_recent_events",
                                "arguments": "{\"limit\":2}"
                            }
                        }]
                    }
                }]
            }))
        } else {
            assert_eq!(payload["messages"][2]["role"], "tool");
            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "最近两条事件显示你一直在整理 RT Agent API。",
                        "tool_calls": []
                    }
                }]
            }))
        }
    }

    fn test_state_with_store(
        eventlog_store: Arc<EventLogStore>,
        agent_session_store: Arc<AgentSessionStore>,
    ) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "agent-session-test".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            allow_lan_without_auth: false,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            config_store: Arc::new(crate::config::ConfigStore::new()),
            reminder_store: Arc::new(crate::reminder::ReminderStore::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            proposal_store: Arc::new(crate::proposal::ProposalStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
            agent_api_session_store: agent_session_store,
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
                eventlog_store.set_watch_tx(tx.clone());
                tx
            },
            timeblock_store: Arc::new(crate::timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(crate::tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    async fn spawn_openai_mock_server() -> (String, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/chat/completions", post(openai_mock_handler))
            .with_state(MockLlmState {
                calls: Arc::clone(&calls),
            });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}/v1"), calls)
    }

    fn build_registry(eventlog_store: Arc<EventLogStore>) -> ToolRegistry {
        let mut registry = ToolRegistry::new();
        let (def, tool_fn) =
            get_recent_events_tool(eventlog_store, Some("profile-alpha".to_string()));
        registry.register(def, tool_fn);
        registry
    }

    #[tokio::test]
    async fn run_agent_session_executes_tool_and_persists_result() {
        let dir = tempdir().unwrap();
        let eventlog_store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        eventlog_store
            .append_event(
                Some("profile-alpha"),
                EventRecord {
                    id: "evt-1".to_string(),
                    timestamp: 1,
                    content: "分析最近两条事件".to_string(),
                    tags: vec!["analysis".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        eventlog_store
            .append_event(
                Some("profile-alpha"),
                EventRecord {
                    id: "evt-2".to_string(),
                    timestamp: 2,
                    content: "实现 agent session 路由".to_string(),
                    tags: vec!["code".to_string()],
                    metadata: None,
                },
            )
            .unwrap();

        let sqlite_path = dir.path().join("sessions.sqlite");
        let agent_session_store =
            Arc::new(AgentSessionStore::with_sqlite_path(&sqlite_path).unwrap());
        let state = test_state_with_store(
            Arc::clone(&eventlog_store),
            Arc::clone(&agent_session_store),
        );
        let registry = build_registry(Arc::clone(&eventlog_store));
        let (base_url, calls) = spawn_openai_mock_server().await;

        let result = run_agent_session(
            ApiProviderProfile {
                provider: "openai".to_string(),
                model: "gpt-test".to_string(),
                base_url: Some(base_url),
                api_key: "sk-test".to_string(),
            },
            Some("你是 RT 分析助手".to_string()),
            "请总结我最近在做什么".to_string(),
            &registry,
            AgentTrigger::HttpRequest,
            &state,
        )
        .await
        .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(result.status, "completed");
        assert_eq!(result.tool_calls.len(), 1);
        assert!(result.content.contains("整理 RT Agent API"));

        let persisted = agent_session_store
            .get(&result.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(persisted.tool_calls[0].tool_name, GET_RECENT_EVENTS_TOOL);
        assert_eq!(persisted.status, "completed");
    }

    #[test]
    fn normalize_provider_profile_rejects_missing_api_key() {
        let error = normalize_provider_profile(ApiProviderProfile {
            provider: "openai".to_string(),
            model: "gpt-test".to_string(),
            base_url: None,
            api_key: " ".to_string(),
        })
        .unwrap_err();

        assert!(error.to_string().contains("api_key must not be empty"));
    }
}
