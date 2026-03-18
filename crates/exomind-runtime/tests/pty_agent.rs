//! pty_agent.rs — Integration tests for PTY spawn, interact, and Claude session
//! discovery through the HTTP API（PTY Agent HTTP API 集成测试）.
//!
//! PTY routes are only compiled on non-Android targets (`cfg(not(target_os = "android"))`).
//! Gate the entire file to keep the test suite green on Android / Termux.
#![cfg(not(target_os = "android"))]

use exomind_runtime::{start_with_options, RuntimeStartOptions};
use serde_json::Value;

/// Helper: start a lightweight runtime with no builtin actors or TS agents.
async fn start_test_runtime() -> (exomind_runtime::RuntimeHandle, String) {
    let handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        ..Default::default()
    })
    .await
    .expect("runtime should start");

    let base_url = format!("http://127.0.0.1:{}", handle.port());
    (handle, base_url)
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
    let linked_session = sessions.iter().find(|session| {
        session["pty_id"].as_str() == Some(pty_id)
    });
    assert!(
        linked_session.is_some(),
        "spawning a PTY should auto-create a unified session record, got {sessions_payload}"
    );
    let linked_session = linked_session.expect("linked session should exist");
    assert!(
        linked_session["source_host_id"].as_str().is_some_and(|value| !value.is_empty()),
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
    let list_payload: Value = list_resp.json().await.expect("list response should be JSON");
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
        .and_then(|sessions| sessions.iter().find(|session| session["id"].as_str() == Some(pty_id)))
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
        .and_then(|sessions| sessions.iter().find(|session| session["id"].as_str() == Some(pty_id)))
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
        !list_after_arr.iter().any(|v| v["id"].as_str() == Some(pty_id)),
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
