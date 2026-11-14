use super::*;
use crate::{
    GrantKind, GrantRequest, HostClock, HostClockSample, PeerCancellation, PeerTransportOptions,
};
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use tempfile::{TempDir, tempdir};

fn host() -> (TempDir, Arc<BetaHost>, Session) {
    let root = tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    (root, host, owner)
}
fn request(profile: ProfileId) -> CreatePeerInvitation {
    CreatePeerInvitation {
        invitation_id: Uuid::new_v4(),
        profile_id: profile,
        capabilities: PeerCapabilities::FULL,
        candidates: vec!["127.0.0.1:5589".parse().unwrap()],
        ttl_seconds: 60,
    }
}
fn issue(host: &BetaHost, owner: &Session) -> PeerInvitation {
    let p = ProfileId::new();
    host.provision_profile(owner, p, "same name").unwrap();
    host.create_peer_invitation(owner, &request(p))
        .unwrap()
        .invitation
        .unwrap()
}
async fn channels(
    a: &Arc<BetaHost>,
    oa: &Session,
    b: &Arc<BetaHost>,
    ob: &Session,
) -> (
    super::super::PeerTransportListener,
    PeerChannel,
    PeerChannel,
) {
    let pin = PeerPin::from_sha256(&a.device_identity(oa).unwrap().fingerprint_sha256).unwrap();
    let mut listener = a
        .listen_peer_transport(
            oa,
            "127.0.0.1:0".parse().unwrap(),
            PeerTransportOptions::default(),
        )
        .await
        .unwrap();
    let outgoing = b
        .connect_peer_transport(
            ob,
            listener.addr(),
            pin,
            PeerTransportOptions::default(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let incoming = listener.accept(PeerCancellation::new()).await.unwrap();
    (listener, incoming, outgoing)
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}

#[test]
fn peer_membership_owner_scope_invitation_idempotency_and_secret_privacy() {
    let (_root, host, owner) = host();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "P").unwrap();
    let request = request(p);
    let first = host.create_peer_invitation(&owner, &request).unwrap();
    let invitation = first.invitation.unwrap();
    assert_eq!(first.status.state, PeerInvitationState::Open);
    let retry = host.create_peer_invitation(&owner, &request).unwrap();
    assert!(retry.invitation.is_none());
    assert_eq!(retry.status.offer, invitation.offer);
    let mut changed = request.clone();
    changed.capabilities.append_facts = false;
    assert!(matches!(
        host.create_peer_invitation(&owner, &changed),
        Err(HostError::PeerMembershipConflict)
    ));
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let human = host.authenticate(&grant.token).unwrap();
    assert!(matches!(
        host.create_peer_invitation(&human, &request),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.peer_members(&human, p),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.revoke_peer_member(&owner, p, host.device_id, 1),
        Err(HostError::InvalidRequest)
    ));
    assert!(
        serde_json::from_str::<PeerCapabilities>(
            r#"{"read_timeline":true,"append_facts":true,"read_originals":true,"admin":true}"#
        )
        .is_err()
    );
    let state = host.state().unwrap();
    let auth = &crate::resources(&state).unwrap().persistence.auth;
    let body: String = auth
        .query_row("SELECT body FROM peer_invitations", [], |r| r.get(0))
        .unwrap();
    assert!(!body.contains(&invitation.secret));
    assert!(
        !serde_json::to_string(&first.status)
            .unwrap()
            .contains(&invitation.secret)
    );
    drop(state);
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_membership_real_tls_claim_atomicity_fixed_ids_and_issuer_revocation() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let invitation = issue(&a, &oa);
    let p = invitation.offer.profile_id;
    let q = ProfileId::new();
    b.provision_profile(&ob, q, "same name").unwrap();
    let q_invitation = b
        .create_peer_invitation(&ob, &request(q))
        .unwrap()
        .invitation
        .unwrap();
    let claim_id = Uuid::new_v4();
    let claim = b.prepare_peer_join(&ob, &invitation, claim_id).unwrap();
    assert_eq!(
        b.peer_join_status(&ob, claim_id).unwrap().state,
        PeerJoinState::Pending
    );
    let (_listener, incoming, outgoing) = channels(&a, &oa, &b, &ob).await;
    {
        let state = a.state().unwrap();
        crate::resources(&state).unwrap().persistence.auth.execute_batch("CREATE TRIGGER refuse_claim BEFORE INSERT ON peer_claims BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    }
    assert!(matches!(
        a.claim_peer_invitation_verified(&incoming, &claim),
        Err(HostError::PeerMembershipUnavailable)
    ));
    assert!(
        !a.peer_members(&oa, p)
            .unwrap()
            .iter()
            .any(|m| m.device_id == b.device_id)
    );
    assert_eq!(
        a.peer_invitation_status(&oa, invitation.offer.invitation_id)
            .unwrap()
            .state,
        PeerInvitationState::Open
    );
    {
        let state = a.state().unwrap();
        crate::resources(&state)
            .unwrap()
            .persistence
            .auth
            .execute_batch("DROP TRIGGER refuse_claim")
            .unwrap();
    }
    let receipt = a.claim_peer_invitation_verified(&incoming, &claim).unwrap();
    assert_eq!(
        a.claim_peer_invitation_verified(&incoming, &claim).unwrap(),
        receipt
    );
    let mut changed = claim.clone();
    changed.invitation_digest = "00".repeat(32);
    assert!(matches!(
        a.claim_peer_invitation_verified(&incoming, &changed),
        Err(HostError::PeerMembershipConflict)
    ));
    let mut another = claim.clone();
    another.claim_id = Uuid::new_v4();
    assert!(matches!(
        a.claim_peer_invitation_verified(&incoming, &another),
        Err(HostError::PeerInvitationConsumed)
    ));
    let confirmation = b.accept_peer_claim_verified(&outgoing, &receipt).unwrap();
    let ready = a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    assert_eq!(
        a.peer_join_status(&oa, claim_id).unwrap().state,
        PeerJoinState::Claimed
    );
    assert!(
        !a.peer_join_status(&oa, claim_id)
            .unwrap()
            .remote_ready_observed
    );
    assert_eq!(
        b.finish_peer_join_verified(&outgoing, &ready)
            .unwrap()
            .state,
        PeerJoinState::Ready
    );
    a.acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    assert_eq!(
        a.peer_join_status(&oa, claim_id).unwrap().state,
        PeerJoinState::Ready
    );
    let issuer = b
        .peer_members(&ob, p)
        .unwrap()
        .into_iter()
        .find(|m| m.device_id == a.device_id)
        .unwrap();
    b.revoke_peer_member(&ob, p, a.device_id, issuer.generation)
        .unwrap();
    assert_eq!(
        b.peer_join_status(&ob, claim_id).unwrap().state,
        PeerJoinState::Revoked
    );
    assert!(matches!(
        b.prepare_peer_join(&ob, &invitation, claim_id),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        b.accept_peer_claim_verified(&outgoing, &receipt),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        b.finish_peer_join_verified(&outgoing, &ready),
        Err(HostError::PeerMembershipDenied)
    ));
    assert_eq!(
        b.peer_invitation_status(&ob, q_invitation.offer.invitation_id)
            .unwrap()
            .state,
        PeerInvitationState::Open
    );
    assert!(b.peer_members(&ob, q).unwrap().iter().all(|m| !m.revoked));
    stop(a).await;
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_membership_revoked_invitation_blocks_pending_confirmation_and_old_channel() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let invitation = issue(&a, &oa);
    let claim_id = Uuid::new_v4();
    let claim = b.prepare_peer_join(&ob, &invitation, claim_id).unwrap();
    let (_listener, incoming, outgoing) = channels(&a, &oa, &b, &ob).await;
    let receipt = a.claim_peer_invitation_verified(&incoming, &claim).unwrap();
    let confirmation = b.accept_peer_claim_verified(&outgoing, &receipt).unwrap();
    a.revoke_peer_invitation(&oa, invitation.offer.invitation_id)
        .unwrap();
    a.revoke_peer_invitation(&oa, invitation.offer.invitation_id)
        .unwrap();
    assert!(matches!(
        a.confirm_peer_join_verified(&incoming, &confirmation),
        Err(HostError::PeerMembershipDenied) | Err(HostError::PeerInvitationRevoked)
    ));
    assert_eq!(
        a.peer_join_status(&oa, claim_id).unwrap().state,
        PeerJoinState::Revoked
    );
    assert_eq!(
        b.peer_join_status(&ob, claim_id).unwrap().state,
        PeerJoinState::Accepted
    );
    a.request_stop();
    assert!(matches!(
        a.claim_peer_invitation_verified(&incoming, &claim),
        Err(HostError::Stopped)
    ));
    stop(a).await;
    stop(b).await;
}

#[test]
fn peer_membership_auth_upgrade_preserves_owner_grants_and_missing_tables_fail_closed() {
    let (root, host, owner) = host();
    let invitation = issue(&host, &owner);
    let p = invitation.offer.profile_id;
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let device = host.device_id;
    host.stop().unwrap();
    let path = root.path().join("host-auth.sqlite3");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE peer_membership_layout;DROP TABLE peer_members;DROP TABLE peer_invitations;DROP TABLE peer_claims;DROP TABLE peer_pending;PRAGMA user_version=1").unwrap();
    drop(db);
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(reopened.device_id, device);
    assert!(reopened.authenticate(&grant.token).is_ok());
    assert!(
        reopened
            .peer_members(&reopened.owner_session().unwrap(), p)
            .unwrap()
            .is_empty()
    );
    reopened.stop().unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE peer_claims").unwrap();
    drop(db);
    assert!(matches!(
        BetaHost::open(root.path()),
        Err(HostError::PeerMembershipRecoveryRequired)
    ));
    let db = rusqlite::Connection::open(&path).unwrap();
    let absent: bool = db
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name='peer_claims')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(absent);
}

struct Clock {
    wall: AtomicI64,
    host: std::sync::Mutex<std::sync::Weak<BetaHost>>,
}
impl HostClock for Clock {
    fn sample(&self) -> HostClockSample {
        if let Some(host) = self.host.lock().unwrap().upgrade() {
            // Verify the decision boundary even without a competing holder.
            // A started-worker signal alone cannot prove an old gate-external
            // sample happened before the test advanced its wall clock.
            assert!(matches!(
                host.gate.try_lock(),
                Err(std::sync::TryLockError::WouldBlock)
            ));
        }
        HostClockSample {
            epoch_id: Uuid::nil(),
            wall_ms: self.wall.load(Ordering::SeqCst),
            elapsed_ms: 0,
        }
    }
}
#[test]
fn peer_membership_expiry_samples_after_gate_wait_and_never_revives_on_rollback() {
    let root = tempdir().unwrap();
    let clock = Arc::new(Clock {
        wall: AtomicI64::new(1000),
        host: std::sync::Mutex::new(std::sync::Weak::new()),
    });
    let host = Arc::new(BetaHost::open_with_clock(root.path(), clock.clone()).unwrap());
    *clock.host.lock().unwrap() = Arc::downgrade(&host);
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "P").unwrap();
    let mut request = request(p);
    request.ttl_seconds = 1;
    let invitation = host
        .create_peer_invitation(&owner, &request)
        .unwrap()
        .invitation
        .unwrap();
    let guard = host.state().unwrap();
    let (started, ready) = std::sync::mpsc::channel();
    let worker = {
        let host = host.clone();
        let owner = owner.clone();
        std::thread::spawn(move || {
            started.send(()).unwrap();
            host.peer_invitation_status(&owner, request.invitation_id)
        })
    };
    ready
        .recv_timeout(std::time::Duration::from_secs(1))
        .unwrap();
    // The worker is held at the actual qualification gate. No long TTL/sleep
    // is needed: trusted time advances before the final decision can enter.
    clock.wall.store(5000, Ordering::SeqCst);
    drop(guard);
    assert_eq!(
        worker.join().unwrap().unwrap().state,
        PeerInvitationState::Expired
    );
    clock.wall.store(1000, Ordering::SeqCst);
    assert_eq!(
        host.peer_invitation_status(&owner, invitation.offer.invitation_id)
            .unwrap()
            .state,
        PeerInvitationState::Expired
    );
    host.stop().unwrap();
}
