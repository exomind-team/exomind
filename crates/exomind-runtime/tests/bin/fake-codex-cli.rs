use serde_json::json;
use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;

fn parse_resume_thread_id(args: &[String]) -> Option<String> {
    args.iter()
        .position(|arg| arg == "resume")
        .and_then(|index| args.get(index + 1))
        .filter(|value| !value.starts_with('-'))
        .cloned()
}

fn reply_for(prompt: &str, thread_id: &str) -> String {
    let normalized = prompt.to_lowercase();
    if normalized.contains("what is my name") {
        return "your name is xiaoming".to_string();
    }
    if normalized.contains("slow") {
        return format!("codex-slow:{thread_id}");
    }
    format!("codex:{prompt}")
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let thread_id =
        parse_resume_thread_id(&args).unwrap_or_else(|| "fake-codex-thread-1".to_string());

    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let prompt = input.trim();
    let reply = reply_for(prompt, &thread_id);

    let mut stdout = io::stdout();
    let _ = writeln!(
        stdout,
        "{}",
        json!({
            "type": "thread.started",
            "thread_id": thread_id,
        })
    );
    let _ = writeln!(stdout, "{}", json!({ "type": "turn.started" }));

    if prompt.to_lowercase().contains("slow") {
        thread::sleep(Duration::from_millis(250));
    }

    let _ = writeln!(
        stdout,
        "{}",
        json!({
            "type": "item.completed",
            "item": {
                "id": "item_1",
                "type": "agent_message",
                "text": reply,
            }
        })
    );
    let _ = writeln!(
        stdout,
        "{}",
        json!({
            "type": "turn.completed",
            "usage": {
                "input_tokens": 12,
                "output_tokens": 7
            }
        })
    );
    let _ = stdout.flush();
}
