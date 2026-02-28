use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

fn extract_user_content(line: &str) -> String {
    let payload: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return String::new(),
    };

    payload
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn reply_for(message: &str, remembered_name: &mut Option<String>) -> String {
    let normalized = message.to_lowercase();

    if let Some(index) = normalized.find("my name is ") {
        let name = message[(index + "my name is ".len())..].trim().to_string();
        *remembered_name = Some(name.clone());
        return format!("hi {name}");
    }

    if normalized.contains("what is my name") {
        return remembered_name
            .as_ref()
            .map(|name| format!("your name is {name}"))
            .unwrap_or_else(|| "unknown".to_string());
    }

    format!("echo:{message}")
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let exit_after_one_turn = args.iter().any(|arg| arg == "--exit-after-one");
    let delay_ms = args
        .iter()
        .find_map(|arg| arg.strip_prefix("--delay-ms="))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut remembered_name: Option<String> = None;
    let mut turns = 0usize;

    for line in stdin.lock().lines() {
        let raw_line = match line {
            Ok(value) => value,
            Err(_) => break,
        };

        if raw_line.trim().is_empty() {
            continue;
        }

        turns += 1;
        let message = extract_user_content(&raw_line);
        let reply = reply_for(&message, &mut remembered_name);

        let system_event = json!({
            "type": "system",
            "session_id": "fake-claude-session"
        });
        let assistant_event = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "text",
                        "text": reply
                    }
                ]
            }
        });
        let result_event = json!({
            "type": "result",
            "subtype": "success",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_creation_input_tokens": 20,
                "cache_read_input_tokens": 10
            },
            "total_cost_usd": 0.001
        });

        let _ = writeln!(stdout, "{system_event}");
        let _ = writeln!(stdout, "{assistant_event}");
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
        let _ = writeln!(stdout, "{result_event}");
        let _ = stdout.flush();

        if exit_after_one_turn && turns >= 1 {
            break;
        }
    }
}
