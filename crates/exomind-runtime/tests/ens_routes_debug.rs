use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use exomind_runtime::ens::{
    EnsEndpointAdvertisement, EnsGatewayKind, EnsInterfaceMedium, EnsInterfaceSnapshot,
    EnsInterfaceTopology, EnsPairingFrame, EnsPeerSnapshot, EnsTransportService, FakeEnsProvider,
};
use exomind_runtime::{AppState, app_with_state};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

fn endpoint_for(identity_hex: &str, host_id: &str) -> EnsEndpointAdvertisement {
    EnsEndpointAdvertisement {
        identity_hex: identity_hex.to_string(),
        host_id: Some(host_id.to_string()),
        gateway: EnsGatewayKind::Reticulum,
        via_interface: Some("lan-udp".to_string()),
        via_medium: Some(EnsInterfaceMedium::Udp),
        runtime_base_url: Some("http://192.168.1.20:9124".to_string()),
        reticulum_destination: Some(format!("reticulum-destination-{host_id}")),
        interface_address: Some("udp://192.168.1.20:4242".to_string()),
        discovery_source: "fake-provider".to_string(),
        capabilities: vec!["ens-control".to_string()],
    }
}

fn interface_snapshot(name: &str, topology: EnsInterfaceTopology) -> EnsInterfaceSnapshot {
    EnsInterfaceSnapshot {
        name: name.to_string(),
        interface_type: "udp".to_string(),
        online: true,
        outgoing: true,
        topology,
        effective_topology: topology,
    }
}

fn state_with_ens_provider() -> (AppState, Arc<FakeEnsProvider>) {
    let mut state = AppState::new(0);
    let local_endpoint = endpoint_for("identity-a", "rt-a");
    let (service, provider) = EnsTransportService::new_fake_with_endpoint(
        state.host_id.clone(),
        Arc::clone(&state.mesh),
        Arc::clone(&state.pairing),
        local_endpoint,
    );
    provider.set_interfaces(vec![interface_snapshot(
        "lan-udp",
        EnsInterfaceTopology::Active,
    )]);
    state.ens_transport = Arc::new(service);
    (state, provider)
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn ens_snapshot_route_exposes_provider_interfaces() {
    let (state, _provider) = state_with_ens_provider();
    let response = app_with_state(state)
        .oneshot(
            Request::builder()
                .uri("/mesh/ens/snapshot")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let payload = response_json(response).await;
    assert_eq!(payload["provider_id"], "fake-ens");
    assert_eq!(
        payload["local_endpoint"]["interface_address"],
        "udp://192.168.1.20:4242"
    );
    assert_eq!(payload["global_topology"], "active");
    assert_eq!(payload["interfaces"][0]["name"], "lan-udp");
    assert_eq!(payload["interfaces"][0]["topology"], "active");
    assert_eq!(payload["interfaces"][0]["effective_topology"], "active");
}

#[tokio::test]
async fn ens_interface_topology_route_updates_snapshot_truth() {
    let (state, _provider) = state_with_ens_provider();
    let app = app_with_state(state);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mesh/ens/interfaces/lan-udp/topology")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"topology":"passive"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let updated = response_json(response).await;
    assert_eq!(updated["topology"], "passive");
    assert_eq!(updated["effective_topology"], "passive");

    let snapshot_response = app
        .oneshot(
            Request::builder()
                .uri("/mesh/ens/snapshot")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let snapshot = response_json(snapshot_response).await;
    assert_eq!(snapshot["interfaces"][0]["topology"], "passive");
    assert_eq!(snapshot["interfaces"][0]["effective_topology"], "passive");
}

#[tokio::test]
async fn ens_global_topology_route_limits_effective_topology_without_mutating_interfaces() {
    let (state, _provider) = state_with_ens_provider();
    let app = app_with_state(state);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mesh/ens/topology")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"topology":"passive"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let updated = response_json(response).await;
    assert_eq!(updated["global_topology"], "passive");
    assert_eq!(updated["interfaces"][0]["topology"], "active");
    assert_eq!(updated["interfaces"][0]["effective_topology"], "passive");

    let snapshot_response = app
        .oneshot(
            Request::builder()
                .uri("/mesh/ens/snapshot")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let snapshot = response_json(snapshot_response).await;
    assert_eq!(snapshot["global_topology"], "passive");
    assert_eq!(snapshot["interfaces"][0]["topology"], "active");
    assert_eq!(snapshot["interfaces"][0]["effective_topology"], "passive");
}

#[tokio::test]
async fn ens_pairing_route_starts_offer_for_discovered_peer() {
    let (state, provider) = state_with_ens_provider();
    let peer_endpoint = endpoint_for("identity-b", "rt-b");
    provider.set_peers(vec![EnsPeerSnapshot {
        identity: peer_endpoint.identity(),
        endpoint: Some(peer_endpoint),
        authorized: false,
        pairing_pending: false,
        last_error: None,
    }]);

    let app = app_with_state(state);
    let snapshot_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ens/snapshot")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let snapshot = response_json(snapshot_response).await;
    assert_eq!(snapshot["peers"][0]["endpoint"]["gateway"], "reticulum");
    assert_eq!(snapshot["peers"][0]["endpoint"]["via_interface"], "lan-udp");
    assert_eq!(snapshot["peers"][0]["endpoint"]["via_medium"], "udp");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/ens/pairing/discovered/identity-b")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let payload = response_json(response).await;
    assert_eq!(payload["status"], "pending");
    assert!(payload["pin"].as_str().unwrap().len() == 6);
    assert!(matches!(
        provider.sent_frames().first(),
        Some(EnsPairingFrame::PairingOffer(_))
    ));
}

#[tokio::test]
async fn ens_interface_topology_route_rejects_unknown_interface() {
    let (state, _provider) = state_with_ens_provider();
    let response = app_with_state(state)
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mesh/ens/interfaces/missing/topology")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"topology":"off"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let payload = response_json(response).await;
    assert!(
        payload["error"]
            .as_str()
            .unwrap()
            .contains("interface was not found")
    );
}
