use super::*;
use crate::{SummaryModelConfigurationCommand, SummaryModelSecretUpdate};
use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::post};
use exomind_core::{
    CaptureCommand, CommandId, EventQuery, SummaryControlAction, TimeblockAction, TimeblockCommand,
    TimeblockId,
};
use serde_json::{Value, json};
use sha2::Digest;
use std::sync::atomic::AtomicUsize;
use tokio::{net::TcpListener, sync::Notify, task::JoinHandle as AsyncJoin};

struct Mock {
    base: String,
    requests: Arc<Mutex<Vec<Value>>>,
    reached: Arc<Notify>,
    release: Arc<Notify>,
    task: AsyncJoin<()>,
}
impl Drop for Mock {
    fn drop(&mut self) {
        self.release.notify_waiters();
        self.task.abort();
    }
}
async fn mock(mode: usize) -> Mock {
    let requests = Arc::new(Mutex::new(vec![]));
    let reached = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let counter = Arc::new(AtomicUsize::new(0));
    let (saved, ready, allow, count) = (
        requests.clone(),
        reached.clone(),
        release.clone(),
        counter.clone(),
    );
    let router=Router::new().route("/v1/chat/completions",post(move|Json(body):Json<Value>|{let(saved,ready,allow,count)=(saved.clone(),ready.clone(),allow.clone(),count.clone());async move{
        let number=count.fetch_add(1,Ordering::SeqCst)+1;saved.lock().unwrap().push(body.clone());ready.notify_one();
        if mode==2{return(StatusCode::TOO_MANY_REQUESTS,"Synthetic rate limit").into_response();}
        if mode==1&&number==1{allow.notified().await;}
        let material:Value=serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        let evidence=if mode==3{Uuid::new_v4().to_string()}else{material["records"][0]["record"]["event_id"].as_str().unwrap().to_owned()};
        let answer=json!({"narrative":"Synthetic evidence-based review","evidence":[evidence]}).to_string();
        Json(json!({"id":format!("synthetic-request-{number}"),"model":"synthetic-reported-model","choices":[{"message":{"content":answer},"finish_reason":"stop"}],"usage":{"prompt_tokens":29,"completion_tokens":13}})).into_response()
    }}));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Mock {
        base,
        requests,
        reached,
        release,
        task,
    }
}
fn setup() -> (
    tempfile::TempDir,
    Arc<BetaHost>,
    Session,
    Session,
    ProfileId,
    ProfileId,
) {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic P").unwrap();
    host.provision_profile(&owner, q, "Synthetic Q").unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    (directory, host, owner, human, p, q)
}
fn configure(
    host: &BetaHost,
    owner: &Session,
    p: ProfileId,
    base: &str,
    expected: Option<Uuid>,
) -> crate::SummaryModelConfiguration {
    host.configure_summary_model(
        owner,
        p,
        &SummaryModelConfigurationCommand {
            command_id: Uuid::new_v4(),
            expected_revision: expected,
            enabled: true,
            base_url: base.into(),
            model: "synthetic-requested-model".into(),
            api_key: SummaryModelSecretUpdate::Set {
                value: "synthetic-key".into(),
            },
            max_output_tokens: 2048,
            timeout_ms: 10000,
            include_suggestions: false,
        },
    )
    .unwrap()
}
fn action(host: &BetaHost, human: &Session, p: ProfileId, value: Value) {
    let state = host.timeblock_snapshot(human, p).unwrap();
    host.apply_timeblock(
        human,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: state.revision,
            action: serde_json::from_value::<TimeblockAction>(value).unwrap(),
        },
    )
    .unwrap();
}
fn completed(host: &BetaHost, human: &Session, p: ProfileId) -> TimeblockId {
    let block = TimeblockId::new();
    action(
        host,
        human,
        p,
        json!({"kind":"start","block_id":block,"name":"Synthetic focus","note":"","timer":{"mode":"count_up"}}),
    );
    let at = host
        .timeblock_snapshot(human, p)
        .unwrap()
        .clock
        .server_now_ms;
    host.capture(
        human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: at,
            text: "Synthetic P evidence".into(),
            tags: vec![],
            originals: vec![],
        },
    )
    .unwrap();
    action(
        host,
        human,
        p,
        json!({"kind":"end_action","block_id":block}),
    );
    action(
        host,
        human,
        p,
        json!({"kind":"submit_feedback","block_id":block,"feedback":{"kind":"text","text":"Synthetic feedback"}}),
    );
    block
}
async fn wait_task(
    host: &BetaHost,
    human: &Session,
    p: ProfileId,
    state: SummaryState,
    timeout: Duration,
) -> SummaryTaskView {
    let end = Instant::now() + timeout;
    loop {
        let tasks = host.summary_tasks_page(human, p, None, 25).unwrap();
        if let Some(task) = tasks.items.into_iter().find(|task| task.state == state) {
            return task;
        }
        assert!(
            Instant::now() < end,
            "Summary task did not reach expected state {state:?}"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}
fn control(task: &SummaryTaskView, action: SummaryControlAction) -> SummaryControlCommand {
    SummaryControlCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: task.profile_id,
        task_id: task.task_id,
        expected_owner_generation: task.owner_generation,
        expected_owner_control_event_id: task.owner_control_event_id,
        expected_control_heads: task.control_heads.clone(),
        action,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_configuration_waits_then_real_worker_publishes_once_with_exact_input_and_scope() {
    let server = mock(0).await;
    let (_directory, host, owner, human, p, q) = setup();
    let q_human = host.native_human_session(&owner, q).unwrap();
    host.capture(
        &q_human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: q,
            occurred_at_ms: 1794560000000,
            text: "Q-only private synthetic marker".into(),
            tags: vec![],
            originals: vec![],
        },
    )
    .unwrap();
    completed(&host, &human, p);
    host.start_services().unwrap();
    let waiting = wait_task(
        &host,
        &human,
        p,
        SummaryState::WaitingConfiguration,
        Duration::from_secs(8),
    )
    .await;
    assert!(server.requests.lock().unwrap().is_empty());
    assert!(waiting.latest_artifact_id.is_none());
    configure(&host, &owner, p, &server.base, None);
    let done = wait_task(
        &host,
        &human,
        p,
        SummaryState::Succeeded,
        Duration::from_secs(8),
    )
    .await;
    let artifacts = host
        .summary_artifacts_page(&human, p, done.task_id, None, 25)
        .unwrap();
    assert_eq!(artifacts.items.len(), 1);
    let artifact = &artifacts.items[0];
    assert!(artifact.current);
    assert_eq!(
        artifact.output.model.requested_model,
        "synthetic-requested-model"
    );
    assert_eq!(artifact.output.model.model, "synthetic-reported-model");
    assert_eq!(artifact.output.usage.input_tokens, Some(29));
    assert!(artifact.output.read_original_ids.is_empty());
    {
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let raw = serde_json::to_string(&requests[0]).unwrap();
        assert!(!raw.contains("Q-only private synthetic marker"));
        assert!(!raw.contains("synthetic-key"));
        let hash = format!(
            "{:x}",
            sha2::Sha256::digest(serde_json::to_vec(&requests[0]).unwrap())
        );
        assert_eq!(artifact.output.model.request_input_digest, hash);
    }
    assert_eq!(
        host.events_page(&q_human, q, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_after_real_dispatch_rejects_late_result_without_an_artifact() {
    let server = mock(1).await;
    let (_directory, host, owner, human, p, _) = setup();
    configure(&host, &owner, p, &server.base, None);
    completed(&host, &human, p);
    host.start_services().unwrap();
    tokio::time::timeout(Duration::from_secs(8), server.reached.notified())
        .await
        .unwrap();
    let running = wait_task(
        &host,
        &human,
        p,
        SummaryState::Running,
        Duration::from_secs(2),
    )
    .await;
    host.control_summary(&human, &control(&running, SummaryControlAction::Cancel))
        .unwrap();
    server.release.notify_one();
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let cancelled = host.summary_task(&human, p, running.task_id).unwrap();
    assert_eq!(cancelled.state, SummaryState::Cancelled);
    assert!(
        host.summary_artifacts_page(&human, p, running.task_id, None, 25)
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changed_configuration_fences_dispatched_old_result_and_preserves_new_settings() {
    let server = mock(1).await;
    let (_directory, host, owner, human, p, _) = setup();
    let old = configure(&host, &owner, p, &server.base, None);
    completed(&host, &human, p);
    host.start_services().unwrap();
    tokio::time::timeout(Duration::from_secs(8), server.reached.notified())
        .await
        .unwrap();
    let running = wait_task(
        &host,
        &human,
        p,
        SummaryState::Running,
        Duration::from_secs(2),
    )
    .await;
    let new = configure(&host, &owner, p, &server.base, old.revision);
    server.release.notify_one();
    let failed = wait_task(
        &host,
        &human,
        p,
        SummaryState::Failed,
        Duration::from_secs(4),
    )
    .await;
    assert_eq!(
        failed
            .current_run
            .unwrap()
            .attempt
            .unwrap()
            .reason
            .as_deref(),
        Some("configuration_changed")
    );
    assert!(
        host.summary_artifacts_page(&human, p, running.task_id, None, 25)
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        host.summary_model_configuration(&owner, p)
            .unwrap()
            .revision,
        new.revision
    );
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopped_host_reopens_as_unknown_and_needs_an_explicit_new_run() {
    let server = mock(1).await;
    let (directory, host, owner, human, p, _) = setup();
    configure(&host, &owner, p, &server.base, None);
    completed(&host, &human, p);
    host.start_services().unwrap();
    tokio::time::timeout(Duration::from_secs(8), server.reached.notified())
        .await
        .unwrap();
    let running = wait_task(
        &host,
        &human,
        p,
        SummaryState::Running,
        Duration::from_secs(2),
    )
    .await;
    let identity = host.device_id;
    host.stop().unwrap();
    server.release.notify_one();
    drop(host);
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    assert_eq!(host.device_id, identity);
    let owner = host.owner_session().unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    host.start_services().unwrap();
    // The read facade immediately fences an old lifecycle as failed. Wait for
    // the worker's separate durable recovery fact as well, rather than racing
    // that first (already safe) read against service startup.
    let recovery_end = Instant::now() + Duration::from_secs(5);
    let failed = loop {
        let candidate = host.summary_task(&human, p, running.task_id).unwrap();
        if candidate.state == SummaryState::Failed
            && candidate
                .current_run
                .as_ref()
                .and_then(|run| run.attempt.as_ref())
                .and_then(|attempt| attempt.reason.as_deref())
                == Some("external_outcome_unknown")
        {
            break candidate;
        }
        assert!(
            Instant::now() < recovery_end,
            "Durable recovery fact was not observed"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    };
    assert_eq!(
        failed
            .current_run
            .as_ref()
            .unwrap()
            .attempt
            .as_ref()
            .unwrap()
            .reason
            .as_deref(),
        Some("external_outcome_unknown")
    );
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    let run = Uuid::new_v4();
    host.control_summary(
        &human,
        &control(
            &failed,
            SummaryControlAction::QueueUpdate {
                run_id: run,
                selection: failed.selection.clone(),
                supersedes_artifact_id: None,
            },
        ),
    )
    .unwrap();
    let done = wait_task(
        &host,
        &human,
        p,
        SummaryState::Succeeded,
        Duration::from_secs(8),
    )
    .await;
    assert_eq!(done.task_id, running.task_id);
    let artifacts = host
        .summary_artifacts_page(&human, p, done.task_id, None, 25)
        .unwrap();
    assert_eq!(artifacts.items.len(), 1);
    assert_eq!(artifacts.items[0].run_id, run);
    assert_eq!(server.requests.lock().unwrap().len(), 2);
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rate_limit_retries_are_finite_and_unknown_evidence_never_publishes() {
    let server = mock(2).await;
    let (_directory, host, owner, human, p, _) = setup();
    configure(&host, &owner, p, &server.base, None);
    completed(&host, &human, p);
    host.start_services().unwrap();
    let failed = wait_task(
        &host,
        &human,
        p,
        SummaryState::Failed,
        Duration::from_secs(18),
    )
    .await;
    assert_eq!(failed.current_run.unwrap().attempt.unwrap().number, 3);
    assert_eq!(server.requests.lock().unwrap().len(), 3);
    host.stop().unwrap();
    let invalid = mock(3).await;
    let (_other_directory, host, owner, human, p, _) = setup();
    configure(&host, &owner, p, &invalid.base, None);
    completed(&host, &human, p);
    host.start_services().unwrap();
    let failed = wait_task(
        &host,
        &human,
        p,
        SummaryState::Failed,
        Duration::from_secs(8),
    )
    .await;
    assert_eq!(
        failed
            .current_run
            .unwrap()
            .attempt
            .unwrap()
            .reason
            .as_deref(),
        Some("invalid_output")
    );
    assert!(
        host.summary_artifacts_page(&human, p, failed.task_id, None, 25)
            .unwrap()
            .items
            .is_empty()
    );
    host.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_http_summary_and_exact_source_routes_keep_profile_and_authority_boundaries() {
    use crate::{GrantKind, GrantRequest};
    let (directory, host, owner, human, p, q) = setup();
    let block = completed(&host, &human, p);
    let human_token = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap()
        .token;
    let observer_token = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap()
        .token;
    let owner_token = serde_json::from_slice::<Value>(
        &std::fs::read(directory.path().join("host/connection.beta.json")).unwrap(),
    )
    .unwrap()["owner_token"]
        .as_str()
        .unwrap()
        .to_owned();
    let server = crate::serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1", server.addr());
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let source = host
        .events_page(&human, p, &EventQuery::default())
        .unwrap()
        .items[0]
        .event_id;
    let url = format!("{base}/profiles/{p}/timeline/events/{source}");
    assert_eq!(client.get(&url).send().await.unwrap().status(), 401);
    let read: Value = client
        .get(&url)
        .bearer_auth(&observer_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(read["record"]["event_id"], source.to_string());
    assert_eq!(read["record"]["profile_id"], p.to_string());
    assert_eq!(
        client
            .get(format!("{base}/profiles/{q}/timeline/events/{source}"))
            .bearer_auth(&observer_token)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let absent: Value = client
        .get(format!(
            "{base}/profiles/{p}/timeline/events/{}",
            EventId::new()
        ))
        .bearer_auth(&observer_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(absent.is_null());
    let selection = host.summary_block_selection(&human, p, block).unwrap();
    let request = SummaryRequestCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        purpose: exomind_core::SummaryPurpose::ManualCompressV1,
        artifact_kind: exomind_core::SummaryArtifactKind::CompressedMessage,
        selection,
    };
    let requests = format!("{base}/profiles/{p}/summaries/requests");
    assert_eq!(
        client
            .post(&requests)
            .bearer_auth(&observer_token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{base}/profiles/{q}/summaries/requests"))
            .bearer_auth(&human_token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let response = client
        .post(&requests)
        .bearer_auth(&human_token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let receipt: Value = response.json().await.unwrap();
    assert_eq!(receipt["command_id"], request.command_id.to_string());
    assert_eq!(receipt["event_id"], request.event_id.to_string());
    let page: Value = client
        .get(format!("{base}/profiles/{p}/summaries/tasks?limit=25"))
        .bearer_auth(&observer_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let task = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["purpose"] == "manual_compress_v1")
        .unwrap();
    let task_id = task["task_id"].as_str().unwrap();
    assert_eq!(
        client
            .get(format!("{base}/profiles/{q}/summaries/tasks/{task_id}"))
            .bearer_auth(&observer_token)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{base}/summary-service"))
            .bearer_auth(&observer_token)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{base}/summary-service"))
            .bearer_auth(&owner_token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.stop().await.unwrap();
}
