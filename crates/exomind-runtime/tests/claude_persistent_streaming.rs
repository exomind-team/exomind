use exomind_runtime::agent::claude::ClaudeAgent;
use exomind_runtime::agent::{Agent, ChatRequest};
use futures_util::StreamExt;

fn fake_cli_command_path() -> String {
    env!("CARGO_BIN_EXE_fake-claude-cli").to_string()
}

#[tokio::test]
async fn reuses_same_session_and_keeps_conversation_context() {
    let agent = ClaudeAgent::with_command_and_args(fake_cli_command_path(), vec![]);

    let first_chunks = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        first_chunks
            .iter()
            .any(|chunk| chunk.content.contains("xiaoming")),
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
            .any(|chunk| chunk.content.contains("xiaoming")),
        "second_chunks={second_chunks:?}"
    );
    assert!(
        second_chunks.iter().all(|chunk| chunk.session_id.is_none()),
        "reused turn should not mint a new session_id: {second_chunks:?}"
    );
}

#[tokio::test]
async fn returns_error_after_reusing_session_with_exited_process() {
    let agent = ClaudeAgent::with_command_and_args(
        fake_cli_command_path(),
        vec!["--exit-after-one".to_string()],
    );

    let first_chunks = agent
        .chat_stream(ChatRequest {
            message: "hello my name is xiaoming".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;
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
            .any(|chunk| chunk.content.contains("退出码") || chunk.content.contains("提前结束")),
        "second_chunks={second_chunks:?}"
    );

    let third_chunks = agent
        .chat_stream(ChatRequest {
            message: "what is my name?".to_string(),
            session_id: Some(
                first_chunks
                    .iter()
                    .find_map(|chunk| chunk.session_id.clone())
                    .expect("first turn should include session_id"),
            ),
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        third_chunks
            .iter()
            .any(|chunk| chunk.content.contains("会话不存在")),
        "third_chunks={third_chunks:?}"
    );
}
