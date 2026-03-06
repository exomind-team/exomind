use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};

#[derive(Default)]
struct ThreadState {
    remembered_name: Option<String>,
}

fn request_id(message: &Value) -> Value {
    message.get("id").cloned().unwrap_or(Value::Null)
}

fn method_name(message: &Value) -> Option<&str> {
    message.get("method").and_then(Value::as_str)
}

fn extract_text_input(message: &Value) -> String {
    message
        .get("params")
        .and_then(|params| params.get("input"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn reply_for(message: &str, remembered_name: &mut Option<String>) -> String {
    let normalized = message.to_lowercase();

    if let Some(index) = normalized.find("my name is ") {
        let name = message[(index + "my name is ".len())..].trim().to_string();
        *remembered_name = Some(name.clone());
        return format!("hello {name}");
    }

    if normalized.contains("what is my name") {
        return remembered_name
            .as_ref()
            .map(|name| format!("your name is {name}"))
            .unwrap_or_else(|| "unknown".to_string());
    }

    format!("codex:{message}")
}

fn build_thread(thread_id: &str) -> Value {
    json!({
        "id": thread_id,
        "preview": "",
        "ephemeral": true,
        "modelProvider": "openai",
        "createdAt": 1,
        "updatedAt": 1,
        "status": { "type": "idle" },
        "path": null,
        "cwd": "D:/project/exomind",
        "cliVersion": "fake-codex-cli",
        "source": "mcp",
        "agentNickname": null,
        "agentRole": null,
        "gitInfo": null,
        "name": null,
        "turns": []
    })
}

fn build_turn(turn_id: &str, status: &str) -> Value {
    json!({
        "id": turn_id,
        "items": [],
        "status": status,
        "error": null
    })
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut threads: HashMap<String, ThreadState> = HashMap::new();
    let mut next_thread = 1usize;
    let mut next_turn = 1usize;

    for line in stdin.lock().lines() {
        let Ok(raw_line) = line else {
            break;
        };
        if raw_line.trim().is_empty() {
            continue;
        }

        let Ok(message) = serde_json::from_str::<Value>(&raw_line) else {
            continue;
        };
        let Some(method) = method_name(&message) else {
            continue;
        };

        match method {
            "initialize" => {
                let response = json!({
                    "id": request_id(&message),
                    "result": {
                        "userAgent": "fake-codex-app-server"
                    }
                });
                let _ = writeln!(stdout, "{response}");
            }
            "initialized" => {}
            "thread/start" => {
                let thread_id = format!("thread-{next_thread}");
                next_thread += 1;
                threads.entry(thread_id.clone()).or_default();
                let response = json!({
                    "id": request_id(&message),
                    "result": {
                        "thread": build_thread(&thread_id),
                        "model": "gpt-5-codex",
                        "modelProvider": "openai",
                        "serviceTier": null,
                        "cwd": "D:/project/exomind",
                        "approvalPolicy": "never",
                        "sandbox": { "type": "dangerFullAccess" },
                        "reasoningEffort": null
                    }
                });
                let _ = writeln!(stdout, "{response}");
            }
            "turn/start" => {
                let thread_id = message
                    .get("params")
                    .and_then(|params| params.get("threadId"))
                    .and_then(Value::as_str)
                    .unwrap_or("thread-unknown")
                    .to_string();
                let turn_id = format!("turn-{next_turn}");
                next_turn += 1;
                let item_id = format!("item-{turn_id}");
                let user_text = extract_text_input(&message);
                let reply = reply_for(
                    &user_text,
                    &mut threads.entry(thread_id.clone()).or_default().remembered_name,
                );

                let start_response = json!({
                    "id": request_id(&message),
                    "result": {
                        "turn": build_turn(&turn_id, "inProgress")
                    }
                });
                let turn_started = json!({
                    "method": "turn/started",
                    "params": {
                        "threadId": thread_id,
                        "turn": build_turn(&turn_id, "inProgress")
                    }
                });
                let item_started = json!({
                    "method": "item/started",
                    "params": {
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "item": {
                            "type": "agentMessage",
                            "id": item_id,
                            "text": "",
                            "phase": "final_answer"
                        }
                    }
                });
                let delta = json!({
                    "method": "item/agentMessage/delta",
                    "params": {
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "itemId": item_id,
                        "delta": reply
                    }
                });
                let item_completed = json!({
                    "method": "item/completed",
                    "params": {
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "item": {
                            "type": "agentMessage",
                            "id": item_id,
                            "text": reply,
                            "phase": "final_answer"
                        }
                    }
                });
                let turn_completed = json!({
                    "method": "turn/completed",
                    "params": {
                        "threadId": thread_id,
                        "turn": build_turn(&turn_id, "completed")
                    }
                });

                let _ = writeln!(stdout, "{start_response}");
                let _ = writeln!(stdout, "{turn_started}");
                let _ = writeln!(stdout, "{item_started}");
                let _ = writeln!(stdout, "{delta}");
                let _ = writeln!(stdout, "{item_completed}");
                let _ = writeln!(stdout, "{turn_completed}");
            }
            "turn/interrupt" => {
                let response = json!({
                    "id": request_id(&message),
                    "result": {}
                });
                let _ = writeln!(stdout, "{response}");
            }
            "thread/unsubscribe" => {
                let response = json!({
                    "id": request_id(&message),
                    "result": {
                        "status": "unsubscribed"
                    }
                });
                let _ = writeln!(stdout, "{response}");
            }
            "thread/archive" => {
                let response = json!({
                    "id": request_id(&message),
                    "result": {}
                });
                let _ = writeln!(stdout, "{response}");
            }
            _ => {
                let response = json!({
                    "id": request_id(&message),
                    "error": {
                        "code": -32601,
                        "message": format!("unsupported method: {method}")
                    }
                });
                let _ = writeln!(stdout, "{response}");
            }
        }

        let _ = stdout.flush();
    }
}
