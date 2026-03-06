use exomind_runtime::agent::codex::CodexAgent;
use exomind_runtime::agent::{AgentProvider, ChatRequest, RuntimeAgentEvent};
use futures_util::StreamExt;
use std::time::Duration;
use tokio::time::{sleep, timeout};

fn fake_codex_command_path() -> String {
    env!("CARGO_BIN_EXE_fake-codex-app-server").to_string()
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

async fn wait_for_session_status(
    agent: &CodexAgent,
    session_id: &str,
    expected_status: &str,
) {
    timeout(Duration::from_secs(2), async {
        loop {
            if agent
                .get_session(session_id)
                .map(|session| session.status == expected_status)
                .unwrap_or(false)
            {
                return;
            }
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("session status should reach expected value");
}

#[tokio::test]
async fn codex_app_server_streams_typed_events_and_reuses_thread() {
    let agent = CodexAgent::with_command_and_args(
        fake_codex_command_path(),
        vec![
            "app-server".to_string(),
            "--listen".to_string(),
            "stdio://".to_string(),
        ],
    );

    let first_events = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(matches!(
        first_events.first(),
        Some(RuntimeAgentEvent::SessionStarted { .. })
    ));
    assert!(output_contains(&first_events, "xiaoming"), "first_events={first_events:?}");
    assert!(matches!(first_events.last(), Some(RuntimeAgentEvent::Done { .. })));

    let session_id = session_started_id(&first_events).expect("first turn should include session id");
    let second_events = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        second_events
            .iter()
            .all(|event| !matches!(event, RuntimeAgentEvent::SessionStarted { .. })),
        "second_events={second_events:?}"
    );
    assert!(output_contains(&second_events, "your name is xiaoming"), "second_events={second_events:?}");
    assert!(matches!(second_events.last(), Some(RuntimeAgentEvent::Done { .. })));
}

#[tokio::test]
async fn close_session_interrupts_slow_turn_and_unblocks_future_requests() {
    let agent = CodexAgent::with_command_and_args(
        fake_codex_command_path(),
        vec![
            "app-server".to_string(),
            "--listen".to_string(),
            "stdio://".to_string(),
        ],
    );

    let mut stream = agent.chat_stream(ChatRequest {
        message: "run slow turn".to_string(),
        session_id: None,
    });

    let first_event = stream.next().await.expect("session should start");
    let session_id = match first_event {
        RuntimeAgentEvent::SessionStarted { session_id } => session_id,
        other => panic!("expected session started, got {other:?}"),
    };

    wait_for_session_status(&agent, &session_id, "processing").await;
    assert!(agent.close_session(&session_id));
    assert_eq!(agent.get_session(&session_id), None);

    let remaining_events = timeout(Duration::from_secs(2), stream.collect::<Vec<_>>())
        .await
        .expect("stream should terminate after close");
    assert!(
        remaining_events
            .iter()
            .all(|event| !matches!(event, RuntimeAgentEvent::OutputDelta { .. })),
        "remaining_events={remaining_events:?}"
    );

    let follow_up_events = timeout(
        Duration::from_secs(2),
        agent.chat_stream(ChatRequest {
            message: "hello after close".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>(),
    )
    .await
    .expect("future request should not stay blocked");

    assert!(output_contains(&follow_up_events, "codex:hello after close"));
}

#[tokio::test]
async fn dropping_stream_interrupts_turn_and_keeps_session_reusable() {
    let agent = CodexAgent::with_command_and_args(
        fake_codex_command_path(),
        vec![
            "app-server".to_string(),
            "--listen".to_string(),
            "stdio://".to_string(),
        ],
    );

    let mut stream = agent.chat_stream(ChatRequest {
        message: "run slow turn".to_string(),
        session_id: None,
    });

    let first_event = stream.next().await.expect("session should start");
    let session_id = match first_event {
        RuntimeAgentEvent::SessionStarted { session_id } => session_id,
        other => panic!("expected session started, got {other:?}"),
    };

    wait_for_session_status(&agent, &session_id, "processing").await;
    drop(stream);

    wait_for_session_status(&agent, &session_id, "idle").await;

    let follow_up_events = timeout(
        Duration::from_secs(2),
        agent.chat_stream(ChatRequest {
            message: "hello after drop".to_string(),
            session_id: Some(session_id.clone()),
        })
        .collect::<Vec<_>>(),
    )
    .await
    .expect("follow-up request should complete after dropped stream");

    assert!(
        follow_up_events
            .iter()
            .all(|event| !matches!(event, RuntimeAgentEvent::SessionStarted { .. })),
        "follow_up_events={follow_up_events:?}"
    );
    assert!(output_contains(&follow_up_events, "codex:hello after drop"));
}

#[tokio::test]
async fn second_request_on_processing_session_fails_fast_instead_of_queueing() {
    let agent = CodexAgent::with_command_and_args(
        fake_codex_command_path(),
        vec![
            "app-server".to_string(),
            "--listen".to_string(),
            "stdio://".to_string(),
        ],
    );

    let mut slow_stream = agent.chat_stream(ChatRequest {
        message: "run slow turn".to_string(),
        session_id: None,
    });

    let first_event = slow_stream.next().await.expect("session should start");
    let session_id = match first_event {
        RuntimeAgentEvent::SessionStarted { session_id } => session_id,
        other => panic!("expected session started, got {other:?}"),
    };

    wait_for_session_status(&agent, &session_id, "processing").await;

    let conflicting_events = timeout(
        Duration::from_millis(500),
        agent.chat_stream(ChatRequest {
            message: "second request while busy".to_string(),
            session_id: Some(session_id.clone()),
        })
        .collect::<Vec<_>>(),
    )
    .await
    .expect("second request should fail fast instead of waiting");

    assert!(matches!(
        conflicting_events.as_slice(),
        [RuntimeAgentEvent::Error { message, .. }] if message.contains("正在处理中")
    ));

    assert!(agent.close_session(&session_id));
    let _ = timeout(Duration::from_secs(2), slow_stream.collect::<Vec<_>>())
        .await
        .expect("slow stream should terminate after close");
}
