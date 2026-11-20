use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, Session, serve};
use exomind_core::{AgentId, ProfileId};
use serde_json::{Value, json};
use std::collections::HashSet;
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

async fn submit_capture(
    client: &reqwest::Client,
    root: &str,
    bearer: &str,
    profile: ProfileId,
    occurred_at_ms: i64,
    text: &str,
    tags: &[&str],
) {
    let body = json!({
        "command_id": Uuid::new_v4(),
        "event_id": Uuid::new_v4(),
        "profile_id": profile,
        "occurred_at_ms": occurred_at_ms,
        "text": text,
        "tags": tags,
        "originals": []
    });
    let response = client
        .post(format!("{root}/beta/v1/capture"))
        .bearer_auth(bearer)
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn period_route_composes_window_tag_and_search_and_keeps_legacy_read() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    host.provision_profile(&owner, profile, "P").unwrap();
    host.provision_profile(&owner, other_profile, "Q").unwrap();
    let human = token(&host, &owner, profile, GrantKind::Human);
    let observer = token(&host, &owner, profile, GrantKind::Observer);
    let other_human = token(&host, &owner, other_profile, GrantKind::Human);
    let other_observer = token(&host, &owner, other_profile, GrantKind::Observer);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let root = format!("http://{}", server.addr());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();

    submit_capture(
        &client,
        &root,
        &human,
        profile,
        1_000,
        "needle at start",
        &["focus"],
    )
    .await;
    submit_capture(
        &client,
        &root,
        &human,
        profile,
        1_999,
        "needle inside",
        &["focus"],
    )
    .await;
    submit_capture(
        &client,
        &root,
        &human,
        profile,
        2_000,
        "needle at end",
        &["focus"],
    )
    .await;
    submit_capture(
        &client,
        &root,
        &human,
        profile,
        1_500,
        "needle wrong tag",
        &["other"],
    )
    .await;
    submit_capture(
        &client,
        &root,
        &human,
        profile,
        1_600,
        "different text",
        &["focus"],
    )
    .await;
    submit_capture(
        &client,
        &root,
        &other_human,
        other_profile,
        1_500,
        "needle foreign profile",
        &["focus"],
    )
    .await;

    let period_url = format!(
        "{root}/beta/v1/profiles/{profile}/timeline/period?from_ms=1000&to_ms=2000&limit=100&tag=focus&q=needle"
    );
    let response = client
        .get(&period_url)
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        200,
        "the period read route must be exposed"
    );
    let page: Value = response.json().await.unwrap();
    let items = page["items"].as_array().unwrap();
    let texts: HashSet<_> = items
        .iter()
        .map(|item| item["record"]["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        texts,
        HashSet::from(["needle at start".to_owned(), "needle inside".to_owned()])
    );

    assert_eq!(
        client
            .get(&period_url)
            .bearer_auth(&other_observer)
            .send()
            .await
            .unwrap()
            .status(),
        403,
        "an independent profile grant must not cross the path profile"
    );

    let interval_url = format!(
        "{root}/beta/v1/profiles/{profile}/timeblocks/intervals?from_ms=1000&to_ms=2000&limit=100"
    );
    let interval_response = client
        .get(interval_url)
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(interval_response.status(), 200);
    let intervals: Value = interval_response.json().await.unwrap();
    assert!(intervals["items"].is_array());
    assert!(intervals["revision"].is_string());

    let legacy_url = format!("{root}/beta/v1/profiles/{profile}/timeline?limit=100");
    let legacy: Value = client
        .get(legacy_url)
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(legacy["items"].is_array());
    assert_eq!(legacy["highwater"], page["highwater"]);
    assert!(
        legacy["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["record"]["text"] == "needle at end")
    );

    server.stop().await.unwrap();
}
