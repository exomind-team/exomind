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
                capabilities: PeerCapabilities::FULL,
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
    assert!(facts(host, profile) == *expected, "event IDs or canonical fact bytes differ");
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
async fn exchange(r: &Rig, options: PeerSyncOptions) -> (PeerSyncResult, PeerSyncResult) {
    let mut listening = listener(&r.b, &r.ob).await;
    let (c, s) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
    let target = r.b.clone();
    let serving = tokio::spawn(async move {
        target
            .accept_peer_profile_sync_over_transport(s, options)
            .await
    });
    let result =
        r.a.synchronize_peer_profile_over_transport(&r.oa, r.p, r.b.device_id, c, options)
            .await
            .unwrap();
    let other = serving.await.unwrap().unwrap();
    drop(listening);
    (result, other)
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
) {
    let mut listening = listener(&r.b, &r.ob).await;
    let (c, s) = connect(&r.a, &r.oa, &r.b, &r.ob, &mut listening).await;
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
        runtime_id:r.a.runtime_id,
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
    (listening, io, scope, serving)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_application_ack_after_target_commit_recovers_after_both_hosts_restart() {
    let r = rig().await;
    seed(&r.a, r.p, 1, "lost ACK", false);
    let expected = facts(&r.a, r.p);
    let (listening, mut io, scope, serving) = manual_hello(&r).await;
    let own = io.domain(|c| r.a.peer_origin_state(c, &scope)).unwrap();
    let baseline = io
        .domain(|c| r.a.peer_ack_baseline(c, &scope, &own.origin))
        .unwrap();
    assert!(baseline.cursor().is_none());
    let page = io
        .domain(|c| {
            r.a.peer_export_origin_page(c, &scope, &OriginPageQuery::default())
        })
        .unwrap();
    io.send(&Message::OfferPage { page }).await.unwrap();
    assert!(matches!(io.read().await.unwrap(), Message::Applied { .. }));
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
    let (listening, mut io, scope, serving) = manual_hello(&r).await;
    let member =
        r.b.peer_members(&r.ob, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.a.device_id)
            .unwrap();
    r.b.revoke_peer_member(&r.ob, r.p, r.a.device_id, member.generation)
        .unwrap();
    let page = io
        .domain(|c| {
            r.a.peer_export_origin_page(c, &scope, &OriginPageQuery::default())
        })
        .unwrap();
    io.send(&Message::OfferPage { page }).await.unwrap();
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
