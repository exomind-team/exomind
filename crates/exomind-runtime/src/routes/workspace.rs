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
) -> Result<std::sync::Arc<crate::agent::life::CognitiveLifeAgent>, (StatusCode, Json<ErrorResponse>)>
{
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
    // Try life agent workspace first
    if let Ok(life_agent) = get_life_agent(&state, &agent_id) {
        let content = life_agent.workspace().load_soul().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("failed to load SOUL.md: {e}"),
                }),
            )
        })?;
        return Ok(Json(ContentResponse { content }));
    }
    // Fallback: use Agent trait's soul() for built-in agents
    if let Some(agent) = state.registry.get(&agent_id) {
        return Ok(Json(ContentResponse {
            content: agent.soul(),
        }));
    }
    Err((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "agent not found".to_string(),
        }),
    ))
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
        let size_bytes = ws
            .knowledge_dir()
            .join(&name)
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
    // Try life agent workspace first
    if let Ok(life_agent) = get_life_agent(&state, &agent_id) {
        let all = life_agent.workspace().action_log().read_all().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("failed to read actions: {e}"),
                }),
            )
        })?;
        let total = all.len() as u64;
        let start = all.len().saturating_sub(query.limit);
        return Ok(Json(ActionsListResponse {
            actions: all[start..].to_vec(),
            total,
        }));
    }
    // Fallback: read from session store for built-in agents
    if let Some(agent) = state.registry.get(&agent_id) {
        let sessions = agent.list_sessions();
        let mut actions: Vec<crate::agent::workspace::ActionEntry> = Vec::new();

        // Build actions from per-block action_log entries
        for session in &sessions {
            if let Some(ref action_log) = session.action_log {
                for entry in action_log {
                    actions.push(crate::agent::workspace::ActionEntry {
                        timestamp: entry.timestamp.clone(),
                        tick: entry.tick,
                        action_type: entry.action_type.clone(),
                        description: entry.description.clone(),
                        energy_before: entry.energy_before,
                        energy_after: entry.energy_after,
                    });
                }
            } else {
                // Fallback: create a single entry from session metadata
                let description = {
                    let trigger = session.trigger_source.as_deref().unwrap_or("unknown");
                    let display_content = session.content.as_ref()
                        .filter(|c| !c.is_empty())
                        .or(session.prompt.as_ref())
                        .cloned()
                        .unwrap_or_else(|| format!("session {}", session.session_id));
                    format!("{}: {}", trigger, display_content)
                };
                actions.push(crate::agent::workspace::ActionEntry {
                    timestamp: session.created_at.clone(),
                    tick: 1,
                    action_type: "signal".to_string(),
                    description,
                    energy_before: 0,
                    energy_after: 0,
                });
            }
        }

        // Sort by timestamp descending (newest first)
        actions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        let total = actions.len() as u64;
        let start = actions.len().saturating_sub(query.limit as usize);
        return Ok(Json(ActionsListResponse {
            actions: actions[start..].to_vec(),
            total,
        }));
    }
    Err((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "agent not found".to_string(),
        }),
    ))
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
