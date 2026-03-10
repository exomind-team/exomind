use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

// ---------------------------------------------------------------------------
// Query / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ActionsQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    50
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFileInfo {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeListResponse {
    pub files: Vec<KnowledgeFileInfo>,
    pub usage_bytes: usize,
    pub max_bytes: usize,
    pub usage_ratio: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionsListResponse {
    pub actions: Vec<crate::agent::workspace::ActionEntry>,
    pub total: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentResponse {
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatusResponse {
    pub knowledge_usage_ratio: f32,
    pub total_actions: u64,
    pub uptime_ticks: u64,
    pub current_strategy: String,
    pub energy_level: u64,
    pub energy_max: u64,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agents/:agent_id/workspace/soul", get(get_soul))
        .route("/agents/:agent_id/workspace/knowledge", get(list_knowledge))
        .route(
            "/agents/:agent_id/workspace/knowledge/:filename",
            get(get_knowledge_file),
        )
        .route("/agents/:agent_id/workspace/actions", get(get_actions))
        .route("/agents/:agent_id/workspace/state", get(get_state))
        .route("/agents/:agent_id/workspace/status", get(get_status))
}

// ---------------------------------------------------------------------------
// Helper: extract CognitiveLifeAgent from registry
// ---------------------------------------------------------------------------

fn get_life_agent(
    state: &AppState,
    agent_id: &str,
) -> Result<std::sync::Arc<crate::agent::life::CognitiveLifeAgent>, (StatusCode, Json<ErrorResponse>)> {
    state.life_agents.get(agent_id).cloned().ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "agent has no workspace (not a life agent)".to_string(),
            }),
        )
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn get_soul(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<ContentResponse>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let content = agent.workspace().load_soul().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("failed to load SOUL.md: {e}"),
            }),
        )
    })?;
    Ok(Json(ContentResponse { content }))
}

async fn list_knowledge(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<KnowledgeListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let ws = agent.workspace();

    let filenames = ws.list_knowledge().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("failed to list knowledge: {e}"),
            }),
        )
    })?;

    // Build file info with sizes
    let mut files = Vec::with_capacity(filenames.len());
    for name in filenames {
        let size_bytes = ws.knowledge_dir().join(&name)
            .metadata()
            .map(|m| m.len())
            .unwrap_or(0);
        files.push(KnowledgeFileInfo { name, size_bytes });
    }

    let usage_bytes = ws.knowledge_usage_bytes().unwrap_or(0);
    let usage_ratio = ws.knowledge_usage_ratio().unwrap_or(0.0);

    Ok(Json(KnowledgeListResponse {
        files,
        usage_bytes,
        max_bytes: ws.max_knowledge_bytes(),
        usage_ratio,
    }))
}

async fn get_knowledge_file(
    State(state): State<AppState>,
    Path((agent_id, filename)): Path<(String, String)>,
) -> Result<Json<ContentResponse>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let content = agent.workspace().read_knowledge(&filename).map_err(|e| {
        let status = if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        (
            status,
            Json(ErrorResponse {
                error: format!("failed to read '{filename}': {e}"),
            }),
        )
    })?;
    Ok(Json(ContentResponse { content }))
}

async fn get_actions(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Query(query): Query<ActionsQuery>,
) -> Result<Json<ActionsListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let all = agent.workspace().action_log().read_all().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("failed to read actions: {e}"),
            }),
        )
    })?;

    let total = all.len() as u64;
    // Return last N entries.
    let start = all.len().saturating_sub(query.limit);
    Ok(Json(ActionsListResponse {
        actions: all[start..].to_vec(),
        total,
    }))
}

async fn get_state(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let agent_state = agent.workspace().load_state().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("failed to load state: {e}"),
            }),
        )
    })?;
    Ok(Json(agent_state))
}

async fn get_status(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<WorkspaceStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let agent = get_life_agent(&state, &agent_id)?;
    let ws = agent.workspace();

    let kb_ratio = ws.knowledge_usage_ratio().unwrap_or(0.0);
    let total_actions = ws.action_log().count().unwrap_or(0);
    let agent_state = ws.load_state().unwrap_or(serde_json::json!({}));
    let uptime_ticks = agent_state
        .get("tick_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let strategy = agent_state
        .get("strategy")
        .and_then(|v| v.as_str())
        .unwrap_or("exploring")
        .to_string();

    // Merge energy info.
    let energy = state.energy_registry.get(&agent_id);
    let (e_level, e_max) = match &energy {
        Some(e) => (e.current(), e.max()),
        None => (0, 100),
    };

    Ok(Json(WorkspaceStatusResponse {
        knowledge_usage_ratio: kb_ratio,
        total_actions,
        uptime_ticks,
        current_strategy: strategy,
        energy_level: e_level,
        energy_max: e_max,
    }))
}
