//! Bind outgoing data ACKs to current Host membership and the actual own-origin
//! chain. The private store alone neither checks a fact prefix nor authorizes a
//! peer; both checks remain inside the same final Host gate here.
use super::{
    PeerChannel,
    authorization::{PeerOperation, PeerProfileScope},
    sync_store::{self, AckBaseline, OutgoingAckKey},
};
use crate::{BetaHost, HostError};
use exomind_core::{DEFAULT_ORIGIN_PAGE_BYTES, OriginCursor, OriginIdentity, OriginPageQuery};

impl BetaHost {
    pub(super) fn peer_ack_baseline(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        origin: &OriginIdentity,
    ) -> Result<AckBaseline, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::ReadTimeline,
            |resources, member| {
                if origin.profile_id != member.profile_id || origin.device_id != self.device_id {
                    return Err(HostError::PeerMembershipDenied);
                }
                let reader = resources.core.local_human(member.profile_id)?;
                let actual = resources
                    .core
                    .replication_identity(&reader, member.profile_id)?;
                if &actual != origin {
                    return Err(HostError::PeerSyncResetRequired);
                }
                let key = OutgoingAckKey::new(actual, member.device_id)?;
                sync_store::register(&mut resources.persistence.auth, &key)
            },
        )
    }

    pub(super) fn peer_confirm_ack(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        baseline: &AckBaseline,
        received: &OriginCursor,
    ) -> Result<OriginCursor, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::ReadTimeline,
            |resources, member| {
                let key = baseline.key();
                if key.origin().profile_id != member.profile_id
                    || key.origin().device_id != self.device_id
                    || key.target() != member.device_id
                {
                    return Err(HostError::PeerMembershipDenied);
                }
                let reader = resources.core.local_human(member.profile_id)?;
                let actual = resources
                    .core
                    .replication_identity(&reader, member.profile_id)?;
                if &actual != key.origin() {
                    return Err(HostError::PeerSyncResetRequired);
                }
                // Use the RPC's captured baseline, not a newer concurrent ACK.
                sync_store::fence(baseline, received)?;
                // after==through validates both sequence and hash at that exact
                // own-origin prefix, without loading/decoding a business fact page.
                let page = resources.core.export_origin_page(
                    &reader,
                    member.profile_id,
                    &OriginPageQuery {
                        after: Some(received.clone()),
                        through: Some(received.clone()),
                        limit: 1,
                        max_bytes: DEFAULT_ORIGIN_PAGE_BYTES,
                    },
                )?;
                if page.origin != actual
                    || !page.entries.is_empty()
                    || page.has_more
                    || &page.from != received
                    || &page.to != received
                    || &page.through != received
                {
                    return Err(HostError::Core(exomind_core::CoreError::RecoveryRequired));
                }
                sync_store::confirm(&mut resources.persistence.auth, key, received)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CreatePeerInvitation, PeerCancellation, PeerCapabilities, PeerPin, PeerTransportListener,
        PeerTransportOptions, Session,
    };
    use exomind_core::{CaptureCommand, CommandId, EventId, ProfileId};
    use std::sync::Arc;
    use tempfile::{TempDir, tempdir};
    use uuid::Uuid;

    struct Pair {
        _a_root: TempDir,
        _b_root: TempDir,
        a: Arc<BetaHost>,
        b: Arc<BetaHost>,
        oa: Session,
        ob: Session,
        profile: ProfileId,
        listener: PeerTransportListener,
        incoming: PeerChannel,
        _outgoing: PeerChannel,
        scope: PeerProfileScope,
    }
    impl Pair {
        async fn new() -> Self {
            let a_root = tempdir().unwrap();
            let b_root = tempdir().unwrap();
            let a = Arc::new(BetaHost::open(a_root.path()).unwrap());
            let b = Arc::new(BetaHost::open(b_root.path()).unwrap());
            let oa = a.owner_session().unwrap();
            let ob = b.owner_session().unwrap();
            let profile = ProfileId::new();
            a.provision_profile(&oa, profile, "ACK scope").unwrap();
            let mut listener = a
                .listen_peer_transport(
                    &oa,
                    "127.0.0.1:0".parse().unwrap(),
                    PeerTransportOptions::default(),
                )
                .await
                .unwrap();
            let invitation = a
                .create_peer_invitation(
                    &oa,
                    &CreatePeerInvitation {
                        invitation_id: Uuid::new_v4(),
                        profile_id: profile,
                        capabilities: PeerCapabilities::FULL,
                        candidates: vec![listener.addr()],
                        ttl_seconds: 120,
                    },
                )
                .unwrap()
                .invitation
                .unwrap();
            let pin = PeerPin::from_sha256(&invitation.offer.issuer.fingerprint_sha256).unwrap();
            let outgoing = b
                .connect_peer_transport(
                    &ob,
                    listener.addr(),
                    pin,
                    PeerTransportOptions::default(),
                    PeerCancellation::new(),
                )
                .await
                .unwrap();
            let incoming = listener.accept(PeerCancellation::new()).await.unwrap();
            let claim = b
                .prepare_peer_join(&ob, &invitation, Uuid::new_v4())
                .unwrap();
            let receipt = a.claim_peer_invitation_verified(&incoming, &claim).unwrap();
            let confirmation = b.accept_peer_claim_verified(&outgoing, &receipt).unwrap();
            let ready = a
                .confirm_peer_join_verified(&incoming, &confirmation)
                .unwrap();
            b.finish_peer_join_verified(&outgoing, &ready).unwrap();
            a.acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
                .unwrap();
            let scope = a
                .peer_profile_scope(&incoming, profile, b.device_id)
                .unwrap();
            Self {
                _a_root: a_root,
                _b_root: b_root,
                a,
                b,
                oa,
                ob,
                profile,
                listener,
                incoming,
                _outgoing: outgoing,
                scope,
            }
        }
        fn append(&self) -> (OriginIdentity, OriginCursor) {
            let writer = self.a.native_human_session(&self.oa, self.profile).unwrap();
            self.a
                .capture(
                    &writer,
                    &CaptureCommand {
                        command_id: CommandId::new(),
                        event_id: EventId::new(),
                        profile_id: self.profile,
                        occurred_at_ms: 1794680000000,
                        text: "synthetic acknowledged fact".into(),
                        tags: vec![],
                        originals: vec![],
                    },
                )
                .unwrap();
            let state = self
                .a
                .peer_origin_state(&self.incoming, &self.scope)
                .unwrap();
            (state.origin, state.head)
        }
        fn stored(&self, baseline: &AckBaseline) -> Option<OriginCursor> {
            let state = self.a.state().unwrap();
            sync_store::load(
                &crate::resources(&state).unwrap().persistence.auth,
                baseline.key(),
            )
            .unwrap()
            .cursor()
            .cloned()
        }
        async fn stop(self) {
            let a = self.a.clone();
            let b = self.b.clone();
            tokio::task::spawn_blocking(move || {
                a.stop().unwrap();
                b.stop().unwrap();
            })
            .await
            .unwrap();
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn peer_ack_bridge_checks_real_core_prefix_sql_failure_and_concurrent_baseline() {
        let pair = Pair::new().await;
        let (origin, one) = pair.append();
        let baseline = pair
            .a
            .peer_ack_baseline(&pair.incoming, &pair.scope, &origin)
            .unwrap();
        assert!(baseline.cursor().is_none());
        pair.a
            .peer_confirm_ack(&pair.incoming, &pair.scope, &baseline, &one)
            .unwrap();
        let rpc = pair
            .a
            .peer_ack_baseline(&pair.incoming, &pair.scope, &origin)
            .unwrap();
        let (_, two) = pair.append();
        let mut fork = two.clone();
        fork.hash = if two.hash == "0".repeat(64) {
            "1".repeat(64)
        } else {
            "0".repeat(64)
        };
        assert!(matches!(
            pair.a
                .peer_confirm_ack(&pair.incoming, &pair.scope, &rpc, &fork),
            Err(HostError::Core(_))
        ));
        assert_eq!(pair.stored(&rpc), Some(one.clone()));
        {
            let state = pair.a.state().unwrap();
            crate::resources(&state).unwrap().persistence.auth.execute_batch("CREATE TRIGGER deny_bridge_ack BEFORE UPDATE ON peer_sync_ack BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
        }
        assert!(matches!(
            pair.a
                .peer_confirm_ack(&pair.incoming, &pair.scope, &rpc, &two),
            Err(HostError::PeerSyncUnavailable)
        ));
        assert_eq!(pair.stored(&rpc), Some(one.clone()));
        {
            let state = pair.a.state().unwrap();
            crate::resources(&state)
                .unwrap()
                .persistence
                .auth
                .execute_batch("DROP TRIGGER deny_bridge_ack")
                .unwrap();
        }
        pair.a
            .peer_confirm_ack(&pair.incoming, &pair.scope, &rpc, &two)
            .unwrap();
        assert_eq!(
            pair.a
                .peer_confirm_ack(&pair.incoming, &pair.scope, &rpc, &one)
                .unwrap(),
            two
        );
        let newer = pair
            .a
            .peer_ack_baseline(&pair.incoming, &pair.scope, &origin)
            .unwrap();
        assert!(matches!(
            pair.a
                .peer_confirm_ack(&pair.incoming, &pair.scope, &newer, &one),
            Err(HostError::PeerSyncResetRequired)
        ));
        pair.stop().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn peer_ack_bridge_revalidates_origin_target_profile_and_epoch_after_registration() {
        let pair = Pair::new().await;
        let (origin, one) = pair.append();
        let baseline = pair
            .a
            .peer_ack_baseline(&pair.incoming, &pair.scope, &origin)
            .unwrap();
        let mut wrong = origin.clone();
        wrong.restoration_epoch = Uuid::new_v4();
        assert!(matches!(
            pair.a
                .peer_ack_baseline(&pair.incoming, &pair.scope, &wrong),
            Err(HostError::PeerSyncResetRequired)
        ));
        let keys = [
            OutgoingAckKey::new(wrong, pair.b.device_id).unwrap(),
            OutgoingAckKey::new(origin.clone(), exomind_core::DeviceId::new()).unwrap(),
            OutgoingAckKey::new(
                OriginIdentity {
                    profile_id: ProfileId::new(),
                    ..origin.clone()
                },
                pair.b.device_id,
            )
            .unwrap(),
        ];
        for key in keys {
            let other = {
                let mut state = pair.a.state().unwrap();
                sync_store::register(
                    &mut state.resources.as_mut().unwrap().persistence.auth,
                    &key,
                )
                .unwrap()
            };
            assert!(matches!(
                pair.a
                    .peer_confirm_ack(&pair.incoming, &pair.scope, &other, &one),
                Err(HostError::PeerMembershipDenied) | Err(HostError::PeerSyncResetRequired)
            ));
            assert!(pair.stored(&other).is_none());
        }
        assert!(pair.stored(&baseline).is_none());
        pair.a
            .peer_confirm_ack(&pair.incoming, &pair.scope, &baseline, &one)
            .unwrap();
        pair.stop().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn peer_ack_bridge_stale_channel_or_revoked_generation_never_raises_ack() {
        let mut pair = Pair::new().await;
        let (origin, one) = pair.append();
        let baseline = pair
            .a
            .peer_ack_baseline(&pair.incoming, &pair.scope, &origin)
            .unwrap();
        pair.a
            .peer_confirm_ack(&pair.incoming, &pair.scope, &baseline, &one)
            .unwrap();
        let (_, two) = pair.append();
        let pin =
            PeerPin::from_sha256(&pair.a.device_identity(&pair.oa).unwrap().fingerprint_sha256)
                .unwrap();
        let _outgoing = pair
            .b
            .connect_peer_transport(
                &pair.ob,
                pair.listener.addr(),
                pin,
                PeerTransportOptions::default(),
                PeerCancellation::new(),
            )
            .await
            .unwrap();
        let incoming = pair.listener.accept(PeerCancellation::new()).await.unwrap();
        assert!(matches!(
            pair.a
                .peer_confirm_ack(&incoming, &pair.scope, &baseline, &two),
            Err(HostError::PeerMembershipDenied)
        ));
        assert_eq!(pair.stored(&baseline), Some(one.clone()));
        let member = pair
            .a
            .peer_members(&pair.oa, pair.profile)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == pair.b.device_id)
            .unwrap();
        pair.a
            .revoke_peer_member(&pair.oa, pair.profile, pair.b.device_id, member.generation)
            .unwrap();
        assert!(matches!(
            pair.a
                .peer_confirm_ack(&pair.incoming, &pair.scope, &baseline, &two),
            Err(HostError::PeerMembershipDenied)
        ));
        assert_eq!(pair.stored(&baseline), Some(one));
        pair.stop().await;
    }
}
