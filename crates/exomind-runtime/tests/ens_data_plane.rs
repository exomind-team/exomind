use std::sync::Arc;

use exomind_runtime::ens::{
    EnsDataFrame, EnsEndpointAdvertisement, EnsGatewayKind, EnsInterfaceMedium, EnsPeerIdentity,
    EnsReceivedDataFrame, EnsSignalEventFrame, EnsTransportError, EnsTransportService,
};
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::eventlog_appender::{
    EVENTLOG_REPLICATION_APPENDED_TOPIC, EventLogAppender, build_eventlog_replication_signal,
};
use exomind_runtime::mesh::{MeshState, PeerInfo, PeerStatus};
use exomind_runtime::pairing::PairingManager;
use exomind_runtime::proposal::ProposalStore;
use exomind_runtime::proposal::{ActionType, ProposalStatus};
use exomind_runtime::signal::SignalEvent;
use exomind_runtime::signal::actors::replication_actor::spawn_replication_actor;
use exomind_runtime::task::TaskStore;
use exomind_runtime::task::{TaskPriority, TaskStatus};
use exomind_runtime::timeblock::{
    ActiveBlockData, BlockPhase, BlockTransition, BlockTransitionType, TimeBlockData,
    TimeBlockStore,
};
use tempfile::TempDir;

struct TestNode {
    service: EnsTransportService,
    provider: Arc<exomind_runtime::ens::FakeEnsProvider>,
    mesh: Arc<MeshState>,
    signal_pool: Arc<exomind_runtime::signal::SignalPool>,
    eventlog_store: Arc<EventLogStore>,
    task_store: Arc<TaskStore>,
    timeblock_store: Arc<TimeBlockStore>,
    proposal_store: Arc<ProposalStore>,
    _data_dir: TempDir,
    _replication_handle: tokio::task::JoinHandle<()>,
}

fn endpoint_for(identity_hex: &str, host_id: &str, address: &str) -> EnsEndpointAdvertisement {
    EnsEndpointAdvertisement {
        identity_hex: identity_hex.to_string(),
        host_id: Some(host_id.to_string()),
        gateway: EnsGatewayKind::Reticulum,
        via_interface: Some("lan-udp".to_string()),
        via_medium: Some(EnsInterfaceMedium::Udp),
        runtime_base_url: Some(address.to_string()),
        reticulum_destination: Some(format!("reticulum-destination-{identity_hex}")),
        interface_address: Some(format!("udp://{address}")),
        discovery_source: "fake-provider".to_string(),
        capabilities: vec!["eventlog.replication".to_string()],
    }
}

fn test_node(host_id: &str, identity_hex: &str, address: &str) -> TestNode {
    let signal_pool = Arc::new(exomind_runtime::signal::SignalPool::new(None));
    let mesh = Arc::new(MeshState::new(
        host_id.to_string(),
        Arc::clone(&signal_pool),
        None,
    ));
    let pairing = Arc::new(PairingManager::new());
    let endpoint = endpoint_for(identity_hex, host_id, address);
    let (service, provider) = EnsTransportService::new_fake_with_endpoint(
        host_id.to_string(),
        Arc::clone(&mesh),
        pairing,
        endpoint,
    );
    let data_dir = tempfile::tempdir().expect("eventlog tempdir");
    let eventlog_store = Arc::new(EventLogStore::new(data_dir.path().to_path_buf()));
    let task_store = Arc::new(TaskStore::new());
    let timeblock_store = Arc::new(TimeBlockStore::new());
    let proposal_store = Arc::new(ProposalStore::new());
    let replication_handle = spawn_replication_actor(
        Arc::clone(&signal_pool),
        host_id.to_string(),
        Arc::clone(&eventlog_store),
        Arc::clone(&task_store),
        Arc::clone(&timeblock_store),
        Arc::clone(&proposal_store),
    );

    TestNode {
        service,
        provider,
        mesh,
        signal_pool,
        eventlog_store,
        task_store,
        timeblock_store,
        proposal_store,
        _data_dir: data_dir,
        _replication_handle: replication_handle,
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
        content: "Reticulum data-plane event".to_string(),
        tags: vec!["note".to_string(), "reticulum".to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "source": {
                "deviceId": "identity-a"
            }
        })),
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
            actor_id: Some("rt-a".to_string()),
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
                actor_id: Some("rt-a".to_string()),
            },
            BlockTransition {
                transition_type: BlockTransitionType::End,
                at: 1_710_003_601_000,
                actor_id: Some("rt-a".to_string()),
            },
        ],
    }
}

fn replication_signal(signal_id: &str, origin_host_id: &str, record_id: &str) -> SignalEvent {
    let mut signal = build_eventlog_replication_signal(
        origin_host_id,
        Some("profile-sync"),
        &sample_event_record(record_id),
    );
    signal.id = signal_id.to_string();
    signal
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
        source: "test:ens-data-plane".to_string(),
        origin_host_id: origin_host_id.to_string(),
        hop: 0,
        trace_id: Some(format!("ens-test:{signal_id}")),
        payload,
    }
}

fn data_frame_from_peer(identity_hex: &str, host_id: &str, event: SignalEvent) -> EnsDataFrame {
    EnsDataFrame::SignalEvent(EnsSignalEventFrame {
        frame_id: format!("frame-{identity_hex}-{}", event.id),
        from_peer: EnsPeerIdentity::new(identity_hex).with_host_id(host_id),
        scope_hint: Some("profile-sync".to_string()),
        event,
    })
}

fn received_data_frame_from_peer(
    identity_hex: &str,
    host_id: &str,
    event: SignalEvent,
) -> EnsReceivedDataFrame {
    received_data_frame_with_transport_peer(
        EnsPeerIdentity::new(identity_hex).with_host_id(host_id),
        data_frame_from_peer(identity_hex, host_id, event),
    )
}

fn received_data_frame_with_transport_peer(
    transport_peer: EnsPeerIdentity,
    frame: EnsDataFrame,
) -> EnsReceivedDataFrame {
    EnsReceivedDataFrame {
        transport_peer: Some(transport_peer),
        frame,
    }
}

async fn yield_for_replication_actor() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
}

async fn wait_for_event(store: &EventLogStore, event_id: &str) -> EventRecord {
    for _ in 0..20 {
        if let Some(event) = store
            .list_events(Some("profile-sync"))
            .expect("list replicated eventlog")
            .into_iter()
            .find(|event| event.id == event_id)
        {
            return event;
        }
        tokio::task::yield_now().await;
    }

    panic!("replicated event {event_id} was not stored");
}

async fn recv_signal_topic(
    rx: &mut tokio::sync::broadcast::Receiver<SignalEvent>,
    topic: &str,
) -> SignalEvent {
    for _ in 0..5 {
        let event = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
            .await
            .expect("signal should reach SignalPool")
            .expect("signal should be readable");
        if event.topic == topic {
            return event;
        }
    }

    panic!("signal topic {topic} was not observed");
}

async fn yield_until(assertion: impl Fn() -> bool) {
    for _ in 0..20 {
        if assertion() {
            return;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }

    panic!("condition did not become true after actor yields");
}

#[tokio::test]
async fn eventlog_append_replicates_through_ens_signal_event_frame() {
    let node_a = test_node("rt-a", "identity-a", "192.168.1.10:1949");
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_a.mesh, "identity-b", "rt-b");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    node_a.mesh.set_peer_interests(
        "identity-b",
        vec![EVENTLOG_REPLICATION_APPENDED_TOPIC.to_string()],
    );
    yield_for_replication_actor().await;

    let appender = EventLogAppender::new(
        Arc::clone(&node_a.eventlog_store),
        "rt-a".to_string(),
        Arc::clone(&node_a.signal_pool),
        None,
    );
    appender
        .append_event(Some("profile-sync"), sample_event_record("event-1"))
        .await
        .expect("local append should succeed");
    let signal = node_a
        .signal_pool
        .window()
        .recent(10)
        .into_iter()
        .find(|event| event.topic == EVENTLOG_REPLICATION_APPENDED_TOPIC)
        .expect("append should publish eventlog replication signal");

    let sent = node_a
        .service
        .send_signal_event_to_peer("identity-b", signal)
        .expect("authorized peer should accept ENS data-plane send");
    assert!(sent);
    let sent_frames = node_a.provider.sent_data_frames();
    assert_eq!(sent_frames.len(), 1);
    assert_eq!(sent_frames[0].peer.identity_hex, "identity-b");

    let EnsDataFrame::SignalEvent(frame) = &sent_frames[0].frame;
    assert_eq!(frame.from_peer.identity_hex, "identity-a");
    assert_eq!(frame.scope_hint.as_deref(), Some("profile-sync"));
    assert_eq!(frame.event.topic, EVENTLOG_REPLICATION_APPENDED_TOPIC);

    let accepted = node_b
        .service
        .handle_received_data_frame(received_data_frame_with_transport_peer(
            EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
            sent_frames[0].frame.clone(),
        ))
        .await
        .expect("authorized sender frame should ingest");
    assert!(accepted);

    let replicated = wait_for_event(&node_b.eventlog_store, "event-1").await;
    assert_eq!(replicated.content, "Reticulum data-plane event");
    assert_eq!(replicated.tags, vec!["note", "reticulum"]);
}

#[tokio::test]
async fn task_snapshot_replicates_through_same_ens_signal_event_frame() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;

    let accepted = node_b
        .service
        .handle_received_data_frame(received_data_frame_from_peer(
            "identity-a",
            "rt-a",
            signal_event(
                "signal-task",
                "task.replication.upserted",
                "rt-a",
                serde_json::json!({
                    "scopeKey": "profile-sync",
                    "task": {
                        "id": "task-1",
                        "title": "replicated task",
                        "description": "from ENS data-plane",
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
            ),
        ))
        .await
        .expect("task frame should ingest");

    assert!(accepted);
    yield_until(|| {
        node_b
            .task_store
            .get_scoped(Some("profile-sync"), "task-1")
            .is_some()
    })
    .await;

    let task = node_b
        .task_store
        .get_scoped(Some("profile-sync"), "task-1")
        .expect("replicated task");
    assert_eq!(task.title, "replicated task");
    assert_eq!(task.priority, TaskPriority::Medium);
    assert_eq!(task.status, TaskStatus::Pending);
}

#[tokio::test]
async fn timeblock_active_and_completed_snapshots_replicate_through_same_ens_frame() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;

    let active = data_frame_from_peer(
        "identity-a",
        "rt-a",
        signal_event(
            "signal-active-timeblock",
            "timeblock.replication.active_upserted",
            "rt-a",
            serde_json::json!({
                "scopeKey": "profile-sync",
                "active": sample_active_block()
            }),
        ),
    );
    let completed = data_frame_from_peer(
        "identity-a",
        "rt-a",
        signal_event(
            "signal-completed-timeblock",
            "timeblock.replication.completed",
            "rt-a",
            serde_json::json!({
                "scopeKey": "profile-sync",
                "block": sample_completed_block()
            }),
        ),
    );
    let mut signal_rx = node_b.signal_pool.subscribe();

    assert!(
        node_b
            .service
            .handle_received_data_frame(received_data_frame_with_transport_peer(
                EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
                active
            ))
            .await
            .unwrap()
    );
    recv_signal_topic(&mut signal_rx, "timeblock.replication.active_upserted").await;
    yield_until(|| {
        node_b
            .timeblock_store
            .get_active_scoped(Some("profile-sync"))
            .expect("active query")
            .is_some()
    })
    .await;
    let active = node_b
        .timeblock_store
        .get_active_scoped(Some("profile-sync"))
        .expect("active query")
        .expect("active block should be replicated from ENS data-plane");
    assert_eq!(active.start_id, "tb-start-1");

    assert!(
        node_b
            .service
            .handle_received_data_frame(received_data_frame_with_transport_peer(
                EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
                completed
            ))
            .await
            .unwrap()
    );
    recv_signal_topic(&mut signal_rx, "timeblock.replication.completed").await;
    yield_until(|| {
        !node_b
            .timeblock_store
            .list_completed_scoped(Some("profile-sync"))
            .expect("completed query")
            .is_empty()
    })
    .await;

    let completed = node_b
        .timeblock_store
        .list_completed_scoped(Some("profile-sync"))
        .expect("completed query");
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].start_id, "tb-start-1");
    assert!(
        node_b
            .timeblock_store
            .get_active_scoped(Some("profile-sync"))
            .expect("active query")
            .is_none(),
        "completed block with the same start_id should clear the active block"
    );
}

#[tokio::test]
async fn proposal_snapshot_replicates_through_same_ens_signal_event_frame() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;

    let accepted = node_b
        .service
        .handle_received_data_frame(received_data_frame_from_peer(
            "identity-a",
            "rt-a",
            signal_event(
                "signal-proposal",
                "proposal.replication.upserted",
                "rt-a",
                serde_json::json!({
                    "scopeKey": "profile-sync",
                    "proposal": {
                        "id": "proposal-42",
                        "title": "replicated proposal",
                        "body": "from ENS data-plane",
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
            ),
        ))
        .await
        .expect("proposal frame should ingest");

    assert!(accepted);
    yield_until(|| {
        node_b
            .proposal_store
            .get_scoped(Some("profile-sync"), "proposal-42")
            .expect("proposal query")
            .is_some()
    })
    .await;

    let proposal = node_b
        .proposal_store
        .get_scoped(Some("profile-sync"), "proposal-42")
        .expect("proposal query")
        .expect("proposal");
    assert_eq!(proposal.title, "replicated proposal");
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.action_type, ActionType::AppendEvent);
}

#[tokio::test]
async fn data_frame_from_unauthorized_peer_is_rejected() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    let frame = received_data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal("signal-unauthorized", "rt-a", "event-unauthorized"),
    );

    let error = node_b
        .service
        .handle_received_data_frame(frame)
        .await
        .expect_err("unauthorized sender must be rejected before SignalPool ingest");

    assert_eq!(
        error,
        EnsTransportError::UnauthorizedDataFramePeer("identity-a".to_string())
    );
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn data_frame_without_transport_peer_is_rejected_before_authorization() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    let frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal(
            "signal-missing-transport-peer",
            "rt-a",
            "event-missing-source",
        ),
    );

    let error = node_b
        .service
        .handle_data_frame(frame)
        .await
        .expect_err("raw data frame without transport peer must fail closed");

    assert_eq!(
        error,
        EnsTransportError::MissingDataFrameTransportPeer("identity-a".to_string())
    );
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn pending_data_frame_errors_do_not_drop_later_valid_frames() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;

    let invalid_frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal(
            "signal-queue-missing-peer",
            "rt-a",
            "event-queue-missing-peer",
        ),
    );
    let valid_frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal("signal-queue-valid", "rt-a", "event-queue-valid"),
    );
    node_b
        .provider
        .push_received_data_frame(None, invalid_frame);
    node_b.provider.push_received_data_frame(
        Some(EnsPeerIdentity::new("identity-a").with_host_id("rt-a")),
        valid_frame,
    );

    let error = node_b
        .service
        .handle_pending_data_frames()
        .await
        .expect_err("batch should report the first invalid frame");

    assert_eq!(
        error,
        EnsTransportError::MissingDataFrameTransportPeer("identity-a".to_string())
    );
    let replicated = wait_for_event(&node_b.eventlog_store, "event-queue-valid").await;
    assert_eq!(replicated.id, "event-queue-valid");
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .into_iter()
            .all(|event| event.id != "event-queue-missing-peer"),
        "invalid frame must not be ingested while later valid frame still applies"
    );
}

#[tokio::test]
async fn data_frame_from_mismatched_transport_peer_is_rejected_before_ingest() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    authorize_peer(&node_b.mesh, "identity-c", "rt-c");
    let frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal("signal-spoof", "rt-a", "event-spoof"),
    );

    let error = node_b
        .service
        .handle_received_data_frame(received_data_frame_with_transport_peer(
            EnsPeerIdentity::new("identity-c").with_host_id("rt-c"),
            frame,
        ))
        .await
        .expect_err("transport peer C must not be allowed to claim authorized peer A");

    assert_eq!(
        error,
        EnsTransportError::DataFrameTransportPeerMismatch {
            claimed: "identity-a".to_string(),
            observed: "identity-c".to_string(),
        }
    );
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn duplicate_signal_event_id_is_not_applied_twice() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;
    let frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal("signal-duplicate", "rt-a", "event-duplicate"),
    );

    let first = node_b
        .service
        .handle_received_data_frame(received_data_frame_with_transport_peer(
            EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
            frame.clone(),
        ))
        .await
        .expect("first frame should ingest");
    let second = node_b
        .service
        .handle_received_data_frame(received_data_frame_with_transport_peer(
            EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
            frame,
        ))
        .await
        .expect("duplicate frame should be skipped without failing transport");

    assert!(first);
    assert!(!second);
    let replicated = wait_for_event(&node_b.eventlog_store, "event-duplicate").await;
    assert_eq!(replicated.id, "event-duplicate");
    assert_eq!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .len(),
        1
    );
}

#[tokio::test]
async fn origin_bounce_signal_event_is_skipped_before_replication_actor() {
    let node_b = test_node("rt-b", "identity-b", "192.168.1.20:1949");
    authorize_peer(&node_b.mesh, "identity-a", "rt-a");
    yield_for_replication_actor().await;
    let frame = data_frame_from_peer(
        "identity-a",
        "rt-a",
        replication_signal("signal-bounce", "rt-b", "event-bounce"),
    );

    let accepted = node_b
        .service
        .handle_received_data_frame(received_data_frame_with_transport_peer(
            EnsPeerIdentity::new("identity-a").with_host_id("rt-a"),
            frame,
        ))
        .await
        .expect("origin bounce should be a skipped mesh delivery, not a provider failure");

    assert!(!accepted);
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn sending_signal_event_requires_authorized_target_peer() {
    let node_a = test_node("rt-a", "identity-a", "192.168.1.10:1949");

    let error = node_a
        .service
        .send_signal_event_to_peer(
            "identity-b",
            replication_signal("signal-missing-target", "rt-a", "event-missing-target"),
        )
        .expect_err("sender must not emit data frames to unknown peers");

    assert_eq!(
        error,
        EnsTransportError::UnauthorizedDataFramePeer("identity-b".to_string())
    );
    assert!(node_a.provider.sent_data_frames().is_empty());
}
