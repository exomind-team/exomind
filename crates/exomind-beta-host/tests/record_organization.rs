use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, RunningServer, Session, serve};
use exomind_core::{AgentId, CaptureCommand, CommandId, EventId, ProfileId};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::Arc};
use tempfile::TempDir;

fn client() -> Client {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

fn grant(host: &BetaHost, owner: &Session, profile: ProfileId, kind: GrantKind) -> String {
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

async fn server() -> (TempDir, Arc<BetaHost>, RunningServer, String) {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let server = serve(host.clone(), SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let url = format!("http://{}", server.addr());
    (directory, host, server, url)
}

fn capture(profile_id: ProfileId, text: &str, tag: &str) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1_794_000_000_000,
        text: text.to_owned(),
        tags: vec![tag.to_owned()],
        originals: vec![],
    }
}

#[tokio::test]
async fn scoped_http_tag_search_and_correction_roles_are_explicit() {
    let (_directory, host, server, url) = server().await;
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic P")
        .unwrap();
    host.provision_profile(&owner, other_profile, "synthetic Q")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let observer = grant(&host, &owner, profile, GrantKind::Observer);
    let agent = grant(&host, &owner, profile, GrantKind::AgentNote);
    let human_session = host.authenticate(&human).unwrap();
    let original = capture(profile, "needle in an immutable capture", "Topic");
    host.capture(&human_session, &original).unwrap();
    let original_record = host
        .events_page(
            &human_session,
            profile,
            &exomind_core::EventQuery::default(),
        )
        .unwrap()
        .items
        .into_iter()
        .find(|record| record.event_id == original.event_id)
        .unwrap();
    let http = client();

    let filtered: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/events"))
        .bearer_auth(&human)
        .query(&[("tag", "Topic"), ("q", "needle in an immutable")])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let observer_filtered: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/events"))
        .bearer_auth(&observer)
        .query(&[("tag", "Topic"), ("q", "needle in an immutable")])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let cross_profile = http
        .get(format!("{url}/beta/v1/profiles/{other_profile}/events"))
        .bearer_auth(&human)
        .query(&[("tag", "Topic")])
        .send()
        .await
        .unwrap();
    let invalid_tag = http
        .get(format!("{url}/beta/v1/profiles/{profile}/events"))
        .bearer_auth(&human)
        .query(&[("tag", " \t\n")])
        .send()
        .await
        .unwrap();

    assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        filtered["items"][0]["event_id"],
        original.event_id.to_string()
    );
    assert_eq!(observer_filtered["items"], filtered["items"]);
    assert_eq!(cross_profile.status(), StatusCode::FORBIDDEN);
    assert_eq!(invalid_tag.status(), StatusCode::BAD_REQUEST);

    let correction = json!({
        "command_id": CommandId::new(),
        "event_id": EventId::new(),
        "occurred_at_ms": 1_794_000_000_001_i64,
        "target_event_id": original_record.event_id,
        "target_digest": original_record.digest,
        "corrected_text": "a distinct corrected statement"
    });
    let human_correction: Value = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&human)
        .json(&correction)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let agent_correction = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&agent)
        .json(&correction)
        .send()
        .await
        .unwrap();
    let conflicting_correction = json!({
        "command_id": CommandId::new(),
        "event_id": EventId::new(),
        "occurred_at_ms": 1_794_000_000_002_i64,
        "target_event_id": original_record.event_id,
        "target_digest": "0".repeat(64),
        "corrected_text": "wrong target digest"
    });
    let target_conflict = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&human)
        .json(&conflicting_correction)
        .send()
        .await
        .unwrap();
    let target_conflict_status = target_conflict.status();
    let target_conflict_body: Value = target_conflict.json().await.unwrap();
    let observer_correction = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&observer)
        .json(&correction)
        .send()
        .await
        .unwrap();
    let mut spoofed_correction = correction.clone();
    spoofed_correction["author_kind"] = json!("human");
    let agent_spoof = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&agent)
        .json(&spoofed_correction)
        .send()
        .await
        .unwrap();
    let page: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let target_page: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&observer)
        .query(&[("target_event_id", original_record.event_id.to_string())])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let correction_search: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/events"))
        .bearer_auth(&observer)
        .query(&[("q", "distinct corrected statement")])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let original_after = host
        .events_page(
            &human_session,
            profile,
            &exomind_core::EventQuery::default(),
        )
        .unwrap()
        .items
        .into_iter()
        .find(|record| record.event_id == original.event_id)
        .unwrap();

    assert_eq!(human_correction["event_id"], correction["event_id"]);
    assert_eq!(agent_correction.status(), StatusCode::FORBIDDEN);
    assert_eq!(observer_correction.status(), StatusCode::FORBIDDEN);
    assert_eq!(agent_spoof.status(), StatusCode::BAD_REQUEST);
    assert_eq!(target_conflict_status, StatusCode::CONFLICT);
    assert_eq!(
        target_conflict_body["error"]["code"],
        "correction_target_conflict"
    );
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["target_state"], "digest_matches");
    assert_eq!(page["items"][0]["record"]["author_kind"], "human");
    assert_eq!(target_page["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        target_page["items"][0]["record"]["target_event_id"],
        original_record.event_id.to_string()
    );
    assert_eq!(correction_search["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        correction_search["items"][0]["event_id"],
        original_record.event_id.to_string()
    );
    assert_eq!(original_after.digest, original_record.digest);
    assert_eq!(original_after.text, original_record.text);

    server.stop().await.unwrap();
}

#[tokio::test]
async fn exact_correction_http_read_is_scoped_and_returns_null_only_for_absence() {
    let (_directory, host, server, url) = server().await;
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic P")
        .unwrap();
    host.provision_profile(&owner, other_profile, "synthetic Q")
        .unwrap();
    let human = grant(&host, &owner, profile, GrantKind::Human);
    let observer = grant(&host, &owner, profile, GrantKind::Observer);
    let agent = grant(&host, &owner, profile, GrantKind::AgentNote);
    let correction_id = EventId::new();
    let target_id = EventId::new();
    let correction = json!({
        "command_id": CommandId::new(),
        "event_id": correction_id,
        "occurred_at_ms": 1_794_000_000_003_i64,
        "target_event_id": target_id,
        "target_digest": "a".repeat(64),
        "corrected_text": "an independent correction whose target is not present"
    });
    let http = client();
    let written: Value = http
        .post(format!("{url}/beta/v1/profiles/{profile}/corrections"))
        .bearer_auth(&human)
        .json(&correction)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(written["event_id"], correction_id.to_string());

    let capabilities: Value = http
        .get(format!("{url}/beta/v1/hello"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(capabilities["capabilities"]["correction_source"], true);

    let exact: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/corrections/{correction_id}"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(exact["record"]["profile_id"], profile.to_string());
    assert_eq!(exact["record"]["event_id"], correction_id.to_string());
    assert_eq!(exact["record"]["target_event_id"], target_id.to_string());
    assert_eq!(exact["record"]["corrected_text"], correction["corrected_text"]);
    assert_eq!(exact["target_state"], "unresolved");

    let agent_exact: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/corrections/{correction_id}"))
        .bearer_auth(&agent)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(agent_exact, exact);

    let missing: Value = http
        .get(format!("{url}/beta/v1/profiles/{profile}/corrections/{}", EventId::new()))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(missing.is_null());

    let cross_profile = http
        .get(format!("{url}/beta/v1/profiles/{other_profile}/corrections/{correction_id}"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap();
    assert_eq!(cross_profile.status(), StatusCode::FORBIDDEN);
    assert!(matches!(
        host.correction_event(&owner, profile, correction_id),
        Err(exomind_beta_host::HostError::Forbidden)
    ));

    server.stop().await.unwrap();
}
