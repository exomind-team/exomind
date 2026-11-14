use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_no_alpn_completed_tls_keeps_budget_while_failure_queue_is_full() {
    let (_root, host, owner) = host();
    let (_client_root, client, client_owner) = self::host();
    let server_pin = pin(&host, &owner);
    let identity = client.transport_identity(&client_owner).unwrap();
    let mut config =
        client_config(&identity, server_pin, Arc::new(AtomicBool::new(false))).unwrap();
    Arc::get_mut(&mut config).unwrap().alpn_protocols.clear();
    let slow = PeerTransportOptions {
        handshake_timeout: Duration::from_secs(10),
        ..options()
    };
    let listener = host
        .listen_peer_transport(&owner, address(), slow)
        .await
        .unwrap();
    // One error can enter the queue. Every later post-handshake error has to
    // retain one of the eight permits while awaiting that undrained queue.
    for _ in 0..=super::super::super::MAX_CONNECTIONS {
        let socket = TcpStream::connect(listener.addr()).await.unwrap();
        let mut tls = tokio::time::timeout(
            Duration::from_secs(2),
            tokio_rustls::TlsConnector::from(config.clone()).connect(
                ServerName::try_from("exomind-peer.invalid")
                    .unwrap()
                    .to_owned(),
                socket,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(ProtocolVersion::TLSv1_3)
        );
        assert_eq!(tls.get_ref().1.alpn_protocol(), None);
        // The real TLS connection is closed at post-handshake validation;
        // no failed channel can enter the business/membership layer.
        let mut byte = [0];
        let closed = tokio::time::timeout(Duration::from_secs(2), tls.read(&mut byte))
            .await
            .unwrap();
        assert!(matches!(closed, Ok(0) | Err(_)));
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        while host.peers.connections.available_permits() != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        host.peers.counts.lock().unwrap().jobs,
        1 + super::super::super::MAX_CONNECTIONS
    );
    let mut overflow = TcpStream::connect(listener.addr()).await.unwrap();
    let mut byte = [0];
    let closed = tokio::time::timeout(Duration::from_secs(1), overflow.read(&mut byte))
        .await
        .unwrap();
    assert!(matches!(closed, Ok(0) | Err(_)));
    assert!(host.profiles(&owner).unwrap().is_empty());
    stop(host).await;
    stop(client).await;
    drop(listener);
}

#[test]
fn peer_identity_sqlite_materialization_is_bounded_on_warm_read_and_cold_open() {
    for field in ["key_pkcs8", "spki", "pin"] {
        let (root, host, owner) = host();
        let original = host.device_identity(&owner).unwrap();
        let path = key_path(root.path());
        let db = rusqlite::Connection::open(&path).unwrap();
        let sql = match field {
            "key_pkcs8" => "UPDATE identity SET key_pkcs8=zeroblob(16384)",
            "spki" => "UPDATE identity SET spki=zeroblob(16384)",
            "pin" => "UPDATE identity SET pin=printf('%.*c',16384,'x')",
            _ => unreachable!(),
        };
        db.execute_batch(sql).unwrap();
        drop(db);
        // Identity stores no long-lived SQLite connection: a warm persistence
        // read means opening that same damaged DB while Host/its key binding
        // remain live. A cached in-memory signer is never silently replaced.
        assert!(matches!(
            Identity::open(root.path(), original.device_id),
            Err(HostError::PeerIdentityRecoveryRequired)
        ));
        assert_eq!(host.device_identity(&owner).unwrap(), original);
        let binding = {
            let state = host.state().unwrap();
            crate::resources(&state)
                .unwrap()
                .persistence
                .peer_identity_pin(original.device_id)
                .unwrap()
        };
        assert_eq!(
            binding.as_deref(),
            Some(original.fingerprint_sha256.as_str())
        );
        host.stop().unwrap();
        assert!(matches!(
            BetaHost::open(root.path()),
            Err(HostError::PeerIdentityRecoveryRequired)
        ));
        // Failed validation preserves the oversized evidence; no new row/key
        // or empty-cache fallback is created to make a later open succeed.
        let db = rusqlite::Connection::open(&path).unwrap();
        let length_sql = match field {
            "key_pkcs8" => "SELECT length(key_pkcs8) FROM identity",
            "spki" => "SELECT length(spki) FROM identity",
            "pin" => "SELECT length(pin) FROM identity",
            _ => unreachable!(),
        };
        let length: i64 = db.query_row(length_sql, [], |row| row.get(0)).unwrap();
        assert_eq!(length, 16384);
    }
}
