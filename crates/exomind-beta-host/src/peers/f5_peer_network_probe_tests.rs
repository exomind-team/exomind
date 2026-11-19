use super::*;
use crate::BetaHost;
use exomind_core::{BeginStageCommand, OriginalId, StageId};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::time::Duration;

fn seed_probe_reference(
    host: &BetaHost,
    profile: ProfileId,
    original_id: OriginalId,
    bytes: &[u8],
) {
    let stage_id = StageId::new();
    let expected_sha256 = format!("{:x}", Sha256::digest(bytes));
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
                expected_sha256,
                byte_length: bytes.len() as u64,
                file_name: "peer-probe.bin".into(),
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
            text: "synthetic peer probe reference".into(),
            tags: vec![],
            originals: vec![original],
        },
    )
    .unwrap();
}

fn clear_saved_probe_route(host: &BetaHost, profile: ProfileId, peer: DeviceId) {
    let state = host.active_state().unwrap();
    let resources = crate::resources(&state).unwrap();
    resources
        .persistence
        .auth
        .execute(
            "DELETE FROM peer_network_routes WHERE profile_id=?1 AND device_id=?2",
            params![profile.to_string(), peer.to_string()],
        )
        .unwrap();
    resources.persistence.auth.execute(
        "UPDATE peer_network_settings SET route_count=(SELECT count(*) FROM peer_network_routes) WHERE singleton=1",
        [],
    ).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_network_stop_cancels_probe_after_remote_receives_probe_frame() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_root_a, host_a, owner_a) = host();
    let (_root_b, host_b, owner_b) = host();
    let profile = pair_hosts(&host_a, &owner_a, &host_b, &owner_b).await;
    let original_id = OriginalId::new();
    let bytes = b"synthetic peer network probe";
    seed_probe_reference(&host_a, profile, original_id, bytes);
    seed_probe_reference(&host_b, profile, original_id, bytes);
    clear_saved_probe_route(&host_b, profile, host_a.device_id);

    let network = PeerNetwork::new(host_b.clone(), owner_b.clone()).unwrap();
    network.set_enabled(true).await.unwrap();
    network
        .shared
        .lock()
        .unwrap()
        .progress
        .entry((profile, host_a.device_id))
        .or_default()
        .busy = true;
    let mut listener = host_a
        .listen_peer_transport(
            &owner_a,
            "127.0.0.1:0".parse().unwrap(),
            transport_options(),
        )
        .await
        .unwrap();
    host_b
        .save_peer_routes(&owner_b, profile, host_a.device_id, vec![listener.addr()])
        .unwrap();

    let (probe_seen_tx, probe_seen_rx) = tokio::sync::oneshot::channel();
    let (release_server_tx, release_server_rx) = tokio::sync::oneshot::channel();
    let server_cancel = PeerCancellation::new();
    let server_stop = server_cancel.clone();
    let mut server = tokio::spawn(async move {
        let channel = match listener.accept(server_stop.clone()).await {
            Ok(channel) => channel,
            Err(_) => return false,
        };
        let _selection = tokio::select! {
            _ = server_stop.cancelled() => return false,
            result = tokio::time::timeout(Duration::from_secs(5), channel.read_frame()) => match result { Ok(Ok(frame)) => frame, _ => return false },
        };
        let frame = tokio::select! {
            _ = server_stop.cancelled() => return false,
            result = tokio::time::timeout(Duration::from_secs(5), channel.read_frame()) => match result { Ok(Ok(frame)) => frame, _ => return false },
        };
        let is_probe = serde_json::from_slice::<serde_json::Value>(&frame)
            .ok()
            .is_some_and(|control| control["operation"] == "probe");
        let _ = probe_seen_tx.send(is_probe);
        tokio::select! { _ = server_stop.cancelled() => {}, _ = release_server_rx => {} }
        drop(channel);
        is_probe
    });

    let probe_network = network.clone();
    let peer = host_a.device_id;
    let mut probe = tokio::spawn(async move {
        probe_network
            .probe_original_source(profile, peer, original_id)
            .await
    });
    let probe_seen = matches!(
        tokio::time::timeout(Duration::from_secs(5), probe_seen_rx).await,
        Ok(Ok(true))
    );
    let stop_result = tokio::time::timeout(Duration::from_secs(3), network.stop()).await;
    let stop_completed = matches!(stop_result, Ok(Ok(())));
    let result = tokio::time::timeout(Duration::from_secs(1), &mut probe).await;
    let probe_timed_out = result.is_err();
    let cancelled = matches!(result, Ok(Ok(Err(HostError::PeerCancelled))));

    server_cancel.cancel();
    let _ = release_server_tx.send(());
    if tokio::time::timeout(Duration::from_secs(3), &mut server)
        .await
        .is_err()
    {
        server.abort();
        let _ = server.await;
    }
    if probe_timed_out
        && tokio::time::timeout(Duration::from_secs(3), &mut probe)
            .await
            .is_err()
    {
        probe.abort();
        let _ = probe.await;
    }
    drop(network);
    stopped(host_a).await;
    stopped(host_b).await;

    assert!(
        probe_seen,
        "the remote peer must receive Probe before caller cancellation"
    );
    assert!(
        stop_completed,
        "stopping the owning PeerNetwork must complete"
    );
    assert!(
        cancelled,
        "PeerNetwork stop must cancel its in-flight probe read"
    );
}
