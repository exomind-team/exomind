use super::*;
use crate::{PeerCancellation, PeerTransportListener, PeerTransportOptions};
use exomind_core::ProfileId;
use std::{net::SocketAddr, time::Duration};
use tempfile::{TempDir, tempdir};

fn host_at(root: &TempDir) -> (Arc<BetaHost>, Session) {
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    (host, owner)
}
fn options() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(3),
        channel_lifetime: Duration::from_secs(30),
    }
}
async fn listener(host: &Arc<BetaHost>, owner: &Session) -> PeerTransportListener {
    host.listen_peer_transport(owner, "127.0.0.1:0".parse().unwrap(), options())
        .await
        .unwrap()
}
async fn channels(
    a: &Arc<BetaHost>,
    owner_a: &Session,
    b: &Arc<BetaHost>,
    owner_b: &Session,
    listener: &mut PeerTransportListener,
) -> (PeerChannel, PeerChannel) {
    let pin =
        PeerPin::from_sha256(&b.device_identity(owner_b).unwrap().fingerprint_sha256).unwrap();
    let client = a
        .connect_peer_transport(
            owner_a,
            listener.addr(),
            pin,
            options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let server = listener.accept(PeerCancellation::new()).await.unwrap();
    (client, server)
}
fn invitation(a: &BetaHost, owner: &Session, p: ProfileId, address: SocketAddr) -> PeerInvitation {
    a.create_peer_invitation(
        owner,
        &CreatePeerInvitation {
            invitation_id: Uuid::new_v4(),
            profile_id: p,
            capabilities: PeerCapabilities::FULL,
            candidates: vec![address],
            ttl_seconds: 120,
        },
    )
    .unwrap()
    .invitation
    .unwrap()
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
fn assert_ready(a: &BetaHost, owner_a: &Session, b: &BetaHost, owner_b: &Session, p: ProfileId) {
    let remote = b.status().unwrap().device_id;
    let members = a.peer_members(owner_a, p).unwrap();
    let member = members
        .iter()
        .find(|member| member.device_id == remote)
        .unwrap();
    assert_eq!(member.state, PeerJoinState::Ready);
    assert!(!member.revoked);
    assert_eq!(member.capabilities, PeerCapabilities::FULL);
    assert_eq!(
        member.pin,
        b.device_identity(owner_b).unwrap().fingerprint_sha256
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_pairing_is_idempotent_and_preserves_homonymous_profile() {
    let root_a = tempdir().unwrap();
    let root_b = tempdir().unwrap();
    let (a, owner_a) = host_at(&root_a);
    let (b, owner_b) = host_at(&root_b);
    let p = ProfileId::new();
    let q = ProfileId::new();
    a.provision_profile(&owner_a, p, "Same display name")
        .unwrap();
    b.provision_profile(&owner_b, q, "Same display name")
        .unwrap();
    let q_before = serde_json::to_value(&b.profiles(&owner_b).unwrap()[0]).unwrap();
    let mut listener = listener(&a, &owner_a).await;
    let invitation = invitation(&a, &owner_a, p, listener.addr());
    let claim_id = Uuid::new_v4();
    for _ in 0..2 {
        let (client, server) = channels(&b, &owner_b, &a, &owner_a, &mut listener).await;
        let issuer = a.clone();
        let serving =
            tokio::spawn(async move { issuer.accept_peer_join_over_transport(server).await });
        let status = b
            .join_peer_profile_over_transport(&owner_b, &invitation, claim_id, client)
            .await
            .unwrap();
        assert_eq!(status.state, PeerJoinState::Ready);
        assert!(status.remote_ready_observed);
        serving.await.unwrap().unwrap();
        let issuer_status = a.peer_join_status(&owner_a, claim_id).unwrap();
        assert_eq!(issuer_status.state, PeerJoinState::Ready);
        assert!(issuer_status.remote_ready_observed);
        assert_ready(&a, &owner_a, &b, &owner_b, p);
        assert_ready(&b, &owner_b, &a, &owner_a, p);
    }
    let profiles = serde_json::to_value(b.profiles(&owner_b).unwrap()).unwrap();
    assert_eq!(profiles.as_array().unwrap().len(), 2);
    assert!(profiles.as_array().unwrap().contains(&q_before));
    drop(listener);
    stop(a).await;
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_claim_ready_and_final_ack_loss_recover_after_both_hosts_restart() {
    for fault in ["claim_reply", "ready_reply", "finished_ack"] {
        let root_a = tempdir().unwrap();
        let root_b = tempdir().unwrap();
        let (a, owner_a) = host_at(&root_a);
        let (b, owner_b) = host_at(&root_b);
        let p = ProfileId::new();
        a.provision_profile(&owner_a, p, "Restart recovery")
            .unwrap();
        let mut listening = listener(&a, &owner_a).await;
        let invitation = invitation(&a, &owner_a, p, listening.addr());
        let claim_id = Uuid::new_v4();
        let claim = b
            .prepare_peer_join(&owner_b, &invitation, claim_id)
            .unwrap();
        let (client, server) = channels(&b, &owner_b, &a, &owner_a, &mut listening).await;
        let issuer = a.clone();
        let serving =
            tokio::spawn(async move { issuer.accept_peer_join_over_transport(server).await });
        send(&client, &Request::Claim { claim }).await.unwrap();
        let receipt = match read(&client).await.unwrap() {
            Response::Claimed { receipt } => receipt,
            _ => panic!("expected fixed claim receipt"),
        };
        if fault != "claim_reply" {
            let confirmation = b.accept_peer_claim_verified(&client, &receipt).unwrap();
            send(&client, &Request::Confirm { confirmation })
                .await
                .unwrap();
            // The issuer has durably reached ready, but its last response is
            // either not applied, or the final observation acknowledgement is
            // lost after the joiner durably applies it.
            let ready = match read::<Response>(&client).await.unwrap() {
                Response::Ready { receipt } => receipt,
                _ => panic!("expected fixed ready receipt"),
            };
            if fault == "finished_ack" {
                assert_eq!(
                    b.finish_peer_join_verified(&client, &ready).unwrap().state,
                    PeerJoinState::Ready
                );
            }
            drop(client);
            assert!(serving.await.unwrap().is_err());
            assert_eq!(
                b.peer_join_status(&owner_b, claim_id).unwrap().state,
                if fault == "finished_ack" {
                    PeerJoinState::Ready
                } else {
                    PeerJoinState::Accepted
                }
            );
            let issuer_status = a.peer_join_status(&owner_a, claim_id).unwrap();
            assert_ne!(issuer_status.state, PeerJoinState::Ready);
            assert!(!issuer_status.remote_ready_observed);
        } else {
            drop(client);
            assert!(serving.await.unwrap().is_err());
            assert_eq!(
                b.peer_join_status(&owner_b, claim_id).unwrap().state,
                PeerJoinState::Pending
            );
        }
        drop(listening);
        // client is moved only in the branch above; all retained channels are
        // cancelled and drained by each Host's owned transport registry.
        stop(a).await;
        stop(b).await;
        let (a, owner_a) = host_at(&root_a);
        let (b, owner_b) = host_at(&root_b);
        let mut listening = listener(&a, &owner_a).await;
        let (client, server) = channels(&b, &owner_b, &a, &owner_a, &mut listening).await;
        let issuer = a.clone();
        let serving =
            tokio::spawn(async move { issuer.accept_peer_join_over_transport(server).await });
        assert_eq!(
            b.join_peer_profile_over_transport(&owner_b, &invitation, claim_id, client)
                .await
                .unwrap()
                .state,
            PeerJoinState::Ready
        );
        serving.await.unwrap().unwrap();
        assert_ready(&a, &owner_a, &b, &owner_b, p);
        assert_ready(&b, &owner_b, &a, &owner_a, p);
        drop(listening);
        stop(a).await;
        stop(b).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invitation_secret_is_not_sent_to_a_different_valid_tls_peer() {
    let root_a = tempdir().unwrap();
    let root_b = tempdir().unwrap();
    let root_c = tempdir().unwrap();
    let (a, owner_a) = host_at(&root_a);
    let (b, owner_b) = host_at(&root_b);
    let (c, owner_c) = host_at(&root_c);
    let p = ProfileId::new();
    a.provision_profile(&owner_a, p, "Pinned issuer").unwrap();
    let mut listening = listener(&c, &owner_c).await;
    let invitation = invitation(&a, &owner_a, p, listening.addr());
    let claim_id = Uuid::new_v4();
    let (client, server) = channels(&b, &owner_b, &c, &owner_c, &mut listening).await;
    assert!(matches!(
        b.join_peer_profile_over_transport(&owner_b, &invitation, claim_id, client)
            .await,
        Err(HostError::PeerPinMismatch)
    ));
    // A real unrelated authenticated endpoint observes EOF, not a claim body.
    assert!(server.read_frame().await.is_err());
    assert!(b.peer_join_status(&owner_b, claim_id).is_err());
    drop(server);
    drop(listening);
    stop(a).await;
    stop(b).await;
    stop(c).await;
}
