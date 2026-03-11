use exomind_runtime::{AppState, task::CreateTaskInput};
use tempfile::tempdir;

#[test]
fn app_state_runtime_reuses_task_sqlite_storage() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("runtime-task.sqlite");

    // SAFETY: test-scoped env mutation; no concurrent reliance on this key in the same test.
    unsafe {
        std::env::set_var("EXOMIND_RT_TASK_SQLITE_PATH", &sqlite_path);
    }

    let state = AppState::new_runtime(
        0,
        "task-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    let created = state.task_store.create(CreateTaskInput {
        title: "Persist from runtime".to_string(),
        description: None,
        done_condition: None,
        priority: None,
        tags: vec![],
        source: None,
        parent_id: None,
        depends_on: vec![],
        due_at: None,
        estimated_minutes: None,
        time_block_ids: vec![],
    });
    drop(state);

    let reopened = AppState::new_runtime(
        0,
        "task-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    let loaded = reopened.task_store.get(&created.id);

    // SAFETY: clear test env after assertion.
    unsafe {
        std::env::remove_var("EXOMIND_RT_TASK_SQLITE_PATH");
    }

    assert!(loaded.is_some(), "runtime should reopen persisted task storage");
}
