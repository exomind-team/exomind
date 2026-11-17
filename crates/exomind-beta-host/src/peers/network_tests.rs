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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stop_and_restart_retain_incoming_scope_until_its_blocking_work_drains() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (root, host, owner) = host();
    let identity = host.device_identity(&owner).unwrap();
    let network = PeerNetwork::new(host.clone(), owner).unwrap();
    network.set_enabled(true).await.unwrap();
    let completion = {
        let running = network.lifecycle.lock().await;
        running.as_ref().unwrap().incoming.clone()
    };
    let guard = completion.register().unwrap();
    let owned = host.peers.register(false).unwrap();
    let unrelated = host.peers.register(false).unwrap();
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::sync_channel(1);
    let work = tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let _owned = owned;
        entered.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(5))
            .expect("incoming generation worker release");
    });
    tokio::time::timeout(Duration::from_secs(2), ready)
        .await
        .unwrap()
        .unwrap();
    let controller = network.clone();
    let stopping = tokio::spawn(async move { controller.stop().await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !completion.state_for_test().0 {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("incoming generation reached its drain phase");
    assert!(
        !stopping.is_finished(),
        "stop returned while this generation's blocking worker still ran"
    );
    // Dropping the awaiter must leave the old scope reachable in lifecycle.
    stopping.abort();
    assert!(stopping.await.unwrap_err().is_cancelled());
    {
        let running = network.lifecycle.lock().await;
        assert!(Arc::ptr_eq(
            &running.as_ref().unwrap().incoming,
            &completion
        ));
    }
    let mut restarting = Box::pin(network.ensure_started());
    std::future::poll_fn(|cx| {
        assert!(
            std::future::Future::poll(restarting.as_mut(), cx).is_pending(),
            "new generation overlapped undrained incoming work"
        );
        std::task::Poll::Ready(())
    })
    .await;
    assert!(network.local_addresses().unwrap().is_empty());
    drop(restarting);
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), work)
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), network.stop())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completion.state_for_test(), (true, 0));
    assert!(
        host.peers.counts.lock().unwrap().jobs >= 1,
        "the unrelated global peer lease is still held; scoped stop must not wait for it"
    );
    network.set_enabled(true).await.unwrap();
    {
        let running = network.lifecycle.lock().await;
        assert!(!Arc::ptr_eq(
            &running.as_ref().unwrap().incoming,
            &completion
        ));
    }
    network.stop().await.unwrap();
    drop(unrelated);
    stopped(host).await;
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        identity
    );
    reopened.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_stop_before_join_cannot_reuse_the_stopping_generation() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (root, host, owner) = host();
    let identity = host.device_identity(&owner).unwrap();
    let network = PeerNetwork::new(host.clone(), owner).unwrap();
    network.set_enabled(true).await.unwrap();
    let completion = {
        let running = network.lifecycle.lock().await;
        running.as_ref().unwrap().incoming.clone()
    };
    let entered = PeerCancellation::new();
    let release = PeerCancellation::new();
    completion.set_worker_exit_hook(entered.clone(), release.clone());
    let controller = network.clone();
    let stopping = tokio::spawn(async move { controller.stop().await });
    tokio::time::timeout(Duration::from_secs(2), entered.cancelled())
        .await
        .expect("worker reached early pre-join exit barrier");
    stopping.abort();
    assert!(stopping.await.unwrap_err().is_cancelled());
    // Unlike the later incoming.closed test, this explicitly freezes the
    // window BEFORE the old JoinHandle completed or its scope was closed.
    {
        let running = network.lifecycle.lock().await;
        let run = running.as_ref().unwrap();
        assert!(run.cancel.is_cancelled());
        assert!(!run.joined);
        assert!(!run.task.is_finished());
        assert!(Arc::ptr_eq(&run.incoming, &completion));
    }
    assert!(!completion.state_for_test().0);
    let mut restarting = Box::pin(network.ensure_started());
    let early = std::future::poll_fn(|cx| {
        std::task::Poll::Ready(std::future::Future::poll(restarting.as_mut(), cx))
    })
    .await;
    let returned_early = early.is_ready();
    let addresses_before_release = network.local_addresses().unwrap();
    // Always release our own barrier before the behavioral assertion so a
    // failing regression cannot strand the synthetic worker.
    release.cancel();
    if !returned_early {
        tokio::time::timeout(Duration::from_secs(3), &mut restarting)
            .await
            .expect("restart after releasing old worker")
            .unwrap();
    }
    drop(restarting);
    let new_scope = {
        let running = network.lifecycle.lock().await;
        running.as_ref().unwrap().incoming.clone()
    };
    let addresses_after = network.local_addresses().unwrap();
    network.stop().await.unwrap();
    stopped(host).await;
    assert!(
        !returned_early,
        "start returned before the cancelled generation joined: {early:?}"
    );
    assert!(addresses_before_release.is_empty());
    assert!(!addresses_after.is_empty());
    assert!(!Arc::ptr_eq(&new_scope, &completion));
    assert_eq!(completion.state_for_test(), (true, 0));
    let reopened = BetaHost::open(root.path()).unwrap();
    assert_eq!(
        reopened
            .device_identity(&reopened.owner_session().unwrap())
            .unwrap(),
        identity
    );
    reopened.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_join_failure_is_reported_before_a_drained_generation_can_restart() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_root, host, owner) = host();
    let network = PeerNetwork::new(host.clone(), owner).unwrap();
    network.set_enabled(true).await.unwrap();
    let completion = {
        let running = network.lifecycle.lock().await;
        let run = running.as_ref().unwrap();
        run.task.abort();
        run.incoming.clone()
    };
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if network
                .lifecycle
                .lock()
                .await
                .as_ref()
                .unwrap()
                .task
                .is_finished()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    })
    .await
    .expect("owned worker abort completed");
    let first = network.stop().await;
    assert!(
        matches!(first, Err(HostError::Shutdown)),
        "this drain must report its JoinError"
    );
    assert_eq!(completion.state_for_test(), (true, 0));
    // Only a subsequent explicit retry may use the proven-drained scope and
    // replace it. It cannot erase the preceding call's honest failure.
    network.ensure_started().await.unwrap();
    {
        let running = network.lifecycle.lock().await;
        assert!(!Arc::ptr_eq(
            &running.as_ref().unwrap().incoming,
            &completion
        ));
    }
    assert!(!network.local_addresses().unwrap().is_empty());
    network.stop().await.unwrap();
    stopped(host).await;
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
fn discovery_snapshot(network: &PeerNetwork, profile: ProfileId, peer: DeviceId) -> String {
    let shared = {
        let state = network.shared.lock().unwrap();
        let candidates = state.candidates.get(&peer).map(|rows| {
            rows.iter()
                .map(|row| {
                    (
                        row.endpoint,
                        row.expires.saturating_duration_since(Instant::now()),
                    )
                })
                .collect::<Vec<_>>()
        });
        let progress = state.progress.get(&(profile, peer)).map(|row| {
            (
                row.busy,
                row.connection,
                row.error,
                row.failures,
                row.retry
                    .map(|at| at.saturating_duration_since(Instant::now())),
            )
        });
        format!(
            "generation={} addresses={:?} candidates={candidates:?} progress={progress:?} forced={} cursor={}",
            state.generation,
            state.addresses,
            state.forced.contains(&(profile, peer)),
            state.route_cursor
        )
    };
    let routes = network.host.peer_routes(&network.owner).map(|rows| {
        rows.into_iter()
            .filter(|row| row.profile == profile && row.device == peer)
            .map(|row| row.endpoints)
            .collect::<Vec<_>>()
    });
    format!("{shared} durable_routes={routes:?}")
}
async fn until_hint(
    stage: &str,
    socket: &UdpSocket,
    hints: &[Vec<u8>],
    mut condition: impl FnMut() -> bool,
    snapshot: impl Fn() -> String,
) {
    let end = Instant::now() + Duration::from_secs(18);
    loop {
        if condition() {
            return;
        }
        assert!(
            Instant::now() < end,
            "discovery stage {stage} timed out: {}",
            snapshot()
        );
        // Real discovery advertises periodically. Keep the same finite stage
        // deadline, but don't assume the worker bound UDP before start returned.
        for bytes in hints {
            let sent = tokio::time::timeout(
                end.saturating_duration_since(Instant::now()),
                socket.send_to(
                    bytes,
                    SocketAddr::from((Ipv4Addr::LOCALHOST, DISCOVERY_PORT)),
                ),
            )
            .await;
            assert!(
                matches!(sent, Ok(Ok(_))),
                "discovery stage {stage} hint send failed: {}",
                snapshot()
            );
        }
        tokio::time::sleep(
            Duration::from_millis(200).min(end.saturating_duration_since(Instant::now())),
        )
        .await;
    }
}
async fn pair_hosts(a: &Arc<BetaHost>, oa: &Session, b: &Arc<BetaHost>, ob: &Session) -> ProfileId {
    let p = ProfileId::new();
    a.provision_profile(oa, p, "same native profile").unwrap();
    pair_into_profile(a, oa, b, ob, p).await;
    p
}
async fn pair_into_profile(
    a: &Arc<BetaHost>,
    oa: &Session,
    b: &Arc<BetaHost>,
    ob: &Session,
    p: ProfileId,
) {
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
}

async fn serve_only(
    host: &Arc<BetaHost>,
    owner: &Session,
) -> (SocketAddr, PeerCancellation, tokio::task::JoinHandle<()>) {
    let mut listener = host
        .listen_peer_transport(owner, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap();
    let address = listener.addr();
    let cancel = PeerCancellation::new();
    let stop = cancel.clone();
    let host = host.clone();
    let owner = owner.clone();
    let task = tokio::spawn(async move {
        loop {
            match listener.accept(stop.clone()).await {
                Ok(channel) => {
                    host.accept_peer_service(&owner, channel).await.unwrap();
                }
                Err(HostError::PeerTimeout) => {}
                Err(HostError::PeerCancelled) => break,
                Err(error) => panic!("owned service listener: {error}"),
            }
        }
    });
    (address, cancel, task)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_discovery_memo_detects_received_origin_on_either_endpoint() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let (_rc, c, oc) = host();
    let (_rd, d, od) = host();
    let p = pair_hosts(&a, &oa, &b, &ob).await;
    pair_into_profile(&a, &oa, &c, &oc, p).await;
    // A owns the B/C join edges; C can invite a fresh D. Do not replace C's
    // existing issuer binding to manufacture a B<->C pair for this fixture.
    pair_into_profile(&c, &oc, &d, &od, p).await;
    let (address, stop_a, service_a) = serve_only(&a, &oa).await;
    let (local, stop_c, service_c) = serve_only(&c, &oc).await;
    // Exercise the actual worker's finite memo path with real service
    // endpoints, but without a discovery reactor or automatic forced jobs.
    let controller = PeerNetwork::new(c.clone(), oc.clone()).unwrap();
    controller.shared.lock().unwrap().addresses = vec![local];
    let worker = controller.worker();
    let route = Route {
        profile: p,
        device: a.device_id,
        endpoints: vec![address],
    };
    let pin = a.device_identity(&oa).unwrap().fingerprint_sha256;
    let mut memo = None;
    for _ in 0..4 {
        let value = worker
            .transfer_attempt(
                &route,
                &pin,
                PeerCancellation::new(),
                0,
                c.local_history_fingerprint(&oc, p).unwrap(),
                memo.clone(),
                false,
            )
            .await
            .unwrap();
        match value {
            Some(value) => memo = Some(value),
            None => break,
        }
    }
    assert!(memo.as_ref().is_some_and(|m| m.events_complete));
    let idle = worker
        .transfer_attempt(
            &route,
            &pin,
            PeerCancellation::new(),
            0,
            c.local_history_fingerprint(&oc, p).unwrap(),
            memo.clone(),
            false,
        )
        .await
        .unwrap();
    assert!(
        idle.is_none(),
        "unchanged history must retain the cheap probe path"
    );
    let own_a = a.local_origin_state(&oa, p).unwrap();
    let own_c = c.local_origin_state(&oc, p).unwrap();
    record(
        &b,
        &ob,
        p,
        "B history reaches the hub without a hub-authored fact",
    );
    let channel = b
        .connect_peer_transport(
            &ob,
            address,
            PeerPin::from_sha256(&pin).unwrap(),
            transport_options(),
            PeerCancellation::new(),
        )
        .await
        .unwrap();
    b.select_peer_service(
        &ob,
        &channel,
        PeerServiceKind::Sync,
        Some(p),
        Some(a.device_id),
        0,
    )
    .await
    .unwrap();
    b.synchronize_peer_profile_over_transport(
        &ob,
        p,
        a.device_id,
        channel,
        PeerSyncOptions::default(),
    )
    .await
    .unwrap();
    assert_eq!(a.local_origin_state(&oa, p).unwrap(), own_a);
    assert_eq!(c.local_origin_state(&oc, p).unwrap(), own_c);
    let pull = worker
        .transfer_attempt(
            &route,
            &pin,
            PeerCancellation::new(),
            0,
            c.local_history_fingerprint(&oc, p).unwrap(),
            memo.clone(),
            false,
        )
        .await
        .unwrap();
    let arrived = facts(&c, &oc, p) == facts(&b, &ob, p);
    if let Some(value) = pull.clone() {
        memo = Some(value);
    }
    // Settle the frozen inventory memo again before introducing an update
    // only at the local endpoint. All three memberships existed beforehand.
    let mut local_forwarded = false;
    if arrived {
        for _ in 0..4 {
            match worker
                .transfer_attempt(
                    &route,
                    &pin,
                    PeerCancellation::new(),
                    0,
                    c.local_history_fingerprint(&oc, p).unwrap(),
                    memo.clone(),
                    false,
                )
                .await
                .unwrap()
            {
                Some(value) => memo = Some(value),
                None => break,
            }
        }
        assert!(
            worker
                .transfer_attempt(
                    &route,
                    &pin,
                    PeerCancellation::new(),
                    0,
                    c.local_history_fingerprint(&oc, p).unwrap(),
                    memo.clone(),
                    false
                )
                .await
                .unwrap()
                .is_none()
        );
        record(
            &d,
            &od,
            p,
            "D history reaches only C while C's own origin stays fixed",
        );
        let local_pin = c.device_identity(&oc).unwrap().fingerprint_sha256;
        let channel = d
            .connect_peer_transport(
                &od,
                local,
                PeerPin::from_sha256(&local_pin).unwrap(),
                transport_options(),
                PeerCancellation::new(),
            )
            .await
            .unwrap();
        d.select_peer_service(
            &od,
            &channel,
            PeerServiceKind::Sync,
            Some(p),
            Some(c.device_id),
            0,
        )
        .await
        .unwrap();
        d.synchronize_peer_profile_over_transport(
            &od,
            p,
            c.device_id,
            channel,
            PeerSyncOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(facts(&a, &oa, p).len(), 1);
        assert_eq!(a.local_origin_state(&oa, p).unwrap(), own_a);
        assert_eq!(c.local_origin_state(&oc, p).unwrap(), own_c);
        let push = worker
            .transfer_attempt(
                &route,
                &pin,
                PeerCancellation::new(),
                0,
                c.local_history_fingerprint(&oc, p).unwrap(),
                memo.clone(),
                false,
            )
            .await
            .unwrap();
        local_forwarded = push.is_some()
            && facts(&a, &oa, p) == facts(&c, &oc, p)
            && facts(&a, &oa, p).len() == 2;
    }
    // Cleanup before asserting the intended red condition.
    stop_a.cancel();
    stop_c.cancel();
    service_a.await.unwrap();
    service_c.await.unwrap();
    drop(controller);
    stopped(a).await;
    stopped(b).await;
    stopped(c).await;
    stopped(d).await;
    assert!(
        pull.is_some() && arrived,
        "remote third-origin progress was mistaken for unchanged own-origin state"
    );
    assert!(memo.is_some());
    assert!(
        local_forwarded,
        "local third-origin progress was mistaken for unchanged own-origin state"
    );
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
    let _discovery = crate::peers::test_discovery::lease().await;
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
    let _discovery = crate::peers::test_discovery::lease().await;
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
async fn idle_native_controllers_forward_third_origin_without_a_hub_local_write() {
    // 8d49542c / 68e5bd54 / ac1dcc95 / 90d8bd80. No UI, manual refresh,
    // forced synchronize or B<->C membership may make this regression pass.
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let (_rc, c, oc) = host();
    let p = ProfileId::new();
    a.provision_profile(&oa, p, "three native controllers")
        .unwrap();
    let na = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let nb = PeerNetwork::new(b.clone(), ob.clone()).unwrap();
    let nc = PeerNetwork::new(c.clone(), oc.clone()).unwrap();
    let invite = na.create_invitation(p).await.unwrap().invitation.unwrap();
    nb.join(&invite, Uuid::new_v4()).await.unwrap();
    let invite = na.create_invitation(p).await.unwrap().invitation.unwrap();
    nc.join(&invite, Uuid::new_v4()).await.unwrap();
    let initialized = tokio::time::timeout(Duration::from_secs(18), async {
        loop {
            let idle = [&na, &nb, &nc].iter().all(|n| {
                n.status(p)
                    .unwrap()
                    .peers
                    .iter()
                    .all(|v| v.event_sync == "complete")
            });
            if idle {
                break;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .is_ok();
    let hub_before = a.local_origin_state(&oa, p).unwrap();
    record(&b, &ob, p, "B changes after the idle memo was established");
    let hub_received = tokio::time::timeout(Duration::from_secs(18), async {
        while facts(&a, &oa, p).len() != 1 {
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .is_ok();
    let forwarded = tokio::time::timeout(Duration::from_secs(18), async {
        while facts(&c, &oc, p) != facts(&b, &ob, p) {
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .is_ok();
    let hub_unchanged = a.local_origin_state(&oa, p).unwrap() == hub_before;
    let no_pair = b
        .peer_members(&ob, p)
        .unwrap()
        .iter()
        .all(|m| m.device_id != c.device_id)
        && c.peer_members(&oc, p)
            .unwrap()
            .iter()
            .all(|m| m.device_id != b.device_id);
    let snapshots = (
        facts(&a, &oa, p).len(),
        facts(&b, &ob, p).len(),
        facts(&c, &oc, p).len(),
    );
    na.stop().await.unwrap();
    nb.stop().await.unwrap();
    nc.stop().await.unwrap();
    drop((na, nb, nc));
    stopped(a).await;
    stopped(b).await;
    stopped(c).await;
    assert!(initialized, "initial idle snapshot did not settle");
    assert!(hub_received, "B never reached its paired hub");
    assert!(
        hub_unchanged,
        "test accidentally advanced the hub's own origin"
    );
    assert!(
        no_pair,
        "third-source forwarding must not create network membership"
    );
    assert!(
        forwarded,
        "third-origin history stayed behind an idle own-origin memo; fact counts {snapshots:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn discovery_is_only_a_ttl_hint_until_pinned_service_promotes_it_and_keeps_old_routes() {
    let _discovery = crate::peers::test_discovery::lease().await;
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
    let mut hints = vec![];
    for device in [unknown, b.device_id] {
        let bytes = serde_json::to_vec(&Announcement {
            protocol: "exomind-discovery/1".into(),
            device_id: device,
            fingerprint_sha256: pin.clone(),
            listen_port: bad.port(),
        })
        .unwrap();
        hints.push(bytes);
    }
    until_hint(
        "unverified candidate observed",
        &socket,
        &hints,
        || {
            network
                .shared
                .lock()
                .unwrap()
                .candidates
                .get(&b.device_id)
                .is_some_and(|v| v.iter().any(|c| c.endpoint == bad))
        },
        || discovery_snapshot(&network, p, b.device_id),
    )
    .await;
    assert!(
        !network
            .shared
            .lock()
            .unwrap()
            .candidates
            .contains_key(&unknown)
    );
    until_hint(
        "unverified route fails pinned TLS",
        &socket,
        &hints,
        || {
            network
                .shared
                .lock()
                .unwrap()
                .progress
                .get(&(p, b.device_id))
                .is_some_and(|v| v.error.is_some())
        },
        || discovery_snapshot(&network, p, b.device_id),
    )
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
    until_hint(
        "verified candidate promoted preserving previous route",
        &socket,
        &[bytes],
        || {
            a.peer_routes(&oa).unwrap().iter().any(|r| {
                r.profile == p && r.device == b.device_id && r.endpoints.contains(&address)
            })
        },
        || discovery_snapshot(&network, p, b.device_id),
    )
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
    let _discovery = crate::peers::test_discovery::lease().await;
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tcp_eof_keeps_original_listener_generation_and_signed_join_available() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let p = ProfileId::new();
    a.provision_profile(&oa, p, "TLS rejection isolation")
        .unwrap();
    let na = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let nb = PeerNetwork::new(b.clone(), ob.clone()).unwrap();
    na.set_enabled(true).await.unwrap();
    let original_address = loopback(&na);
    let original_generation = na.shared.lock().unwrap().generation;
    let invitation = a
        .create_peer_invitation(
            &oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: p,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![original_address],
                ttl_seconds: 120,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let capacity = a.peers.connections.available_permits();
    assert!(capacity > 0);
    let observed = tokio::time::timeout(Duration::from_secs(18), async {
        // Hold a real unauthenticated TCP connection until the server has
        // admitted its TLS handshake and owns its bounded connection permit.
        let raw = tokio::net::TcpStream::connect(original_address)
            .await
            .unwrap();
        until(|| a.peers.connections.available_permits() < capacity).await;
        drop(raw); // EOF without sending any TLS bytes, like nc -z.
        // The driver releases ownership only after its error was sent to the
        // listener's accepted queue. The following genuine join also proves
        // the consumer handled that earlier queued rejection without dying.
        until(|| a.peers.connections.available_permits() == capacity).await;
        let untrusted_created_member = a
            .peer_members(&oa, p)
            .unwrap()
            .iter()
            .any(|member| member.device_id != a.device_id);

        // Deliberately never call A.ensure_started/create_invitation again:
        // a hidden listener restart would invalidate this regression proof.
        let joined = nb.join(&invitation, Uuid::new_v4()).await;
        let address_stable = na.local_addresses().unwrap().contains(&original_address);
        let generation = na.shared.lock().unwrap().generation;
        let member_ready = a.peer_members(&oa, p).unwrap().iter().any(|member| {
            member.device_id == b.device_id
                && !member.revoked
                && member.state == PeerJoinState::Ready
        });
        (
            untrusted_created_member,
            joined,
            address_stable,
            generation,
            member_ready,
        )
    })
    .await;
    nb.stop().await.unwrap();
    na.stop().await.unwrap();
    drop(nb);
    drop(na);
    stopped(a).await;
    stopped(b).await;
    let (untrusted_created_member, joined, address_stable, generation, member_ready) =
        observed.expect("original finite 18s controller acceptance deadline");
    assert!(
        !untrusted_created_member,
        "raw TCP EOF must not authorize a device"
    );
    assert_eq!(
        generation, original_generation,
        "one rejected handshake must not stop/replace the listener generation"
    );
    assert!(
        address_stable,
        "the original bound address must remain available"
    );
    let joined =
        joined.expect("the original signed invitation must still complete real pinned TLS join");
    assert_eq!(joined.state, PeerJoinState::Ready);
    assert!(joined.remote_ready_observed && member_ready);
}
