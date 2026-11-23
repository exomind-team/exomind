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

async fn read_current(
    client: &reqwest::Client,
    root: &str,
    profile: ProfileId,
    token: &str,
) -> Value {
    client
        .get(format!(
            "{root}/beta/v1/profiles/{profile}/timeblocks/current"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn action(
    client: &reqwest::Client,
    root: &str,
    profile: ProfileId,
    token: &str,
    action: Value,
) -> String {
    let current = read_current(client, root, profile, token).await;
    let event_id = Uuid::new_v4();
    let response = client
        .post(format!(
            "{root}/beta/v1/profiles/{profile}/timeblocks/commands"
        ))
        .bearer_auth(token)
        .json(&json!({
            "command_id": Uuid::new_v4(),
            "event_id": event_id,
            "expected_revision": current["revision"],
            "action": action,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    event_id.to_string()
}

async fn recent(
    client: &reqwest::Client,
    root: &str,
    profile: ProfileId,
    token: &str,
    query: &str,
) -> (reqwest::StatusCode, Value) {
    let response = client
        .get(format!(
            "{root}/beta/v1/profiles/{profile}/timeblocks/recent{query}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let body = response.json().await.unwrap_or(Value::Null);
    (status, body)
}

async fn fixture() -> (
    tempfile::TempDir,
    Arc<BetaHost>,
    ProfileId,
    String,
    String,
    String,
) {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let foreign = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic timeblocks")
        .unwrap();
    host.provision_profile(&owner, foreign, "foreign profile")
        .unwrap();
    let human = token(&host, &owner, profile, GrantKind::Human);
    let observer = token(&host, &owner, profile, GrantKind::Observer);
    let foreign_observer = token(&host, &owner, foreign, GrantKind::Observer);
    (directory, host, profile, human, observer, foreign_observer)
}

#[tokio::test]
async fn recent_timeblocks_reports_complete_empty_profile_and_keeps_profile_scope() {
    let (_directory, host, profile, _human, observer, foreign_observer) = fixture().await;
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();

    let (status, response) = recent(&client, &root, profile, &observer, "").await;
    assert_eq!(status, 200);
    assert_eq!(response["profile_id"], profile.to_string());
    assert_eq!(response["state"], "empty");
    assert_eq!(response["recent"], json!([]));
    assert!(response["revision"].is_string());
    assert_eq!(response["coverage"]["complete"], true);
    assert_eq!(response["coverage"]["nodes_complete"], true);

    let (status, foreign) = recent(&client, &root, profile, &foreign_observer, "").await;
    assert_eq!(status, 403);
    assert_eq!(foreign["error"]["code"], "forbidden");
    server.stop().await.unwrap();
}

#[tokio::test]
async fn recent_timeblocks_returns_active_metadata_and_interval_duration_from_one_revision() {
    let (_directory, host, profile, human, observer, _) = fixture().await;
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();
    let block_id = Uuid::new_v4();
    let start_event_id = action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"start","block_id":block_id,"name":"active block","note":"synthetic note","timer":{"mode":"count_up"}}),
    )
    .await;
    let before = read_current(&client, &root, profile, &human).await;

    let (status, response) = recent(&client, &root, profile, &observer, "?limit=3").await;

    assert_eq!(status, 200);
    assert_eq!(response["state"], "active");
    assert_eq!(response["coverage"]["complete"], true);
    assert_eq!(response["revision"], before["revision"]);
    assert_eq!(response["active"]["block_id"], block_id.to_string());
    assert_eq!(response["active"]["name"], "active block");
    assert_eq!(response["active"]["note"], "synthetic note");
    assert_eq!(response["active"]["phase"], "running");
    assert!(
        response["active"]["source_event_ids"]
            .as_array()
            .unwrap()
            .contains(&json!(start_event_id))
    );
    assert!(response["active"]["work_ms"].is_number());
    assert!(response["active"]["intervals"].is_array());
    assert_eq!(
        read_current(&client, &root, profile, &human).await["revision"],
        before["revision"]
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn recent_timeblocks_projects_manual_end_feedback_and_running_work_from_intervals() {
    let (_directory, host, profile, human, observer, _) = fixture().await;
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();
    let block_id = Uuid::new_v4();
    let start = action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"start","block_id":block_id,"name":"finished block","note":"note","timer":{"mode":"count_up"}}),
    )
    .await;
    action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"pause","block_id":block_id}),
    )
    .await;
    action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"resume","block_id":block_id}),
    )
    .await;
    let ended = action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"end_action","block_id":block_id}),
    )
    .await;
    let (pending_status, pending) = recent(&client, &root, profile, &observer, "").await;
    assert_eq!(pending_status, 200);
    let pending_summary = if pending["active"]["block_id"] == block_id.to_string() {
        &pending["active"]
    } else {
        pending["recent"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["block_id"] == block_id.to_string())
            .unwrap()
    };
    assert_eq!(pending_summary["phase"], "feedback_pending");
    assert_eq!(pending_summary["end_reason"], "manual_end");
    let feedback = action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"submit_feedback","block_id":block_id,"feedback":{"kind":"text","text":"synthetic feedback"}}),
    )
    .await;

    let (status, response) = recent(&client, &root, profile, &observer, "?limit=3").await;

    assert_eq!(status, 200);
    assert_eq!(response["state"], "complete");
    assert_eq!(response["coverage"]["complete"], true);
    let summary = response["recent"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["block_id"] == block_id.to_string())
        .unwrap();
    assert_eq!(summary["name"], "finished block");
    assert_eq!(summary["note"], "note");
    assert_eq!(summary["phase"], "completed");
    assert_eq!(summary["end_reason"], "manual_end");
    assert_eq!(summary["feedback"][0]["event_id"], feedback);
    assert_eq!(summary["feedback"][0]["text_preview"], "synthetic feedback");
    for source in [&start, &ended, &feedback] {
        assert!(
            summary["source_event_ids"]
                .as_array()
                .unwrap()
                .contains(&json!(source))
        );
    }
    let running_ms = summary["intervals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "running")
        .map(|item| item["to_ms"].as_i64().unwrap() - item["from_ms"].as_i64().unwrap())
        .sum::<i64>();
    assert_eq!(summary["work_ms"].as_u64(), Some(running_ms.max(0) as u64));
    assert!(
        summary["intervals"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["block_id"] == block_id.to_string() || item["block_id"].is_null())
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn recent_timeblocks_marks_a_capped_node_page_incomplete_instead_of_claiming_no_history() {
    let (_directory, host, profile, human, observer, _) = fixture().await;
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();
    let block_id = Uuid::new_v4();
    action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"start","block_id":block_id,"name":"block","note":"","timer":{"mode":"count_up"}}),
    )
    .await;
    action(
        &client,
        &root,
        profile,
        &human,
        json!({"kind":"pause","block_id":block_id}),
    )
    .await;

    let (status, response) = recent(&client, &root, profile, &observer, "?node_limit=1").await;

    assert_eq!(status, 200);
    assert_eq!(response["state"], "incomplete");
    assert_eq!(response["coverage"]["complete"], false);
    assert_eq!(response["coverage"]["nodes_complete"], false);
    assert!(response["coverage"]["next_before"].is_number());
    assert!(
        !response["recent"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["complete"] == true)
    );
    server.stop().await.unwrap();
}

#[tokio::test]
async fn recent_timeblocks_rejects_limits_above_the_bounded_contract() {
    let (_directory, host, profile, _human, observer, _) = fixture().await;
    let server = serve(host, "127.0.0.1:0".parse().unwrap()).await.unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();

    for query in ["?limit=21", "?node_limit=501", "?interval_limit=101"] {
        let (status, _) = recent(&client, &root, profile, &observer, query).await;
        assert_eq!(status, 400, "query {query} must remain bounded");
    }
    server.stop().await.unwrap();
}

#[tokio::test]
async fn recent_timeblocks_reports_older_blocks_beyond_the_requested_limit() {
    let (_directory, host, profile, human, observer, _) = fixture().await;
    let server = serve(host, "127.0.0.1:0".parse().unwrap()).await.unwrap();
    let root = format!("http://{}", server.addr());
    let client = http();

    for name in ["older block", "newer block"] {
        let block_id = Uuid::new_v4();
        action(
            &client,
            &root,
            profile,
            &human,
            json!({"kind":"start","block_id":block_id,"name":name,"note":"","timer":{"mode":"count_up"}}),
        )
        .await;
        action(
            &client,
            &root,
            profile,
            &human,
            json!({"kind":"end_action","block_id":block_id}),
        )
        .await;
        action(
            &client,
            &root,
            profile,
            &human,
            json!({"kind":"submit_feedback","block_id":block_id,"feedback":{"kind":"skipped"}}),
        )
        .await;
    }

    let (status, response) = recent(&client, &root, profile, &observer, "?limit=1").await;

    assert_eq!(status, 200);
    assert_eq!(response["coverage"]["complete"], true);
    assert_eq!(response["coverage"]["more_available"], true);
    assert_eq!(response["recent"].as_array().unwrap().len(), 1);
    assert_eq!(response["recent"][0]["name"], "newer block");
    server.stop().await.unwrap();
}
