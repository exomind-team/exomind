use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_binding_is_host_owned_and_immediately_rejects_cancelled_scope() {
    let (_a_root, a, owner_a) = host();
    let (_b_root, b, owner_b) = host();
    let expected_b = pin(&b, &owner_b);
    let expected_a = pin(&a, &owner_a);
    let mut listener = b
        .listen_peer_transport(&owner_b, address(), options())
        .await
        .unwrap();
    let cancel = PeerCancellation::new();
    let client = a
        .connect_peer_transport(
            &owner_a,
            listener.addr(),
            expected_b,
            options(),
            cancel.clone(),
        )
        .await
        .unwrap();
    let server = listener.accept(PeerCancellation::new()).await.unwrap();
    // The check must remain safe while a final business operation holds the
    // Host gate; it cannot call qualify_transport and recursively lock it.
    let gate = a.active_state().unwrap();
    assert_eq!(client.binding_pin(&a).unwrap(), expected_b);
    assert!(matches!(
        client.binding_pin(&b),
        Err(HostError::Unauthorized)
    ));
    drop(gate);
    assert_eq!(server.binding_pin(&b).unwrap(), expected_a);
    cancel.cancel();
    assert!(matches!(
        client.binding_pin(&a),
        Err(HostError::PeerCancelled)
    ));
    drop(client);
    drop(server);
    drop(listener);
    stop(a).await;
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_binding_rejects_stop_before_owned_io_has_drained() {
    let (_a_root, a, owner_a) = host();
    let (_b_root, b, owner_b) = host();
    let expected_b = pin(&b, &owner_b);
    let mut listener = b
        .listen_peer_transport(&owner_b, address(), options())
        .await
        .unwrap();
    let client = a
        .connect_peer_transport(
            &owner_a,
            listener.addr(),
            expected_b,
            options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let server = listener.accept(PeerCancellation::new()).await.unwrap();
    a.request_stop();
    assert!(matches!(client.binding_pin(&a), Err(HostError::Stopped)));
    drop(client);
    drop(server);
    drop(listener);
    stop(a).await;
    stop(b).await;
}
