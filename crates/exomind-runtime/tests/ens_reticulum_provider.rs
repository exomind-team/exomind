use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use exomind_runtime::ens::{
    EnsDataFrame, EnsInterfaceMedium, EnsInterfaceTopology, EnsPeerIdentity, EnsProvider,
    EnsProviderError, EnsSignalEventFrame, EnsTransportError, EnsTransportHealthStatus,
    EnsTransportService, ReticulumEnsInterfaceConfig, ReticulumEnsProvider,
    ReticulumEnsProviderConfig, ReticulumMdnsBootstrap,
};
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::eventlog_appender::{
    EVENTLOG_REPLICATION_APPENDED_TOPIC, EventLogAppender, build_eventlog_replication_signal,
};
use exomind_runtime::mesh::{MeshState, PeerInfo, PeerStatus};
use exomind_runtime::pairing::PairingManager;
use exomind_runtime::proposal::{ActionType, ProposalStatus, ProposalStore};
use exomind_runtime::signal::SignalEvent;
use exomind_runtime::signal::actors::replication_actor::spawn_replication_actor;
use exomind_runtime::task::{TaskPriority, TaskStatus, TaskStore};
use exomind_runtime::timeblock::{
    ActiveBlockData, BlockPhase, BlockTransition, BlockTransitionType, TimeBlockData,
    TimeBlockStore,
};
use reticulum::buffer::OutputBuffer;
use reticulum::hash::AddressHash;
use reticulum::identity::PrivateIdentity;
use reticulum::packet::{DestinationType, Packet, PacketType};
use reticulum::serde::Serialize as ReticulumSerialize;
use tempfile::TempDir;
use tokio::sync::mpsc;

const TASK_REPLICATION_TOPIC: &str = "task.replication.upserted";
const TIMEBLOCK_ACTIVE_REPLICATION_TOPIC: &str = "timeblock.replication.active_upserted";
const TIMEBLOCK_COMPLETED_REPLICATION_TOPIC: &str = "timeblock.replication.completed";
const PROPOSAL_REPLICATION_TOPIC: &str = "proposal.replication.upserted";

struct ReticulumTestNode {
    service: EnsTransportService,
    provider: Arc<ReticulumEnsProvider>,
    mesh: Arc<MeshState>,
    signal_pool: Arc<exomind_runtime::signal::SignalPool>,
    eventlog_store: Arc<EventLogStore>,
    task_store: Arc<TaskStore>,
    timeblock_store: Arc<TimeBlockStore>,
    proposal_store: Arc<ProposalStore>,
    _data_dir: TempDir,
    _replication_handle: tokio::task::JoinHandle<()>,
}

struct ReticulumQueueHarness {
    a_to_b_tx: mpsc::Sender<Vec<u8>>,
    _b_to_a_tx: mpsc::Sender<Vec<u8>>,
}

async fn reticulum_node(
    provider_id: &str,
    host_id: &str,
    identity_name: &str,
) -> ReticulumTestNode {
    let signal_pool = Arc::new(exomind_runtime::signal::SignalPool::new(None));
    let mesh = Arc::new(MeshState::new(
        host_id.to_string(),
        Arc::clone(&signal_pool),
        None,
    ));
    let pairing = Arc::new(PairingManager::new());
    let provider = ReticulumEnsProvider::new_with_identity(
        provider_id,
        Some(host_id.to_string()),
        PrivateIdentity::new_from_name(identity_name),
    )
    .await
    .expect("reticulum provider should initialize");
    let service = EnsTransportService::new_with_endpoint(
        host_id.to_string(),
        Arc::clone(&mesh),
        pairing,
        provider.clone(),
        Some(provider.local_endpoint()),
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

    ReticulumTestNode {
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

async fn connect_queue_interfaces(
    node_a: &ReticulumTestNode,
    node_b: &ReticulumTestNode,
) -> ReticulumQueueHarness {
    let (a_to_b_tx, a_to_b_rx) = mpsc::channel(64);
    let (b_to_a_tx, b_to_a_rx) = mpsc::channel(64);
    node_a
        .provider
        .add_queue_interface(
            "test-queue-a",
            b_to_a_rx,
            a_to_b_tx.clone(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A queue interface");
    node_b
        .provider
        .add_queue_interface(
            "test-queue-b",
            a_to_b_rx,
            b_to_a_tx.clone(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node B queue interface");

    ReticulumQueueHarness {
        a_to_b_tx,
        _b_to_a_tx: b_to_a_tx,
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
        content: "Reticulum queue provider event".to_string(),
        tags: vec!["note".to_string(), "reticulum".to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "source": {
                "deviceId": "reticulum-node-a"
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
        source: "test:ens-reticulum-provider".to_string(),
        origin_host_id: origin_host_id.to_string(),
        hop: 0,
        trace_id: Some(format!("ens-reticulum-test:{signal_id}")),
        payload,
    }
}

async fn yield_for_replication_actor() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::time::sleep(Duration::from_millis(20)).await;
}

async fn wait_for_pending_data_frame_acceptance(service: &EnsTransportService) -> Vec<bool> {
    for _ in 0..160 {
        let accepted = service
            .handle_pending_data_frames()
            .await
            .expect("signed Reticulum data frame should pass provider and service checks");
        if !accepted.is_empty() {
            return accepted;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("provider did not receive an accepted signed data frame");
}

async fn assert_no_pending_data_frame_after_file_poll(service: &EnsTransportService) {
    tokio::time::sleep(Duration::from_millis(150)).await;
    let drained = service
        .handle_pending_data_frames()
        .await
        .expect("second drain should not duplicate accepted frame");
    assert!(drained.is_empty());
}

async fn wait_for_pending_data_frame_error(service: &EnsTransportService) -> EnsTransportError {
    for _ in 0..80 {
        match service.handle_pending_data_frames().await {
            Ok(accepted) if accepted.is_empty() => {}
            Ok(accepted) => panic!("signed Reticulum frame should not be accepted: {accepted:?}"),
            Err(error) => return error,
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("provider did not receive a rejected signed data frame");
}

async fn wait_for_event(store: &EventLogStore, scope: Option<&str>, event_id: &str) -> EventRecord {
    for _ in 0..160 {
        if let Some(event) = store
            .list_events(scope)
            .expect("list replicated eventlog")
            .into_iter()
            .find(|event| event.id == event_id)
        {
            return event;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("replicated event {event_id} was not stored");
}

async fn yield_until(assertion: impl Fn() -> bool) {
    for _ in 0..80 {
        if assertion() {
            return;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("condition did not become true after actor yields");
}

async fn wait_for_health_status(
    service: &EnsTransportService,
    status: EnsTransportHealthStatus,
) -> Option<String> {
    for _ in 0..80 {
        let health = service.snapshot().health;
        if health.status == status {
            return health.message;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("provider health did not become {status:?}");
}

async fn wait_for_bound_udp_endpoint(
    provider: &ReticulumEnsProvider,
    bound_port: &std::sync::atomic::AtomicU16,
) -> String {
    for _ in 0..80 {
        let port = bound_port.load(Ordering::Relaxed);
        let endpoint = provider.local_endpoint();
        if port != 0 {
            let expected = format!("udp://127.0.0.1:{port}");
            if endpoint.interface_address.as_deref() == Some(expected.as_str()) {
                return expected;
            }
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("UDP dynamic port was not projected into the local endpoint");
}

async fn wait_for_local_udp_endpoint(provider: &ReticulumEnsProvider) -> String {
    for _ in 0..80 {
        let endpoint = provider.local_endpoint();
        if let Some(address) = endpoint.interface_address.as_deref() {
            if let Some(port) = address.strip_prefix("udp://127.0.0.1:") {
                if port != "0" {
                    return address.to_string();
                }
            }
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("UDP endpoint was not projected into the local endpoint");
}

async fn wait_for_bound_udp_port(bound_port: &std::sync::atomic::AtomicU16) -> u16 {
    for _ in 0..80 {
        let port = bound_port.load(Ordering::Relaxed);
        if port != 0 {
            return port;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("UDP interface did not bind a concrete port");
}

async fn wait_for_bound_tcp_endpoint(provider: &ReticulumEnsProvider) -> String {
    for _ in 0..80 {
        let endpoint = provider.local_endpoint();
        if let Some(address) = endpoint.interface_address.as_deref() {
            if let Some(port) = tcp_endpoint_port(address) {
                if port != 0 {
                    return address.to_string();
                }
            }
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("TCP dynamic port was not projected into the local endpoint");
}

fn tcp_endpoint_port(address: &str) -> Option<u16> {
    address
        .strip_prefix("tcp-listen://127.0.0.1:")?
        .parse()
        .ok()
}

fn reticulum_packet_bytes(
    destination_hex: &str,
    wire_frame: serde_json::Value,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let bytes = serde_json::to_vec(&wire_frame)?;
    let mut packet = Packet::default();
    packet.header.destination_type = DestinationType::Single;
    packet.header.packet_type = PacketType::Data;
    packet.destination = AddressHash::new_from_hex_string(destination_hex)?;
    packet.data.write(bytes.as_slice())?;

    let mut buffer = [0u8; 4096];
    let mut output = OutputBuffer::new(&mut buffer);
    packet.serialize(&mut output)?;
    Ok(output.as_slice().to_vec())
}

async fn inject_reticulum_wire_frame(
    tx: &mpsc::Sender<Vec<u8>>,
    destination_hex: &str,
    wire_frame: serde_json::Value,
) {
    let bytes = reticulum_packet_bytes(destination_hex, wire_frame).expect("serialize packet");
    tx.send(bytes).await.expect("inject queue packet");
}

fn signal_data_frame(from: EnsPeerIdentity, event_id: &str) -> EnsDataFrame {
    EnsDataFrame::SignalEvent(EnsSignalEventFrame {
        frame_id: format!("frame-{event_id}"),
        from_peer: from,
        scope_hint: Some("profile-sync".to_string()),
        event: build_eventlog_replication_signal(
            "rt-a",
            Some("profile-sync"),
            &sample_event_record(event_id),
        ),
    })
}

fn assert_local_interface_projection(
    node: &ReticulumTestNode,
    interface_name: &str,
    medium: EnsInterfaceMedium,
    expected_address: &str,
    expected_interface_type: &str,
) {
    let endpoint = node.provider.local_endpoint();
    assert_eq!(endpoint.via_interface.as_deref(), Some(interface_name));
    assert_eq!(endpoint.via_medium, Some(medium));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some(expected_address)
    );

    let snapshot = node.service.snapshot();
    let interface = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == interface_name)
        .expect("interface should be visible in provider snapshot");
    assert_eq!(interface.interface_type, expected_interface_type);
    assert_eq!(interface.topology, EnsInterfaceTopology::Active);
    assert_eq!(interface.effective_topology, EnsInterfaceTopology::Active);
}

async fn replicate_eventlog_append_from_a_to_b(
    node_a: &ReticulumTestNode,
    node_b: &ReticulumTestNode,
    event_id: &str,
) -> EventRecord {
    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    authorize_peer(&node_b.mesh, &endpoint_a.identity_hex, "rt-a");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
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
        .append_event(Some("profile-sync"), sample_event_record(event_id))
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
        .send_signal_event_to_peer(&endpoint_b.identity_hex, signal)
        .expect("authorized Reticulum peer should accept send");
    assert!(sent);

    let accepted = wait_for_pending_data_frame_acceptance(&node_b.service).await;
    assert_eq!(accepted, vec![true]);
    let replicated = wait_for_event(&node_b.eventlog_store, Some("profile-sync"), event_id).await;
    let expected = sample_event_record(event_id);
    assert_eq!(replicated.timestamp, expected.timestamp);
    assert_eq!(replicated.content, expected.content);
    assert_eq!(replicated.tags, expected.tags);
    assert_eq!(replicated.refs, expected.refs);
    assert_eq!(replicated.metadata, expected.metadata);
    replicated
}

#[tokio::test]
async fn queue_reticulum_provider_accepts_signed_eventlog_replication_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-test-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-test-b").await;
    let _harness = connect_queue_interfaces(&node_a, &node_b).await;

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    authorize_peer(&node_b.mesh, &endpoint_a.identity_hex, "rt-a");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
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
        .append_event(
            Some("profile-sync"),
            sample_event_record("event-reticulum-1"),
        )
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
        .send_signal_event_to_peer(&endpoint_b.identity_hex, signal)
        .expect("authorized Reticulum peer should accept send");
    assert!(sent);

    let accepted = wait_for_pending_data_frame_acceptance(&node_b.service).await;
    assert_eq!(accepted, vec![true]);
    assert_eq!(
        node_b.service.snapshot().health.status,
        EnsTransportHealthStatus::Healthy
    );

    let replicated = wait_for_event(
        &node_b.eventlog_store,
        Some("profile-sync"),
        "event-reticulum-1",
    )
    .await;
    let expected = sample_event_record("event-reticulum-1");
    assert_eq!(replicated.timestamp, expected.timestamp);
    assert_eq!(replicated.content, expected.content);
    assert_eq!(replicated.tags, expected.tags);
    assert_eq!(replicated.refs, expected.refs);
    assert_eq!(replicated.metadata, expected.metadata);

    let drained = node_b
        .service
        .handle_pending_data_frames()
        .await
        .expect("second drain should not duplicate accepted frame");
    assert!(drained.is_empty());
}

#[tokio::test]
async fn jsonl_reticulum_provider_supports_eventlog_replication_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-jsonl-data-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-jsonl-data-b").await;
    let stream_dir = tempfile::tempdir().expect("jsonl stream dir");

    node_a
        .provider
        .add_jsonl_interface(
            "jsonl-node-a",
            stream_dir.path().to_path_buf(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A JSONL interface should start");
    node_b
        .provider
        .add_jsonl_interface(
            "jsonl-node-b",
            stream_dir.path().to_path_buf(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node B JSONL interface should start");

    let expected_address = format!("jsonl://{}", stream_dir.path().display());
    assert_local_interface_projection(
        &node_a,
        "jsonl-node-a",
        EnsInterfaceMedium::Jsonl,
        &expected_address,
        "jsonl_interface",
    );
    assert_local_interface_projection(
        &node_b,
        "jsonl-node-b",
        EnsInterfaceMedium::Jsonl,
        &expected_address,
        "jsonl_interface",
    );

    replicate_eventlog_append_from_a_to_b(&node_a, &node_b, "event-reticulum-jsonl").await;
    assert_no_pending_data_frame_after_file_poll(&node_b.service).await;
}

#[tokio::test]
async fn file_reticulum_provider_supports_eventlog_replication_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-file-data-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-file-data-b").await;
    let dir = tempfile::tempdir().expect("file interface dir");
    let file_path = dir.path().join("reticulum-shared.jsonl");

    node_a
        .provider
        .add_file_interface(
            "file-node-a",
            file_path.clone(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A file interface should start");
    node_b
        .provider
        .add_file_interface(
            "file-node-b",
            file_path.clone(),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node B file interface should start");

    let expected_address = format!("file://{}", file_path.display());
    assert_local_interface_projection(
        &node_a,
        "file-node-a",
        EnsInterfaceMedium::File,
        &expected_address,
        "FileInterface",
    );
    assert_local_interface_projection(
        &node_b,
        "file-node-b",
        EnsInterfaceMedium::File,
        &expected_address,
        "FileInterface",
    );

    replicate_eventlog_append_from_a_to_b(&node_a, &node_b, "event-reticulum-file").await;
    assert_no_pending_data_frame_after_file_poll(&node_b.service).await;
}

#[tokio::test]
async fn udp_dynamic_port_supports_reticulum_eventlog_replication_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-udp-data-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-udp-data-b").await;

    let node_b_bound_port = node_b
        .provider
        .add_udp_interface("127.0.0.1:0", None, EnsInterfaceTopology::Active)
        .await
        .expect("node B dynamic UDP interface should bind");
    let node_b_endpoint_address =
        wait_for_bound_udp_endpoint(&node_b.provider, &node_b_bound_port).await;
    let node_b_port = wait_for_bound_udp_port(&node_b_bound_port).await;
    assert_eq!(
        node_b_endpoint_address,
        format!("udp://127.0.0.1:{node_b_port}")
    );

    let node_a_bound_port = node_a
        .provider
        .add_udp_interface(
            "127.0.0.1:0",
            Some(format!("127.0.0.1:{node_b_port}")),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A dynamic UDP interface should bind with node B as forward target");
    let node_a_endpoint_address =
        wait_for_bound_udp_endpoint(&node_a.provider, &node_a_bound_port).await;
    let node_a_port = wait_for_bound_udp_port(&node_a_bound_port).await;
    let node_a_public_name = format!("127.0.0.1:{node_a_port}");
    let node_b_public_name = format!("127.0.0.1:{node_b_port}");

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    assert_eq!(
        endpoint_a.via_interface.as_deref(),
        Some(node_a_public_name.as_str())
    );
    assert_eq!(
        endpoint_a.interface_address.as_deref(),
        Some(node_a_endpoint_address.as_str())
    );
    assert_eq!(
        endpoint_b.via_interface.as_deref(),
        Some(node_b_public_name.as_str())
    );
    assert_eq!(
        endpoint_b.interface_address.as_deref(),
        Some(node_b_endpoint_address.as_str())
    );
    for payload in [
        serde_json::to_string(&endpoint_a).expect("endpoint A should serialize"),
        serde_json::to_string(&endpoint_b).expect("endpoint B should serialize"),
    ] {
        assert!(!payload.contains("127.0.0.1:0"));
        assert!(!payload.contains("udp://127.0.0.1:0"));
    }

    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    authorize_peer(&node_b.mesh, &endpoint_a.identity_hex, "rt-a");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
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
        .append_event(
            Some("profile-sync"),
            sample_event_record("event-reticulum-udp-dynamic"),
        )
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
        .send_signal_event_to_peer(&endpoint_b.identity_hex, signal)
        .expect("authorized Reticulum peer should accept UDP send");
    assert!(sent);

    let accepted = wait_for_pending_data_frame_acceptance(&node_b.service).await;
    assert_eq!(accepted, vec![true]);
    let replicated = wait_for_event(
        &node_b.eventlog_store,
        Some("profile-sync"),
        "event-reticulum-udp-dynamic",
    )
    .await;
    let expected = sample_event_record("event-reticulum-udp-dynamic");
    assert_eq!(replicated.timestamp, expected.timestamp);
    assert_eq!(replicated.content, expected.content);
    assert_eq!(replicated.tags, expected.tags);
    assert_eq!(replicated.refs, expected.refs);
    assert_eq!(replicated.metadata, expected.metadata);
}

#[tokio::test]
async fn tcp_server_client_supports_reticulum_eventlog_replication_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-tcp-data-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-tcp-data-b").await;

    node_b
        .provider
        .add_tcp_server_interface("127.0.0.1:0", EnsInterfaceTopology::Active)
        .await
        .expect("node B dynamic TCP server should bind");
    let node_b_endpoint_address = wait_for_bound_tcp_endpoint(&node_b.provider).await;
    let node_b_port =
        tcp_endpoint_port(&node_b_endpoint_address).expect("TCP endpoint should expose a port");
    assert_eq!(
        node_b_endpoint_address,
        format!("tcp-listen://127.0.0.1:{node_b_port}")
    );
    let node_b_public_name = format!("127.0.0.1:{node_b_port}");

    node_a
        .provider
        .add_tcp_client_interface(
            format!("127.0.0.1:{node_b_port}"),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A TCP client should connect to node B server");

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    assert_eq!(
        endpoint_b.via_interface.as_deref(),
        Some(node_b_public_name.as_str())
    );
    assert_eq!(
        endpoint_b.interface_address.as_deref(),
        Some(node_b_endpoint_address.as_str())
    );
    for payload in [
        serde_json::to_string(&endpoint_a).expect("endpoint A should serialize"),
        serde_json::to_string(&endpoint_b).expect("endpoint B should serialize"),
    ] {
        assert!(!payload.contains("127.0.0.1:0"));
        assert!(!payload.contains("tcp-listen://127.0.0.1:0"));
    }

    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    authorize_peer(&node_b.mesh, &endpoint_a.identity_hex, "rt-a");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
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
        .append_event(
            Some("profile-sync"),
            sample_event_record("event-reticulum-tcp-dynamic"),
        )
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
        .send_signal_event_to_peer(&endpoint_b.identity_hex, signal)
        .expect("authorized Reticulum peer should accept TCP send");
    assert!(sent);

    let accepted = wait_for_pending_data_frame_acceptance(&node_b.service).await;
    assert_eq!(accepted, vec![true]);
    let replicated = wait_for_event(
        &node_b.eventlog_store,
        Some("profile-sync"),
        "event-reticulum-tcp-dynamic",
    )
    .await;
    let expected = sample_event_record("event-reticulum-tcp-dynamic");
    assert_eq!(replicated.timestamp, expected.timestamp);
    assert_eq!(replicated.content, expected.content);
    assert_eq!(replicated.tags, expected.tags);
    assert_eq!(replicated.refs, expected.refs);
    assert_eq!(replicated.metadata, expected.metadata);
}

#[tokio::test]
async fn tcp_server_client_supports_reticulum_domain_replication_frames() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-tcp-domains-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-tcp-domains-b").await;

    node_b
        .provider
        .add_tcp_server_interface("127.0.0.1:0", EnsInterfaceTopology::Active)
        .await
        .expect("node B dynamic TCP server should bind");
    let node_b_endpoint_address = wait_for_bound_tcp_endpoint(&node_b.provider).await;
    let node_b_port =
        tcp_endpoint_port(&node_b_endpoint_address).expect("TCP endpoint should expose a port");

    node_a
        .provider
        .add_tcp_client_interface(
            format!("127.0.0.1:{node_b_port}"),
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A TCP client should connect to node B server");

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    authorize_peer(&node_b.mesh, &endpoint_a.identity_hex, "rt-a");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
        vec![
            TASK_REPLICATION_TOPIC.to_string(),
            TIMEBLOCK_ACTIVE_REPLICATION_TOPIC.to_string(),
            TIMEBLOCK_COMPLETED_REPLICATION_TOPIC.to_string(),
            PROPOSAL_REPLICATION_TOPIC.to_string(),
        ],
    );
    yield_for_replication_actor().await;

    assert!(
        node_a
            .service
            .send_signal_event_to_peer(
                &endpoint_b.identity_hex,
                signal_event(
                    "signal-task-tcp",
                    TASK_REPLICATION_TOPIC,
                    "rt-a",
                    serde_json::json!({
                        "scopeKey": "profile-sync",
                        "task": {
                            "id": "task-1",
                            "title": "replicated task",
                            "description": "from real Reticulum TCP",
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
                )
            )
            .expect("authorized Reticulum peer should accept task send")
    );
    assert_eq!(
        wait_for_pending_data_frame_acceptance(&node_b.service).await,
        vec![true]
    );
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

    assert!(
        node_a
            .service
            .send_signal_event_to_peer(
                &endpoint_b.identity_hex,
                signal_event(
                    "signal-active-timeblock-tcp",
                    TIMEBLOCK_ACTIVE_REPLICATION_TOPIC,
                    "rt-a",
                    serde_json::json!({
                        "scopeKey": "profile-sync",
                        "active": sample_active_block()
                    }),
                )
            )
            .expect("authorized Reticulum peer should accept active timeblock send")
    );
    assert_eq!(
        wait_for_pending_data_frame_acceptance(&node_b.service).await,
        vec![true]
    );
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
        .expect("active block should replicate through real Reticulum TCP");
    assert_eq!(active.start_id, "tb-start-1");
    assert_eq!(active.phase, Some(BlockPhase::Running));

    assert!(
        node_a
            .service
            .send_signal_event_to_peer(
                &endpoint_b.identity_hex,
                signal_event(
                    "signal-completed-timeblock-tcp",
                    TIMEBLOCK_COMPLETED_REPLICATION_TOPIC,
                    "rt-a",
                    serde_json::json!({
                        "scopeKey": "profile-sync",
                        "block": sample_completed_block()
                    }),
                )
            )
            .expect("authorized Reticulum peer should accept completed timeblock send")
    );
    assert_eq!(
        wait_for_pending_data_frame_acceptance(&node_b.service).await,
        vec![true]
    );
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

    assert!(
        node_a
            .service
            .send_signal_event_to_peer(
                &endpoint_b.identity_hex,
                signal_event(
                    "signal-proposal-tcp",
                    PROPOSAL_REPLICATION_TOPIC,
                    "rt-a",
                    serde_json::json!({
                        "scopeKey": "profile-sync",
                        "proposal": {
                            "id": "proposal-42",
                            "title": "replicated proposal",
                            "body": "from real Reticulum TCP",
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
                )
            )
            .expect("authorized Reticulum peer should accept proposal send")
    );
    assert_eq!(
        wait_for_pending_data_frame_acceptance(&node_b.service).await,
        vec![true]
    );
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
        .expect("replicated proposal");
    assert_eq!(proposal.title, "replicated proposal");
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.action_type, ActionType::AppendEvent);
}

#[tokio::test]
async fn queue_reticulum_provider_drains_valid_signature_but_service_rejects_unauthorized_signer() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-unauth-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-unauth-b").await;
    let _harness = connect_queue_interfaces(&node_a, &node_b).await;

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());
    node_b
        .provider
        .upsert_discovered_endpoint(endpoint_a.clone());
    authorize_peer(&node_a.mesh, &endpoint_b.identity_hex, "rt-b");
    node_a.mesh.set_peer_interests(
        &endpoint_b.identity_hex,
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
        .append_event(
            Some("profile-sync"),
            sample_event_record("event-reticulum-unauth"),
        )
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
        .send_signal_event_to_peer(&endpoint_b.identity_hex, signal)
        .expect("sender-side authorized Reticulum peer should accept send");
    assert!(sent);

    let error = wait_for_pending_data_frame_error(&node_b.service).await;
    assert_eq!(
        error,
        EnsTransportError::UnauthorizedDataFramePeer(endpoint_a.identity_hex)
    );
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list replicated eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn queue_reticulum_provider_rejects_unsigned_legacy_data_wire_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-legacy-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-legacy-b").await;
    let harness = connect_queue_interfaces(&node_a, &node_b).await;

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    let frame = signal_data_frame(endpoint_a.identity(), "event-reticulum-legacy");
    let wire_frame = serde_json::json!({
        "kind": "data",
        "payload": frame
    });

    inject_reticulum_wire_frame(
        &harness.a_to_b_tx,
        endpoint_b.reticulum_destination.as_deref().unwrap(),
        wire_frame,
    )
    .await;

    let message = wait_for_health_status(&node_b.service, EnsTransportHealthStatus::Degraded).await;
    assert!(
        message
            .as_deref()
            .unwrap_or_default()
            .contains("failed to decode Reticulum ENS frame")
    );
    let drained = node_b
        .service
        .handle_pending_data_frames()
        .await
        .expect("legacy unsigned frame should be dropped by provider before service ingest");
    assert!(drained.is_empty());
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list replicated eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn queue_reticulum_provider_rejects_bad_signed_data_frame_without_ingest() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-badsig-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-badsig-b").await;
    let harness = connect_queue_interfaces(&node_a, &node_b).await;

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    let frame = signal_data_frame(endpoint_a.identity(), "event-reticulum-badsig");
    let wire_frame = serde_json::json!({
        "kind": "data",
        "payload": {
            "frame": frame,
            "to_peer_identity_hex": endpoint_b.identity_hex,
            "signature": vec![0u8; 64]
        }
    });

    inject_reticulum_wire_frame(
        &harness.a_to_b_tx,
        endpoint_b.reticulum_destination.as_deref().unwrap(),
        wire_frame,
    )
    .await;

    let message = wait_for_health_status(&node_b.service, EnsTransportHealthStatus::Degraded).await;
    assert!(
        message
            .as_deref()
            .unwrap_or_default()
            .contains("Reticulum ENS data frame signature verification failed")
    );
    let drained = node_b
        .service
        .handle_pending_data_frames()
        .await
        .expect("bad signature should be dropped by provider before service ingest");
    assert!(drained.is_empty());
    assert!(
        node_b
            .eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list replicated eventlog")
            .is_empty()
    );
}

#[tokio::test]
async fn queue_reticulum_provider_rejects_data_frame_addressed_to_another_peer() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-target-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-target-b").await;
    let harness = connect_queue_interfaces(&node_a, &node_b).await;

    let endpoint_a = node_a.provider.local_endpoint();
    let endpoint_b = node_b.provider.local_endpoint();
    let frame = signal_data_frame(endpoint_a.identity(), "event-reticulum-wrong-target");
    let wire_frame = serde_json::json!({
        "kind": "data",
        "payload": {
            "frame": frame,
            "to_peer_identity_hex": endpoint_a.identity_hex,
            "signature": vec![0u8; 64]
        }
    });

    inject_reticulum_wire_frame(
        &harness.a_to_b_tx,
        endpoint_b.reticulum_destination.as_deref().unwrap(),
        wire_frame,
    )
    .await;

    let message = wait_for_health_status(&node_b.service, EnsTransportHealthStatus::Degraded).await;
    assert!(
        message
            .as_deref()
            .unwrap_or_default()
            .contains("Reticulum ENS data frame was addressed to")
    );
    let drained = node_b
        .service
        .handle_pending_data_frames()
        .await
        .expect("wrong-target frame should be dropped by provider before service ingest");
    assert!(drained.is_empty());
}

#[tokio::test]
async fn queue_reticulum_provider_refuses_to_sign_non_local_data_frame() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-local-sign-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-local-sign-b").await;

    let endpoint_b = node_b.provider.local_endpoint();
    let frame = signal_data_frame(endpoint_b.identity(), "event-reticulum-nonlocal-sign");
    let error = node_a
        .provider
        .send_data_frame(&endpoint_b.identity(), frame)
        .expect_err("Reticulum provider should not sign a frame claiming another peer");
    assert!(matches!(
        error,
        EnsProviderError::SendDataFrame(message)
            if message.contains("refused to sign data frame from non-local peer")
    ));
}

#[tokio::test]
async fn queue_interface_and_local_registry_project_reticulum_endpoint_state() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-registry-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-registry-b").await;
    let _harness = connect_queue_interfaces(&node_a, &node_b).await;

    let snapshot = node_a.service.snapshot();
    let queue = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == "test-queue-a")
        .expect("queue interface should be visible in provider snapshot");
    assert_eq!(queue.interface_type, "QueueInterface");
    assert_eq!(queue.topology, EnsInterfaceTopology::Active);
    assert_eq!(queue.effective_topology, EnsInterfaceTopology::Active);
    let endpoint = node_a.provider.local_endpoint();
    assert_eq!(endpoint.via_interface.as_deref(), Some("test-queue-a"));
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Queue));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some("queue://test-queue-a")
    );

    let tempdir = tempfile::tempdir().expect("registry tempdir");
    let registry_path = tempdir.path().join("reticulum-local-registry.json");
    node_b
        .provider
        .publish_local_registry(&registry_path)
        .expect("publish peer endpoint registry");
    let loaded = node_a
        .provider
        .load_local_registry(&registry_path)
        .expect("load peer endpoint registry");
    assert_eq!(loaded, 1);

    let peer_identity = node_b.provider.local_endpoint().identity_hex;
    let snapshot = node_a.service.snapshot();
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == peer_identity)
        .expect("registry peer should be projected as discovered endpoint");
    assert!(!peer.authorized);
    let endpoint = peer.endpoint.as_ref().expect("registry peer endpoint");
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Queue));
    assert_eq!(endpoint.discovery_source, "reticulum-provider-interface");
    assert!(endpoint.reticulum_destination.is_some());
}

#[tokio::test]
async fn publish_local_registry_refuses_endpoint_without_physical_interface() {
    let provider = ReticulumEnsProvider::new_with_identity(
        "ens-ret-no-interface",
        Some("rt-no-interface".to_string()),
        PrivateIdentity::new_from_name("ens-reticulum-no-interface"),
    )
    .await
    .expect("reticulum provider should initialize");
    let tempdir = tempfile::tempdir().expect("registry tempdir");
    let registry_path = tempdir.path().join("reticulum-local-registry.json");

    let error = provider
        .publish_local_registry(&registry_path)
        .expect_err("registry publication must fail without a dialable physical interface");

    assert!(matches!(
        error,
        EnsProviderError::Unavailable(message)
            if message.contains("dialable Reticulum ENS local endpoint")
    ));
    assert!(
        !registry_path.exists(),
        "fail-closed registry publication must not create a partial registry file"
    );
}

#[tokio::test]
async fn apply_config_refuses_registry_publish_without_physical_interface() {
    let provider = ReticulumEnsProvider::new_with_identity(
        "ens-ret-config-no-interface",
        Some("rt-config-no-interface".to_string()),
        PrivateIdentity::new_from_name("ens-reticulum-config-no-interface"),
    )
    .await
    .expect("reticulum provider should initialize");
    let tempdir = tempfile::tempdir().expect("registry tempdir");
    let registry_path = tempdir.path().join("reticulum-local-registry.json");

    let error = provider
        .apply_config(&ReticulumEnsProviderConfig {
            local_registry_path: Some(registry_path.clone()),
            interfaces: Vec::new(),
            load_local_registry: false,
            publish_local_registry: true,
        })
        .await
        .expect_err("config must not publish a registry entry without a physical interface");

    assert!(matches!(
        error,
        EnsProviderError::Unavailable(message)
            if message.contains("dialable Reticulum ENS local endpoint")
    ));
    assert!(
        !registry_path.exists(),
        "failed config application must not create a partial registry file"
    );
}

#[tokio::test]
async fn apply_config_adds_interfaces_and_projects_registry_without_authorizing_peer() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-config-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-config-b").await;
    let tempdir = tempfile::tempdir().expect("registry tempdir");
    let registry_path = tempdir.path().join("reticulum-local-registry.json");
    node_b
        .provider
        .add_udp_interface("127.0.0.1:0", None, EnsInterfaceTopology::Active)
        .await
        .expect("peer provider should expose a dialable UDP endpoint");
    let _peer_endpoint_address = wait_for_local_udp_endpoint(&node_b.provider).await;
    node_b
        .provider
        .publish_local_registry(&registry_path)
        .expect("publish peer endpoint registry");

    node_a
        .provider
        .apply_config(&ReticulumEnsProviderConfig {
            local_registry_path: Some(registry_path.clone()),
            interfaces: vec![ReticulumEnsInterfaceConfig::Udp {
                bind_addr: "127.0.0.1:0".to_string(),
                forward_addr: None,
                topology: EnsInterfaceTopology::Active,
            }],
            load_local_registry: true,
            publish_local_registry: true,
        })
        .await
        .expect("provider config should apply");

    let endpoint_address = wait_for_local_udp_endpoint(&node_a.provider).await;
    let endpoint = node_a.provider.local_endpoint();
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Udp));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some(endpoint_address.as_str())
    );
    assert_eq!(endpoint.runtime_base_url, None);
    assert!(endpoint.reticulum_destination.is_some());

    let snapshot = node_a.service.snapshot();
    let udp_interface = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name.starts_with("127.0.0.1:"))
        .expect("configured UDP interface should be visible");
    assert_eq!(udp_interface.interface_type, "udp_interface");
    assert_eq!(udp_interface.topology, EnsInterfaceTopology::Active);
    assert_eq!(
        udp_interface.effective_topology,
        EnsInterfaceTopology::Active
    );

    let peer_identity = node_b.provider.local_endpoint().identity_hex;
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == peer_identity)
        .expect("registry peer should be projected as discovered endpoint");
    assert!(!peer.authorized);
    assert!(node_a.mesh.get_peer(&peer_identity).is_none());

    let registry_json =
        std::fs::read_to_string(&registry_path).expect("registry should be written");
    let registry: serde_json::Value =
        serde_json::from_str(&registry_json).expect("registry JSON should decode");
    let entries = registry["entries"]
        .as_array()
        .expect("registry entries should be an array");
    assert!(
        entries.len() >= 2,
        "apply_config should preserve loaded peer entry and publish local endpoint"
    );
    let local_registry_entry = entries
        .iter()
        .find(|entry| {
            entry["endpoint"]["identity_hex"]
                .as_str()
                .is_some_and(|identity| identity == endpoint.identity_hex)
        })
        .expect("registry should contain the published local endpoint");
    assert_eq!(
        local_registry_entry["endpoint"]["interface_address"].as_str(),
        Some(endpoint_address.as_str())
    );
    assert!(
        !endpoint_address.ends_with(":0"),
        "local registry must publish the actual dynamic UDP port"
    );
}

#[tokio::test]
async fn mdns_bootstrap_projects_reticulum_endpoint_without_authorizing_mesh_peer() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-mdns-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-mdns-b").await;
    let endpoint_b = node_b.provider.local_endpoint();
    let destination_b = endpoint_b
        .reticulum_destination
        .clone()
        .expect("local Reticulum destination");

    node_a
        .provider
        .upsert_mdns_bootstrap(ReticulumMdnsBootstrap {
            identity_hex: endpoint_b.identity_hex.clone(),
            host_id: Some("rt-b".to_string()),
            host: "192.168.1.20".to_string(),
            ret_port: 4242,
            reticulum_destination: Some(destination_b.clone()),
            via_interface: None,
            capabilities: vec!["ens-control".to_string()],
        })
        .expect("mDNS bootstrap should project Reticulum endpoint");

    let snapshot = node_a.service.snapshot();
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == endpoint_b.identity_hex)
        .expect("mDNS bootstrap peer should be projected as discovered endpoint");
    assert_eq!(peer.identity.host_id.as_deref(), Some("rt-b"));
    assert!(!peer.authorized);
    assert!(!peer.pairing_pending);
    let endpoint = peer.endpoint.as_ref().expect("mDNS peer endpoint");
    assert_eq!(
        endpoint.gateway,
        exomind_runtime::ens::EnsGatewayKind::Reticulum
    );
    assert_eq!(endpoint.via_interface.as_deref(), Some("lan-mdns"));
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Mdns));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some("udp://192.168.1.20:4242")
    );
    assert_eq!(endpoint.runtime_base_url, None);
    assert_eq!(
        endpoint.reticulum_destination.as_deref(),
        Some(destination_b.as_str())
    );
    assert_eq!(endpoint.discovery_source, "reticulum-mdns-bootstrap");
    assert!(
        endpoint
            .capabilities
            .iter()
            .any(|capability| capability == "reticulum-bootstrap")
    );
    assert!(
        endpoint
            .capabilities
            .iter()
            .any(|capability| capability == "ens-control")
    );
    assert!(node_a.mesh.get_peer(&endpoint_b.identity_hex).is_none());
}

#[tokio::test]
async fn mdns_bootstrap_refuses_zero_reticulum_port() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-mdns-zero-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-mdns-zero-b").await;
    let endpoint_b = node_b.provider.local_endpoint();

    let error = node_a
        .provider
        .upsert_mdns_bootstrap(ReticulumMdnsBootstrap {
            identity_hex: endpoint_b.identity_hex.clone(),
            host_id: Some("rt-b".to_string()),
            host: "192.168.1.20".to_string(),
            ret_port: 0,
            reticulum_destination: endpoint_b.reticulum_destination.clone(),
            via_interface: Some("lan-mdns".to_string()),
            capabilities: vec![],
        })
        .expect_err("mDNS bootstrap must not publish a non-dialable endpoint");

    assert!(matches!(
        error,
        EnsProviderError::Unavailable(message)
            if message.contains("ret_port must be non-zero")
    ));
    assert!(
        node_a
            .service
            .snapshot()
            .peers
            .iter()
            .all(|peer| peer.identity.identity_hex != endpoint_b.identity_hex)
    );
}

#[tokio::test]
async fn mdns_bootstrap_refuses_empty_reticulum_host() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-mdns-empty-host-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-mdns-empty-host-b").await;
    let endpoint_b = node_b.provider.local_endpoint();

    let error = node_a
        .provider
        .upsert_mdns_bootstrap(ReticulumMdnsBootstrap {
            identity_hex: endpoint_b.identity_hex.clone(),
            host_id: Some("rt-b".to_string()),
            host: "  ".to_string(),
            ret_port: 4242,
            reticulum_destination: endpoint_b.reticulum_destination.clone(),
            via_interface: Some("lan-mdns".to_string()),
            capabilities: vec![],
        })
        .expect_err("mDNS bootstrap must not publish an empty host endpoint");

    assert!(matches!(
        error,
        EnsProviderError::Unavailable(message)
            if message.contains("host must be non-empty")
    ));
    assert!(
        node_a
            .service
            .snapshot()
            .peers
            .iter()
            .all(|peer| peer.identity.identity_hex != endpoint_b.identity_hex)
    );
}

#[tokio::test]
async fn mdns_bootstrap_refuses_empty_reticulum_identity() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-mdns-empty-identity-a").await;

    let error = node_a
        .provider
        .upsert_mdns_bootstrap(ReticulumMdnsBootstrap {
            identity_hex: "  ".to_string(),
            host_id: Some("rt-b".to_string()),
            host: "192.168.1.20".to_string(),
            ret_port: 4242,
            reticulum_destination: Some("reticulum-destination-b".to_string()),
            via_interface: Some("lan-mdns".to_string()),
            capabilities: vec![],
        })
        .expect_err("mDNS bootstrap must not publish an anonymous Reticulum peer");

    assert!(matches!(
        error,
        EnsProviderError::Unavailable(message)
            if message.contains("identity must be non-empty")
    ));
    assert!(
        node_a.service.snapshot().peers.is_empty(),
        "anonymous mDNS bootstrap must not create a discovered peer"
    );
}

#[tokio::test]
async fn mdns_bootstrap_cannot_replace_existing_non_mdns_reticulum_endpoint() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-mdns-spoof-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-mdns-spoof-b").await;
    let endpoint_b = node_b.provider.local_endpoint();
    node_a
        .provider
        .upsert_discovered_endpoint(endpoint_b.clone());

    node_a
        .provider
        .upsert_mdns_bootstrap(ReticulumMdnsBootstrap {
            identity_hex: endpoint_b.identity_hex.clone(),
            host_id: Some("rt-b".to_string()),
            host: "10.0.0.99".to_string(),
            ret_port: 6553,
            reticulum_destination: Some("spoofed-reticulum-destination".to_string()),
            via_interface: Some("spoofed-mdns-interface".to_string()),
            capabilities: vec!["spoofed-capability".to_string()],
        })
        .expect("spoofed mDNS bootstrap should be ignored rather than fail");

    let snapshot = node_a.service.snapshot();
    let endpoint = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == endpoint_b.identity_hex)
        .and_then(|peer| peer.endpoint.as_ref())
        .expect("original Reticulum endpoint should remain visible");
    assert_eq!(
        endpoint.reticulum_destination.as_deref(),
        endpoint_b.reticulum_destination.as_deref()
    );
    assert_eq!(
        endpoint.interface_address.as_deref(),
        endpoint_b.interface_address.as_deref()
    );
    assert_eq!(
        endpoint.via_interface.as_deref(),
        endpoint_b.via_interface.as_deref()
    );
    assert_eq!(endpoint.discovery_source, endpoint_b.discovery_source);
    assert!(
        !endpoint
            .capabilities
            .iter()
            .any(|capability| capability == "spoofed-capability")
    );
}

#[tokio::test]
async fn udp_dynamic_port_projects_actual_bound_endpoint_state() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-udp-port-a").await;
    let bound_port = node_a
        .provider
        .add_udp_interface("127.0.0.1:0", None, EnsInterfaceTopology::Active)
        .await
        .expect("dynamic UDP interface should bind");

    let projected = wait_for_bound_udp_endpoint(&node_a.provider, &bound_port).await;
    let port = wait_for_bound_udp_port(&bound_port).await;
    let public_name = format!("127.0.0.1:{port}");
    assert_ne!(projected, "udp://127.0.0.1:0");

    let endpoint = node_a.provider.local_endpoint();
    assert_eq!(
        endpoint.via_interface.as_deref(),
        Some(public_name.as_str())
    );
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Udp));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some(projected.as_str())
    );
    assert_eq!(endpoint.discovery_source, "reticulum-provider-interface");
    let endpoint_payload =
        serde_json::to_string(&endpoint).expect("endpoint should serialize for route payloads");
    assert!(!endpoint_payload.contains("127.0.0.1:0"));
    assert!(!endpoint_payload.contains("udp://127.0.0.1:0"));

    let snapshot = node_a.service.snapshot();
    assert_eq!(
        snapshot
            .local_endpoint
            .as_ref()
            .and_then(|endpoint| endpoint.interface_address.as_deref()),
        Some(projected.as_str())
    );
    let udp = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == public_name)
        .expect("dynamic UDP interface should be visible in provider snapshot");
    assert_eq!(udp.interface_type, "udp_interface");
    assert_eq!(udp.topology, EnsInterfaceTopology::Active);
    assert_eq!(udp.effective_topology, EnsInterfaceTopology::Active);
    let snapshot_payload =
        serde_json::to_string(&snapshot).expect("snapshot should serialize for route payloads");
    assert!(!snapshot_payload.contains("127.0.0.1:0"));
    assert!(!snapshot_payload.contains("udp://127.0.0.1:0"));
    let updated = node_a
        .service
        .set_interface_topology(&public_name, EnsInterfaceTopology::Off)
        .expect("dynamic UDP public name should update manager topology");
    assert_eq!(updated.name, public_name);
    assert_eq!(updated.topology, EnsInterfaceTopology::Off);
    assert_eq!(updated.effective_topology, EnsInterfaceTopology::Off);
    assert_eq!(
        node_a
            .provider
            .local_endpoint()
            .interface_address
            .as_deref(),
        Some(projected.as_str())
    );
}

#[tokio::test]
async fn tcp_server_dynamic_port_projects_actual_bound_endpoint_state() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-tcp-port-a").await;
    node_a
        .provider
        .add_tcp_server_interface("127.0.0.1:0", EnsInterfaceTopology::Active)
        .await
        .expect("dynamic TCP server interface should bind");

    let projected = wait_for_bound_tcp_endpoint(&node_a.provider).await;
    let port = tcp_endpoint_port(&projected).expect("TCP endpoint should expose a bound port");
    let public_name = format!("127.0.0.1:{port}");
    assert_ne!(projected, "tcp-listen://127.0.0.1:0");

    let endpoint = node_a.provider.local_endpoint();
    assert_eq!(
        endpoint.via_interface.as_deref(),
        Some(public_name.as_str())
    );
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Tcp));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some(projected.as_str())
    );
    assert_eq!(endpoint.discovery_source, "reticulum-provider-interface");
    let endpoint_payload =
        serde_json::to_string(&endpoint).expect("endpoint should serialize for route payloads");
    assert!(!endpoint_payload.contains("127.0.0.1:0"));
    assert!(!endpoint_payload.contains("tcp-listen://127.0.0.1:0"));

    let snapshot = node_a.service.snapshot();
    assert_eq!(
        snapshot
            .local_endpoint
            .as_ref()
            .and_then(|endpoint| endpoint.interface_address.as_deref()),
        Some(projected.as_str())
    );
    let tcp = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == public_name)
        .expect("dynamic TCP server interface should be visible in provider snapshot");
    assert_eq!(tcp.interface_type, "tcp_server");
    assert_eq!(tcp.topology, EnsInterfaceTopology::Active);
    assert_eq!(tcp.effective_topology, EnsInterfaceTopology::Active);
    let snapshot_payload =
        serde_json::to_string(&snapshot).expect("snapshot should serialize for route payloads");
    assert!(!snapshot_payload.contains("127.0.0.1:0"));
    assert!(!snapshot_payload.contains("tcp-listen://127.0.0.1:0"));
    let updated = node_a
        .service
        .set_interface_topology(&public_name, EnsInterfaceTopology::Off)
        .expect("dynamic TCP public name should update manager topology");
    assert_eq!(updated.name, public_name);
    assert_eq!(updated.topology, EnsInterfaceTopology::Off);
    assert_eq!(updated.effective_topology, EnsInterfaceTopology::Off);
    assert_eq!(
        node_a
            .provider
            .local_endpoint()
            .interface_address
            .as_deref(),
        Some(projected.as_str())
    );
}

#[tokio::test]
async fn udp_dynamic_ports_keep_distinct_snapshot_names_and_topology_state() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-udp-two-ports-a").await;
    let first_bound_port = node_a
        .provider
        .add_udp_interface("127.0.0.1:0", None, EnsInterfaceTopology::Active)
        .await
        .expect("first dynamic UDP interface should bind");
    let pending_snapshot_payload = serde_json::to_string(&node_a.service.snapshot())
        .expect("pending snapshot should serialize for route payloads");
    assert!(!pending_snapshot_payload.contains("127.0.0.1:0"));
    assert!(!pending_snapshot_payload.contains("udp://127.0.0.1:0"));

    let second_bound_port = node_a
        .provider
        .add_udp_interface("127.0.0.1:0", None, EnsInterfaceTopology::Active)
        .await
        .expect("second dynamic UDP interface should bind");
    let first_port = wait_for_bound_udp_port(&first_bound_port).await;
    let second_port = wait_for_bound_udp_port(&second_bound_port).await;
    assert_ne!(
        first_port, second_port,
        "OS-assigned UDP dynamic ports should be distinct in one provider"
    );

    let first_public_name = format!("127.0.0.1:{first_port}");
    let second_public_name = format!("127.0.0.1:{second_port}");
    let snapshot = node_a.service.snapshot();
    let first = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == first_public_name)
        .expect("first dynamic UDP interface should keep its own public name");
    let second = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == second_public_name)
        .expect("second dynamic UDP interface should keep its own public name");
    assert_eq!(first.topology, EnsInterfaceTopology::Active);
    assert_eq!(second.topology, EnsInterfaceTopology::Active);
    let snapshot_payload =
        serde_json::to_string(&snapshot).expect("snapshot should serialize for route payloads");
    assert!(!snapshot_payload.contains("127.0.0.1:0"));
    assert!(!snapshot_payload.contains("udp://127.0.0.1:0"));

    let updated_second = node_a
        .service
        .set_interface_topology(&second_public_name, EnsInterfaceTopology::Off)
        .expect("second dynamic UDP public name should update its own manager topology");
    assert_eq!(updated_second.name, second_public_name);
    assert_eq!(updated_second.topology, EnsInterfaceTopology::Off);

    let snapshot = node_a.service.snapshot();
    let first = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == first_public_name)
        .expect("first dynamic UDP interface should remain visible");
    let second = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == second_public_name)
        .expect("second dynamic UDP interface should remain visible");
    assert_eq!(first.topology, EnsInterfaceTopology::Active);
    assert_eq!(second.topology, EnsInterfaceTopology::Off);
}
