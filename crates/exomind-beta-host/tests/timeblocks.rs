use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, Session, serve};
use exomind_core::{AgentId, ProfileId};
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

fn token(host: &BetaHost, owner: &Session, profile: ProfileId, kind: GrantKind) -> String {
    host.grant(
        owner,
        GrantRequest {
            profile_id: profile,
            kind,
            agent_id: (kind == GrantKind::AgentNote).then(AgentId::new),
        },
    )
    .unwrap()
    .token
}
fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}
fn request(revision: Value, action: Value) -> Value {
    json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"expected_revision":revision,"action":action})
}

#[tokio::test]
async fn real_http_typed_timeblock_command_retry_and_unknown_clock_fields() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic HTTP timer")
        .unwrap();
    let human = token(&host, &owner, p, GrantKind::Human);
    let observer = token(&host, &owner, p, GrantKind::Observer);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1/profiles/{p}/timeblocks", server.addr());
    let client = http();
    let response = client
        .get(format!("{base}/current"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        200,
        "the real timeblock HTTP resource must exist"
    );
    let empty: Value = response.json().await.unwrap();
    assert!(empty["active"].is_null());
    let block = Uuid::new_v4();
    let input = request(
        empty["revision"].clone(),
        json!({"kind":"start","block_id":block,"name":"synthetic","note":"","timer":{"mode":"count_up"}}),
    );
    let first = client
        .post(format!("{base}/commands"))
        .bearer_auth(&human)
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200);
    let receipt: Value = first.json().await.unwrap();
    let repeated: Value = client
        .post(format!("{base}/commands"))
        .bearer_auth(&human)
        .json(&input)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(repeated["replayed"], true);
    assert_eq!(repeated["event_digest"], receipt["event_digest"]);
    let mut changed = input.clone();
    changed["action"]["name"] = json!("changed");
    assert_eq!(
        client
            .post(format!("{base}/commands"))
            .bearer_auth(&human)
            .json(&changed)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    for (field, value) in [
        ("clock", json!({"wall_ms":1})),
        ("source", json!("scheduler")),
        ("occurred_at_ms", json!(0)),
        ("profile_id", json!(p)),
    ] {
        let mut forged = input.clone();
        forged[field] = value;
        assert_eq!(
            client
                .post(format!("{base}/commands"))
                .bearer_auth(&human)
                .json(&forged)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    let current: Value = client
        .get(format!("{base}/current"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(current["active"]["block_id"], block.to_string());
    server.stop().await.unwrap();
}

#[tokio::test]
async fn real_http_observer_agent_and_wrong_profile_cannot_control_a_human_timer() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "P").unwrap();
    host.provision_profile(&owner, q, "Q").unwrap();
    let human = token(&host, &owner, p, GrantKind::Human);
    let observer = token(&host, &owner, p, GrantKind::Observer);
    let agent = token(&host, &owner, p, GrantKind::AgentNote);
    let other = token(&host, &owner, q, GrantKind::Human);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1/profiles/{p}/timeblocks", server.addr());
    let client = http();
    let response = client
        .get(format!("{base}/current"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let snapshot: Value = response.json().await.unwrap();
    let input = request(
        snapshot["revision"].clone(),
        json!({"kind":"start","block_id":Uuid::new_v4(),"name":"A","note":"","timer":{"mode":"count_up"}}),
    );
    assert_eq!(
        client
            .post(format!("{base}/commands"))
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    for denied in [&observer, &agent, &other] {
        assert_eq!(
            client
                .post(format!("{base}/commands"))
                .bearer_auth(denied)
                .json(&input)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        client
            .post(format!("{base}/commands"))
            .bearer_auth(&human)
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn ordinary_capture_tags_never_create_typed_timeblock_nodes() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic tags").unwrap();
    let human = token(&host, &owner, p, GrantKind::Human);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let url = format!("http://{}", server.addr());
    let client = http();
    let input = json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":p,"occurred_at_ms":1,"text":"ordinary note","tags":["block_start","timeblock.started","scheduler"],"originals":[]});
    assert_eq!(
        client
            .post(format!("{url}/beta/v1/capture"))
            .bearer_auth(&human)
            .json(&input)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let response = client
        .get(format!("{url}/beta/v1/profiles/{p}/timeblocks/current"))
        .bearer_auth(&human)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let current: Value = response.json().await.unwrap();
    assert!(current["active"].is_null());
    assert_eq!(current["heads"], json!([]));
    server.stop().await.unwrap();
}
