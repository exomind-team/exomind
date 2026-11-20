//! SDK/Host serialization seam: actual generated and Agent summaries over scoped HTTP.
use axum::{Json, Router, routing::post};
use exomind_beta_host::{
    BetaHost, GrantKind, GrantRequest, SummaryModelConfigurationCommand, SummaryModelSecretUpdate,
    serve,
};
use exomind_core::{
    AgentId, CaptureCommand, CommandId, EventId, EventQuery, ExternalSummaryAppendCommand,
    ProfileId, SummarySourceRef, SummaryState, TimeblockAction, TimeblockCommand, TimeblockId,
};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::time::{Instant, timeout};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sdk_reads_both_summary_feeds_from_real_host_with_restart_continuation() {
    timeout(Duration::from_secs(45), exercise())
        .await
        .expect("bounded SDK HTTP scenario");
}

async fn exercise() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(directory.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic SDK summary feeds")
        .unwrap();
    let human = host.native_human_session(&owner, p).unwrap();
    let provider = Router::new().route("/v1/chat/completions", post(|Json(body): Json<Value>| async move {
        let material: Value = serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        let evidence = material["records"][0]["record"]["event_id"].clone();
        let content = json!({"narrative":"Synthetic internal summary", "evidence":[evidence]}).to_string();
        Json(json!({"model":"synthetic", "choices":[{"message":{"content":content},"finish_reason":"stop"}]}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider_base = format!("http://{}/v1", listener.local_addr().unwrap());
    let provider_task = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    host.configure_summary_model(
        &owner,
        p,
        &SummaryModelConfigurationCommand {
            command_id: Uuid::new_v4(),
            expected_revision: None,
            enabled: true,
            base_url: provider_base,
            model: "synthetic".into(),
            api_key: SummaryModelSecretUpdate::Set {
                value: "synthetic-key".into(),
            },
            max_output_tokens: 2048,
            timeout_ms: 5000,
            include_suggestions: false,
        },
    )
    .unwrap();
    let block = TimeblockId::new();
    let action = |value: Value| {
        let snapshot = host.timeblock_snapshot(&human, p).unwrap();
        host.apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                expected_revision: snapshot.revision,
                action: serde_json::from_value::<TimeblockAction>(value).unwrap(),
            },
        )
        .unwrap();
    };
    action(
        json!({"kind":"start","block_id":block,"name":"Synthetic","note":"","timer":{"mode":"count_up"}}),
    );
    let source = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: host
            .timeblock_snapshot(&human, p)
            .unwrap()
            .clock
            .server_now_ms,
        text: "Synthetic SDK evidence".into(),
        tags: vec![],
        originals: vec![],
    };
    let receipt = host.capture(&human, &source).unwrap();
    action(json!({"kind":"end_action","block_id":block}));
    action(
        json!({"kind":"submit_feedback","block_id":block,"feedback":{"kind":"text","text":"Synthetic feedback"}}),
    );
    host.start_services().unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if host
            .summary_tasks_page(&human, p, None, 25)
            .unwrap()
            .items
            .iter()
            .any(|task| task.state == SummaryState::Succeeded)
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "synthetic provider summary must succeed"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    let producer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::SummaryProducer,
                agent_id: Some(AgentId::new()),
            },
        )
        .unwrap();
    host.append_external_summary(
        &host.authenticate(&producer.token).unwrap(),
        &ExternalSummaryAppendCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: source.occurred_at_ms,
            observed_through: receipt.local_seq,
            sources: vec![SummarySourceRef {
                event_id: source.event_id,
                kind: "capture".into(),
                digest: receipt.event_digest,
            }],
            narrative: "Synthetic Agent summary".into(),
            evidence: vec![source.event_id],
        },
    )
    .unwrap();
    let page = host
        .timeline_page(
            &human,
            p,
            &EventQuery {
                limit: 100,
                ..EventQuery::default()
            },
        )
        .unwrap();
    let rows: Value = serde_json::to_value(page).unwrap();
    let summary = rows["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == "summary/1")
        .unwrap();
    let agent_summary = rows["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == "agent_summary/1")
        .unwrap();
    // Put summaries beyond the first HTTP page so completion requires continuation.
    for _ in 0..105 {
        let mut command = source.clone();
        command.command_id = CommandId::new();
        command.event_id = EventId::new();
        host.capture(&human, &command).unwrap();
    }
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let status = host.status().unwrap();
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1", server.addr());
    let payload = json!({
        "handoff": {"protocol":"exomind-beta/1", "api_base_url":base,
          "api":{"hello":"GET /hello","access_check":"POST /profiles/{profile_id}/access/check","authorization_header":"Authorization: Bearer <credential.token>"},
          "device":{"device_id":status.device_id},"profile":{"profile_id":p,"display_name":"Synthetic SDK summary feeds"},
          "grant":{"grant_id":grant.grant_id,"kind":"observer","agent_id":null},
          "credential":{"scheme":"Bearer","token":grant.token},
          "network":{"listener_scope":"loopback_only","remote_clients_reachable":false}},
        "target":{"apiBaseUrl":base,"runtimeId":status.runtime_id,"profileId":p},
        "summary":summary,"agentSummary":agent_summary,
    });
    let result = tokio::task::spawn_blocking(move || {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/monitor-summary-reader.mjs");
        let mut command = Command::new("node");
        command
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn()?;
        let sent = child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&payload).unwrap());
        if let Err(error) = sent {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(25);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
            if std::time::Instant::now() >= deadline {
                // Child retains the exact process handle; no image-name/PID lookup.
                let _ = child.kill();
                let _ = child.wait();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "SDK reader exceeded its owned process deadline",
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        child.wait_with_output()
    })
    .await;
    server.stop().await.unwrap();
    provider_task.abort();
    let result = result
        .expect("SDK process task")
        .expect("Node is required and must complete within its bounded SDK/Host test deadline");
    assert!(
        result.status.success(),
        "SDK HTTP reader failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let proof: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(proof["complete"], true);
    assert_eq!(proof["summaries"], 1);
    assert_eq!(proof["agentSummaries"], 1);
    assert!(proof["reads"].as_u64().unwrap() >= 2);
}
