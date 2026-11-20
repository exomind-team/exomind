use super::*;
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, OriginPageQuery, OriginalId,
    ProfileId, StageId,
};
use sha2::{Digest, Sha256};
use tokio::task::JoinSet;
use uuid::Uuid;

const MAX_CONTROLLED_PROFILE_TICKS: usize = 257;

fn set_auto_policy(host: &BetaHost, owner: &Session, enabled: bool, max_bytes: u64) {
    let prior = host.original_auto_policy(owner).unwrap();
    host.configure_original_auto_policy(
        owner,
        &crate::OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: prior.revision,
            enabled,
            max_bytes,
        },
    )
    .unwrap();
}

fn seed_source_original(
    host: &BetaHost,
    owner: &Session,
    profile: ProfileId,
    bytes: &[u8],
) -> exomind_core::OriginalRef {
    let original_id = OriginalId::new();
    let stage_id = StageId::new();
    let ticket = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(profile).unwrap();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id,
                original_id,
                profile_id: profile,
                expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                byte_length: bytes.len() as u64,
                file_name: "queue-budget.bin".into(),
                media_type: "application/octet-stream".into(),
            },
        )
        .unwrap();
        core.write_stage_chunk(&human, stage_id, 0, bytes).unwrap();
        core.freeze_stage(&human, stage_id).unwrap()
    };
    let proof = ticket.verify(|| false).unwrap();
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    let original = core.finish_stage(&human, &proof).unwrap().original;
    core.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1_000,
            text: "unique source for queue budget regression".into(),
            tags: vec![],
            originals: vec![original.clone()],
        },
    )
    .unwrap();
    original
}

fn read_original(
    host: &BetaHost,
    profile: ProfileId,
    original_id: OriginalId,
    length: usize,
) -> Vec<u8> {
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    core.read_original_range(&human, profile, original_id, 0, length)
        .unwrap()
        .bytes
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_profile_after_256_healthy_solo_profiles_is_fetched_by_controlled_ticks() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_source_root, source, source_owner) = super::host();
    let (_target_root, target, target_owner) = super::host();

    let profile: ProfileId = "ffffffff-ffff-4fff-bfff-ffffffffffff".parse().unwrap();
    source
        .provision_profile(&source_owner, profile, "one authorized shared profile")
        .unwrap();
    target
        .provision_profile(&target_owner, profile, "one authorized shared profile")
        .unwrap();

    let solo_profiles = (1..=256)
        .map(|number| {
            let solo: ProfileId =
                format!("00000000-0000-4000-8000-{number:012x}").parse().unwrap();
            target
                .provision_profile(&target_owner, solo, &format!("healthy Solo {number}"))
                .unwrap();
            solo
        })
        .collect::<Vec<_>>();
    assert!(
        solo_profiles
            .iter()
            .all(|solo| solo.to_string() < profile.to_string()),
        "the shared profile must sort after all 256 unpaired Solo profiles"
    );

    let bytes = b"one unique authenticated source\0queue-budget";
    let original = seed_source_original(&source, &source_owner, profile, bytes);
    let origin_page = {
        let state = source.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.export_origin_page(
            &core.local_human(profile).unwrap(),
            profile,
            &OriginPageQuery::default(),
        )
        .unwrap()
    };

    set_auto_policy(&target, &target_owner, false, crate::MIN_ORIGINAL_AUTO_BYTES);
    let source_network = PeerNetwork::new(source.clone(), source_owner.clone()).unwrap();
    let target_network = PeerNetwork::new(target.clone(), target_owner.clone()).unwrap();
    target_network.pause_auto_ticks_for_test().unwrap();
    let invitation = source_network
        .create_invitation(profile)
        .await
        .unwrap()
        .invitation
        .unwrap();
    let joined = target_network
        .join(&invitation, Uuid::new_v4())
        .await
        .unwrap();

    {
        let state = target.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let context = core
            .trusted_replica_context(
                profile,
                source.device_id,
                origin_page.origin.restoration_epoch,
                1,
            )
            .unwrap();
        core.import_origin_page(&context, &origin_page).unwrap();
    }
    target_network
        .sync_now(profile, source.device_id)
        .await
        .unwrap();

    let members_before = target.peer_members(&target_owner, profile).unwrap();
    let source_member_before = members_before
        .iter()
        .find(|member| member.device_id == source.device_id)
        .unwrap();
    let unique_ready_sources = members_before
        .iter()
        .filter(|member| {
            member.device_id != target.device_id
                && !member.revoked
                && member.state == PeerJoinState::Ready
                && member.capabilities.read_originals
        })
        .count();
    let source_generation = source_member_before.generation;
    let route_ready = target.peer_routes(&target_owner).unwrap().iter().any(|route| {
        route.profile == profile
            && route.device == source.device_id
            && !route.endpoints.is_empty()
    });
    let missing_before = target_network
        .original_status(profile, original.original_id)
        .is_ok_and(|status| status.availability == "missing");

    let network_preference_still_enabled = target
        .peer_network_settings(&target_owner)
        .unwrap()
        .enabled;
    set_auto_policy(&target, &target_owner, true, crate::MIN_ORIGINAL_AUTO_BYTES);
    let policy_enabled = target.original_auto_policy(&target_owner).unwrap().enabled;

    let worker = target_network.worker();
    let (generation, cancel) = {
        let running = target_network.lifecycle.lock().await;
        let cancel = running
            .as_ref()
            .expect("target network remains active")
            .cancel
            .clone();
        let generation = target_network.shared.lock().unwrap().generation;
        (generation, cancel)
    };
    let mut queue = AutoQueue::new();
    let mut jobs = JoinSet::<AutoCompletion>::new();
    let mut fetch_started = false;
    for _ in 0..MAX_CONTROLLED_PROFILE_TICKS {
        queue
            .tick(&worker, &cancel, generation, &mut jobs, false)
            .unwrap();
        if !jobs.is_empty() {
            fetch_started = true;
            match tokio::time::timeout(Duration::from_secs(12), jobs.join_next()).await {
                Ok(Some(completion)) => queue.completed(completion, &worker),
                _ => {
                    jobs.abort_all();
                    while jobs.join_next().await.is_some() {}
                }
            }
            break;
        }
    }

    let final_status = target_network
        .original_status(profile, original.original_id)
        .unwrap();
    let auto_status = target_network.original_auto_queue_status().unwrap();
    let bytes_match = final_status.availability == "complete"
        && read_original(&target, profile, original.original_id, bytes.len()) == bytes;
    let explicit_wait = auto_status.deferred
        && auto_status.last_error_code == Some("original_source_waiting");
    let source_generation_after = target
        .peer_members(&target_owner, profile)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == source.device_id)
        .unwrap()
        .generation;

    target_network.stop().await.unwrap();
    source_network.stop().await.unwrap();
    super::stopped(target).await;
    super::stopped(source).await;

    assert_eq!(joined.state, PeerJoinState::Ready);
    assert_eq!(unique_ready_sources, 1, "the joined peer is the only source");
    assert!(route_ready, "the sole source must have a real pinned route");
    assert!(missing_before, "the target starts with metadata and no bytes");
    assert!(network_preference_still_enabled && policy_enabled);
    assert!(
        bytes_match || (!route_ready && explicit_wait),
        "a Ready shared profile must fetch from its unique source or expose source_waiting; fetched={}, waiting={}, deferred={}, error={:?}",
        bytes_match,
        explicit_wait,
        auto_status.deferred,
        auto_status.last_error_code
    );
    assert!(
        fetch_started && bytes_match,
        "the controlled queue must make byte progress when its unique Ready source is available"
    );
    assert_eq!(
        source_generation_after, source_generation,
        "fetching must not rejoin or change owner authorization"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v1_only_peer_alpn_completes_pinned_signed_join() {
    use super::super::super::transport::PeerServiceVersion;

    let _discovery = crate::peers::test_discovery::lease().await;
    let (_issuer_root, issuer, issuer_owner) = super::host();
    let (_joiner_root, joiner, joiner_owner) = super::host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "legacy v1 service")
        .unwrap();

    let mut legacy_listener = issuer
        .listen_peer_transport_v1_for_test(
            &issuer_owner,
            "127.0.0.1:0".parse().unwrap(),
            super::transport_options(),
        )
        .await
        .unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![legacy_listener.addr()],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();

    let service_host = issuer.clone();
    let service_owner = issuer_owner.clone();
    let mut service_task = tokio::spawn(async move {
        let channel = legacy_listener.accept(PeerCancellation::new()).await?;
        let negotiated = channel.service_version();
        let outcome = service_host
            .accept_peer_service(&service_owner, channel)
            .await?;
        Ok::<_, HostError>((negotiated, outcome))
    });
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();
    let joined = network.join(&invitation, Uuid::new_v4()).await;

    let service_result = if joined.is_ok() {
        match tokio::time::timeout(Duration::from_secs(10), &mut service_task).await {
            Ok(Ok(Ok(result))) => Some(result),
            _ => {
                service_task.abort();
                let _ = service_task.await;
                None
            }
        }
    } else {
        service_task.abort();
        let _ = service_task.await;
        None
    };

    let joined_ready = joined
        .as_ref()
        .is_ok_and(|status| status.state == PeerJoinState::Ready);
    let (v1_negotiated, issuer_ready) = match service_result {
        Some((version, PeerServiceOutcome::Joined(status))) => {
            (version == PeerServiceVersion::V1, status.state == PeerJoinState::Ready)
        }
        _ => (false, false),
    };
    let issuer_member = joiner
        .peer_members(&joiner_owner, profile)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == issuer.device_id);
    let signed_pin_kept = issuer_member.is_some_and(|member| {
        !member.revoked
            && member.state == PeerJoinState::Ready
            && member.pin == invitation.offer.issuer.fingerprint_sha256
    });

    network.stop().await.unwrap();
    super::stopped(issuer).await;
    super::stopped(joiner).await;

    assert!(
        v1_negotiated && joined_ready && issuer_ready,
        "the V1-only pinned TLS session must complete the full Join claim/confirm flow; v1={v1_negotiated}, client_ready={joined_ready}, issuer_ready={issuer_ready}"
    );
    assert!(
        signed_pin_kept,
        "the Ready membership must retain the invitation's signed issuer pin"
    );
}
