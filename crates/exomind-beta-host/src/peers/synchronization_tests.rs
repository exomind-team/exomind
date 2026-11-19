use super::*;
use crate::{
    CreatePeerInvitation, PeerCapabilities, PeerPin, PeerTransportListener, PeerTransportOptions,
};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, OriginalId, StageId, TimeblockAction,
    TimeblockCommand, TimeblockId, TimerSpec,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tempfile::{TempDir, tempdir};
use uuid::Uuid;

struct Rig {
    ra: TempDir,
    rb: TempDir,
    a: Arc<BetaHost>,
    b: Arc<BetaHost>,
    oa: Session,
    ob: Session,
    p: ProfileId,
}
fn open(root: &TempDir) -> (Arc<BetaHost>, Session) {
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    (host, owner)
}
fn transport_options() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(3),
        channel_lifetime: Duration::from_secs(120),
    }
}
async fn listener(host: &Arc<BetaHost>, owner: &Session) -> PeerTransportListener {
    host.listen_peer_transport(owner, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap()
}
async fn connect(
    client: &Arc<BetaHost>,
    owner: &Session,
    server: &Arc<BetaHost>,
    server_owner: &Session,
    listener: &mut PeerTransportListener,
) -> (PeerChannel, PeerChannel) {
    let pin = PeerPin::from_sha256(
        &server
            .device_identity(server_owner)
            .unwrap()
            .fingerprint_sha256,
    )
    .unwrap();
    let c = client
        .connect_peer_transport(
            owner,
            listener.addr(),
            pin,
            transport_options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let s = listener.accept(PeerCancellation::new()).await.unwrap();
    (c, s)
}
async fn rig() -> Rig {
    rig_with_capabilities(PeerCapabilities::FULL).await
}
async fn rig_with_capabilities(capabilities: PeerCapabilities) -> Rig {
    let ra = tempdir().unwrap();
    let rb = tempdir().unwrap();
    let (a, oa) = open(&ra);
    let (b, ob) = open(&rb);
    let p = ProfileId::new();
    a.provision_profile(&oa, p, "wire facts").unwrap();
    let mut listening = listener(&a, &oa).await;
    let invitation = a
        .create_peer_invitation(
            &oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: p,
                capabilities,
                candidates: vec![listening.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let (c, s) = connect(&b, &ob, &a, &oa, &mut listening).await;
    let issuer = a.clone();
    let serving = tokio::spawn(async move { issuer.accept_peer_join_over_transport(s).await });
    b.join_peer_profile_over_transport(&ob, &invitation, Uuid::new_v4(), c)
        .await
        .unwrap();
    serving.await.unwrap().unwrap();
    drop(listening);
    Rig {
        ra,
        rb,
        a,
        b,
        oa,
        ob,
        p,
    }
}
fn seed(host: &BetaHost, p: ProfileId, count: usize, prefix: &str, with_timer: bool) {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(p).unwrap();
    for i in 0..count {
        core.submit(
            &human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 1000 + i as i64,
                text: format!("{prefix} offline {i} · UTF8"),
                tags: vec![prefix.into()],
                originals: vec![],
            },
        )
        .unwrap();
    }
    if with_timer {
        let stamp = core.trusted_clock_stamp(Uuid::new_v4(), 2000, 10).unwrap();
        let current = core.timeblock_snapshot(&human, p, &stamp).unwrap();
        core.apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: current.revision,
                action: TimeblockAction::Start {
                    block_id: TimeblockId::new(),
                    name: format!("{prefix} independent timer"),
                    note: String::new(),
                    timer: TimerSpec::CountUp,
                },
            },
            &stamp,
        )
        .unwrap();
    }
}
fn facts(host: &BetaHost, p: ProfileId) -> BTreeMap<String, Vec<u8>> {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(p).unwrap();
    let mut out = BTreeMap::new();
    for event in core.events(&human, p).unwrap() {
        out.insert(
            event.event_id.to_string(),
            event.canonical_fact_bytes().unwrap(),
        );
    }
    let mut before = None;
    let mut through = None;
    loop {
        let page = core
            .timeblock_nodes(
                &human,
                p,
                &exomind_core::EventQuery {
                    before,
                    through,
                    limit: 100,
                    ..Default::default()
                },
            )
            .unwrap();
        for node in page.items {
            out.insert(
                node.event_id.to_string(),
                node.canonical_fact_bytes().unwrap(),
            );
        }
        through = Some(page.highwater);
        before = page.next_before;
        if before.is_none() {
            break;
        }
    }
    out
}
fn receipt_count(host: &BetaHost) -> u64 {
    let state = host.active_state().unwrap();
    let db =
        rusqlite::Connection::open(crate::resources(&state).unwrap().core.database_path()).unwrap();
    db.query_row("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
        .unwrap()
}
fn assert_facts(host: &BetaHost, profile: ProfileId, expected: &BTreeMap<String, Vec<u8>>) {
    // Compare complete ID/payload bytes while keeping potentially large record
    // bodies out of assertion logs.
    assert!(
        facts(host, profile) == *expected,
        "event IDs or canonical fact bytes differ"
    );
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
async fn exchange(r: &Rig, options: PeerSyncOptions) -> (PeerSyncResult, PeerSyncResult) {
    exchange_hosts(&r.a, &r.oa, &r.b, &r.ob, r.p, options).await
}
async fn pair_third(r: &Rig) -> (TempDir, Arc<BetaHost>, Session) {
    let root = tempdir().unwrap();
    let (host, owner) = open(&root);
    let mut listening = listener(&r.a, &r.oa).await;
    let invitation =
        r.a.create_peer_invitation(
            &r.oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: r.p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![listening.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let (c, s) = connect(&host, &owner, &r.a, &r.oa, &mut listening).await;
    let issuer = r.a.clone();
    let joining = tokio::spawn(async move { issuer.accept_peer_join_over_transport(s).await });
    host.join_peer_profile_over_transport(&owner, &invitation, Uuid::new_v4(), c)
        .await
        .unwrap();
    joining.await.unwrap().unwrap();
    drop(listening);
    // Listener Drop only requests cancellation. Await the owned runtime drain
    // before a fixture immediately rebinds A; do not relax the listener fence.
    let issuer = r.a.clone();
    tokio::task::spawn_blocking(move || issuer.peers.wait_empty(Duration::from_secs(3)))
        .await
        .unwrap()
        .unwrap();
    (root, host, owner)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relayed_source_requires_current_carrier_endorsement_fixed_key_and_no_revoked_source() {
    use crate::peers::source_history::endorsement_message;
    let r = rig().await;
    seed(&r.b, r.p, 3, "third-source integrity", false);
    exchange(&r, PeerSyncOptions::default()).await;
    let (_root, third, owner) = pair_third(&r).await;
    let mut listening = listener(&r.a, &r.oa).await;
    let (c, s) = connect(&third, &owner, &r.a, &r.oa, &mut listening).await;
    let sender = r.a.peer_profile_scope(&s, r.p, third.device_id).unwrap();
    let receiver = third.peer_profile_scope(&c, r.p, r.a.device_id).unwrap();
    let catalog = r.a.peer_source_catalog(&s, &sender).unwrap();
    let offer = catalog
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.b.device_id)
        .unwrap();
    let page =
        r.a.peer_export_source_page(
            &s,
            &sender,
            offer,
            &OriginPageQuery {
                limit: 1,
                through: Some(offer.available_head.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let mut forged = offer.clone();
    forged.endorsement[0] ^= 1;
    assert!(third.peer_source_cursor(&c, &receiver, &forged).is_err());
    assert!(
        third
            .peer_import_source_page(&c, &receiver, &forged, &page)
            .is_err()
    );
    assert!(facts(&third, r.p).is_empty());
    let (ack, verified) = third
        .peer_import_source_page(&c, &receiver, offer, &page)
        .unwrap();
    assert_eq!(ack.inserted, 1);
    assert_eq!(verified, page.page.to);
    assert!(
        !third
            .peer_members(&owner, r.p)
            .unwrap()
            .iter()
            .any(|m| m.device_id == r.b.device_id)
    );
    let signer = r.a.transport_identity(&r.oa).unwrap();
    let mut changed = offer.clone();
    changed.source = third.device_identity(&owner).unwrap();
    changed.source.device_id = r.b.device_id;
    changed.endorsement = signer
        .sign_message(&endorsement_message(&changed).unwrap())
        .unwrap();
    // Even a valid new carrier endorsement cannot overwrite the first source
    // key after its first authenticated prefix was atomically admitted.
    assert!(third.peer_source_cursor(&c, &receiver, &changed).is_err());
    let mut wrong_p = offer.clone();
    wrong_p.origin.profile_id = ProfileId::new();
    wrong_p.endorsement = signer
        .sign_message(&endorsement_message(&wrong_p).unwrap())
        .unwrap();
    assert!(third.peer_source_cursor(&c, &receiver, &wrong_p).is_err());
    let mut wrong_carrier = offer.clone();
    wrong_carrier.carrier = r.b.device_identity(&r.ob).unwrap();
    assert!(
        third
            .peer_source_cursor(&c, &receiver, &wrong_carrier)
            .is_err()
    );
    let mut bad_page = page.clone();
    bad_page.entry_signatures[0][0] ^= 1;
    assert!(
        third
            .peer_import_source_page(&c, &receiver, offer, &bad_page)
            .is_err()
    );
    assert_eq!(facts(&third, r.p).len(), 1);
    assert_eq!(receipt_count(&third), 0);
    // A known source's revocation cannot be bypassed by forwarding its valid
    // old signatures over a different, still ready carrier.
    let reverse_catalog = third.peer_source_catalog(&c, &receiver).unwrap();
    let reverse = reverse_catalog
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.b.device_id)
        .unwrap();
    let b =
        r.a.peer_members(&r.oa, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.b.device_id)
            .unwrap();
    r.a.revoke_peer_member(&r.oa, r.p, r.b.device_id, b.generation)
        .unwrap();
    assert!(matches!(
        r.a.peer_source_cursor(&s, &sender, reverse),
        Err(HostError::PeerMembershipDenied)
    ));
    assert_eq!(facts(&r.a, r.p).len(), 3);
    let a = third
        .peer_members(&owner, r.p)
        .unwrap()
        .into_iter()
        .find(|m| m.device_id == r.a.device_id)
        .unwrap();
    third
        .revoke_peer_member(&owner, r.p, r.a.device_id, a.generation)
        .unwrap();
    assert!(matches!(
        third.peer_import_source_page(&c, &receiver, offer, &page),
        Err(HostError::PeerMembershipDenied)
    ));
    drop((c, s, listening));
    stop(third).await;
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_received_history_backfills_proofs_without_resetting_a_persisted_data_ack() {
    let mut r = rig().await;
    seed(&r.b, r.p, 3, "legacy history", false);
    seed(&r.a, r.p, 1, "own history", false);
    let input = {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(r.p).unwrap(),
            r.p,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };
    {
        let state = r.a.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let ctx = core
            .trusted_replica_context(r.p, r.b.device_id, input.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&ctx, &input).unwrap();
    }
    let a_facts_before_repair = facts(&r.a, r.p);
    let a_receipts_before_repair = receipt_count(&r.a);
    let data_cursor = |host: &BetaHost| {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(
                r.p,
                input.origin.device_id,
                input.origin.restoration_epoch,
                1,
            )
            .unwrap();
        core.replication_cursor(&context).unwrap()
    };
    assert_eq!(data_cursor(&r.a), input.to);

    let mut listening = listener(&r.b, &r.ob).await;
    let (c, s) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
    let scope = r.b.peer_profile_scope(&s, r.p, r.a.device_id).unwrap();
    let baseline = r.b.peer_ack_baseline(&s, &scope, &input.origin).unwrap();
    r.b.peer_confirm_ack(&s, &scope, &baseline, &input.to)
        .unwrap();
    drop((c, s, listening));
    let (_root, third, owner) = pair_third(&r).await;
    let (partial, other) =
        exchange_hosts(&r.a, &r.oa, &third, &owner, r.p, PeerSyncOptions::default()).await;
    assert!(!partial.events_complete && !other.events_complete);
    assert!(
        partial
            .sent_sources
            .iter()
            .any(|s| s.origin == input.origin && s.available_head.is_none())
    );
    assert_eq!(
        facts(&third, r.p).len(),
        1,
        "own text arrives without claiming the unsigned third source arrived"
    );

    // The author keeps its original device identity and signs only its own
    // existing facts after restart; a relay can carry, but cannot mint, this proof.
    let original_device = r.b.device_id;
    let original_pin = r.b.device_identity(&r.ob).unwrap().fingerprint_sha256;
    stop(r.b.clone()).await;
    r.b = Arc::new(BetaHost::open(r.rb.path()).unwrap());
    r.ob = r.b.owner_session().unwrap();
    assert_eq!(r.b.device_id, original_device);
    assert_eq!(
        r.b.device_identity(&r.ob).unwrap().fingerprint_sha256,
        original_pin
    );

    let (a, b) = exchange(&r, PeerSyncOptions::default()).await;
    assert!(a.events_complete && b.events_complete);
    assert_eq!(a.received_facts, 0);
    assert!(a.replayed_facts >= 3);
    assert_eq!(data_cursor(&r.a), input.to);
    assert_eq!(facts(&r.a, r.p), a_facts_before_repair);
    assert_eq!(receipt_count(&r.a), a_receipts_before_repair);
    {
        let state = r.a.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let verified = core
            .verified_origin_state(&core.local_human(r.p).unwrap(), &input.origin)
            .unwrap()
            .unwrap();
        assert_eq!(verified.cursor, input.to);
        assert_eq!(verified.key.fingerprint_sha256, original_pin);
    }
    let (complete, other) =
        exchange_hosts(&r.a, &r.oa, &third, &owner, r.p, PeerSyncOptions::default()).await;
    assert!(complete.events_complete && other.events_complete);
    assert_facts(&third, r.p, &facts(&r.a, r.p));
    assert_eq!(receipt_count(&r.a), 1);
    assert_eq!(receipt_count(&r.b), 3);
    assert_eq!(receipt_count(&third), 0);
    stop(third).await;
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_signed_source_seals_its_epoch_once_without_creating_user_facts() {
    use crate::peers::source_history::endorsement_message;
    let r = rig().await;
    let (a, b) = exchange(&r, PeerSyncOptions::default()).await;
    assert!(a.events_complete && b.events_complete);
    let origin = {
        let state = r.a.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.replication_identity(&core.local_human(r.p).unwrap(), r.p)
            .unwrap()
    };
    {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let stored = core
            .verified_origin_state(&core.local_human(r.p).unwrap(), &origin)
            .unwrap()
            .unwrap();
        assert_eq!(stored.cursor.seq, 0);
    }
    let (a, b) = exchange(&r, PeerSyncOptions::default()).await;
    assert!(a.events_complete && b.events_complete);
    assert_eq!(
        a.sent_facts
            + a.received_facts
            + a.replayed_facts
            + b.sent_facts
            + b.received_facts
            + b.replayed_facts,
        0
    );
    assert!(facts(&r.a, r.p).is_empty() && facts(&r.b, r.p).is_empty());
    assert_eq!(receipt_count(&r.a) + receipt_count(&r.b), 0);
    let mut listening = listener(&r.a, &r.oa).await;
    let (c, s) = connect(&r.b, &r.ob, &r.a, &r.oa, &mut listening).await;
    let outgoing = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
    let incoming = r.b.peer_profile_scope(&c, r.p, r.a.device_id).unwrap();
    let catalog = r.a.peer_source_catalog(&s, &outgoing).unwrap();
    let mut changed = catalog
        .sources
        .iter()
        .find(|o| o.origin == origin)
        .unwrap()
        .clone();
    changed.origin.restoration_epoch = Uuid::new_v4();
    changed.endorsement =
        r.a.transport_identity(&r.oa)
            .unwrap()
            .sign_message(&endorsement_message(&changed).unwrap())
            .unwrap();
    assert!(matches!(
        r.b.peer_source_cursor(&c, &incoming, &changed),
        Err(HostError::Core(CoreError::OriginEpochChanged))
    ));
    drop((c, s, listening));
    stop(r.a).await;
    stop(r.b).await;
}
async fn exchange_hosts(
    a: &Arc<BetaHost>,
    oa: &Session,
    b: &Arc<BetaHost>,
    ob: &Session,
    profile: ProfileId,
    options: PeerSyncOptions,
) -> (PeerSyncResult, PeerSyncResult) {
    let mut listening = listener(b, ob).await;
    let (c, s) = connect(a, oa, b, ob, &mut listening).await;
    let target = b.clone();
    let serving = tokio::spawn(async move {
        target
            .accept_peer_profile_sync_over_transport(s, options)
            .await
    });
    let result = a
        .synchronize_peer_profile_over_transport(oa, profile, b.device_id, c, options)
        .await
        .unwrap();
    let other = serving.await.unwrap().unwrap();
    drop(listening);
    (result, other)
}

fn timer_action(host: &BetaHost, profile: ProfileId, action: TimeblockAction) {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    let stamp = core.trusted_clock_stamp(Uuid::new_v4(), 5000, 0).unwrap();
    let revision = core
        .timeblock_snapshot(&human, profile, &stamp)
        .unwrap()
        .revision;
    core.apply_timeblock(
        &human,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            expected_revision: revision,
            action,
        },
        &stamp,
    )
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_origin_export_requalifies_its_live_channel_and_revocation_before_signing() {
    let r = rig().await;
    seed(&r.a, r.p, 3, "signed", false);
    let mut listening = listener(&r.a, &r.oa).await;
    let (c, s) = connect(&r.b, &r.ob, &r.a, &r.oa, &mut listening).await;
    let scope = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
    let signed =
        r.a.peer_export_signed_origin_page(
            &s,
            &scope,
            &OriginPageQuery {
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
    signed
        .verify_positions(&signed.page.origin, &r.a.device_identity(&r.oa).unwrap())
        .unwrap();
    assert_eq!(signed.page.origin.device_id, r.a.device_id);
    assert!(signed.page.has_more);
    let member =
        r.a.peer_members(&r.oa, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.b.device_id)
            .unwrap();
    r.a.revoke_peer_member(&r.oa, r.p, r.b.device_id, member.generation)
        .unwrap();
    assert!(matches!(
        r.a.peer_export_signed_origin_page(&s, &scope, &OriginPageQuery::default()),
        Err(HostError::PeerMembershipDenied)
    ));
    assert_eq!(receipt_count(&r.a), 3);
    drop((c, s, listening));
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_origin_import_authenticates_before_atomic_admission_and_rechecks_revocation() {
    let r = rig().await;
    seed(&r.a, r.p, 3, "signed import", false);
    let first =
        r.a.signed_origin_page(
            &r.oa,
            r.p,
            &OriginPageQuery {
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
    let mut listening = listener(&r.a, &r.oa).await;
    let (c, s) = connect(&r.b, &r.ob, &r.a, &r.oa, &mut listening).await;
    let scope = r.b.peer_profile_scope(&c, r.p, r.a.device_id).unwrap();
    let mut forged = first.clone();
    forged.entry_signatures[0][0] ^= 1;
    assert!(
        r.b.peer_import_signed_origin_page(&c, &scope, &forged)
            .is_err()
    );
    assert!(facts(&r.b, r.p).is_empty());
    let ack =
        r.b.peer_import_signed_origin_page(&c, &scope, &first)
            .unwrap();
    assert_eq!(ack.inserted, 1);
    {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let verified = core
            .verified_origin_state(&core.local_human(r.p).unwrap(), &first.page.origin)
            .unwrap()
            .unwrap();
        assert_eq!(verified.cursor, first.page.to);
        assert_eq!(
            verified.key.fingerprint_sha256,
            first.signer.fingerprint_sha256
        );
    }
    let rest =
        r.a.signed_origin_page(
            &r.oa,
            r.p,
            &OriginPageQuery {
                after: Some(first.page.to.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    let mut wrong_profile = rest.clone();
    wrong_profile.page.origin.profile_id = ProfileId::new();
    assert!(
        r.b.peer_import_signed_origin_page(&c, &scope, &wrong_profile)
            .is_err()
    );
    let mut wrong_pin = rest.clone();
    wrong_pin.signer.fingerprint_sha256 = "0".repeat(64);
    assert!(
        r.b.peer_import_signed_origin_page(&c, &scope, &wrong_pin)
            .is_err()
    );
    // Merely presenting a TLS-qualified carrier cannot make another device's
    // signed source eligible at this direct seam.
    let foreign =
        r.b.signed_origin_page(&r.ob, r.p, &OriginPageQuery::default())
            .unwrap();
    assert!(
        r.b.peer_import_signed_origin_page(&c, &scope, &foreign)
            .is_err()
    );
    let member =
        r.b.peer_members(&r.ob, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.a.device_id)
            .unwrap();
    r.b.revoke_peer_member(&r.ob, r.p, r.a.device_id, member.generation)
        .unwrap();
    assert!(matches!(
        r.b.peer_import_signed_origin_page(&c, &scope, &rest),
        Err(HostError::PeerMembershipDenied)
    ));
    assert_eq!(facts(&r.b, r.p).len(), 1);
    assert_eq!(receipt_count(&r.b), 0);
    drop((c, s, listening));
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_origin_transfer_enforces_both_local_and_remote_capabilities() {
    for (read_timeline, append_facts) in [(true, false), (false, true)] {
        let r = rig_with_capabilities(PeerCapabilities {
            read_timeline,
            append_facts,
            read_originals: false,
        })
        .await;
        seed(&r.a, r.p, 1, "issuer signed", false);
        seed(&r.b, r.p, 1, "joiner signed", false);
        let mut listening = listener(&r.a, &r.oa).await;
        let (c, s) = connect(&r.b, &r.ob, &r.a, &r.oa, &mut listening).await;
        let a_scope = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
        let b_scope = r.b.peer_profile_scope(&c, r.p, r.a.device_id).unwrap();
        assert_eq!(
            r.a.peer_export_signed_origin_page(&s, &a_scope, &OriginPageQuery::default())
                .is_ok(),
            read_timeline
        );
        assert_eq!(
            r.b.peer_export_signed_origin_page(&c, &b_scope, &OriginPageQuery::default())
                .is_ok(),
            append_facts
        );
        let a_page =
            r.a.signed_origin_page(&r.oa, r.p, &OriginPageQuery::default())
                .unwrap();
        let b_page =
            r.b.signed_origin_page(&r.ob, r.p, &OriginPageQuery::default())
                .unwrap();
        assert_eq!(
            r.b.peer_import_signed_origin_page(&c, &b_scope, &a_page)
                .is_ok(),
            read_timeline
        );
        assert_eq!(
            r.a.peer_import_signed_origin_page(&s, &a_scope, &b_page)
                .is_ok(),
            append_facts
        );
        assert_eq!(receipt_count(&r.a), 1);
        assert_eq!(receipt_count(&r.b), 1);
        drop((c, s, listening));
        stop(r.a).await;
        stop(r.b).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn three_device_profile_sync_closes_timeblock_history_without_pairing_every_device() {
    // 8d49542c / 68e5bd54 / ac1dcc95 / 90d8bd80. This is a synthetic
    // production-transport regression, not evidence of the field phone's DB.
    let r = rig().await;
    let phone_root = tempdir().unwrap();
    let (phone, phone_owner) = open(&phone_root);
    let block = TimeblockId::new();
    timer_action(
        &r.a,
        r.p,
        TimeblockAction::Start {
            block_id: block,
            name: "desktop origin".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    exchange(&r, PeerSyncOptions::default()).await;
    timer_action(&r.b, r.p, TimeblockAction::Pause { block_id: block });
    exchange(&r, PeerSyncOptions::default()).await;
    timer_action(&r.a, r.p, TimeblockAction::Resume { block_id: block });

    let mut listening = listener(&r.a, &r.oa).await;
    let invitation =
        r.a.create_peer_invitation(
            &r.oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: r.p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![listening.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let (c, s) = connect(&phone, &phone_owner, &r.a, &r.oa, &mut listening).await;
    let issuer = r.a.clone();
    let joining = tokio::spawn(async move { issuer.accept_peer_join_over_transport(s).await });
    phone
        .join_peer_profile_over_transport(&phone_owner, &invitation, Uuid::new_v4(), c)
        .await
        .unwrap();
    joining.await.unwrap().unwrap();
    drop(listening);
    seed(&phone, r.p, 1, "phone", false);

    let mut expected = facts(&r.a, r.p);
    expected.extend(facts(&phone, r.p));
    let (desktop_result, phone_result) = exchange_hosts(
        &r.a,
        &r.oa,
        &phone,
        &phone_owner,
        r.p,
        PeerSyncOptions::default(),
    )
    .await;
    assert!(desktop_result.events_complete && phone_result.events_complete);
    assert_facts(&phone, r.p, &expected);
    assert_facts(&r.a, r.p, &expected);

    // Receiving another origin's authenticated history is not permission to
    // connect to that device or to acquire a new network membership.
    assert!(
        phone
            .peer_members(&phone_owner, r.p)
            .unwrap()
            .iter()
            .all(|m| m.device_id != r.b.device_id)
    );
    assert!(
        r.b.peer_members(&r.ob, r.p)
            .unwrap()
            .iter()
            .all(|m| m.device_id != phone.device_id)
    );
    assert_eq!(receipt_count(&r.a), 2);
    assert_eq!(receipt_count(&r.b), 1);
    assert_eq!(receipt_count(&phone), 1);

    timer_action(&phone, r.p, TimeblockAction::EndAction { block_id: block });
    timer_action(
        &phone,
        r.p,
        TimeblockAction::SubmitFeedback {
            block_id: block,
            feedback: exomind_core::FeedbackInput::Skipped,
        },
    );
    timer_action(
        &phone,
        r.p,
        TimeblockAction::Start {
            block_id: TimeblockId::new(),
            name: "phone after recovery".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    exchange_hosts(
        &r.a,
        &r.oa,
        &phone,
        &phone_owner,
        r.p,
        PeerSyncOptions::default(),
    )
    .await;
    exchange(&r, PeerSyncOptions::default()).await;
    let converged = facts(&phone, r.p);
    assert_facts(&r.a, r.p, &converged);
    assert_facts(&r.b, r.p, &converged);
    assert_eq!(receipt_count(&phone), 4);
    stop(phone).await;
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_page_sessions_do_not_starve_a_second_origin_behind_a_continuously_growing_first() {
    let r = rig().await;
    seed(&r.a, r.p, 210, "fair A", false);
    let a_ids = facts(&r.a, r.p);
    seed(&r.b, r.p, 210, "fair B", false);
    let b_ids = facts(&r.b, r.p);
    exchange(&r, PeerSyncOptions::default()).await;
    let (_root, third, owner) = pair_third(&r).await;
    let first_is_a = r.a.device_id.to_string() < r.b.device_id.to_string();
    let other_ids = if first_is_a { b_ids } else { a_ids };
    let options = PeerSyncOptions {
        max_pages: 1,
        ..Default::default()
    };
    for round in 0..4 {
        // Keep the first frozen-order source unfinished throughout this test.
        // A fair scheduler must still allocate a later session page elsewhere.
        if first_is_a {
            seed(&r.a, r.p, 100, &format!("hot A {round}"), false);
        } else {
            seed(&r.b, r.p, 100, &format!("hot B {round}"), false);
            exchange(&r, PeerSyncOptions::default()).await;
        }
        exchange_hosts(&r.a, &r.oa, &third, &owner, r.p, options).await;
    }
    let received = facts(&third, r.p);
    let other_arrived = other_ids.keys().any(|id| received.contains_key(id));
    stop(third).await;
    stop(r.a).await;
    stop(r.b).await;
    assert!(
        other_arrived,
        "a fixed first origin consumed every session's page budget"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_bidirectional_251_fact_streams_resume_under_one_page_per_direction() {
    let r = rig().await;
    seed(&r.a, r.p, 250, "A", true);
    seed(&r.b, r.p, 250, "B", true);
    let mut expected = facts(&r.a, r.p);
    expected.extend(facts(&r.b, r.p));
    assert_eq!(expected.len(), 502);
    let options = PeerSyncOptions {
        max_pages: 1,
        ..PeerSyncOptions::default()
    };
    for round in 0..3 {
        let (a, b) = exchange(&r, options).await;
        assert_eq!(a.events_complete, round == 2);
        assert_eq!(b.events_complete, round == 2);
        assert!(
            a.sent_facts > 0 && a.received_facts > 0,
            "neither direction may starve"
        );
    }
    assert_facts(&r.a, r.p, &expected);
    assert_facts(&r.b, r.p, &expected);
    assert_eq!(receipt_count(&r.a), 251);
    assert_eq!(receipt_count(&r.b), 251);
    let (a, b) = exchange(&r, options).await;
    assert!(a.events_complete && b.events_complete);
    assert_eq!(
        a.sent_facts + a.received_facts + b.sent_facts + b.received_facts,
        0
    );
    assert_facts(&r.a, r.p, &expected);
    assert_facts(&r.b, r.p, &expected);
    stop(r.a).await;
    stop(r.b).await;
}

fn seed_large(host: &BetaHost, p: ProfileId) -> Vec<exomind_core::OriginalRef> {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(p).unwrap();
    let mut originals = vec![];
    for _ in 0..256 {
        let stage = StageId::new();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id: stage,
                original_id: OriginalId::new(),
                profile_id: p,
                expected_sha256: format!("{:x}", Sha256::digest([])),
                byte_length: 0,
                file_name: "\"".repeat(1024),
                media_type: "\"".repeat(256),
            },
        )
        .unwrap();
        let proof = core
            .freeze_stage(&human, stage)
            .unwrap()
            .verify(|| false)
            .unwrap();
        originals.push(core.finish_stage(&human, &proof).unwrap().original);
    }
    core.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1000,
            text: "\u{1}".repeat(128 * 1024),
            tags: vec![],
            originals: originals.clone(),
        },
    )
    .unwrap();
    originals
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legal_large_facts_cross_both_wire_directions_without_pretending_original_bytes_arrived() {
    let r = rig().await;
    let originals_a = seed_large(&r.a, r.p);
    let originals_b = seed_large(&r.b, r.p);
    let mut expected = facts(&r.a, r.p);
    expected.extend(facts(&r.b, r.p));
    assert!(expected.values().next().unwrap().len() > 1024 * 1024);
    let (a, b) = exchange(&r, PeerSyncOptions::default()).await;
    assert!(a.events_complete && b.events_complete);
    assert!(a.peer_missing_originals && b.local_missing_originals);
    assert!(a.local_missing_originals && b.peer_missing_originals);
    assert_facts(&r.a, r.p, &expected);
    assert_facts(&r.b, r.p, &expected);
    assert_eq!(receipt_count(&r.a), 1);
    assert_eq!(receipt_count(&r.b), 1);
    for (host, originals) in [(&r.a, originals_b), (&r.b, originals_a)] {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(r.p).unwrap();
        for original in originals {
            assert!(matches!(
                core.original_availability(&human, r.p, original.original_id)
                    .unwrap(),
                exomind_core::OriginalAvailability::Missing { .. }
            ));
        }
    }
    stop(r.a).await;
    stop(r.b).await;
}

async fn manual_hello(
    r: &Rig,
) -> (
    PeerTransportListener,
    SessionIo,
    PeerProfileScope,
    tokio::task::JoinHandle<Result<PeerSyncResult, HostError>>,
    SourceCatalog,
) {
    let mut listening = listener(&r.b, &r.ob).await;
    let (io, scope, serving, remote) = manual_session(r, &mut listening).await;
    (listening, io, scope, serving, remote)
}
async fn manual_session(
    r: &Rig,
    listening: &mut PeerTransportListener,
) -> (
    SessionIo,
    PeerProfileScope,
    tokio::task::JoinHandle<Result<PeerSyncResult, HostError>>,
    SourceCatalog,
) {
    let (c, s) = connect(&r.a, &r.oa, &r.b, &r.ob, listening).await;
    let scope = r.a.peer_profile_scope(&c, r.p, r.b.device_id).unwrap();
    let own = r.a.peer_origin_state(&c, &scope).unwrap();
    let target = r.b.clone();
    let serving = tokio::spawn(async move {
        target
            .accept_peer_profile_sync_over_transport(s, PeerSyncOptions::default())
            .await
    });
    let options = PeerSyncOptions::default();
    let mut io = SessionIo {
        framed: FramedPeerChannel::new(c),
        cancel: PeerCancellation::new(),
        end: Instant::now() + options.session_timeout,
        options,
    };
    io.send(&Message::Hello {
        runtime_id: r.a.runtime_id,
        protocol: PROTOCOL.into(),
        schema: CORE_SCHEMA_VERSION,
        profile_id: r.p,
        device_id: r.a.device_id,
        origin: Some(own),
        permissions: PeerSyncPermissions {
            send: true,
            receive: true,
        },
    })
    .await
    .unwrap();
    assert!(matches!(io.read().await.unwrap(), Message::Welcome { .. }));
    let catalog = io.domain(|c| r.a.peer_source_catalog(c, &scope)).unwrap();
    io.send(&Message::Inventory { catalog }).await.unwrap();
    let remote = match io.read().await.unwrap() {
        Message::Inventory { catalog } => catalog,
        _ => panic!("source inventory"),
    };
    (io, scope, serving, remote)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_in_flight_old_cursor_is_not_a_reset_after_a_concurrent_session_advances_the_ack() {
    let r = rig().await;
    seed(&r.b, r.p, 5, "concurrent cursor", false);
    let (mut listening, mut old_io, scope, old_serving, remote) = manual_hello(&r).await;
    let source = remote
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.b.device_id)
        .unwrap();
    let old_position = old_io
        .domain(|c| r.a.peer_source_cursor(c, &scope, source))
        .unwrap();
    assert_eq!(old_position.data.seq, 0);
    let (c, s) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
    let target = r.b.clone();
    let concurrent = tokio::spawn(async move {
        target
            .accept_peer_profile_sync_over_transport(s, PeerSyncOptions::default())
            .await
    });
    let result =
        r.a.synchronize_peer_profile_over_transport(
            &r.oa,
            r.p,
            r.b.device_id,
            c,
            PeerSyncOptions::default(),
        )
        .await
        .unwrap();
    assert!(result.events_complete);
    concurrent.await.unwrap().unwrap();
    old_io
        .send(&Message::SourceQuery {
            origin: source.origin.clone(),
            query: page_query(
                old_position.verified.clone(),
                source.available_head.clone(),
                DEFAULT_ORIGIN_PAGE_BYTES,
            ),
            receiver: old_position.clone(),
        })
        .await
        .unwrap();
    let accepted = matches!(old_io.read().await, Ok(Message::SourcePage { .. }));
    drop(old_io);
    assert!(old_serving.await.unwrap().is_err());
    // A fresh session must still reject the same old cursor against the
    // already durable highwater. Only the genuinely in-flight request above
    // may use the earlier captured baseline.
    let (mut fresh_io, _scope, fresh_serving, fresh_remote) =
        manual_session(&r, &mut listening).await;
    let fresh = fresh_remote
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.b.device_id)
        .unwrap();
    fresh_io
        .send(&Message::SourceQuery {
            origin: fresh.origin.clone(),
            query: page_query(
                old_position.verified.clone(),
                fresh.available_head.clone(),
                DEFAULT_ORIGIN_PAGE_BYTES,
            ),
            receiver: old_position,
        })
        .await
        .unwrap();
    let rejected = matches!(fresh_io.read().await, Err(HostError::PeerSyncResetRequired));
    drop(fresh_io);
    assert!(fresh_serving.await.unwrap().is_err());
    drop(listening);
    assert_facts(&r.a, r.p, &facts(&r.b, r.p));
    assert_eq!(receipt_count(&r.a), 0);
    assert_eq!(receipt_count(&r.b), 5);
    stop(r.a).await;
    stop(r.b).await;
    assert!(
        rejected,
        "a new session may not reset an already persisted data ACK"
    );
    assert!(
        accepted,
        "a later global ACK must not reinterpret this request's older in-flight cursor as rollback"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_application_ack_after_target_commit_recovers_after_both_hosts_restart() {
    let r = rig().await;
    seed(&r.a, r.p, 1, "lost ACK", false);
    let expected = facts(&r.a, r.p);
    let (listening, mut io, scope, serving, _remote) = manual_hello(&r).await;
    let own = io.domain(|c| r.a.peer_origin_state(c, &scope)).unwrap();
    let baseline = io
        .domain(|c| r.a.peer_ack_baseline(c, &scope, &own.origin))
        .unwrap();
    assert!(baseline.cursor().is_none());
    let catalog = io.domain(|c| r.a.peer_source_catalog(c, &scope)).unwrap();
    let source = catalog
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.a.device_id)
        .unwrap();
    let signed = io
        .domain(|c| {
            r.a.peer_export_source_page(
                c,
                &scope,
                source,
                &OriginPageQuery {
                    through: Some(source.available_head.clone()),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    io.send(&Message::SourceOfferPage { signed }).await.unwrap();
    assert!(matches!(
        io.read().await.unwrap(),
        Message::SourceApplied { .. }
    ));
    // Discard the delivered response before the source persists its ACK. The
    // target has already committed the complete page and receive cursor.
    assert!(
        io.domain(|c| r.a.peer_ack_baseline(c, &scope, &own.origin))
            .unwrap()
            .cursor()
            .is_none()
    );
    drop(io);
    assert!(serving.await.unwrap().is_err());
    drop(listening);
    assert_facts(&r.b, r.p, &expected);
    assert_eq!(receipt_count(&r.b), 0);
    stop(r.a).await;
    stop(r.b).await;
    let (a, oa) = open(&r.ra);
    let (b, ob) = open(&r.rb);
    let restored = Rig {
        ra: r.ra,
        rb: r.rb,
        a,
        b,
        oa,
        ob,
        p: r.p,
    };
    let (a, b) = exchange(&restored, PeerSyncOptions::default()).await;
    assert!(a.events_complete && b.events_complete);
    assert_eq!(a.sent_facts, 0);
    assert_facts(&restored.a, restored.p, &expected);
    assert_facts(&restored.b, restored.p, &expected);
    assert_eq!(receipt_count(&restored.b), 0);
    stop(restored.a).await;
    stop(restored.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn revocation_after_hello_blocks_the_in_flight_page_before_any_core_commit() {
    let r = rig().await;
    seed(&r.a, r.p, 1, "must not arrive", false);
    let (listening, mut io, scope, serving, _remote) = manual_hello(&r).await;
    let member =
        r.b.peer_members(&r.ob, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.a.device_id)
            .unwrap();
    r.b.revoke_peer_member(&r.ob, r.p, r.a.device_id, member.generation)
        .unwrap();
    let catalog = io.domain(|c| r.a.peer_source_catalog(c, &scope)).unwrap();
    let source = catalog
        .sources
        .iter()
        .find(|s| s.origin.device_id == r.a.device_id)
        .unwrap();
    let signed = io
        .domain(|c| {
            r.a.peer_export_source_page(
                c,
                &scope,
                source,
                &OriginPageQuery {
                    through: Some(source.available_head.clone()),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    io.send(&Message::SourceOfferPage { signed }).await.unwrap();
    assert!(matches!(
        io.read().await,
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        serving.await.unwrap(),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(facts(&r.b, r.p).is_empty());
    assert_eq!(receipt_count(&r.b), 0);
    drop(io);
    drop(listening);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropping_the_public_sync_future_cancels_and_drains_its_blocking_session() {
    let r = rig().await;
    seed(&r.a, r.p, 1, "cancel", false);
    let mut listening = listener(&r.b, &r.ob).await;
    let (client, server) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
    let source = r.a.clone();
    let owner = r.oa.clone();
    let profile = r.p;
    let peer = r.b.device_id;
    let task = tokio::spawn(async move {
        source
            .synchronize_peer_profile_over_transport(
                &owner,
                profile,
                peer,
                client,
                PeerSyncOptions::default(),
            )
            .await
    });
    let mut stalled = FramedPeerChannel::new(server);
    let hello = stalled
        .receive(Duration::from_secs(3), std::future::pending())
        .await
        .unwrap();
    assert!(matches!(
        serde_json::from_slice::<Message>(&hello).unwrap(),
        Message::Hello { .. }
    ));
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    // The peer receives closure, and Host stop must wait for this session's
    // registered blocking owner rather than release the root while it lingers.
    assert!(
        stalled
            .receive(Duration::from_secs(3), std::future::pending())
            .await
            .is_err()
    );
    let source = r.a.clone();
    tokio::task::spawn_blocking(move || source.stop_with_timeout(Duration::from_secs(2)))
        .await
        .unwrap()
        .unwrap();
    let reopened = BetaHost::open(r.ra.path()).unwrap();
    assert_eq!(reopened.device_id, r.a.device_id);
    reopened.stop().unwrap();
    drop(stalled);
    drop(listening);
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn core8_sync_hello_is_rejected_before_core10_fact_exchange() {
    assert_old_core_schema_hello_rejected(8).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn core9_sync_hello_is_rejected_before_core10_fact_exchange() {
    assert_old_core_schema_hello_rejected(9).await;
}

async fn assert_old_core_schema_hello_rejected(schema: i64) {
    let r = rig().await;
    assert_eq!(CORE_SCHEMA_VERSION, 10);
    let mut listening = listener(&r.b, &r.ob).await;
    let (client, server) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
    let target = r.b.clone();
    let options = PeerSyncOptions::default();
    let serving = tokio::spawn(async move {
        target
            .accept_peer_profile_sync_over_transport(server, options)
            .await
    });
    let mut io = SessionIo {
        framed: FramedPeerChannel::new(client),
        cancel: PeerCancellation::new(),
        end: Instant::now() + options.session_timeout,
        options,
    };

    // Core8 understands the existing fact variants, but not correction/1.
    // The real sync Hello schema gate must reject it before any facts can flow.
    io.send(&Message::Hello {
        runtime_id: r.a.runtime_id,
        protocol: PROTOCOL.into(),
        schema,
        profile_id: r.p,
        device_id: r.a.device_id,
        origin: None,
        permissions: PeerSyncPermissions {
            send: true,
            receive: true,
        },
    })
    .await
    .unwrap();

    assert!(matches!(
        io.read().await,
        Err(HostError::PeerProtocolMismatch)
    ));
    assert!(matches!(
        serving.await.unwrap(),
        Err(HostError::PeerProtocolMismatch)
    ));
    drop(io);
    drop(listening);
    stop(r.a).await;
    stop(r.b).await;
}
