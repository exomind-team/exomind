use exomind_runtime::agent::claude::ClaudeAgent;
use exomind_runtime::agent::{AgentProvider, ChatRequest, RuntimeAgentEvent};
use futures_util::StreamExt;
use serde_json::Value;
use std::time::Duration;

fn fake_cli_command_path() -> String {
    env!("CARGO_BIN_EXE_fake-claude-cli").to_string()
}

fn stream_values<T: serde::Serialize>(items: &[T]) -> Vec<Value> {
    items.iter()
        .map(|item| serde_json::to_value(item).expect("stream item should serialize"))
        .collect()
}

fn session_started_id(events: &[RuntimeAgentEvent]) -> Option<String> {
    events.iter().find_map(|event| match event {
        RuntimeAgentEvent::SessionStarted { session_id } => Some(session_id.clone()),
        _ => None,
    })
}

fn output_contains(events: &[RuntimeAgentEvent], needle: &str) -> bool {
    events.iter().any(|event| match event {
        RuntimeAgentEvent::OutputDelta { content, .. } => content.contains(needle),
        _ => false,
    })
}

fn error_contains(events: &[RuntimeAgentEvent], needle: &str) -> bool {
    events.iter().any(|event| match event {
        RuntimeAgentEvent::Error { message, .. } => message.contains(needle),
        _ => false,
    })
}

fn expect_session_started(event: RuntimeAgentEvent) -> String {
    match event {
        RuntimeAgentEvent::SessionStarted { session_id } => session_id,
        other => panic!("expected session.started, got {other:?}"),
    }
}

#[tokio::test]
async fn emits_typed_runtime_events_and_reuses_existing_session() {
    let agent = ClaudeAgent::with_command_and_args(fake_cli_command_path(), vec![]);

    let first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;
    let first_values = stream_values(&first_events);

    assert_eq!(first_values[0]["type"], "session.started");
    assert_eq!(first_values[1]["type"], "output.delta");
    assert!(
        first_values.iter().any(|value| {
            value["type"] == "output.delta" && value["content"].as_str().unwrap_or("").contains("xiaoming")
        }),
        "first_values={first_values:?}"
    );
    assert_eq!(first_values.last().and_then(|value| value.get("type")), Some(&Value::String("done".to_string())));

    let session_id = first_values[0]["session_id"]
        .as_str()
        .expect("first turn should include session.started session_id")
        .to_string();

    let second_events = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id),
        })
        .collect::<Vec<_>>()
        .await;
    let second_values = stream_values(&second_events);

    assert!(
        second_values.iter().all(|value| value["type"] != "session.started"),
        "reused turn should not mint a new session: {second_values:?}"
    );
    assert!(
        second_values.iter().any(|value| {
            value["type"] == "output.delta" && value["content"].as_str().unwrap_or("").contains("xiaoming")
        }),
        "second_values={second_values:?}"
    );
    assert_eq!(second_values.last().and_then(|value| value.get("type")), Some(&Value::String("done".to_string())));
}

#[tokio::test]
async fn reuses_same_session_and_keeps_conversation_context() {
    let agent = ClaudeAgent::with_command_and_args(fake_cli_command_path(), vec![]);

    let first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        output_contains(&first_events, "xiaoming"),
        "first_events={first_events:?}"
    );

    let session_id = session_started_id(&first_events)
        .expect("first turn should include session_id");

    let second_events = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        output_contains(&second_events, "xiaoming"),
        "second_events={second_events:?}"
    );
    assert!(
        second_events
            .iter()
            .all(|event| !matches!(event, RuntimeAgentEvent::SessionStarted { .. })),
        "reused turn should not mint a new session_id: {second_events:?}"
    );
}

#[tokio::test]
async fn returns_error_after_reusing_session_with_exited_process() {
    let agent = ClaudeAgent::with_command_and_args(
        fake_cli_command_path(),
        vec!["--exit-after-one".to_string()],
    );

    let first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;
    let session_id = session_started_id(&first_events)
        .expect("first turn should include session_id");

    let second_events = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        error_contains(&second_events, "退出码") || error_contains(&second_events, "提前结束"),
        "second_events={second_events:?}"
    );

    let third_events = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(
                session_started_id(&first_events).expect("first turn should include session_id"),
            ),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        error_contains(&third_events, "会话不存在"),
        "third_events={third_events:?}"
    );
}

#[tokio::test]
async fn session_info_during_processing_keeps_real_message_count() {
    let agent = ClaudeAgent::with_command_and_args(
        fake_cli_command_path(),
        vec!["--delay-ms=800".to_string()],
    );

    let mut stream = agent.chat_stream(ChatRequest {
        message: "hello".to_string(),
        session_id: None,
    });

    let first = stream.next().await.expect("first event should be available");
    let session_id = expect_session_started(first);

    let during_processing = agent
        .get_session(&session_id)
        .expect("session should exist while processing");
    assert_eq!(during_processing.status, "processing");
    assert_eq!(
        during_processing.message_count, 1,
        "message_count should reflect current turn"
    );

    std::thread::sleep(Duration::from_millis(250));
    let later_processing = agent
        .get_session(&session_id)
        .expect("session should still exist before result event");
    assert_eq!(later_processing.status, "processing");
    assert_eq!(later_processing.message_count, 1);
    assert_eq!(later_processing.created_at, during_processing.created_at);

    let _rest = stream.collect::<Vec<_>>().await;
    let after = agent
        .get_session(&session_id)
        .expect("session should still exist after turn");
    assert_eq!(after.status, "idle");
    assert_eq!(after.message_count, 1);
}

#[tokio::test]
async fn close_processing_session_does_not_leave_ghost_snapshot() {
    let agent = ClaudeAgent::with_command_and_args(
        fake_cli_command_path(),
        vec!["--delay-ms=1200".to_string()],
    );

    let mut stream = agent.chat_stream(ChatRequest {
        message: "hello".to_string(),
        session_id: None,
    });

    let first = stream.next().await.expect("first event should be available");
    let session_id = expect_session_started(first);

    assert!(
        agent.close_session(&session_id),
        "close_session should succeed for active session"
    );
    assert_eq!(
        agent.get_session(&session_id),
        None,
        "session snapshot should be removed immediately after close"
    );

    let _rest = stream.collect::<Vec<_>>().await;
    assert_eq!(
        agent.get_session(&session_id),
        None,
        "session snapshot should not reappear after in-flight turn exits"
    );
}

#[tokio::test]
async fn accumulates_usage_stats_from_result_events() {
    let agent = ClaudeAgent::with_command_and_args(fake_cli_command_path(), vec![]);

    let first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;
    let session_id = session_started_id(&first_events)
        .expect("first turn should include session_id");

    let _second_chunks = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id.clone()),
        })
        .collect::<Vec<_>>()
        .await;

    let stats_value = agent
        .stats(Some(session_id))
        .await
        .expect("stats should be available for existing session");

    let session_id_value = stats_value
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(!session_id_value.is_empty());
    assert_eq!(
        stats_value.get("session_count").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        stats_value.get("input_tokens").and_then(Value::as_u64),
        Some(200)
    );
    assert_eq!(
        stats_value.get("output_tokens").and_then(Value::as_u64),
        Some(100)
    );
    assert_eq!(
        stats_value
            .get("cache_write_tokens")
            .and_then(Value::as_u64),
        Some(40)
    );
    assert_eq!(
        stats_value.get("cache_read_tokens").and_then(Value::as_u64),
        Some(20)
    );
    assert_eq!(
        stats_value.get("message_count").and_then(Value::as_u64),
        Some(2)
    );
    let total_cost_usd = stats_value
        .get("total_cost_usd")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    assert!((total_cost_usd - 0.002).abs() < 1e-12);
}

#[tokio::test]
async fn returns_aggregated_stats_with_session_count_for_all_sessions() {
    let agent = ClaudeAgent::with_command_and_args(fake_cli_command_path(), vec![]);

    let _first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    let _second_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaohong".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    let summary_stats = agent
        .stats(None)
        .await
        .expect("summary stats should be available");

    assert_eq!(
        summary_stats.get("session_id").and_then(Value::as_str),
        None
    );
    assert_eq!(
        summary_stats.get("session_count").and_then(Value::as_u64),
        Some(2)
    );
    assert_eq!(
        summary_stats.get("message_count").and_then(Value::as_u64),
        Some(2)
    );
}
