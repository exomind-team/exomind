use super::*;
use crate::{
    CreatePeerInvitation, PeerCapabilities, PeerPin, PeerTransportListener, PeerTransportOptions,
};
use exomind_core::{AgentId, CaptureCommand, CommandId, EventId, OriginPageQuery};
use tempfile::{TempDir, tempdir};

struct Rig {
    ra: TempDir,
    rb: TempDir,
    a: Arc<BetaHost>,
    b: Arc<BetaHost>,
    oa: Session,
    ob: Session,
    p: ProfileId,
    original: OriginalRef,
}
fn open(root: &TempDir) -> (Arc<BetaHost>, Session) {
    let h = Arc::new(BetaHost::open(root.path()).unwrap());
    let o = h.owner_session().unwrap();
    (h, o)
}
fn transport() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(3),
        channel_lifetime: Duration::from_secs(180),
    }
}
async fn channels(
    a: &Arc<BetaHost>,
    oa: &Session,
    b: &Arc<BetaHost>,
    ob: &Session,
) -> (PeerTransportListener, PeerChannel, PeerChannel) {
    // This fixture replaces its own listener between finite sessions, unlike
    // the application controller's persistent listener. Drop requests async
    // cancellation; wait for the previous owned lease before binding another.
    let source = a.clone();
    tokio::task::spawn_blocking(move || source.peers.wait_empty(Duration::from_secs(3)))
        .await
        .unwrap()
        .unwrap();
    let mut listener = a
        .listen_peer_transport(oa, "127.0.0.1:0".parse().unwrap(), transport())
        .await
        .unwrap();
    let pin = PeerPin::from_sha256(&a.device_identity(oa).unwrap().fingerprint_sha256).unwrap();
    let client = b
        .connect_peer_transport(
            ob,
            listener.addr(),
            pin,
            transport(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let server = listener.accept(PeerCancellation::new()).await.unwrap();
    (listener, client, server)
}
fn seed(host: &BetaHost, p: ProfileId, bytes: &[u8], publish: bool) -> OriginalRef {
    let stage = StageId::new();
    let ticket = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(p).unwrap();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id: stage,
                original_id: OriginalId::new(),
                profile_id: p,
                expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                byte_length: bytes.len() as u64,
                file_name: "opaque.00ff.unknown".into(),
                media_type: "application/x-unknown".into(),
            },
        )
        .unwrap();
        for (i, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
            core.write_stage_chunk(&human, stage, (i * MAX_ORIGINAL_CHUNK_BYTES) as u64, chunk)
                .unwrap();
        }
        core.freeze_stage(&human, stage).unwrap()
    };
    let proof = ticket.verify(|| false).unwrap();
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(p).unwrap();
    let original = core.finish_stage(&human, &proof).unwrap().original;
    if publish {
        core.submit(
            &human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 1000,
                text: "original reference".into(),
                tags: vec![],
                originals: vec![original.clone()],
            },
        )
        .unwrap();
    }
    original
}
async fn rig(bytes: &[u8]) -> Rig {
    let ra = tempdir().unwrap();
    let rb = tempdir().unwrap();
    let (a, oa) = open(&ra);
    let (b, ob) = open(&rb);
    let p = ProfileId::new();
    a.provision_profile(&oa, p, "original transfer").unwrap();
    let (listener, client, server) = channels(&a, &oa, &b, &ob).await;
    let invitation = a
        .create_peer_invitation(
            &oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![listener.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let claim = b
        .prepare_peer_join(&ob, &invitation, Uuid::new_v4())
        .unwrap();
    let receipt = a.claim_peer_invitation_verified(&server, &claim).unwrap();
    let confirm = b.accept_peer_claim_verified(&client, &receipt).unwrap();
    let ready = a.confirm_peer_join_verified(&server, &confirm).unwrap();
    b.finish_peer_join_verified(&client, &ready).unwrap();
    a.acknowledge_peer_ready_verified(&server, &ready.acknowledgement().unwrap())
        .unwrap();
    drop(client);
    drop(server);
    drop(listener);
    let aa = a.clone();
    let bb = b.clone();
    tokio::task::spawn_blocking(move || {
        aa.peers.wait_empty(Duration::from_secs(3)).unwrap();
        bb.peers.wait_empty(Duration::from_secs(3)).unwrap();
    })
    .await
    .unwrap();
    let original = seed(&a, p, bytes, true);
    let page = {
        let state = a.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(p).unwrap(),
            p,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };
    {
        let state = b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(p, a.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
    }
    Rig {
        ra,
        rb,
        a,
        b,
        oa,
        ob,
        p,
        original,
    }
}
fn availability(host: &BetaHost, p: ProfileId, original: OriginalId) -> OriginalAvailability {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    core.original_availability(&core.local_human(p).unwrap(), p, original)
        .unwrap()
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
async fn exchange(
    r: &Rig,
    options: OriginalTransferOptions,
) -> (OriginalTransferResult, OriginalTransferResult) {
    let (listener, c, s) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
    let source = r.a.clone();
    let serving = tokio::spawn(async move {
        source
            .serve_peer_original_over_transport(s, scope, OriginalTransferOptions::default())
            .await
    });
    let result =
        r.b.download_peer_original_over_transport(
            &r.ob,
            r.p,
            r.a.device_id,
            r.original.original_id,
            c,
            options,
        )
        .await
        .unwrap();
    let source = serving.await.unwrap().unwrap();
    drop(listener);
    (result, source)
}
fn assert_no_fake_capture(r: &Rig) {
    for (host, expected_receipts) in [(&r.a, 1), (&r.b, 0)] {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let db = rusqlite::Connection::open(core.database_path()).unwrap();
        assert_eq!(
            db.query_row::<u64, _, _>("SELECT count(*) FROM events", [], |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row::<u64, _, _>("SELECT count(*) FROM command_receipts", [], |row| row
                .get(0))
                .unwrap(),
            expected_receipts
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_controller_explicit_original_fetch_is_verified_then_idle_and_offline_is_truthful() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes: Vec<u8> = (0..(MAX_ORIGINAL_CHUNK_BYTES * 2 + 713))
        .map(|i| ((i as u64 * 131 + 255) % 256) as u8)
        .collect();
    let r = rig(&bytes).await;
    let source = crate::PeerNetwork::new(r.a.clone(), r.oa.clone()).unwrap();
    let target = crate::PeerNetwork::new(r.b.clone(), r.ob.clone()).unwrap();
    source.set_enabled(true).await.unwrap();
    // Fetching an original respects the user's network preference; this
    // fixture explicitly enables BOTH controllers instead of implicit enable.
    target.set_enabled(true).await.unwrap();
    let address = source
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|a| a.ip().is_loopback())
        .unwrap();
    r.b.save_peer_routes(&r.ob, r.p, r.a.device_id, vec![address])
        .unwrap();
    let before = target.original_status(r.p, r.original.original_id).unwrap();
    assert_eq!(
        (
            before.availability,
            before.next_offset,
            before.transfer_state
        ),
        ("missing", 0, "idle")
    );
    let result = target
        .fetch_original(r.p, r.a.device_id, r.original.original_id, Uuid::new_v4())
        .await
        .unwrap();
    assert!(result.verified);
    assert_eq!(result.transferred_bytes, bytes.len() as u64);
    let ready = target.original_status(r.p, r.original.original_id).unwrap();
    assert_eq!(
        (ready.availability, ready.next_offset, ready.transfer_state),
        ("complete", bytes.len() as u64, "idle")
    );
    assert!(ready.request_id.is_none());
    let actual =
        r.b.peer_members(&r.ob, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.a.device_id)
            .unwrap();
    assert!(!actual.revoked);
    assert_no_fake_capture(&r);
    source.stop().await.unwrap();
    // An offline source never changes a missing reference into byte success.
    let missing = seed(&r.a, r.p, b"another original while source is offline", true);
    let page = {
        let state = r.a.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(r.p).unwrap(),
            r.p,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };
    {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(r.p, r.a.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
    }
    let error = target
        .fetch_original(r.p, r.a.device_id, missing.original_id, Uuid::new_v4())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        HostError::PeerTransportUnavailable | HostError::PeerTimeout
    ));
    let status = target.original_status(r.p, missing.original_id).unwrap();
    assert_eq!(
        (
            status.availability,
            status.next_offset,
            status.transfer_state
        ),
        ("missing", 0, "failed")
    );
    assert!(matches!(
        status.last_error_code,
        Some("unreachable" | "peer_timeout")
    ));
    assert!(status.request_id.is_none());
    target.stop().await.unwrap();
    drop(source);
    drop(target);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn physical_original_service_rejects_second_profile_after_sealing_header_scope() {
    let r = rig(b"sealed profile original").await;
    let (listener, client, server) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    r.b.select_peer_service(
        &r.ob,
        &client,
        crate::PeerServiceKind::Originals,
        Some(r.p),
        Some(r.a.device_id),
        0,
    )
    .await
    .unwrap();
    let source = r.a.clone();
    let owner = r.oa.clone();
    let serving = tokio::spawn(async move { source.accept_peer_service(&owner, server).await });
    client
        .send_frame(
            serde_json::to_vec(&Control::Start {
                protocol: PROTOCOL.into(),
                schema: exomind_core::CORE_SCHEMA_VERSION,
                profile_id: ProfileId::new(),
                expected: r.original.clone(),
                offset: 0,
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let response: Control = serde_json::from_slice(&client.read_frame().await.unwrap()).unwrap();
    assert!(matches!(
        response,
        Control::Rejected {
            code: Rejection::Denied
        }
    ));
    assert!(matches!(
        serving.await.unwrap(),
        Err(HostError::PeerMembershipDenied | HostError::Core(CoreError::ScopeMismatch))
    ));
    assert!(matches!(
        availability(&r.b, r.p, r.original.original_id),
        OriginalAvailability::Missing { .. }
    ));
    assert_no_fake_capture(&r);
    drop(client);
    drop(listener);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_tls_35_mib_original_resumes_same_stage_after_both_hosts_restart() {
    let bytes: Vec<_> = (0..35 * 1024 * 1024 + 137)
        .map(|i| (((i as u64) * 137 + i as u64 / 257) % 256) as u8)
        .collect();
    let r = rig(&bytes).await;
    assert!(matches!(
        availability(&r.b, r.p, r.original.original_id),
        OriginalAvailability::Missing { .. }
    ));
    let (partial, source) = exchange(
        &r,
        OriginalTransferOptions {
            max_chunks: 3,
            ..Default::default()
        },
    )
    .await;
    assert!(!partial.verified && !source.verified);
    assert_eq!(
        partial.transferred_bytes,
        3 * MAX_ORIGINAL_CHUNK_BYTES as u64
    );
    let before = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!("partial stage persisted"),
    };
    assert_eq!(before.state, StageState::Uploading);
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
    let (a, oa) = open(&r.ra);
    let (b, ob) = open(&r.rb);
    let r = Rig {
        ra: r.ra,
        rb: r.rb,
        a,
        b,
        oa,
        ob,
        p: r.p,
        original: r.original,
    };
    let (done, source) = exchange(&r, OriginalTransferOptions::default()).await;
    assert!(done.verified && source.verified);
    assert_eq!(done.resumed_from, before.next_offset);
    assert_eq!(
        done.transferred_bytes,
        bytes.len() as u64 - before.next_offset
    );
    let after = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!("verified original"),
    };
    assert_eq!(after.stage_id, before.stage_id);
    assert_eq!(after.state, StageState::Verified);
    {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(r.p).unwrap();
        let mut full = Sha256::new();
        for offset in (0..bytes.len()).step_by(MAX_ORIGINAL_CHUNK_BYTES) {
            let chunk = core
                .read_original_range(
                    &human,
                    r.p,
                    r.original.original_id,
                    offset as u64,
                    (bytes.len() - offset).min(MAX_ORIGINAL_CHUNK_BYTES),
                )
                .unwrap();
            assert!(chunk.bytes == bytes[offset..offset + chunk.bytes.len()]);
            full.update(&chunk.bytes);
        }
        assert_eq!(format!("{:x}", full.finalize()), r.original.sha256);
        assert!(
            core.missing_originals_page(&human, r.p, None, 100)
                .unwrap()
                .items
                .is_empty()
        );
    }
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
}

async fn manual(
    r: &Rig,
) -> (
    PeerTransportListener,
    Io,
    PeerProfileScope,
    Prepared,
    tokio::task::JoinHandle<Result<OriginalTransferResult, HostError>>,
) {
    let (listener, c, s) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope_source = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
    let target_scope = r.b.peer_profile_scope(&c, r.p, r.a.device_id).unwrap();
    let prepared =
        r.b.prepare_original(&c, &target_scope, r.original.original_id)
            .unwrap();
    let source = r.a.clone();
    let serving = tokio::spawn(async move {
        source
            .serve_peer_original_over_transport(s, scope_source, OriginalTransferOptions::default())
            .await
    });
    let options = OriginalTransferOptions::default();
    let mut io = Io {
        channel: c,
        cancel: PeerCancellation::new(),
        end: Instant::now() + options.session_timeout,
        options,
    };
    io.send(&Control::Start {
        protocol: PROTOCOL.into(),
        schema: exomind_core::CORE_SCHEMA_VERSION,
        profile_id: r.p,
        expected: r.original.clone(),
        offset: prepared.offset,
    })
    .await
    .unwrap();
    assert!(matches!(io.read().await.unwrap(), Control::Ready { .. }));
    (listener, io, target_scope, prepared, serving)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_chunk_ack_keeps_confirmed_offset_and_identical_retry_does_not_rewrite_it() {
    let bytes: Vec<_> = (0..2 * MAX_ORIGINAL_CHUNK_BYTES + 17)
        .map(|i| (i % 256) as u8)
        .collect();
    let r = rig(&bytes).await;
    let (listener, mut io, scope, prepared, serving) = manual(&r).await;
    io.send(&Control::Read {
        offset: 0,
        length: MAX_ORIGINAL_CHUNK_BYTES,
    })
    .await
    .unwrap();
    assert!(matches!(io.read().await.unwrap(), Control::Data { .. }));
    let chunk = io.raw().await.unwrap();
    assert!(chunk == bytes[..MAX_ORIGINAL_CHUNK_BYTES]);
    let next =
        r.b.materialize_write(&io.channel, &scope, &prepared, 0, &chunk)
            .unwrap();
    assert_eq!(next, MAX_ORIGINAL_CHUNK_BYTES as u64);
    let first = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!(),
    };
    r.b.materialize_write(&io.channel, &scope, &prepared, 0, &chunk)
        .unwrap();
    let retried = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!(),
    };
    assert_eq!(first, retried);
    drop(io);
    assert!(serving.await.unwrap().is_err());
    drop(listener);
    let (result, source) = exchange(&r, OriginalTransferOptions::default()).await;
    assert!(result.verified && source.verified);
    assert_eq!(result.resumed_from, next);
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_full_hash_never_becomes_ready_and_preserves_the_received_bytes() {
    let bytes = vec![0x00; MAX_ORIGINAL_CHUNK_BYTES + 17];
    let r = rig(&bytes).await;
    {
        let state = r.a.active_state().unwrap();
        let db = rusqlite::Connection::open(crate::resources(&state).unwrap().core.database_path())
            .unwrap();
        db.execute_batch("DROP TRIGGER original_chunks_no_update")
            .unwrap();
        let changed = vec![0xff; MAX_ORIGINAL_CHUNK_BYTES];
        db.execute(
            "UPDATE original_chunks SET bytes=?1,chunk_sha256=?2 WHERE offset=0",
            rusqlite::params![changed, format!("{:x}", Sha256::digest(&changed))],
        )
        .unwrap();
    }
    let (listener, c, s) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
    let source = r.a.clone();
    let serving = tokio::spawn(async move {
        source
            .serve_peer_original_over_transport(s, scope, OriginalTransferOptions::default())
            .await
    });
    assert!(matches!(
        r.b.download_peer_original_over_transport(
            &r.ob,
            r.p,
            r.a.device_id,
            r.original.original_id,
            c,
            OriginalTransferOptions::default()
        )
        .await,
        Err(HostError::Core(CoreError::OriginalHashMismatch))
    ));
    assert!(serving.await.unwrap().is_err());
    drop(listener);
    let stage = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!("retained mismatch"),
    };
    assert_eq!(stage.state, StageState::HashMismatch);
    assert_eq!(stage.next_offset, bytes.len() as u64);
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn source_revocation_between_chunks_prevents_any_verified_receipt() {
    let r = rig(&vec![0xff; 2 * MAX_ORIGINAL_CHUNK_BYTES]).await;
    let (listener, mut io, scope, prepared, serving) = manual(&r).await;
    io.send(&Control::Read {
        offset: 0,
        length: MAX_ORIGINAL_CHUNK_BYTES,
    })
    .await
    .unwrap();
    assert!(matches!(io.read().await.unwrap(), Control::Data { .. }));
    let bytes = io.raw().await.unwrap();
    let next =
        r.b.materialize_write(&io.channel, &scope, &prepared, 0, &bytes)
            .unwrap();
    io.send(&Control::Accepted { next_offset: next })
        .await
        .unwrap();
    let member =
        r.a.peer_members(&r.oa, r.p)
            .unwrap()
            .into_iter()
            .find(|m| m.device_id == r.b.device_id)
            .unwrap();
    r.a.revoke_peer_member(&r.oa, r.p, r.b.device_id, member.generation)
        .unwrap();
    io.send(&Control::Read {
        offset: next,
        length: MAX_ORIGINAL_CHUNK_BYTES,
    })
    .await
    .unwrap();
    assert!(matches!(
        io.read().await,
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(matches!(
        serving.await.unwrap(),
        Err(HostError::PeerMembershipDenied)
    ));
    drop(io);
    drop(listener);
    let stage = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!(),
    };
    assert_ne!(stage.state, StageState::Verified);
    assert_eq!(stage.next_offset, next);
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn verified_agent_owned_original_is_reused_without_impersonating_the_agent_or_writing_state()
{
    let bytes = vec![0x80; MAX_ORIGINAL_CHUNK_BYTES + 5];
    let r = rig(&bytes).await;
    let before = {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let agent = core.local_agent(r.p, AgentId::new()).unwrap();
        let id = StageId::new();
        core.begin_stage(
            &agent,
            &BeginStageCommand {
                stage_id: id,
                original_id: r.original.original_id,
                profile_id: r.p,
                expected_sha256: r.original.sha256.clone(),
                byte_length: r.original.byte_length,
                file_name: r.original.file_name.clone(),
                media_type: r.original.media_type.clone(),
            },
        )
        .unwrap();
        for (i, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
            core.write_stage_chunk(&agent, id, (i * MAX_ORIGINAL_CHUNK_BYTES) as u64, chunk)
                .unwrap();
        }
        let proof = core
            .freeze_stage(&agent, id)
            .unwrap()
            .verify(|| false)
            .unwrap();
        core.finish_stage(&agent, &proof).unwrap()
    };
    let (result, source) = exchange(&r, OriginalTransferOptions::default()).await;
    assert!(result.verified && source.verified);
    assert_eq!(result.transferred_bytes, 0);
    assert_eq!(result.resumed_from, bytes.len() as u64);
    let after = match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!(),
    };
    assert_eq!(before, after);
    assert_no_fake_capture(&r);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_original_is_actually_verified_and_source_private_or_wrong_profile_data_is_denied() {
    let r = rig(&[]).await;
    let (result, source) = exchange(&r, OriginalTransferOptions::default()).await;
    assert!(result.verified && source.verified);
    assert_eq!(result.transferred_bytes, 0);
    let private = seed(&r.a, r.p, b"private", false);
    let q = ProfileId::new();
    r.a.provision_profile(&r.oa, q, "Q").unwrap();
    let foreign = seed(&r.a, q, b"different profile", true);
    for expected in [private, foreign] {
        let (listener, c, s) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
        let scope = r.a.peer_profile_scope(&s, r.p, r.b.device_id).unwrap();
        let source = r.a.clone();
        let serving = tokio::spawn(async move {
            source
                .serve_peer_original_over_transport(s, scope, OriginalTransferOptions::default())
                .await
        });
        let options = OriginalTransferOptions::default();
        let mut io = Io {
            channel: c,
            cancel: PeerCancellation::new(),
            end: Instant::now() + options.session_timeout,
            options,
        };
        io.send(&Control::Start {
            protocol: PROTOCOL.into(),
            schema: exomind_core::CORE_SCHEMA_VERSION,
            profile_id: r.p,
            expected,
            offset: 0,
        })
        .await
        .unwrap();
        assert!(matches!(
            io.read().await,
            Err(HostError::PeerMembershipDenied)
        ));
        assert!(serving.await.unwrap().is_err());
        drop(io);
        drop(listener);
    }
    stop(r.a).await;
    stop(r.b).await;
}
