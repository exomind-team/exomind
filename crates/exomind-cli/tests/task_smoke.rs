use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use exomind_cli::cli::{GlobalOptions, TaskAddArgs, TaskIdArgs, TaskListArgs, TaskUpdateArgs};
use exomind_cli::commands::task::{
    add_task, cancel_task, complete_task, get_task, list_tasks, start_task, update_task,
};
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct TaskTestState {
    captured: Arc<Mutex<Vec<CapturedRequest>>>,
}

#[derive(Debug, Clone)]
struct CapturedRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    body: Option<Value>,
}

#[tokio::test]
async fn task_add_posts_create_task_payload() {
    let state = TaskTestState::default();
    let target = spawn_task_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let created = add_task(
        &global,
        &TaskAddArgs {
            title: "整理浏览器标签".to_string(),
            priority: Some("high".to_string()),
            tags: vec!["cleanup".to_string()],
        },
    )
    .await
    .expect("task add");

    assert_eq!(created["title"], "整理浏览器标签");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured add request");
    assert_eq!(latest.method, "POST");
    assert_eq!(latest.path, "/tasks");
    assert_eq!(latest.query.get("profile_id"), Some(&"profile-argon".to_string()));
    let body = latest.body.as_ref().expect("task add body");
    assert_eq!(body["title"], "整理浏览器标签");
    assert_eq!(body["priority"], "high");
    assert_eq!(body["tags"], json!(["cleanup"]));
}

#[tokio::test]
async fn task_cancel_hides_pending_to_in_progress_transition_detail() {
    let state = TaskTestState::default();
    let target = spawn_task_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let cancelled = cancel_task(
        &global,
        &TaskIdArgs {
            task_id: "task-1".to_string(),
        },
    )
    .await
    .expect("task cancel");

    assert_eq!(cancelled["status"], "cancelled");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured cancel request");
    assert_eq!(latest.method, "POST");
    assert_eq!(latest.path, "/tasks/task-1/cancel");
}

#[tokio::test]
async fn task_complete_uses_transition_shortcut_path() {
    let state = TaskTestState::default();
    let target = spawn_task_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let completed = complete_task(
        &global,
        &TaskIdArgs {
            task_id: "task-1".to_string(),
        },
    )
    .await
    .expect("task complete");

    assert_eq!(completed["status"], "completed");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured complete request");
    assert_eq!(latest.method, "POST");
    assert_eq!(latest.path, "/tasks/task-1/transition");
    assert_eq!(latest.query.get("shortcut"), Some(&"true".to_string()));
    assert_eq!(
        latest.body.as_ref().expect("transition body")["status"],
        "completed"
    );
}

#[tokio::test]
async fn task_list_get_update_and_start_use_rt_contracts() {
    let state = TaskTestState::default();
    let target = spawn_task_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let listed = list_tasks(
        &global,
        &TaskListArgs {
            status: Some("pending".to_string()),
            tags: vec!["cleanup".to_string()],
            parent_id: Some("parent-1".to_string()),
        },
    )
    .await
    .expect("task list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], "task-1");

    let loaded = get_task(
        &global,
        &TaskIdArgs {
            task_id: "task-1".to_string(),
        },
    )
    .await
    .expect("task get");
    assert_eq!(loaded["id"], "task-1");

    let updated = update_task(
        &global,
        &TaskUpdateArgs {
            task_id: "task-1".to_string(),
            title: Some("整理三个屏幕程序".to_string()),
        },
    )
    .await
    .expect("task update");
    assert_eq!(updated["title"], "整理三个屏幕程序");

    let started = start_task(
        &global,
        &TaskIdArgs {
            task_id: "task-1".to_string(),
        },
    )
    .await
    .expect("task start");
    assert_eq!(started["status"], "in_progress");
}

async fn spawn_task_server(state: TaskTestState) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener addr");
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/tasks", get(list_handler).post(add_handler))
        .route("/tasks/:id", get(get_handler).put(update_handler).patch(update_handler))
        .route("/tasks/:id/transition", post(transition_handler))
        .route("/tasks/:id/cancel", post(cancel_handler))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve task test app");
    });

    address.to_string()
}

async fn add_handler(
    State(state): State<TaskTestState>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(&state, "POST", "/tasks", query, Some(body.clone()));
    Json(json!({
        "id": "task-1",
        "title": body["title"],
        "status": "pending",
        "priority": body["priority"],
        "tags": body["tags"]
    }))
}

async fn list_handler(
    State(state): State<TaskTestState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    capture_request(&state, "GET", "/tasks", query, None);
    Json(json!([
        {
            "id": "task-1",
            "title": "整理浏览器标签",
            "status": "pending"
        }
    ]))
}

async fn get_handler(
    State(state): State<TaskTestState>,
    Path(task_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    capture_request(
        &state,
        "GET",
        &format!("/tasks/{task_id}"),
        query,
        None,
    );
    Json(json!({
        "id": task_id,
        "title": "整理浏览器标签",
        "status": "pending"
    }))
}

async fn update_handler(
    State(state): State<TaskTestState>,
    Path(task_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(
        &state,
        "PUT",
        &format!("/tasks/{task_id}"),
        query,
        Some(body.clone()),
    );
    Json(json!({
        "id": task_id,
        "title": body["title"],
        "status": "pending"
    }))
}

async fn transition_handler(
    State(state): State<TaskTestState>,
    Path(task_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(
        &state,
        "POST",
        &format!("/tasks/{task_id}/transition"),
        query,
        Some(body.clone()),
    );
    Json(json!({
        "id": task_id,
        "title": "整理浏览器标签",
        "status": body["status"]
    }))
}

async fn cancel_handler(
    State(state): State<TaskTestState>,
    Path(task_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    capture_request(
        &state,
        "POST",
        &format!("/tasks/{task_id}/cancel"),
        query,
        None,
    );
    Json(json!({
        "id": task_id,
        "title": "整理浏览器标签",
        "status": "cancelled"
    }))
}

fn capture_request(
    state: &TaskTestState,
    method: &str,
    path: &str,
    query: HashMap<String, String>,
    body: Option<Value>,
) {
    state
        .captured
        .lock()
        .expect("captured requests")
        .push(CapturedRequest {
            method: method.to_string(),
            path: path.to_string(),
            query,
            body,
        });
}
