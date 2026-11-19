use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, serve};
use exomind_core::{CaptureCommand, CommandId, EventId, ProfileId};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

struct Fixture {
    root: tempfile::TempDir,
    host: Arc<BetaHost>,
    owner: exomind_beta_host::Session,
    profile: ProfileId,
    other_profile: ProfileId,
    grant: exomind_beta_host::IssuedGrant,
    server: exomind_beta_host::RunningServer,
    http: reqwest::Client,
}

async fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic wait P")
        .unwrap();
    host.provision_profile(&owner, other_profile, "Synthetic wait Q")
        .unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    Fixture {
        root,
        host,
        owner,
        profile,
        other_profile,
        grant,
        server,
        http,
    }
}

fn wait_url(fixture: &Fixture, profile: ProfileId) -> String {
    format!(
        "http://{}/beta/v1/profiles/{profile}/wait",
        fixture.server.addr()
    )
}

fn append_capture(host: &BetaHost, session: &exomind_beta_host::Session, profile: ProfileId) {
    host.capture(
        session,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1,
            text: "synthetic wait capture".to_owned(),
            tags: vec!["synthetic".to_owned()],
            originals: Vec::new(),
        },
    )
    .unwrap();
}

async fn stop(fixture: Fixture) {
    fixture.server.stop().await.unwrap();
    let _ = fixture.host.stop();
    let _ = fixture.root;
}

#[tokio::test]
async fn wait_rejects_invalid_bounds_unknown_fields_and_a_future_cursor() {
    let fixture = fixture().await;
    for body in [
        json!({"after_local_seq":0,"timeout_ms":0}),
        json!({"after_local_seq":0,"timeout_ms":30_001}),
        json!({"after_local_seq":0,"timeout_ms":1000,"unexpected":true}),
        json!({"after_local_seq":1,"timeout_ms":1000}),
    ] {
        let response = fixture
            .http
            .post(wait_url(&fixture, fixture.profile))
            .bearer_auth(&fixture.grant.token)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
    }
    stop(fixture).await;
}

#[tokio::test]
async fn another_profiles_capture_does_not_satisfy_the_wait() {
    let fixture = fixture().await;
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.other_profile)
        .unwrap();
    append_capture(&fixture.host, &writer, fixture.other_profile);
    let response = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":100}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let result: Value = response.json().await.unwrap();
    assert_eq!(result["state"], "timeout");
    assert_eq!(result["highwater"], 0);
    stop(fixture).await;
}

#[tokio::test]
async fn wait_returns_timeout_without_matching_profile_sequence_change() {
    let fixture = fixture().await;
    let response = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":40}))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["state"], "timeout");
    assert_eq!(value["profile_id"], fixture.profile.to_string());
    stop(fixture).await;
}

#[tokio::test]
async fn wait_returns_changed_after_a_capture_is_committed() {
    let fixture = fixture().await;
    let request = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":2_000}));
    let pending = tokio::spawn(async move { request.send().await.unwrap() });
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.profile)
        .unwrap();
    append_capture(&fixture.host, &writer, fixture.profile);

    let response = pending.await.unwrap();
    assert_eq!(response.status(), 200);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["state"], "changed");
    assert!(value["highwater"].as_u64().unwrap() > 0);
    stop(fixture).await;
}

#[tokio::test]
async fn wait_does_not_cross_profiles_and_rechecks_revocation() {
    let fixture = fixture().await;
    append_capture(
        &fixture.host,
        &fixture
            .host
            .native_human_session(&fixture.owner, fixture.other_profile)
            .unwrap(),
        fixture.other_profile,
    );
    let response = fixture
        .http
        .post(wait_url(&fixture, fixture.other_profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":30}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);

    let request = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":2_000}));
    let pending = tokio::spawn(async move { request.send().await.unwrap() });
    tokio::time::sleep(Duration::from_millis(25)).await;
    fixture
        .host
        .revoke_grant(&fixture.owner, fixture.grant.grant_id)
        .unwrap();
    assert_eq!(pending.await.unwrap().status(), 401);
    stop(fixture).await;
}

#[tokio::test]
async fn wait_stops_when_host_shutdown_is_requested() {
    let fixture = fixture().await;
    let request = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":2_000}));
    let pending = tokio::spawn(async move { request.send().await.unwrap() });
    tokio::time::sleep(Duration::from_millis(25)).await;
    fixture.host.request_stop();
    assert_eq!(pending.await.unwrap().status(), 503);
    stop(fixture).await;
}

#[tokio::test]
async fn wait_admission_is_bounded_and_http_cancellation_releases_a_slot() {
    let fixture = fixture().await;
    let mut requests = tokio::task::JoinSet::new();
    for _ in 0..5 {
        let http = fixture.http.clone();
        let url = wait_url(&fixture, fixture.profile);
        let token = fixture.grant.token.clone();
        requests.spawn(async move {
            http.post(url)
                .bearer_auth(token)
                .json(&json!({"after_local_seq":0,"timeout_ms":150}))
                .send()
                .await
                .unwrap()
                .status()
        });
    }
    let mut statuses = Vec::new();
    while let Some(status) = requests.join_next().await {
        statuses.push(status.unwrap());
    }
    assert_eq!(statuses.iter().filter(|status| **status == 429).count(), 1);
    assert_eq!(statuses.iter().filter(|status| **status == 200).count(), 4);

    let mut active = tokio::task::JoinSet::new();
    for _ in 0..3 {
        let http = fixture.http.clone();
        let url = wait_url(&fixture, fixture.profile);
        let token = fixture.grant.token.clone();
        active.spawn(async move {
            http.post(url)
                .bearer_auth(token)
                .json(&json!({"after_local_seq":0,"timeout_ms":2_000}))
                .send()
                .await
        });
    }
    tokio::time::sleep(Duration::from_millis(25)).await;
    let cancel_http = fixture.http.clone();
    let cancel_url = wait_url(&fixture, fixture.profile);
    let cancel_token = fixture.grant.token.clone();
    let cancelled = tokio::spawn(async move {
        cancel_http
            .post(cancel_url)
            .bearer_auth(cancel_token)
            .json(&json!({"after_local_seq":0,"timeout_ms":2_000}))
            .send()
            .await
    });
    tokio::time::sleep(Duration::from_millis(25)).await;
    cancelled.abort();
    let _ = cancelled.await;
    tokio::time::sleep(Duration::from_millis(25)).await;
    let response = fixture
        .http
        .post(wait_url(&fixture, fixture.profile))
        .bearer_auth(&fixture.grant.token)
        .json(&json!({"after_local_seq":0,"timeout_ms":20}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    active.abort_all();
    while active.join_next().await.is_some() {}
    stop(fixture).await;
}
