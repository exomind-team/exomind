use super::*;
use crate::{
    CreatePeerInvitation, PeerCancellation, PeerTransportListener, PeerTransportOptions, Session,
};
use exomind_core::{BeginStageCommand, CaptureCommand, CommandId, EventId, StageId};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tempfile::{TempDir, tempdir};

struct Pair {
    _a_root: TempDir,
    _b_root: TempDir,
    a: Arc<BetaHost>,
    b: Arc<BetaHost>,
    owner_a: Session,
    owner_b: Session,
    profile: ProfileId,
    listener: PeerTransportListener,
    incoming: Arc<PeerChannel>,
    outgoing: Arc<PeerChannel>,
}
async fn pair(capabilities: PeerCapabilities) -> Pair {
    let a_root = tempdir().unwrap();
    let b_root = tempdir().unwrap();
    let a = Arc::new(BetaHost::open(a_root.path()).unwrap());
    let b = Arc::new(BetaHost::open(b_root.path()).unwrap());
    let owner_a = a.owner_session().unwrap();
    let owner_b = b.owner_session().unwrap();
    let profile = ProfileId::new();
    a.provision_profile(&owner_a, profile, "peer authority")
        .unwrap();
    let mut listener = a
        .listen_peer_transport(
            &owner_a,
            "127.0.0.1:0".parse().unwrap(),
            PeerTransportOptions::default(),
        )
        .await
        .unwrap();
    let invitation = a
        .create_peer_invitation(
            &owner_a,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities,
                candidates: vec![listener.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let pin = PeerPin::from_sha256(&invitation.offer.issuer.fingerprint_sha256).unwrap();
    let outgoing = Arc::new(
        b.connect_peer_transport(
            &owner_b,
            listener.addr(),
            pin,
            PeerTransportOptions::default(),
            PeerCancellation::new(),
        )
        .await
        .unwrap(),
    );
    let incoming = Arc::new(listener.accept(PeerCancellation::new()).await.unwrap());
    let claim = b
        .prepare_peer_join(&owner_b, &invitation, Uuid::new_v4())
        .unwrap();
    let receipt = a.claim_peer_invitation_verified(&incoming, &claim).unwrap();
    let confirmation = b.accept_peer_claim_verified(&outgoing, &receipt).unwrap();
    let ready = a
        .confirm_peer_join_verified(&incoming, &confirmation)
        .unwrap();
    b.finish_peer_join_verified(&outgoing, &ready).unwrap();
    a.acknowledge_peer_ready_verified(&incoming, &ready.acknowledgement().unwrap())
        .unwrap();
    Pair {
        _a_root: a_root,
        _b_root: b_root,
        a,
        b,
        owner_a,
        owner_b,
        profile,
        listener,
        incoming,
        outgoing,
    }
}
async fn stop(pair: Pair) {
    drop(pair.incoming);
    drop(pair.outgoing);
    drop(pair.listener);
    tokio::task::spawn_blocking(move || {
        pair.a.stop().unwrap();
        pair.b.stop().unwrap();
    })
    .await
    .unwrap();
}
fn seed_original(
    host: &BetaHost,
    profile: ProfileId,
    bytes: &[u8],
    referenced: bool,
) -> OriginalId {
    let stage = StageId::new();
    let original = OriginalId::new();
    let ticket = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(profile).unwrap();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id: stage,
                original_id: original,
                profile_id: profile,
                expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                byte_length: bytes.len() as u64,
                file_name: "arbitrary.peer-original".into(),
                media_type: "application/octet-stream".into(),
            },
        )
        .unwrap();
        for (index, chunk) in bytes
            .chunks(exomind_core::MAX_ORIGINAL_CHUNK_BYTES)
            .enumerate()
        {
            core.write_stage_chunk(
                &human,
                stage,
                (index * exomind_core::MAX_ORIGINAL_CHUNK_BYTES) as u64,
                chunk,
            )
            .unwrap();
        }
        core.freeze_stage(&human, stage).unwrap()
    };
    let proof = ticket.verify(|| false).unwrap();
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    let verified = core.finish_stage(&human, &proof).unwrap();
    if referenced {
        core.submit(
            &human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                occurred_at_ms: 1000,
                text: "referenced original".into(),
                tags: vec![],
                originals: vec![verified.original],
            },
        )
        .unwrap();
    }
    original
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_original_reads_require_this_profile_reference_and_capability() {
    let pair = pair(PeerCapabilities::FULL).await;
    let bytes: Vec<_> = (0..262281).map(|n| (n % 256) as u8).collect();
    let published = seed_original(&pair.a, pair.profile, &bytes, true);
    let private = seed_original(&pair.a, pair.profile, &bytes, false);
    let q = ProfileId::new();
    pair.a
        .provision_profile(&pair.owner_a, q, "separate Q")
        .unwrap();
    let foreign = seed_original(&pair.a, q, &bytes, true);
    let remote = pair.b.status().unwrap().device_id;
    let scope = pair
        .a
        .peer_profile_scope(&pair.incoming, pair.profile, remote)
        .unwrap();
    let origin = pair.a.peer_origin_state(&pair.incoming, &scope).unwrap();
    assert_eq!(origin.origin.profile_id, pair.profile);
    assert_eq!(origin.origin.device_id, pair.a.device_id);
    assert_eq!(origin.head.seq, 1);
    assert_eq!(
        origin,
        pair.a.peer_origin_state(&pair.incoming, &scope).unwrap()
    );
    let mut received = Vec::new();
    for offset in (0..bytes.len()).step_by(exomind_core::MAX_ORIGINAL_CHUNK_BYTES) {
        let chunk = pair
            .a
            .peer_original_range(
                &pair.incoming,
                &scope,
                published,
                offset as u64,
                (bytes.len() - offset).min(exomind_core::MAX_ORIGINAL_CHUNK_BYTES),
            )
            .unwrap();
        assert_eq!(chunk.original.original_id, published);
        assert_eq!(chunk.offset, offset as u64);
        received.extend_from_slice(&chunk.bytes);
    }
    assert_eq!(received, bytes);
    assert!(
        pair.a
            .peer_original_range(&pair.incoming, &scope, private, 0, 1)
            .is_err()
    );
    assert!(
        pair.a
            .peer_original_range(&pair.incoming, &scope, foreign, 0, 1)
            .is_err()
    );
    assert!(
        pair.a
            .peer_original_range(
                &pair.incoming,
                &scope,
                published,
                0,
                exomind_core::MAX_ORIGINAL_CHUNK_BYTES + 1
            )
            .is_err()
    );
    assert!(
        pair.a
            .peer_profile_scope(&pair.incoming, q, remote)
            .is_err()
    );
    assert!(
        pair.a
            .peer_profile_scope(&pair.incoming, pair.profile, DeviceId::new())
            .is_err()
    );
    assert!(
        pair.a
            .peer_profile_scope(
                &pair.incoming,
                pair.profile,
                pair.a.status().unwrap().device_id
            )
            .is_err()
    );
    stop(pair).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_peer_scope_cannot_move_to_a_new_tls_channel_or_local_member_generation() {
    let mut pair = pair(PeerCapabilities::FULL).await;
    let remote = pair.b.status().unwrap().device_id;
    let scope = pair
        .a
        .peer_profile_scope(&pair.incoming, pair.profile, remote)
        .unwrap();
    let pin = pair.incoming.peer_fingerprint();
    // Same remote key and membership, but a different actual channel instance.
    let client = pair
        .b
        .connect_peer_transport(
            &pair.owner_b,
            pair.listener.addr(),
            PeerPin::from_sha256(
                &pair
                    .a
                    .device_identity(&pair.owner_a)
                    .unwrap()
                    .fingerprint_sha256,
            )
            .unwrap(),
            PeerTransportOptions::default(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let server = pair.listener.accept(PeerCancellation::new()).await.unwrap();
    assert_eq!(server.peer_fingerprint(), pin);
    assert!(
        pair.a
            .with_peer_scope(&server, &scope, PeerOperation::ReadTimeline, |_, _| Ok(()))
            .is_err()
    );
    assert!(
        pair.b
            .with_peer_scope(
                &pair.outgoing,
                &scope,
                PeerOperation::ReadTimeline,
                |_, _| Ok(())
            )
            .is_err()
    );
    {
        let state = pair.a.active_state().unwrap();
        let resources = crate::resources(&state).unwrap();
        let mut local = store::member(&resources.persistence.auth, pair.profile, pair.a.device_id)
            .unwrap()
            .unwrap();
        local.record.generation += 1;
        store::save_member(&resources.persistence.auth, &local).unwrap();
    }
    assert!(
        pair.a
            .with_peer_scope(
                &pair.incoming,
                &scope,
                PeerOperation::ReadTimeline,
                |_, _| Ok(())
            )
            .is_err()
    );
    let fresh = pair
        .a
        .peer_profile_scope(&pair.incoming, pair.profile, remote)
        .unwrap();
    pair.a
        .with_peer_scope(
            &pair.incoming,
            &fresh,
            PeerOperation::ReadTimeline,
            |_, _| Ok(()),
        )
        .unwrap();
    pair.a.request_stop();
    assert!(matches!(
        pair.a.with_peer_scope(
            &pair.incoming,
            &fresh,
            PeerOperation::ReadTimeline,
            |_, _| Ok(())
        ),
        Err(HostError::Stopped)
    ));
    drop(client);
    drop(server);
    stop(pair).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_queued_peer_operation_rechecks_revocation_and_never_escalates_read_only() {
    let pair = pair(PeerCapabilities {
        read_timeline: true,
        append_facts: false,
        read_originals: false,
    })
    .await;
    let remote = pair.b.status().unwrap().device_id;
    let scope = pair
        .a
        .peer_profile_scope(&pair.incoming, pair.profile, remote)
        .unwrap();
    pair.a
        .with_peer_scope(
            &pair.incoming,
            &scope,
            PeerOperation::ReadTimeline,
            |_, _| Ok(()),
        )
        .unwrap();
    let ran = Arc::new(AtomicBool::new(false));
    for operation in [PeerOperation::ReadOriginals, PeerOperation::AppendFacts] {
        assert!(matches!(
            pair.a
                .with_peer_scope(&pair.incoming, &scope, operation, |_, _| {
                    ran.store(true, Ordering::SeqCst);
                    Ok(())
                }),
            Err(HostError::PeerMembershipDenied)
        ));
    }
    let (queued_tx, queued_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let host = pair.a.clone();
    let channel = pair.incoming.clone();
    let effect = ran.clone();
    let member_generation = scope.member_generation;
    let worker = std::thread::spawn(move || {
        queued_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        host.with_peer_scope(&channel, &scope, PeerOperation::ReadTimeline, |_, _| {
            effect.store(true, Ordering::SeqCst);
            Ok(())
        })
    });
    queued_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    pair.a
        .revoke_peer_member(&pair.owner_a, pair.profile, remote, member_generation)
        .unwrap();
    release_tx.send(()).unwrap();
    assert!(matches!(
        worker.join().unwrap(),
        Err(HostError::PeerMembershipDenied)
    ));
    assert!(!ran.load(Ordering::SeqCst));
    assert!(
        pair.a
            .peer_profile_scope(&pair.incoming, pair.profile, remote)
            .is_err()
    );
    stop(pair).await;
}
