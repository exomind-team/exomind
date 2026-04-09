//! pty_agent.rs — Integration tests for PTY spawn, interact, and Claude session
//! discovery through the HTTP API（PTY Agent HTTP API 集成测试）.
//!
//! PTY routes are only compiled on non-Android targets (`cfg(not(target_os = "android"))`).
//! Gate the entire file to keep the test suite green on Android / Termux.
#![cfg(not(target_os = "android"))]

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use exomind_runtime::{RuntimeStartOptions, start_with_options};
use futures_util::StreamExt;
use serde_json::Value;
use std::time::Duration;
use tempfile::TempDir;

/// Helper: start a lightweight runtime with no builtin actors or TS agents.
async fn start_test_runtime() -> (exomind_runtime::RuntimeHandle, String) {
    start_test_runtime_with_data_dir(None).await
}

async fn start_test_runtime_with_data_dir(
    data_dir: Option<std::path::PathBuf>,
) -> (exomind_runtime::RuntimeHandle, String) {
    let handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        data_dir,
        ..Default::default()
    })
    .await
    .expect("runtime should start");

    let base_url = format!("http://127.0.0.1:{}", handle.port());
    (handle, base_url)
}

fn short_lived_echo_spawn_body(marker: &str) -> serde_json::Value {
    if cfg!(windows) {
        serde_json::json!({
            "name": format!("echo-{marker}"),
            "workdir": ".",
            "command": "cmd",
            "args": ["/C", "echo", marker]
        })
    } else {
        serde_json::json!({
            "name": format!("echo-{marker}"),
            "workdir": ".",
            "command": "echo",
            "args": [marker]
        })
    }
}

async fn spawn_short_lived_echo(client: &reqwest::Client, base_url: &str, marker: &str) -> String {
    let spawn_resp = client
        .post(format!("{base_url}/pty/spawn"))
        .json(&short_lived_echo_spawn_body(marker))
        .send()
        .await
        .expect("spawn request should succeed");
    assert_eq!(spawn_resp.status().as_u16(), 201);

    let spawn_payload: Value = spawn_resp
        .json()
        .await
        .expect("spawn response should be JSON");
    spawn_payload["id"]
        .as_str()
        .expect("spawn response should include PTY id")
        .to_string()
}

fn interactive_shell_spawn_body(name: &str) -> serde_json::Value {
    if cfg!(windows) {
        serde_json::json!({
            "name": name,
            "workdir": ".",
            "command": "cmd",
            "args": ["/Q", "/K"]
        })
    } else {
        serde_json::json!({
            "name": name,
            "workdir": ".",
            "command": "sh",
            "args": []
        })
    }
}

async fn spawn_interactive_shell(client: &reqwest::Client, base_url: &str, name: &str) -> String {
    let spawn_resp = client
        .post(format!("{base_url}/pty/spawn"))
        .json(&interactive_shell_spawn_body(name))
        .send()
        .await
        .expect("interactive shell spawn should succeed");
    assert_eq!(spawn_resp.status().as_u16(), 201);

    let spawn_payload: Value = spawn_resp
        .json()
        .await
        .expect("interactive shell response should be JSON");
    spawn_payload["id"]
        .as_str()
        .expect("interactive shell response should include PTY id")
        .to_string()
}

fn large_output_process_spawn_body(head_marker: &str, tail_marker: &str) -> serde_json::Value {
    if cfg!(windows) {
        serde_json::json!({
            "name": "replay-cap-short-lived",
            "workdir": ".",
            "command": "cmd",
            "args": [
                "/Q",
                "/C",
                format!(
                    "echo {head_marker} & for /L %i in (1,1,2500) do @echo replay-cap-line-%i-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX & echo {tail_marker}"
                )
            ]
        })
    } else {
        serde_json::json!({
            "name": "replay-cap-short-lived",
            "workdir": ".",
            "command": "sh",
            "args": [
                "-lc",
                format!(
                    "printf '{head_marker}\\n'; i=1; while [ $i -le 2500 ]; do printf 'replay-cap-line-%04d-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\\n' \"$i\"; i=$((i+1)); done; printf '{tail_marker}\\n'"
                )
            ]
        })
    }
}

async fn spawn_large_output_process(
    client: &reqwest::Client,
    base_url: &str,
    head_marker: &str,
    tail_marker: &str,
) -> String {
    let spawn_resp = client
        .post(format!("{base_url}/pty/spawn"))
        .json(&large_output_process_spawn_body(head_marker, tail_marker))
        .send()
        .await
        .expect("large output process spawn should succeed");
    assert_eq!(spawn_resp.status().as_u16(), 201);

    let spawn_payload: Value = spawn_resp
        .json()
        .await
        .expect("large output process response should be JSON");
    spawn_payload["id"]
        .as_str()
        .expect("large output response should include PTY id")
        .to_string()
}

async fn put_runtime_config(client: &reqwest::Client, base_url: &str, key: &str, value: &str) {
    let response = client
        .put(format!("{base_url}/config/{key}"))
        .json(&serde_json::json!({
            "scope": "user",
            "value": value,
            "source": "pty-agent-test",
        }))
        .send()
        .await
        .expect("config request should succeed");
    assert_eq!(
        response.status().as_u16(),
        200,
        "runtime config write should succeed for {key}"
    );
}

async fn write_pty_input(client: &reqwest::Client, base_url: &str, pty_id: &str, data: &[u8]) {
    let response = client
        .post(format!("{base_url}/pty/{pty_id}/input"))
        .json(&serde_json::json!({
            "data": BASE64.encode(data),
        }))
        .send()
        .await
        .expect("pty input request should succeed");
    assert_eq!(response.status().as_u16(), 204);
}

fn build_large_output_input_script(head_marker: &str, tail_marker: &str) -> String {
    if cfg!(windows) {
        format!(
            "echo {head_marker}\r\nfor /L %i in (1,1,2500) do @echo replay-cap-line-%i-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\r\necho {tail_marker}\r\n"
        )
    } else {
        format!(
            "printf '{head_marker}\\n'; i=1; while [ $i -le 2500 ]; do printf 'replay-cap-line-%04d-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\\n' \"$i\"; i=$((i+1)); done; printf '{tail_marker}\\n'\n"
        )
    }
}

fn build_live_marker_input_script(live_marker: &str) -> String {
    if cfg!(windows) {
        format!("echo {live_marker}\r\n")
    } else {
        format!("printf '{live_marker}\\n'\n")
    }
}

fn build_short_history_input_script(head_marker: &str, tail_marker: &str) -> String {
    if cfg!(windows) {
        format!(
            "echo {head_marker}\r\nfor /L %i in (1,1,400) do @echo short-history-line-%i\r\necho {tail_marker}\r\n"
        )
    } else {
        format!(
            "printf '{head_marker}\\n'; i=1; while [ $i -le 400 ]; do printf 'short-history-line-%04d\\n' \"$i\"; i=$((i+1)); done; printf '{tail_marker}\\n'\n"
        )
    }
}

fn expected_short_history_middle_marker() -> &'static str {
    if cfg!(windows) {
        "short-history-line-200"
    } else {
        "short-history-line-0200"
    }
}

#[derive(Default)]
struct DecodedPtySse {
    output: String,
    saw_ready: bool,
    saw_eof: bool,
}

fn decode_sse_event_block(block: &str, decoded: &mut DecodedPtySse) {
    let mut current_event = String::new();

    for line in block.lines() {
        if let Some(event) = line.strip_prefix("event: ") {
            current_event = event.to_string();
            continue;
        }

        if let Some(data) = line.strip_prefix("data: ") {
            match current_event.as_str() {
                "output" => {
                    let chunk = BASE64
                        .decode(data)
                        .expect("output event should contain valid base64");
                    decoded.output.push_str(&String::from_utf8_lossy(&chunk));
                }
                "ready" => decoded.saw_ready = true,
                "eof" => decoded.saw_eof = true,
                _ => {}
            }
        }
    }
}

async fn collect_pty_sse_until(
    response: reqwest::Response,
    predicate: impl Fn(&DecodedPtySse) -> bool,
) -> DecodedPtySse {
    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    let mut decoded = DecodedPtySse::default();
    let started = std::time::Instant::now();

    while started.elapsed() < Duration::from_secs(10) {
        let next_chunk = tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("PTY SSE stream should produce a chunk before timeout");

        match next_chunk {
            Some(Ok(chunk)) => {
                pending.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));

                while let Some(event_end) = pending.find("\n\n") {
                    let block = pending[..event_end].to_string();
                    pending.drain(..event_end + 2);
                    if block.trim().is_empty() {
                        continue;
                    }
                    decode_sse_event_block(&block, &mut decoded);
                    if predicate(&decoded) {
                        return decoded;
                    }
                }
            }
            Some(Err(error)) => panic!("PTY SSE stream should not error: {error}"),
            None => {
                if !pending.trim().is_empty() {
                    decode_sse_event_block(&pending, &mut decoded);
                }
                return decoded;
            }
        }
    }

    panic!("timed out while waiting for PTY SSE predicate");
}

async fn wait_for_session_completed(client: &reqwest::Client, base_url: &str, pty_id: &str) {
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        let payload: Value = client
            .get(format!("{base_url}/sessions"))
            .send()
            .await
            .expect("sessions request should succeed")
            .json()
            .await
            .expect("sessions response should be JSON");
        let completed = payload
            .as_array()
            .and_then(|sessions| {
                sessions
                    .iter()
                    .find(|session| session["id"].as_str() == Some(pty_id))
            })
            .map(|session| session["status"] == "completed")
            .unwrap_or(false);
        if completed {
            tokio::time::sleep(Duration::from_millis(100)).await;
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!("short-lived PTY should auto-complete unified session");
}

async fn wait_for_session_status(
    client: &reqwest::Client,
    base_url: &str,
    pty_id: &str,
    expected_status: &str,
    timeout: Duration,
) {
    let started = std::time::Instant::now();
    let mut last_session_payload = Value::Null;
    let mut last_pty_payload = Value::Null;

    while started.elapsed() < timeout {
        let sessions_payload: Value = client
            .get(format!("{base_url}/sessions"))
            .send()
            .await
            .expect("sessions request should succeed")
            .json()
            .await
            .expect("sessions response should be JSON");
        let session = sessions_payload.as_array().and_then(|sessions| {
            sessions
                .iter()
                .find(|session| session["id"].as_str() == Some(pty_id))
        });

        if let Some(session) = session {
            last_session_payload = session.clone();
            if session["status"] == expected_status {
                return;
            }

            if session["status"] == "completed" {
                let pty_payload: Value = client
                    .get(format!("{base_url}/pty"))
                    .send()
                    .await
                    .expect("pty list request should succeed")
                    .json()
                    .await
                    .expect("pty list response should be JSON");
                let pty = pty_payload
                    .as_array()
                    .and_then(|ptys| ptys.iter().find(|pty| pty["id"].as_str() == Some(pty_id)));
                if let Some(pty) = pty {
                    last_pty_payload = pty.clone();
                    assert_ne!(
                        pty["status"], "running",
                        "interactive PTY session should not become completed while PTY is still running; session={last_session_payload} pty={last_pty_payload}"
                    );
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!(
        "timed out waiting for PTY session {pty_id} to reach {expected_status}; last session={last_session_payload} last pty={last_pty_payload}"
    );
}

fn decode_pty_sse_output(body: &str) -> (String, bool) {
    let mut output = Vec::new();
    let mut current_event = String::new();
    let mut saw_eof = false;

    for line in body.lines() {
        if let Some(event) = line.strip_prefix("event: ") {
            current_event = event.to_string();
            continue;
        }

        if let Some(data) = line.strip_prefix("data: ") {
            match current_event.as_str() {
                "output" => {
                    let chunk = BASE64
                        .decode(data)
                        .expect("output data should be valid base64");
                    output.extend_from_slice(&chunk);
                }
                "eof" => saw_eof = true,
                _ => {}
            }
        }
    }

    (String::from_utf8_lossy(&output).to_string(), saw_eof)
}

#[tokio::test]
async fn pty_spawn_and_interact() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();

    // ── 1. POST /pty/spawn — spawn a short-lived echo process ───
    let spawn_body = if cfg!(windows) {
        serde_json::json!({
            "name": "test-echo",
            "workdir": ".",
            "command": "cmd",
            "args": ["/C", "echo hello"]
        })
    } else {
        serde_json::json!({
            "name": "test-echo",
            "workdir": ".",
            "command": "echo",
            "args": ["hello"]
        })
    };

    let spawn_resp = client
        .post(format!("{base_url}/pty/spawn"))
        .json(&spawn_body)
        .send()
        .await
        .expect("spawn request should succeed");

    assert_eq!(
        spawn_resp.status().as_u16(),
        201,
        "POST /pty/spawn should return 201 Created"
    );

    let spawn_payload: Value = spawn_resp.json().await.expect("response should be JSON");
    let pty_id = spawn_payload["id"]
        .as_str()
        .expect("spawn response should have an `id` field");
    assert!(
        !pty_id.is_empty(),
        "PTY id should be a non-empty UUID string"
    );
    let spawn_workdir = spawn_payload["workdir"]
        .as_str()
        .expect("spawn response should include resolved workdir");
    assert!(
        std::path::Path::new(spawn_workdir).is_absolute(),
        "spawn response workdir should be absolute, got {spawn_workdir}"
    );
    assert_ne!(
        spawn_workdir, ".",
        "spawn response workdir should not keep the unresolved relative path"
    );
    assert_eq!(
        spawn_payload["status"], "running",
        "initial status should be 'running'"
    );

    let sessions_resp = client
        .get(format!("{base_url}/sessions"))
        .send()
        .await
        .expect("sessions request should succeed");
    assert_eq!(sessions_resp.status().as_u16(), 200);
    let sessions_payload: Value = sessions_resp
        .json()
        .await
        .expect("sessions response should be JSON");
    let sessions = sessions_payload
        .as_array()
        .expect("sessions response should be an array");
    let linked_session = sessions
        .iter()
        .find(|session| session["pty_id"].as_str() == Some(pty_id));
    assert!(
        linked_session.is_some(),
        "spawning a PTY should auto-create a unified session record, got {sessions_payload}"
    );
    let linked_session = linked_session.expect("linked session should exist");
    assert!(
        linked_session["source_host_id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "spawning a PTY should stamp source_host_id, got {linked_session}"
    );
    assert!(
        linked_session["agent_id"].is_null(),
        "PTY unified session should keep agent_id empty, got {linked_session}"
    );

    // Give the short-lived process a moment to register.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // ── 2. GET /pty — list should contain the spawned instance ──
    let list_resp = client
        .get(format!("{base_url}/pty"))
        .send()
        .await
        .expect("list request should succeed");

    assert_eq!(list_resp.status().as_u16(), 200);
    let list_payload: Value = list_resp
        .json()
        .await
        .expect("list response should be JSON");
    let list_arr = list_payload.as_array().expect("list should be an array");
    assert!(
        !list_arr.is_empty(),
        "PTY list should contain at least the spawned instance"
    );
    assert!(
        list_arr.iter().any(|v| v["id"].as_str() == Some(pty_id)),
        "PTY list should include the id we just spawned"
    );

    // ── 3. POST /pty/{id}/stop — stop the process ──────────────
    let stop_resp = client
        .post(format!("{base_url}/pty/{pty_id}/stop"))
        .send()
        .await
        .expect("stop request should succeed");

    // The process may have already exited (echo is short-lived), so
    // accept both 200 (stopped ok) and 500 (already dead).
    let stop_status = stop_resp.status().as_u16();
    assert!(
        stop_status == 200 || stop_status == 500,
        "POST /pty/{{id}}/stop should return 200 or 500 (if already exited), got {stop_status}"
    );

    let sessions_after_stop: Value = client
        .get(format!("{base_url}/sessions"))
        .send()
        .await
        .expect("sessions after stop should succeed")
        .json()
        .await
        .expect("sessions after stop should be JSON");
    let completed_after_stop = sessions_after_stop
        .as_array()
        .and_then(|sessions| {
            sessions
                .iter()
                .find(|session| session["id"].as_str() == Some(pty_id))
        })
        .expect("session should still exist after stop");
    assert_eq!(completed_after_stop["status"], "completed");

    // ── 4. DELETE /pty/{id} — remove record ─────────────────────
    let delete_resp = client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await
        .expect("delete request should succeed");

    assert_eq!(
        delete_resp.status().as_u16(),
        200,
        "DELETE /pty/{{id}} should return 200 with removal confirmation"
    );

    let delete_payload: Value = delete_resp
        .json()
        .await
        .expect("delete response should be JSON");
    assert_eq!(delete_payload["status"], "removed");
    assert_eq!(delete_payload["id"], pty_id);

    let sessions_after_delete: Value = client
        .get(format!("{base_url}/sessions"))
        .send()
        .await
        .expect("sessions after delete should succeed")
        .json()
        .await
        .expect("sessions after delete should be JSON");
    let completed_after_delete = sessions_after_delete
        .as_array()
        .and_then(|sessions| {
            sessions
                .iter()
                .find(|session| session["id"].as_str() == Some(pty_id))
        })
        .expect("session history should remain after deleting PTY record");
    assert_eq!(completed_after_delete["status"], "completed");

    // ── 5. Verify it's gone ─────────────────────────────────────
    let list_after = client
        .get(format!("{base_url}/pty"))
        .send()
        .await
        .expect("list after delete should succeed");
    let list_after_payload: Value = list_after.json().await.unwrap();
    let list_after_arr = list_after_payload.as_array().unwrap();
    assert!(
        !list_after_arr
            .iter()
            .any(|v| v["id"].as_str() == Some(pty_id)),
        "PTY list should no longer contain the deleted instance"
    );

    // ── Cleanup ─────────────────────────────────────────────────
    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_list_claude_sessions() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();

    // GET /pty/claude-sessions — should return a valid JSON array.
    let resp = client
        .get(format!("{base_url}/pty/claude-sessions"))
        .send()
        .await
        .expect("claude-sessions request should succeed");

    assert_eq!(
        resp.status().as_u16(),
        200,
        "GET /pty/claude-sessions should return 200"
    );

    let payload: Value = resp.json().await.expect("response should be JSON");
    assert!(
        payload.is_array(),
        "claude-sessions response should be a JSON array"
    );

    // The array may be empty (no local Claude sessions) — that's fine.
    // If non-empty, each entry should have the expected shape.
    if let Some(sessions) = payload.as_array() {
        for session in sessions {
            assert!(
                session["session_id"].is_string(),
                "each session should have a string session_id"
            );
            assert!(
                session["project_path"].is_string(),
                "each session should have a string project_path"
            );
        }
    }

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_list_sessions_by_agent_type() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();

    for agent_type in ["claude", "codex"] {
        let resp = client
            .get(format!("{base_url}/pty/sessions"))
            .query(&[("agent_type", agent_type)])
            .send()
            .await
            .expect("pty sessions request should succeed");

        assert_eq!(
            resp.status().as_u16(),
            200,
            "GET /pty/sessions?agent_type={agent_type} should return 200"
        );

        let payload: Value = resp.json().await.expect("response should be JSON");
        assert!(
            payload.is_array(),
            "pty sessions response for {agent_type} should be a JSON array"
        );

        if let Some(sessions) = payload.as_array() {
            for session in sessions {
                assert_eq!(
                    session["agent_type"].as_str(),
                    Some(agent_type),
                    "each returned session should keep the requested agent_type"
                );
                assert!(
                    session["session_id"].is_string(),
                    "each session should have a string session_id"
                );
                assert!(
                    session["project_path"].is_string(),
                    "each session should have a string project_path"
                );
            }
        }
    }

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_historical_session_detail_returns_not_found_for_unknown_session() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();
    let missing_session_id = format!("missing-{}", uuid::Uuid::new_v4());

    let resp = client
        .get(format!("{base_url}/pty/sessions/detail"))
        .query(&[
            ("agent_type", "claude"),
            ("session_id", missing_session_id.as_str()),
        ])
        .send()
        .await
        .expect("pty historical session detail request should succeed");

    assert_eq!(
        resp.status().as_u16(),
        404,
        "GET /pty/sessions/detail should return 404 for unknown session ids"
    );

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_natural_exit_completes_session_and_stop_remains_idempotent() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();

    let spawn_body = if cfg!(windows) {
        serde_json::json!({
            "name": "test-natural-exit",
            "workdir": ".",
            "command": "cmd",
            "args": ["/C", "echo hello"]
        })
    } else {
        serde_json::json!({
            "name": "test-natural-exit",
            "workdir": ".",
            "command": "echo",
            "args": ["hello"]
        })
    };

    let spawn_resp = client
        .post(format!("{base_url}/pty/spawn"))
        .json(&spawn_body)
        .send()
        .await
        .expect("spawn request should succeed");
    assert_eq!(spawn_resp.status().as_u16(), 201);

    let spawn_payload: Value = spawn_resp
        .json()
        .await
        .expect("spawn response should be JSON");
    let pty_id = spawn_payload["id"]
        .as_str()
        .expect("spawn response should include PTY id")
        .to_string();

    let started = std::time::Instant::now();
    let mut completed = false;
    while started.elapsed() < Duration::from_secs(5) {
        let payload: Value = client
            .get(format!("{base_url}/sessions"))
            .send()
            .await
            .expect("sessions request should succeed")
            .json()
            .await
            .expect("sessions response should be JSON");
        completed = payload
            .as_array()
            .and_then(|sessions| {
                sessions
                    .iter()
                    .find(|session| session["id"].as_str() == Some(pty_id.as_str()))
            })
            .map(|session| session["status"] == "completed")
            .unwrap_or(false);
        if completed {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    assert!(
        completed,
        "short-lived PTY should auto-complete unified session after natural exit"
    );

    let stop_resp = client
        .post(format!("{base_url}/pty/{pty_id}/stop"))
        .send()
        .await
        .expect("stop request should succeed even after natural exit");

    assert_eq!(
        stop_resp.status().as_u16(),
        200,
        "stop should be idempotent after natural exit"
    );

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn interactive_pty_waiting_input_roundtrip_keeps_session_live() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();

    put_runtime_config(
        &client,
        &base_url,
        "exomind:ptyWaitingInputIdleTimeoutSeconds",
        "1",
    )
    .await;

    let pty_id = spawn_interactive_shell(&client, &base_url, "tmcp-wait-test").await;

    wait_for_session_status(
        &client,
        &base_url,
        &pty_id,
        "waiting_input",
        Duration::from_secs(5),
    )
    .await;

    write_pty_input(&client, &base_url, &pty_id, b"\n").await;

    wait_for_session_status(
        &client,
        &base_url,
        &pty_id,
        "running",
        Duration::from_secs(2),
    )
    .await;

    wait_for_session_status(
        &client,
        &base_url,
        &pty_id,
        "waiting_input",
        Duration::from_secs(5),
    )
    .await;

    client
        .post(format!("{base_url}/pty/{pty_id}/stop"))
        .send()
        .await
        .expect("stop request should succeed");
    client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await
        .expect("delete request should succeed");

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_stream_replays_persisted_history_after_remove() {
    let temp_dir = TempDir::new().expect("temp dir should be created");
    let (mut handle, base_url) =
        start_test_runtime_with_data_dir(Some(temp_dir.path().to_path_buf())).await;
    let client = reqwest::Client::new();
    let marker = "persisted-remove-history";

    let pty_id = spawn_short_lived_echo(&client, &base_url, marker).await;
    wait_for_session_completed(&client, &base_url, &pty_id).await;

    let delete_resp = client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await
        .expect("delete request should succeed");
    assert_eq!(delete_resp.status().as_u16(), 200);

    let stream_resp = client
        .get(format!("{base_url}/pty/{pty_id}/stream"))
        .send()
        .await
        .expect("stream request should succeed for persisted transcript");
    assert_eq!(stream_resp.status().as_u16(), 200);

    let body = stream_resp
        .text()
        .await
        .expect("persisted transcript stream should complete");
    let (output, saw_eof) = decode_pty_sse_output(&body);
    assert!(
        output.contains(marker),
        "persisted stream should replay terminal history, got {output:?}"
    );
    assert!(saw_eof, "persisted stream should end with eof event");

    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_stream_replays_persisted_history_after_runtime_restart() {
    let temp_dir = TempDir::new().expect("temp dir should be created");
    let client = reqwest::Client::new();
    let marker = "persisted-restart-history";

    let pty_id = {
        let (mut handle, base_url) =
            start_test_runtime_with_data_dir(Some(temp_dir.path().to_path_buf())).await;
        let pty_id = spawn_short_lived_echo(&client, &base_url, marker).await;
        wait_for_session_completed(&client, &base_url, &pty_id).await;

        handle.stop().await.expect("runtime should stop");
        pty_id
    };

    let (mut restarted_handle, restarted_base_url) =
        start_test_runtime_with_data_dir(Some(temp_dir.path().to_path_buf())).await;

    let live_ptys: Value = client
        .get(format!("{restarted_base_url}/pty"))
        .send()
        .await
        .expect("pty list request should succeed")
        .json()
        .await
        .expect("pty list response should be JSON");
    assert!(
        live_ptys.as_array().is_some_and(|items| items.is_empty()),
        "restarted runtime should not auto-recreate live PTY instances"
    );

    let stream_resp = client
        .get(format!("{restarted_base_url}/pty/{pty_id}/stream"))
        .send()
        .await
        .expect("stream request should succeed after restart");
    assert_eq!(stream_resp.status().as_u16(), 200);

    let body = stream_resp
        .text()
        .await
        .expect("persisted transcript stream should complete after restart");
    let (output, saw_eof) = decode_pty_sse_output(&body);
    assert!(
        output.contains(marker),
        "restarted runtime should replay persisted terminal history, got {output:?}"
    );
    assert!(
        saw_eof,
        "restarted runtime persisted stream should end with eof event"
    );

    restarted_handle
        .stop()
        .await
        .expect("restarted runtime should stop");
}

#[tokio::test]
async fn pty_stream_live_replay_cap_respects_configured_floor_and_keeps_live_updates() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();
    let head_marker = "replay-cap-head-live";
    let tail_marker = "replay-cap-tail-live";
    let live_marker = "replay-cap-live-after-stream";

    put_runtime_config(&client, &base_url, "exomind:ptyTerminalReplayLimitKb", "64").await;

    let pty_id = spawn_interactive_shell(&client, &base_url, "replay-cap-live").await;
    write_pty_input(
        &client,
        &base_url,
        &pty_id,
        build_large_output_input_script(head_marker, tail_marker).as_bytes(),
    )
    .await;

    tokio::time::sleep(Duration::from_millis(1500)).await;

    let stream_resp = client
        .get(format!("{base_url}/pty/{pty_id}/stream"))
        .send()
        .await
        .expect("live stream request should succeed");
    assert_eq!(stream_resp.status().as_u16(), 200);

    write_pty_input(
        &client,
        &base_url,
        &pty_id,
        build_live_marker_input_script(live_marker).as_bytes(),
    )
    .await;

    let decoded = collect_pty_sse_until(stream_resp, |state| {
        state.saw_ready && state.output.contains(tail_marker) && state.output.contains(live_marker)
    })
    .await;

    assert!(decoded.saw_ready, "live stream should emit a ready event");
    assert!(
        decoded.output.contains(tail_marker),
        "live replay should include the tail marker, got {:?}",
        decoded.output
    );
    assert!(
        decoded.output.contains(live_marker),
        "live replay stream should continue with fresh output, got {:?}",
        decoded.output
    );
    assert!(
        !decoded.output.contains(head_marker),
        "live replay should trim old head output once over the configured cap, got {:?}",
        decoded.output
    );

    let _ = client
        .post(format!("{base_url}/pty/{pty_id}/stop"))
        .send()
        .await;
    let _ = client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await;
    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_stream_live_replay_preserves_short_history_under_default_cap() {
    let (mut handle, base_url) = start_test_runtime().await;
    let client = reqwest::Client::new();
    let head_marker = "short-history-head";
    let tail_marker = "short-history-tail";
    let middle_marker = expected_short_history_middle_marker();

    let pty_id = spawn_interactive_shell(&client, &base_url, "short-history-live").await;
    write_pty_input(
        &client,
        &base_url,
        &pty_id,
        build_short_history_input_script(head_marker, tail_marker).as_bytes(),
    )
    .await;

    tokio::time::sleep(Duration::from_millis(1200)).await;

    let stream_resp = client
        .get(format!("{base_url}/pty/{pty_id}/stream"))
        .send()
        .await
        .expect("live short-history stream request should succeed");
    assert_eq!(stream_resp.status().as_u16(), 200);

    let decoded = collect_pty_sse_until(stream_resp, |state| {
        state.saw_ready
            && state.output.contains(head_marker)
            && state.output.contains(middle_marker)
            && state.output.contains(tail_marker)
    })
    .await;

    assert!(decoded.saw_ready, "live replay should emit a ready event");
    assert!(
        decoded.output.contains(head_marker),
        "under-cap replay should keep the head marker, got {:?}",
        decoded.output
    );
    assert!(
        decoded.output.contains(middle_marker),
        "under-cap replay should keep a middle line marker, got {:?}",
        decoded.output
    );
    assert!(
        decoded.output.contains(tail_marker),
        "under-cap replay should keep the tail marker, got {:?}",
        decoded.output
    );

    let _ = client
        .post(format!("{base_url}/pty/{pty_id}/stop"))
        .send()
        .await;
    let _ = client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await;
    handle.stop().await.expect("runtime should stop");
}

#[tokio::test]
async fn pty_stream_persisted_replay_cap_respects_configured_floor_after_remove() {
    let temp_dir = TempDir::new().expect("temp dir should be created");
    let (mut handle, base_url) =
        start_test_runtime_with_data_dir(Some(temp_dir.path().to_path_buf())).await;
    let client = reqwest::Client::new();
    let head_marker = "replay-cap-head-persisted";
    let tail_marker = "replay-cap-tail-persisted";

    put_runtime_config(&client, &base_url, "exomind:ptyTerminalReplayLimitKb", "64").await;

    let pty_id = spawn_large_output_process(&client, &base_url, head_marker, tail_marker).await;
    wait_for_session_completed(&client, &base_url, &pty_id).await;

    let delete_resp = client
        .delete(format!("{base_url}/pty/{pty_id}"))
        .send()
        .await
        .expect("delete request should succeed");
    assert_eq!(delete_resp.status().as_u16(), 200);

    let stream_resp = client
        .get(format!("{base_url}/pty/{pty_id}/stream"))
        .send()
        .await
        .expect("persisted replay stream request should succeed");
    assert_eq!(stream_resp.status().as_u16(), 200);

    let body = stream_resp
        .text()
        .await
        .expect("persisted replay body should complete");
    let (output, saw_eof) = decode_pty_sse_output(&body);

    assert!(
        output.contains(tail_marker),
        "persisted replay should include the tail marker, got {output:?}"
    );
    assert!(
        !output.contains(head_marker),
        "persisted replay should trim the old head marker once over the configured cap, got {output:?}"
    );
    assert!(saw_eof, "persisted replay should still end with eof event");

    handle.stop().await.expect("runtime should stop");
}
