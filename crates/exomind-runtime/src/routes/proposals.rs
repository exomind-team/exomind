use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::proposal::{
    ActionType, Comment, CreateProposalInput, ExecutionOutcome, Proposal, ProposalExecutor,
    ProposalFilter, ProposalRef, ProposalStatus, ProposalStoreError, Publisher, PublisherType,
};
use crate::signal::types::SignalEvent;

async fn publish_execution_outcome_signals(
    state: &AppState,
    scope_key: Option<&str>,
    outcome: &ExecutionOutcome,
) {
    match outcome {
        ExecutionOutcome::TaskCreated { task, event: _ } => {
            crate::routes::tasks::publish_task_signal(state, "task.created", task);
            crate::routes::tasks::publish_task_replication_signal(state, scope_key, task);
        }
        ExecutionOutcome::TaskUpdated { task, event: _ } => {
            crate::routes::tasks::publish_task_signal(state, "task.updated", task);
            crate::routes::tasks::publish_task_replication_signal(state, scope_key, task);
        }
        ExecutionOutcome::EventAppended { event: _ } => {}
        ExecutionOutcome::TimeblockStarted { result, event: _ } => {
            crate::routes::timeblocks::publish_new_block_replication_signals(
                state, scope_key, result,
            );
        }
    }
}

#[derive(Debug, Deserialize)]
struct ProposalQuery {
    #[serde(default)]
    status: Option<ProposalStatus>,
    #[serde(default)]
    action_type: Option<ActionType>,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateProposalRequest {
    title: String,
    #[serde(default)]
    body: Option<String>,
    action_type: ActionType,
    action_params: serde_json::Value,
    #[serde(default)]
    references: Option<Vec<ProposalRef>>,
    publisher: Publisher,
}

#[derive(Debug, Deserialize)]
struct UpdateProposalRequest {
    #[serde(default)]
    status: Option<ProposalStatus>,
    #[serde(default)]
    action_params: Option<serde_json::Value>,
    #[serde(default)]
    snooze_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct AddCommentRequest {
    author: Publisher,
    content: String,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/proposals", get(list_proposals).post(create_proposal))
        .route("/api/proposals", get(list_proposals).post(create_proposal))
        .route("/proposals/:id", get(get_proposal).patch(update_proposal))
        .route(
            "/api/proposals/:id",
            get(get_proposal).patch(update_proposal),
        )
        .route("/proposals/:id/comments", post(add_comment))
        .route("/api/proposals/:id/comments", post(add_comment))
}

async fn list_proposals(
    State(state): State<AppState>,
    Query(query): Query<ProposalQuery>,
) -> Result<Json<Vec<Proposal>>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(query.profile_id.as_deref(), query.user_id.as_deref());
    let proposals = state
        .proposal_store
        .list_scoped(
            scope_key,
            &ProposalFilter {
                status: query.status,
                action_type: query.action_type,
            },
        )
        .map_err(map_store_error)?;
    Ok(Json(proposals))
}

async fn create_proposal(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<CreateProposalRequest>,
) -> Result<(StatusCode, Json<Proposal>), (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(query.profile_id.as_deref(), query.user_id.as_deref());
    let proposal = state
        .proposal_store
        .create_scoped(
            scope_key,
            CreateProposalInput {
                title: payload.title,
                body: payload.body.unwrap_or_default(),
                action_type: payload.action_type,
                action_params: payload.action_params,
                references: payload.references.unwrap_or_default(),
                publisher: payload.publisher,
            },
        )
        .map_err(map_store_error)?;
    publish_proposal_created_signal(&state, scope_key, &proposal);
    publish_proposal_replication_signal(&state, scope_key, &proposal);
    Ok((StatusCode::CREATED, Json(proposal)))
}

async fn get_proposal(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Proposal>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(query.profile_id.as_deref(), query.user_id.as_deref());
    let proposal = state
        .proposal_store
        .get_scoped(scope_key, &id)
        .map_err(map_store_error)?
        .ok_or_else(|| not_found(&id))?;
    Ok(Json(proposal))
}

async fn update_proposal(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<UpdateProposalRequest>,
) -> Result<Json<Proposal>, (StatusCode, Json<ErrorResponse>)> {
    if payload.status.is_none() && payload.action_params.is_none() {
        return Err(bad_request(
            "proposal update requires status or action_params",
        ));
    }
    if payload.snooze_until.is_some() && payload.status != Some(ProposalStatus::Snoozed) {
        return Err(bad_request("snooze_until requires status=snoozed"));
    }

    let scope_key = scope_key_from_query(query.profile_id.as_deref(), query.user_id.as_deref());
    let before = state
        .proposal_store
        .get_scoped(scope_key, &id)
        .map_err(map_store_error)?
        .ok_or_else(|| not_found(&id))?;

    let mut proposal = before.clone();
    if let Some(action_params) = payload.action_params {
        proposal = state
            .proposal_store
            .update_action_params_scoped(scope_key, &id, action_params)
            .map_err(map_store_error)?;
    }

    if let Some(status) = payload.status {
        proposal = state
            .proposal_store
            .update_status_scoped(scope_key, &id, status, payload.snooze_until)
            .map_err(map_store_error)?;
    }

    let status_changed =
        (before.status != proposal.status).then_some((before.status, proposal.status));
    let mut execution_failure_message: Option<String> = None;

    if before.status != ProposalStatus::Approved && proposal.status == ProposalStatus::Approved {
        let executor = ProposalExecutor::new(
            state.task_store.clone(),
            state.eventlog_appender(),
            state.timeblock_store.clone(),
        );
        match executor.execute_scoped(scope_key, &proposal).await {
            Ok(outcome) => {
                publish_execution_outcome_signals(&state, scope_key, &outcome).await;
            }
            Err(error) => {
                let failure_message = error.to_string();
                tracing::error!(proposal_id = %proposal.id, error = %failure_message, "proposal execution failed after approval");
                let comment = Comment {
                    author: Publisher {
                        publisher_type: PublisherType::Agent,
                        id: "runtime-executor".to_string(),
                        name: "Runtime Executor".to_string(),
                    },
                    content: format!("批准后执行失败：{failure_message}"),
                    created_at: Utc::now(),
                };
                proposal = state
                    .proposal_store
                    .add_comment_scoped(scope_key, &id, comment)
                    .map_err(map_store_error)?;
                execution_failure_message = Some(failure_message);
            }
        }
    }

    if let Some((from_status, to_status)) = status_changed {
        publish_proposal_status_changed_signal(
            &state,
            scope_key,
            &proposal,
            from_status,
            to_status,
        );
    }
    if let Some(failure_message) = execution_failure_message.as_deref() {
        publish_proposal_execution_failed_signal(&state, scope_key, &proposal, failure_message);
    }
    publish_proposal_replication_signal(&state, scope_key, &proposal);
    Ok(Json(proposal))
}

async fn add_comment(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<AddCommentRequest>,
) -> Result<(StatusCode, Json<Proposal>), (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(query.profile_id.as_deref(), query.user_id.as_deref());
    let proposal = state
        .proposal_store
        .add_comment_scoped(
            scope_key,
            &id,
            Comment {
                author: payload.author,
                content: payload.content,
                created_at: Utc::now(),
            },
        )
        .map_err(map_store_error)?;
    publish_proposal_replication_signal(&state, scope_key, &proposal);
    Ok((StatusCode::CREATED, Json(proposal)))
}

fn scope_key_from_query<'a>(
    profile_id: Option<&'a str>,
    user_id: Option<&'a str>,
) -> Option<&'a str> {
    profile_id.or(user_id)
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn build_proposal_replication_payload(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "proposal_snapshot",
            "proposalId": proposal.id,
            "updatedAt": proposal.updated_at,
            "originHostId": state.host_id,
        },
        "proposal": proposal,
    })
}

fn build_proposal_created_payload(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "proposal_created",
            "proposalId": proposal.id,
            "updatedAt": proposal.updated_at,
            "originHostId": state.host_id,
        },
        "proposal": proposal,
    })
}

fn build_proposal_status_changed_payload(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
    from_status: ProposalStatus,
    to_status: ProposalStatus,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "proposal_status_changed",
            "proposalId": proposal.id,
            "updatedAt": proposal.updated_at,
            "originHostId": state.host_id,
        },
        "proposal": proposal,
        "transition": {
            "fromStatus": from_status,
            "toStatus": to_status,
        },
    })
}

fn build_proposal_execution_failed_payload(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
    failure_message: &str,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "proposal_execution_failed",
            "proposalId": proposal.id,
            "updatedAt": proposal.updated_at,
            "originHostId": state.host_id,
        },
        "proposal": proposal,
        "execution": {
            "failureMessage": failure_message,
        },
    })
}

fn publish_proposal_signal(
    state: &AppState,
    topic: &str,
    proposal: &Proposal,
    payload: serde_json::Value,
) {
    let signal = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: Utc::now().timestamp_millis() as u64,
        source: "http:proposals".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("proposal:{}", proposal.id)),
        payload,
    };

    state.signal_pool.publish(signal.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        let relay = std::sync::Arc::clone(mesh_relay);
        tokio::spawn(async move {
            relay.forward_event_to_peers(signal).await;
        });
    }
}

fn publish_proposal_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
) {
    publish_proposal_signal(
        state,
        "proposal.replication.upserted",
        proposal,
        build_proposal_replication_payload(state, scope_key, proposal),
    );
}

fn publish_proposal_created_signal(state: &AppState, scope_key: Option<&str>, proposal: &Proposal) {
    publish_proposal_signal(
        state,
        "proposal.created",
        proposal,
        build_proposal_created_payload(state, scope_key, proposal),
    );
}

fn publish_proposal_status_changed_signal(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
    from_status: ProposalStatus,
    to_status: ProposalStatus,
) {
    publish_proposal_signal(
        state,
        "proposal.status_changed",
        proposal,
        build_proposal_status_changed_payload(state, scope_key, proposal, from_status, to_status),
    );
}

fn publish_proposal_execution_failed_signal(
    state: &AppState,
    scope_key: Option<&str>,
    proposal: &Proposal,
    failure_message: &str,
) {
    publish_proposal_signal(
        state,
        "proposal.execution_failed",
        proposal,
        build_proposal_execution_failed_payload(state, scope_key, proposal, failure_message),
    );
}

fn map_store_error(error: ProposalStoreError) -> (StatusCode, Json<ErrorResponse>) {
    match error {
        ProposalStoreError::NotFound(id) => not_found(&id),
        ProposalStoreError::InvalidStatusTransition { .. } => (
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: error.to_string(),
            }),
        ),
        ProposalStoreError::InvalidTitle
        | ProposalStoreError::InvalidPublisher(_)
        | ProposalStoreError::InvalidComment(_)
        | ProposalStoreError::InvalidActionParams { .. } => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: error.to_string(),
            }),
        ),
        ProposalStoreError::Sqlite(_)
        | ProposalStoreError::Io(_)
        | ProposalStoreError::Json(_)
        | ProposalStoreError::TimeParse(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: error.to_string(),
            }),
        ),
    }
}

fn bad_request(message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

fn not_found(id: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: format!("proposal not found: {id}"),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        test_state_with_proposal_store(Arc::new(crate::proposal::ProposalStore::new()))
    }

    fn test_state_with_proposal_store(
        proposal_store: Arc<crate::proposal::ProposalStore>,
    ) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "proposals-test-host".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!("exomind-test-proposals-{}", uuid::Uuid::new_v4())),
        ));

        AppState {
            port: 0,
            host_id: host_id.clone(),
            device_id: "dev-proposals-test-host".to_string(),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(
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
            proposal_store,
            session_store: Arc::new(crate::session::SessionStore::new()),
            agent_api_session_store: Arc::new(crate::agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
                eventlog_store.set_watch_tx(tx.clone());
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
            eventlog_store,
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

    fn signals_since(state: &AppState, previous_len: usize) -> Vec<SignalEvent> {
        state
            .signal_pool
            .window()
            .recent(state.signal_pool.window().len())
            .into_iter()
            .skip(previous_len)
            .collect()
    }

    #[tokio::test]
    async fn create_and_list_proposals_via_api_routes() {
        let app = test_router(test_state());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"整理会议记录",
                            "body":"今天有未归档会议纪要",
                            "action_type":"create_task",
                            "action_params":{"title":"整理会议记录","tags":["work"]},
                            "references":[{"ref_type":"event","id":"evt-1","display_text":"09:32 团队会议"}],
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(created["title"], "整理会议记录");
        assert_eq!(created["status"], "pending");
        assert_eq!(created["action_type"], "task.create");
        assert_eq!(
            created["action_params"],
            serde_json::json!({
                "fields": {
                    "title": "整理会议记录",
                    "tags": ["work"]
                }
            }),
        );

        let list_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/proposals?status=pending&action_type=task.create")
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
        let proposals: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0]["id"], created["id"]);
        assert_eq!(proposals[0]["action_type"], "task.create");
        assert_eq!(proposals[0]["references"][0]["id"], "evt-1");

        let get_response = app
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/proposals/{}",
                        created["id"].as_str().unwrap()
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn approving_create_task_executes_task_and_writes_eventlog() {
        let state = test_state();
        let app = test_router(state.clone());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"建议：整理今日会议记录",
                            "body":"检测到今天有会议记录待整理",
                            "action_type":"task.create",
                            "action_params":{"fields":{"title":"整理会议记录","tags":["工作"],"priority":"high"}},
                            "publisher":{"publisher_type":"agent","id":"test-agent","name":"测试 Agent"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap().to_string();

        let approve_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}?user_id=user-a"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"approved"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(approve_response.status(), StatusCode::OK);
        let body = approve_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let approved: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(approved["status"], "approved");

        let scoped_tasks = state.task_store.list_in_scope(Some("user-a"));
        assert_eq!(scoped_tasks.len(), 1);
        assert_eq!(scoped_tasks[0].title, "整理会议记录");
        let expected_source = format!("proposal:{proposal_id}");
        assert_eq!(
            scoped_tasks[0].source.as_deref(),
            Some(expected_source.as_str())
        );

        let events = state.eventlog_store.list_events(Some("user-a")).unwrap();
        assert_eq!(events.len(), 1);
        assert!(
            events[0]
                .tags
                .iter()
                .any(|tag| tag == "agent-action" || tag == "proposal-approved")
        );
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["proposal_id"],
            serde_json::json!(proposal_id)
        );
        assert!(
            state.task_store.list().is_empty(),
            "anonymous task scope should stay isolated"
        );
        let topics: Vec<String> = state
            .signal_pool
            .window()
            .recent(32)
            .iter()
            .map(|event| event.topic.clone())
            .collect();
        assert!(topics.iter().any(|topic| topic == "task.created"));
        assert!(
            topics
                .iter()
                .any(|topic| topic == "task.replication.upserted")
        );
        assert!(
            topics
                .iter()
                .any(|topic| topic == "eventlog.replication.appended")
        );
    }

    #[tokio::test]
    async fn approving_start_timeblock_publishes_timeblock_and_eventlog_replication() {
        let state = test_state();
        let app = test_router(state.clone());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"建议：开始专注块",
                            "body":"现在进入专注时间",
                            "action_type":"start_timeblock",
                            "action_params":{"name":"写实现","mode":"countdown","target_minutes":25,"tags":["focus"]},
                            "publisher":{"publisher_type":"agent","id":"test-agent","name":"测试 Agent"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap().to_string();

        let approve_response = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}?user_id=user-a"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"approved"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(approve_response.status(), StatusCode::OK);
        let active = state
            .timeblock_store
            .get_active_scoped(Some("user-a"))
            .unwrap()
            .expect("approved proposal should create active timeblock");
        assert_eq!(active.name, "写实现");

        let topics: Vec<String> = state
            .signal_pool
            .window()
            .recent(32)
            .iter()
            .map(|event| event.topic.clone())
            .collect();
        assert!(
            topics
                .iter()
                .any(|topic| topic == "timeblock.replication.active_upserted")
        );
        assert!(
            topics
                .iter()
                .any(|topic| topic == "eventlog.replication.appended")
        );
    }

    #[tokio::test]
    async fn create_proposal_publishes_created_and_replication_signals() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

        let before_signal_len = state.signal_pool.window().len();

        let create_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"整理迁移备注",
                            "action_type":"append_event",
                            "action_params":{"content":"把迁移备注补进日志"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();

        let signals = signals_since(&state, before_signal_len);
        assert_eq!(signals.len(), 2);
        assert_eq!(signals[0].topic, "proposal.created");
        assert_eq!(signals[1].topic, "proposal.replication.upserted");
        assert_eq!(
            signals[0].payload["scopeKey"],
            serde_json::json!("profile-a")
        );
        assert_eq!(
            signals[0].payload["cursor"]["kind"],
            serde_json::json!("proposal_created")
        );
        assert_eq!(signals[0].payload["proposal"]["id"], created["id"]);
        assert_eq!(
            signals[1].payload["cursor"]["kind"],
            serde_json::json!("proposal_snapshot")
        );
        assert_eq!(signals[1].payload["proposal"]["id"], created["id"]);
    }

    #[tokio::test]
    async fn status_change_publishes_status_changed_then_replication() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"整理迁移计划",
                            "action_type":"append_event",
                            "action_params":{"content":"补记迁移计划"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap();

        let before_signal_len = state.signal_pool.window().len();

        let update_response = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"in_review"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(update_response.status(), StatusCode::OK);

        let signals = signals_since(&state, before_signal_len);
        assert_eq!(signals.len(), 2);
        assert_eq!(signals[0].topic, "proposal.status_changed");
        assert_eq!(signals[1].topic, "proposal.replication.upserted");
        assert_eq!(
            signals[0].payload["transition"]["fromStatus"],
            serde_json::json!("pending")
        );
        assert_eq!(
            signals[0].payload["transition"]["toStatus"],
            serde_json::json!("in_review")
        );
        assert_eq!(
            signals[0].payload["proposal"]["status"],
            serde_json::json!("in_review")
        );
        assert_eq!(
            signals[1].payload["proposal"]["status"],
            serde_json::json!("in_review")
        );
    }

    #[tokio::test]
    async fn approval_failure_publishes_execution_failed_before_final_replication() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"授权新 Agent",
                            "body":"请求批准一个新的 Agent 访问 profile",
                            "action_type":"approve_agent_access",
                            "action_params":{
                              "agent_id":"agent-b",
                              "agent_name":"Agent B",
                              "profile_id":"user-a",
                              "scopes":["events:read"]
                            },
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap();

        let before_signal_len = state.signal_pool.window().len();

        let approve_response = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}?user_id=user-a"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"approved"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(approve_response.status(), StatusCode::OK);
        let body = approve_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let approved: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(approved["status"], "approved");
        assert_eq!(approved["comments"].as_array().unwrap().len(), 1);
        assert!(
            approved["comments"][0]["content"]
                .as_str()
                .unwrap()
                .contains("批准后执行失败")
        );

        let signals = signals_since(&state, before_signal_len);
        assert_eq!(signals.len(), 3);
        assert_eq!(signals[0].topic, "proposal.status_changed");
        assert_eq!(signals[1].topic, "proposal.execution_failed");
        assert_eq!(signals[2].topic, "proposal.replication.upserted");
        assert_eq!(
            signals[0].payload["transition"]["fromStatus"],
            serde_json::json!("pending")
        );
        assert_eq!(
            signals[0].payload["transition"]["toStatus"],
            serde_json::json!("approved")
        );
        assert_eq!(
            signals[0].payload["proposal"]["comments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            signals[1].payload["proposal"]["status"],
            serde_json::json!("approved")
        );
        assert_eq!(
            signals[1].payload["proposal"]["comments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(
            signals[1].payload["execution"]["failureMessage"]
                .as_str()
                .unwrap()
                .contains("approve_agent_access")
        );
        assert_eq!(signals[2].payload["scopeKey"], serde_json::json!("user-a"));
        assert_eq!(
            signals[2].payload["proposal"]["comments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn add_comment_appends_comment_to_proposal() {
        let app = test_router(test_state());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/proposals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"补记日志",
                            "action_type":"append_event",
                            "action_params":{"content":"补记晨会结论"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap().to_string();

        let comment_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/proposals/{proposal_id}/comments"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "author":{"publisher_type":"human","id":"alice","name":"Alice"},
                            "content":"先等我确认一下措辞"
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(comment_response.status(), StatusCode::CREATED);
        let body = comment_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let updated: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(updated["comments"].as_array().unwrap().len(), 1);
        assert_eq!(updated["comments"][0]["author"]["name"], "Alice");
        assert_eq!(updated["comments"][0]["content"], "先等我确认一下措辞");
    }

    #[tokio::test]
    async fn terminal_status_blocks_follow_up_updates() {
        let app = test_router(test_state());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"补记日志",
                            "action_type":"append_event",
                            "action_params":{"content":"补记晨会结论"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = create_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let proposal_id = created["id"].as_str().unwrap().to_string();

        let approve_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"approved"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(approve_response.status(), StatusCode::OK);

        let reject_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"rejected"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reject_response.status(), StatusCode::CONFLICT);

        let edit_response = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/proposals/{proposal_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"action_params":{"content":"重写"}}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(edit_response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn proposals_are_isolated_by_scope_aliases() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("proposals.sqlite");
        let proposal_store =
            Arc::new(crate::proposal::ProposalStore::with_sqlite_path(&sqlite_path).unwrap());
        let state = test_state_with_proposal_store(proposal_store.clone());
        let app = test_router(state);

        let anonymous_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"匿名提案",
                            "action_type":"append_event",
                            "action_params":{"content":"匿名事件"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(anonymous_response.status(), StatusCode::CREATED);

        let scoped_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/proposals?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "title":"Profile A 提案",
                            "action_type":"append_event",
                            "action_params":{"content":"profile-a 事件"},
                            "publisher":{"publisher_type":"agent","id":"agent-a","name":"Agent A"}
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(scoped_response.status(), StatusCode::CREATED);

        let anonymous_list = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/proposals")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = anonymous_list
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let anonymous_items: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let scoped_list = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/proposals?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = scoped_list.into_body().collect().await.unwrap().to_bytes();
        let scoped_items: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let user_alias_list = app
            .oneshot(
                Request::builder()
                    .uri("/api/proposals?user_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = user_alias_list
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let aliased_items: Vec<Value> = serde_json::from_slice(&body).unwrap();

        assert_eq!(anonymous_items.len(), 1);
        assert_eq!(anonymous_items[0]["title"], "匿名提案");
        assert_eq!(scoped_items.len(), 1);
        assert_eq!(scoped_items[0]["title"], "Profile A 提案");
        assert_eq!(aliased_items.len(), 1);
        assert_eq!(aliased_items[0]["title"], "Profile A 提案");
        assert_eq!(
            proposal_store
                .list(&ProposalFilter::default())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            proposal_store
                .list_scoped(Some("profile-a"), &ProposalFilter::default())
                .unwrap()
                .len(),
            1
        );
    }
}
