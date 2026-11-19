use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_probe_cancellation_interrupts_a_stalled_peer_response() {
    let rig = rig(b"synthetic probe cancellation").await;
    let mut settings = rig.b.peer_network_settings(&rig.ob).unwrap();
    settings.enabled = true;
    rig.b.save_peer_network_settings(&rig.ob, settings).unwrap();
    let (listener, client, server) = channels(&rig.a, &rig.oa, &rig.b, &rig.ob).await;
    let cancel = PeerCancellation::new();
    let task_cancel = cancel.clone();
    let host = rig.b.clone();
    let owner = rig.ob.clone();
    let profile = rig.p;
    let peer = rig.a.device_id;
    let expected = rig.original.clone();
    let mut probe = tokio::spawn(async move {
        host.probe_peer_original_over_transport(
            &owner,
            profile,
            peer,
            expected,
            client,
            OriginalTransferOptions::default(),
            task_cancel,
        )
        .await
    });
    let options = OriginalTransferOptions::default();
    let mut server_io = Io {
        channel: server,
        cancel: PeerCancellation::new(),
        end: Instant::now() + options.session_timeout,
        options,
    };
    let request = tokio::time::timeout(Duration::from_secs(3), server_io.read())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(request, Control::Probe { .. }));
    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(1), &mut probe).await;
    let timed_out = result.is_err();
    let cancelled = matches!(result, Ok(Ok(Err(HostError::PeerCancelled))));
    let closed = server_io.channel.closed_notification();
    drop(server_io);
    tokio::time::timeout(Duration::from_secs(3), closed)
        .await
        .expect("owned server transport must stop");
    if timed_out {
        let _ = tokio::time::timeout(Duration::from_secs(3), probe)
            .await
            .expect("owned probe must stop after its server closes");
    }
    drop(listener);
    stop(rig.a).await;
    stop(rig.b).await;
    assert!(
        cancelled,
        "caller cancellation must interrupt the pending probe read"
    );
}
