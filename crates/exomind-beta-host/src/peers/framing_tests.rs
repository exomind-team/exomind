use super::*;
use crate::{BetaHost, PeerCancellation, PeerPin, PeerTransportListener, PeerTransportOptions};
use std::{future::pending, sync::Arc};
use tempfile::{TempDir, tempdir};

const TEST_TIMEOUT: Duration = Duration::from_secs(5);
struct Link {
    _a_root: TempDir,
    _b_root: TempDir,
    a: Arc<BetaHost>,
    b: Arc<BetaHost>,
    _listener: PeerTransportListener,
}
impl Link {
    async fn new() -> (Self, PeerChannel, PeerChannel) {
        let a_root = tempdir().unwrap();
        let b_root = tempdir().unwrap();
        let a = Arc::new(BetaHost::open(a_root.path()).unwrap());
        let b = Arc::new(BetaHost::open(b_root.path()).unwrap());
        let oa = a.owner_session().unwrap();
        let ob = b.owner_session().unwrap();
        let pin =
            PeerPin::from_sha256(&a.device_identity(&oa).unwrap().fingerprint_sha256).unwrap();
        let options = PeerTransportOptions {
            handshake_timeout: Duration::from_secs(2),
            channel_lifetime: Duration::from_secs(30),
        };
        let mut listener = a
            .listen_peer_transport(&oa, "127.0.0.1:0".parse().unwrap(), options)
            .await
            .unwrap();
        let outgoing = b
            .connect_peer_transport(&ob, listener.addr(), pin, options, PeerCancellation::new())
            .await
            .unwrap();
        let incoming = listener.accept(PeerCancellation::new()).await.unwrap();
        (
            Self {
                _a_root: a_root,
                _b_root: b_root,
                a,
                b,
                _listener: listener,
            },
            outgoing,
            incoming,
        )
    }
    async fn stop(self) {
        let a = self.a.clone();
        tokio::task::spawn_blocking(move || a.stop())
            .await
            .unwrap()
            .unwrap();
        let b = self.b.clone();
        tokio::task::spawn_blocking(move || b.stop())
            .await
            .unwrap()
            .unwrap();
    }
}
fn payload(length: usize) -> Vec<u8> {
    (0..length)
        .map(|i| ((i * 137 + i / 251) & 255) as u8)
        .collect()
}
fn raw_piece(id: Uuid, total: usize, offset: usize, sha: &[u8; 32], length: usize) -> Vec<u8> {
    fragment(id, total, offset, sha, &vec![0; length])
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_real_tls_two_mib_and_limit_round_trip_without_json_byte_expansion() {
    let (link, outgoing, incoming) = Link::new().await;
    let mut tx = FramedPeerChannel::new(outgoing);
    let mut rx = FramedPeerChannel::new(incoming);
    for length in [0, exomind_core::MAX_FACT_BYTES, MAX_MESSAGE_BYTES] {
        let bytes = payload(length);
        let hash = Sha256::digest(&bytes);
        let (sent, received) = tokio::join!(
            tx.send(&bytes, TEST_TIMEOUT, pending()),
            rx.receive(TEST_TIMEOUT, pending())
        );
        sent.unwrap();
        let received = received.unwrap();
        assert_eq!(received.len(), length);
        assert_eq!(Sha256::digest(&received), hash);
        let (sent, returned) = tokio::join!(
            rx.send(&received, TEST_TIMEOUT, pending()),
            tx.receive(TEST_TIMEOUT, pending())
        );
        sent.unwrap();
        let returned = returned.unwrap();
        assert_eq!(returned.len(), length);
        assert_eq!(Sha256::digest(&returned), hash);
    }
    // Integrity-verified transport bytes do not allocate any profile/member.
    let owner = link.a.owner_session().unwrap();
    assert!(
        tx.with_channel(|ch| ch.binding_pin(&link.b))
            .unwrap()
            .is_ok()
    );
    assert!(link.a.profiles(&owner).unwrap().is_empty());
    tx.close().await.unwrap();
    rx.close().await.unwrap();
    link.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_bounds_reject_sender_and_untrusted_u32_total_before_delivery() {
    let (link, outgoing, incoming) = Link::new().await;
    let mut tx = FramedPeerChannel::new(outgoing);
    let mut rx = FramedPeerChannel::new(incoming);
    assert!(matches!(
        tx.send(&vec![0; MAX_MESSAGE_BYTES + 1], TEST_TIMEOUT, pending())
            .await,
        Err(HostError::PayloadTooLarge)
    ));
    assert!(matches!(rx.receive(TEST_TIMEOUT, pending()).await, Err(_)));
    assert!(tx.with_channel(|_| ()).is_err());
    link.stop().await;
    let (link, raw, incoming) = Link::new().await;
    let mut receiver = FramedPeerChannel::new(incoming);
    raw.send_frame(raw_piece(Uuid::new_v4(), u32::MAX as usize, 0, &[0; 32], 0))
        .await
        .unwrap();
    assert!(matches!(
        receiver.receive(TEST_TIMEOUT, pending()).await,
        Err(HostError::PayloadTooLarge)
    ));
    assert!(receiver.with_channel(|_| ()).is_err());
    drop(raw);
    link.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_bad_sha_is_never_returned_and_cannot_be_reused() {
    let (link, raw, incoming) = Link::new().await;
    let mut receiver = FramedPeerChannel::new(incoming);
    raw.send_frame(fragment(Uuid::new_v4(), 3, 0, &[0; 32], b"abc"))
        .await
        .unwrap();
    assert!(matches!(
        receiver.receive(TEST_TIMEOUT, pending()).await,
        Err(HostError::InvalidRequest)
    ));
    assert!(matches!(
        receiver.receive(TEST_TIMEOUT, pending()).await,
        Err(HostError::PeerTransportUnavailable)
    ));
    drop(raw);
    link.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_mid_message_identity_total_digest_and_offset_cannot_change() {
    for fault in [
        "id",
        "total",
        "digest",
        "duplicate_changed",
        "duplicate_same",
        "gap",
    ] {
        let (link, raw, incoming) = Link::new().await;
        let mut receiver = FramedPeerChannel::new(incoming);
        let id = Uuid::new_v4();
        let total = MAX_CHUNK_BYTES + 1;
        let sha: [u8; 32] = Sha256::digest(vec![0; total]).into();
        let sender = async {
            raw.send_frame(raw_piece(id, total, 0, &sha, MAX_CHUNK_BYTES))
                .await
                .unwrap();
            let mut second = match fault {
                "id" => raw_piece(Uuid::new_v4(), total, MAX_CHUNK_BYTES, &sha, 1),
                "total" => raw_piece(id, total + 1, MAX_CHUNK_BYTES, &sha, 2),
                "digest" => raw_piece(id, total, MAX_CHUNK_BYTES, &[1; 32], 1),
                "duplicate_changed" | "duplicate_same" => {
                    raw_piece(id, total, 0, &sha, MAX_CHUNK_BYTES)
                }
                "gap" => raw_piece(id, total, total, &sha, 0),
                _ => unreachable!(),
            };
            if fault == "duplicate_changed" {
                second[HEADER_BYTES] = 255;
            }
            raw.send_frame(second).await.unwrap();
        };
        let (_, result) = tokio::join!(sender, receiver.receive(TEST_TIMEOUT, pending()));
        assert!(matches!(result, Err(HostError::InvalidRequest)), "{fault}");
        assert!(receiver.with_channel(|_| ()).is_err());
        drop(raw);
        link.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_cancellation_timeout_and_dropped_future_discard_partial_message() {
    for fault in ["cancel", "timeout", "drop"] {
        let (link, raw, incoming) = Link::new().await;
        let mut receiver = FramedPeerChannel::new(incoming);
        let total = MAX_CHUNK_BYTES + 1;
        let sha: [u8; 32] = Sha256::digest(vec![0; total]).into();
        let first = raw_piece(Uuid::new_v4(), total, 0, &sha, MAX_CHUNK_BYTES);
        let (ready, seen) = tokio::sync::oneshot::channel();
        let sender = async {
            raw.send_frame(first).await.unwrap();
            let _ = ready.send(());
        };
        if fault == "cancel" {
            let cancel = async {
                let _ = seen.await;
            };
            let (_, result) = tokio::join!(sender, receiver.receive(TEST_TIMEOUT, cancel));
            assert!(matches!(result, Err(HostError::PeerCancelled)));
        } else {
            let action = receiver.receive(
                if fault == "timeout" {
                    Duration::from_millis(50)
                } else {
                    TEST_TIMEOUT
                },
                pending(),
            );
            let result = if fault == "timeout" {
                let (_, result) = tokio::join!(sender, action);
                result
            } else {
                let reading = async {
                    tokio::pin!(action);
                    tokio::select! {biased;result=&mut action=>Some(result),_=async{let _=seen.await;}=>None}
                };
                let (_, result) = tokio::join!(sender, reading);
                assert!(result.is_none());
                Err(HostError::PeerCancelled)
            };
            if fault == "timeout" {
                assert!(matches!(result, Err(HostError::PeerTimeout)));
            }
        }
        assert!(receiver.with_channel(|_| ()).is_err());
        assert!(matches!(
            receiver.receive(TEST_TIMEOUT, pending()).await,
            Err(HostError::PeerTransportUnavailable)
        ));
        drop(raw);
        link.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_partial_header_short_fragment_and_eof_never_form_a_message() {
    for fault in ["header", "short", "eof"] {
        let (link, raw, incoming) = Link::new().await;
        let mut receiver = FramedPeerChannel::new(incoming);
        if fault == "header" {
            raw.send_frame(vec![0; HEADER_BYTES - 1]).await.unwrap();
            assert!(matches!(
                receiver.receive(TEST_TIMEOUT, pending()).await,
                Err(HostError::InvalidRequest)
            ));
        } else {
            let total = MAX_CHUNK_BYTES + 1;
            let sha = [0; 32];
            let first = raw_piece(
                Uuid::new_v4(),
                total,
                0,
                &sha,
                if fault == "short" { 3 } else { MAX_CHUNK_BYTES },
            );
            let sender = async {
                raw.send_frame(first).await.unwrap();
                raw.close().await.unwrap();
            };
            let (_, result) = tokio::join!(sender, receiver.receive(TEST_TIMEOUT, pending()));
            assert!(result.is_err());
        }
        assert!(receiver.with_channel(|_| ()).is_err());
        link.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logical_frame_host_stop_closes_partial_read_and_preserves_lifecycle_fence() {
    let (link, raw, incoming) = Link::new().await;
    let mut receiver = FramedPeerChannel::new(incoming);
    let host = link.a.clone();
    let stop = async {
        host.request_stop();
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
    };
    let (_, result) = tokio::join!(stop, receiver.receive(TEST_TIMEOUT, pending()));
    assert!(matches!(
        result,
        Err(HostError::Stopped) | Err(HostError::PeerTransportUnavailable)
    ));
    assert!(receiver.with_channel(|_| ()).is_err());
    drop(raw);
    link.stop().await;
}
