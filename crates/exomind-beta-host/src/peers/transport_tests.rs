use super::*;
use crate::{GrantKind, GrantRequest};
use exomind_core::ProfileId;
use std::{fs, path::Path};
use tempfile::{TempDir, tempdir};

#[path = "post_handshake_tests.rs"]
mod post_handshake_tests;

#[path = "binding_tests.rs"]
mod binding_tests;

fn host() -> (TempDir, Arc<BetaHost>, Session) {
    let root = tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    (root, host, owner)
}
fn options() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(2),
        channel_lifetime: Duration::from_secs(10),
    }
}
fn address() -> SocketAddr {
    "127.0.0.1:0".parse().unwrap()
}
async fn stop(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
fn pin(host: &BetaHost, owner: &Session) -> PeerPin {
    PeerPin::from_sha256(&host.device_identity(owner).unwrap().fingerprint_sha256).unwrap()
}
fn key_path(root: &Path) -> std::path::PathBuf {
    root.join(identity::DIRECTORY).join("identity.sqlite3")
}

#[test]
fn client_handshake_error_keeps_authentication_evidence_ahead_of_io_categories() {
    use std::io::{Error as IoError, ErrorKind};
    for kind in [
        ErrorKind::UnexpectedEof,
        ErrorKind::ConnectionReset,
        ErrorKind::ConnectionAborted,
        ErrorKind::ConnectionRefused,
        ErrorKind::NotConnected,
        ErrorKind::BrokenPipe,
    ] {
        let error = IoError::from(kind);
        assert!(matches!(
            client_handshake_error(&error, false),
            HostError::PeerTransportUnavailable
        ));
        assert!(matches!(
            client_handshake_error(&error, true),
            HostError::PeerPinMismatch
        ));
    }
    assert!(matches!(
        client_handshake_error(&IoError::from(ErrorKind::TimedOut), false),
        HostError::PeerTimeout
    ));
    assert!(matches!(
        client_handshake_error(&IoError::from(ErrorKind::InvalidData), false),
        HostError::PeerTls
    ));
    let tls = IoError::new(
        ErrorKind::UnexpectedEof,
        rustls::Error::General("synthetic protocol rejection".into()),
    );
    assert!(matches!(
        client_handshake_error(&tls, false),
        HostError::PeerTls
    ));
    assert!(matches!(
        client_handshake_error(&tls, true),
        HostError::PeerPinMismatch
    ));
    assert!(
        matches!(
            client_handshake_error(&IoError::from(ErrorKind::Other), false),
            HostError::PeerTls
        ),
        "unknown errors remain conservative rejection"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_client_handshake_eof_is_transport_unavailable_without_claiming_identity_failure() {
    let (_root, client, owner) = host();
    let expected = pin(&client, &owner);
    let raw = TcpListener::bind(address()).await.unwrap();
    let endpoint = raw.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = tokio::time::timeout(Duration::from_secs(2), raw.accept())
            .await
            .unwrap()
            .unwrap();
        // Consume a genuine ClientHello record; no synthetic Rust io::Error is
        // injected. Keep the read side/socket owned after sending real EOF.
        let mut header = [0u8; 5];
        tokio::time::timeout(Duration::from_secs(2), stream.read_exact(&mut header))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(header[0], 22);
        let count = u16::from_be_bytes([header[3], header[4]]) as usize;
        assert!((1..=16384).contains(&count));
        let mut payload = vec![0; count];
        tokio::time::timeout(Duration::from_secs(2), stream.read_exact(&mut payload))
            .await
            .unwrap()
            .unwrap();
        stream.shutdown().await.unwrap();
        stream
    });
    let result = client
        .connect_peer_transport(
            &owner,
            endpoint,
            expected,
            options(),
            PeerCancellation::new(),
        )
        .await;
    let stream = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
    drop(stream);
    assert!(client.profiles(&owner).unwrap().is_empty());
    stop(client).await;
    assert!(
        matches!(result, Err(HostError::PeerTransportUnavailable)),
        "actual TLS-handshake EOF must remain transport unavailable, not PeerTls/identity"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_client_completed_real_tls_without_expected_alpn_is_still_rejected() {
    let (_source_root, source, source_owner) = host();
    let (_client_root, client, owner) = host();
    let identity = source.transport_identity(&source_owner).unwrap();
    let expected = pin(&source, &source_owner);
    // Client key creation (including private persistence) precedes the real
    // transport handshake deadline. Do that setup before arming the fixture's
    // two-second accept deadline, as the EOF/malformed fixtures already do.
    client.transport_identity(&owner).unwrap();
    let mut config = server_config(&identity).unwrap();
    Arc::get_mut(&mut config).unwrap().alpn_protocols.clear();
    let raw = TcpListener::bind(address()).await.unwrap();
    let endpoint = raw.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), raw.accept())
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(
            Duration::from_secs(2),
            tokio_rustls::TlsAcceptor::from(config).accept(stream),
        )
        .await
        .unwrap()
    });
    let result = client
        .connect_peer_transport(
            &owner,
            endpoint,
            expected,
            options(),
            PeerCancellation::new(),
        )
        .await;
    let tls = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        tls.get_ref().1.protocol_version(),
        Some(ProtocolVersion::TLSv1_3)
    );
    assert!(tls.get_ref().1.alpn_protocol().is_none());
    drop(tls);
    assert!(
        matches!(result, Err(HostError::PeerTls)),
        "a completed authenticated TLS stream without required ALPN cannot yield a channel"
    );
    assert!(client.profiles(&owner).unwrap().is_empty());
    stop(client).await;
    stop(source).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_client_malformed_tls_record_remains_protocol_rejected() {
    let (_root, client, owner) = host();
    let expected = pin(&client, &owner);
    let raw = TcpListener::bind(address()).await.unwrap();
    let endpoint = raw.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = tokio::time::timeout(Duration::from_secs(2), raw.accept())
            .await
            .unwrap()
            .unwrap();
        stream
            .write_all(&[0xff, 0x03, 0x03, 0x00, 0x01, 0xff])
            .await
            .unwrap();
        stream
    });
    let result = client
        .connect_peer_transport(
            &owner,
            endpoint,
            expected,
            options(),
            PeerCancellation::new(),
        )
        .await;
    let stream = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
    drop(stream);
    assert!(
        matches!(result, Err(HostError::PeerTls)),
        "malformed TLS protocol data must not be relabeled as ordinary offline EOF"
    );
    stop(client).await;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OwnedTransportState {
    jobs: usize,
    listener: bool,
    permits: usize,
    cancelled: bool,
    producer_closed: bool,
}
fn owned_transport_state(host: &BetaHost, listener: &PeerTransportListener) -> OwnedTransportState {
    let counts = host.peers.counts.lock().unwrap();
    OwnedTransportState {
        jobs: counts.jobs,
        listener: counts.listener,
        permits: host.peers.connections.available_permits(),
        cancelled: host.peers.cancel.is_cancelled(),
        producer_closed: listener.accepted.is_closed(),
    }
}
async fn wait_owned_transport_state(
    host: &BetaHost,
    listener: &PeerTransportListener,
    phase: &'static str,
    expected: OwnedTransportState,
) {
    let result = tokio::time::timeout(Duration::from_secs(2), async {
        while owned_transport_state(host, listener) != expected {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await;
    assert!(
        result.is_ok(),
        "{phase}: scoped transport did not reach {expected:?}; current={:?}; endpoint={}",
        owned_transport_state(host, listener),
        listener.addr(),
    );
}

#[test]
fn peer_identity_survives_restart_and_rejects_non_owner_or_old_runtime() {
    let (root, host, owner) = host();
    let first = host.device_identity(&owner).unwrap();
    assert_eq!(first.spki_der.len(), 44);
    let public = serde_json::to_value(&first).unwrap();
    assert_eq!(public.as_object().unwrap().len(), 3);
    assert!(public.get("key_pkcs8").is_none());
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "test").unwrap();
    for kind in [GrantKind::Observer, GrantKind::Human, GrantKind::AgentNote] {
        let issued = host
            .grant(
                &owner,
                GrantRequest {
                    profile_id: profile,
                    kind,
                    agent_id: if kind == GrantKind::AgentNote {
                        Some(exomind_core::AgentId::new())
                    } else {
                        None
                    },
                },
            )
            .unwrap();
        let session = host.authenticate(&issued.token).unwrap();
        assert!(matches!(
            host.device_identity(&session),
            Err(HostError::Forbidden)
        ));
    }
    let (_other_root, other, other_owner) = self::host();
    assert!(matches!(
        host.device_identity(&other_owner),
        Err(HostError::Unauthorized)
    ));
    other.stop().unwrap();
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    assert!(matches!(
        reopened.device_identity(&owner),
        Err(HostError::Unauthorized)
    ));
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        first
    );
    reopened.stop().unwrap();
}

#[test]
fn peer_identity_missing_empty_or_inconsistent_files_fail_closed() {
    for failure in [
        "missing", "empty", "corrupt", "key", "pin", "device", "marker", "all",
    ] {
        let (root, host, owner) = host();
        host.device_identity(&owner).unwrap();
        host.stop().unwrap();
        let db_path = key_path(root.path());
        match failure {
            "missing" => fs::remove_file(&db_path).unwrap(),
            "empty" => fs::write(&db_path, []).unwrap(),
            "corrupt" => fs::write(&db_path, b"not a database").unwrap(),
            "marker" => fs::remove_file(root.path().join(identity::INITIALIZED)).unwrap(),
            "all" => {
                // host-auth retains the binding even if both private key
                // directory and its external initialized anchor disappear.
                fs::remove_dir_all(root.path().join(identity::DIRECTORY)).unwrap();
                fs::remove_file(root.path().join(identity::INITIALIZED)).unwrap();
            }
            item => {
                let db = rusqlite::Connection::open(db_path).unwrap();
                let sql = match item {
                    "key" => "UPDATE identity SET key_pkcs8=zeroblob(85)",
                    "pin" => "UPDATE identity SET pin=lower(hex(zeroblob(32)))",
                    "device" => {
                        "UPDATE identity SET device_id='00000000-0000-0000-0000-000000000000'"
                    }
                    _ => unreachable!(),
                };
                db.execute_batch(sql).unwrap();
            }
        }
        assert!(
            matches!(
                BetaHost::open(root.path()),
                Err(HostError::PeerIdentityRecoveryRequired)
            ),
            "{failure}"
        );
    }
}

#[test]
fn peer_identity_binding_failure_never_acknowledges_or_rotates_key() {
    let (root, host, owner) = host();
    // A real SQLite trigger refuses the durable binding after key+anchor have
    // committed. The first call must fail, then reuse that exact key on retry.
    {
        let state = host.state().unwrap();
        let auth = &crate::resources(&state).unwrap().persistence.auth;
        auth.execute_batch("CREATE TABLE peer_identity_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,pin TEXT NOT NULL); CREATE TRIGGER deny_peer_insert BEFORE INSERT ON peer_identity_binding BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    }
    // An empty existing binding table means recovery is required, never None.
    assert!(matches!(
        host.device_identity(&owner),
        Err(HostError::PeerIdentityRecoveryRequired)
    ));
    {
        let state = host.state().unwrap();
        let auth = &crate::resources(&state).unwrap().persistence.auth;
        auth.execute_batch("DROP TRIGGER deny_peer_insert; DROP TABLE peer_identity_binding;")
            .unwrap();
        auth.execute_batch("PRAGMA query_only=ON").unwrap();
    }
    assert!(matches!(
        host.device_identity(&owner),
        Err(HostError::PeerIdentityUnavailable)
    ));
    let stored = Identity::open(root.path(), host.device_id).unwrap().info;
    {
        let state = host.state().unwrap();
        crate::resources(&state)
            .unwrap()
            .persistence
            .auth
            .execute_batch("PRAGMA query_only=OFF")
            .unwrap();
    }
    assert_eq!(host.device_identity(&owner).unwrap(), stored);
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        stored
    );
    reopened.stop().unwrap();
}

#[test]
fn peer_identity_bootstrap_resumes_only_complete_same_key_ledger() {
    let (root, host, owner) = host();
    let first = host.device_identity(&owner).unwrap();
    host.stop().unwrap();
    let auth = rusqlite::Connection::open(root.path().join("host-auth.sqlite3")).unwrap();
    auth.execute_batch("DROP TABLE peer_identity_binding")
        .unwrap();
    drop(auth);
    let db = rusqlite::Connection::open(key_path(root.path())).unwrap();
    db.execute_batch("UPDATE identity SET initialized=0")
        .unwrap();
    drop(db);
    fs::remove_file(root.path().join(identity::INITIALIZED)).unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        first
    );
    reopened.stop().unwrap();
}

#[test]
fn peer_identity_coherent_replacement_is_rejected_by_durable_auth_binding() {
    let (root, host, owner) = host();
    let first = host.device_identity(&owner).unwrap();
    let (_other_root, other, other_owner) = self::host();
    let replacement = other.transport_identity(&other_owner).unwrap();
    let other_state = other.state().unwrap();
    let source_path = key_path(&crate::resources(&other_state).unwrap().persistence.root);
    let source = rusqlite::Connection::open(source_path).unwrap();
    let raw: Vec<u8> = source
        .query_row("SELECT key_pkcs8 FROM identity", [], |row| row.get(0))
        .unwrap();
    drop(source);
    drop(other_state);
    other.stop().unwrap();
    host.stop().unwrap();
    let db = rusqlite::Connection::open(key_path(root.path())).unwrap();
    db.execute(
        "UPDATE identity SET key_pkcs8=?1,spki=?2,pin=?3",
        rusqlite::params![
            raw,
            replacement.info.spki_der,
            replacement.info.fingerprint_sha256
        ],
    )
    .unwrap();
    drop(db);
    let marker = format!(
        "exomind-device-key/1\n{}\n{}\n",
        first.device_id, replacement.info.fingerprint_sha256
    );
    fs::write(root.path().join(identity::INITIALIZED), marker).unwrap();
    assert!(matches!(
        BetaHost::open(root.path()),
        Err(HostError::PeerIdentityRecoveryRequired)
    ));
}

#[test]
fn peer_stop_timeout_retains_root_until_owned_job_releases() {
    let (root, host, _owner) = host();
    let job = host.peers.register(false).unwrap();
    assert!(matches!(
        host.stop_with_timeout(Duration::from_millis(20)),
        Err(HostError::Shutdown)
    ));
    assert!(matches!(
        BetaHost::open(root.path()),
        Err(HostError::RootInUse)
    ));
    drop(job);
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    reopened.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_tls13_rpk_mutual_possession_is_not_profile_membership() {
    let (_a, a, owner_a) = host();
    let (_b, b, owner_b) = host();
    let pin_a = pin(&a, &owner_a);
    let pin_b = pin(&b, &owner_b);
    let mut listener = a
        .listen_peer_transport(&owner_a, address(), options())
        .await
        .unwrap();
    let outgoing = b
        .connect_peer_transport(
            &owner_b,
            listener.addr(),
            pin_a,
            options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let incoming = listener.accept(PeerCancellation::new()).await.unwrap();
    assert_eq!(incoming.peer_fingerprint(), pin_b);
    assert_eq!(outgoing.peer_fingerprint(), pin_a);
    assert_eq!(incoming.tls_version(), "TLS1.3");
    let bytes = vec![0, 255, 19, 0, 255];
    outgoing.send_frame(bytes.clone()).await.unwrap();
    assert_eq!(incoming.read_frame().await.unwrap(), bytes);
    assert!(matches!(
        outgoing.send_frame(vec![0; MAX_FRAME + 1]).await,
        Err(HostError::PayloadTooLarge)
    ));
    // No profile, writer, owner token or business handler is allocated to the
    // unknown-but-authenticated remote public key by the transport layer.
    assert!(a.profiles(&owner_a).unwrap().is_empty());
    assert!(b.profiles(&owner_b).unwrap().is_empty());
    outgoing.close().await.unwrap();
    incoming.close().await.unwrap();
    drop(listener);
    stop(a).await;
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_wrong_server_pin_fails_before_channel_or_business_bytes() {
    let (_a, a, owner_a) = host();
    let (_b, b, owner_b) = host();
    let mut listener = a
        .listen_peer_transport(&owner_a, address(), options())
        .await
        .unwrap();
    let wrong = PeerPin::from_sha256(&"00".repeat(32)).unwrap();
    assert!(matches!(
        b.connect_peer_transport(
            &owner_b,
            listener.addr(),
            wrong,
            options(),
            PeerCancellation::new()
        )
        .await,
        Err(HostError::PeerPinMismatch)
    ));
    assert!(matches!(
        listener.accept(PeerCancellation::new()).await,
        Err(HostError::PeerTls)
    ));
    assert!(a.profiles(&owner_a).unwrap().is_empty());
    stop(a).await;
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_client_cannot_claim_another_public_key_without_its_private_key() {
    let (_a, a, owner_a) = host();
    let (_b, b, owner_b) = host();
    let (_c, victim, victim_owner) = host();
    let server_pin = pin(&a, &owner_a);
    let attacker = b.transport_identity(&owner_b).unwrap();
    let victim_key = victim.transport_identity(&victim_owner).unwrap();
    let forged = Identity {
        info: victim_key.info.clone(),
        certified: Arc::new(rustls::sign::CertifiedKey::new(
            victim_key.certified.cert.clone(),
            attacker.certified.key.clone(),
        )),
    };
    let config = client_config(&forged, server_pin, Arc::new(AtomicBool::new(false))).unwrap();
    let mut listener = a
        .listen_peer_transport(&owner_a, address(), options())
        .await
        .unwrap();
    let socket = TcpStream::connect(listener.addr()).await.unwrap();
    let attempt = tokio::time::timeout(
        options().handshake_timeout,
        tokio_rustls::TlsConnector::from(config).connect(
            ServerName::try_from("exomind-peer.invalid")
                .unwrap()
                .to_owned(),
            socket,
        ),
    )
    .await;
    // A TLS client can finish locally before the server verifies its Finished.
    // The authoritative assertion is that the server never yields a channel.
    drop(attempt);
    assert!(matches!(
        listener.accept(PeerCancellation::new()).await,
        Err(HostError::PeerTls)
    ));
    assert!(a.profiles(&owner_a).unwrap().is_empty());
    stop(a).await;
    stop(b).await;
    stop(victim).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_handshake_timeout_cancel_and_stop_drain_owned_sockets() {
    let (root, a, owner) = host();
    let info = a.device_identity(&owner).unwrap();
    let quick = PeerTransportOptions {
        handshake_timeout: Duration::from_millis(150),
        ..options()
    };
    let mut listener = a
        .listen_peer_transport(&owner, address(), quick)
        .await
        .unwrap();
    let retained_address = listener.addr();
    assert!(matches!(
        a.listen_peer_transport(&owner, address(), quick).await,
        Err(HostError::PeerBusy)
    ));
    let idle_tcp =
        tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(retained_address))
            .await
            .expect("idle client connection deadline")
            .unwrap();
    let failure = listener.accept(PeerCancellation::new()).await;
    assert!(matches!(
        failure,
        Err(HostError::PeerTls) | Err(HostError::PeerTimeout)
    ));
    drop(idle_tcp);
    // An accept timeout can precede the worker's failure report/drop. Retire
    // that first connection before attributing the next lease to stalled.
    wait_owned_transport_state(
        &a,
        &listener,
        "first idle handshake lease returned",
        OwnedTransportState {
            jobs: 1,
            listener: true,
            permits: super::super::MAX_CONNECTIONS,
            cancelled: false,
            producer_closed: false,
        },
    )
    .await;
    let cancelled = PeerCancellation::new();
    cancelled.cancel();
    assert!(matches!(
        listener.accept(cancelled).await,
        Err(HostError::PeerCancelled)
    ));
    // A live unauthenticated handshake is owned and drained by stop as well.
    let mut stalled =
        tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(retained_address))
            .await
            .expect("stalled client connection deadline")
            .unwrap();
    let stalled_tuple = (stalled.local_addr().unwrap(), stalled.peer_addr().unwrap());
    assert_eq!(stalled_tuple.1, retained_address);
    wait_owned_transport_state(
        &a,
        &listener,
        "stalled handshake accepted by this host",
        OwnedTransportState {
            jobs: 2,
            listener: true,
            permits: super::super::MAX_CONNECTIONS - 1,
            cancelled: false,
            producer_closed: false,
        },
    )
    .await;
    stop(a.clone()).await;
    assert!(matches!(
        listener.accept(PeerCancellation::new()).await,
        Err(HostError::Stopped)
    ));
    // This receiver belongs to THIS listener actor and its handshake workers.
    // All producers close only when those tasks exit, after the actor's
    // explicit drop(socket) then drop(lease). Together with returned permits
    // and EOF/reset on the original connected socket, this proves scoped
    // closure without guessing who may now occupy the former numeric port.
    // The earlier bare-connect failure has not established port reuse as its
    // cause; don't contact an unowned endpoint to infer this actor's lifetime.
    wait_owned_transport_state(
        &a,
        &listener,
        "stop drained this listener and its owned sockets",
        OwnedTransportState {
            jobs: 0,
            listener: false,
            permits: super::super::MAX_CONNECTIONS,
            cancelled: true,
            producer_closed: true,
        },
    )
    .await;
    let mut byte = [0];
    let closed = tokio::time::timeout(Duration::from_secs(2), stalled.read(&mut byte))
        .await
        .unwrap_or_else(|_| {
            panic!(
                "original stalled socket {stalled_tuple:?} stayed open after stop; state={:?}",
                owned_transport_state(&a, &listener),
            )
        });
    assert!(
        matches!(&closed, Ok(0))
            || matches!(&closed, Err(error) if matches!(error.kind(),
                std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::ConnectionAborted
                    | std::io::ErrorKind::BrokenPipe
                    | std::io::ErrorKind::NotConnected)),
        "original stalled socket {stalled_tuple:?} did not close: {closed:?}; state={:?}",
        owned_transport_state(&a, &listener),
    );
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        info
    );
    reopened.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_dial_cancel_stop_and_retained_channel_do_not_hold_root_after_drain() {
    let (root, a, owner_a) = host();
    let (_b, b, owner_b) = host();
    let server_pin = pin(&a, &owner_a);
    let mut listener = a
        .listen_peer_transport(&owner_a, address(), options())
        .await
        .unwrap();
    let outgoing = b
        .connect_peer_transport(
            &owner_b,
            listener.addr(),
            server_pin,
            options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let incoming = listener.accept(PeerCancellation::new()).await.unwrap();
    let stalled_server = TcpListener::bind(address()).await.unwrap();
    let cancelled = PeerCancellation::new();
    let task = {
        let b = b.clone();
        let owner = owner_b.clone();
        let token = cancelled.clone();
        let addr = stalled_server.local_addr().unwrap();
        tokio::spawn(async move {
            b.connect_peer_transport(&owner, addr, server_pin, options(), token)
                .await
        })
    };
    let (_tcp, _) = stalled_server.accept().await.unwrap();
    cancelled.cancel();
    assert!(matches!(task.await.unwrap(), Err(HostError::PeerCancelled)));
    stop(a.clone()).await;
    assert!(matches!(
        incoming.send_frame(vec![1]).await,
        Err(HostError::Stopped)
    ));
    assert!(matches!(
        incoming.read_frame().await,
        Err(HostError::Stopped)
    ));
    // Handles deliberately remain alive; socket/job drainage, not Rust handle
    // destruction, is the prerequisite for releasing the exclusive root lock.
    let reopened = BetaHost::open(root.path()).unwrap();
    reopened.stop().unwrap();
    drop(incoming);
    drop(outgoing);
    drop(listener);
    stop(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_connection_budget_includes_stalled_handshakes_and_failed_reports() {
    let (_root, host, owner) = host();
    let slow = PeerTransportOptions {
        handshake_timeout: Duration::from_secs(5),
        ..options()
    };
    let listener = host
        .listen_peer_transport(&owner, address(), slow)
        .await
        .unwrap();
    let mut clients = Vec::new();
    for _ in 0..super::super::MAX_CONNECTIONS {
        clients.push(TcpStream::connect(listener.addr()).await.unwrap());
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        while host.peers.connections.available_permits() != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let mut overflow = TcpStream::connect(listener.addr()).await.unwrap();
    let mut byte = [0];
    let closed = tokio::time::timeout(Duration::from_secs(1), overflow.read(&mut byte))
        .await
        .unwrap();
    assert!(matches!(closed, Ok(0) | Err(_)));
    // One listener plus exactly the bounded eight handshake workers.
    assert_eq!(
        host.peers.counts.lock().unwrap().jobs,
        1 + super::super::MAX_CONNECTIONS
    );
    stop(host).await;
    drop(clients);
    drop(listener);
}
