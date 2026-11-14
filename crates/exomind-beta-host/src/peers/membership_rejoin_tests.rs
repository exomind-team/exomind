use super::*;
use crate::PeerTransportListener;
use exomind_core::{CaptureCommand, CommandId, EventId, EventQuery};

struct Pair {
    a_root: TempDir,
    b_root: TempDir,
    a: Arc<BetaHost>,
    b: Arc<BetaHost>,
    oa: Session,
    ob: Session,
    listener: PeerTransportListener,
    profile: ProfileId,
    old_id: Uuid,
    old_claim: PeerJoinClaim,
    old_receipt: PeerClaimReceipt,
    old_confirmation: PeerJoinConfirmation,
    old_ready: PeerReadyReceipt,
}
impl Pair {
    async fn new() -> Self {
        let (a_root, a, oa) = host();
        let (b_root, b, ob) = host();
        let invitation = issue(&a, &oa);
        let profile = invitation.offer.profile_id;
        let old_id = Uuid::new_v4();
        let old_claim = b.prepare_peer_join(&ob, &invitation, old_id).unwrap();
        let (listener, incoming, outgoing) = channels(&a, &oa, &b, &ob).await;
        let old_receipt = a
            .claim_peer_invitation_verified(&incoming, &old_claim)
            .unwrap();
        let old_confirmation = b
            .accept_peer_claim_verified(&outgoing, &old_receipt)
            .unwrap();
        let old_ready = a
            .confirm_peer_join_verified(&incoming, &old_confirmation)
            .unwrap();
        b.finish_peer_join_verified(&outgoing, &old_ready).unwrap();
        a.acknowledge_peer_ready_verified(&incoming, &old_ready.acknowledgement().unwrap())
            .unwrap();
        drop(incoming);
        drop(outgoing);
        Self {
            a_root,
            b_root,
            a,
            b,
            oa,
            ob,
            listener,
            profile,
            old_id,
            old_claim,
            old_receipt,
            old_confirmation,
            old_ready,
        }
    }
    async fn connection(&mut self) -> (PeerChannel, PeerChannel) {
        let pin =
            PeerPin::from_sha256(&self.a.device_identity(&self.oa).unwrap().fingerprint_sha256)
                .unwrap();
        let outgoing = self
            .b
            .connect_peer_transport(
                &self.ob,
                self.listener.addr(),
                pin,
                PeerTransportOptions::default(),
                PeerCancellation::new(),
            )
            .await
            .unwrap();
        let incoming = self.listener.accept(PeerCancellation::new()).await.unwrap();
        (incoming, outgoing)
    }
    fn member(
        host: &BetaHost,
        owner: &Session,
        profile: ProfileId,
        device: exomind_core::DeviceId,
    ) -> PeerMember {
        host.peer_members(owner, profile)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == device)
            .unwrap()
    }
    fn invite(&self) -> PeerInvitation {
        self.a
            .create_peer_invitation(&self.oa, &request(self.profile))
            .unwrap()
            .invitation
            .unwrap()
    }
    fn approve(
        &self,
        invitation: &PeerInvitation,
        id: Uuid,
        previous: Uuid,
    ) -> (ApprovePeerInvitationReplacement, PeerRejoinExpectation) {
        let request = ApprovePeerInvitationReplacement {
            invitation_id: invitation.offer.invitation_id,
            claim_id: id,
            device_id: self.b.device_id,
            previous_claim_id: previous,
            expected_generation: Self::member(&self.a, &self.oa, self.profile, self.b.device_id)
                .generation,
        };
        let expectation = PeerRejoinExpectation {
            previous_claim_id: previous,
            expected_local_generation: Self::member(
                &self.b,
                &self.ob,
                self.profile,
                self.b.device_id,
            )
            .generation,
            expected_issuer_generation: Self::member(
                &self.b,
                &self.ob,
                self.profile,
                self.a.device_id,
            )
            .generation,
        };
        self.a
            .approve_peer_invitation_replacement(&self.oa, &request)
            .unwrap();
        self.b
            .prepare_peer_rejoin(&self.ob, invitation, id, &expectation)
            .unwrap();
        (request, expectation)
    }
    async fn restart(&mut self) {
        stop(self.a.clone()).await;
        stop(self.b.clone()).await;
        self.a = Arc::new(BetaHost::open(self.a_root.path()).unwrap());
        self.b = Arc::new(BetaHost::open(self.b_root.path()).unwrap());
        self.oa = self.a.owner_session().unwrap();
        self.ob = self.b.owner_session().unwrap();
        self.listener = self
            .a
            .listen_peer_transport(
                &self.oa,
                "127.0.0.1:0".parse().unwrap(),
                PeerTransportOptions::default(),
            )
            .await
            .unwrap();
    }
    async fn close(self) {
        stop(self.a).await;
        stop(self.b).await;
    }
}
fn capture(host: &BetaHost, owner: &Session, profile: ProfileId) -> (Session, CommandId) {
    let writer = host.native_human_session(owner, profile).unwrap();
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1794680000000,
        text: "synthetic retained fact".into(),
        tags: vec![],
        originals: vec![],
    };
    host.capture(&writer, &command).unwrap();
    (writer, command.command_id)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_requires_both_owners_and_keeps_independent_generations_and_facts() {
    let mut pair = Pair::new().await;
    let (writer, command) = capture(&pair.b, &pair.ob, pair.profile);
    let before =
        serde_json::to_value(pair.b.receipt(&writer, pair.profile, command).unwrap()).unwrap();
    let member = Pair::member(&pair.a, &pair.oa, pair.profile, pair.b.device_id);
    pair.a
        .revoke_peer_member(&pair.oa, pair.profile, pair.b.device_id, member.generation)
        .unwrap();
    let invitation = pair.invite();
    let id = Uuid::new_v4();
    assert!(matches!(
        pair.b.prepare_peer_join(&pair.ob, &invitation, id),
        Err(HostError::PeerMembershipConflict)
    ));
    let (approval, expectation) = pair.approve(&invitation, id, pair.old_id);
    let a_generation = Pair::member(&pair.a, &pair.oa, pair.profile, pair.b.device_id).generation;
    let b_generation = Pair::member(&pair.b, &pair.ob, pair.profile, pair.b.device_id).generation;
    assert_eq!(a_generation, 3);
    assert_eq!(b_generation, 2);
    pair.a
        .approve_peer_invitation_replacement(&pair.oa, &approval)
        .unwrap();
    pair.b
        .prepare_peer_rejoin(&pair.ob, &invitation, id, &expectation)
        .unwrap();
    assert_eq!(
        Pair::member(&pair.a, &pair.oa, pair.profile, pair.b.device_id).generation,
        a_generation
    );
    assert_eq!(
        Pair::member(&pair.b, &pair.ob, pair.profile, pair.b.device_id).generation,
        b_generation
    );
    let mut changed = expectation.clone();
    changed.expected_local_generation += 1;
    assert!(matches!(
        pair.b
            .prepare_peer_rejoin(&pair.ob, &invitation, id, &changed),
        Err(HostError::PeerMembershipConflict)
    ));
    let (incoming, outgoing) = pair.connection().await;
    assert!(matches!(
        pair.a
            .claim_peer_invitation_verified(&incoming, &pair.old_claim),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        pair.a
            .confirm_peer_join_verified(&incoming, &pair.old_confirmation),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        pair.b
            .accept_peer_claim_verified(&outgoing, &pair.old_receipt),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        pair.b.finish_peer_join_verified(&outgoing, &pair.old_ready),
        Err(HostError::PeerMembershipDenied)
    ));
    let claim = pair.b.prepare_peer_join(&pair.ob, &invitation, id).unwrap();
    let receipt = pair
        .a
        .claim_peer_invitation_verified(&incoming, &claim)
        .unwrap();
    assert_eq!(receipt.evidence.generation, a_generation);
    let confirmation = pair
        .b
        .accept_peer_claim_verified(&outgoing, &receipt)
        .unwrap();
    let ready = pair
        .a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    pair.b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    pair.a
        .acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    assert_eq!(
        pair.a.peer_join_status(&pair.oa, id).unwrap().state,
        PeerJoinState::Ready
    );
    assert_eq!(
        pair.b.peer_join_status(&pair.ob, id).unwrap().state,
        PeerJoinState::Ready
    );
    assert_eq!(
        pair.a
            .peer_join_status(&pair.oa, pair.old_id)
            .unwrap()
            .state,
        PeerJoinState::Revoked
    );
    assert_eq!(
        pair.b
            .peer_join_status(&pair.ob, pair.old_id)
            .unwrap()
            .state,
        PeerJoinState::Revoked
    );
    assert_eq!(
        serde_json::to_value(pair.b.receipt(&writer, pair.profile, command).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        pair.b
            .events_page(&writer, pair.profile, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(
        Pair::member(&pair.b, &pair.ob, pair.profile, pair.b.device_id).generation,
        b_generation
    );
    drop(incoming);
    drop(outgoing);
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_joiner_revocation_cannot_replace_healthy_issuer_without_owner() {
    let mut pair = Pair::new().await;
    let member = Pair::member(&pair.b, &pair.ob, pair.profile, pair.a.device_id);
    pair.b
        .revoke_peer_member(&pair.ob, pair.profile, pair.a.device_id, member.generation)
        .unwrap();
    let invitation = pair.invite();
    let id = Uuid::new_v4();
    let expectation = PeerRejoinExpectation {
        previous_claim_id: pair.old_id,
        expected_local_generation: 1,
        expected_issuer_generation: 2,
    };
    let claim = pair
        .b
        .prepare_peer_rejoin(&pair.ob, &invitation, id, &expectation)
        .unwrap();
    let (incoming, outgoing) = pair.connection().await;
    assert!(matches!(
        pair.a.claim_peer_invitation_verified(&incoming, &claim),
        Err(HostError::PeerMembershipConflict)
    ));
    let approval = ApprovePeerInvitationReplacement {
        invitation_id: invitation.offer.invitation_id,
        claim_id: id,
        device_id: pair.b.device_id,
        previous_claim_id: pair.old_id,
        expected_generation: 1,
    };
    pair.a
        .approve_peer_invitation_replacement(&pair.oa, &approval)
        .unwrap();
    let receipt = pair
        .a
        .claim_peer_invitation_verified(&incoming, &claim)
        .unwrap();
    let confirmation = pair
        .b
        .accept_peer_claim_verified(&outgoing, &receipt)
        .unwrap();
    let ready = pair
        .a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    pair.b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    pair.a
        .acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    assert_eq!(receipt.evidence.generation, 2);
    assert_eq!(
        Pair::member(&pair.b, &pair.ob, pair.profile, pair.a.device_id).generation,
        3
    );
    drop(incoming);
    drop(outgoing);
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_restarts_at_approval_claim_accepted_ready_and_finished_keep_fixed_proofs() {
    let mut pair = Pair::new().await;
    let invitation = pair.invite();
    let id = Uuid::new_v4();
    let (approval, expectation) = pair.approve(&invitation, id, pair.old_id);
    pair.restart().await;
    pair.a
        .approve_peer_invitation_replacement(&pair.oa, &approval)
        .unwrap();
    pair.b
        .prepare_peer_rejoin(&pair.ob, &invitation, id, &expectation)
        .unwrap();
    let (incoming, outgoing) = pair.connection().await;
    let claim = pair.b.prepare_peer_join(&pair.ob, &invitation, id).unwrap();
    let receipt = pair
        .a
        .claim_peer_invitation_verified(&incoming, &claim)
        .unwrap();
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    let (incoming, outgoing) = pair.connection().await;
    assert_eq!(
        pair.a
            .claim_peer_invitation_verified(&incoming, &claim)
            .unwrap(),
        receipt
    );
    let confirmation = pair
        .b
        .accept_peer_claim_verified(&outgoing, &receipt)
        .unwrap();
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    let (incoming, outgoing) = pair.connection().await;
    assert_eq!(
        pair.b
            .accept_peer_claim_verified(&outgoing, &receipt)
            .unwrap(),
        confirmation
    );
    let ready = pair
        .a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    let (incoming, outgoing) = pair.connection().await;
    assert_eq!(
        pair.a
            .confirm_peer_join_verified(&incoming, &confirmation)
            .unwrap(),
        ready
    );
    pair.b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    let (incoming, outgoing) = pair.connection().await;
    pair.b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    pair.a
        .acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    assert_eq!(
        pair.a.peer_join_status(&pair.oa, id).unwrap().state,
        PeerJoinState::Ready
    );
    assert_eq!(
        pair.b.peer_join_status(&pair.ob, id).unwrap().state,
        PeerJoinState::Ready
    );
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_revoke_after_approval_prevents_background_regrant() {
    let mut pair = Pair::new().await;
    let invitation = pair.invite();
    let id = Uuid::new_v4();
    let (approval, expectation) = pair.approve(&invitation, id, pair.old_id);
    let reserved = Pair::member(&pair.a, &pair.oa, pair.profile, pair.b.device_id);
    pair.a
        .revoke_peer_member(
            &pair.oa,
            pair.profile,
            pair.b.device_id,
            reserved.generation,
        )
        .unwrap();
    assert!(matches!(
        pair.a
            .approve_peer_invitation_replacement(&pair.oa, &approval),
        Err(HostError::PeerMembershipDenied)
    ));
    let (incoming, outgoing) = pair.connection().await;
    let claim = pair
        .b
        .prepare_peer_rejoin(&pair.ob, &invitation, id, &expectation)
        .unwrap();
    assert!(matches!(
        pair.a.claim_peer_invitation_verified(&incoming, &claim),
        Err(HostError::PeerMembershipDenied)
    ));
    let issuer = Pair::member(&pair.b, &pair.ob, pair.profile, pair.a.device_id);
    pair.b
        .revoke_peer_member(&pair.ob, pair.profile, pair.a.device_id, issuer.generation)
        .unwrap();
    assert!(matches!(
        pair.b
            .prepare_peer_rejoin(&pair.ob, &invitation, id, &expectation),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        pair.b.prepare_peer_join(&pair.ob, &invitation, id),
        Err(HostError::PeerMembershipDenied)
    ));
    drop(incoming);
    drop(outgoing);
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_explicit_owner_can_replace_abandoned_pre_claim_reservations() {
    let mut pair = Pair::new().await;
    let first = pair.invite();
    let abandoned = Uuid::new_v4();
    pair.approve(&first, abandoned, pair.old_id);
    pair.restart().await;
    let next = pair.invite();
    let next_id = Uuid::new_v4();
    pair.approve(&next, next_id, abandoned);
    assert_eq!(
        pair.a
            .peer_invitation_status(&pair.oa, first.offer.invitation_id)
            .unwrap()
            .state,
        PeerInvitationState::Revoked
    );
    assert_eq!(
        pair.b.peer_join_status(&pair.ob, abandoned).unwrap().state,
        PeerJoinState::Revoked
    );
    assert!(matches!(
        pair.b.prepare_peer_join(&pair.ob, &first, abandoned),
        Err(HostError::PeerMembershipDenied)
    ));
    let (incoming, outgoing) = pair.connection().await;
    let claim = pair.b.prepare_peer_join(&pair.ob, &next, next_id).unwrap();
    let receipt = pair
        .a
        .claim_peer_invitation_verified(&incoming, &claim)
        .unwrap();
    let confirmation = pair
        .b
        .accept_peer_claim_verified(&outgoing, &receipt)
        .unwrap();
    let ready = pair
        .a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    pair.b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    pair.a
        .acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    drop(incoming);
    drop(outgoing);
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_different_pin_under_known_uuid_is_not_identity_recovery() {
    let pair = Pair::new().await;
    let (_root, other, owner) = host();
    let key = other.transport_identity(&owner).unwrap();
    let mut invitation = pair.invite();
    invitation.offer.issuer = key.info.clone();
    invitation.offer.issuer.device_id = pair.a.device_id;
    invitation.signature = sign(&key, INVITATION_DOMAIN, &invitation.offer).unwrap();
    let before = Pair::member(&pair.b, &pair.ob, pair.profile, pair.a.device_id);
    let expectation = PeerRejoinExpectation {
        previous_claim_id: pair.old_id,
        expected_local_generation: 1,
        expected_issuer_generation: before.generation,
    };
    assert!(matches!(
        pair.b
            .prepare_peer_rejoin(&pair.ob, &invitation, Uuid::new_v4(), &expectation),
        Err(HostError::PeerMembershipDenied)
    ));
    assert_eq!(
        Pair::member(&pair.b, &pair.ob, pair.profile, pair.a.device_id),
        before
    );
    stop(other).await;
    pair.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_rejoin_historical_schema_and_legacy_generation_mapping_are_readable_not_admissible() {
    let mut pair = Pair::new().await;
    let identity = pair.a.transport_identity(&pair.oa).unwrap();
    let (old_claim, old_receipt, old_confirmation, old_ready, invitation_id) = {
        let mut state = pair.a.state().unwrap();
        let auth = &mut state.resources.as_mut().unwrap().persistence.auth;
        let tx = store::transaction(auth).unwrap();
        let mut claim = store::claim(&tx, pair.old_id).unwrap().unwrap();
        let invitation_id = claim.binding.invitation_id;
        let mut invitation = store::invitation(&tx, invitation_id).unwrap().unwrap();
        invitation.signed.offer.schema = PEER_CORE_SCHEMA - 1;
        invitation.signed.signature =
            sign(&identity, INVITATION_DOMAIN, &invitation.signed.offer).unwrap();
        let digest = digest(&invitation.signed).unwrap();
        claim.binding.invitation_digest = digest.clone();
        claim.receipt.evidence.invitation_digest = digest.clone();
        claim.receipt.signature = sign(&identity, CLAIM_DOMAIN, &claim.receipt.evidence).unwrap();
        let ready = PeerReadyReceipt {
            claim_receipt: claim.receipt.clone(),
            signature: sign(&identity, READY_DOMAIN, &claim.receipt).unwrap(),
        };
        claim.ready = Some(ready.clone());
        store::save_invitation(&tx, &invitation).unwrap();
        store::save_claim(&tx, &claim).unwrap();
        tx.commit().unwrap();
        let mut body = pair.old_claim.clone();
        body.invitation_digest = digest;
        let confirmation = PeerJoinConfirmation {
            claim_id: pair.old_id,
            receipt_sha256: super::super::digest(&claim.receipt).unwrap(),
        };
        (body, claim.receipt, confirmation, ready, invitation_id)
    };
    {
        let mut state = pair.b.state().unwrap();
        let auth = &mut state.resources.as_mut().unwrap().persistence.auth;
        let tx = store::transaction(auth).unwrap();
        let mut pending = store::pending(&tx, pair.old_id).unwrap().unwrap();
        pending.signed.offer.schema = PEER_CORE_SCHEMA - 1;
        pending.signed.signature =
            sign(&identity, INVITATION_DOMAIN, &pending.signed.offer).unwrap();
        pending.binding.invitation_digest = old_claim.invitation_digest.clone();
        pending.receipt = Some(old_receipt.clone());
        pending.ready = Some(old_ready.clone());
        pending.local_generation = None;
        store::save_pending(&tx, &pending).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        pair.a
            .peer_invitation_status(&pair.oa, invitation_id)
            .unwrap()
            .offer
            .schema,
        PEER_CORE_SCHEMA - 1
    );
    assert_eq!(
        pair.a
            .peer_join_status(&pair.oa, pair.old_id)
            .unwrap()
            .state,
        PeerJoinState::Ready
    );
    assert_eq!(
        pair.b
            .peer_join_status(&pair.ob, pair.old_id)
            .unwrap()
            .state,
        PeerJoinState::Ready
    );
    let (incoming, outgoing) = pair.connection().await;
    assert!(matches!(
        pair.a.claim_peer_invitation_verified(&incoming, &old_claim),
        Err(HostError::PeerProtocolMismatch)
    ));
    assert!(matches!(
        pair.b.accept_peer_claim_verified(&outgoing, &old_receipt),
        Err(HostError::PeerProtocolMismatch)
    ));
    assert!(matches!(
        pair.a
            .confirm_peer_join_verified(&incoming, &old_confirmation),
        Err(HostError::PeerProtocolMismatch)
    ));
    assert!(matches!(
        pair.b.finish_peer_join_verified(&outgoing, &old_ready),
        Err(HostError::PeerProtocolMismatch)
    ));
    assert!(matches!(
        pair.a
            .acknowledge_peer_ready_verified(&incoming, &old_ready.acknowledgement().unwrap()),
        Err(HostError::PeerProtocolMismatch)
    ));
    drop(incoming);
    drop(outgoing);
    pair.restart().await;
    assert_eq!(
        pair.b
            .peer_join_status(&pair.ob, pair.old_id)
            .unwrap()
            .state,
        PeerJoinState::Ready
    );
    pair.close().await;
}
