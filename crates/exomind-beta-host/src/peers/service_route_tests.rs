use super::*;
use crate::peers::{PeerNetwork, PeerNetworkSettings};
use crate::{BetaHost, Session};
use exomind_core::{DeviceId, ProfileId};
use std::{net::SocketAddr, sync::Arc};
use tempfile::TempDir;
use uuid::Uuid;

fn address(value: &str) -> SocketAddr {
    value.parse().unwrap()
}

fn open_host() -> (TempDir, Arc<BetaHost>, Session) {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    host.save_peer_network_settings(
        &owner,
        PeerNetworkSettings {
            enabled: false,
            preferred_port: 0,
        },
    )
    .unwrap();
    (root, host, owner)
}

#[test]
fn service_headers_keep_v1_strict_and_negotiate_v2_only_on_v2_transport() {
    let device = DeviceId::new();
    let v1 = HeaderV1 {
        protocol: PROTOCOL_V1.into(),
        service: PeerServiceKind::Join,
        profile_id: None,
        device_id: device,
        target_device: None,
        listen_port: 43344,
    };
    let v1_bytes = serde_json::to_vec(&v1).unwrap();
    let decoded_v1 = decode_header(&v1_bytes, PeerServiceVersion::V2).unwrap();
    assert_eq!(decoded_v1.version, PeerServiceVersion::V1);
    assert!(decoded_v1.candidates.is_empty());

    let mut unknown_v1 = serde_json::to_value(&v1).unwrap();
    unknown_v1["unexpected"] = serde_json::json!(true);
    assert!(
        decode_header(
            &serde_json::to_vec(&unknown_v1).unwrap(),
            PeerServiceVersion::V2
        )
        .is_err()
    );

    let v2 = HeaderV2 {
        protocol: PROTOCOL_V2.into(),
        service: PeerServiceKind::Join,
        profile_id: None,
        device_id: device,
        target_device: None,
        listen_port: 43344,
        candidates: vec![address("10.1.2.3:43344"), address("[fd12:34::5]:43344")],
    };
    let v2_bytes = serde_json::to_vec(&v2).unwrap();
    assert!(decode_header(&v2_bytes, PeerServiceVersion::V1).is_err());
    assert_eq!(
        decode_header(&v2_bytes, PeerServiceVersion::V2)
            .unwrap()
            .candidates,
        v2.candidates
    );

    let mut unknown_v2 = serde_json::to_value(&v2).unwrap();
    unknown_v2["unexpected"] = serde_json::json!(true);
    assert!(
        decode_header(
            &serde_json::to_vec(&unknown_v2).unwrap(),
            PeerServiceVersion::V2
        )
        .is_err()
    );
}

#[test]
fn service_candidates_are_bounded_deduplicated_and_keep_native_ipv6() {
    let ipv4 = address("10.0.0.7:43344");
    let mapped = address("[::ffff:10.0.0.7]:43344");
    let ipv6 = address("[fd12:3456::7]:43344");
    assert_eq!(
        super::super::transport::validate_service_candidates(&[ipv4, mapped, ipv6]).unwrap(),
        vec![ipv4, ipv6]
    );
    for invalid in [
        address("0.0.0.0:43344"),
        address("10.0.0.7:0"),
        address("224.0.0.1:43344"),
        address("[fe80::1]:43344"),
    ] {
        assert!(super::super::transport::validate_service_candidates(&[invalid]).is_err());
    }
    let too_many = (1..=9)
        .map(|last| address(&format!("10.0.0.{last}:43344")))
        .collect::<Vec<_>>();
    assert!(super::super::transport::validate_service_candidates(&too_many).is_err());
}

#[test]
fn route_merge_keeps_recent_success_then_new_pinned_candidates_and_caps_the_tail() {
    let old = (1..=8)
        .map(|last| address(&format!("10.0.0.{last}:43344")))
        .collect::<Vec<_>>();
    let successful = address("10.1.0.1:43344");
    let fresh = address("10.1.0.2:43344");
    let merged = merge_route_endpoints(&old, &[fresh, old[2]], Some(successful)).unwrap();
    assert_eq!(merged.len(), 8);
    assert_eq!(merged[0], successful);
    assert_eq!(merged[1], fresh);
    assert_eq!(
        merged[2..],
        [old[0], old[1], old[2], old[3], old[4], old[5]]
    );
    assert_eq!(
        merged
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        merged.len()
    );

    let retained = merge_route_endpoints(&old, &[fresh], None).unwrap();
    assert_eq!(
        retained,
        [old[0], fresh, old[1], old[2], old[3], old[4], old[5], old[6]],
        "an inbound service preserves the preferred route and admits a fresh return address"
    );
}

#[test]
fn a_new_authenticated_inbound_candidate_survives_a_full_stale_route_cache() {
    let old = (1..=8)
        .map(|last| address(&format!("10.0.0.{last}:43344")))
        .collect::<Vec<_>>();
    let fresh = address("10.137.0.2:43344");
    let merged = merge_route_endpoints(&old, &[fresh], None).unwrap();
    assert_eq!(merged.len(), 8);
    assert_eq!(merged[0], old[0], "retain the prior preferred address");
    assert!(merged.contains(&fresh), "a full cache must not discard a newly authenticated return address");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn authenticated_route_write_rejects_wrong_pin_stale_generation_and_cancelled_scope() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_root_a, a, owner_a) = open_host();
    let (_root_b, b, owner_b) = open_host();
    let (_root_c, c, owner_c) = open_host();
    let profile = ProfileId::new();
    a.provision_profile(&owner_a, profile, "route admission fence")
        .unwrap();

    let network_a = PeerNetwork::new(a.clone(), owner_a.clone()).unwrap();
    let network_b = PeerNetwork::new(b.clone(), owner_b.clone()).unwrap();
    let invitation = network_a
        .create_invitation(profile)
        .await
        .unwrap()
        .invitation
        .unwrap();
    let join = network_b.join(&invitation, Uuid::new_v4()).await.unwrap();
    let peer = a.device_id;
    let member = b
        .peer_members(&owner_b, profile)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == peer)
        .unwrap();
    let peer_pin = PeerPin::from_sha256(&member.pin).unwrap();

    network_a.stop().await.unwrap();
    network_b.stop().await.unwrap();
    let candidate = address("127.0.0.77:43344");
    let successful = address("127.0.0.78:43344");
    let saved = b
        .save_authenticated_peer_routes(
            &owner_b,
            profile,
            peer,
            peer_pin,
            member.generation,
            &[candidate],
            Some(successful),
            None,
        )
        .unwrap();
    let after_valid = b.peer_routes(&owner_b).unwrap();
    let route = after_valid
        .iter()
        .find(|route| route.profile == profile && route.device == peer)
        .unwrap();
    let valid_order = route.endpoints.starts_with(&[successful, candidate]);
    let generation_after_valid = b
        .peer_members(&owner_b, profile)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == peer)
        .unwrap()
        .generation;

    let wrong_pin =
        PeerPin::from_sha256(&c.device_identity(&owner_c).unwrap().fingerprint_sha256).unwrap();
    let wrong_pin_saved = b
        .save_authenticated_peer_routes(
            &owner_b,
            profile,
            peer,
            wrong_pin,
            member.generation,
            &[address("127.0.0.79:43344")],
            None,
            None,
        )
        .unwrap();
    let stale_generation_saved = b
        .save_authenticated_peer_routes(
            &owner_b,
            profile,
            peer,
            peer_pin,
            member.generation.saturating_add(1),
            &[address("127.0.0.80:43344")],
            None,
            None,
        )
        .unwrap();
    let cancelled = PeerCancellation::new();
    cancelled.cancel();
    let cancelled_saved = b
        .save_authenticated_peer_routes(
            &owner_b,
            profile,
            peer,
            peer_pin,
            member.generation,
            &[address("127.0.0.81:43344")],
            None,
            Some(&cancelled),
        )
        .unwrap();
    let unchanged_after_rejections = b.peer_routes(&owner_b).unwrap() == after_valid;

    b.revoke_peer_member(&owner_b, profile, peer, member.generation)
        .unwrap();
    let revoked_saved = b
        .save_authenticated_peer_routes(
            &owner_b,
            profile,
            peer,
            peer_pin,
            member.generation,
            &[address("127.0.0.82:43344")],
            None,
            None,
        )
        .unwrap();
    let unchanged_after_revoke = b.peer_routes(&owner_b).unwrap() == after_valid;

    drop((network_a, network_b));
    tokio::task::spawn_blocking(move || a.stop())
        .await
        .unwrap()
        .unwrap();
    tokio::task::spawn_blocking(move || b.stop())
        .await
        .unwrap()
        .unwrap();
    tokio::task::spawn_blocking(move || c.stop())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(join.state, PeerJoinState::Ready);
    assert!(saved);
    assert!(valid_order);
    assert_eq!(generation_after_valid, member.generation);
    assert!(!wrong_pin_saved);
    assert!(!stale_generation_saved);
    assert!(!cancelled_saved);
    assert!(unchanged_after_rejections);
    assert!(!revoked_saved);
    assert!(unchanged_after_revoke);
}
