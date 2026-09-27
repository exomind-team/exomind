use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use exomind_cli::cli::{
    EventlogAddArgs, EventlogGetArgs, EventlogListArgs, EventlogWatchArgs, GlobalOptions,
};
use exomind_cli::commands::eventlog::{add_event, get_event, list_events, watch_events};
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct EventlogTestState {
    captured: Arc<Mutex<Vec<CapturedRequest>>>,
}

#[derive(Debug, Clone)]
struct CapturedRequest {
    path: String,
    query: HashMap<String, String>,
    body: Value,
}

#[tokio::test]
async fn eventlog_add_posts_to_scoped_rt_endpoint() {
    let state = EventlogTestState::default();
    let target = spawn_eventlog_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let created = add_event(
        &global,
        &EventlogAddArgs {
            content: "补记今天的口述".to_string(),
            tags: vec!["note".to_string(), "voice".to_string()],
        },
    )
    .await
    .expect("eventlog add");

    assert_eq!(created["id"], "evt-from-rt");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured add request");
    assert_eq!(latest.path, "/eventlog");
    assert_eq!(
        latest.query.get("user_id"),
        Some(&"profile-argon".to_string())
    );
    assert_eq!(latest.body["content"], "补记今天的口述");
    assert_eq!(latest.body["tags"], json!(["note", "voice"]));
    assert!(latest.body.get("timestamp").is_none());
}

#[tokio::test]
async fn eventlog_list_reads_latest_first() {
    let state = EventlogTestState::default();
    let target = spawn_eventlog_server(state).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let events = list_events(
        &global,
        &EventlogListArgs {
            limit: Some(2),
            tags: vec!["note".to_string()],
        },
    )
    .await
    .expect("eventlog list");

    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["id"], "evt-2");
    assert_eq!(events[1]["id"], "evt-1");
}

#[tokio::test]
async fn eventlog_watch_polls_for_new_events() {
    let state = EventlogTestState::default();
    let target = spawn_eventlog_server(state).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let events = watch_events(
        &global,
        &EventlogWatchArgs {
            since_id: Some("evt-1".to_string()),
        },
    )
    .await
    .expect("eventlog watch");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["id"], "evt-watch");
}

#[tokio::test]
async fn eventlog_get_reads_single_item() {
    let state = EventlogTestState::default();
    let target = spawn_eventlog_server(state).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let event = get_event(
        &global,
        &EventlogGetArgs {
            event_id: "evt-1".to_string(),
        },
    )
    .await
    .expect("eventlog get");

    assert_eq!(event["id"], "evt-1");
    assert_eq!(event["content"], "older event");
}

async fn spawn_eventlog_server(state: EventlogTestState) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener addr");
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/eventlog", get(list_handler).post(add_handler))
        .route("/eventlog/watch", get(watch_handler))
        .route("/eventlog/:id", get(get_handler))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve eventlog test app");
    });

    address.to_string()
}

async fn add_handler(
    State(state): State<EventlogTestState>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    state
        .captured
        .lock()
        .expect("captured requests")
        .push(CapturedRequest {
            path: "/eventlog".to_string(),
            query,
            body: body.clone(),
        });

    Json(json!({
        "id": "evt-from-rt",
        "timestamp": 1700000001234_i64,
        "content": body["content"],
        "tags": body["tags"],
    }))
}

async fn list_handler(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    assert_eq!(query.get("user_id"), Some(&"profile-argon".to_string()));
    Json(json!([
        {
            "id": "evt-2",
            "timestamp": 2000,
            "content": "latest event",
            "tags": ["note"]
        },
        {
            "id": "evt-1",
            "timestamp": 1000,
            "content": "older event",
            "tags": ["note"]
        }
    ]))
}

async fn watch_handler(Query(query): Query<HashMap<String, String>>) -> Json<Value> {
    assert_eq!(query.get("since_id"), Some(&"evt-1".to_string()));
    Json(json!([
        {
            "id": "evt-watch",
            "timestamp": 3000,
            "content": "watch event",
            "tags": ["note"]
        }
    ]))
}

async fn get_handler(
    Path(event_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    assert_eq!(query.get("user_id"), Some(&"profile-argon".to_string()));
    Json(json!({
        "id": event_id,
        "timestamp": 1000,
        "content": "older event",
        "tags": ["note"]
    }))
}
