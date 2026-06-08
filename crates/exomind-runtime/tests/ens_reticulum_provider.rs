use std::sync::Arc;
use std::time::Duration;

use exomind_runtime::ens::{
    EnsDataFrame, EnsInterfaceMedium, EnsInterfaceTopology, EnsPeerIdentity, EnsProvider,
    EnsProviderError, EnsSignalEventFrame, EnsTransportError, EnsTransportHealthStatus,
    EnsTransportService, ReticulumEnsProvider,
};
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::eventlog_appender::{
    EVENTLOG_REPLICATION_APPENDED_TOPIC, EventLogAppender, build_eventlog_replication_signal,
};
use exomind_runtime::mesh::{MeshState, PeerInfo, PeerStatus};
use exomind_runtime::pairing::PairingManager;
use exomind_runtime::signal::actors::replication_actor::spawn_replication_actor;
use reticulum::buffer::OutputBuffer;
use reticulum::hash::AddressHash;
use reticulum::identity::PrivateIdentity;
use reticulum::packet::{DestinationType, Packet, PacketType};
use reticulum::serde::Serialize as ReticulumSerialize;
use tempfile::TempDir;
use tokio::sync::mpsc;

struct ReticulumTestNode {
    service: EnsTransportService,
    provider: Arc<ReticulumEnsProvider>,
    mesh: Arc<MeshState>,
    signal_pool: Arc<exomind_runtime::signal::SignalPool>,
    eventlog_store: Arc<EventLogStore>,
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
    let replication_handle = spawn_replication_actor(
        Arc::clone(&signal_pool),
        host_id.to_string(),
        Arc::clone(&eventlog_store),
        Arc::new(exomind_runtime::task::TaskStore::new()),
        Arc::new(exomind_runtime::timeblock::TimeBlockStore::new()),
        Arc::new(exomind_runtime::proposal::ProposalStore::new()),
    );

    ReticulumTestNode {
        service,
        provider,
        mesh,
        signal_pool,
        eventlog_store,
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

async fn yield_for_replication_actor() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::time::sleep(Duration::from_millis(20)).await;
}

async fn wait_for_pending_data_frame_acceptance(service: &EnsTransportService) -> Vec<bool> {
    for _ in 0..80 {
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
    for _ in 0..80 {
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
