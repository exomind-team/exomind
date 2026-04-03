use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use exomind_cli::cli::{GlobalOptions, ProposalAddArgs, ProposalCommentArgs, ProposalIdArgs, ProposalListArgs};
use exomind_cli::commands::proposal::{
    add_proposal, approve_proposal, comment_proposal, get_proposal, list_proposals, reject_proposal,
    snooze_proposal,
};
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct ProposalTestState {
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
async fn proposal_add_posts_pending_proposal() {
    let state = ProposalTestState::default();
    let target = spawn_proposal_server(state.clone()).await;
    let params_file = temp_json_file("{\"title\":\"整理浏览器标签\",\"tags\":[\"cleanup\"]}");
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let created = add_proposal(
        &global,
        &ProposalAddArgs {
            action: "create_task".to_string(),
            title: "建议：整理浏览器标签".to_string(),
            params_file: Some(params_file.to_string_lossy().to_string()),
        },
    )
    .await
    .expect("proposal add");

    assert_eq!(created["status"], "pending");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured add request");
    assert_eq!(latest.method, "POST");
    assert_eq!(latest.path, "/api/proposals");
    assert_eq!(latest.query.get("profile_id"), Some(&"profile-argon".to_string()));
    let body = latest.body.as_ref().expect("proposal add body");
    assert_eq!(body["action_type"], "create_task");
    assert_eq!(body["action_params"]["title"], "整理浏览器标签");

    let _ = fs::remove_file(params_file);
}

#[tokio::test]
async fn proposal_approve_patches_status_to_approved() {
    let state = ProposalTestState::default();
    let target = spawn_proposal_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let approved = approve_proposal(
        &global,
        &ProposalIdArgs { proposal_id: 12 },
    )
    .await
    .expect("proposal approve");

    assert_eq!(approved["status"], "approved");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured approve request");
    assert_eq!(latest.method, "PATCH");
    assert_eq!(latest.path, "/api/proposals/12");
    assert_eq!(latest.body.as_ref().expect("approve body")["status"], "approved");
}

#[tokio::test]
async fn proposal_comment_posts_discussion_entry() {
    let state = ProposalTestState::default();
    let target = spawn_proposal_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let proposal = comment_proposal(
        &global,
        &ProposalCommentArgs {
            proposal_id: 12,
            content: "先改成低优先级".to_string(),
        },
    )
    .await
    .expect("proposal comment");

    assert_eq!(proposal["comments"][0]["content"], "先改成低优先级");
    let captured = state.captured.lock().expect("captured requests");
    let latest = captured.last().expect("captured comment request");
    assert_eq!(latest.method, "POST");
    assert_eq!(latest.path, "/api/proposals/12/comments");
}

#[tokio::test]
async fn proposal_list_get_reject_and_snooze_use_rt_contracts() {
    let state = ProposalTestState::default();
    let target = spawn_proposal_server(state.clone()).await;
    let global = GlobalOptions {
        target: Some(target),
        profile: Some("argon".to_string()),
        user_id: None,
        json: true,
        spawn_if_missing: false,
    };

    let listed = list_proposals(
        &global,
        &ProposalListArgs {
            status: Some("pending".to_string()),
        },
    )
    .await
    .expect("proposal list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], 12);

    let loaded = get_proposal(&global, &ProposalIdArgs { proposal_id: 12 })
        .await
        .expect("proposal get");
    assert_eq!(loaded["id"], 12);

    let rejected = reject_proposal(&global, &ProposalIdArgs { proposal_id: 12 })
        .await
        .expect("proposal reject");
    assert_eq!(rejected["status"], "rejected");

    let snoozed = snooze_proposal(&global, &ProposalIdArgs { proposal_id: 12 })
        .await
        .expect("proposal snooze");
    assert_eq!(snoozed["status"], "snoozed");
}

async fn spawn_proposal_server(state: ProposalTestState) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener addr");
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/api/proposals", get(list_handler).post(add_handler))
        .route("/api/proposals/:id", get(get_handler).patch(update_handler))
        .route("/api/proposals/:id/comments", post(comment_handler))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve proposal test app");
    });

    address.to_string()
}

async fn add_handler(
    State(state): State<ProposalTestState>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(&state, "POST", "/api/proposals", query, Some(body.clone()));
    Json(json!({
        "id": 12,
        "title": body["title"],
        "body": "",
        "action_type": body["action_type"],
        "action_params": body["action_params"],
        "references": [],
        "status": "pending",
        "publisher": body["publisher"],
        "comments": []
    }))
}

async fn list_handler(
    State(state): State<ProposalTestState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    capture_request(&state, "GET", "/api/proposals", query, None);
    Json(json!([
        {
            "id": 12,
            "title": "建议：整理浏览器标签",
            "body": "",
            "action_type": "create_task",
            "action_params": { "title": "整理浏览器标签" },
            "references": [],
            "status": "pending",
            "publisher": { "publisher_type": "agent", "id": "exomind-cli", "name": "ExoMind CLI" },
            "comments": []
        }
    ]))
}

async fn get_handler(
    State(state): State<ProposalTestState>,
    Path(proposal_id): Path<u64>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    capture_request(
        &state,
        "GET",
        &format!("/api/proposals/{proposal_id}"),
        query,
        None,
    );
    Json(json!({
        "id": proposal_id,
        "title": "建议：整理浏览器标签",
        "body": "",
        "action_type": "create_task",
        "action_params": { "title": "整理浏览器标签" },
        "references": [],
        "status": "pending",
        "publisher": { "publisher_type": "agent", "id": "exomind-cli", "name": "ExoMind CLI" },
        "comments": []
    }))
}

async fn update_handler(
    State(state): State<ProposalTestState>,
    Path(proposal_id): Path<u64>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(
        &state,
        "PATCH",
        &format!("/api/proposals/{proposal_id}"),
        query,
        Some(body.clone()),
    );
    Json(json!({
        "id": proposal_id,
        "title": "建议：整理浏览器标签",
        "body": "",
        "action_type": "create_task",
        "action_params": { "title": "整理浏览器标签" },
        "references": [],
        "status": body["status"],
        "publisher": { "publisher_type": "agent", "id": "exomind-cli", "name": "ExoMind CLI" },
        "comments": []
    }))
}

async fn comment_handler(
    State(state): State<ProposalTestState>,
    Path(proposal_id): Path<u64>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_request(
        &state,
        "POST",
        &format!("/api/proposals/{proposal_id}/comments"),
        query,
        Some(body.clone()),
    );
    Json(json!({
        "id": proposal_id,
        "title": "建议：整理浏览器标签",
        "body": "",
        "action_type": "create_task",
        "action_params": { "title": "整理浏览器标签" },
        "references": [],
        "status": "pending",
        "publisher": { "publisher_type": "agent", "id": "exomind-cli", "name": "ExoMind CLI" },
        "comments": [
            {
                "author": body["author"],
                "content": body["content"]
            }
        ]
    }))
}

fn capture_request(
    state: &ProposalTestState,
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

fn temp_json_file(content: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("exomind-cli-proposal-{suffix}.json"));
    fs::write(&path, content).expect("write params file");
    path
}
