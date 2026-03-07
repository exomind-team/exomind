use exomind_runtime::agent::codex::CodexAgent;
use exomind_runtime::agent::{Agent, ChatRequest};
use futures_util::StreamExt;

fn fake_codex_command_path() -> String {
    env!("CARGO_BIN_EXE_fake-codex-cli").to_string()
}

#[tokio::test]
async fn codex_exec_streams_output_and_reuses_thread_id() {
    let agent = CodexAgent::with_command_and_args(fake_codex_command_path(), vec![]);

    let first_chunks = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        first_chunks.iter().any(|chunk| chunk.content.contains("codex:hello my name is xiaoming")),
        "first_chunks={first_chunks:?}"
    );

    let session_id = first_chunks
        .iter()
        .find_map(|chunk| chunk.session_id.clone())
        .expect("first turn should include session_id");

    let second_chunks = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(session_id),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        second_chunks
            .iter()
            .any(|chunk| chunk.content.contains("your name is xiaoming")),
        "second_chunks={second_chunks:?}"
    );
    assert!(
        second_chunks.iter().all(|chunk| chunk.session_id.is_none()),
        "reused turn should not mint a new session_id: {second_chunks:?}"
    );
}
