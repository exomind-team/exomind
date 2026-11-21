use super::*;
use crate::{
    CreatePeerInvitation, PeerCapabilities, PeerPin, PeerTransportListener, PeerTransportOptions,
};
use exomind_core::{
    AgentId, CaptureCommand, CommandId, EventId, OriginalBytesState, OriginalLifecycleAction,
    OriginalLifecycleCommand, OriginPageQuery,
};
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

fn restore_command(r: &Rig) -> OriginalLifecycleCommand {
    let status = r
        .b
        .original_lifecycle_status(&r.ob, r.p, r.original.original_id)
        .unwrap();
    OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: r.p,
        original_id: r.original.original_id,
        expected_generation: status.local.generation,
        occurred_at_ms: 2_000,
        action: OriginalLifecycleAction::Restore,
        cleanup_confirmed: false,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    }
}

async fn restore_network_after_host_restart(
    r: &Rig,
    auto_enabled: bool,
    max_bytes: u64,
) -> (
    Arc<crate::PeerNetwork>,
    Arc<BetaHost>,
    Session,
    Arc<crate::PeerNetwork>,
) {
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
    let prior = r.b.original_auto_policy(&r.ob).unwrap();
    r.b.configure_original_auto_policy(
        &r.ob,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: prior.revision,
            enabled: auto_enabled,
            max_bytes,
        },
    )
    .unwrap();
    source.set_enabled(true).await.unwrap();
    let endpoint = source
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    r.b.save_peer_routes(&r.ob, r.p, r.a.device_id, vec![endpoint])
        .unwrap();
    r.b.save_peer_network_settings(
        &r.ob,
        crate::PeerNetworkSettings {
            enabled: true,
            preferred_port: 0,
        },
    )
    .unwrap();

    let command = restore_command(r);
    r.b.apply_original_lifecycle(&r.ob, &command).unwrap();
    let before_restart = r
        .b
        .original_lifecycle_status(&r.ob, r.p, r.original.original_id)
        .unwrap()
        .local;
    assert_eq!(
        before_restart.bytes_state,
        OriginalBytesState::RestorePending
    );
    assert_eq!(
        before_restart.restore_request_event_id,
        Some(command.event_id)
    );

    stop(r.b.clone()).await;
    let reopened = Arc::new(BetaHost::open(r.rb.path()).unwrap());
    let owner = reopened.owner_session().unwrap();
    let after_restart = reopened
        .original_lifecycle_status(&owner, r.p, r.original.original_id)
        .unwrap()
        .local;
    assert_eq!(
        after_restart.bytes_state,
        OriginalBytesState::RestorePending
    );
    assert_eq!(
        after_restart.restore_request_event_id,
        Some(command.event_id),
        "host restart must retain the Core restore request"
    );
    let target = crate::PeerNetwork::new(reopened.clone(), owner.clone()).unwrap();
    target.restore().await.unwrap();
    (source, reopened, owner, target)
}

async fn assert_restore_continues_without_a_view(
    bytes: &[u8],
    auto_enabled: bool,
    max_bytes: u64,
) {
    let r = rig(bytes).await;
    let (source, reopened, owner, target) =
        restore_network_after_host_restart(&r, auto_enabled, max_bytes).await;
    wait_auto("restore pending after host restart", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|status| status.availability == "complete")
    })
    .await;
    assert_eq!(
        original_bytes(&reopened, r.p, r.original.original_id),
        bytes
    );
    assert_eq!(
        reopened
            .original_lifecycle_status(&owner, r.p, r.original.original_id)
            .unwrap()
            .local
            .bytes_state,
        OriginalBytesState::Available
    );
    target.stop().await.unwrap();
    source.stop().await.unwrap();
    stop(reopened).await;
    stop(r.a).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_pending_resumes_after_host_restart_without_a_view_when_auto_policy_is_off() {
    let _discovery = crate::peers::test_discovery::lease().await;
    assert_restore_continues_without_a_view(
        b"explicit restore with auto policy off",
        false,
        1024 * 1024,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_pending_bypasses_auto_size_limit_after_host_restart_without_a_view() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes: Vec<_> = (0..1024 * 1024 + 1)
        .map(|index| ((index * 131 + 255) % 256) as u8)
        .collect();
    assert_restore_continues_without_a_view(&bytes, true, 1024 * 1024).await;
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
    let restore = restore_command(&r);
    r.b.apply_original_lifecycle(&r.ob, &restore).unwrap();
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
    let pending = reopened
        .original_lifecycle_status(&owner, r.p, r.original.original_id)
        .unwrap()
        .local;
    assert_eq!(pending.bytes_state, OriginalBytesState::RestorePending);
    assert_eq!(pending.restore_request_event_id, Some(restore.event_id));
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
    wait_auto("backoff-delayed settled original transfer", || {
        target
            .original_status(r.p, r.original.original_id)
            // Bytes may become complete while the automatic owner is still
            // confirming its durable retry bookkeeping. Idle has no request.
            .is_ok_and(|s| {
                s.availability == "complete"
                    && s.transfer_state == "idle"
                    && s.request_id.is_none()
            })
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

#[path = "original_transfer_lifecycle_red_tests.rs"]
mod lifecycle_red_tests;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_hash_mismatch_waits_for_host_retry_and_keeps_core_request_ids() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let bytes = b"restore hash retry keeps the original Core request";
    let r = rig(bytes).await;
    let command = restore_command(&r);
    r.b.apply_original_lifecycle(&r.ob, &command).unwrap();

    let corrupt = vec![0xff; bytes.len()];
    {
        let state = r.a.active_state().unwrap();
        let db = rusqlite::Connection::open(crate::resources(&state).unwrap().core.database_path())
            .unwrap();
        db.execute_batch("DROP TRIGGER original_chunks_no_update")
            .unwrap();
        db.execute(
            "UPDATE original_chunks SET bytes=?1,chunk_sha256=?2 WHERE offset=0",
            rusqlite::params![corrupt, format!("{:x}", Sha256::digest(&corrupt))],
        )
        .unwrap();
    }

    let (source, target) = auto_controllers(&r, 1024 * 1024, None).await;
    wait_auto("restore hash mismatch", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|status| status.availability == "hash_mismatch")
    })
    .await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let failed = target
        .original_status(r.p, r.original.original_id)
        .unwrap();
    assert_eq!(failed.availability, "hash_mismatch");
    assert!(
        failed.request_id.is_none(),
        "hash mismatch must stop background restore attempts"
    );
    let pending = r
        .b
        .original_lifecycle_status(&r.ob, r.p, r.original.original_id)
        .unwrap()
        .local;
    assert_eq!(pending.bytes_state, OriginalBytesState::RestorePending);
    assert_eq!(pending.restore_request_event_id, Some(command.event_id));

    target.stop().await.unwrap();
    source.stop().await.unwrap();
    {
        let state = r.a.active_state().unwrap();
        let db = rusqlite::Connection::open(crate::resources(&state).unwrap().core.database_path())
            .unwrap();
        db.execute(
            "UPDATE original_chunks SET bytes=?1,chunk_sha256=?2 WHERE offset=0",
            rusqlite::params![bytes, format!("{:x}", Sha256::digest(bytes))],
        )
        .unwrap();
    }

    let retry = r
        .b
        .retry_failed_original_restore(&r.ob, r.p, r.original.original_id)
        .unwrap();
    assert_eq!(retry.restore_request_event_id, command.event_id);
    assert_eq!(retry.restore_command_id, command.command_id);
    assert_eq!(retry.stage.state, StageState::Uploading);
    assert_eq!(retry.stage.next_offset, 0);

    source.restore().await.unwrap();
    target.restore().await.unwrap();
    wait_auto("explicit Host retry resumes the same restore", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|status| status.availability == "complete")
    })
    .await;
    assert_eq!(original_bytes(&r.b, r.p, r.original.original_id), bytes);
    assert_eq!(
        r.b.original_lifecycle_status(&r.ob, r.p, r.original.original_id)
            .unwrap()
            .local
            .bytes_state,
        OriginalBytesState::Available
    );
    target.stop().await.unwrap();
    source.stop().await.unwrap();
    stop(r.b).await;
    stop(r.a).await;
}

fn materialize_existing_original(
    host: &BetaHost,
    profile: ProfileId,
    original: &OriginalRef,
    bytes: &[u8],
) {
    assert_eq!(bytes.len() as u64, original.byte_length);
    assert_eq!(format!("{:x}", Sha256::digest(bytes)), original.sha256);
    let stage_id = StageId::new();
    let ticket = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(profile).unwrap();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id,
                original_id: original.original_id,
                profile_id: profile,
                expected_sha256: original.sha256.clone(),
                byte_length: original.byte_length,
                file_name: original.file_name.clone(),
                media_type: original.media_type.clone(),
            },
        )
        .unwrap();
        for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
            core.write_stage_chunk(
                &human,
                stage_id,
                (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
                chunk,
            )
            .unwrap();
        }
        core.freeze_stage(&human, stage_id).unwrap()
    };
    let proof = ticket.verify(|| false).unwrap();
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    assert_eq!(core.finish_stage(&human, &proof).unwrap().original, *original);
}

fn release_local_original(host: &BetaHost, owner: &Session, profile: ProfileId, original: OriginalId) {
    let local = host.original_lifecycle_status(owner, profile, original).unwrap().local;
    assert_eq!(local.bytes_state, OriginalBytesState::Available);
    host.apply_original_lifecycle(
        owner,
        &OriginalLifecycleCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            original_id: original,
            expected_generation: local.generation,
            occurred_at_ms: 3_000,
            action: OriginalLifecycleAction::ReleaseLocal,
            cleanup_confirmed: true,
            follow_up_device_ids: vec![],
            responds_to_event_id: None,
        },
    )
    .unwrap();
}

fn restore_command_for(
    host: &BetaHost,
    owner: &Session,
    profile: ProfileId,
    original: OriginalId,
) -> OriginalLifecycleCommand {
    let local = host.original_lifecycle_status(owner, profile, original).unwrap().local;
    OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        original_id: original,
        expected_generation: local.generation,
        occurred_at_ms: 4_000,
        action: OriginalLifecycleAction::Restore,
        cleanup_confirmed: false,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_retry_rotates_per_original_and_does_not_globally_defer_other_restores() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let first_bytes = b"first referenced original";
    let second_bytes = b"second referenced original";
    let r = rig(first_bytes).await;
    let second_original = seed(&r.a, r.p, second_bytes, true);

    let third_root = tempdir().unwrap();
    let (third, third_owner) = open(&third_root);
    third
        .provision_profile(&third_owner, r.p, "original transfer")
        .unwrap();
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
        let state = third.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(r.p, r.a.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
    }
    materialize_existing_original(&third, r.p, &r.original, first_bytes);
    materialize_existing_original(&third, r.p, &second_original, second_bytes);

    let (listener, client, server) = channels(&r.b, &r.ob, &third, &third_owner).await;
    let invitation = r
        .b
        .create_peer_invitation(
            &r.ob,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: r.p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![listener.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let claim = third
        .prepare_peer_join(&third_owner, &invitation, Uuid::new_v4())
        .unwrap();
    let receipt = r.b.claim_peer_invitation_verified(&server, &claim).unwrap();
    let confirmation = third
        .accept_peer_claim_verified(&client, &receipt)
        .unwrap();
    let ready = r
        .b
        .confirm_peer_join_verified(&server, &confirmation)
        .unwrap();
    third
        .finish_peer_join_verified(&client, &ready)
        .unwrap();
    r.b
        .acknowledge_peer_ready_verified(&server, &ready.acknowledgement().unwrap())
        .unwrap();
    drop(client);
    drop(server);
    drop(listener);
    let target_host = r.b.clone();
    let third_host = third.clone();
    tokio::task::spawn_blocking(move || {
        target_host.peers.wait_empty(Duration::from_secs(3)).unwrap();
        third_host.peers.wait_empty(Duration::from_secs(3)).unwrap();
    })
    .await
    .unwrap();

    let (metadata_id, metadata_host, metadata_owner, holder_id) =
        if r.a.device_id.to_string() < third.device_id.to_string() {
            (r.a.device_id, r.a.clone(), r.oa.clone(), third.device_id)
        } else {
            (third.device_id, third.clone(), third_owner.clone(), r.a.device_id)
        };
    let first_is_a = metadata_id == r.a.device_id;
    release_local_original(
        &metadata_host,
        &metadata_owner,
        r.p,
        r.original.original_id,
    );
    release_local_original(
        &metadata_host,
        &metadata_owner,
        r.p,
        second_original.original_id,
    );

    for (host, owner) in [(&r.a, &r.oa), (&r.b, &r.ob), (&third, &third_owner)] {
        host.save_peer_network_settings(
            owner,
            crate::PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();
    }
    let policy = r.b.original_auto_policy(&r.ob).unwrap();
    r.b.configure_original_auto_policy(
        &r.ob,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: policy.revision,
            enabled: false,
            max_bytes: 1024 * 1024,
        },
    )
    .unwrap();
    let source_a = crate::PeerNetwork::new(r.a.clone(), r.oa.clone()).unwrap();
    let source_third = crate::PeerNetwork::new(third.clone(), third_owner.clone()).unwrap();
    let target = crate::PeerNetwork::new(r.b.clone(), r.ob.clone()).unwrap();
    source_a.set_enabled(true).await.unwrap();
    source_third.set_enabled(true).await.unwrap();
    let endpoint_a = source_a
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let endpoint_third = source_third
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    r.b.save_peer_routes(&r.ob, r.p, r.a.device_id, vec![endpoint_a])
        .unwrap();
    r.b
        .save_peer_routes(&r.ob, r.p, third.device_id, vec![endpoint_third])
        .unwrap();

    target.set_enabled(true).await.unwrap();
    wait_auto("both ready sources finish metadata sync", || {
        target.status(r.p).is_ok_and(|status| {
            let ready = status
                .peers
                .iter()
                .filter(|peer| peer.member_state == "ready" && peer.event_sync == "complete")
                .collect::<Vec<_>>();
            ready.len() == 2
                && ready[0].device_id == metadata_id
                && ready[1].device_id == holder_id
        }) && target.original_status(r.p, second_original.original_id).is_ok()
    })
    .await;

    let metadata_network = if first_is_a {
        &source_a
    } else {
        &source_third
    };
    let (first_attempt, first_attempt_ready) = tokio::sync::oneshot::channel();
    metadata_network
        .source_hook_for_test(move || {
            let _ = first_attempt.send(());
        })
        .await;
    let first_restore = restore_command(&r);
    r.b.apply_original_lifecycle(&r.ob, &first_restore).unwrap();
    target.wake_original_restore_scan();
    tokio::time::timeout(Duration::from_secs(10), first_attempt_ready)
        .await
        .expect("the first metadata-only peer should receive the first restore attempt")
        .unwrap();
    wait_auto("first metadata-only attempt fails", || {
        target.original_status(r.p, r.original.original_id).is_ok_and(|status| {
            status.request_id.is_none() && status.last_error_code.is_some()
        })
    })
    .await;

    let (second_attempt, second_attempt_ready) = tokio::sync::oneshot::channel();
    metadata_network
        .source_hook_for_test(move || {
            let _ = second_attempt.send(());
        })
        .await;
    let second_restore = restore_command_for(
        &r.b,
        &r.ob,
        r.p,
        second_original.original_id,
    );
    r.b.apply_original_lifecycle(&r.ob, &second_restore).unwrap();
    tokio::time::timeout(Duration::from_millis(4_500), second_attempt_ready)
        .await
        .expect("one failed restore must not defer a different pending original")
        .unwrap();

    wait_auto("first restore rotates to the source with bytes", || {
        target
            .original_status(r.p, r.original.original_id)
            .is_ok_and(|status| status.availability == "complete")
    })
    .await;
    wait_auto("second restore rotates to the source with bytes", || {
        target
            .original_status(r.p, second_original.original_id)
            .is_ok_and(|status| status.availability == "complete")
    })
    .await;
    assert_eq!(original_bytes(&r.b, r.p, r.original.original_id), first_bytes);
    assert_eq!(
        original_bytes(&r.b, r.p, second_original.original_id),
        second_bytes
    );

    target.stop().await.unwrap();
    source_a.stop().await.unwrap();
    source_third.stop().await.unwrap();
    stop(r.a).await;
    stop(r.b).await;
    stop(third).await;
}

fn expected_manual_peer_shutdown(error: &crate::HostError) -> bool {
    matches!(
        error,
        crate::HostError::PeerCancelled
            | crate::HostError::PeerTransportUnavailable
            | crate::HostError::Stopped
    )
}

fn spawn_manual_peer_service(
    host: Arc<crate::BetaHost>,
    owner: crate::Session,
    mut listener: PeerTransportListener,
) -> (
    crate::PeerCancellation,
    tokio::task::JoinHandle<Result<(), crate::HostError>>,
) {
    let cancel = crate::PeerCancellation::new();
    let stop = cancel.clone();
    let task = tokio::spawn(async move {
        loop {
            match listener.accept(stop.clone()).await {
                Ok(channel) => {
                    if let Err(error) = host.accept_peer_service(&owner, channel).await {
                        if stop.is_cancelled() && expected_manual_peer_shutdown(&error) {
                            break;
                        }
                        return Err(error);
                    }
                }
                Err(crate::HostError::PeerTimeout | crate::HostError::PeerTls) => {}
                Err(error) if stop.is_cancelled() && expected_manual_peer_shutdown(&error) => break,
                Err(error) => return Err(error),
            }
        }
        Ok(())
    });
    (cancel, task)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_way_invitation_learns_return_route_and_auto_fetches_without_second_claim() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let tablet_root = tempdir().unwrap();
    let pc_root = tempdir().unwrap();
    let (tablet, tablet_owner) = open(&tablet_root);
    let (pc, pc_owner) = open(&pc_root);
    let profile = ProfileId::new();
    tablet
        .provision_profile(&tablet_owner, profile, "one-way original route")
        .unwrap();
    for (host, owner) in [(&tablet, &tablet_owner), (&pc, &pc_owner)] {
        host.save_peer_network_settings(
            owner,
            crate::PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();
    }

    // The inviter is a plain Host listener, with no discovery socket. The only
    // return address it can learn from this Join is the authenticated service
    // header's listener port paired with the observed TCP peer IP.
    let mut issuer_listener = tablet
        .listen_peer_transport(
            &tablet_owner,
            "127.0.0.1:0".parse().unwrap(),
            transport(),
        )
        .await
        .unwrap();
    let issuer_address = issuer_listener.addr();
    let invitation = tablet
        .create_peer_invitation(
            &tablet_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![issuer_address],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let accepting_host = tablet.clone();
    let accepting_owner = tablet_owner.clone();
    let accept = tokio::spawn(async move {
        let channel = issuer_listener
            .accept(crate::PeerCancellation::new())
            .await
            .unwrap();
        let tcp_source = channel.remote_address();
        let outcome = accepting_host
            .accept_peer_service(&accepting_owner, channel)
            .await
            .unwrap();
        (tcp_source, outcome)
    });

    let pc_network = crate::PeerNetwork::new(pc.clone(), pc_owner.clone()).unwrap();
    pc_network.set_enabled(true).await.unwrap();
    let pc_listener = pc_network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let joined = pc_network
        .join_with_route_for_test(&invitation, Uuid::new_v4(), Some(issuer_address))
        .await
        .unwrap();
    let (tcp_source, join_outcome) = tokio::time::timeout(Duration::from_secs(6), accept)
        .await
        .unwrap()
        .unwrap();
    let join_ready = joined.state == crate::PeerJoinState::Ready
        && matches!(
            join_outcome,
            crate::PeerServiceOutcome::Joined(status)
                if status.state == crate::PeerJoinState::Ready
        );

    let learned_endpoint = std::net::SocketAddr::new(tcp_source.ip(), pc_listener.port());
    let route_learned_from_join = tablet.peer_routes(&tablet_owner).unwrap().iter().any(|route| {
        route.profile == profile
            && route.device == pc.device_id
            && route.endpoints.contains(&learned_endpoint)
    });
    let listener_port_not_tcp_source_port =
        learned_endpoint.port() == pc_listener.port() && learned_endpoint.port() != tcp_source.port();

    let member_generation = |host: &crate::BetaHost, owner: &crate::Session, peer| {
        host.peer_members(owner, profile)
            .unwrap()
            .into_iter()
            .find(|member| member.device_id == peer)
            .map(|member| member.generation)
    };
    let generations_before = (
        member_generation(&tablet, &tablet_owner, pc.device_id),
        member_generation(&pc, &pc_owner, tablet.device_id),
    );

    let bytes: Vec<u8> = (0..64 * 1024)
        .map(|index| ((index * 131 + 17) % 256) as u8)
        .collect();
    let original = seed(&pc, profile, &bytes, true);
    let page = {
        let state = pc.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(profile).unwrap(),
            profile,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };
    {
        let state = tablet.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(profile, pc.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
    }
    let metadata_present = matches!(
        availability(&tablet, profile, original.original_id),
        OriginalAvailability::Missing { original: missing } if missing == original
    );

    let prior_policy = tablet.original_auto_policy(&tablet_owner).unwrap();
    tablet
        .configure_original_auto_policy(
            &tablet_owner,
            &crate::OriginalAutoPolicyCommand {
                command_id: Uuid::new_v4(),
                expected_revision: prior_policy.revision,
                enabled: true,
                max_bytes: 1024 * 1024,
            },
        )
        .unwrap();

    // End the Join controller and its stream before the download. The source
    // later serves on the learned listener port without a discovery publisher;
    // auto acquisition must open a fresh pinned TLS connection.
    pc_network.stop().await.unwrap();
    let source_listener = pc
        .listen_peer_transport(&pc_owner, learned_endpoint, transport())
        .await
        .unwrap();
    let (source_cancel, source_task) =
        spawn_manual_peer_service(pc.clone(), pc_owner.clone(), source_listener);
    let tablet_network = crate::PeerNetwork::new(tablet.clone(), tablet_owner.clone()).unwrap();
    tablet_network.set_enabled(true).await.unwrap();
    let retrieved = tokio::time::timeout(Duration::from_secs(18), async {
        loop {
            if tablet_network
                .original_status(profile, original.original_id)
                .is_ok_and(|status| status.availability == "complete")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok();
    let bytes_match = retrieved && original_bytes(&tablet, profile, original.original_id) == bytes;
    let policy_after = tablet.original_auto_policy(&tablet_owner).unwrap();
    let generations_after = (
        member_generation(&tablet, &tablet_owner, pc.device_id),
        member_generation(&pc, &pc_owner, tablet.device_id),
    );

    // Product outcomes above are captured before requesting expected shutdown.
    source_cancel.cancel();
    tablet_network.stop().await.unwrap();
    let source_server_error = match source_task.await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error.to_string()),
        Err(error) => Some(format!("manual service task join failed: {error}")),
    };
    drop((tablet_network, pc_network));
    stop(tablet).await;
    stop(pc).await;

    assert!(source_server_error.is_none(), "unexpected manual service failure: {source_server_error:?}");
    assert!(join_ready, "the single original invitation must establish a ready member");
    assert!(
        route_learned_from_join,
        "the invitee's authenticated listener address must be learned by the inviter"
    );
    assert!(
        listener_port_not_tcp_source_port,
        "the return route must use the advertised listener port, never the TCP source port"
    );
    assert!(
        metadata_present,
        "the test must expose the referenced original as metadata with missing local bytes"
    );
    assert!(
        retrieved,
        "a fresh auto-acquisition session must use the learned return route"
    );
    assert!(bytes_match, "the automatically fetched bytes must match the invited peer");
    assert_eq!(generations_after, generations_before, "route use must not rejoin or regrant");
    assert!(policy_after.enabled);
    assert_eq!(policy_after.max_bytes, 1024 * 1024);
}

fn spawn_proxy_for_join(
    listener: tokio::net::TcpListener,
    upstream_address: std::net::SocketAddr,
    cancel: crate::PeerCancellation,
) -> tokio::task::JoinHandle<Result<bool, std::io::Error>> {
    tokio::spawn(async move {
        let (mut downstream, _) = tokio::select! {
            _ = cancel.cancelled() => return Ok(false),
            accepted = listener.accept() => accepted?,
        };
        let socket = tokio::net::TcpSocket::new_v4()?;
        // The upstream side intentionally originates at the receiver's own
        // loopback IP; this is a Host TCP fixture, not a fake peer client.
        socket.bind("127.0.0.1:0".parse().unwrap())?;
        let mut upstream = socket.connect(upstream_address).await?;
        tokio::select! {
            _ = cancel.cancelled() => Ok(false),
            copied = tokio::io::copy_bidirectional(&mut downstream, &mut upstream) => {
                copied.map(|_| true)
            }
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn proxied_single_invitation_auto_fetches_through_authenticated_return_candidate() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let tablet_root = tempdir().unwrap();
    let pc_root = tempdir().unwrap();
    let (tablet, tablet_owner) = open(&tablet_root);
    let (pc, pc_owner) = open(&pc_root);
    let profile = ProfileId::new();
    tablet
        .provision_profile(&tablet_owner, profile, "proxied return route")
        .unwrap();

    let mut issuer_listener = tablet
        .listen_peer_transport(
            &tablet_owner,
            "127.0.0.1:0".parse().unwrap(),
            transport(),
        )
        .await
        .unwrap();
    let listen_port = issuer_listener.addr().port();
    let issuer_address = issuer_listener.addr();
    let pc_candidate: std::net::SocketAddr =
        format!("127.0.0.2:{listen_port}").parse().unwrap();
    // Fixture topology: two actual Host TLS listeners use different loopback
    // IPs and one port. The normal Join API sends only the current service /1
    // header; this expected-red case requires the peer candidate to be carried
    // in the authenticated service exchange, not guessed from the TCP source.
    let mut pc_listener = pc
        .listen_peer_transport(&pc_owner, pc_candidate, transport())
        .await
        .unwrap();
    for (host, owner) in [(&tablet, &tablet_owner), (&pc, &pc_owner)] {
        host.save_peer_network_settings(
            owner,
            crate::PeerNetworkSettings {
                enabled: false,
                preferred_port: listen_port,
            },
        )
        .unwrap();
    }
    let invitation = tablet
        .create_peer_invitation(
            &tablet_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![issuer_address],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();

    let proxy_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap();
    let proxy_address = proxy_listener.local_addr().unwrap();
    let proxy_cancel = crate::PeerCancellation::new();
    let mut proxy_task =
        spawn_proxy_for_join(proxy_listener, issuer_address, proxy_cancel.clone());

    let accepting_host = tablet.clone();
    let accepting_owner = tablet_owner.clone();
    let mut accept_task = tokio::spawn(async move {
        let channel = issuer_listener
            .accept(crate::PeerCancellation::new())
            .await?;
        let observed_source = channel.remote_address();
        let outcome = accepting_host
            .accept_peer_service(&accepting_owner, channel)
            .await?;
        Ok::<_, crate::HostError>((observed_source, outcome))
    });

    let claim_id = Uuid::new_v4();
    let issuer_pin =
        PeerPin::from_sha256(&tablet.device_identity(&tablet_owner).unwrap().fingerprint_sha256)
            .unwrap();
    let joiner_result = async {
        let channel = pc
            .connect_peer_transport(
                &pc_owner,
                proxy_address,
                issuer_pin,
                transport(),
                crate::PeerCancellation::new(),
            )
            .await?;
        pc.select_peer_service(
            &pc_owner,
            &channel,
            crate::PeerServiceKind::Join,
            None,
            None,
            listen_port,
        )
        .await?;
        pc.join_peer_profile_over_transport(&pc_owner, &invitation, claim_id, channel)
            .await
    }
    .await;
    let joiner_ready = joiner_result
        .as_ref()
        .is_ok_and(|status| status.state == crate::PeerJoinState::Ready && status.remote_ready_observed);
    let accept_result = tokio::time::timeout(Duration::from_secs(6), &mut accept_task).await;
    let mut observed_source = None;
    let mut inviter_ready = false;
    let accept_finished = match accept_result {
        Ok(Ok(Ok((observed, crate::PeerServiceOutcome::Joined(status))))) => {
            observed_source = Some(observed);
            inviter_ready = status.state == crate::PeerJoinState::Ready;
            true
        }
        Ok(Ok(Ok(_))) | Ok(Ok(Err(_))) | Ok(Err(_)) => true,
        Err(_) => false,
    };
    if !accept_finished {
        accept_task.abort();
        let _ = accept_task.await;
    }
    let proxy_completed = match tokio::time::timeout(Duration::from_secs(5), &mut proxy_task).await {
        Ok(Ok(Ok(forwarded))) => forwarded,
        Ok(Ok(Err(_))) | Ok(Err(_)) => false,
        Err(_) => {
            proxy_cancel.cancel();
            proxy_task.abort();
            let _ = proxy_task.await;
            false
        }
    };

    let observed_self = observed_source
        .is_some_and(|source| source.ip() == std::net::Ipv4Addr::LOCALHOST && source.port() != listen_port);
    let route_learned = tablet.peer_routes(&tablet_owner).unwrap().iter().any(|route| {
        route.profile == profile
            && route.device == pc.device_id
            && route.endpoints.contains(&pc_candidate)
    });
    let member_generation = |host: &crate::BetaHost, owner: &crate::Session, peer| {
        host.peer_members(owner, profile)
            .unwrap()
            .into_iter()
            .find(|member| member.device_id == peer)
            .map(|member| member.generation)
    };
    let generations_after_join = (
        member_generation(&tablet, &tablet_owner, pc.device_id),
        member_generation(&pc, &pc_owner, tablet.device_id),
    );

    // A direct pinned TLS handshake proves the source candidate is reachable.
    // No service header is selected, so this probe does not teach or persist it.
    let pc_pin =
        PeerPin::from_sha256(&pc.device_identity(&pc_owner).unwrap().fingerprint_sha256).unwrap();
    let (candidate_client, candidate_server) = tokio::join!(
        tablet.connect_peer_transport(
            &tablet_owner,
            pc_candidate,
            pc_pin,
            transport(),
            crate::PeerCancellation::new(),
        ),
        pc_listener.accept(crate::PeerCancellation::new())
    );
    let candidate_dialable = match candidate_client {
        Ok(channel) => channel.close().await.is_ok(),
        Err(_) => false,
    };
    let candidate_accepted = match candidate_server {
        Ok(channel) => channel.close().await.is_ok(),
        Err(_) => false,
    };

    let bytes: Vec<u8> = (0..64 * 1024)
        .map(|index| ((index * 131 + 29) % 256) as u8)
        .collect();
    let original = seed(&pc, profile, &bytes, true);
    let page = {
        let state = pc.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(profile).unwrap(),
            profile,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };
    {
        let state = tablet.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(profile, pc.device_id, page.origin.restoration_epoch, 1)
            .unwrap();
        core.import_origin_page(&context, &page).unwrap();
    }
    let metadata_missing_locally = matches!(
        availability(&tablet, profile, original.original_id),
        OriginalAvailability::Missing { original: missing } if missing == original
    );

    let prior_policy = tablet.original_auto_policy(&tablet_owner).unwrap();
    tablet
        .configure_original_auto_policy(
            &tablet_owner,
            &crate::OriginalAutoPolicyCommand {
                command_id: Uuid::new_v4(),
                expected_revision: prior_policy.revision,
                enabled: true,
                max_bytes: 1024 * 1024,
            },
        )
        .unwrap();
    tablet
        .save_peer_network_settings(
            &tablet_owner,
            crate::PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();

    let (source_cancel, source_task) =
        spawn_manual_peer_service(pc.clone(), pc_owner.clone(), pc_listener);
    let tablet_network = crate::PeerNetwork::new(tablet.clone(), tablet_owner.clone()).unwrap();
    tablet_network.set_enabled(true).await.unwrap();
    let auto_retrieved = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if tablet_network
                .original_status(profile, original.original_id)
                .is_ok_and(|status| status.availability == "complete")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok();
    let bytes_match = auto_retrieved
        && original_bytes(&tablet, profile, original.original_id) == bytes;
    let auto_queue = tablet_network.original_auto_queue_status().unwrap();
    let missing_route_wait_is_explained = auto_retrieved
        || (auto_queue.deferred && auto_queue.last_error_code == Some("original_source_waiting"));
    let route_learned_after_auto = tablet.peer_routes(&tablet_owner).unwrap().iter().any(|route| {
        route.profile == profile
            && route.device == pc.device_id
            && route.endpoints.contains(&pc_candidate)
    });
    let generations_after_auto = (
        member_generation(&tablet, &tablet_owner, pc.device_id),
        member_generation(&pc, &pc_owner, tablet.device_id),
    );

    // The Join stream and direct candidate probe have ended; the desired fetch
    // must be a new automatic TLS dial, and cleanup errors stay separately typed.
    source_cancel.cancel();
    tablet_network.stop().await.unwrap();
    let source_server_error = match source_task.await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error.to_string()),
        Err(error) => Some(format!("manual service task join failed: {error}")),
    };
    drop(tablet_network);
    stop(tablet).await;
    stop(pc).await;

    let behavior_passed = joiner_ready
        && inviter_ready
        && proxy_completed
        && observed_self
        && candidate_dialable
        && candidate_accepted
        && route_learned
        && route_learned_after_auto
        && metadata_missing_locally
        && auto_retrieved
        && bytes_match
        && missing_route_wait_is_explained
        && generations_after_auto == generations_after_join
        && source_server_error.is_none();
    assert!(
        behavior_passed,
        "one signed Join through a self-addressing byte proxy must publish a bounded return candidate and auto-fetch over a fresh pinned TLS session without regrant; joiner_ready={joiner_ready}, inviter_ready={inviter_ready}, proxy_completed={proxy_completed}, observed_self={observed_self}, candidate_dialable={candidate_dialable}, route_after_join={route_learned}, metadata_missing={metadata_missing_locally}, auto_retrieved={auto_retrieved}, bytes_match={bytes_match}, queue={auto_queue:?}, route_after_auto={route_learned_after_auto}, wait_explained={missing_route_wait_is_explained}, generations={generations_after_join:?}->{generations_after_auto:?}, service_error={source_server_error:?}"
    );
}
