//! runtime_ts_agents.rs - TS agent autostart integration（TS Agent 自启动集成测试）

use exomind_runtime::{RuntimeStartOptions, start_with_options};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn make_temp_root(prefix: &str) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{now}-{}", std::process::id()))
}

fn write_agent_script(path: &PathBuf, suffix: &str) {
    let content = format!(
        r#"
import {{ writeFileSync }} from "node:fs";
const marker = process.env["EXOMIND_RT_AGENT_MARKER"];
const rtUrl = process.env["EXOMIND_RT_URL"] ?? "";
if (marker) {{
  writeFileSync(`${{marker}}-{suffix}.txt`, rtUrl, "utf-8");
}}
setInterval(() => {{}}, 500);
"#
    );
    fs::write(path, content).expect("should write agent script");
}

async fn wait_until_file_exists(path: &PathBuf, timeout_ms: u64) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_millis(timeout_ms) {
        if path.exists() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test]
async fn runtime_spawns_reviewer_and_classifier_with_rt_url() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");

    let root = make_temp_root("rt-ts-agents");
    let reviewer = root.join("packages/ts-agent-cli/agents/reviewer/index.ts");
    let classifier = root.join("packages/ts-agent-cli/agents/classifier/index.ts");
    fs::create_dir_all(
        reviewer
            .parent()
            .expect("reviewer parent should exist"),
    )
    .expect("should create reviewer directory");
    fs::create_dir_all(
        classifier
            .parent()
            .expect("classifier parent should exist"),
    )
    .expect("should create classifier directory");
    write_agent_script(&reviewer, "reviewer");
    write_agent_script(&classifier, "classifier");

    let marker_base = root.join("marker").to_string_lossy().to_string();
    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::set_var("EXOMIND_RT_AGENT_MARKER", &marker_base);
    }

    let mut handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "runtime-ts-agents".to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: true,
        ts_agent_command: "bun".to_string(),
        ts_agent_workdir: Some(root.clone()),
        mesh_state_path: None,
        auth_secret: None,
    })
    .await
    .expect("runtime should start with ts agents");

    let expected_url = format!("http://127.0.0.1:{}", handle.port());
    let reviewer_marker = PathBuf::from(format!("{marker_base}-reviewer.txt"));
    let classifier_marker = PathBuf::from(format!("{marker_base}-classifier.txt"));

    assert!(
        wait_until_file_exists(&reviewer_marker, 8_000).await,
        "reviewer marker should be created"
    );
    assert!(
        wait_until_file_exists(&classifier_marker, 8_000).await,
        "classifier marker should be created"
    );

    let reviewer_url =
        fs::read_to_string(&reviewer_marker).expect("should read reviewer marker content");
    let classifier_url =
        fs::read_to_string(&classifier_marker).expect("should read classifier marker content");
    assert_eq!(reviewer_url, expected_url);
    assert_eq!(classifier_url, expected_url);

    handle.stop().await.expect("runtime should stop cleanly");

    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::remove_var("EXOMIND_RT_AGENT_MARKER");
    }

    let _ = fs::remove_dir_all(root);
}
