use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::AppState;

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProfileInfo {
    id: String,
    slug: String,
    display_name: String,
}

fn internal_error(msg: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: msg }),
    )
}

async fn list_profiles(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProfileInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let mut profiles = state
        .eventlog_store
        .list_known_user_ids()
        .map_err(internal_error)?
        .into_iter()
        .filter(|user_id| user_id != "anonymous")
        .map(|user_id| ProfileInfo {
            slug: profile_slug(&user_id),
            display_name: profile_display_name(&user_id),
            id: user_id,
        })
        .collect::<Vec<_>>();

    profiles.sort_by(|left, right| left.id.cmp(&right.id));
    profiles.dedup_by(|left, right| left.id == right.id);
    Ok(Json(profiles))
}

fn profile_slug(profile_id: &str) -> String {
    profile_id
        .strip_prefix("profile-")
        .unwrap_or(profile_id)
        .to_string()
}

fn profile_display_name(profile_id: &str) -> String {
    profile_slug(profile_id)
        .split(['-', '_', ' '])
        .filter(|part| !part.is_empty())
        .map(title_case)
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case(part: &str) -> String {
    let mut chars = part.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };

    let mut output = first.to_uppercase().collect::<String>();
    output.push_str(chars.as_str());
    output
}

pub fn router() -> Router<AppState> {
    Router::new().route("/profiles", get(list_profiles))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eventlog::{EventLogStore, EventRecord};
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::ServiceExt;

    fn test_state_with_eventlog(store: Arc<EventLogStore>) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "profiles-test".to_string();
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
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
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
            eventlog_store: store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    #[tokio::test]
    async fn list_profiles_returns_known_scoped_users() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("profiles.sqlite");
        let store = Arc::new(
            EventLogStore::with_sqlite_path(dir.path().to_path_buf(), &sqlite_path).unwrap(),
        );
        store
            .append_event(
                Some("profile-argon"),
                EventRecord {
                    id: "evt-1".to_string(),
                    timestamp: 1,
                    content: "one".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        store
            .append_event(
                Some("profile-sigma"),
                EventRecord {
                    id: "evt-2".to_string(),
                    timestamp: 2,
                    content: "two".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        store
            .append_event(
                None,
                EventRecord {
                    id: "evt-3".to_string(),
                    timestamp: 3,
                    content: "anonymous".to_string(),
                    tags: vec!["note".to_string()],
                    metadata: None,
                },
            )
            .unwrap();

        let app = router().with_state(test_state_with_eventlog(store));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/profiles")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let items = payload.as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], "profile-argon");
        assert_eq!(items[0]["slug"], "argon");
        assert_eq!(items[0]["displayName"], "Argon");
        assert_eq!(items[1]["id"], "profile-sigma");
    }
}
