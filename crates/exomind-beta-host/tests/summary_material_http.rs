//! Permission and wire boundaries for Host-only original egress envelopes.
use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, serve};
use exomind_core::{AgentId, CommandId, EventId, EventQuery, OriginalId, ProfileId};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn material_envelopes_keep_low_grants_and_legacy_core_wire_separate() {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic egress scope")
        .unwrap();
    host.provision_profile(&owner, other, "Synthetic other scope")
        .unwrap();
    let issue = |kind| {
        host.grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind,
                agent_id: matches!(kind, GrantKind::AgentNote | GrantKind::SummaryProducer)
                    .then(AgentId::new),
            },
        )
        .unwrap()
        .token
    };
    let observer = issue(GrantKind::Observer);
    let before = host
        .timeline_page(
            &host.authenticate(&observer).unwrap(),
            profile,
            &EventQuery::default(),
        )
        .unwrap()
        .highwater;
    let human = issue(GrantKind::Human);
    let request = json!({
        "command_id": CommandId::new(), "event_id": EventId::new(), "profile_id": profile,
        "purpose": "manual_compress_v1", "artifact_kind": "compressed_message",
        "selection": {"block_ids":[Uuid::new_v4()],"from_ms":0,"to_ms":100,"selected_original_ids":[OriginalId::new()]}
    });
    let head = EventId::new();
    let control = json!({
        "command_id":CommandId::new(),"event_id":EventId::new(),"profile_id":profile,
        "task_id":Uuid::new_v4(),"expected_owner_generation":1,"expected_owner_control_event_id":head,
        "expected_control_heads":[head],"action":{"kind":"take_over_for_self","run_id":Uuid::new_v4(),"resume_cancelled":false}
    });
    let consent = json!({"provider_config_revision":Uuid::new_v4(),"max_original_bytes":68});
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1/profiles", server.addr());
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let mut responses = Vec::new();
    for token in [
        observer.clone(),
        issue(GrantKind::AgentNote),
        issue(GrantKind::SummaryProducer),
    ] {
        for (route, command) in [
            ("material-requests", &request),
            ("material-controls", &control),
        ] {
            let response = http
                .post(format!("{base}/{profile}/summaries/{route}"))
                .bearer_auth(&token)
                .json(&json!({"command":command,"consent":consent}))
                .send()
                .await
                .unwrap();
            responses.push((route, response.status().as_u16(), 403));
        }
    }
    for (route, command) in [
        ("material-requests", &request),
        ("material-controls", &control),
    ] {
        let wrong_profile = http
            .post(format!("{base}/{other}/summaries/{route}"))
            .bearer_auth(&human)
            .json(&json!({"command":command,"consent":consent}))
            .send()
            .await
            .unwrap();
        responses.push((route, wrong_profile.status().as_u16(), 403));
        let unknown = http
            .post(format!("{base}/{profile}/summaries/{route}"))
            .bearer_auth(&human)
            .json(&json!({"command":command,"consent":consent,"unexpected":true}))
            .send()
            .await
            .unwrap();
        responses.push((route, unknown.status().as_u16(), 400));
    }
    let legacy = http
        .post(format!("{base}/{profile}/summaries/requests"))
        .bearer_auth(&human)
        .json(&json!({"command":request,"consent":consent}))
        .send()
        .await
        .unwrap();
    responses.push(("legacy-core-request", legacy.status().as_u16(), 400));
    let after = host
        .timeline_page(
            &host.authenticate(&observer).unwrap(),
            profile,
            &EventQuery::default(),
        )
        .unwrap()
        .highwater;
    server.stop().await.unwrap();
    for (route, actual, expected) in responses {
        assert_eq!(actual, expected, "permission/wire boundary at {route}");
    }
    assert_eq!(after, before, "rejected envelopes cannot append Core facts");
}
