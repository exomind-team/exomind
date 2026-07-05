mod support;

use std::time::Duration;

use exomind_runtime::{
    RuntimeHandle, RuntimeStartOptions,
    ens::{
        EnsEndpointAdvertisement, EnsInterfaceTopology, ReticulumEnsInterfaceConfig,
        ReticulumEnsProviderConfig,
    },
    eventlog::EventRecord,
    eventlog_appender::EVENTLOG_REPLICATION_APPENDED_TOPIC,
    mesh::{MeshState, PeerInfo, PeerStatus},
    proposal::{ActionType, ProposalStatus},
    signal::SignalEvent,
    start_with_options,
    task::{Task, TaskPriority, TaskStatus},
    timeblock::{ActiveBlockData, BlockPhase, BlockTransition, BlockTransitionType, TimeBlockData},
};
use support::{stop_runtime, wait_until};
use tempfile::{TempDir, tempdir};

const TASK_REPLICATION_TOPIC: &str = "task.replication.upserted";
const TIMEBLOCK_ACTIVE_REPLICATION_TOPIC: &str = "timeblock.replication.active_upserted";
const TIMEBLOCK_COMPLETED_REPLICATION_TOPIC: &str = "timeblock.replication.completed";
const PROPOSAL_REPLICATION_TOPIC: &str = "proposal.replication.upserted";

struct RuntimeTcpPair {
    handle_a: RuntimeHandle,
    handle_b: RuntimeHandle,
    endpoint_b: EnsEndpointAdvertisement,
    _dir_a: TempDir,
    _dir_b: TempDir,
}

async fn start_connected_tcp_runtime_pair(topics: Vec<String>) -> RuntimeTcpPair {
    let dir_a = tempdir().expect("runtime A tempdir");
    let dir_b = tempdir().expect("runtime B tempdir");

    let handle_b = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-reticulum-b".to_string(),
        device_id: "dev-reticulum-b".to_string(),
        spawn_builtin_actors: true,
        spawn_ts_agents: false,
        mesh_state_path: Some(dir_b.path().join("mesh-state.json")),
        signal_storage_path: Some(dir_b.path().join("signals.sqlite")),
        enable_mdns: false,
        reticulum_ens: Some(ReticulumEnsProviderConfig {
            local_registry_path: None,
            interfaces: vec![ReticulumEnsInterfaceConfig::TcpServer {
                bind_addr: "127.0.0.1:0".to_string(),
                topology: EnsInterfaceTopology::Active,
            }],
            load_local_registry: false,
            publish_local_registry: false,
        }),
        data_dir: Some(dir_b.path().to_path_buf()),
        ..Default::default()
    })
    .await
    .expect("runtime B should start with Reticulum TCP server");

    let endpoint_b = wait_for_runtime_endpoint(&handle_b, "B", |endpoint| {
        endpoint
            .interface_address
            .as_deref()
            .and_then(tcp_endpoint_port)
            .is_some()
    })
    .await;
    let node_b_port = endpoint_b
        .interface_address
        .as_deref()
        .and_then(tcp_endpoint_port)
        .expect("runtime B TCP endpoint should expose a non-zero port");

    let handle_a = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-reticulum-a".to_string(),
        device_id: "dev-reticulum-a".to_string(),
        spawn_builtin_actors: true,
        spawn_ts_agents: false,
        mesh_state_path: Some(dir_a.path().join("mesh-state.json")),
        signal_storage_path: Some(dir_a.path().join("signals.sqlite")),
        enable_mdns: false,
        reticulum_ens: Some(ReticulumEnsProviderConfig {
            local_registry_path: None,
            interfaces: vec![ReticulumEnsInterfaceConfig::TcpClient {
                remote_addr: format!("127.0.0.1:{node_b_port}"),
                topology: EnsInterfaceTopology::Active,
            }],
            load_local_registry: false,
            publish_local_registry: false,
        }),
        data_dir: Some(dir_a.path().to_path_buf()),
        ..Default::default()
    })
    .await
    .expect("runtime A should start with Reticulum TCP client");

    let endpoint_a = wait_for_runtime_endpoint(&handle_a, "A", |endpoint| {
        endpoint.reticulum_destination.is_some()
    })
    .await;
    yield_for_runtime_actors().await;

    handle_a
        .clone_ens_transport()
        .upsert_discovered_endpoint(endpoint_b.clone())
        .expect("runtime A should accept runtime B discovered endpoint");
    handle_b
        .clone_ens_transport()
        .upsert_discovered_endpoint(endpoint_a.clone())
        .expect("runtime B should accept runtime A discovered endpoint");

    authorize_peer(
        &handle_a.clone_mesh_state(),
        &endpoint_b.identity_hex,
        "rt-reticulum-b",
    );
    authorize_peer(
        &handle_b.clone_mesh_state(),
        &endpoint_a.identity_hex,
        "rt-reticulum-a",
    );
    handle_a
        .clone_mesh_state()
        .set_peer_interests(&endpoint_b.identity_hex, topics);
    yield_for_runtime_actors().await;

    RuntimeTcpPair {
        handle_a,
        handle_b,
        endpoint_b,
        _dir_a: dir_a,
        _dir_b: dir_b,
    }
}

fn authorize_peer(mesh: &MeshState, identity_hex: &str, host_id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    mesh.upsert_peer(PeerInfo {
        id: identity_hex.to_string(),
        base_url: "http://reticulum-gateway-only.invalid".to_string(),
        enabled: true,
        capabilities: vec!["ens-control".to_string(), format!("host_id:{host_id}")],
        status: PeerStatus::Unknown,
        last_seen: None,
        last_error: None,
        created_at: now.clone(),
        updated_at: now,
        auth_token: Some(format!("outbound-token-{identity_hex}")),
        inbound_secret: Some(format!("inbound-token-{identity_hex}")),
    });
}

fn sample_event_record(id: &str) -> EventRecord {
    EventRecord {
        id: id.to_string(),
        timestamp: 1_710_000_000_000,
        content: "Runtime Reticulum TCP event".to_string(),
        tags: vec!["note".to_string(), "reticulum".to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "source": {
                "deviceId": "runtime-reticulum-node-a"
            }
        })),
    }
}

fn signal_event(
    signal_id: &str,
    topic: &str,
    origin_host_id: &str,
    payload: serde_json::Value,
) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: signal_id.to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "test:runtime-reticulum-sync".to_string(),
        origin_host_id: origin_host_id.to_string(),
        hop: 0,
        trace_id: Some(format!("runtime-reticulum-test:{signal_id}")),
        payload,
    }
}

fn sample_active_block() -> ActiveBlockData {
    ActiveBlockData {
        start_id: "tb-start-1".to_string(),
        name: "deep work".to_string(),
        mode: "countup".to_string(),
        target_minutes: None,
        block_type: Some("active".to_string()),
        elapsed: 1000,
        updated_at: Some(1_710_000_002_000),
        phase: Some(BlockPhase::Running),
        version: Some(2),
        actor_id: None,
        last_transition_at: Some(1_710_000_002_000),
        last_resumed_at: Some(1_710_000_001_000),
        accumulated_run_ms: Some(1000),
        start_time: 1_710_000_001_000,
        action_ended_at: None,
        feedback_started_at: None,
        feedback_submitted_at: None,
        pause_accumulated_ms: Some(0),
        paused: false,
        paused_at: None,
        task_ids: vec![],
        task_association_log: vec![],
        source_planned_block_id: None,
        transitions: vec![BlockTransition {
            transition_type: BlockTransitionType::Start,
            at: 1_710_000_001_000,
            actor_id: Some("rt-reticulum-a".to_string()),
        }],
        task_id: None,
    }
}

fn sample_completed_block() -> TimeBlockData {
    TimeBlockData {
        id: "tb-start-1".to_string(),
        name: "deep work".to_string(),
        start_id: "tb-start-1".to_string(),
        end_id: "tb-end-1".to_string(),
        note: Some("done".to_string()),
        tags: vec!["focus".to_string()],
        start_time: 1_710_000_001_000,
        end_time: 1_710_003_601_000,
        block_type: Some("active".to_string()),
        task_ids: vec![],
        task_status_outcomes: None,
        task_association_log: vec![],
        source_planned_block_id: None,
        transitions: vec![
            BlockTransition {
                transition_type: BlockTransitionType::Start,
                at: 1_710_000_001_000,
                actor_id: Some("rt-reticulum-a".to_string()),
            },
            BlockTransition {
                transition_type: BlockTransitionType::End,
                at: 1_710_003_601_000,
                actor_id: Some("rt-reticulum-a".to_string()),
            },
        ],
    }
}

fn tcp_endpoint_port(address: &str) -> Option<u16> {
    let port = address.rsplit_once(':')?.1.parse::<u16>().ok()?;
    (port != 0).then_some(port)
}

async fn wait_for_runtime_endpoint(
    handle: &RuntimeHandle,
    label: &str,
    predicate: impl Fn(&EnsEndpointAdvertisement) -> bool,
) -> EnsEndpointAdvertisement {
    for _ in 0..250 {
        if let Some(endpoint) = handle.clone_ens_transport().snapshot().local_endpoint
            && predicate(&endpoint)
        {
            return endpoint;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    panic!("runtime {label} Reticulum endpoint did not become ready");
}

async fn wait_for_runtime_event(
    handle: &RuntimeHandle,
    scope: Option<&str>,
    event_id: &str,
) -> EventRecord {
    let store = handle.clone_eventlog_store();
    let replicated = wait_until(Duration::from_secs(5), || {
        store
            .get_event(scope, event_id)
            .expect("query runtime eventlog")
            .is_some()
    })
    .await;
    assert!(replicated, "runtime event {event_id} was not replicated");

    store
        .get_event(scope, event_id)
        .expect("query replicated runtime eventlog")
        .expect("replicated runtime event should exist")
}

async fn wait_for_runtime_task(handle: &RuntimeHandle, scope: Option<&str>, task_id: &str) -> Task {
    let store = handle.clone_task_store();
    let replicated = wait_until(Duration::from_secs(5), || {
        store.get_scoped(scope, task_id).is_some()
    })
    .await;
    assert!(replicated, "runtime task {task_id} was not replicated");

    store
        .get_scoped(scope, task_id)
        .expect("replicated runtime task should exist")
}

async fn wait_for_runtime_active_block(
    handle: &RuntimeHandle,
    scope: Option<&str>,
) -> ActiveBlockData {
    let store = handle.clone_timeblock_store();
    let replicated = wait_until(Duration::from_secs(5), || {
        store
            .get_active_scoped(scope)
            .expect("query runtime active timeblock")
            .is_some()
    })
    .await;
    assert!(replicated, "runtime active timeblock was not replicated");

    store
        .get_active_scoped(scope)
        .expect("query replicated runtime active timeblock")
        .expect("replicated runtime active timeblock should exist")
}

async fn wait_for_runtime_completed_block(
    handle: &RuntimeHandle,
    scope: Option<&str>,
    start_id: &str,
) -> TimeBlockData {
    let store = handle.clone_timeblock_store();
    let replicated = wait_until(Duration::from_secs(5), || {
        store
            .list_completed_scoped(scope)
            .expect("query runtime completed timeblocks")
            .iter()
            .any(|block| block.start_id == start_id)
    })
    .await;
    assert!(
        replicated,
        "runtime completed timeblock {start_id} was not replicated"
    );

    store
        .list_completed_scoped(scope)
        .expect("query replicated runtime completed timeblocks")
        .into_iter()
        .find(|block| block.start_id == start_id)
        .expect("replicated runtime completed timeblock should exist")
}

async fn wait_for_runtime_active_block_cleared(handle: &RuntimeHandle, scope: Option<&str>) {
    let store = handle.clone_timeblock_store();
    let cleared = wait_until(Duration::from_secs(5), || {
        store
            .get_active_scoped(scope)
            .expect("query runtime active timeblock")
            .is_none()
    })
    .await;
    assert!(
        cleared,
        "runtime active timeblock should be cleared by completed block"
    );
}

async fn wait_for_runtime_proposal(
    handle: &RuntimeHandle,
    scope: Option<&str>,
    proposal_id: &str,
) -> exomind_runtime::proposal::Proposal {
    let store = handle.clone_proposal_store();
    let replicated = wait_until(Duration::from_secs(5), || {
        store
            .get_scoped(scope, proposal_id)
            .expect("query runtime proposal")
            .is_some()
    })
    .await;
    assert!(
        replicated,
        "runtime proposal {proposal_id} was not replicated"
    );

    store
        .get_scoped(scope, proposal_id)
        .expect("query replicated runtime proposal")
        .expect("replicated runtime proposal should exist")
}

async fn yield_for_runtime_actors() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::time::sleep(Duration::from_millis(30)).await;
}

#[tokio::test]
async fn runtime_reticulum_tcp_syncs_eventlog_between_two_started_runtimes() {
    let mut pair =
        start_connected_tcp_runtime_pair(vec![EVENTLOG_REPLICATION_APPENDED_TOPIC.to_string()])
            .await;

    let event_id = "event-runtime-reticulum-tcp";
    pair.handle_a
        .eventlog_appender()
        .append_event(Some("profile-sync"), sample_event_record(event_id))
        .await
        .expect("runtime A eventlog append should succeed");

    let signal = pair
        .handle_a
        .clone_signal_pool()
        .window()
        .recent(10)
        .into_iter()
        .find(|event| {
            event.topic == EVENTLOG_REPLICATION_APPENDED_TOPIC
                && event
                    .payload
                    .get("record")
                    .and_then(|record| record.get("id"))
                    .and_then(|id| id.as_str())
                    == Some(event_id)
        })
        .expect("eventlog append should publish a replication signal");

    let sent = pair
        .handle_a
        .clone_ens_transport()
        .send_signal_event_to_peer(&pair.endpoint_b.identity_hex, signal)
        .expect("runtime A should send the replication signal through Reticulum TCP");
    assert!(sent);

    let replicated = wait_for_runtime_event(&pair.handle_b, Some("profile-sync"), event_id).await;
    let expected = sample_event_record(event_id);
    assert_eq!(replicated.timestamp, expected.timestamp);
    assert_eq!(replicated.content, expected.content);
    assert_eq!(replicated.tags, expected.tags);
    assert_eq!(replicated.refs, expected.refs);
    assert_eq!(replicated.metadata, expected.metadata);

    stop_runtime(&mut pair.handle_a, "rt-reticulum-a").await;
    stop_runtime(&mut pair.handle_b, "rt-reticulum-b").await;
}

#[tokio::test]
async fn runtime_reticulum_tcp_syncs_domain_frames_between_two_started_runtimes() {
    let mut pair = start_connected_tcp_runtime_pair(vec![
        TASK_REPLICATION_TOPIC.to_string(),
        TIMEBLOCK_ACTIVE_REPLICATION_TOPIC.to_string(),
        TIMEBLOCK_COMPLETED_REPLICATION_TOPIC.to_string(),
        PROPOSAL_REPLICATION_TOPIC.to_string(),
    ])
    .await;

    let task_signal = signal_event(
        "signal-runtime-task-1",
        TASK_REPLICATION_TOPIC,
        "rt-reticulum-a",
        serde_json::json!({
            "scopeKey": "profile-sync",
            "task": {
                "id": "task-1",
                "title": "replicated task",
                "description": "from started runtime Reticulum TCP",
                "done_condition": null,
                "status": "pending",
                "priority": "medium",
                "tags": ["reticulum"],
                "source": "remote",
                "parent_id": null,
                "depends_on": [],
                "due_at": null,
                "estimated_minutes": 25,
                "time_block_ids": [],
                "status_transitions": [{
                    "id": "task-1:task.create:1710000000000",
                    "at": 1710000000000u64,
                    "to_status": "pending",
                    "reason": "task.create"
                }],
                "created_at": 1710000000000u64,
                "updated_at": 1710000001000u64,
                "completed_at": null
            }
        }),
    );
    let active_block_signal = signal_event(
        "signal-runtime-active-timeblock-1",
        TIMEBLOCK_ACTIVE_REPLICATION_TOPIC,
        "rt-reticulum-a",
        serde_json::json!({
            "scopeKey": "profile-sync",
            "active": sample_active_block()
        }),
    );
    let completed_block_signal = signal_event(
        "signal-runtime-completed-timeblock-1",
        TIMEBLOCK_COMPLETED_REPLICATION_TOPIC,
        "rt-reticulum-a",
        serde_json::json!({
            "scopeKey": "profile-sync",
            "block": sample_completed_block()
        }),
    );
    let proposal_signal = signal_event(
        "signal-runtime-proposal-1",
        PROPOSAL_REPLICATION_TOPIC,
        "rt-reticulum-a",
        serde_json::json!({
            "scopeKey": "profile-sync",
            "proposal": {
                "id": "proposal-42",
                "title": "replicated proposal",
                "body": "from started runtime Reticulum TCP",
                "action_type": "append_event",
                "action_params": { "content": "hello", "tags": ["proposal"] },
                "references": [],
                "status": "pending",
                "publisher": {
                    "publisher_type": "human",
                    "id": "remote-user",
                    "name": "Remote User"
                },
                "comments": [],
                "snooze_until": null,
                "created_at": "2026-04-06T00:00:00Z",
                "updated_at": "2026-04-06T00:00:10Z"
            }
        }),
    );

    let sent = pair
        .handle_a
        .clone_ens_transport()
        .send_signal_event_to_peer(&pair.endpoint_b.identity_hex, task_signal)
        .expect("runtime A should send task replication signal through Reticulum TCP");
    assert!(sent);
    let task = wait_for_runtime_task(&pair.handle_b, Some("profile-sync"), "task-1").await;
    assert_eq!(task.title, "replicated task");
    assert_eq!(task.priority, TaskPriority::Medium);
    assert_eq!(task.status, TaskStatus::Pending);

    let sent = pair
        .handle_a
        .clone_ens_transport()
        .send_signal_event_to_peer(&pair.endpoint_b.identity_hex, active_block_signal)
        .expect("runtime A should send active timeblock signal through Reticulum TCP");
    assert!(sent);
    let active_block = wait_for_runtime_active_block(&pair.handle_b, Some("profile-sync")).await;
    assert_eq!(active_block.start_id, "tb-start-1");
    assert_eq!(active_block.phase, Some(BlockPhase::Running));

    let sent = pair
        .handle_a
        .clone_ens_transport()
        .send_signal_event_to_peer(&pair.endpoint_b.identity_hex, completed_block_signal)
        .expect("runtime A should send completed timeblock signal through Reticulum TCP");
    assert!(sent);
    let completed_block =
        wait_for_runtime_completed_block(&pair.handle_b, Some("profile-sync"), "tb-start-1").await;
    assert_eq!(completed_block.start_id, "tb-start-1");
    wait_for_runtime_active_block_cleared(&pair.handle_b, Some("profile-sync")).await;

    let sent = pair
        .handle_a
        .clone_ens_transport()
        .send_signal_event_to_peer(&pair.endpoint_b.identity_hex, proposal_signal)
        .expect("runtime A should send proposal replication signal through Reticulum TCP");
    assert!(sent);
    let proposal =
        wait_for_runtime_proposal(&pair.handle_b, Some("profile-sync"), "proposal-42").await;
    assert_eq!(proposal.title, "replicated proposal");
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.action_type, ActionType::AppendEvent);

    stop_runtime(&mut pair.handle_a, "rt-reticulum-a").await;
    stop_runtime(&mut pair.handle_b, "rt-reticulum-b").await;
}
