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

fn legacy_announcement(
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
) -> Announcement {
    Announcement {
        device_id,
        fingerprint_sha256,
        listen_port,
        alias: None,
    }
}

fn enriched_announcement(
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
    effective_alias: impl Into<String>,
    source: EnvironmentAliasSource,
    revision: u64,
) -> Announcement {
    Announcement {
        device_id,
        fingerprint_sha256,
        listen_port,
        alias: Some(AnnouncementAlias {
            effective_alias: effective_alias.into(),
            source,
            revision,
        }),
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
    let reopened = Arc::new(BetaHost::open(root.path()).unwrap());
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

#[test]
fn environment_alias_is_normalized_persisted_and_device_global() {
    let (root, host, owner) = host();
    let device_id = host.device_id;
    let initial = host.environment_alias(&owner).unwrap();
    assert_eq!(host.environment_alias_announcement(&owner).unwrap().2, 0);
    assert_eq!(initial.device_id, device_id);
    assert!(!initial.effective_alias.is_empty());
    assert_eq!(initial.custom_alias, None);
    assert!(matches!(
        initial.source,
        super::super::EnvironmentAliasSource::OsDefault
            | super::super::EnvironmentAliasSource::StableId
    ));

    let saved = host
        .set_environment_alias(&owner, Some("  Travel\t\t Room\nPC  ".into()))
        .unwrap();
    assert_eq!(saved.effective_alias, "Travel Room PC");
    assert_eq!(saved.custom_alias.as_deref(), Some("Travel Room PC"));
    assert_eq!(saved.source, super::super::EnvironmentAliasSource::Custom);
    assert_eq!(host.environment_alias_announcement(&owner).unwrap().2, 1);

    let before_invalid = host.environment_alias(&owner).unwrap();
    for invalid in [
        String::new(),
        "   ".into(),
        "bad\u{0}value".into(),
        "bad\u{7f}value".into(),
        "x".repeat(super::super::MAX_ENVIRONMENT_ALIAS_CHARS + 1),
    ] {
        assert!(matches!(
            host.set_environment_alias(&owner, Some(invalid)),
            Err(HostError::InvalidRequest)
        ));
        assert_eq!(host.environment_alias(&owner).unwrap(), before_invalid);
    }

    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    let reopened_owner = reopened.owner_session().unwrap();
    assert_eq!(reopened.device_id, device_id);
    assert_eq!(
        reopened.environment_alias(&reopened_owner).unwrap(),
        saved
    );
    let reset = reopened
        .set_environment_alias(&reopened_owner, None)
        .unwrap();
    assert_eq!(reset.custom_alias, None);
    assert_eq!(
        reopened
            .environment_alias_announcement(&reopened_owner)
            .unwrap()
            .2,
        2
    );
    assert!(matches!(
        reset.source,
        super::super::EnvironmentAliasSource::OsDefault
            | super::super::EnvironmentAliasSource::StableId
    ));
    reopened.stop().unwrap();
}

#[cfg(windows)]
#[test]
fn windows_environment_alias_uses_the_host_name_by_default() {
    let (_root, host, owner) = host();
    let alias = host.environment_alias(&owner).unwrap();
    assert_eq!(
        alias.source,
        super::super::EnvironmentAliasSource::OsDefault
    );
    assert!(!alias.effective_alias.is_empty());
    assert!(!alias.effective_alias.chars().any(char::is_control));
    host.stop().unwrap();
}

#[test]
fn default_environment_name_changes_advance_the_wire_revision_once() {
    let (root, host, _owner) = host();
    host.stop().unwrap();
    let database = rusqlite::Connection::open(root.path().join("host-auth.sqlite3")).unwrap();
    assert_eq!(
        super::super::network_store::advance_environment_alias_announcement(
            &database,
            "DESKTOP-A",
            EnvironmentAliasSource::OsDefault,
        )
        .unwrap(),
        0
    );
    assert_eq!(
        super::super::network_store::advance_environment_alias_announcement(
            &database,
            "DESKTOP-A",
            EnvironmentAliasSource::OsDefault,
        )
        .unwrap(),
        0
    );
    assert_eq!(
        super::super::network_store::advance_environment_alias_announcement(
            &database,
            "DESKTOP-B",
            EnvironmentAliasSource::OsDefault,
        )
        .unwrap(),
        1
    );
}

#[test]
fn corrupt_oversized_environment_alias_fails_closed_before_loading_the_string() {
    let (root, host, _owner) = host();
    host.stop().unwrap();
    let database = rusqlite::Connection::open(root.path().join("host-auth.sqlite3")).unwrap();
    database.pragma_update(None, "ignore_check_constraints", true).unwrap();
    database
        .execute(
            "UPDATE peer_environment_alias SET custom_alias=?1 WHERE singleton=1",
            ["x".repeat(super::super::MAX_ENVIRONMENT_ALIAS_CHARS + 1)],
        )
        .unwrap();
    assert!(matches!(
        super::super::network_store::environment_alias_state(&database),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
}

#[test]
fn discovery_frames_keep_legacy_presence_and_reject_a_forged_signed_alias() {
    let (_root, host, owner) = host();
    let identity = host.transport_identity(&owner).unwrap();
    let (legacy, enriched) = discovery_frames(
        &identity,
        43344,
        Some(AnnouncementAlias {
            effective_alias: "Travel Room PC".into(),
            source: EnvironmentAliasSource::Custom,
            revision: 1,
        }),
    );
    let legacy = parse_announcement(&legacy.unwrap()).unwrap();
    assert!(legacy.alias.is_none());
    assert_eq!(legacy.device_id, identity.info.device_id);

    let enriched = enriched.unwrap();
    let signed = parse_announcement(&enriched).unwrap();
    assert_eq!(
        signed.alias,
        Some(AnnouncementAlias {
            effective_alias: "Travel Room PC".into(),
            source: EnvironmentAliasSource::Custom,
            revision: 1,
        })
    );

    let (legacy_only, no_enriched) = discovery_frames(&identity, 43344, None);
    assert!(legacy_only.is_some());
    assert!(no_enriched.is_none());

    let mut forged: serde_json::Value = serde_json::from_slice(&enriched).unwrap();
    forged["effective_alias"] = serde_json::Value::String("Forged PC".into());
    assert!(parse_announcement(&serde_json::to_vec(&forged).unwrap()).is_none());
    host.stop().unwrap();
}

#[test]
fn legacy_presence_does_not_extend_a_signed_alias_ttl() {
    let (_root, host, owner) = host();
    let network = PeerNetwork::new(host.clone(), owner).unwrap();
    let device = DeviceId::new();
    let pin = "a".repeat(64);
    let initial_expiry = Instant::now() + Duration::from_millis(100);
    network.shared.lock().unwrap().observed_aliases.insert(
        (device, pin.clone()),
        ObservedAlias {
            alias: "Signed once".into(),
            source: EnvironmentAliasSource::Custom,
            revision: 1,
            expires: initial_expiry,
        },
    );
    network
        .worker()
        .remember_announcement(
            legacy_announcement(device, pin.clone(), 43344),
            "192.0.2.30:43344".parse().unwrap(),
            0,
        )
        .unwrap();
    let stored_expiry = network
        .shared
        .lock()
        .unwrap()
        .observed_aliases
        .get(&(device, pin))
        .unwrap()
        .expires;
    assert_eq!(stored_expiry, initial_expiry);
    host.stop().unwrap();
}

#[test]
fn unpaired_signed_alias_is_visible_in_memory_but_does_not_consume_claim_storage() {
    let (_root, host, owner) = host();
    let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
    let device = DeviceId::new();
    network
        .worker()
        .remember_announcement(
            enriched_announcement(
                device,
                "a".repeat(64),
                43344,
                "Unpaired nearby",
                EnvironmentAliasSource::Custom,
                1,
            ),
            "192.0.2.31:43344".parse().unwrap(),
            0,
        )
        .unwrap();
    assert!(network.nearby_candidates().unwrap().iter().any(|candidate| {
        candidate.device_id == device && candidate.effective_alias == "Unpaired nearby"
    }));
    assert!(host.peer_alias_claims(&owner).unwrap().is_empty());
    drop(network);
    host.stop().unwrap();
}

#[test]
fn unconfirmed_alias_claim_hides_after_ttl_but_confirmed_claim_does_not() {
    let device = DeviceId::new();
    let stale = PeerAliasClaim {
        effective_alias: "Stale signed name".into(),
        source: EnvironmentAliasSource::Custom,
        revision: 1,
        observed_at_ms: now() - CANDIDATE_TTL.as_millis() as i64 - 1,
        confirmed_at_ms: None,
    };
    assert_eq!(alias_projection(device, None, Some(&stale)).2, "none");

    let fresh = PeerAliasClaim {
        observed_at_ms: now(),
        ..stale.clone()
    };
    assert_eq!(alias_projection(device, None, Some(&fresh)).2, "signed");

    let confirmed = PeerAliasClaim {
        confirmed_at_ms: Some(now()),
        ..stale
    };
    assert_eq!(
        alias_projection(device, None, Some(&confirmed)).2,
        "confirmed"
    );
}

#[test]
fn alias_confirmation_requires_complete_records_and_no_reported_original_gap() {
    let mut result = PeerSyncResult {
        events_complete: true,
        ..PeerSyncResult::default()
    };
    assert!(alias_confirmation_eligible(&result));
    result.local_missing_originals = true;
    assert!(!alias_confirmation_eligible(&result));
    result.local_missing_originals = false;
    result.peer_missing_originals = true;
    assert!(!alias_confirmation_eligible(&result));
    result.peer_missing_originals = false;
    result.local_projection_complete = Some(false);
    assert!(!alias_confirmation_eligible(&result));
    result.local_projection_complete = Some(true);
    result.peer_projection_complete = Some(false);
    assert!(!alias_confirmation_eligible(&result));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_alias_confirmation_survives_restart_and_changed_alias_invalidates_old_value() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (root, a, oa) = host();
    let (_rb, b, ob) = host();
    let profile = pair_hosts(&a, &oa, &b, &ob).await;
    let pin = b.device_identity(&ob).unwrap().fingerprint_sha256;
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let generation = network.shared.lock().unwrap().generation;

    let initial = network.status(profile).unwrap();
    let peer = initial
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.alias_verification, "none");
    assert_eq!(peer.alias_source, EnvironmentAliasSource::StableId);
    assert_eq!(peer.alias_confirmed_at_ms, None);

    let unbound_pin = "f".repeat(64);
    network.shared.lock().unwrap().observed_aliases.insert(
        (b.device_id, unbound_pin.clone()),
        ObservedAlias {
            alias: "Unbound key".into(),
            source: EnvironmentAliasSource::Custom,
            revision: 1,
            expires: Instant::now() + CANDIDATE_TTL,
        },
    );
    network.worker().confirm_aliases(b.device_id, generation);
    assert!(a.peer_alias_claims(&oa).unwrap().is_empty());
    network
        .shared
        .lock()
        .unwrap()
        .observed_aliases
        .remove(&(b.device_id, unbound_pin));

    network.shared.lock().unwrap().observed_aliases.insert(
        (b.device_id, pin.clone()),
        ObservedAlias {
            alias: "Travel Room PC".into(),
            source: EnvironmentAliasSource::Custom,
            revision: 1,
            expires: Instant::now() + CANDIDATE_TTL,
        },
    );
    let claimed = network.status(profile).unwrap();
    let peer = claimed
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.effective_alias, "Travel Room PC");
    assert_eq!(peer.alias_verification, "signed");
    assert_eq!(peer.alias_confirmed_at_ms, None);
    assert!(a.peer_alias_claims(&oa).unwrap().is_empty());

    network.worker().confirm_aliases(b.device_id, generation);
    let confirmed = network.status(profile).unwrap();
    let peer = confirmed
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.alias_verification, "confirmed");
    assert!(peer.alias_confirmed_at_ms.is_some());

    network.stop().await.unwrap();
    stopped(a).await;
    stopped(b.clone()).await;

    let reopened = Arc::new(BetaHost::open(root.path()).unwrap());
    let reopened_owner = reopened.owner_session().unwrap();
    let reopened_network = PeerNetwork::new(reopened.clone(), reopened_owner.clone()).unwrap();
    let persisted = reopened_network.status(profile).unwrap();
    let peer = persisted
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.effective_alias, "Travel Room PC");
    assert_eq!(peer.alias_verification, "confirmed");
    assert!(peer.alias_confirmed_at_ms.is_some());

    let generation = reopened_network.shared.lock().unwrap().generation;
    reopened_network
        .worker()
        .remember_announcement(
            enriched_announcement(
                b.device_id,
                pin.clone(),
                43344,
                "Renamed PC",
                EnvironmentAliasSource::Custom,
                2,
            ),
            "192.0.2.20:43344".parse().unwrap(),
            generation,
        )
        .unwrap();
    let renamed = reopened_network.status(profile).unwrap();
    let peer = renamed
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.effective_alias, "Renamed PC");
    assert_eq!(peer.alias_verification, "signed");
    assert_eq!(peer.alias_confirmed_at_ms, None);
    let renamed_claim = reopened
        .peer_alias_claims(&reopened_owner)
        .unwrap()
        .remove(&(b.device_id, pin.clone()))
        .unwrap();
    assert_eq!(renamed_claim.effective_alias, "Renamed PC");
    assert_eq!(renamed_claim.revision, 2);
    assert_eq!(renamed_claim.confirmed_at_ms, None);

    reopened_network
        .shared
        .lock()
        .unwrap()
        .observed_aliases
        .clear();
    reopened_network
        .worker()
        .remember_announcement(
            enriched_announcement(
                b.device_id,
                pin.clone(),
                43344,
                "Replayed old name",
                EnvironmentAliasSource::Custom,
                1,
            ),
            "192.0.2.21:43344".parse().unwrap(),
            generation,
        )
        .unwrap();
    let after_replay = reopened_network.status(profile).unwrap();
    let peer = after_replay
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.effective_alias, "Renamed PC");

    reopened_network.stop().await.unwrap();
    reopened.stop().unwrap();
    let reopened_again = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner_again = reopened_again.owner_session().unwrap();
    let network_again = PeerNetwork::new(reopened_again.clone(), owner_again).unwrap();
    let after_restart = network_again.status(profile).unwrap();
    let peer = after_restart
        .peers
        .iter()
        .find(|peer| peer.device_id == b.device_id)
        .unwrap();
    assert_eq!(peer.alias_verification, "signed");
    assert_eq!(peer.alias_source, EnvironmentAliasSource::Custom);
    assert_eq!(peer.effective_alias, "Renamed PC");
    assert_eq!(peer.alias_confirmed_at_ms, None);
    network_again.stop().await.unwrap();
    reopened_again.stop().unwrap();
}

#[test]
fn auth_five_alias_migration_preserves_network_settings_and_rolls_back_on_failure() {
    let (root, host, owner) = host();
    host.save_peer_network_settings(
        &owner,
        PeerNetworkSettings {
            enabled: true,
            preferred_port: 43355,
        },
    )
    .unwrap();
    host.stop().unwrap();

    let path = root.path().join("host-auth.sqlite3");
    let mut database = rusqlite::Connection::open(&path).unwrap();
    database
        .execute_batch(
            "DROP TABLE peer_connection_endpoints;
             DROP TABLE peer_connections;
             DROP TABLE peer_environments;
             DROP TABLE peer_environment_alias;
             DROP TABLE peer_environment_alias_claims;
             PRAGMA user_version=5;",
        )
        .unwrap();
    super::super::membership_store::migrate(&mut database).unwrap();
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        7
    );
    assert_eq!(
        super::super::network_store::settings(&database).unwrap(),
        PeerNetworkSettings {
            enabled: true,
            preferred_port: 43355,
        }
    );
    assert_eq!(
        super::super::network_store::custom_environment_alias(&database).unwrap(),
        None
    );
    drop(database);

    let mut database = rusqlite::Connection::open(&path).unwrap();
    database
        .execute_batch(
            "DROP TABLE peer_connection_endpoints;
             DROP TABLE peer_connections;
             DROP TABLE peer_environments;
             DROP TABLE peer_environment_alias;
             DROP TABLE peer_environment_alias_claims;
             CREATE TABLE peer_environment_alias(not_the_schema TEXT NOT NULL);
             PRAGMA user_version=5;",
        )
        .unwrap();
    super::super::network_store::validate_v5(&database).unwrap();
    let before: (bool, u16) = database
        .query_row(
            "SELECT enabled,preferred_port FROM peer_network_settings WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let version: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert!(super::super::membership_store::migrate(&mut database).is_err());
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        version
    );
    super::super::network_store::validate_v5(&database).unwrap();
    let after: (bool, u16) = database
        .query_row(
            "SELECT enabled,preferred_port FROM peer_network_settings WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(after, before);
    database
        .execute_batch(
            "DROP TABLE peer_environment_alias;
             CREATE TABLE peer_environment_alias_claims(not_the_schema TEXT NOT NULL);
             PRAGMA user_version=5;",
        )
        .unwrap();
    let version_before_mid_ddl_failure: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert!(super::super::membership_store::migrate(&mut database).is_err());
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        version_before_mid_ddl_failure
    );
    let alias_table_rolled_back: bool = database
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name='peer_environment_alias')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(alias_table_rolled_back);
    super::super::network_store::validate_v5(&database).unwrap();
    assert_eq!(
        database
            .query_row(
                "SELECT enabled,preferred_port FROM peer_network_settings WHERE singleton=1",
                [],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, u16>(1)?)),
            )
            .unwrap(),
        before
    );
    drop(database);
    let error = match BetaHost::open(root.path()) {
        Err(error) => error,
        Ok(_) => panic!("corrupt migration unexpectedly opened"),
    };
    assert!(
        matches!(
            &error,
            &HostError::PeerSyncRecoveryRequired
                | &HostError::PeerSyncUnavailable
                | &HostError::PeerMembershipRecoveryRequired
        ),
        "{error:?}"
    );
}

async fn stopped(host: Arc<BetaHost>) {
    tokio::task::spawn_blocking(move || host.stop())
        .await
        .unwrap()
        .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn alternate_join_route_preserves_the_signed_issuer_and_rejects_a_different_peer() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let (_rc, c, oc) = host();
    let profile = ProfileId::new();
    let issuer_device = a.device_id;
    a.provision_profile(&oa, profile, "synthetic overlay route")
        .unwrap();
    let na = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let nb = PeerNetwork::new(b.clone(), ob.clone()).unwrap();
    let nc = PeerNetwork::new(c.clone(), oc.clone()).unwrap();
    na.set_enabled(true).await.unwrap();
    nc.set_enabled(true).await.unwrap();
    let loopback = |network: &Arc<PeerNetwork>| {
        network
            .local_addresses()
            .unwrap()
            .into_iter()
            .find(|address| address.ip().is_loopback())
            .unwrap()
    };
    let address = loopback(&na);
    let other_address = loopback(&nc);
    let invitation = a
        .create_peer_invitation(
            &oa,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![other_address],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let claim = Uuid::new_v4();
    let wrong_route = nb.join_for_test(&invitation, claim).await;
    assert!(matches!(wrong_route, Err(HostError::PeerPinMismatch)));
    assert!(b.profiles(&ob).unwrap().is_empty());
    assert!(c.profiles(&oc).unwrap().is_empty());

    let result = nb
        .join_with_route_for_test(&invitation, claim, Some(address))
        .await
        .unwrap();
    assert_eq!(result.profile_id, profile);
    assert_eq!(result.issuer_device_id, a.device_id);
    assert_eq!(result.state, PeerJoinState::Ready);
    assert!(result.remote_ready_observed);
    assert!(
        b.profiles(&ob)
            .unwrap()
            .iter()
            .any(|member| member.profile_id == profile),
        "test-only loopback join must still establish membership"
    );
    assert!(
        b.peer_routes(&ob).unwrap().is_empty(),
        "a loopback successful endpoint must not be persisted as a shareable route"
    );
    assert!(c.profiles(&oc).unwrap().is_empty());
    na.stop().await.unwrap();
    nb.stop().await.unwrap();
    nc.stop().await.unwrap();
    drop((na, nb, nc));
    stopped(a).await;
    stopped(b).await;
    stopped(c).await;

    let reopened = BetaHost::open(_rb.path()).unwrap();
    let reopened_owner = reopened.owner_session().unwrap();
    assert!(
        reopened
            .peer_routes(&reopened_owner)
            .unwrap()
            .iter()
            .all(|route| !(route.profile == profile && route.device == issuer_device)),
        "a loopback successful endpoint must not be durably persisted"
    );
    reopened.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn alternate_join_route_keeps_pin_mismatch_when_signed_candidate_times_out() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let (_rc, different_peer, different_peer_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "synthetic alternate route")
        .unwrap();

    let different_network =
        PeerNetwork::new(different_peer.clone(), different_peer_owner.clone()).unwrap();
    different_network.set_enabled(true).await.unwrap();
    let wrong_address = different_network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let unreachable_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let signed_candidate = unreachable_listener.local_addr().unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![signed_candidate],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();

    let result = network
        .join_with_route_for_test(&invitation, Uuid::new_v4(), Some(wrong_address))
        .await;

    assert!(matches!(result, Err(HostError::PeerPinMismatch)));
    assert!(joiner.profiles(&joiner_owner).unwrap().is_empty());

    network.stop().await.unwrap();
    different_network.stop().await.unwrap();
    drop((network, different_network, unreachable_listener));
    stopped(issuer).await;
    stopped(joiner).await;
    stopped(different_peer).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn join_tries_a_later_candidate_after_service_negotiation_fails() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "service fallback")
        .unwrap();
    let issuer_network = PeerNetwork::new(issuer.clone(), issuer_owner.clone()).unwrap();
    issuer_network.set_enabled(true).await.unwrap();
    let real_address = issuer_network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let decoy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let decoy_address = decoy_listener.local_addr().unwrap();
    let decoy_identity = issuer.transport_identity(&issuer_owner).unwrap();
    let decoy_config =
        super::super::transport::server_config_for_test(&decoy_identity).unwrap();
    let mut decoy_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;

        let (stream, _) = decoy_listener.accept().await?;
        let mut stream = tokio_rustls::TlsAcceptor::from(decoy_config)
            .accept(stream)
            .await
            .map_err(|_| HostError::PeerTls)?;
        let length = stream
            .read_u32()
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)? as usize;
        if length > 256 * 1024 {
            return Err(HostError::PayloadTooLarge);
        }
        let mut header = vec![0; length];
        stream
            .read_exact(&mut header)
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        drop(stream);
        Ok::<(), HostError>(())
    });
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![decoy_address, real_address],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();

    let joined = network.join_for_test(&invitation, Uuid::new_v4()).await;

    assert!(
        joined.is_ok(),
        "a failed service exchange on one pinned endpoint must not suppress the next candidate: {joined:?}"
    );
    let decoy_result = tokio::time::timeout(Duration::from_secs(5), &mut decoy_task)
        .await
        .expect("decoy service observed and closed the first endpoint");
    assert!(decoy_result.is_ok_and(|result| result.is_ok()));
    assert_eq!(joined.unwrap().state, PeerJoinState::Ready);
    network.stop().await.unwrap();
    issuer_network.stop().await.unwrap();
    drop(network);
    drop(issuer_network);
    stopped(issuer).await;
    stopped(joiner).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn join_treats_a_silent_post_tls_route_as_bounded_and_falls_back() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "silent route")
        .unwrap();
    let issuer_network = PeerNetwork::new(issuer.clone(), issuer_owner.clone()).unwrap();
    issuer_network.set_enabled(true).await.unwrap();
    let real_address = issuer_network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let decoy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let decoy_address = decoy_listener.local_addr().unwrap();
    let decoy_identity = issuer.transport_identity(&issuer_owner).unwrap();
    let decoy_config =
        super::super::transport::server_config_for_test(&decoy_identity).unwrap();
    let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
    let decoy_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;

        let (stream, _) = decoy_listener.accept().await?;
        let mut stream = tokio_rustls::TlsAcceptor::from(decoy_config)
            .accept(stream)
            .await
            .map_err(|_| HostError::PeerTls)?;
        let length = stream
            .read_u32()
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)? as usize;
        if length > 256 * 1024 {
            return Err(HostError::PayloadTooLarge);
        }
        let mut header = vec![0; length];
        stream
            .read_exact(&mut header)
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        let _ = accepted_tx.send(());
        // Accept TLS and the service header, then hold without reading the join frames.
        tokio::time::sleep(Duration::from_secs(15)).await;
        drop(stream);
        Ok::<(), HostError>(())
    });
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![decoy_address, real_address],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();
    let join_network = network.clone();
    let join_invitation = invitation.clone();
    let started = Instant::now();
    let join_task = tokio::spawn(async move {
        join_network
            .join_for_test(&join_invitation, Uuid::new_v4())
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), accepted_rx)
        .await
        .expect("decoy accepted TLS and service header")
        .expect("decoy signal");
    let joined = tokio::time::timeout(
        Duration::from_secs(20),
        join_task,
    )
    .await
    .expect("join must remain bounded")
    .expect("join task completed")
    .expect("a silent route must not suppress the next candidate");
    assert_eq!(joined.state, PeerJoinState::Ready);
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "per-route join exceeded its bound"
    );
    network.stop().await.unwrap();
    issuer_network.stop().await.unwrap();
    decoy_task.abort();
    let _ = decoy_task.await;
    stopped(issuer).await;
    stopped(joiner).await;
}

#[test]
fn peer_network_error_code_distinguishes_pin_tls_and_unreachable() {
    assert_eq!(error_code(&HostError::PeerPinMismatch), "pin_mismatch");
    assert_eq!(error_code(&HostError::PeerTls), "tls_handshake_failed");
    assert_eq!(
        error_code(&HostError::PeerTransportUnavailable),
        "unreachable"
    );
}

#[test]
fn invitation_candidates_never_include_loopback_or_link_local() {
    let candidates = shareable_endpoints_for_test(
        "127.0.0.1:43344".parse().unwrap(),
        vec![
            "127.0.0.1".parse().unwrap(),
            "169.254.2.3".parse().unwrap(),
            "10.144.144.6".parse().unwrap(),
        ],
    );
    assert_eq!(candidates, vec!["10.144.144.6:43344".parse().unwrap()]);
}

#[test]
fn shareable_endpoints_drop_invalid_multicast_unspecified_duplicates_and_v6_link_local() {
    let candidates = shareable_endpoints_for_test(
        "192.168.1.20:43344".parse().unwrap(),
        vec![
            "192.168.1.20".parse::<IpAddr>().unwrap(),
            "192.168.1.20".parse::<IpAddr>().unwrap(),
            "0.0.0.0".parse().unwrap(),
            "239.255.77.68".parse().unwrap(),
            "169.254.10.1".parse().unwrap(),
            "fe80::1".parse().unwrap(),
            "10.0.0.8".parse().unwrap(),
        ],
    );
    assert_eq!(
        candidates,
        vec![
            "192.168.1.20:43344".parse().unwrap(),
            "10.0.0.8:43344".parse().unwrap(),
        ]
    );
}

#[test]
fn shareable_endpoints_are_non_adjacent_deduplicated_and_bounded() {
    let candidates = shareable_endpoints_for_test(
        "192.168.1.20:43344".parse().unwrap(),
        vec![
            "10.0.0.1".parse().unwrap(),
            "10.0.0.2".parse().unwrap(),
            "10.0.0.1".parse().unwrap(),
            "10.0.0.3".parse().unwrap(),
            "10.0.0.4".parse().unwrap(),
            "10.0.0.5".parse().unwrap(),
            "10.0.0.6".parse().unwrap(),
            "10.0.0.7".parse().unwrap(),
            "10.0.0.8".parse().unwrap(),
        ],
    );
    assert_eq!(candidates.len(), MAX_SHAREABLE_ENDPOINTS);
    assert_eq!(
        candidates
            .iter()
            .filter(|address| *address == &"10.0.0.1:43344".parse().unwrap())
            .count(),
        1
    );
}

#[test]
fn shareable_endpoints_filter_before_budget_truncation() {
    let candidates = shareable_endpoints_for_test(
        "192.168.1.20:43344".parse().unwrap(),
        vec![
            "169.254.0.1".parse().unwrap(),
            "169.254.0.2".parse().unwrap(),
            "169.254.0.3".parse().unwrap(),
            "169.254.0.4".parse().unwrap(),
            "169.254.0.5".parse().unwrap(),
            "169.254.0.6".parse().unwrap(),
            "169.254.0.7".parse().unwrap(),
            "10.0.0.9".parse().unwrap(),
        ],
    );
    assert_eq!(candidates, vec!["10.0.0.9:43344".parse().unwrap()]);
}

#[test]
fn shareable_endpoint_policy_covers_manual_dial_link_local_broadcast_and_loopback() {
    assert!(!is_shareable_endpoint(
        "169.254.1.1:43344".parse().unwrap()
    ));
    assert!(!is_shareable_endpoint(
        "255.255.255.255:43344".parse().unwrap()
    ));
    assert!(!is_shareable_endpoint("127.0.0.1:43344".parse().unwrap()));
    assert!(!is_shareable_endpoint("[fe80::1]:43344".parse().unwrap()));
    assert!(is_shareable_endpoint("192.168.1.20:43344".parse().unwrap()));
    assert!(is_shareable_endpoint("10.0.0.8:43344".parse().unwrap()));
}

#[test]
fn shareable_endpoint_policy_canonicalizes_ipv4_mapped_ipv6() {
    assert!(!is_shareable_endpoint(
        "[::ffff:127.0.0.1]:43344".parse().unwrap()
    ));
    assert!(!is_shareable_endpoint(
        "[::ffff:169.254.1.1]:43344".parse().unwrap()
    ));
    assert!(!is_shareable_endpoint(
        "[::ffff:255.255.255.255]:43344".parse().unwrap()
    ));
    assert!(is_shareable_endpoint(
        "[::ffff:192.168.1.20]:43344".parse().unwrap()
    ));
    // Native IPv6 classification is unchanged.
    assert!(!is_shareable_endpoint("[::1]:43344".parse().unwrap()));
    assert!(!is_shareable_endpoint("[fe80::1]:43344".parse().unwrap()));
    assert!(is_shareable_endpoint("[2001:db8::1]:43344".parse().unwrap()));
}

#[test]
fn non_shareable_code_canonicalizes_ipv4_mapped_ipv6() {
    assert_eq!(
        non_shareable_code("[::ffff:127.0.0.1]:43344".parse().unwrap()),
        "loopback_not_shareable"
    );
    assert_eq!(
        non_shareable_code("[::ffff:169.254.1.1]:43344".parse().unwrap()),
        "link_local_address"
    );
    assert_eq!(
        non_shareable_code("[::ffff:255.255.255.255]:43344".parse().unwrap()),
        "broadcast_address"
    );
}

#[test]
fn legacy_loopback_invitation_is_reported_as_skipped_not_identity_mismatch() {
    let report = classify_join_candidates(vec![
        "127.0.0.1:43344".parse().unwrap(),
        "10.144.144.6:43344".parse().unwrap(),
    ]);
    assert_eq!(report.skipped_loopback, 1);
    assert_eq!(report.attempted, 1);
}

#[test]
fn probe_classification_keeps_tls_and_local_resource_failures_truthful() {
    assert_eq!(
        classify_probe_error(&HostError::PeerTls),
        (
            InvitationEndpointDisposition::ProtocolMismatch,
            Some("tls_handshake_failed")
        )
    );
    assert_eq!(
        classify_probe_error(&HostError::PeerBusy),
        (
            InvitationEndpointDisposition::Skipped,
            Some("peer_busy")
        )
    );
}

#[test]
fn service_timeout_is_attempted_not_address_unreachable() {
    assert_eq!(
        classify_service_error(&HostError::PeerTimeout),
        (
            InvitationEndpointDisposition::Attempted,
            Some("peer_timeout")
        )
    );
    assert_eq!(
        classify_service_error(&HostError::PeerTransportUnavailable),
        (
            InvitationEndpointDisposition::Attempted,
            Some("unreachable")
        )
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn structurally_valid_invitation_can_have_no_shareable_candidate() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_root, host, owner) = host();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "empty candidates")
        .unwrap();

    let invitation = host
        .create_peer_invitation(
            &owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .expect("a structurally valid invitation may have no shareable route");

    assert!(invitation.offer.candidates.is_empty());
    assert!(invitation.verified_offer().is_ok());
    let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
    assert!(network
        .inspect_invitation_endpoint_reports(&invitation)
        .await
        .unwrap()
        .is_empty());
    drop(network);
    stopped(host).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn production_join_skips_loopback_and_link_local_signed_candidates() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "unsafe signed candidates")
        .unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![
                    "169.254.255.254:43344".parse().unwrap(),
                    "127.0.0.1:43344".parse().unwrap(),
                ],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();

    let (error, reports) = network
        .join_with_route_diagnosed(&invitation, Uuid::new_v4(), None)
        .await
        .expect_err("no signed candidate is safe to dial");

    assert!(matches!(error, HostError::PeerTransportUnavailable));
    assert_eq!(reports.len(), 2);
    assert!(reports.iter().all(|report| {
        report["disposition"].as_str() == Some("skipped")
            && report["elapsed_ms"].as_u64() == Some(0)
    }));
    assert!(reports.iter().any(|report| {
        report["error_code"].as_str() == Some("link_local_address")
    }));
    assert!(reports.iter().any(|report| {
        report["error_code"].as_str() == Some("loopback_not_shareable")
    }));
    assert!(joiner.profiles(&joiner_owner).unwrap().is_empty());

    network.stop().await.unwrap();
    drop(network);
    stopped(issuer).await;
    stopped(joiner).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn production_join_skips_unsafe_manual_dial_addresses() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "unsafe manual dial")
        .unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();

    for (address, expected_code) in [
        ("169.254.255.254:43344", "link_local_address"),
        ("255.255.255.255:43344", "broadcast_address"),
        ("127.0.0.1:43344", "loopback_not_shareable"),
        ("[::ffff:169.254.1.1]:43344", "link_local_address"),
        ("[::ffff:255.255.255.255]:43344", "broadcast_address"),
        ("[::ffff:127.0.0.1]:43344", "loopback_not_shareable"),
    ] {
        let (error, reports) = network
            .join_with_route_diagnosed(
                &invitation,
                Uuid::new_v4(),
                Some(address.parse().unwrap()),
            )
            .await
            .expect_err("an unsafe manual dial address must be skipped");
        assert!(matches!(error, HostError::PeerTransportUnavailable));
        assert_eq!(reports.len(), 1, "one skipped report for {address}");
        assert_eq!(reports[0]["endpoint"].as_str(), Some(address));
        assert_eq!(reports[0]["disposition"].as_str(), Some("skipped"));
        assert_eq!(reports[0]["elapsed_ms"].as_u64(), Some(0));
        assert_eq!(reports[0]["error_code"].as_str(), Some(expected_code));
    }

    assert!(joiner.profiles(&joiner_owner).unwrap().is_empty());
    assert!(joiner.peer_routes(&joiner_owner).unwrap().is_empty());

    network.stop().await.unwrap();
    drop(network);
    stopped(issuer).await;
    stopped(joiner).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn production_join_attempts_a_shareable_manual_dial_address() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, joiner, joiner_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "shareable manual dial")
        .unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let network = PeerNetwork::new(joiner.clone(), joiner_owner.clone()).unwrap();
    let address: SocketAddr = "192.0.2.1:43344".parse().unwrap();

    let (error, reports) = network
        .join_with_route_diagnosed(&invitation, Uuid::new_v4(), Some(address))
        .await
        .expect_err("a shareable address without a listener must fall through to dialing");

    assert!(matches!(
        error,
        HostError::PeerTransportUnavailable | HostError::PeerTimeout
    ));
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0]["endpoint"].as_str(), Some("192.0.2.1:43344"));
    assert_eq!(reports[0]["disposition"].as_str(), Some("unreachable"));
    assert!(matches!(
        reports[0]["error_code"].as_str(),
        Some("unreachable") | Some("timeout")
    ));
    assert!(joiner.profiles(&joiner_owner).unwrap().is_empty());

    network.stop().await.unwrap();
    drop(network);
    stopped(issuer).await;
    stopped(joiner).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invitation_inspection_is_bounded_to_tls_identity_without_membership_side_effects() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, issuer, issuer_owner) = host();
    let (_rb, inspector, inspector_owner) = host();
    let profile = ProfileId::new();
    issuer
        .provision_profile(&issuer_owner, profile, "inspection identity")
        .unwrap();
    let issuer_network = PeerNetwork::new(issuer.clone(), issuer_owner.clone()).unwrap();
    issuer_network.set_enabled(true).await.unwrap();
    let issuer_address = issuer_network
        .local_addresses()
        .unwrap()
        .into_iter()
        .find(|address| address.ip().is_loopback())
        .unwrap();
    let invitation = issuer
        .create_peer_invitation(
            &issuer_owner,
            &CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: PeerCapabilities::FULL,
                candidates: vec![issuer_address],
                ttl_seconds: 600,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let inspector_network =
        PeerNetwork::new(inspector.clone(), inspector_owner.clone()).unwrap();

    let reports = inspector_network
        .inspect_invitation_endpoint_reports_for_test(&invitation)
        .await
        .unwrap();

    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0]["disposition"].as_str(), Some("reachable"));
    assert!(inspector_network.local_addresses().unwrap().is_empty());
    assert!(!issuer
        .peer_members(&issuer_owner, profile)
        .unwrap()
        .iter()
        .any(|member| member.device_id == inspector.device_id));
    inspector_network.stop().await.unwrap();
    issuer_network.stop().await.unwrap();
    drop(inspector_network);
    drop(issuer_network);
    stopped(issuer).await;
    stopped(inspector).await;
}

#[test]
fn invitation_endpoint_report_serializes_dispositions_and_bounded_fields() {
    let report = InvitationEndpointReport {
        endpoint: "10.0.0.2:43344".into(),
        disposition: InvitationEndpointDisposition::Unreachable,
        elapsed_ms: 2000,
        error_code: Some("timeout"),
    };
    let value = serde_json::to_value(report).unwrap();
    assert_eq!(value["endpoint"].as_str(), Some("10.0.0.2:43344"));
    assert_eq!(value["disposition"].as_str(), Some("unreachable"));
    assert_eq!(value["elapsed_ms"].as_u64(), Some(2000));
    assert_eq!(value["error_code"].as_str(), Some("timeout"));

    for (disposition, name) in [
        (InvitationEndpointDisposition::Attempted, "attempted"),
        (InvitationEndpointDisposition::Skipped, "skipped"),
        (InvitationEndpointDisposition::Reachable, "reachable"),
        (
            InvitationEndpointDisposition::IdentityMismatch,
            "identity_mismatch",
        ),
        (InvitationEndpointDisposition::Unreachable, "unreachable"),
        (
            InvitationEndpointDisposition::ProtocolMismatch,
            "protocol_mismatch",
        ),
    ] {
        let value = serde_json::to_value(InvitationEndpointReport {
            endpoint: "10.0.0.2:43344".into(),
            disposition,
            elapsed_ms: 1,
            error_code: None,
        })
        .unwrap();
        assert_eq!(value["disposition"].as_str(), Some(name));
        assert!(value["error_code"].is_null());
    }
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
                    SocketAddr::from((Ipv4Addr::LOCALHOST, discovery_port())),
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
    let member_generation = c
        .peer_members(&oc, p)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == a.device_id)
        .unwrap()
        .generation;
    for _ in 0..4 {
        let value = worker
            .transfer_attempt(
                &route,
                &pin,
                member_generation,
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
            member_generation,
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
            member_generation,
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
                    member_generation,
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
                    member_generation,
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
                member_generation,
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
    // The cached fallback is a persisted route, not a live same-host socket.
    // Use a shareable address so the merge policy can legitimately retain it.
    let old = SocketAddr::from(([192, 0, 2, 10], previous.local_addr().unwrap().port()));
    a.save_peer_routes(&oa, p, b.device_id, vec![old]).unwrap();
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let pin = b.device_identity(&ob).unwrap().fingerprint_sha256;
    let unknown = DeviceId::new();
    let mut hints = vec![];
    for device in [unknown, b.device_id] {
        let bytes = legacy_announcement(device, pin.clone(), bad.port())
            .legacy_bytes()
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
    let bytes = legacy_announcement(b.device_id, pin, address.port())
        .legacy_bytes()
        .unwrap();
    until_hint(
        "verified candidate synchronized without persisting loopback",
        &socket,
        &[bytes],
        || {
            network
                .shared
                .lock()
                .unwrap()
                .progress
                .get(&(p, b.device_id))
                .is_some_and(|v| v.memo.is_some())
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
    assert!(!route.endpoints.contains(&address));
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
        let joined = nb.join_for_test(&invitation, Uuid::new_v4()).await;
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

#[path = "f5_peer_network_probe_tests.rs"]
mod f5_peer_network_probe_tests;

#[path = "peer_return_route_follow_up_tests.rs"]
mod peer_return_route_follow_up_tests;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_discovery_advertisements_never_write_peer_routes() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let (_rc, c, oc) = host();
    let profile = pair_hosts(&a, &oa, &b, &ob).await;
    pair_into_profile(&a, &oa, &c, &oc, profile).await;
    let b_pin = b.device_identity(&ob).unwrap().fingerprint_sha256;
    let c_pin = c.device_identity(&oc).unwrap().fingerprint_sha256;
    let c_generation = a
        .peer_members(&oa, profile)
        .unwrap()
        .into_iter()
        .find(|member| member.device_id == c.device_id)
        .unwrap()
        .generation;
    a.revoke_peer_member(&oa, profile, c.device_id, c_generation)
        .unwrap();

    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    let worker = network.worker();
    let generation = {
        let mut state = network.shared.lock().unwrap();
        state.generation = 1;
        state.generation
    };
    let source: std::net::SocketAddr = "127.0.0.1:53101".parse().unwrap();
    let valid_port = 53301;
    let announcement = legacy_announcement;

    // A matching pin may create only an in-memory, expiring candidate.
    worker
        .remember_announcement(
            announcement(b.device_id, b_pin.clone(), valid_port),
            source,
            generation,
        )
        .unwrap();
    let unknown = DeviceId::new();
    worker
        .remember_announcement(
            announcement(unknown, b_pin.clone(), valid_port + 1),
            source,
            generation,
        )
        .unwrap();
    worker
        .remember_announcement(
            announcement(b.device_id, String::new(), valid_port + 2),
            source,
            generation,
        )
        .unwrap();
    worker
        .remember_announcement(
            announcement(c.device_id, c_pin.clone(), valid_port + 3),
            source,
            generation,
        )
        .unwrap();
    worker
        .remember_announcement(
            announcement(b.device_id, c_pin, valid_port + 4),
            source,
            generation,
        )
        .unwrap();

    let (valid_candidate, unknown_candidate, revoked_candidate, b_candidates) = {
        let state = network.shared.lock().unwrap();
        let b_candidates = state
            .candidates
            .get(&b.device_id)
            .map(|values| {
                values
                    .iter()
                    .map(|value| value.endpoint)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        (
            b_candidates.contains(&std::net::SocketAddr::new(source.ip(), valid_port)),
            state.candidates.contains_key(&unknown),
            state.candidates.contains_key(&c.device_id),
            b_candidates,
        )
    };
    let durable_routes_empty = a.peer_routes(&oa).unwrap().is_empty();

    drop(network);
    stopped(a).await;
    stopped(b).await;
    stopped(c).await;

    assert!(
        valid_candidate,
        "a ready member with its pinned identity can be a volatile candidate"
    );
    assert_eq!(
        b_candidates.len(),
        1,
        "bad identity advertisements must not replace the valid candidate"
    );
    assert!(
        !unknown_candidate,
        "unknown devices cannot create route candidates"
    );
    assert!(
        !revoked_candidate,
        "revoked members cannot create route candidates"
    );
    assert!(
        durable_routes_empty,
        "advertisements alone cannot write durable routes, even with a valid pin"
    );
}

fn spawn_loopback_byte_proxy(
    listener: tokio::net::TcpListener,
    upstream_address: std::net::SocketAddr,
    cancel: PeerCancellation,
) -> tokio::task::JoinHandle<Result<bool, std::io::Error>> {
    tokio::spawn(async move {
        let (mut downstream, _) = tokio::select! {
            _ = cancel.cancelled() => return Ok(false),
            accepted = listener.accept() => accepted?,
        };
        let socket = tokio::net::TcpSocket::new_v4()?;
        socket.bind("127.0.0.1:0".parse().unwrap())?;
        let mut upstream = socket.connect(upstream_address).await?;
        tokio::select! {
            _ = cancel.cancelled() => Ok(false),
            copied = tokio::io::copy_bidirectional(&mut downstream, &mut upstream) => {
                copied.map(|_| true)
            }
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn loopback_proxy_sync_exchanges_facts_both_ways_but_suppresses_self_source_route() {
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let profile = pair_hosts(&a, &oa, &b, &ob).await;
    record(&a, &oa, profile, "receiver fact before proxied sync");
    record(&b, &ob, profile, "source fact before proxied sync");

    let mut listener_a = a
        .listen_peer_transport(&oa, "127.0.0.1:0".parse().unwrap(), transport_options())
        .await
        .unwrap();
    let listen_port = listener_a.addr().port();
    let address_a = listener_a.addr();
    let address_b: std::net::SocketAddr = format!("127.0.0.2:{listen_port}").parse().unwrap();
    let mut listener_b = b
        .listen_peer_transport(&ob, address_b, transport_options())
        .await
        .unwrap();
    for (host, owner) in [(&a, &oa), (&b, &ob)] {
        host.save_peer_network_settings(
            owner,
            PeerNetworkSettings {
                enabled: false,
                preferred_port: listen_port,
            },
        )
        .unwrap();
    }

    let proxy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_address = proxy_listener.local_addr().unwrap();
    let proxy_cancel = PeerCancellation::new();
    let mut proxy_task = spawn_loopback_byte_proxy(proxy_listener, address_a, proxy_cancel.clone());

    let accepting_host = a.clone();
    let accepting_owner = oa.clone();
    let mut accept_task = tokio::spawn(async move {
        let incoming = listener_a.accept(PeerCancellation::new()).await?;
        let observed_source = incoming.remote_address();
        let outcome = accepting_host
            .accept_peer_service(&accepting_owner, incoming)
            .await?;
        Ok::<_, HostError>((observed_source, outcome))
    });

    let pin_a = PeerPin::from_sha256(&a.device_identity(&oa).unwrap().fingerprint_sha256).unwrap();
    let client_sync = match b
        .connect_peer_transport(
            &ob,
            proxy_address,
            pin_a,
            transport_options(),
            PeerCancellation::new(),
        )
        .await
    {
        Ok(channel) => match b
            .select_peer_service(
                &ob,
                &channel,
                PeerServiceKind::Sync,
                Some(profile),
                Some(a.device_id),
                listen_port,
            )
            .await
        {
            Ok(()) => b
                .synchronize_peer_profile_over_transport(
                    &ob,
                    profile,
                    a.device_id,
                    channel,
                    PeerSyncOptions::default(),
                )
                .await
                .is_ok(),
            Err(_) => false,
        },
        Err(_) => false,
    };

    let mut observed_source = None;
    let mut server_sync = false;
    let server_finished =
        match tokio::time::timeout(Duration::from_secs(12), &mut accept_task).await {
            Ok(Ok(Ok((
                observed,
                crate::PeerServiceOutcome::Synchronized {
                    profile_id,
                    device_id,
                    ..
                },
            )))) => {
                observed_source = Some(observed);
                server_sync = profile_id == profile && device_id == b.device_id;
                true
            }
            Ok(Ok(Ok(_))) | Ok(Ok(Err(_))) | Ok(Err(_)) => true,
            Err(_) => false,
        };
    if !server_finished {
        accept_task.abort();
        let _ = accept_task.await;
    }

    let proxy_completed = match tokio::time::timeout(Duration::from_secs(5), &mut proxy_task).await
    {
        Ok(Ok(Ok(forwarded))) => forwarded,
        Ok(Ok(Err(_))) | Ok(Err(_)) => false,
        Err(_) => {
            proxy_cancel.cancel();
            proxy_task.abort();
            let _ = proxy_task.await;
            false
        }
    };

    let observed_self_loopback = observed_source
        .is_some_and(|source| source.ip().is_loopback() && source.port() != listen_port);
    let facts_bidirectional =
        facts(&a, &oa, profile) == facts(&b, &ob, profile) && facts(&a, &oa, profile).len() == 2;
    let route_absent = a
        .peer_routes(&oa)
        .unwrap()
        .iter()
        .all(|route| route.profile != profile || route.device != b.device_id);

    // The fixture knows this listener candidate. The service /1 header sends
    // only its port, so the receiver cannot learn this endpoint from the stream.
    let pin_b = PeerPin::from_sha256(&b.device_identity(&ob).unwrap().fingerprint_sha256).unwrap();
    let mut accept_candidate = tokio::spawn(async move {
        match listener_b.accept(PeerCancellation::new()).await {
            Ok(channel) => channel.close().await,
            Err(error) => Err(error),
        }
    });
    let candidate_dialable = match a
        .connect_peer_transport(
            &oa,
            address_b,
            pin_b,
            transport_options(),
            PeerCancellation::new(),
        )
        .await
    {
        Ok(channel) => channel.close().await.is_ok(),
        Err(_) => false,
    };
    let candidate_accepted =
        match tokio::time::timeout(Duration::from_secs(5), &mut accept_candidate).await {
            Ok(Ok(Ok(()))) => true,
            Ok(Ok(Err(_))) | Ok(Err(_)) => false,
            Err(_) => {
                accept_candidate.abort();
                let _ = accept_candidate.await;
                false
            }
        };

    proxy_cancel.cancel();
    stopped(a).await;
    stopped(b).await;

    assert!(
        client_sync,
        "the pinned proxied service session must synchronize"
    );
    assert!(
        server_sync,
        "the receiver must complete the same profile sync"
    );
    assert!(
        proxy_completed,
        "the local byte proxy must carry the complete TLS stream"
    );
    assert!(
        observed_self_loopback,
        "the receiver should observe its own loopback IP and an ephemeral TCP source port"
    );
    assert!(
        facts_bidirectional,
        "both peers' facts must cross the authenticated stream"
    );
    assert!(
        route_absent,
        "same preferred/listen port plus a self loopback observation is filtered as a self route"
    );
    assert!(
        candidate_dialable && candidate_accepted,
        "a fresh pinned TLS connection to the source's distinct loopback listener must work"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nearby_discovery_is_visible_bounded_and_never_becomes_peer_access() {
    let _discovery = crate::peers::test_discovery::lease().await;
    let (_ra, a, oa) = host();
    let (_rb, b, ob) = host();
    let profile = ProfileId::new();
    a.provision_profile(&oa, profile, "private profile name")
        .unwrap();

    let service = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let service_address = service.local_addr().unwrap();
    let pin = b.device_identity(&ob).unwrap().fingerprint_sha256;
    let network = PeerNetwork::new(a.clone(), oa.clone()).unwrap();
    network.set_enabled(true).await.unwrap();

    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let announcement = legacy_announcement(b.device_id, pin.clone(), service_address.port());
    let bytes = announcement.legacy_bytes().unwrap();
    let target = SocketAddr::from((Ipv4Addr::LOCALHOST, discovery_port()));
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut nearby = Vec::new();
    loop {
        socket.send_to(&bytes, target).await.unwrap();
        nearby = network.nearby_candidates().unwrap();
        if nearby
            .iter()
            .any(|candidate| candidate.device_id == b.device_id)
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "an unpaired device advertisement must become a visible nearby candidate"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let candidate = nearby
        .iter()
        .find(|candidate| candidate.device_id == b.device_id)
        .unwrap();
    assert_eq!(candidate.addresses, vec![service_address.to_string()]);
    assert_eq!(candidate.verification_state, "unverified");
    assert_eq!(candidate.fingerprint_sha256, pin);
    assert_eq!(candidate.alias_source, EnvironmentAliasSource::StableId);
    assert_eq!(candidate.alias_verification, "none");
    assert_eq!(candidate.alias_confirmed_at_ms, None);
    assert!(candidate.effective_alias.starts_with("外心 "));
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(candidate.expires_at_ms > now_ms);
    assert!(candidate.expires_at_ms <= now_ms + 30_000);

    let candidate_json = serde_json::to_value(candidate).unwrap();
    assert_eq!(
        candidate_json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec![
            "addresses",
            "alias_confirmed_at_ms",
            "alias_source",
            "alias_verification",
            "device_id",
            "effective_alias",
            "expires_at_ms",
            "fingerprint_sha256",
            "verification_state"
        ]
    );
    assert!(
        a.peer_members(&oa, profile)
            .unwrap()
            .iter()
            .all(|member| member.device_id != b.device_id)
    );
    assert!(
        a.peer_routes(&oa)
            .unwrap()
            .iter()
            .all(|route| route.device != b.device_id)
    );
    assert!(
        !network
            .shared
            .lock()
            .unwrap()
            .progress
            .contains_key(&(profile, b.device_id))
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(120), service.accept())
            .await
            .is_err(),
        "discovery must not probe or read an unpaired service"
    );

    let generation = network.shared.lock().unwrap().generation;
    let worker = network.worker();
    let source = socket.local_addr().unwrap();
    let expires_before = candidate.expires_at_ms;
    for _ in 0..3 {
        worker
            .remember_announcement(
                legacy_announcement(b.device_id, pin.clone(), service_address.port()),
                source,
                generation,
            )
            .unwrap();
    }
    nearby = network.nearby_candidates().unwrap();
    let refreshed = nearby
        .iter()
        .find(|candidate| candidate.device_id == b.device_id)
        .unwrap();
    assert_eq!(refreshed.addresses.len(), 1);
    assert!(refreshed.expires_at_ms >= expires_before);

    for port in 41000..41008 {
        worker
            .remember_announcement(
                legacy_announcement(b.device_id, pin.clone(), port),
                source,
                generation,
            )
            .unwrap();
    }
    let bounded = network.nearby_candidates().unwrap();
    assert_eq!(
        bounded
            .iter()
            .find(|candidate| candidate.device_id == b.device_id)
            .unwrap()
            .addresses
            .len(),
        MAX_DEVICE_CANDIDATES
    );

    let source = SocketAddr::from((Ipv4Addr::LOCALHOST, 53102));
    for index in 0..(MAX_CANDIDATE_DEVICES - 1) {
        worker
            .remember_announcement(
                legacy_announcement(
                    DeviceId::new(),
                    pin.clone(),
                    40_000 + index as u16,
                ),
                source,
                generation,
            )
            .unwrap();
    }
    let overflow = DeviceId::new();
    worker
        .remember_announcement(
            legacy_announcement(overflow, pin, 49_999),
            source,
            generation,
        )
        .unwrap();
    nearby = network.nearby_candidates().unwrap();
    assert_eq!(nearby.len(), MAX_CANDIDATE_DEVICES);
    assert!(
        nearby
            .iter()
            .all(|candidate| candidate.device_id != overflow)
    );

    tokio::time::sleep(CANDIDATE_TTL + Duration::from_millis(50)).await;
    assert!(
        network.nearby_candidates().unwrap().is_empty(),
        "expired candidates must disappear when read"
    );

    network.stop().await.unwrap();
    drop(network);
    stopped(a).await;
    stopped(b).await;
}

mod scan {
    use super::*;
    use crate::HostError;
    use std::collections::HashSet;
    use std::net::{IpAddr, Ipv4Addr};
    use tokio::net::TcpListener;

    fn request(name: &str, kind: &'static str, network: Ipv4Addr, prefix: u8) -> ScanRequest {
        ScanRequest {
            scope_id: derive_scope_id(name, &scan_cidr_string(network, prefix)),
            interface_name: name.to_string(),
            kind,
            network,
            prefix,
        }
    }

    fn initial_result(scan_id: Uuid, started_at_ms: i64) -> NetworkScanResult {
        NetworkScanResult {
            scan_id,
            started_at_ms,
            finished_at_ms: 0,
            stage: "tcp_probe",
            scopes: vec![],
            attempted: 0,
            discovered: 0,
            skipped: 0,
            cancelled: false,
            discovered_addresses: vec![],
        }
    }

    #[test]
    fn manual_cidr_parsing_masks_host_bits() {
        assert_eq!(
            parse_ipv4_cidr("10.137.0.2/24").unwrap(),
            (Ipv4Addr::new(10, 137, 0, 0), 24)
        );
        assert_eq!(
            parse_ipv4_cidr("192.168.1.99/24").unwrap(),
            (Ipv4Addr::new(192, 168, 1, 0), 24)
        );
        assert!(parse_ipv4_cidr("10.0.0.0/33").is_err());
        assert!(parse_ipv4_cidr("not-a-cidr").is_err());
        assert!(parse_ipv4_cidr("10.0.0.0").is_err());
    }

    #[test]
    fn scope_classification_excludes_defaults_and_detects_overlay() {
        assert_eq!(
            classify_scan_interface("lo", IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
            ("other", false, Some("loopback"))
        );
        assert_eq!(
            classify_scan_interface("vEthernet (WSL)", IpAddr::V4(Ipv4Addr::new(172, 20, 0, 1))),
            ("other", false, Some("virtual_interface"))
        );
        assert_eq!(
            classify_scan_interface("et_4_tcod", IpAddr::V4(Ipv4Addr::new(10, 137, 0, 2))),
            ("overlay", true, None)
        );
        assert_eq!(
            classify_scan_interface("EasyTier", IpAddr::V4(Ipv4Addr::new(10, 137, 0, 2))),
            ("easytier", true, None)
        );
        assert_eq!(
            classify_scan_interface("eth0", IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))),
            ("physical_lan", true, None)
        );
        assert_eq!(
            classify_scan_interface("fe80::1", IpAddr::V6("fe80::1".parse().unwrap())),
            ("other", false, Some("link_local_address"))
        );
        assert_eq!(
            classify_scan_interface("eth0", IpAddr::V6("2001:db8::1".parse().unwrap())),
            ("other", false, Some("ipv6_not_scanned"))
        );
    }

    #[test]
    fn host_enumeration_skips_network_broadcast_self_and_duplicates() {
        let self_ips = HashSet::from([Ipv4Addr::new(192, 168, 1, 20)]);
        let mut scheduled = HashSet::new();
        let first = enumerate_scan_hosts(
            Ipv4Addr::new(192, 168, 1, 0),
            24,
            &self_ips,
            &mut scheduled,
            MAX_SCAN_HOSTS,
        );
        assert_eq!(first.hosts.len(), 253);
        assert_eq!(first.skipped, 3); // network, broadcast, self
        let second = enumerate_scan_hosts(
            Ipv4Addr::new(192, 168, 1, 0),
            24,
            &self_ips,
            &mut scheduled,
            MAX_SCAN_HOSTS,
        );
        assert_eq!(second.hosts.len(), 0);
        assert_eq!(second.skipped, 256); // network, broadcast, 254 duplicates
    }

    #[test]
    fn host_enumeration_caps_large_scopes_at_global_host_limit() {
        let self_ips = HashSet::new();
        let mut scheduled = HashSet::new();
        let enumerated = enumerate_scan_hosts(
            Ipv4Addr::new(10, 0, 0, 0),
            8,
            &self_ips,
            &mut scheduled,
            MAX_SCAN_HOSTS,
        );
        assert_eq!(enumerated.hosts.len(), MAX_SCAN_HOSTS);
        // network + broadcast + (2^24 - 2 usable - 1024 taken)
        assert_eq!(enumerated.skipped, 16_776_192);
    }

    #[test]
    fn scan_caps_are_fixed_and_non_zero() {
        assert_eq!(MAX_SCAN_INTERFACES, 8);
        assert_eq!(MAX_SCAN_HOSTS, 1024);
        assert_eq!(MAX_SCAN_IN_FLIGHT, 32);
        assert_eq!(SCAN_REQUEST_TIMEOUT, Duration::from_millis(800));
        assert_eq!(SCAN_TOTAL_BUDGET, Duration::from_secs(15));
    }

    #[test]
    fn unsafe_manual_networks_are_rejected() {
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(127, 0, 0, 0)).is_err());
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(169, 254, 0, 0)).is_err());
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(224, 0, 0, 0)).is_err());
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(255, 255, 255, 255)).is_err());
        assert!(reject_unsafe_scan_network(Ipv4Addr::UNSPECIFIED).is_err());
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(10, 137, 0, 0)).is_ok());
        assert!(reject_unsafe_scan_network(Ipv4Addr::new(192, 168, 1, 0)).is_ok());
    }

    #[test]
    fn build_scan_requests_deduplicates_scope_ids() {
        let first_id = derive_scope_id("eth0", "192.168.1.0/24");
        let second_id = derive_scope_id("eth0", "10.0.0.0/24");
        let scopes = vec![
            ScanScope {
                scope_id: first_id.clone(),
                interface_name: "eth0".to_string(),
                kind: "physical_lan",
                prefix: 24,
                eligible: true,
                network: "192.168.1.0/24".to_string(),
                reason: None,
            },
            ScanScope {
                scope_id: second_id.clone(),
                interface_name: "eth0".to_string(),
                kind: "physical_lan",
                prefix: 24,
                eligible: true,
                network: "10.0.0.0/24".to_string(),
                reason: None,
            },
        ];
        let requests = build_scan_requests(
            vec![first_id.clone(), first_id.clone()],
            vec![],
            &scopes,
        )
        .unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].scope_id, first_id);
        assert_eq!(requests[0].interface_name, "eth0");
        assert_eq!(requests[0].prefix, 24);
        // Same adapter name with two addresses stays independently selectable.
        let both = build_scan_requests(
            vec![first_id, second_id],
            vec![],
            &scopes,
        )
        .unwrap();
        assert_eq!(both.len(), 2);
    }

    #[test]
    fn derive_scope_id_is_stable_and_unique_per_address() {
        let long_name = format!("{}{}", "a".repeat(60), "b");
        let a = derive_scope_id(&long_name, "192.168.1.0/24");
        let b = derive_scope_id(&long_name, "10.0.0.0/24");
        assert_ne!(a, b);
        assert_eq!(a, derive_scope_id(&long_name, "192.168.1.0/24"));
        assert!(a.len() <= 96);

        let v6_link = derive_scope_id("eth0", "fe80::1");
        let v6_global = derive_scope_id("eth0", "2001:db8::1");
        assert_ne!(v6_link, v6_global);
        assert!(v6_link.len() <= 96);

        let weird = derive_scope_id("eth\u{1}0", "192.168.1.0/24");
        assert!(!weird.contains('\u{1}'));
        assert!(!weird.chars().any(|ch| ch.is_control()));
    }

    #[test]
    fn build_scan_scopes_from_keeps_unique_rows_and_dedups_ineligible_duplicates() {
        let interfaces = vec![
            ("eth0".to_string(), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))),
            ("eth0".to_string(), IpAddr::V4(Ipv4Addr::new(10, 0, 0, 20))),
            ("lo".to_string(), IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
            ("lo".to_string(), IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
            ("eth0".to_string(), IpAddr::V6("fe80::1".parse().unwrap())),
            ("eth0".to_string(), IpAddr::V6("2001:db8::1".parse().unwrap())),
        ];
        let scopes = build_scan_scopes_from(interfaces.into_iter());
        let ids = scopes
            .iter()
            .map(|scope| scope.scope_id.clone())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), scopes.len(), "scope ids must be unique");
        assert_eq!(scopes.len(), 5);
        assert_eq!(scopes.iter().filter(|scope| scope.eligible).count(), 2);
    }

    #[test]
    fn mixed_host_safety_boundary_is_skipped_per_host() {
        assert!(unsafe_scan_host(Ipv4Addr::new(127, 0, 0, 1)));
        assert!(unsafe_scan_host(Ipv4Addr::new(169, 254, 0, 1)));
        assert!(unsafe_scan_host(Ipv4Addr::new(224, 0, 0, 1)));
        assert!(unsafe_scan_host(Ipv4Addr::new(255, 255, 255, 255)));
        assert!(unsafe_scan_host(Ipv4Addr::UNSPECIFIED));
        assert!(!unsafe_scan_host(Ipv4Addr::new(10, 0, 0, 1)));
        assert!(!unsafe_scan_host(Ipv4Addr::new(192, 168, 1, 1)));
    }

    #[test]
    fn enumeration_skips_link_local_hosts_inside_a_scope() {
        let self_ips = HashSet::new();
        let mut scheduled = HashSet::new();
        let enumerated = enumerate_scan_hosts(
            Ipv4Addr::new(169, 254, 1, 0),
            24,
            &self_ips,
            &mut scheduled,
            MAX_SCAN_HOSTS,
        );
        assert_eq!(enumerated.hosts.len(), 0);
        assert_eq!(enumerated.skipped, 256);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn tcp_probe_detects_an_open_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = PeerCancellation::new();
        assert!(tcp_probe_open(listener.local_addr().unwrap(), SCAN_REQUEST_TIMEOUT, &cancel).await);
        drop(listener);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn tcp_probe_reports_a_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let cancel = PeerCancellation::new();
        assert!(!tcp_probe_open(address, SCAN_REQUEST_TIMEOUT, &cancel).await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_probe_never_publishes_late_candidates() {
        let scan_id = Uuid::new_v4();
        let started = now();
        let progress = std::sync::Mutex::new(initial_result(scan_id, started));
        let cancel = PeerCancellation::new();
        cancel.cancel();
        let result = run_scan_probe(
            scan_id,
            started,
            SCAN_SERVICE_PORT,
            &[request("manual", "manual", Ipv4Addr::new(127, 0, 0, 0), 30)],
            &HashSet::new(),
            &cancel,
            &progress,
        )
        .await;
        assert!(result.cancelled);
        assert_eq!(result.attempted, 0);
        assert_eq!(result.discovered, 0);
        assert!(result.finished_at_ms > 0);
    }

    async fn wait_scan(network: &PeerNetwork, id: Uuid) -> NetworkScanResult {
        for _ in 0..200 {
            let result = network.scan_status(id).unwrap();
            if result.finished_at_ms > 0 {
                return result;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("scan {id} did not finish");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_without_profile_never_writes_routes_or_membership() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "scan test profile")
            .unwrap();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let started = network
            .scan_start(vec![], vec!["192.168.1.7/32".to_string()])
            .await
            .unwrap();
        assert_eq!(started.finished_at_ms, 0);
        let finished = wait_scan(&network, started.scan_id).await;
        assert_eq!(finished.scan_id, started.scan_id);
        assert!(finished.finished_at_ms > 0);
        assert_eq!(finished.attempted, 1);
        assert!(host.peer_routes(&owner).unwrap().is_empty());
        assert!(host.peer_members(&owner, profile).unwrap().is_empty());
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn overlapping_scans_keep_only_the_newest_generation() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let first = network
            .scan_start(vec![], vec!["192.168.1.7/32".to_string()])
            .await
            .unwrap();
        let second = network
            .scan_start(vec![], vec!["192.168.1.8/32".to_string()])
            .await
            .unwrap();
        assert_ne!(first.scan_id, second.scan_id);
        assert!(network.scan_status(first.scan_id).is_err());
        let latest = wait_scan(&network, second.scan_id).await;
        assert_eq!(latest.scan_id, second.scan_id);
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stopping_the_network_cancels_an_active_scan() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let started = network
            .scan_start(vec![], vec!["10.0.0.0/8".to_string()])
            .await
            .unwrap();
        network.stop().await.unwrap();
        let terminal = network.scan_status(started.scan_id).unwrap();
        assert_eq!(terminal.scan_id, started.scan_id);
        assert!(terminal.cancelled);
        assert_eq!(terminal.stage, "cancelled");
        assert!(terminal.finished_at_ms > 0);
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_scan_terminates_with_a_cancelled_result() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let started = network
            .scan_start(vec![], vec!["10.0.0.0/8".to_string()])
            .await
            .unwrap();
        let snapshot = network.scan_cancel(started.scan_id).unwrap();
        assert_eq!(snapshot.scan_id, started.scan_id);
        assert!(snapshot.finished_at_ms == 0);
        let terminal = wait_scan(&network, started.scan_id).await;
        assert!(terminal.cancelled);
        assert_eq!(terminal.stage, "cancelled");
        assert!(terminal.finished_at_ms > 0);
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_start_rejects_unsafe_manual_cidr() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        for cidr in ["127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/24", "255.255.255.255/32", "0.0.0.0/8"] {
            let error = network
                .scan_start(vec![], vec![cidr.to_string()])
                .await
                .unwrap_err();
            assert!(matches!(error, HostError::InvalidScanScope), "{cidr}");
        }
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_start_rejects_more_than_eight_scopes() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let cidrs = (0..9)
            .map(|index| format!("10.137.{index}.0/24"))
            .collect::<Vec<_>>();
        let error = network.scan_start(vec![], cidrs).await.unwrap_err();
        assert!(matches!(error, HostError::InvalidRequest));
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scan_start_deduplicates_canonical_manual_cidrs() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let (_root, host, owner) = super::host();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        let started = network
            .scan_start(
                vec![],
                vec!["192.168.1.0/24".to_string(), "192.168.1.99/24".to_string()],
            )
            .await
            .unwrap();
        let names = started
            .scopes
            .iter()
            .map(|scope| scope.interface_name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["192.168.1.0/24"]);
        network.stop().await.unwrap();
        drop(network);
        super::stopped(host).await;
    }
}
