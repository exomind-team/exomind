use std::sync::Arc;

use exomind_runtime::ens::{
    EnsEndpointAdvertisement, EnsGatewayKind, EnsInterfaceMedium, EnsInterfaceTopology,
    EnsOperationStatus, EnsPairingCancel, EnsPairingFrame, EnsPairingResponse, EnsPeerIdentity,
    EnsProviderError, EnsTransportError, EnsTransportService, ReticulumMdnsBootstrap,
};
use exomind_runtime::mesh::MeshState;
use exomind_runtime::pairing::PairingManager;
use exomind_runtime::signal::{SignalEvent, SignalPool};

fn test_service() -> (
    EnsTransportService,
    Arc<exomind_runtime::ens::FakeEnsProvider>,
    Arc<MeshState>,
) {
    test_service_without_endpoint("rt-a")
}

fn test_service_without_endpoint(
    host_id: &str,
) -> (
    EnsTransportService,
    Arc<exomind_runtime::ens::FakeEnsProvider>,
    Arc<MeshState>,
) {
    let signal_pool = Arc::new(SignalPool::new(None));
    let mesh = Arc::new(MeshState::new(
        host_id.to_string(),
        Arc::clone(&signal_pool),
        None,
    ));
    let pairing = Arc::new(PairingManager::new());
    let (service, provider) =
        EnsTransportService::new_fake(host_id.to_string(), Arc::clone(&mesh), pairing);
    (service, provider, mesh)
}

fn test_service_for(
    host_id: &str,
    local_endpoint: EnsEndpointAdvertisement,
) -> (
    EnsTransportService,
    Arc<exomind_runtime::ens::FakeEnsProvider>,
    Arc<MeshState>,
) {
    let signal_pool = Arc::new(SignalPool::new(None));
    let mesh = Arc::new(MeshState::new(
        host_id.to_string(),
        Arc::clone(&signal_pool),
        None,
    ));
    let pairing = Arc::new(PairingManager::new());
    let (service, provider) = EnsTransportService::new_fake_with_endpoint(
        host_id.to_string(),
        Arc::clone(&mesh),
        pairing,
        local_endpoint,
    );
    (service, provider, mesh)
}

fn endpoint_for(
    identity_hex: &str,
    host_id: &str,
    runtime_base_url: &str,
    reticulum_destination: &str,
    interface_address: &str,
) -> EnsEndpointAdvertisement {
    EnsEndpointAdvertisement {
        identity_hex: identity_hex.to_string(),
        host_id: Some(host_id.to_string()),
        gateway: EnsGatewayKind::Reticulum,
        via_interface: Some("lan-udp".to_string()),
        via_medium: Some(EnsInterfaceMedium::Udp),
        runtime_base_url: Some(runtime_base_url.to_string()),
        reticulum_destination: Some(reticulum_destination.to_string()),
        interface_address: Some(interface_address.to_string()),
        discovery_source: "fake-provider".to_string(),
        capabilities: vec!["relay".to_string()],
    }
}

fn initiator_endpoint() -> EnsEndpointAdvertisement {
    endpoint_for(
        "identity-a",
        "rt-a",
        "http://192.168.1.10:1949",
        "reticulum-destination-a",
        "udp://192.168.1.10:4242",
    )
}

fn responder_endpoint() -> EnsEndpointAdvertisement {
    endpoint_for(
        "identity-b",
        "rt-b",
        "http://192.168.1.20:1949",
        "reticulum-destination-b",
        "udp://192.168.1.20:4242",
    )
}

fn reticulum_mdns_bootstrap(identity_hex: &str, host_id: &str) -> ReticulumMdnsBootstrap {
    ReticulumMdnsBootstrap {
        identity_hex: identity_hex.to_string(),
        host_id: Some(host_id.to_string()),
        host: "192.168.1.20".to_string(),
        ret_port: 4242,
        reticulum_destination: Some("reticulum-destination-b".to_string()),
        via_interface: Some("lan-mdns".to_string()),
        capabilities: vec!["ens-control".to_string()],
    }
}

fn sample_signal_event() -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: "signal-mdns-bootstrap".to_string(),
        topic: "eventlog.replication.appended".to_string(),
        ts: 1_710_000_000_000,
        source: "test".to_string(),
        origin_host_id: "rt-a".to_string(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({ "event_id": "event-mdns-bootstrap" }),
    }
}

fn interface_snapshot(
    name: &str,
    interface_type: &str,
    topology: EnsInterfaceTopology,
) -> exomind_runtime::ens::EnsInterfaceSnapshot {
    exomind_runtime::ens::EnsInterfaceSnapshot {
        name: name.to_string(),
        interface_type: interface_type.to_string(),
        online: true,
        outgoing: true,
        topology,
        effective_topology: topology,
    }
}

fn discovered_peer(endpoint: EnsEndpointAdvertisement) -> exomind_runtime::ens::EnsPeerSnapshot {
    exomind_runtime::ens::EnsPeerSnapshot {
        identity: endpoint.identity(),
        endpoint: Some(endpoint),
        authorized: false,
        pairing_pending: false,
        last_error: None,
    }
}

#[test]
fn interface_topology_orders_by_restrictiveness() {
    assert!(EnsInterfaceTopology::Off < EnsInterfaceTopology::Passive);
    assert!(EnsInterfaceTopology::Passive < EnsInterfaceTopology::Active);
}

#[test]
fn snapshot_exposes_provider_interfaces_for_debug_status() {
    let (service, provider, _mesh) = test_service();
    provider.set_interfaces(vec![
        interface_snapshot("lan-udp", "udp", EnsInterfaceTopology::Active),
        interface_snapshot("dev-queue", "queue", EnsInterfaceTopology::Passive),
    ]);

    let snapshot = service.snapshot();

    assert_eq!(snapshot.interfaces.len(), 2);
    assert_eq!(snapshot.interfaces[0].name, "lan-udp");
    assert_eq!(
        snapshot.interfaces[0].topology,
        EnsInterfaceTopology::Active
    );
    assert_eq!(
        snapshot.interfaces[0].effective_topology,
        EnsInterfaceTopology::Active
    );
    assert_eq!(snapshot.interfaces[1].name, "dev-queue");
    assert_eq!(
        snapshot.interfaces[1].topology,
        EnsInterfaceTopology::Passive
    );
}

#[test]
fn set_interface_topology_updates_provider_snapshot() {
    let (service, provider, _mesh) = test_service();
    provider.set_interfaces(vec![interface_snapshot(
        "lan-udp",
        "udp",
        EnsInterfaceTopology::Active,
    )]);

    let updated = service
        .set_interface_topology("lan-udp", EnsInterfaceTopology::Off)
        .expect("interface topology update should succeed");

    assert_eq!(updated.name, "lan-udp");
    assert_eq!(updated.topology, EnsInterfaceTopology::Off);
    assert_eq!(updated.effective_topology, EnsInterfaceTopology::Off);
    let snapshot = service.snapshot();
    assert_eq!(snapshot.interfaces[0].topology, EnsInterfaceTopology::Off);
    assert_eq!(
        snapshot.interfaces[0].effective_topology,
        EnsInterfaceTopology::Off
    );
}

#[test]
fn set_interface_topology_rejects_unknown_interface() {
    let (service, provider, _mesh) = test_service();
    provider.set_interfaces(vec![interface_snapshot(
        "lan-udp",
        "udp",
        EnsInterfaceTopology::Active,
    )]);

    let error = service
        .set_interface_topology("missing", EnsInterfaceTopology::Off)
        .expect_err("unknown interface should be rejected");

    assert_eq!(
        error,
        EnsTransportError::Provider(EnsProviderError::InterfaceNotFound("missing".to_string()))
    );
}

#[test]
fn set_global_topology_limits_effective_topology_without_mutating_interfaces() {
    let (service, provider, _mesh) = test_service();
    provider.set_interfaces(vec![
        interface_snapshot("lan-udp", "udp", EnsInterfaceTopology::Active),
        interface_snapshot("dev-queue", "queue", EnsInterfaceTopology::Passive),
    ]);

    let snapshot = service
        .set_global_topology(EnsInterfaceTopology::Passive)
        .expect("global interface topology update should succeed");

    assert_eq!(snapshot.global_topology, EnsInterfaceTopology::Passive);
    let lan = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == "lan-udp")
        .expect("lan interface should be present");
    assert_eq!(lan.topology, EnsInterfaceTopology::Active);
    assert_eq!(lan.effective_topology, EnsInterfaceTopology::Passive);
    let queue = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.name == "dev-queue")
        .expect("queue interface should be present");
    assert_eq!(queue.topology, EnsInterfaceTopology::Passive);
    assert_eq!(queue.effective_topology, EnsInterfaceTopology::Passive);
}

#[test]
fn global_off_forces_effective_off_without_losing_interface_configuration() {
    let (service, provider, _mesh) = test_service();
    provider.set_interfaces(vec![
        interface_snapshot("lan-udp", "udp", EnsInterfaceTopology::Active),
        interface_snapshot("dev-queue", "queue", EnsInterfaceTopology::Passive),
    ]);

    let snapshot = service
        .set_global_topology(EnsInterfaceTopology::Off)
        .expect("global interface topology update should succeed");

    assert_eq!(snapshot.global_topology, EnsInterfaceTopology::Off);
    assert!(
        snapshot
            .interfaces
            .iter()
            .all(|interface| interface.effective_topology == EnsInterfaceTopology::Off)
    );
    assert!(
        service
            .snapshot()
            .interfaces
            .iter()
            .any(|interface| interface.name == "lan-udp"
                && interface.topology == EnsInterfaceTopology::Active
                && interface.effective_topology == EnsInterfaceTopology::Off)
    );
}

#[test]
fn discovered_peer_can_start_pairing_offer() {
    let endpoint_a = initiator_endpoint();
    let endpoint_b = responder_endpoint();
    let (service, provider, _mesh) = test_service_for("rt-a", endpoint_a);
    provider.set_peers(vec![discovered_peer(endpoint_b.clone())]);

    let visible_peer = service
        .snapshot()
        .peers
        .into_iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .expect("discovered peer should be visible in debug snapshot");
    assert!(!visible_peer.authorized);
    let endpoint = visible_peer
        .endpoint
        .as_ref()
        .expect("discovered peer should expose Reticulum gateway endpoint");
    assert_eq!(endpoint.gateway, EnsGatewayKind::Reticulum);
    assert_eq!(endpoint.via_interface.as_deref(), Some("lan-udp"));
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Udp));
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some("udp://192.168.1.20:4242")
    );

    let ticket = service
        .initiate_pairing_with_discovered_peer("identity-b")
        .expect("discovered peer endpoint should be pairable");

    assert_eq!(ticket.status, EnsOperationStatus::Pending);
    let offer = match provider
        .sent_frames()
        .first()
        .expect("pairing should send an offer frame")
        .clone()
    {
        EnsPairingFrame::PairingOffer(offer) => offer,
        other => panic!("expected PairingOffer, got {other:?}"),
    };
    assert_eq!(offer.operation_id, ticket.operation_id);
    assert_eq!(offer.session_id, ticket.session_id);
    assert_eq!(offer.initiator.identity_hex, "identity-a");
}

#[test]
fn discovered_peer_pairing_rejects_unknown_identity() {
    let (service, _provider, _mesh) = test_service_for("rt-a", initiator_endpoint());

    let error = service
        .initiate_pairing_with_discovered_peer("missing")
        .expect_err("unknown discovered peer should be rejected");

    assert_eq!(
        error,
        EnsTransportError::DiscoveredPeerNotFound("missing".to_string())
    );
}

#[test]
fn mdns_bootstrap_projects_discovered_peer_without_authorizing_data_frames() {
    let (service, _provider, mesh) = test_service_for("rt-a", initiator_endpoint());

    service
        .upsert_mdns_bootstrap(reticulum_mdns_bootstrap("identity-b", "rt-b"))
        .expect("mDNS Reticulum bootstrap should project a discovered endpoint");

    let snapshot = service.snapshot();
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .expect("mDNS bootstrap peer should appear in ENS debug snapshot");
    assert_eq!(peer.identity.host_id.as_deref(), Some("rt-b"));
    assert!(!peer.authorized);
    assert!(!peer.pairing_pending);
    let endpoint = peer.endpoint.as_ref().expect("mDNS peer endpoint");
    assert_eq!(endpoint.gateway, EnsGatewayKind::Reticulum);
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Mdns));
    assert_eq!(endpoint.runtime_base_url, None);
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some("udp://192.168.1.20:4242")
    );
    assert_eq!(endpoint.discovery_source, "reticulum-mdns-bootstrap");
    assert!(mesh.get_peer("identity-b").is_none());

    let error = service
        .send_signal_event_to_peer("identity-b", sample_signal_event())
        .expect_err("mDNS discovery alone must not authorize Reticulum data frames");
    assert_eq!(
        error,
        EnsTransportError::UnauthorizedDataFramePeer("identity-b".to_string())
    );
    assert!(mesh.get_peer("identity-b").is_none());
}

#[test]
fn mdns_bootstrap_endpoint_cannot_complete_legacy_http_pairing_without_runtime_url() {
    let (service, _provider, mesh) = test_service_for("rt-a", initiator_endpoint());

    service
        .upsert_mdns_bootstrap(reticulum_mdns_bootstrap("identity-b", "rt-b"))
        .expect("mDNS Reticulum bootstrap should project a discovered endpoint");
    let ticket = service
        .initiate_pairing_with_discovered_peer("identity-b")
        .expect("mDNS Reticulum endpoint can still start the user-visible pairing handshake");
    let endpoint = service
        .snapshot()
        .peers
        .into_iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .and_then(|peer| peer.endpoint)
        .expect("mDNS peer endpoint should remain visible after pairing starts");

    let error = service
        .handle_pairing_response(EnsPairingResponse {
            operation_id: ticket.operation_id,
            session_id: ticket.session_id,
            responder: EnsPeerIdentity::new("identity-b").with_host_id("rt-b"),
            responder_endpoint: endpoint,
            pin: ticket.pin,
            responder_inbound_secret: Some("secret-for-rt-a-to-call-b".to_string()),
        })
        .expect_err("legacy HTTP mesh authorization requires runtime_base_url");

    assert_eq!(error, EnsTransportError::MissingRuntimeEndpoint);
    assert!(mesh.get_peer("identity-b").is_none());
}

#[test]
fn mdns_bootstrap_ignores_local_identity_at_service_boundary() {
    let (service, _provider, _mesh) = test_service_for("rt-a", initiator_endpoint());

    service
        .upsert_mdns_bootstrap(reticulum_mdns_bootstrap("identity-a", "rt-a"))
        .expect("self mDNS bootstrap should be ignored");

    assert!(
        service.snapshot().peers.is_empty(),
        "self mDNS bootstrap must not create a discovered peer"
    );
}

#[test]
fn mdns_bootstrap_refuses_empty_identity_at_provider_boundary() {
    let (service, _provider, _mesh) = test_service_for("rt-a", initiator_endpoint());
    let mut bootstrap = reticulum_mdns_bootstrap("  ", "rt-b");
    bootstrap.host = "192.168.1.20".to_string();

    let error = service
        .upsert_mdns_bootstrap(bootstrap)
        .expect_err("anonymous mDNS bootstrap must not create a discovered peer");

    assert!(matches!(
        error,
        EnsTransportError::Provider(EnsProviderError::Unavailable(message))
            if message.contains("identity must be non-empty")
    ));
    assert!(
        service.snapshot().peers.is_empty(),
        "anonymous mDNS bootstrap must not create a discovered peer"
    );
}

#[test]
fn mdns_bootstrap_cannot_replace_non_mdns_discovered_endpoint() {
    let (service, provider, _mesh) = test_service_for("rt-a", initiator_endpoint());
    let original = responder_endpoint();
    provider.set_peers(vec![discovered_peer(original.clone())]);

    let mut spoofed = reticulum_mdns_bootstrap("identity-b", "rt-b");
    spoofed.host = "10.0.0.99".to_string();
    spoofed.ret_port = 6553;
    spoofed.reticulum_destination = Some("spoofed-reticulum-destination".to_string());

    service
        .upsert_mdns_bootstrap(spoofed)
        .expect("spoofed mDNS bootstrap should be ignored rather than fail");

    let snapshot = service.snapshot();
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .expect("original discovered peer should remain visible");
    let endpoint = peer.endpoint.as_ref().expect("original endpoint");
    assert_eq!(
        endpoint.reticulum_destination.as_deref(),
        original.reticulum_destination.as_deref()
    );
    assert_eq!(
        endpoint.interface_address.as_deref(),
        original.interface_address.as_deref()
    );
    assert_eq!(endpoint.discovery_source, "fake-provider");
}

#[test]
fn mdns_bootstrap_can_refresh_previous_mdns_bootstrap_endpoint() {
    let (service, _provider, _mesh) = test_service_for("rt-a", initiator_endpoint());

    service
        .upsert_mdns_bootstrap(reticulum_mdns_bootstrap("identity-b", "rt-b"))
        .expect("first mDNS bootstrap should insert peer");
    let mut refreshed = reticulum_mdns_bootstrap("identity-b", "rt-b");
    refreshed.host = "192.168.1.21".to_string();
    refreshed.ret_port = 5252;
    refreshed.reticulum_destination = Some("refreshed-reticulum-destination".to_string());

    service
        .upsert_mdns_bootstrap(refreshed)
        .expect("second mDNS bootstrap should refresh the low-trust endpoint");

    let snapshot = service.snapshot();
    let endpoint = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .and_then(|peer| peer.endpoint.as_ref())
        .expect("refreshed mDNS endpoint");
    assert_eq!(
        endpoint.interface_address.as_deref(),
        Some("udp://192.168.1.21:5252")
    );
    assert_eq!(
        endpoint.reticulum_destination.as_deref(),
        Some("refreshed-reticulum-destination")
    );
    assert_eq!(endpoint.discovery_source, "reticulum-mdns-bootstrap");
}

#[test]
fn pairing_frame_round_trips_with_typed_variant() {
    let frame = EnsPairingFrame::PairingCancel(EnsPairingCancel {
        operation_id: "op-cancel".to_string(),
        session_id: "session-a".to_string(),
        peer: EnsPeerIdentity::new("identity-b").with_host_id("rt-b"),
        reason: "user_cancelled".to_string(),
    });

    let encoded = serde_json::to_string(&frame).expect("frame should serialize");
    let decoded: EnsPairingFrame =
        serde_json::from_str(&encoded).expect("frame should deserialize");

    assert_eq!(decoded, frame);
}

#[test]
fn pairing_response_authorizes_identity_keyed_mesh_peer() {
    let (service, provider, mesh) = test_service();
    let endpoint = responder_endpoint();

    let ticket = service
        .initiate_pairing_offer(endpoint.clone())
        .expect("offer should be accepted");
    assert_eq!(ticket.status, EnsOperationStatus::Pending);
    assert_eq!(ticket.pin.len(), 6);

    let frames = provider.sent_frames();
    assert_eq!(frames.len(), 1);
    assert!(matches!(
        frames.first(),
        Some(EnsPairingFrame::PairingOffer(_))
    ));

    let ack = service
        .handle_pairing_response(EnsPairingResponse {
            operation_id: ticket.operation_id.clone(),
            session_id: ticket.session_id,
            responder: endpoint.identity(),
            responder_endpoint: endpoint.clone(),
            pin: ticket.pin,
            responder_inbound_secret: Some("secret-for-rt-a-to-call-b".to_string()),
        })
        .expect("correct PIN should authorize responder");

    assert_eq!(ack.status, EnsOperationStatus::Completed);
    let peer = mesh
        .get_peer("identity-b")
        .expect("MeshState should store identity-keyed ENS peer");
    assert_eq!(peer.id, "identity-b");
    assert_eq!(peer.base_url, "http://192.168.1.20:1949");
    assert!(peer.enabled);
    assert_eq!(
        peer.auth_token.as_deref(),
        Some("secret-for-rt-a-to-call-b")
    );
    assert!(
        peer.inbound_secret.is_some(),
        "initiator should generate an inbound secret for the responder"
    );
    assert!(peer.capabilities.iter().any(|value| value == "ens-control"));
    assert!(
        peer.capabilities
            .iter()
            .any(|value| value == "host_id:rt-b")
    );

    let snapshot = service.snapshot();
    let ens_peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .expect("snapshot should include responder peer");
    assert!(ens_peer.authorized);
    assert!(!ens_peer.pairing_pending);
}

#[test]
fn two_fake_nodes_authorize_each_other_after_pin_pairing() {
    let endpoint_a = initiator_endpoint();
    let endpoint_b = responder_endpoint();
    let (node_a, provider_a, mesh_a) = test_service_for("rt-a", endpoint_a.clone());
    let (node_b, provider_b, mesh_b) = test_service_for("rt-b", endpoint_b.clone());

    let ticket = node_a
        .initiate_pairing_offer(endpoint_b.clone())
        .expect("initiator should send pairing offer");

    let offer = match provider_a
        .sent_frames()
        .first()
        .expect("initiator should emit PairingOffer")
        .clone()
    {
        EnsPairingFrame::PairingOffer(offer) => offer,
        other => panic!("expected PairingOffer, got {other:?}"),
    };
    assert_eq!(offer.operation_id, ticket.operation_id);
    assert_eq!(offer.session_id, ticket.session_id);
    assert_eq!(
        offer
            .initiator_endpoint
            .as_ref()
            .and_then(|endpoint| endpoint.runtime_base_url.as_deref()),
        Some("http://192.168.1.10:1949")
    );

    let pending_ack = node_b
        .handle_pairing_offer(offer)
        .expect("responder should record pending offer");
    assert_eq!(pending_ack.status, EnsOperationStatus::Pending);

    let pending_peer = node_b
        .snapshot()
        .peers
        .into_iter()
        .find(|peer| peer.identity.identity_hex == "identity-a")
        .expect("responder should expose pending initiator");
    assert!(!pending_peer.authorized);
    assert!(pending_peer.pairing_pending);

    let accept_ack = node_b
        .accept_pairing_offer(&ticket.operation_id, ticket.pin.clone())
        .expect("responder should accept offer with displayed PIN");
    assert_eq!(accept_ack.status, EnsOperationStatus::Pending);

    let response = match provider_b
        .sent_frames()
        .first()
        .expect("responder should emit PairingResponse")
        .clone()
    {
        EnsPairingFrame::PairingResponse(response) => response,
        other => panic!("expected PairingResponse, got {other:?}"),
    };
    let responder_inbound_secret = response
        .responder_inbound_secret
        .clone()
        .expect("responder response should include an inbound secret");
    assert_eq!(response.operation_id, ticket.operation_id);
    assert_eq!(response.session_id, ticket.session_id);
    assert_eq!(response.pin, ticket.pin);

    let initiator_ack = node_a
        .handle_pairing_response(response)
        .expect("initiator should validate PIN and authorize responder");
    assert_eq!(initiator_ack.status, EnsOperationStatus::Completed);

    let complete = match provider_a
        .sent_frames()
        .last()
        .expect("initiator should emit PairingComplete")
        .clone()
    {
        EnsPairingFrame::PairingComplete(complete) => complete,
        other => panic!("expected PairingComplete, got {other:?}"),
    };
    let initiator_inbound_secret = complete.initiator_inbound_secret.clone();
    assert_eq!(complete.operation_id, ticket.operation_id);
    assert_eq!(complete.session_id, ticket.session_id);
    assert_eq!(
        complete
            .initiator_endpoint
            .as_ref()
            .and_then(|endpoint| endpoint.runtime_base_url.as_deref()),
        Some("http://192.168.1.10:1949")
    );

    let responder_ack = node_b
        .handle_pairing_complete(complete)
        .expect("responder should authorize initiator after completion");
    assert_eq!(responder_ack.status, EnsOperationStatus::Completed);

    let peer_b = mesh_a
        .get_peer("identity-b")
        .expect("initiator mesh should authorize responder identity");
    assert_eq!(peer_b.base_url, "http://192.168.1.20:1949");
    assert!(peer_b.enabled);
    assert_eq!(
        peer_b.auth_token.as_deref(),
        Some(responder_inbound_secret.as_str())
    );
    assert_eq!(
        peer_b.inbound_secret.as_deref(),
        Some(initiator_inbound_secret.as_str())
    );
    assert!(
        peer_b
            .capabilities
            .iter()
            .any(|value| value == "ens-control")
    );
    assert!(
        peer_b
            .capabilities
            .iter()
            .any(|value| value == "host_id:rt-b")
    );

    let peer_a = mesh_b
        .get_peer("identity-a")
        .expect("responder mesh should authorize initiator identity");
    assert_eq!(peer_a.base_url, "http://192.168.1.10:1949");
    assert!(peer_a.enabled);
    assert_eq!(
        peer_a.auth_token.as_deref(),
        Some(initiator_inbound_secret.as_str())
    );
    assert_eq!(
        peer_a.inbound_secret.as_deref(),
        Some(responder_inbound_secret.as_str())
    );
    assert!(
        peer_a
            .capabilities
            .iter()
            .any(|value| value == "ens-control")
    );
    assert!(
        peer_a
            .capabilities
            .iter()
            .any(|value| value == "host_id:rt-a")
    );

    let responder_snapshot = node_b.snapshot();
    let authorized_initiator = responder_snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-a")
        .expect("responder snapshot should keep initiator visible");
    assert!(authorized_initiator.authorized);
    assert!(!authorized_initiator.pairing_pending);
}

#[test]
fn accepting_pairing_offer_requires_local_endpoint() {
    let endpoint_a = initiator_endpoint();
    let endpoint_b = responder_endpoint();
    let (node_a, provider_a, _mesh_a) = test_service_for("rt-a", endpoint_a);
    let (node_b, _provider_b, _mesh_b) = test_service_without_endpoint("rt-b");

    let ticket = node_a
        .initiate_pairing_offer(endpoint_b)
        .expect("initiator should send pairing offer");
    let offer = match provider_a
        .sent_frames()
        .first()
        .expect("initiator should emit PairingOffer")
        .clone()
    {
        EnsPairingFrame::PairingOffer(offer) => offer,
        other => panic!("expected PairingOffer, got {other:?}"),
    };

    node_b
        .handle_pairing_offer(offer)
        .expect("responder should record pending offer before accepting");
    let error = node_b
        .accept_pairing_offer(&ticket.operation_id, ticket.pin)
        .expect_err("local endpoint is required before sending response");

    assert_eq!(error, EnsTransportError::MissingLocalEndpoint);
}

#[test]
fn wrong_pin_fails_operation_without_authorizing_peer() {
    let (service, _provider, mesh) = test_service();
    let endpoint = responder_endpoint();

    let ticket = service
        .initiate_pairing_offer(endpoint.clone())
        .expect("offer should be accepted");

    let error = service
        .handle_pairing_response(EnsPairingResponse {
            operation_id: ticket.operation_id.clone(),
            session_id: ticket.session_id,
            responder: endpoint.identity(),
            responder_endpoint: endpoint,
            pin: "000000".to_string(),
            responder_inbound_secret: None,
        })
        .expect_err("wrong PIN should fail");

    assert_eq!(error, EnsTransportError::IncorrectPin);
    assert!(
        mesh.get_peer("identity-b").is_none(),
        "wrong PIN must not authorize an ENS peer"
    );
    let operation = service
        .snapshot()
        .operations
        .into_iter()
        .find(|operation| operation.id == ticket.operation_id)
        .expect("failed operation should remain observable");
    assert_eq!(operation.status, EnsOperationStatus::Failed);
}

#[test]
fn pairing_cancel_clears_pending_state() {
    let (service, _provider, _mesh) = test_service();
    let endpoint = responder_endpoint();

    let ticket = service
        .initiate_pairing_offer(endpoint.clone())
        .expect("offer should be accepted");

    let ack = service
        .handle_pairing_cancel(EnsPairingCancel {
            operation_id: ticket.operation_id.clone(),
            session_id: ticket.session_id,
            peer: endpoint.identity(),
            reason: "user_cancelled".to_string(),
        })
        .expect("cancel should be accepted");

    assert_eq!(ack.status, EnsOperationStatus::Cancelled);
    let snapshot = service.snapshot();
    let peer = snapshot
        .peers
        .iter()
        .find(|peer| peer.identity.identity_hex == "identity-b")
        .expect("cancelled peer should stay visible for traceability");
    assert!(!peer.authorized);
    assert!(!peer.pairing_pending);
    assert_eq!(peer.last_error.as_deref(), Some("user_cancelled"));
}

#[test]
fn pairing_cancel_blocks_late_correct_pin_response() {
    let (service, _provider, mesh) = test_service();
    let endpoint = responder_endpoint();

    let ticket = service
        .initiate_pairing_offer(endpoint.clone())
        .expect("offer should be accepted");
    let session_id = ticket.session_id.clone();
    let pin = ticket.pin.clone();

    service
        .handle_pairing_cancel(EnsPairingCancel {
            operation_id: ticket.operation_id.clone(),
            session_id,
            peer: endpoint.identity(),
            reason: "user_cancelled".to_string(),
        })
        .expect("cancel should be accepted");

    let error = service
        .handle_pairing_response(EnsPairingResponse {
            operation_id: ticket.operation_id.clone(),
            session_id: ticket.session_id,
            responder: endpoint.identity(),
            responder_endpoint: endpoint,
            pin,
            responder_inbound_secret: Some("secret-for-rt-a-to-call-b".to_string()),
        })
        .expect_err("cancelled session must reject late responses");

    assert_eq!(error, EnsTransportError::PairingOperationCancelled);
    assert!(
        mesh.get_peer("identity-b").is_none(),
        "cancelled pairing must not authorize a late responder"
    );
    let operation = service
        .snapshot()
        .operations
        .into_iter()
        .find(|operation| operation.id == ticket.operation_id)
        .expect("cancelled operation should remain observable");
    assert_eq!(operation.status, EnsOperationStatus::Cancelled);
}

#[test]
fn provider_send_failure_marks_operation_failed() {
    let (service, provider, _mesh) = test_service();
    provider.set_fail_next_send("link unavailable");

    let error = service
        .initiate_pairing_offer(responder_endpoint())
        .expect_err("provider failure should reject offer");

    assert!(matches!(error, EnsTransportError::Provider(_)));
    let snapshot = service.snapshot();
    let operation = snapshot
        .operations
        .iter()
        .find(|operation| operation.status == EnsOperationStatus::Failed)
        .expect("provider failure should leave failed operation evidence");
    assert_eq!(
        operation.error.as_deref(),
        Some("ENS provider failed to send pairing frame: link unavailable")
    );
}
