use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::signal::types::SignalEvent;
use crate::task::{CreateTaskInput, Task, TaskStatus, TransitionInput, UpdateTaskInput};
use crate::AppState;

// ── Query types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<TaskStatus>,
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /tasks
async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<Vec<Task>> {
    let tasks = match &query.status {
        Some(status) => state.task_store.list_by_status(status),
        None => state.task_store.list(),
    };
    Json(tasks)
}

/// GET /tasks/:id
async fn get_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Task>, StatusCode> {
    state
        .task_store
        .get(&id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// POST /tasks
async fn create_task(
    State(state): State<AppState>,
    Json(input): Json<CreateTaskInput>,
) -> (StatusCode, Json<Task>) {
    let task = state.task_store.create(input);

    publish_task_signal(&state, "task.created", &task);

    (StatusCode::CREATED, Json(task))
}

/// PUT /tasks/:id
async fn update_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(input): Json<UpdateTaskInput>,
) -> Result<Json<Task>, StatusCode> {
    let task = state
        .task_store
        .update(&id, input)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    publish_task_signal(&state, "task.updated", &task);

    Ok(Json(task))
}

/// POST /tasks/:id/transition
async fn transition_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(input): Json<TransitionInput>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let (old_status, task) = state
        .task_store
        .transition(&id, input.status)
        .map_err(|e| {
            let code = match &e {
                crate::task::store::TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::CONFLICT,
            };
            (code, e.to_string())
        })?;

    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "task.transitioned".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({
            "task": task,
            "old_status": old_status,
            "new_status": task.status,
        }),
    };
    state.signal_pool.publish(event);

    Ok(Json(task))
}

/// DELETE /tasks/:id — abandon task (set status to abandoned)
async fn delete_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let task = state.task_store.abandon(&id).map_err(|e| {
        let code = match &e {
            crate::task::store::TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            _ => StatusCode::CONFLICT,
        };
        (code, e.to_string())
    })?;

    publish_task_signal(&state, "task.deleted", &task);

    Ok(Json(task))
}

// ── Helpers ─────────────────────────────────────────────────────

fn publish_task_signal(state: &AppState, topic: &str, task: &Task) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: None,
        payload: serde_json::to_value(task).unwrap_or_default(),
    };
    state.signal_pool.publish(event);
}

// ── Router ──────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/:id", get(get_task).put(update_task).delete(delete_task))
        .route("/tasks/:id/transition", post(transition_task))
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "tasks-test-host".to_string();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(host_id, Arc::clone(&signal_pool), None)),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            energy_registry: crate::energy::EnergyRegistry::new(),
            life_agents: std::collections::HashMap::new(),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn create_and_list_tasks() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        // Create
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Buy milk","tags":["shopping"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(created["title"], "Buy milk");
        assert_eq!(created["status"], "not_started");
        assert_eq!(created["priority"], "medium");
        assert_eq!(created["tags"][0], "shopping");

        // List
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Buy milk");
    }

    #[tokio::test]
    async fn get_single_task() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Test".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/tasks/{}", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let fetched: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(fetched["id"], task.id);
    }

    #[tokio::test]
    async fn get_nonexistent_returns_404() {
        let state = test_state();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_task_fields() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Original".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Updated","priority":"high"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let updated: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(updated["title"], "Updated");
        assert_eq!(updated["priority"], "high");
    }

    #[tokio::test]
    async fn transition_task_status() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "My task".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/tasks/{}/transition", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"in_progress"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let transitioned: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(transitioned["status"], "in_progress");
    }

    #[tokio::test]
    async fn invalid_transition_returns_conflict() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Task".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        let app = test_router(state);

        // not_started → completed is invalid
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/tasks/{}/transition", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"completed"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn delete_abandons_task() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "To abandon".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        // Must transition to in_progress first (not_started → abandoned is invalid)
        state.task_store.transition(&task.id, TaskStatus::InProgress).unwrap();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/tasks/{}", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let deleted: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(deleted["status"], "abandoned");
    }

    #[tokio::test]
    async fn list_with_status_filter() {
        let state = test_state();
        let t1 = state.task_store.create(CreateTaskInput {
            title: "Task 1".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        state.task_store.create(CreateTaskInput {
            title: "Task 2".to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        });
        state.task_store.transition(&t1.id, TaskStatus::InProgress).unwrap();

        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks?status=in_progress")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Task 1");
    }
}
