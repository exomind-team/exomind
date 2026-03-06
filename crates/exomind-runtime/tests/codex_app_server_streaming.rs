use exomind_runtime::agent::codex::CodexAgent;
use exomind_runtime::agent::{AgentProvider, ChatRequest, RuntimeAgentEvent};
use futures_util::StreamExt;

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
