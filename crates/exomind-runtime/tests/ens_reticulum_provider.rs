use std::sync::Arc;
use std::time::Duration;

use exomind_runtime::ens::{
    EnsInterfaceMedium, EnsInterfaceTopology, EnsTransportService, ReticulumEnsProvider,
};
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::eventlog_appender::{EVENTLOG_REPLICATION_APPENDED_TOPIC, EventLogAppender};
use exomind_runtime::mesh::{MeshState, PeerInfo, PeerStatus};
use exomind_runtime::pairing::PairingManager;
use exomind_runtime::signal::actors::replication_actor::spawn_replication_actor;
use reticulum::identity::PrivateIdentity;
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

async fn connect_queue_interfaces(node_a: &ReticulumTestNode, node_b: &ReticulumTestNode) {
    let (a_to_b_tx, a_to_b_rx) = mpsc::channel(64);
    let (b_to_a_tx, b_to_a_rx) = mpsc::channel(64);
    node_a
        .provider
        .add_queue_interface(
            "test-queue-a",
            b_to_a_rx,
            a_to_b_tx,
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node A queue interface");
    node_b
        .provider
        .add_queue_interface(
            "test-queue-b",
            a_to_b_rx,
            b_to_a_tx,
            EnsInterfaceTopology::Active,
        )
        .await
        .expect("node B queue interface");
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

async fn wait_for_pending_data_frames(service: &EnsTransportService) -> Vec<bool> {
    for _ in 0..40 {
        let accepted = service
            .handle_pending_data_frames()
            .await
            .expect("pending provider frames should be readable");
        if !accepted.is_empty() {
            return accepted;
        }
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("provider did not receive data frames");
}

async fn wait_for_event(store: &EventLogStore, event_id: &str) -> EventRecord {
    for _ in 0..40 {
        if let Some(event) = store
            .list_events(Some("profile-sync"))
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

#[tokio::test]
async fn queue_reticulum_provider_replicates_eventlog_signal_event_without_http_sse() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-test-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-test-b").await;
    connect_queue_interfaces(&node_a, &node_b).await;

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

    let accepted = wait_for_pending_data_frames(&node_b.service).await;
    assert_eq!(accepted, vec![true]);

    let replicated = wait_for_event(&node_b.eventlog_store, "event-reticulum-1").await;
    assert_eq!(replicated.content, "Reticulum queue provider event");
    assert_eq!(replicated.tags, vec!["note", "reticulum"]);
}

#[tokio::test]
async fn queue_interface_and_local_registry_project_reticulum_endpoint_state() {
    let node_a = reticulum_node("ens-ret-a", "rt-a", "ens-reticulum-registry-a").await;
    let node_b = reticulum_node("ens-ret-b", "rt-b", "ens-reticulum-registry-b").await;
    connect_queue_interfaces(&node_a, &node_b).await;

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
