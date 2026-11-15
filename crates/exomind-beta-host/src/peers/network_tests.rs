use super::*;
use crate::{CreatePeerInvitation, PeerCapabilities};
use exomind_core::{CaptureCommand, CommandId, EventId, EventQuery};
use std::collections::BTreeMap;
use tempfile::{TempDir, tempdir};

fn transport_options() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(3),
        channel_lifetime: Duration::from_secs(120),
    }
}

fn host() -> (TempDir, Arc<BetaHost>, Session) {
    let root = tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    host.save_peer_network_settings(
        &owner,
        PeerNetworkSettings {
            enabled: false,
            preferred_port: 0,
        },
    )
    .unwrap();
    (root, host, owner)
}
async fn stopped(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
fn record(host: &BetaHost, owner: &Session, profile: ProfileId, text: &str) -> EventId {
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1000,
        text: text.into(),
        tags: vec![],
        originals: vec![],
    };
    let human = host.native_human_session(owner, profile).unwrap();
    host.capture(&human, &command).unwrap();
    command.event_id
}
fn facts(host: &BetaHost, owner: &Session, profile: ProfileId) -> BTreeMap<String, Vec<u8>> {
    let state = host.active_state().unwrap();
    host.owner(owner).unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let human = core.local_human(profile).unwrap();
    core.events_page(&human, profile, &EventQuery::default())
        .unwrap()
        .items
        .into_iter()
        .map(|e| (e.event_id.to_string(), e.canonical_fact_bytes().unwrap()))
        .collect()
}
async fn until(mut condition: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(18);
    loop {
        if condition() {
            return;
        }
        assert!(
            Instant::now() < end,
            "finite controller acceptance deadline"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}
async fn pair_hosts(a: &Arc<BetaHost>, oa: &Session, b: &Arc<BetaHost>, ob: &Session) -> ProfileId {
    let p = ProfileId::new();
    a.provision_profile(oa, p, "same native profile").unwrap();
    let mut listener = a
        .listen_peer_transport(oa, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap();
    let invitation = a
        .create_peer_invitation(
            oa,
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
    let pin = PeerPin::from_sha256(&invitation.offer.issuer.fingerprint_sha256).unwrap();
    let client = b
        .connect_peer_transport(
            ob,
            listener.addr(),
            pin,
            transport_options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    let server = listener.accept(PeerCancellation::new()).await.unwrap();
    let claim = b
        .prepare_peer_join(ob, &invitation, Uuid::new_v4())
        .unwrap();
    let receipt = a.claim_peer_invitation_verified(&server, &claim).unwrap();
    let confirmation = b.accept_peer_claim_verified(&client, &receipt).unwrap();
    let ready = a
        .confirm_peer_join_verified(&server, &confirmation)
        .unwrap();
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
    p
}
fn loopback(network: &PeerNetwork) -> SocketAddr {
    network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|a| a.ip().is_loopback())
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enabled_network_preference_restores_after_host_restart_and_disable_drains_listener() {
    let (root, a, oa) = host();
    let device = a.device_id;
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    network.set_enabled(true).await.unwrap();
    let address = loopback(&network);
    assert_ne!(address.port(), 0);
    assert!(a.peer_network_settings(&oa).unwrap().enabled);
    network.stop().await.unwrap();
    assert!(network.local_addresses().unwrap().is_empty());
    drop(network);
    stopped(a).await;
    let a = Arc::new(BetaHost::open(root.path()).unwrap());
    let oa = a.owner_session().unwrap();
    assert_eq!(a.device_id, device);
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    network.restore().await.unwrap();
    assert!(!network.local_addresses().unwrap().is_empty());
    network.set_enabled(false).await.unwrap();
    assert!(!a.peer_network_settings(&oa).unwrap().enabled);
    assert!(network.local_addresses().unwrap().is_empty());
    drop(network);
    stopped(a).await;
    let a = Arc::new(BetaHost::open(root.path()).unwrap());
    let network = PeerNetwork::new(a.clone(), a.owner_session().unwrap()).unwrap();
    network.restore().await.unwrap();
    assert!(network.local_addresses().unwrap().is_empty());
    drop(network);
    stopped(a).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_owned_controllers_sync_without_ui_and_notice_new_local_or_remote_heads() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let p = ProfileId::new();
    let q = ProfileId::new();
    a.provision_profile(&oa, p, "same native profile").unwrap();
    b.provision_profile(&ob, q, "same native profile").unwrap();
    record(&b, &ob, q, "Q remains separate");
    let na = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let nb = PeerNetwork::new(b.clone(), ob.clone()).unwrap();
    let invitation = na.create_invitation(p).await.unwrap().invitation.unwrap();
    nb.join(&invitation, Uuid::new_v4()).await.unwrap();
    record(&a, &oa, p, "A with no React mounted");
    record(&b, &ob, p, "B with no React mounted");
    until(|| facts(&a, &oa, p).len() == 2 && facts(&a, &oa, p) == facts(&b, &ob, p)).await;
    let expected = facts(&a, &oa, p);
    assert_eq!(expected.len(), 2);
    record(&a, &oa, p, "A changes after completed sync");
    until(|| facts(&a, &oa, p).len() == 3 && facts(&a, &oa, p) == facts(&b, &ob, p)).await;
    record(&b, &ob, p, "B changes after completed sync");
    until(|| facts(&a, &oa, p).len() == 4 && facts(&a, &oa, p) == facts(&b, &ob, p)).await;
    until(|| {
        na.status(p)
            .unwrap()
            .peers
            .iter()
            .any(|v| v.device_id == b.device_id && v.event_sync == "complete")
            && nb
                .status(p)
                .unwrap()
                .peers
                .iter()
                .any(|v| v.device_id == a.device_id && v.event_sync == "complete")
    })
    .await;
    assert_eq!(facts(&b, &ob, q).len(), 1);
    assert_eq!(b.profiles(&ob).unwrap().len(), 2);
    assert_eq!(a.profiles(&oa).unwrap().len(), 1);
    na.stop().await.unwrap();
    nb.stop().await.unwrap();
    drop(na);
    drop(nb);
    stopped(a).await;
    stopped(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn discovery_is_only_a_ttl_hint_until_pinned_service_promotes_it_and_keeps_old_routes() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let p = pair_hosts(&a, &oa, &b, &ob).await;
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    network.set_enabled(true).await.unwrap();
    let dummy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bad = dummy.local_addr().unwrap();
    let previous = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let old = previous.local_addr().unwrap();
    a.save_peer_routes(&oa, p, b.device_id, vec![old]).unwrap();
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let pin = b.device_identity(&ob).unwrap().fingerprint_sha256;
    let unknown = DeviceId::new();
    for device in [unknown, b.device_id] {
        let bytes = serde_json::to_vec(&Announcement {
            protocol: "exomind-discovery/1".into(),
            device_id: device,
            fingerprint_sha256: pin.clone(),
            listen_port: bad.port(),
        })
        .unwrap();
        socket
            .send_to(
                &bytes,
                SocketAddr::from((Ipv4Addr::LOCALHOST, DISCOVERY_PORT)),
            )
            .await
            .unwrap();
    }
    until(|| {
        network
            .shared
            .lock()
            .unwrap()
            .candidates
            .get(&b.device_id)
            .is_some_and(|v| v.iter().any(|c| c.endpoint == bad))
    })
    .await;
    assert!(
        !network
            .shared
            .lock()
            .unwrap()
            .candidates
            .contains_key(&unknown)
    );
    until(|| {
        network
            .shared
            .lock()
            .unwrap()
            .progress
            .get(&(p, b.device_id))
            .is_some_and(|v| v.error.is_some())
    })
    .await;
    assert_eq!(
        a.peer_routes(&oa)
            .unwrap()
            .into_iter()
            .find(|r| r.profile == p && r.device == b.device_id)
            .unwrap()
            .endpoints,
        vec![old]
    );
    // A valid discovery candidate works even if no prior endpoint was usable.
    // The B fixture owns only its Rust listener/service, with no frontend.
    let mut listener = b
        .listen_peer_transport(&ob, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap();
    let address = listener.addr();
    let cancel = PeerCancellation::new();
    let stop = cancel.clone();
    let target = b.clone();
    let owner = ob.clone();
    let server = tokio::spawn(async move {
        loop {
            match listener.accept(stop.clone()).await {
                Ok(channel) => {
                    let _ = target.accept_peer_service(&owner, channel).await;
                }
                Err(HostError::PeerTimeout) => {}
                Err(_) => break,
            }
        }
    });
    let bytes = serde_json::to_vec(&Announcement {
        protocol: "exomind-discovery/1".into(),
        device_id: b.device_id,
        fingerprint_sha256: pin,
        listen_port: address.port(),
    })
    .unwrap();
    socket
        .send_to(
            &bytes,
            SocketAddr::from((Ipv4Addr::LOCALHOST, DISCOVERY_PORT)),
        )
        .await
        .unwrap();
    until(|| {
        a.peer_routes(&oa)
            .unwrap()
            .iter()
            .any(|r| r.profile == p && r.device == b.device_id && r.endpoints.contains(&address))
    })
    .await;
    let routes = a.peer_routes(&oa).unwrap();
    let route = routes
        .iter()
        .find(|r| r.profile == p && r.device == b.device_id)
        .unwrap();
    assert!(route.endpoints.contains(&old));
    assert!(!route.endpoints.contains(&bad));
    network.stop().await.unwrap();
    cancel.cancel();
    server.await.unwrap();
    drop(network);
    drop(dummy);
    drop(previous);
    stopped(a).await;
    stopped(b).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_attempt_clears_busy_and_dropped_controller_has_no_strong_task_cycle() {
    let (ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let p = pair_hosts(&a, &oa, &b, &ob).await;
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    network.set_enabled(true).await.unwrap();
    let weak = Arc::downgrade(&network);
    let mut listener = b
        .listen_peer_transport(&ob, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap();
    let route = Route {
        profile: p,
        device: b.device_id,
        endpoints: vec![listener.addr()],
    };
    let worker = network.worker();
    let generation = network.shared.lock().unwrap().generation;
    let cancel = network
        .lifecycle
        .lock()
        .await
        .as_ref()
        .unwrap()
        .cancel
        .clone();
    let task = tokio::spawn(async move { worker.attempt(route, cancel, generation, true).await });
    let channel = listener.accept(PeerCancellation::new()).await.unwrap();
    let header = channel.read_frame().await.unwrap();
    assert!(!header.is_empty());
    assert!(
        network
            .shared
            .lock()
            .unwrap()
            .progress
            .get(&(p, b.device_id))
            .unwrap()
            .busy
    );
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    until(|| {
        network
            .shared
            .lock()
            .unwrap()
            .progress
            .get(&(p, b.device_id))
            .is_some_and(|p| !p.busy && p.busy_id.is_none())
    })
    .await;
    drop(channel);
    drop(listener);
    drop(network);
    assert!(
        weak.upgrade().is_none(),
        "task must not own Arc<PeerNetwork>"
    );
    let wait = a.clone();
    tokio::task::spawn_blocking(move || wait.peers.wait_empty(Duration::from_secs(5)))
        .await
        .unwrap()
        .unwrap();
    drop(a);
    let reopened = BetaHost::open(ra.path()).unwrap();
    reopened.stop().unwrap();
    stopped(b).await;
}
