use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::config::{PutConfigEntryInput, types::USER_CONFIG_SCOPE};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    #[serde(default = "default_scope")]
    scope: String,
    #[serde(default)]
    prefix: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteQuery {
    #[serde(default = "default_scope")]
    scope: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutConfigRequest {
    #[serde(default = "default_scope")]
    scope: String,
    value: String,
    #[serde(default)]
    sensitive: bool,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    source_origin: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendImportRequest {
    #[serde(default = "default_scope")]
    scope: String,
    #[serde(default)]
    strategy: Option<String>,
    entries: Vec<FrontendImportEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendImportEntry {
    key: String,
    value: String,
    #[serde(default)]
    sensitive: bool,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    source_origin: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResponse {
    imported: usize,
    skipped: usize,
    total: usize,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(list_config))
        .route("/config/import/frontend", post(import_frontend_config))
        .route("/config/:key", put(put_config).delete(delete_config))
}

async fn list_config(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<crate::config::ConfigEntry>>, (StatusCode, String)> {
    let entries = state
        .config_store
        .list_by_prefix(Some(&query.scope), query.prefix.as_deref())
        .map_err(internal_error)?;
    Ok(Json(entries))
}

async fn put_config(
    Path(key): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<PutConfigRequest>,
) -> Result<Json<crate::config::ConfigEntry>, (StatusCode, String)> {
    let entry = state
        .config_store
        .put(PutConfigEntryInput {
            scope: payload.scope,
            key,
            value: payload.value,
            sensitive: payload.sensitive,
            source: payload.source,
            source_origin: payload.source_origin,
        })
        .map_err(internal_error)?;
    Ok(Json(entry))
}

async fn delete_config(
    Path(key): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<DeleteQuery>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .config_store
        .delete(&query.scope, &key)
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn import_frontend_config(
    State(state): State<AppState>,
    Json(payload): Json<FrontendImportRequest>,
) -> Result<Json<ImportResponse>, (StatusCode, String)> {
    let strategy = payload.strategy.as_deref().unwrap_or("if-empty");
    if strategy != "if-empty" {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("unsupported import strategy: {strategy}"),
        ));
    }

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let total = payload.entries.len();

    for entry in payload.entries {
        if state
            .config_store
            .put_if_absent(PutConfigEntryInput {
                scope: payload.scope.clone(),
                key: entry.key,
                value: entry.value,
                sensitive: entry.sensitive,
                source: entry.source,
                source_origin: entry.source_origin,
            })
            .map_err(internal_error)?
        {
            imported += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(Json(ImportResponse {
        imported,
        skipped,
        total,
    }))
}

fn internal_error(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn default_scope() -> String {
    USER_CONFIG_SCOPE.to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::util::ServiceExt;

    use super::*;
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;

    fn test_state() -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "config-route-test".to_string();
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
            agent_api_session_store: Arc::new(crate::agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
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
            eventlog_store: Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join("exomind-test-config-routes"),
            )),
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn put_and_list_config_entries() {
        let app = test_router(test_state());

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/config/exomind:themePreference")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "scope": "user",
                            "value": "dark",
                            "source": "settings-page",
                            "sourceOrigin": "http://localhost:1420"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(put_response.status(), StatusCode::OK);

        let list_response = app
            .oneshot(
                Request::builder()
                    .uri("/config?scope=user&prefix=exomind:")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(list_response.status(), StatusCode::OK);
        let body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let payload: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload.len(), 1);
        assert_eq!(payload[0]["key"], "exomind:themePreference");
        assert_eq!(payload[0]["value"], "dark");
    }

    #[tokio::test]
    async fn delete_config_entry_returns_no_content() {
        let state = test_state();
        state
            .config_store
            .put(PutConfigEntryInput {
                scope: "user".to_string(),
                key: "moss_api_key".to_string(),
                value: "sk-123".to_string(),
                sensitive: true,
                source: None,
                source_origin: None,
            })
            .unwrap();
        let app = test_router(state);

        let delete_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/config/moss_api_key?scope=user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

        let list_response = app
            .oneshot(
                Request::builder()
                    .uri("/config?scope=user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let payload: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(payload.is_empty());
    }

    #[tokio::test]
    async fn import_frontend_config_skips_existing_entries_when_if_empty() {
        let state = test_state();
        state
            .config_store
            .put(PutConfigEntryInput {
                scope: "user".to_string(),
                key: "exomind:themePreference".to_string(),
                value: "dark".to_string(),
                sensitive: false,
                source: Some("existing".to_string()),
                source_origin: None,
            })
            .unwrap();
        let app = test_router(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/config/import/frontend")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "scope": "user",
                            "strategy": "if-empty",
                            "entries": [
                                { "key": "exomind:themePreference", "value": "light" },
                                { "key": "moss_api_key", "value": "sk-imported", "sensitive": true }
                            ]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["imported"], 1);
        assert_eq!(payload["skipped"], 1);

        let list_response = app
            .oneshot(
                Request::builder()
                    .uri("/config?scope=user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let payload: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload.len(), 2);
        let theme = payload
            .iter()
            .find(|entry| entry["key"] == "exomind:themePreference")
            .unwrap();
        let moss = payload
            .iter()
            .find(|entry| entry["key"] == "moss_api_key")
            .unwrap();
        assert_eq!(theme["value"], "dark");
        assert_eq!(moss["value"], "sk-imported");
        assert_eq!(moss["sensitive"], true);
    }
}
