use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, HostError, Session, serve};
use exomind_core::{
    AgentId, CaptureCommand, CommandId, EventId, ExternalSummaryAppendCommand, ProfileId,
    SummarySourceRef,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

fn issue(
    host: &BetaHost,
    owner: &Session,
    p: ProfileId,
    kind: GrantKind,
    agent: Option<AgentId>,
) -> String {
    host.grant(
        owner,
        GrantRequest {
            profile_id: p,
            kind,
            agent_id: agent,
        },
    )
    .unwrap()
    .token
}
fn capture(p: ProfileId) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1000,
        text: "Synthetic external-summary source".into(),
        tags: vec![],
        originals: vec![],
    }
}
fn seed(host: &BetaHost, human: &Session, p: ProfileId) -> ExternalSummaryAppendCommand {
    let source = capture(p);
    let receipt = host.capture(human, &source).unwrap();
    ExternalSummaryAppendCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 2000,
        observed_through: receipt.local_seq,
        sources: vec![SummarySourceRef {
            event_id: source.event_id,
            kind: "capture".into(),
            digest: receipt.event_digest,
        }],
        narrative: "Synthetic external Agent review with one explicit text source.".into(),
        evidence: vec![source.event_id],
    }
}

#[test]
fn producer_append_is_distinct_durable_and_bound_to_its_actor_and_current_scope() {
    let root = tempfile::tempdir().unwrap();
    let host = BetaHost::open(root.path()).unwrap();
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic producer P")
        .unwrap();
    host.provision_profile(&owner, q, "Synthetic producer Q")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let command = seed(&host, &human, p);
    let agent_id = AgentId::new();
    assert!(matches!(
        host.grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::SummaryProducer,
                agent_id: None
            }
        ),
        Err(HostError::InvalidRequest)
    ));
    for kind in [GrantKind::Observer, GrantKind::Human, GrantKind::AgentNote] {
        let token = issue(
            &host,
            &owner,
            p,
            kind,
            (kind == GrantKind::AgentNote).then(AgentId::new),
        );
        let session = host.authenticate(&token).unwrap();
        assert!(matches!(
            host.append_external_summary(&session, &command),
            Err(HostError::Forbidden)
        ));
    }
    assert!(matches!(
        host.append_external_summary(&owner, &command),
        Err(HostError::Forbidden)
    ));
    let token = issue(&host, &owner, p, GrantKind::SummaryProducer, Some(agent_id));
    let producer = host.authenticate(&token).unwrap();
    assert!(matches!(
        host.capture(&producer, &capture(p)),
        Err(HostError::Forbidden)
    ));
    let mut wrong = command.clone();
    wrong.profile_id = q;
    assert!(matches!(
        host.append_external_summary(&producer, &wrong),
        Err(HostError::Forbidden)
    ));
    let receipt = host.append_external_summary(&producer, &command).unwrap();
    assert!(!receipt.replayed);
    let replay = host.append_external_summary(&producer, &command).unwrap();
    assert!(replay.replayed);
    assert_eq!(receipt.event_digest, replay.event_digest);
    let mut changed = command.clone();
    changed.narrative.push_str(" changed");
    assert!(host.append_external_summary(&producer, &changed).is_err());
    assert!(
        host.summary_tasks_page(&producer, p, None, 25)
            .unwrap()
            .items
            .is_empty()
    );
    let before = host.status().unwrap();
    host.stop().unwrap();
    drop(host);
    let reopened = BetaHost::open(root.path()).unwrap();
    assert!(matches!(
        reopened.append_external_summary(&producer, &command),
        Err(HostError::Unauthorized)
    ));
    let session = reopened.authenticate(&token).unwrap();
    let after = reopened
        .append_external_summary(&session, &command)
        .unwrap();
    assert!(after.replayed);
    assert_eq!(after.event_digest, receipt.event_digest);
    assert_eq!(before.device_id, reopened.status().unwrap().device_id);
    reopened.stop().unwrap();
}

#[tokio::test]
async fn real_http_producer_appends_typed_summary_without_acquiring_legacy_writes() {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic HTTP producer P")
        .unwrap();
    host.provision_profile(&owner, q, "Synthetic HTTP producer Q")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let command = seed(&host, &human, p);
    let actor = AgentId::new();
    let producer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::SummaryProducer,
                agent_id: Some(actor),
            },
        )
        .unwrap();
    let observer = issue(&host, &owner, p, GrantKind::Observer, None);
    let agent = issue(&host, &owner, p, GrantKind::AgentNote, Some(AgentId::new()));
    let human_token = issue(&host, &owner, p, GrantKind::Human, None);
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1", server.addr());
    let endpoint = format!("{base}/profiles/{p}/external-summaries");
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let caps = http
        .post(format!("{base}/profiles/{p}/access/check"))
        .bearer_auth(&producer.token)
        .json(&json!({"required":["external_summary_append","events_read"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(caps.status(), 200);
    let caps: Value = caps.json().await.unwrap();
    assert_eq!(caps["grant_kind"], "summary_producer");
    assert_eq!(caps["agent_id"], actor.to_string());
    for denied in [
        "capture_append_human",
        "capture_append_agent_note",
        "originals_stage",
        "timeblocks_control",
        "summaries_control",
    ] {
        assert!(!caps["allowed"].as_array().unwrap().contains(&json!(denied)));
    }
    for token in [&observer, &agent, &human_token] {
        assert_eq!(
            http.post(&endpoint)
                .bearer_auth(token)
                .json(&command)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        http.post(format!("{base}/profiles/{q}/external-summaries"))
            .bearer_auth(&producer.token)
            .json(&command)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    for (key, value) in [
        ("producer_agent_id", json!(Uuid::new_v4())),
        ("current", json!(true)),
        ("read_original_ids", json!([Uuid::new_v4()])),
    ] {
        let mut forged = serde_json::to_value(&command).unwrap();
        forged[key] = value;
        assert_eq!(
            http.post(&endpoint)
                .bearer_auth(&producer.token)
                .json(&forged)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    assert_eq!(
        http.post(format!("{base}/capture"))
            .bearer_auth(&producer.token)
            .json(&capture(p))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let metadata = json!({"original_id":Uuid::new_v4(),"expected_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","byte_length":0,"file_name":"synthetic.bin","media_type":"application/octet-stream"});
    assert_eq!(
        http.put(format!("{base}/profiles/{p}/stages/{}", Uuid::new_v4()))
            .bearer_auth(&producer.token)
            .json(&metadata)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let mut invalid_commands = Vec::new();
    let mut wrong_digest = command.clone();
    wrong_digest.sources[0].digest = "0".repeat(64);
    invalid_commands.push(wrong_digest);
    let mut unknown_evidence = command.clone();
    unknown_evidence.evidence = vec![EventId::new()];
    invalid_commands.push(unknown_evidence);
    let mut duplicate_sources = command.clone();
    duplicate_sources.sources.push(command.sources[0].clone());
    invalid_commands.push(duplicate_sources);
    let mut empty_sources = command.clone();
    empty_sources.sources.clear();
    invalid_commands.push(empty_sources);
    let mut empty_narrative = command.clone();
    empty_narrative.narrative.clear();
    invalid_commands.push(empty_narrative);
    let mut future_view = command.clone();
    future_view.observed_through = u64::MAX;
    invalid_commands.push(future_view);
    for invalid in invalid_commands {
        assert_eq!(
            http.post(&endpoint)
                .bearer_auth(&producer.token)
                .json(&invalid)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    }
    let response = http
        .post(&endpoint)
        .bearer_auth(&producer.token)
        .json(&command)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let receipt: Value = response.json().await.unwrap();
    assert_eq!(receipt["event_id"], command.event_id.to_string());
    assert_eq!(receipt["durability"], "local_committed");
    let record: Value = http
        .get(format!(
            "{base}/profiles/{p}/timeline/events/{}",
            command.event_id
        ))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(record["kind"], "agent_summary/1");
    assert_eq!(record["record"]["producer_agent_id"], actor.to_string());
    assert_eq!(record["record"]["narrative"], command.narrative);
    assert_eq!(
        record["record"]["snapshot"]["coverage"]["source_delivery"],
        "not_attested"
    );
    assert!(
        !record["record"]
            .as_object()
            .unwrap()
            .contains_key("current")
    );
    let timeline: Value = http
        .get(format!("{base}/profiles/{p}/timeline?limit=100"))
        .bearer_auth(&observer)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(timeline["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        timeline["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["kind"] == "agent_summary/1")
            .count(),
        1
    );
    let replay: Value = http
        .post(&endpoint)
        .bearer_auth(&producer.token)
        .json(&command)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["event_digest"], receipt["event_digest"]);
    let mut changed = command.clone();
    changed.narrative.push_str(" other");
    assert_eq!(
        http.post(&endpoint)
            .bearer_auth(&producer.token)
            .json(&changed)
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    host.revoke_grant(&owner, producer.grant_id).unwrap();
    assert_eq!(
        http.post(&endpoint)
            .bearer_auth(&producer.token)
            .json(&command)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        http.get(format!("{base}/profiles/{p}/timeline?limit=100"))
            .bearer_auth(&observer)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.stop().await.unwrap();
}
