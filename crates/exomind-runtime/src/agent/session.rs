use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use super::api::ApiProviderProfile;
use super::broker::{
    AgentTurnBroker, AgentTurnRequest, AgentTurnResult, AssistantTurn,
    BrokerError as AgentBrokerError, ToolCall as BrokerToolCall, ToolDef as BrokerToolDef,
    TurnItem,
};
use super::proposal_tools::proposal_tool_defs;
use super::tools::eventlog::get_recent_events_tool;
use crate::AppState;
use crate::config::types::USER_CONFIG_SCOPE;
use crate::proposal::ProposalStore;

const CONFIG_KEY_PROVIDER: &str = "exomind:agentApiProvider";
const CONFIG_KEY_MODEL: &str = "exomind:agentApiModel";
const CONFIG_KEY_BASE_URL: &str = "exomind:agentApiBaseUrl";
const CONFIG_KEY_API_KEY: &str = "exomind:agentApiApiKey";
pub const TOOL_PRESET_PROPOSAL_TOOLS: &str = "proposal_tools";
pub const TOOL_PRESET_RECENT_EVENTS: &str = "recent_events";

#[derive(Clone)]
pub struct AgentSessionRuntime {
    pub config_store: Arc<crate::config::ConfigStore>,
    pub eventlog_store: Arc<crate::eventlog::EventLogStore>,
    pub proposal_store: Arc<ProposalStore>,
    pub agent_api_session_store: Arc<AgentSessionStore>,
}

impl AgentSessionRuntime {
    pub fn new(
        config_store: Arc<crate::config::ConfigStore>,
        eventlog_store: Arc<crate::eventlog::EventLogStore>,
        proposal_store: Arc<ProposalStore>,
        agent_api_session_store: Arc<AgentSessionStore>,
    ) -> Self {
        Self {
            config_store,
            eventlog_store,
            proposal_store,
            agent_api_session_store,
        }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(
            Arc::clone(&state.config_store),
            Arc::clone(&state.eventlog_store),
            Arc::clone(&state.proposal_store),
            Arc::clone(&state.agent_api_session_store),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub tool_name: String,
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub session_id: String,
    pub trigger_source: String,
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub content: String,
    pub assistant_turn: AssistantTurn,
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
                assistant_turn_json TEXT NOT NULL DEFAULT '{\"content\":\"\",\"toolCalls\":[]}',
                tool_calls_json TEXT NOT NULL DEFAULT '[]',
                status          TEXT NOT NULL DEFAULT 'completed',
                error_message   TEXT,
                created_at      TEXT NOT NULL,
                completed_at    TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_agent_api_sessions_completed_at
                ON agent_api_sessions(completed_at DESC);",
        )?;
        ensure_column(
            &conn,
            "agent_api_sessions",
            "assistant_turn_json",
            "TEXT NOT NULL DEFAULT '{\"content\":\"\",\"toolCalls\":[]}'",
        )?;
        Ok(())
    }

    fn upsert(&self, record: &AgentSessionRecord) -> Result<(), AgentSessionStoreError> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO agent_api_sessions (
                session_id, trigger_source, provider, model, prompt, content,
                assistant_turn_json, tool_calls_json, status, error_message, created_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(session_id) DO UPDATE SET
                trigger_source = excluded.trigger_source,
                provider = excluded.provider,
                model = excluded.model,
                prompt = excluded.prompt,
                content = excluded.content,
                assistant_turn_json = excluded.assistant_turn_json,
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
                record.prompt.clone().unwrap_or_default(),
                record.content,
                serde_json::to_string(&record.assistant_turn)?,
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
                assistant_turn_json, tool_calls_json, status, error_message, created_at, completed_at
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
    let assistant_turn_json: String = row.get(6)?;
    let assistant_turn =
        serde_json::from_str::<AssistantTurn>(&assistant_turn_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let tool_calls_json: String = row.get(7)?;
    let tool_calls =
        serde_json::from_str::<Vec<ToolCallRecord>>(&tool_calls_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let prompt: String = row.get(4)?;
    let prompt = normalize_optional_text(&prompt);
    Ok(AgentSessionRecord {
        session_id: row.get(0)?,
        trigger_source: row.get(1)?,
        provider: row.get(2)?,
        model: row.get(3)?,
        prompt,
        content: row.get(5)?,
        assistant_turn,
        tool_calls,
        status: row.get(8)?,
        error_message: row.get(9)?,
        created_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), AgentSessionStoreError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let existing = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if existing.iter().any(|name| name == column) {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
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

impl From<AgentBrokerError> for SessionError {
    fn from(error: AgentBrokerError) -> Self {
        match error {
            AgentBrokerError::InvalidRequest(message) => SessionError::InvalidRequest(message),
            AgentBrokerError::ProviderRequest(message) => SessionError::RequestFailed(message),
        }
    }
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

pub fn resolve_agent_tools(
    state: &AppState,
    explicit_tools: Vec<BrokerToolDef>,
    presets: &[String],
    scope_key: Option<String>,
) -> Result<Vec<BrokerToolDef>, SessionError> {
    resolve_agent_tools_for_runtime(
        &AgentSessionRuntime::from_state(state),
        explicit_tools,
        presets,
        scope_key,
    )
}

pub fn resolve_agent_tools_for_runtime(
    runtime: &AgentSessionRuntime,
    explicit_tools: Vec<BrokerToolDef>,
    presets: &[String],
    scope_key: Option<String>,
) -> Result<Vec<BrokerToolDef>, SessionError> {
    let mut seen_presets = HashSet::new();
    let mut resolved_tools = explicit_tools;
    for preset in presets {
        let key = normalize_optional_text(preset).ok_or_else(|| {
            SessionError::InvalidRequest("preset key must not be empty".to_string())
        })?;
        if !seen_presets.insert(key.clone()) {
            return Err(SessionError::InvalidRequest(format!(
                "duplicate preset: {key}"
            )));
        }

        let mut preset_tools = expand_tool_preset(runtime, &key, scope_key.clone())?;
        resolved_tools.append(&mut preset_tools);
    }

    validate_unique_tool_names(&resolved_tools)?;
    Ok(resolved_tools)
}

fn expand_tool_preset(
    runtime: &AgentSessionRuntime,
    preset: &str,
    scope_key: Option<String>,
) -> Result<Vec<BrokerToolDef>, SessionError> {
    match preset {
        TOOL_PRESET_PROPOSAL_TOOLS => {
            let scope_key = require_scope_key(preset, scope_key)?;
            let _ = scope_key;
            Ok(proposal_tool_defs())
        }
        TOOL_PRESET_RECENT_EVENTS => {
            let scope_key = require_scope_key(preset, scope_key)?;
            Ok(vec![recent_events_tool_def(runtime, scope_key)])
        }
        other => Err(SessionError::InvalidRequest(format!(
            "unknown preset: {other}"
        ))),
    }
}

fn require_scope_key(preset: &str, scope_key: Option<String>) -> Result<String, SessionError> {
    normalize_optional_text(scope_key.as_deref().unwrap_or_default()).ok_or_else(|| {
        SessionError::InvalidRequest(format!(
            "scope_key is required for preset `{preset}`"
        ))
    })
}

fn recent_events_tool_def(
    runtime: &AgentSessionRuntime,
    scope_key: String,
) -> BrokerToolDef {
    let (def, _) = get_recent_events_tool(Arc::clone(&runtime.eventlog_store), Some(scope_key));
    let mut input_schema = def.input_schema;
    if let Some(limit) = input_schema
        .get_mut("properties")
        .and_then(|properties| properties.get_mut("limit"))
    {
        limit["default"] = json!(10);
        if let Some(description) = limit.get_mut("description") {
            *description = json!("返回条数，默认 10，最大 100");
        }
    }

    BrokerToolDef {
        name: def.name,
        description: def.description,
        input_schema,
    }
}

fn validate_unique_tool_names(tools: &[BrokerToolDef]) -> Result<(), SessionError> {
    let mut seen = HashSet::new();
    for tool in tools {
        let name = normalize_optional_text(&tool.name).ok_or_else(|| {
            SessionError::InvalidRequest("tool name must not be empty".to_string())
        })?;
        if !seen.insert(name.clone()) {
            return Err(SessionError::InvalidRequest(format!(
                "duplicate tool name: {name}"
            )));
        }
    }
    Ok(())
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

fn empty_assistant_turn() -> AssistantTurn {
    AssistantTurn {
        content: String::new(),
        tool_calls: Vec::new(),
    }
}

fn map_broker_tool_call(tool_call: &BrokerToolCall) -> ToolCallRecord {
    ToolCallRecord {
        tool_name: tool_call.name.clone(),
        input: tool_call.input.clone(),
        output: None,
    }
}

fn record_from_broker_result(
    session_id: String,
    trigger: AgentTrigger,
    profile: &ApiProviderProfile,
    prompt: Option<String>,
    created_at: String,
    result: AgentTurnResult,
) -> AgentSessionRecord {
    match result {
        AgentTurnResult::Final { assistant_turn } => AgentSessionRecord {
            session_id,
            trigger_source: trigger.as_str(),
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            prompt,
            content: assistant_turn.content.clone(),
            assistant_turn,
            tool_calls: Vec::new(),
            status: "completed".to_string(),
            error_message: None,
            created_at,
            completed_at: chrono::Utc::now().to_rfc3339(),
        },
        AgentTurnResult::NeedsToolCalls {
            assistant_turn,
            tool_calls,
        } => AgentSessionRecord {
            session_id,
            trigger_source: trigger.as_str(),
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            prompt,
            content: assistant_turn.content.clone(),
            assistant_turn,
            tool_calls: tool_calls.iter().map(map_broker_tool_call).collect(),
            status: "needs_tool_calls".to_string(),
            error_message: None,
            created_at,
            completed_at: chrono::Utc::now().to_rfc3339(),
        },
    }
}

fn failed_record(
    session_id: String,
    trigger: AgentTrigger,
    profile: &ApiProviderProfile,
    prompt: Option<String>,
    created_at: String,
    error_message: String,
) -> AgentSessionRecord {
    AgentSessionRecord {
        session_id,
        trigger_source: trigger.as_str(),
        provider: profile.provider.clone(),
        model: profile.model.clone(),
        prompt,
        content: String::new(),
        assistant_turn: empty_assistant_turn(),
        tool_calls: Vec::new(),
        status: "failed".to_string(),
        error_message: Some(error_message),
        created_at,
        completed_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub async fn run_broker_agent_session(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    tools: Vec<BrokerToolDef>,
    history: Vec<TurnItem>,
    new_user_message: Option<String>,
    trigger: AgentTrigger,
    state: &AppState,
) -> Result<AgentSessionRecord, SessionError> {
    run_broker_agent_session_with_runtime(
        profile,
        system_prompt,
        tools,
        history,
        new_user_message,
        trigger,
        &AgentSessionRuntime::from_state(state),
    )
    .await
}

pub async fn run_broker_agent_session_from_sources(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    explicit_tools: Vec<BrokerToolDef>,
    presets: &[String],
    scope_key: Option<String>,
    history: Vec<TurnItem>,
    new_user_message: Option<String>,
    trigger: AgentTrigger,
    state: &AppState,
) -> Result<AgentSessionRecord, SessionError> {
    run_broker_agent_session_from_sources_with_runtime(
        profile,
        system_prompt,
        explicit_tools,
        presets,
        scope_key,
        history,
        new_user_message,
        trigger,
        &AgentSessionRuntime::from_state(state),
    )
    .await
}

pub async fn run_broker_agent_session_from_sources_with_runtime(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    explicit_tools: Vec<BrokerToolDef>,
    presets: &[String],
    scope_key: Option<String>,
    history: Vec<TurnItem>,
    new_user_message: Option<String>,
    trigger: AgentTrigger,
    runtime: &AgentSessionRuntime,
) -> Result<AgentSessionRecord, SessionError> {
    let tools = resolve_agent_tools_for_runtime(runtime, explicit_tools, presets, scope_key)?;
    run_broker_agent_session_with_runtime(
        profile,
        system_prompt,
        tools,
        history,
        new_user_message,
        trigger,
        runtime,
    )
    .await
}

pub async fn run_broker_agent_session_with_runtime(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    tools: Vec<BrokerToolDef>,
    history: Vec<TurnItem>,
    new_user_message: Option<String>,
    trigger: AgentTrigger,
    runtime: &AgentSessionRuntime,
) -> Result<AgentSessionRecord, SessionError> {
    let profile = normalize_provider_profile(profile)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let broker = AgentTurnBroker;
    let prompt = new_user_message.clone();

    let request = AgentTurnRequest {
        provider: profile.clone(),
        system_prompt,
        tools,
        history,
        new_user_message,
    };

    match broker.run(request).await {
        Ok(result) => {
            let record = record_from_broker_result(
                session_id, trigger, &profile, prompt, created_at, result,
            );
            runtime.agent_api_session_store.upsert(record.clone())?;
            Ok(record)
        }
        Err(error) => {
            let record = failed_record(
                session_id,
                trigger,
                &profile,
                prompt,
                created_at,
                error.to_string(),
            );
            let _ = runtime.agent_api_session_store.upsert(record);
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::GET_RECENT_EVENTS_TOOL;
    use crate::eventlog::EventLogStore;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn weather_tool_def() -> BrokerToolDef {
        BrokerToolDef {
            name: "get_weather".to_string(),
            description: "获取天气".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        }
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

    #[test]
    fn resolve_requested_tools_expands_recent_events_preset_with_default_limit() {
        let dir = tempdir().unwrap();
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(dir.path().to_path_buf())),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::new(AgentSessionStore::new()),
        );

        let tools = resolve_agent_tools_for_runtime(
            &runtime,
            Vec::new(),
            &[TOOL_PRESET_RECENT_EVENTS.to_string()],
            Some("profile-alpha".to_string()),
        )
        .unwrap();

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, GET_RECENT_EVENTS_TOOL);
        assert_eq!(tools[0].input_schema["properties"]["limit"]["default"], 10);
    }

    #[test]
    fn resolve_requested_tools_merges_explicit_tools_with_presets() {
        let dir = tempdir().unwrap();
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(dir.path().to_path_buf())),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::new(AgentSessionStore::new()),
        );

        let tools = resolve_agent_tools_for_runtime(
            &runtime,
            vec![weather_tool_def()],
            &[TOOL_PRESET_RECENT_EVENTS.to_string()],
            Some("profile-alpha".to_string()),
        )
        .unwrap();

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "get_weather");
        assert_eq!(tools[1].name, GET_RECENT_EVENTS_TOOL);
    }

    #[test]
    fn resolve_requested_tools_rejects_missing_scope_key_for_runtime_preset() {
        let dir = tempdir().unwrap();
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(dir.path().to_path_buf())),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::new(AgentSessionStore::new()),
        );

        let error = resolve_agent_tools_for_runtime(
            &runtime,
            Vec::new(),
            &[TOOL_PRESET_RECENT_EVENTS.to_string()],
            None,
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("scope_key is required for preset"));
    }

    #[test]
    fn resolve_requested_tools_rejects_duplicate_preset_keys() {
        let dir = tempdir().unwrap();
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(dir.path().to_path_buf())),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::new(AgentSessionStore::new()),
        );

        let error = resolve_agent_tools_for_runtime(
            &runtime,
            Vec::new(),
            &[
                TOOL_PRESET_RECENT_EVENTS.to_string(),
                TOOL_PRESET_RECENT_EVENTS.to_string(),
            ],
            Some("profile-alpha".to_string()),
        )
        .unwrap_err();

        assert!(error.to_string().contains("duplicate preset"));
    }

    #[test]
    fn resolve_requested_tools_rejects_duplicate_final_tool_names_across_tools_and_presets() {
        let dir = tempdir().unwrap();
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(dir.path().to_path_buf())),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::new(AgentSessionStore::new()),
        );

        let error = resolve_agent_tools_for_runtime(
            &runtime,
            vec![BrokerToolDef {
                name: GET_RECENT_EVENTS_TOOL.to_string(),
                description: "duplicate".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
            }],
            &[TOOL_PRESET_RECENT_EVENTS.to_string()],
            Some("profile-alpha".to_string()),
        )
        .unwrap_err();

        assert!(error.to_string().contains("duplicate tool name"));
    }
}
