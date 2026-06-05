//! Workspace Tauri commands — proxy to the embedded runtime's workspace REST endpoints.
//!
//! The embedded runtime exposes workspace data under:
//!   GET /agents/{agent_id}/workspace/{resource}
//!
//! These commands forward requests to those endpoints and return the JSON payloads
//! to the frontend.  Non-life agents return 404; the command propagates that as an Err.

use crate::commands::runtime_commands::RuntimeProcessState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

// ─── response types (mirrors route structs) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFileInfo {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeListResponse {
    pub files: Vec<KnowledgeFileInfo>,
    pub usage_bytes: usize,
    pub max_bytes: usize,
    pub usage_ratio: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionEntry {
    pub timestamp: String,
    pub tick: u64,
    pub action_type: String,
    pub description: String,
    pub energy_before: u64,
    pub energy_after: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionsResponse {
    pub actions: Vec<ActionEntry>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyStatus {
    pub knowledge_usage_ratio: f32,
    pub total_actions: u64,
    pub uptime_ticks: u64,
    pub current_strategy: String,
    pub energy_level: u64,
    pub energy_max: u64,
}

// ─── helper ──────────────────────────────────────────────────────────────────

fn base_url(state: &State<'_, Arc<RuntimeProcessState>>) -> Result<String, String> {
    state.inner().runtime_base_url()
}

async fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Agent has no workspace (not a life agent)".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Runtime error {status}: {body}"));
    }

    resp.json::<T>()
        .await
        .map_err(|e| format!("JSON parse error: {e}"))
}

// ─── commands ─────────────────────────────────────────────────────────────────

/// Return the SOUL.md content for a life agent's workspace.
#[tauri::command]
pub async fn get_agent_workspace_soul(
    agent_id: String,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<String, String> {
    let url = format!("{}/agents/{agent_id}/workspace/soul", base_url(&state)?);
    let json: serde_json::Value = get_json(&url).await?;
    Ok(json
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

/// Return a list of knowledge files + usage stats.
#[tauri::command]
pub async fn get_agent_workspace_knowledge_list(
    agent_id: String,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<KnowledgeListResponse, String> {
    let url = format!(
        "{}/agents/{agent_id}/workspace/knowledge",
        base_url(&state)?
    );
    get_json(&url).await
}

/// Return the raw content of a single knowledge file.
#[tauri::command]
pub async fn get_agent_workspace_knowledge(
    agent_id: String,
    filename: String,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<String, String> {
    let url = format!(
        "{}/agents/{agent_id}/workspace/knowledge/{filename}",
        base_url(&state)?
    );
    let json: serde_json::Value = get_json(&url).await?;
    Ok(json
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

/// Return the most recent action log entries (default: last 50).
#[tauri::command]
pub async fn get_agent_workspace_actions(
    agent_id: String,
    limit: Option<u32>,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<ActionsResponse, String> {
    let mut url = format!("{}/agents/{agent_id}/actions", base_url(&state)?);
    if let Some(n) = limit {
        url.push_str(&format!("?limit={n}"));
    }
    get_json(&url).await
}

/// Return the composite body status (energy + workspace + strategy).
#[tauri::command]
pub async fn get_agent_workspace_status(
    agent_id: String,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<BodyStatus, String> {
    let url = format!("{}/agents/{agent_id}/workspace/status", base_url(&state)?);
    get_json(&url).await
}
