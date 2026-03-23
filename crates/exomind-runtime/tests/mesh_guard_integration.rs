use exomind_runtime::mesh::{MAX_HOP, MeshState, PeerInfo, PeerStatus};
use exomind_runtime::signal::{SignalEvent, SignalPool};
use serde_json::json;
use std::sync::Arc;

fn peer(id: &str, base_url: &str) -> PeerInfo {
    PeerInfo {
        id: id.to_string(),
        base_url: base_url.to_string(),
        enabled: true,
        capabilities: vec!["relay".to_string()],
        status: PeerStatus::Unknown,
        last_seen: None,
        last_error: None,
        created_at: "2026-03-06T00:00:00Z".to_string(),
        updated_at: "2026-03-06T00:00:00Z".to_string(),
        auth_token: None,
        inbound_secret: None,
    }
}

fn event(id: &str, origin_host_id: &str, hop: u8) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: id.to_string(),
        topic: "mesh.test".to_string(),
        ts: 1,
        source: "mesh-test".to_string(),
        origin_host_id: origin_host_id.to_string(),
        hop,
        trace_id: None,
        payload: json!({ "value": 1 }),
    }
}

#[tokio::test]
async fn mesh_state_dedupes_same_remote_event_id() {
    let pool = Arc::new(SignalPool::new(None));
    let mesh = MeshState::new("rt-b".to_string(), Arc::clone(&pool), None);
    mesh.upsert_peer(peer("rt-a", "http://127.0.0.1:3001"));

    assert!(
        mesh.ingest_remote_event("rt-a", event("evt-1", "rt-a", 0))
            .await
            .expect("first ingest should succeed")
    );
    assert!(
        !mesh
            .ingest_remote_event("rt-a", event("evt-1", "rt-a", 0))
            .await
            .expect("duplicate ingest should be skipped")
    );
}

#[tokio::test]
async fn mesh_state_skips_events_beyond_hop_limit() {
    let pool = Arc::new(SignalPool::new(None));
    let mesh = MeshState::new("rt-b".to_string(), Arc::clone(&pool), None);
    mesh.upsert_peer(peer("rt-a", "http://127.0.0.1:3001"));

    assert!(
        !mesh
            .ingest_remote_event("rt-a", event("evt-hop", "rt-a", MAX_HOP))
            .await
            .expect("hop limited event should be skipped")
    );
}
