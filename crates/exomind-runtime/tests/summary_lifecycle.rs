use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use exomind_runtime::agent::session::{AgentSessionRecord, AgentSessionStore};
use exomind_runtime::agent::timeblock_summary::tools::SUBMIT_TIMEBLOCK_SUMMARY_TOOL;
use exomind_runtime::config::{ConfigStore, PutConfigEntryInput};
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::proposal::{
    ActionType, CreateProposalInput, ProposalFilter, ProposalStore, Publisher, PublisherType,
};
use exomind_runtime::signal::SignalEvent;
use exomind_runtime::task::TaskStore;
use exomind_runtime::timeblock::TimeBlockStore;
use exomind_runtime::{
    BuiltinActorProfile, RuntimeHandle, RuntimePublishRequest, RuntimeStartOptions,
    start_with_options,
};
use serde_json::{Value, json};
use tempfile::tempdir;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

const SCOPE: &str = "profile-summary-lifecycle";
const MODEL_WAIT: Duration = Duration::from_secs(3);
const QUIET_WAIT: Duration = Duration::from_millis(250);
const ROUTE_SEED_CHILD_DIR: &str = "EXOMIND_SUMMARY_LIFECYCLE_ROUTE_SEED_CHILD_DIR";

#[derive(Debug)]
struct PendingModelRequest {
    body: Value,
    completion: oneshot::Sender<Value>,
}

struct ControlledModel {
    base_url: String,
    requests: mpsc::UnboundedReceiver<PendingModelRequest>,
    server: JoinHandle<()>,
}

impl ControlledModel {
    async fn start() -> Self {
        let (request_tx, requests) = mpsc::unbounded_channel();
        let app = Router::new()
            .route("/chat/completions", post(controlled_model_request))
            .with_state(request_tx);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            base_url,
            requests,
            server,
        }
    }

    async fn next_request(&mut self) -> PendingModelRequest {
        tokio::time::timeout(MODEL_WAIT, self.requests.recv())
            .await
            .expect("summary should reach the controlled model")
            .expect("model request channel should remain open")
    }

    async fn assert_no_request(&mut self) {
        assert!(
            tokio::time::timeout(QUIET_WAIT, self.requests.recv())
                .await
                .is_err(),
            "a stopped summary service must not request another model turn"
        );
    }
}

impl Drop for ControlledModel {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn controlled_model_request(
    State(request_tx): State<mpsc::UnboundedSender<PendingModelRequest>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let (completion, response) = oneshot::channel();
    request_tx
        .send(PendingModelRequest { body, completion })
        .expect("test should retain the model request receiver");
    Json(response.await.unwrap_or_else(
        |_| json!({"choices": [{"message": {"role": "assistant", "content": "cancelled"}}]}),
    ))
}

fn summary_completion(block_id: &str) -> Value {
    json!({
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "controlled-summary-call",
                    "type": "function",
                    "function": {
                        "name": SUBMIT_TIMEBLOCK_SUMMARY_TOOL,
                        "arguments": json!({
                            "blockId": block_id,
                            "narrative": "Synthetic summary produced after controlled release."
                        }).to_string()
                    }
                }]
            }
        }]
    })
}

fn completed_payload(block_id: &str) -> Value {
    let end_time = chrono::Utc::now().timestamp_millis() as u64;
    json!({
        "scopeKey": SCOPE,
        "block": {
            "id": block_id,
            "name": block_id,
            "startId": block_id,
            "endId": format!("{block_id}-end"),
            "startTime": end_time - 60_000,
            "endTime": end_time,
            "blockType": "active"
        }
    })
}

fn publish_completed(runtime: &RuntimeHandle, block_id: &str) {
    runtime.publish_signal(RuntimePublishRequest {
        topic: "timeblock.replication.completed".to_string(),
        source: Some("summary-lifecycle-test".to_string()),
        origin_host_id: None,
        trace_id: None,
        payload: completed_payload(block_id),
    });
}

fn completed_signal(block_id: &str) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: format!("signal-{block_id}"),
        topic: "timeblock.replication.completed".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "summary-lifecycle-test".to_string(),
        origin_host_id: "retained-old-pool".to_string(),
        hop: 0,
        trace_id: None,
        payload: completed_payload(block_id),
    }
}

fn prepare_runtime_data(data_dir: &Path, base_url: &str) -> EventLogStore {
    let config = ConfigStore::with_sqlite_path(&data_dir.join("config.sqlite")).unwrap();
    for (key, value) in [
        ("builtin.timeblock_summary.enabled", "true"),
        ("exomind:activeScopeKey", SCOPE),
        ("exomind:agentApiProvider", "openai"),
        ("exomind:agentApiModel", "controlled-local-model"),
        ("exomind:agentApiBaseUrl", base_url),
        ("exomind:agentApiApiKey", "synthetic-local-key"),
    ] {
        config
            .put(PutConfigEntryInput {
                scope: "user".to_string(),
                key: key.to_string(),
                value: value.to_string(),
                sensitive: key == "exomind:agentApiApiKey",
                source: Some("summary-lifecycle-test".to_string()),
                source_origin: None,
            })
            .unwrap();
    }
    let store =
        EventLogStore::with_sqlite_path(data_dir.to_path_buf(), &data_dir.join("eventlog.sqlite"))
            .unwrap();
    store
        .append_event(
            Some(SCOPE),
            EventRecord {
                id: "untouched-note".to_string(),
                timestamp: chrono::Utc::now().timestamp_millis() - 1_000,
                content: "Synthetic note retained across shutdown.".to_string(),
                tags: vec!["note".to_string()],
                refs: Vec::new(),
                metadata: None,
            },
        )
        .unwrap();
    store
}

async fn start_summary_runtime(data_dir: &Path) -> RuntimeHandle {
    let mut options = RuntimeStartOptions::isolated(data_dir.to_path_buf());
    options.port = 0;
    options.spawn_builtin_actors = false;
    start_with_options(options).await.unwrap()
}

async fn current_summary_session(runtime: &RuntimeHandle, data_dir: &Path) -> AgentSessionRecord {
    let sessions = reqwest::get(format!(
        "http://127.0.0.1:{}/agents/timeblock_summary/sessions",
        runtime.port()
    ))
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    let session_id = sessions[0]["session_id"]
        .as_str()
        .expect("pending summary should have a persisted session");
    AgentSessionStore::with_sqlite_path(&data_dir.join("sessions.sqlite"))
        .unwrap()
        .get(session_id)
        .unwrap()
        .expect("pending session must exist in the real SQLite store")
}

enum ShutdownMode {
    JoinedStop,
    Drop,
}

async fn assert_pending_summary_is_discarded(mode: ShutdownMode) {
    let dir = tempdir().unwrap();
    let mut model = ControlledModel::start().await;
    let store = prepare_runtime_data(dir.path(), &model.base_url);
    let mut runtime = start_summary_runtime(dir.path()).await;
    let old_pool = runtime.clone_signal_pool();
    publish_completed(&runtime, "pending-before-shutdown");
    let pending = model.next_request().await;
    assert!(
        pending.body["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| { tool["function"]["name"] == SUBMIT_TIMEBLOCK_SUMMARY_TOOL })
    );
    let events_before = store.list_events(Some(SCOPE)).unwrap();
    let session_before = current_summary_session(&runtime, dir.path()).await;

    match mode {
        ShutdownMode::JoinedStop => {
            tokio::time::timeout(MODEL_WAIT, runtime.stop())
                .await
                .expect("stop should cancel a model request that has not returned")
                .unwrap();
        }
        ShutdownMode::Drop => drop(runtime),
    }

    old_pool.publish(completed_signal("published-after-shutdown"));
    // A real provider can finish after local cancellation. Release that result only now.
    let _ = pending
        .completion
        .send(summary_completion("pending-before-shutdown"));
    model.assert_no_request().await;

    assert_eq!(store.list_events(Some(SCOPE)).unwrap(), events_before);
    let sessions =
        AgentSessionStore::with_sqlite_path(&dir.path().join("sessions.sqlite")).unwrap();
    assert_eq!(
        sessions.get(&session_before.session_id).unwrap(),
        Some(session_before)
    );
}

#[tokio::test]
async fn runtime_stop_discards_pending_model_result_and_retained_pool_signals() {
    assert_pending_summary_is_discarded(ShutdownMode::JoinedStop).await;
}

#[tokio::test]
async fn runtime_drop_discards_late_summary_output() {
    assert_pending_summary_is_discarded(ShutdownMode::Drop).await;
}

#[tokio::test]
async fn runtime_restart_with_same_storage_keeps_only_the_new_summary_service() {
    let dir = tempdir().unwrap();
    let mut model = ControlledModel::start().await;
    let store = prepare_runtime_data(dir.path(), &model.base_url);
    let mut first = start_summary_runtime(dir.path()).await;
    let old_pool = first.clone_signal_pool();
    first.stop().await.unwrap();
    let mut second = start_summary_runtime(dir.path()).await;

    old_pool.publish(completed_signal("retired-runtime-block"));
    publish_completed(&second, "current-runtime-block");
    let pending = model.next_request().await;
    assert!(pending.body.to_string().contains("current-runtime-block"));
    pending
        .completion
        .send(summary_completion("current-runtime-block"))
        .expect("the new service should still await its model result");

    tokio::time::timeout(MODEL_WAIT, async {
        loop {
            if store.list_events(Some(SCOPE)).unwrap().iter().any(|event| {
                event
                    .metadata
                    .as_ref()
                    .is_some_and(|metadata| metadata["block_id"] == "current-runtime-block")
            }) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the new service should submit its summary");
    model.assert_no_request().await;
    second.stop().await.unwrap();

    let summary_blocks = store
        .list_events(Some(SCOPE))
        .unwrap()
        .into_iter()
        .filter(|event| event.tags.iter().any(|tag| tag == "agent_feedback"))
        .map(|event| event.metadata.unwrap()["block_id"].clone())
        .collect::<Vec<_>>();
    assert_eq!(summary_blocks, vec![json!("current-runtime-block")]);
}

#[test]
fn isolated_options_do_not_create_storage_during_construction() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("not-created");
    let _options = RuntimeStartOptions::isolated(data_dir.clone());
    assert!(!data_dir.exists());
}

#[tokio::test]
async fn isolated_runtime_owns_all_storage_paths_even_with_copied_mesh_and_signal_overrides() {
    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("isolated-runtime");
    let outside_dir = dir.path().join("inherited-overrides");
    let mut options = RuntimeStartOptions::isolated(data_dir.clone());
    options.port = 0;
    options.mesh_state_path = Some(outside_dir.join("mesh-state.json"));
    options.signal_storage_path = Some(outside_dir.join("signal-pool.sqlite"));
    let mut runtime = start_with_options(options).await.unwrap();
    runtime
        .clone_mesh_state()
        .set_peer_interests("synthetic-peer", vec!["synthetic.topic".to_string()]);
    runtime.stop().await.unwrap();

    for filename in [
        "mesh-state.json",
        "signal-pool.sqlite",
        "eventlog.sqlite",
        "config.sqlite",
        "reminders.sqlite",
        "tasks.sqlite",
        "proposals.sqlite",
        "timeblocks.sqlite",
        "sessions.sqlite",
    ] {
        assert!(data_dir.join(filename).is_file(), "missing {filename}");
    }
    assert!(!outside_dir.exists());
}

#[tokio::test]
async fn isolated_runtime_keeps_summary_available_without_heartbeat_or_life_agents() {
    let dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(dir.path().to_path_buf());
    options.port = 0;
    options.spawn_autonomous_agents = true;
    let mut runtime = start_with_options(options).await.unwrap();
    let agents = reqwest::get(format!("http://127.0.0.1:{}/agents", runtime.port()))
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json::<Vec<Value>>()
        .await
        .unwrap();
    runtime.stop().await.unwrap();
    let ids = agents
        .iter()
        .map(|agent| agent["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(ids.contains(&"timeblock_summary"));
    assert!(!ids.contains(&"heartbeat"));
    assert!(!ids.contains(&"life-alpha"));
    assert!(!dir.path().join("agents").join("life-alpha").exists());
}

#[tokio::test]
async fn recording_profile_preserves_input_and_recording_replication_without_legacy_writes() {
    let dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(dir.path().to_path_buf());
    options.port = 0;
    assert_eq!(
        options.builtin_actor_profile,
        BuiltinActorProfile::Recording
    );
    let mut runtime = start_with_options(options).await.unwrap();
    let pool = runtime.clone_signal_pool();
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    let mut rx = pool.subscribe();
    let make_event = |topic: &str, payload: Value| SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "recording-profile-test".to_string(),
        origin_host_id: "synthetic-remote-peer".to_string(),
        hop: 0,
        trace_id: None,
        payload,
    };
    pool.publish(make_event(
        "user.input.text",
        json!({"text": "recording input survives"}),
    ));
    tokio::time::timeout(MODEL_WAIT, async {
        loop {
            let event = rx.recv().await.unwrap();
            if event.topic == "eventlog.appended"
                && event.payload["text"] == "recording input survives"
            {
                break;
            }
        }
    })
    .await
    .expect("recording input and eventlog actors should remain active");

    let task = TaskStore::new()
        .create(serde_json::from_value(json!({"title": "blocked replicated task"})).unwrap());
    let proposal = ProposalStore::new()
        .create(CreateProposalInput {
            title: "blocked replicated proposal".to_string(),
            body: String::new(),
            action_type: ActionType::AppendEvent,
            action_params: json!({"content": "blocked proposal body"}),
            references: Vec::new(),
            publisher: Publisher {
                publisher_type: PublisherType::Agent,
                id: "synthetic-agent".to_string(),
                name: "Synthetic Agent".to_string(),
            },
        })
        .unwrap();
    pool.publish(make_event(
        "external.input.received",
        json!({"text": "blocked external input", "source_type": "synthetic"}),
    ));
    pool.publish(make_event(
        "task.auto-created",
        json!({"title": "blocked automatic task", "note": null}),
    ));
    pool.publish(make_event(
        "task.replication.upserted",
        json!({"scopeKey": SCOPE, "task": task}),
    ));
    pool.publish(make_event(
        "proposal.replication.upserted",
        json!({"scopeKey": SCOPE, "proposal": proposal}),
    ));
    pool.publish(make_event(
        "eventlog.replication.appended",
        json!({
            "scopeKey": SCOPE,
            "record": EventRecord {
                id: "recording-replicated-event".to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                content: "recording replication survives".to_string(),
                tags: vec!["note".to_string()],
                refs: Vec::new(),
                metadata: None,
            }
        }),
    ));
    pool.publish(completed_signal("recording-replicated-block"));

    let events = EventLogStore::with_sqlite_path(
        dir.path().to_path_buf(),
        &dir.path().join("eventlog.sqlite"),
    )
    .unwrap();
    let timeblocks =
        TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap();
    tokio::time::timeout(MODEL_WAIT, async {
        loop {
            if events
                .list_events(Some(SCOPE))
                .unwrap()
                .iter()
                .any(|event| event.id == "recording-replicated-event")
                && timeblocks
                    .get_completed_by_start_id_scoped(Some(SCOPE), "recording-replicated-block")
                    .unwrap()
                    .is_some()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("recording profile must still persist eventlog and timeblock replication");
    assert!(
        tokio::time::timeout(QUIET_WAIT, async {
            loop {
                let event = rx.recv().await.unwrap();
                if event.topic == "external.input.ingested"
                    || (event.topic == "user.input.normalized"
                        && event.payload["text"] == "blocked external input")
                {
                    return event;
                }
            }
        })
        .await
        .is_err(),
        "external input must not be normalized by the recording profile"
    );
    runtime.stop().await.unwrap();
    let tasks = TaskStore::with_sqlite_path(&dir.path().join("tasks.sqlite")).unwrap();
    assert!(tasks.list().is_empty());
    assert!(tasks.list_scoped(Some(SCOPE)).is_empty());
    let proposals = ProposalStore::with_sqlite_path(&dir.path().join("proposals.sqlite")).unwrap();
    assert!(
        proposals
            .list_scoped(Some(SCOPE), &ProposalFilter::default())
            .unwrap()
            .is_empty()
    );
}

#[cfg(windows)]
#[tokio::test]
async fn runtime_bind_rejects_an_existing_reusable_wildcard_listener() {
    let dir = tempdir().unwrap();
    let foreign = tokio::net::TcpSocket::new_v4().unwrap();
    foreign.set_reuseaddr(true).unwrap();
    foreign.bind("0.0.0.0:0".parse().unwrap()).unwrap();
    let foreign = foreign.listen(1024).unwrap();
    let mut options = RuntimeStartOptions::isolated(dir.path().to_path_buf());
    options.port = foreign.local_addr().unwrap().port();
    options.spawn_builtin_actors = false;
    match start_with_options(options).await {
        Err(exomind_runtime::RuntimeStartError::BindListener { .. }) => {}
        Err(error) => panic!("unexpected startup error: {error}"),
        Ok(mut duplicate) => {
            duplicate.stop().await.unwrap();
            panic!("runtime must not share a port with a foreign wildcard listener");
        }
    }
    assert!(foreign.local_addr().is_ok());
}

#[cfg(windows)]
#[tokio::test]
async fn running_runtime_prevents_reusable_wildcard_socket_from_sharing_its_port() {
    let dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(dir.path().to_path_buf());
    options.port = 0;
    options.spawn_builtin_actors = false;
    let mut runtime = start_with_options(options).await.unwrap();
    let foreign = tokio::net::TcpSocket::new_v4().unwrap();
    foreign.set_reuseaddr(true).unwrap();
    let conflict = foreign.bind(std::net::SocketAddr::from(([0, 0, 0, 0], runtime.port())));
    runtime.stop().await.unwrap();
    assert!(
        conflict.is_err(),
        "live runtime must own its Windows port exclusively"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn runtime_stop_releases_wildcard_reservation_while_handle_is_retained() {
    let first_dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(first_dir.path().to_path_buf());
    options.port = 0;
    options.spawn_builtin_actors = false;
    let mut first = start_with_options(options).await.unwrap();
    let port = first.port();
    first.stop().await.unwrap();

    let second_dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(second_dir.path().to_path_buf());
    options.bind_host = "0.0.0.0".to_string();
    options.port = port;
    options.spawn_builtin_actors = false;
    let mut second = start_with_options(options)
        .await
        .expect("stop must release the reservation before returning, even while the handle exists");
    second.stop().await.unwrap();
}

#[tokio::test]
async fn isolated_runtime_rejects_missing_explicit_data_directory() {
    let dir = tempdir().unwrap();
    let mut options = RuntimeStartOptions::isolated(dir.path().to_path_buf());
    options.data_dir = None;
    assert!(matches!(
        start_with_options(options).await,
        Err(exomind_runtime::RuntimeStartError::MissingIsolatedDataDir)
    ));
}

#[tokio::test]
async fn isolated_runtime_loads_local_route_seed_ignoring_environment_route_file() {
    if let Some(data_dir) = std::env::var_os(ROUTE_SEED_CHILD_DIR) {
        let mut options = RuntimeStartOptions::isolated(PathBuf::from(data_dir));
        options.port = 0;
        let mut runtime = start_with_options(options).await.unwrap();
        let routes = runtime.clone_signal_pool().routes().get_all();
        runtime.stop().await.unwrap();

        for topic in [
            "voice.input.transcript",
            "user.input.text",
            "user.input.normalized",
            "*",
            "synthetic.local.seed",
        ] {
            assert!(
                routes.iter().any(|route| route.topic == topic),
                "isolated bundled route was not loaded: {topic}"
            );
        }
        assert!(
            !routes
                .iter()
                .any(|route| route.topic == "synthetic.ambient.seed"),
            "isolated runtime must ignore EXOMIND_RT_SIGNAL_ROUTES_DEFAULT"
        );
        return;
    }

    let dir = tempdir().unwrap();
    let data_dir = dir.path().join("isolated-runtime");
    let config_dir = data_dir.join("config");
    std::fs::create_dir_all(&config_dir).unwrap();
    let bundled_routes = json!([
        {"topic": "voice.input.transcript", "target_type": "actor", "target_ref": "input_ingest"},
        {"topic": "user.input.text", "target_type": "actor", "target_ref": "input_ingest"},
        {"topic": "user.input.normalized", "target_type": "actor", "target_ref": "eventlog"},
        {"topic": "*", "target_type": "frontend", "target_ref": "ui"},
        {"topic": "synthetic.local.seed", "target_type": "actor", "target_ref": "input_ingest"}
    ]);
    std::fs::write(
        config_dir.join("signal-routes.default.json"),
        bundled_routes.to_string(),
    )
    .unwrap();
    let ambient_routes = dir.path().join("ambient-route-seed.json");
    std::fs::write(
        &ambient_routes,
        json!([{
            "topic": "synthetic.ambient.seed",
            "target_type": "actor",
            "target_ref": "input_ingest"
        }])
        .to_string(),
    )
    .unwrap();

    // The child gets conflicting environment input without mutating this test process.
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "isolated_runtime_loads_local_route_seed_ignoring_environment_route_file",
            "--nocapture",
        ])
        .env(ROUTE_SEED_CHILD_DIR, &data_dir)
        .env("EXOMIND_RT_SIGNAL_ROUTES_DEFAULT", &ambient_routes)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "isolated route seed child failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
