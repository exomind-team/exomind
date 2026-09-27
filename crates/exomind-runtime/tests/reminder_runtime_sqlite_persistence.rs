use exomind_runtime::RuntimeStartOptions;
use exomind_runtime::start_with_options;
use serde_json::json;
use tempfile::tempdir;

#[tokio::test]
async fn reminder_routes_persist_in_sqlite_runtime() {
    let temp_dir = tempdir().expect("temp dir should create");
    let runtime = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "reminder-rt-test".to_string(),
        spawn_builtin_actors: false,
        data_dir: Some(temp_dir.path().join("runtime-data")),
        ..Default::default()
    })
    .await
    .expect("runtime should start");

    let base_url = format!("http://127.0.0.1:{}", runtime.port());
    let client = reqwest::Client::new();

    let created = client
        .post(format!(
            "{base_url}/reminders?user_id=profile-reminder-test"
        ))
        .json(&json!({
            "title": "RT Reminder",
            "content": "persist me",
            "due_at": 1700000000000u64,
        }))
        .send()
        .await
        .expect("create request should send")
        .error_for_status()
        .expect("create response should succeed")
        .json::<serde_json::Value>()
        .await
        .expect("create response should decode");

    let reminder_id = created["id"]
        .as_str()
        .expect("created reminder id")
        .to_string();

    let listed = client
        .get(format!(
            "{base_url}/reminders?user_id=profile-reminder-test"
        ))
        .send()
        .await
        .expect("list request should send")
        .error_for_status()
        .expect("list response should succeed")
        .json::<Vec<serde_json::Value>>()
        .await
        .expect("list response should decode");

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["title"], json!("RT Reminder"));

    client
        .post(format!(
            "{base_url}/reminders/{reminder_id}/transition?user_id=profile-reminder-test"
        ))
        .json(&json!({
            "status": "completed",
            "at": 1700000009999u64,
        }))
        .send()
        .await
        .expect("transition request should send")
        .error_for_status()
        .expect("transition response should succeed");

    let completed = client
        .get(format!(
            "{base_url}/reminders?user_id=profile-reminder-test&status=completed"
        ))
        .send()
        .await
        .expect("completed list request should send")
        .error_for_status()
        .expect("completed list response should succeed")
        .json::<Vec<serde_json::Value>>()
        .await
        .expect("completed list response should decode");

    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0]["status"], json!("completed"));
}
