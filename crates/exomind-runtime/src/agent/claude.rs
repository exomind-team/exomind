use super::{Agent, ChatChunk};
use futures_util::stream::{self, BoxStream, StreamExt};
use serde_json::Value;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

/// Built-in Claude agent (内置 Claude Agent，通过 Claude CLI 输出流式文本).
#[derive(Debug, Clone)]
pub struct ClaudeAgent {
    command: String,
}

impl ClaudeAgent {
    pub fn new() -> Self {
        Self {
            command: "claude".to_string(),
        }
    }

    fn spawn_streaming_task(&self, message: String) -> mpsc::Receiver<ChatChunk> {
        let (sender, receiver) = mpsc::channel(64);
        let command = self.command.clone();

        tokio::spawn(async move {
            stream_claude_stdout(command, message, sender).await;
        });

        receiver
    }
}

impl Default for ClaudeAgent {
    fn default() -> Self {
        Self::new()
    }
}

impl Agent for ClaudeAgent {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn name(&self) -> &'static str {
        "Claude Agent"
    }

    fn description(&self) -> &'static str {
        "通过 Claude Code CLI 提供流式对话"
    }

    fn chat_stream(&self, message: String) -> BoxStream<'static, ChatChunk> {
        let receiver = self.spawn_streaming_task(message);
        stream::unfold(receiver, |mut receiver| async move {
            receiver.recv().await.map(|chunk| (chunk, receiver))
        })
        .boxed()
    }
}

async fn stream_claude_stdout(command: String, message: String, sender: mpsc::Sender<ChatChunk>) {
    let args = build_claude_args(&message);
    let mut child = match Command::new(&command)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            emit_error_chunk(&sender, format!("Claude 启动失败: {error}")).await;
            return;
        }
    };

    let Some(stdout) = child.stdout.take() else {
        emit_error_chunk(&sender, "Claude stdout 不可用".to_string()).await;
        return;
    };

    let mut lines = BufReader::new(stdout).lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Some(chunk) = parse_stream_json_line(&line) {
                    if sender.send(chunk).await.is_err() {
                        break;
                    }
                }
            }
            Ok(None) => break,
            Err(error) => {
                emit_error_chunk(&sender, format!("Claude 输出读取失败: {error}")).await;
                break;
            }
        }
    }

    if let Err(error) = child.wait().await {
        emit_error_chunk(&sender, format!("Claude 进程等待失败: {error}")).await;
    }
}

async fn emit_error_chunk(sender: &mpsc::Sender<ChatChunk>, message: String) {
    let _ = sender.send(ChatChunk { content: message }).await;
}

fn build_claude_args(message: &str) -> Vec<String> {
    vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
        message.to_string(),
    ]
}

fn parse_stream_json_line(line: &str) -> Option<ChatChunk> {
    let event: Value = serde_json::from_str(line).ok()?;
    let event_type = event.get("type").and_then(Value::as_str)?;

    if event_type != "text" && event_type != "assistant" {
        return None;
    }

    let content = extract_text_content(&event)?;
    Some(ChatChunk { content })
}

fn extract_text_content(event: &Value) -> Option<String> {
    if let Some(text) = event.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    if let Some(content) = event.get("content").and_then(Value::as_str) {
        return Some(content.to_string());
    }

    let message = event.get("message")?;

    if let Some(text) = message.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    let content = message.get("content")?;

    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    if let Some(items) = content.as_array() {
        let merged = items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<String>();

        if !merged.is_empty() {
            return Some(merged);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect_chunks_from_mock_stdout(mock_stdout: &str) -> Vec<ChatChunk> {
        mock_stdout
            .lines()
            .filter_map(parse_stream_json_line)
            .collect()
    }

    #[test]
    fn build_claude_args_includes_verbose_for_print_stream_json() {
        let args = build_claude_args("你好");
        assert_eq!(
            args,
            vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--dangerously-skip-permissions".to_string(),
                "你好".to_string(),
            ]
        );
    }

    #[test]
    fn parse_stream_json_line_accepts_text_event() {
        let line = r#"{"type":"text","text":"你好"}"#;
        let chunk = parse_stream_json_line(line);
        assert_eq!(
            chunk,
            Some(ChatChunk {
                content: "你好".to_string()
            })
        );
    }

    #[test]
    fn parse_stream_json_line_accepts_assistant_event() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"有"},{"type":"text","text":"什么"}]}}"#;
        let chunk = parse_stream_json_line(line);
        assert_eq!(
            chunk,
            Some(ChatChunk {
                content: "有什么".to_string()
            })
        );
    }

    #[test]
    fn parse_stream_json_line_rejects_non_text_types() {
        let line = r#"{"type":"tool_use","text":"ignore"}"#;
        assert_eq!(parse_stream_json_line(line), None);
    }

    #[test]
    fn parse_stream_json_line_rejects_invalid_json() {
        let line = r#"{"type":"text","text":"hello""#;
        assert_eq!(parse_stream_json_line(line), None);
    }

    #[test]
    fn collect_chunks_from_mock_stdout_only_forwards_textual_events() {
        let mock_stdout = r#"{"type":"system","text":"Initializing..."}
{"type":"text","text":"你好"}
{"type":"thinking","text":"hidden"}
{"type":"assistant","message":{"content":[{"type":"text","text":"！"}]}}
{"type":"result","usage":{"input_tokens":10,"output_tokens":15}}"#;

        let chunks = collect_chunks_from_mock_stdout(mock_stdout);
        assert_eq!(
            chunks,
            vec![
                ChatChunk {
                    content: "你好".to_string()
                },
                ChatChunk {
                    content: "！".to_string()
                }
            ]
        );
    }
}
