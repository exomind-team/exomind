use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use assert_cmd::Command;
use axum::routing::get;
use axum::{Json, Router};
use exomind_cli::cli::GlobalOptions;
use exomind_cli::commands::rt::{probe_payload, status_payload};
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[test]
fn rt_use_sets_default_target() {
    let state_path = temp_state_path("rt-use");

    Command::cargo_bin("exomind")
        .expect("exomind binary")
        .env("EXOMIND_CLI_STATE_PATH", &state_path)
        .args(["rt", "use", "127.0.0.1:9124"])
        .assert()
        .success();

    let raw = fs::read_to_string(&state_path).expect("state file");
    let state: Value = serde_json::from_str(&raw).expect("state json");
    assert_eq!(state["default_target"], "127.0.0.1:9124");

    let _ = fs::remove_file(state_path);
}

#[tokio::test]
async fn rt_status_reports_selected_target() {
    let target = spawn_health_server().await;
    let payload = status_payload(&GlobalOptions {
        target: Some(target.clone()),
        profile: None,
        user_id: None,
        json: true,
        spawn_if_missing: false,
    })
    .await
    .expect("status payload");

    assert_eq!(payload["target"], target);
    assert_eq!(payload["healthy"], true);
    assert_eq!(payload["source"], "explicit");
}

#[tokio::test]
async fn rt_probe_lists_candidate_ports() {
    let target = spawn_health_server().await;
    let port = target
        .split(':')
        .next_back()
        .expect("port segment")
        .to_string();
    unsafe {
        std::env::set_var("EXOMIND_CLI_CANDIDATE_PORTS", &port);
    }
    let payload = probe_payload().await.expect("probe payload");
    unsafe {
        std::env::remove_var("EXOMIND_CLI_CANDIDATE_PORTS");
    }

    assert_eq!(payload.len(), 1);
    assert_eq!(payload[0].target, target);
    assert!(payload[0].healthy);
}

async fn spawn_health_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener addr");
    let app = Router::new().route(
        "/health",
        get(|| async { Json(json!({ "status": "ok", "version": "test" })) }),
    );

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve health app");
    });

    address.to_string()
}

fn temp_state_path(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("exomind-cli-{label}-{suffix}.json"))
}
