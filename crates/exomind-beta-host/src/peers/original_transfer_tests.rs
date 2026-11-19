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
fn change_intent(
    r: &Rig,
    suppression: Option<crate::OriginalAutoSuppression>,
) -> crate::OriginalLocalIntent {
    let prior =
        r.b.original_local_intent(&r.ob, r.p, r.original.original_id)
            .unwrap();
    r.b.configure_original_auto_suppression(
        &r.ob,
        r.p,
        r.original.original_id,
        &crate::OriginalAutoSuppressionCommand {
            command_id: Uuid::new_v4(),
            expected_intent_revision: prior.intent_revision,
            suppression,
        },
    )
    .unwrap()
}
fn stage_status(r: &Rig) -> exomind_core::StageStatus {
    match availability(&r.b, r.p, r.original.original_id) {
        OriginalAvailability::Local { stage } => stage,
        _ => panic!("expected a staged but not fabricated original"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn original_auto_queue_status_reads_without_changing_policy_or_transfer_state() {
    let r = rig(b"synthetic read-only original diagnostics").await;
    let peers = crate::PeerNetwork::new(r.b.clone(), r.ob.clone()).unwrap();
    let policy_before = r.b.original_auto_policy(&r.ob).unwrap();
    let intent_before =
        r.b.original_local_intent(&r.ob, r.p, r.original.original_id)
            .unwrap();
    let backoff_before =
        r.b.original_auto_backoff(&r.ob, r.p, r.original.original_id)
            .unwrap();

    for _ in 0..3 {
        let status = peers.original_auto_queue_status().unwrap();
        assert!(!status.network_enabled);
        assert_eq!(status.policy_enabled, policy_before.enabled);
        assert_eq!(status.active_outbound, 0);
        assert!(!status.deferred);
        assert!(status.last_error_code.is_none());
    }

    assert_eq!(r.b.original_auto_policy(&r.ob).unwrap(), policy_before);
    assert_eq!(
        r.b.original_local_intent(&r.ob, r.p, r.original.original_id)
            .unwrap(),
        intent_before
    );
    assert_eq!(
        r.b.original_auto_backoff(&r.ob, r.p, r.original.original_id)
            .unwrap(),
        backoff_before
    );
    assert!(matches!(
        availability(&r.b, r.p, r.original.original_id),
        OriginalAvailability::Missing { .. }
    ));
    stop(r.a).await;
    stop(r.b).await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn local_intent_is_rechecked_at_prepare_write_freeze_and_seal_without_erasing_suppression() {
    let bytes = b"synthetic frozen bytes\0\xff";
    let r = rig(bytes).await;
    let (listener, client, server) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope = r.b.peer_profile_scope(&client, r.p, r.a.device_id).unwrap();
    let cancel = PeerCancellation::new();
    let old = OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
        .unwrap();
    change_intent(&r, Some(crate::OriginalAutoSuppression::UserCancelled));
    assert!(matches!(
        r.b.prepare_original(&client, &scope, r.original.original_id, old, cancel.clone()),
        Err(HostError::PeerCancelled)
    ));
    assert!(
        matches!(
            availability(&r.b, r.p, r.original.original_id),
            OriginalAvailability::Missing { .. }
        ),
        "stale prepare created a stage"
    );
    let allowed =
        OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
            .unwrap();
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            allowed,
            cancel.clone(),
        )
        .unwrap();
    change_intent(&r, Some(crate::OriginalAutoSuppression::LocalReleased));
    assert!(matches!(
        r.b.materialize_write(&client, &scope, &prepared, 0, bytes),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).next_offset, 0);
    let oneoff =
        OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
            .unwrap();
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            oneoff,
            cancel.clone(),
        )
        .unwrap();
    r.b.materialize_write(&client, &scope, &prepared, 0, bytes)
        .unwrap();
    change_intent(&r, None);
    assert!(matches!(
        r.b.freeze_original(&client, &scope, &prepared),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).state, StageState::Uploading);
    let new = OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
        .unwrap();
    let prepared =
        r.b.prepare_original(&client, &scope, r.original.original_id, new, cancel.clone())
            .unwrap();
    let proof =
        r.b.freeze_original(&client, &scope, &prepared)
            .unwrap()
            .verify(|| false)
            .unwrap();
    let released = change_intent(&r, Some(crate::OriginalAutoSuppression::LocalReleased));
    assert!(matches!(
        r.b.seal_original(&client, &scope, &prepared, &proof),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).state, StageState::Frozen);
    // A NEW explicit manual action may use retained bytes, but cannot clear
    // the permanent auto suppression as an accidental success side effect.
    let oneoff =
        OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
            .unwrap();
    let prepared =
        r.b.prepare_original(&client, &scope, r.original.original_id, oneoff, cancel)
            .unwrap();
    r.b.seal_original(&client, &scope, &prepared, &proof)
        .unwrap();
    assert_eq!(stage_status(&r).state, StageState::Verified);
    assert_eq!(
        r.b.original_local_intent(&r.ob, r.p, r.original.original_id)
            .unwrap(),
        released
    );
    assert_no_fake_capture(&r);
    client.close().await.unwrap();
    server.close().await.unwrap();
    drop(listener);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_cancel_and_managed_epoch_are_final_gate_checks_not_only_outer_future_checks() {
    use crate::peers::original_admission::OriginalFetchMode;
    use std::sync::atomic::{AtomicU64, Ordering};
    let bytes = b"synthetic session fence";
    let r = rig(bytes).await;
    let mut settings = r.b.peer_network_settings(&r.ob).unwrap();
    settings.enabled = true;
    r.b.save_peer_network_settings(&r.ob, settings).unwrap();
    let (listener, client, server) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope = r.b.peer_profile_scope(&client, r.p, r.a.device_id).unwrap();
    let live = Arc::new(AtomicU64::new(1));
    let epoch = live.clone();
    let job_cancel = PeerCancellation::new();
    let admission = OriginalAdmission::managed(
        r.b.runtime_id,
        r.p,
        r.original.clone(),
        None,
        OriginalFetchMode::Manual,
        job_cancel,
        move || Ok(epoch.load(Ordering::SeqCst) == 1),
    );
    let session = PeerCancellation::new();
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            admission.clone(),
            session.clone(),
        )
        .unwrap();
    session.cancel();
    assert!(matches!(
        r.b.materialize_write(&client, &scope, &prepared, 0, bytes),
        Err(HostError::PeerCancelled)
    ));
    assert!(matches!(
        r.b.freeze_original(&client, &scope, &prepared),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).next_offset, 0);
    let session = PeerCancellation::new();
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            admission.clone(),
            session.clone(),
        )
        .unwrap();
    live.store(2, Ordering::SeqCst);
    assert!(matches!(
        r.b.materialize_write(&client, &scope, &prepared, 0, bytes),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).next_offset, 0);
    let epoch = live.clone();
    let admission = OriginalAdmission::managed(
        r.b.runtime_id,
        r.p,
        r.original.clone(),
        None,
        OriginalFetchMode::Manual,
        PeerCancellation::new(),
        move || Ok(epoch.load(Ordering::SeqCst) == 2),
    );
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            admission,
            session.clone(),
        )
        .unwrap();
    r.b.materialize_write(&client, &scope, &prepared, 0, bytes)
        .unwrap();
    let proof =
        r.b.freeze_original(&client, &scope, &prepared)
            .unwrap()
            .verify(|| false)
            .unwrap();
    session.cancel();
    assert!(matches!(
        r.b.seal_original(&client, &scope, &prepared, &proof),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).state, StageState::Frozen);
    assert_no_fake_capture(&r);
    client.close().await.unwrap();
    server.close().await.unwrap();
    drop(listener);
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_policy_revision_blocks_late_write_while_explicit_manual_remains_allowed() {
    use crate::peers::original_admission::OriginalFetchMode;
    let bytes = b"synthetic policy revision";
    let r = rig(bytes).await;
    let mut settings = r.b.peer_network_settings(&r.ob).unwrap();
    settings.enabled = true;
    r.b.save_peer_network_settings(&r.ob, settings).unwrap();
    let policy = r.b.original_auto_policy(&r.ob).unwrap();
    let (listener, client, server) = channels(&r.a, &r.oa, &r.b, &r.ob).await;
    let scope = r.b.peer_profile_scope(&client, r.p, r.a.device_id).unwrap();
    let cancel = PeerCancellation::new();
    let auto = OriginalAdmission::managed(
        r.b.runtime_id,
        r.p,
        r.original.clone(),
        None,
        OriginalFetchMode::Automatic {
            policy_revision: policy.revision,
        },
        cancel.clone(),
        || Ok(true),
    );
    let prepared =
        r.b.prepare_original(
            &client,
            &scope,
            r.original.original_id,
            auto,
            cancel.clone(),
        )
        .unwrap();
    r.b.configure_original_auto_policy(
        &r.ob,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: policy.revision,
            enabled: false,
            max_bytes: policy.max_bytes,
        },
    )
    .unwrap();
    assert!(matches!(
        r.b.materialize_write(&client, &scope, &prepared, 0, bytes),
        Err(HostError::PeerCancelled)
    ));
    assert_eq!(stage_status(&r).next_offset, 0);
    let manual =
        OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancel.clone())
            .unwrap();
    let prepared =
        r.b.prepare_original(&client, &scope, r.original.original_id, manual, cancel)
            .unwrap();
    r.b.materialize_write(&client, &scope, &prepared, 0, bytes)
        .unwrap();
    let proof =
        r.b.freeze_original(&client, &scope, &prepared)
            .unwrap()
            .verify(|| false)
            .unwrap();
    r.b.seal_original(&client, &scope, &prepared, &proof)
        .unwrap();
    assert_eq!(stage_status(&r).state, StageState::Verified);
    assert_no_fake_capture(&r);
    client.close().await.unwrap();
    server.close().await.unwrap();
    drop(listener);
    stop(r.a).await;
    stop(r.b).await;
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
async fn auto_controllers(
    r: &Rig,
    max_bytes: u64,
    source_hook: Option<Box<dyn FnOnce() + Send>>,
) -> (Arc<crate::PeerNetwork>, Arc<crate::PeerNetwork>) {
    for (host, owner) in [(&r.a, &r.oa), (&r.b, &r.ob)] {
        host.save_peer_network_settings(
            owner,
            crate::PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();
    }
    let source = crate::PeerNetwork::new(r.a.clone(), r.oa.clone()).unwrap();
    let target = crate::PeerNetwork::new(r.b.clone(), r.ob.clone()).unwrap();
    let prior = r.b.original_auto_policy(&r.ob).unwrap();
    r.b.configure_original_auto_policy(
        &r.ob,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: prior.revision,
            enabled: true,
            max_bytes,
        },
    )
    .unwrap();
    source.set_enabled(true).await.unwrap();
    if let Some(hook) = source_hook {
        source.source_hook_for_test(hook).await;
    }
    let endpoint = source
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|a| a.ip().is_loopback())
        .unwrap();
    r.b.save_peer_routes(&r.ob, r.p, r.a.device_id, vec![endpoint])
        .unwrap();
    target.set_enabled(true).await.unwrap();
    (source, target)
}
async fn wait_auto(stage: &str, mut ready: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(18);
    while !ready() {
        assert!(
            Instant::now() < end,
            "automatic original stage deadline: {stage}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
fn original_bytes(host: &BetaHost, p: ProfileId, id: OriginalId) -> Vec<u8> {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let writer = core.local_human(p).unwrap();
    let mut out = vec![];
    loop {
        let chunk = core
            .read_original_range(&writer, p, id, out.len() as u64, MAX_ORIGINAL_CHUNK_BYTES)
            .unwrap();
        if chunk.bytes.is_empty() {
            break;
        }
        out.extend(chunk.bytes);
        if out.len() as u64 == chunk.original.byte_length {
            break;
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_small_original_ignores_unprovable_unrelated_history() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes = b"known attachment remains independently retrievable\0\xff";
    let r = rig(bytes).await;
    let third_root = tempdir().unwrap();
    let (third, third_owner) = open(&third_root);
    third
        .provision_profile(&third_owner, r.p, "synthetic legacy source")
        .unwrap();
    seed(&third, r.p, b"unrelated legacy history", true);
    let page = {
        let state = third.active_state().unwrap();
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
        let context = core
            .trusted_replica_context(r.p, third.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
        assert!(
            core.verified_origin_state(&core.local_human(r.p).unwrap(), &page.origin)
                .unwrap()
                .is_none()
        );
    }
    let (source, target) = auto_controllers(&r, 1024 * 1024, None).await;
    let retrieved = tokio::time::timeout(Duration::from_secs(18), async {
        loop {
            if target
                .original_status(r.p, r.original.original_id)
                .is_ok_and(|s| s.availability == "complete")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok();
    if retrieved {
        assert_eq!(original_bytes(&r.b, r.p, r.original.original_id), bytes);
    }
    let status = target.status(r.p).unwrap();
    let carrier = status
        .peers
        .iter()
        .find(|peer| peer.device_id == r.a.device_id)
        .unwrap();
    assert!(
        carrier
            .history_gaps
            .iter()
            .any(|gap| gap.origin_device_id == third.device_id
                && gap.materialized_seq == page.through.seq
                && gap.available_seq.is_none())
    );
    source.stop().await.unwrap();
    target.stop().await.unwrap();
    stop(r.a).await;
    stop(r.b).await;
    stop(third).await;
    assert!(
        retrieved,
        "B14-S02: unrelated unsigned history must not block an authorized, referenced small original"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_small_originals_sync_both_directions_without_ui_and_keep_large_and_other_profile()
 {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes: Vec<u8> = (0..4097).map(|n| ((n * 131 + 255) % 256) as u8).collect();
    let r = rig(&bytes).await;
    let q = ProfileId::new();
    r.b.provision_profile(&r.ob, q, "untouched Q").unwrap();
    let q_original = seed(&r.b, q, b"Q must stay local", true);
    let (source, target) = auto_controllers(&r, 1024 * 1024, None).await;
    wait_auto("initial automatic verified", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|s| s.availability == "complete")
    })
    .await;
    assert_eq!(original_bytes(&r.b, r.p, r.original.original_id), bytes);
    let large = seed(&r.a, r.p, &vec![0xff; 1024 * 1024 + 1], true);
    let mut changes = target.subscribe_original_changes();
    let late = seed(&r.a, r.p, b"late automatic P bytes\0\xff", true);
    wait_auto("late metadata and automatic bytes", || {
        target
            .original_status(r.p, late.original_id)
            .is_ok_and(|s| s.availability == "complete")
    })
    .await;
    let changed = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let change = changes.recv().await.unwrap();
            if change.original_id == late.original_id {
                break change;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(changed.profile_id, r.p);
    wait_auto("large metadata available", || {
        target.original_status(r.p, large.original_id).is_ok()
    })
    .await;
    assert_eq!(
        target
            .original_status(r.p, large.original_id)
            .unwrap()
            .availability,
        "missing"
    );
    assert_eq!(
        original_bytes(&r.b, r.p, late.original_id),
        b"late automatic P bytes\0\xff"
    );
    let reverse = seed(&r.b, r.p, b"reverse own-origin bytes", true);
    wait_auto("reverse automatic verified", || {
        source
            .original_status(r.p, reverse.original_id)
            .is_ok_and(|s| s.availability == "complete")
    })
    .await;
    assert_eq!(
        original_bytes(&r.a, r.p, reverse.original_id),
        b"reverse own-origin bytes"
    );
    assert_eq!(
        original_bytes(&r.b, q, q_original.original_id),
        b"Q must stay local"
    );
    assert!(
        !r.a.profiles(&r.oa)
            .unwrap()
            .iter()
            .any(|p| p.profile_id == q)
    );
    assert!(target.original_auto_queue_status().unwrap().active_outbound <= 2);
    source.stop().await.unwrap();
    target.stop().await.unwrap();
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_original_yields_after_four_chunks_then_resumes_same_durable_stage() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes: Vec<u8> = (0..1024 * 1024 + 17)
        .map(|i| ((i as u64 * 131 + 255) % 256) as u8)
        .collect();
    let r = rig(&bytes).await;
    let (source, target) = auto_controllers(&r, 2 * 1024 * 1024, None).await;
    wait_auto("short sessions complete", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|s| s.availability == "complete")
    })
    .await;
    wait_auto("partial completion was consumed", || {
        target.auto_yields_for_test() > 0
    })
    .await;
    assert!(target.auto_yields_for_test() > 0);
    assert_eq!(original_bytes(&r.b, r.p, r.original.original_id), bytes);
    let stage = stage_status(&r);
    assert_eq!(stage.next_offset, bytes.len() as u64);
    {
        let state = r.b.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let db = rusqlite::Connection::open(core.database_path()).unwrap();
        assert_eq!(
            db.query_row::<u64, _, _>(
                "SELECT count(*) FROM original_stages WHERE original_id=?1",
                [r.original.original_id.to_string()],
                |row| row.get(0)
            )
            .unwrap(),
            1
        );
    }
    assert_no_fake_capture(&r);
    source.stop().await.unwrap();
    target.stop().await.unwrap();
    stop(r.a).await;
    stop(r.b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_cancel_is_durable_across_restart_and_manual_oneoff_does_not_clear_it() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let r = rig(b"cancelled auto file\0\xff").await;
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::sync_channel(1);
    let (source, target) = auto_controllers(
        &r,
        1024 * 1024,
        Some(Box::new(move || {
            entered.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(10))
                .expect("release automatic source fixture");
        })),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(18), ready)
        .await
        .expect("automatic source reached real worker")
        .unwrap();
    let active = target.original_status(r.p, r.original.original_id).unwrap();
    let request = active.request_id.expect("automatic job owns request UUID");
    assert!(
        target
            .cancel_original_and_wait(r.p, r.original.original_id, request)
            .await
            .unwrap()
    );
    release.send(()).unwrap();
    let intent =
        r.b.original_local_intent(&r.ob, r.p, r.original.original_id)
            .unwrap();
    assert_eq!(
        intent.suppression,
        Some(crate::OriginalAutoSuppression::UserCancelled)
    );
    let before = target
        .original_status(r.p, r.original.original_id)
        .unwrap()
        .next_offset;
    target.stop().await.unwrap();
    drop(target);
    stop(r.b.clone()).await;
    let reopened = Arc::new(BetaHost::open(r.rb.path()).unwrap());
    let owner = reopened.owner_session().unwrap();
    let target = crate::PeerNetwork::new(reopened.clone(), owner.clone()).unwrap();
    target.restore().await.unwrap();
    tokio::time::sleep(Duration::from_millis(4300)).await;
    assert_eq!(
        target
            .original_status(r.p, r.original.original_id)
            .unwrap()
            .next_offset,
        before
    );
    assert!(
        target
            .original_status(r.p, r.original.original_id)
            .unwrap()
            .request_id
            .is_none()
    );
    assert_eq!(
        reopened
            .original_local_intent(&owner, r.p, r.original.original_id)
            .unwrap(),
        intent
    );
    let result = target
        .fetch_original(r.p, r.a.device_id, r.original.original_id, Uuid::new_v4())
        .await
        .unwrap();
    assert!(result.verified);
    assert_eq!(
        reopened
            .original_local_intent(&owner, r.p, r.original.original_id)
            .unwrap(),
        intent,
        "manual success cannot clear permanent auto pause"
    );
    target.stop().await.unwrap();
    source.stop().await.unwrap();
    stop(reopened).await;
    stop(r.a).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automatic_runtime_rearms_saved_backoff_before_any_byte_session() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let r = rig(b"saved retry wait").await;
    let policy = r.b.original_auto_policy(&r.ob).unwrap();
    let mut settings = r.b.peer_network_settings(&r.ob).unwrap();
    settings.enabled = true;
    r.b.save_peer_network_settings(&r.ob, settings).unwrap();
    {
        let mut state = r.b.active_state().unwrap();
        let resources = state.resources.as_mut().unwrap();
        let tx =
            crate::peers::membership_store::transaction(&mut resources.persistence.auth).unwrap();
        for _ in 0..3 {
            crate::peers::original_auto_store::note_failure(
                &tx,
                r.p,
                r.original.original_id,
                "unreachable",
                r.original.byte_length,
                policy.revision,
                None,
            )
            .unwrap()
            .unwrap();
        }
        tx.commit().unwrap();
    }
    assert_eq!(
        r.b.original_auto_backoff(&r.ob, r.p, r.original.original_id)
            .unwrap()
            .delay_ms,
        8000
    );
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (source, target) = auto_controllers(
        &r,
        1024 * 1024,
        Some(Box::new(move || {
            entered.send(Instant::now()).unwrap();
        })),
    )
    .await;
    let returned = Instant::now();
    let first = tokio::time::timeout(Duration::from_secs(18), ready)
        .await
        .expect("delayed automatic session eventually starts")
        .unwrap();
    assert!(
        first.saturating_duration_since(returned) >= Duration::from_millis(7500),
        "restoration skipped/rearmed from an overdue wall timestamp"
    );
    wait_auto("backoff-delayed verified bytes", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|s| s.availability == "complete")
    })
    .await;
    assert_eq!(
        r.b.original_auto_backoff(&r.ob, r.p, r.original.original_id)
            .unwrap()
            .delay_ms,
        0
    );
    assert_no_fake_capture(&r);
    target.stop().await.unwrap();
    source.stop().await.unwrap();
    stop(r.a).await;
    stop(r.b).await;
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
    // This case verifies explicit acquisition; background-policy behavior has
    // its own real controller tests and must not race the manual preconditions.
    let policy = r.b.original_auto_policy(&r.ob).unwrap();
    r.b.configure_original_auto_policy(
        &r.ob,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: policy.revision,
            enabled: false,
            max_bytes: policy.max_bytes,
        },
    )
    .unwrap();
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
    let status = target.original_status(r.p, missing.original_id).unwrap();
    assert!(
        matches!(
            &error,
            HostError::PeerTransportUnavailable | HostError::PeerTimeout
        ),
        "offline fetch error={error:?}; local availability={} offset={} transfer={} status_error={:?}; source_addresses={} target_addresses={}; target_network_enabled={}",
        status.availability,
        status.next_offset,
        status.transfer_state,
        status.last_error_code,
        source.local_addresses().unwrap().len(),
        target.local_addresses().unwrap().len(),
        r.b.peer_network_settings(&r.ob).unwrap().enabled
    );
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
async fn incoming_source_scope_waits_for_real_blocking_worker_after_handler_abort() {
    let r = rig(b"synthetic source worker bytes\0\xff").await;
    let identity = r.a.device_identity(&r.oa).unwrap();
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
    let completion = TransferCompletion::new(|| {});
    completion.track_channel(&server).unwrap();
    let unrelated = r.a.peers.register(false).unwrap();
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::sync_channel(1);
    // This per-scope hook parks the ACTUAL source spawn_blocking closure,
    // after its owned completion and peer leases were installed. No gate or
    // another test's source worker is held by the hook.
    completion.set_source_hook(move || {
        entered.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(5))
            .expect("owned source fixture release");
    });
    let source = r.a.clone();
    let owner = r.oa.clone();
    let scope = completion.clone();
    let handler = tokio::spawn(async move {
        source
            .accept_peer_service_owned(&owner, server, Some(scope))
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), ready)
        .await
        .unwrap()
        .unwrap();
    handler.abort();
    assert!(matches!(handler.await,Err(error) if error.is_cancelled()));
    completion.close();
    let mut drain = Box::pin(completion.wait_closed(Duration::from_secs(2)));
    std::future::poll_fn(|cx| {
        assert!(
            std::future::Future::poll(drain.as_mut(), cx).is_pending(),
            "aborted handler falsely drained the blocked source worker"
        );
        std::task::Poll::Ready(())
    })
    .await;
    assert!(completion.state_for_test().1 > 0);
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), &mut drain)
        .await
        .unwrap()
        .unwrap();
    drop(drain);
    assert_eq!(completion.state_for_test(), (true, 0));
    assert!(
        matches!(
            availability(&r.b, r.p, r.original.original_id),
            OriginalAvailability::Missing { .. }
        ),
        "no source bytes/ACK were supplied; metadata must stay missing"
    );
    assert_no_fake_capture(&r);
    // The scope drained with a deliberately unrelated global peer lease held.
    assert!(r.a.peers.counts.lock().unwrap().jobs >= 1);
    drop(unrelated);
    client.close().await.unwrap();
    drop(listener);
    stop(r.a.clone()).await;
    stop(r.b.clone()).await;
    let reopened = BetaHost::open(r.ra.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        identity
    );
    reopened.stop().unwrap();
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
    let cancelled = PeerCancellation::new();
    let admission =
        OriginalAdmission::direct(&r.b, &r.ob, r.p, r.original.original_id, cancelled.clone())
            .unwrap();
    let prepared =
        r.b.prepare_original(
            &c,
            &target_scope,
            r.original.original_id,
            admission,
            cancelled.clone(),
        )
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
        cancel: cancelled,
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
