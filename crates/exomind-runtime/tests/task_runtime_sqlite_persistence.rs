use exomind_runtime::{AppState, task::CreateTaskInput};
use tempfile::tempdir;
use std::sync::Mutex;

static TASK_SQLITE_ENV_LOCK: Mutex<()> = Mutex::new(());

fn create_task_input(title: &str) -> CreateTaskInput {
    CreateTaskInput {
        title: title.to_string(),
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
    }
}

#[test]
fn app_state_runtime_reuses_task_sqlite_storage() {
    let _guard = TASK_SQLITE_ENV_LOCK.lock().unwrap();
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
    let created = state.task_store.create(create_task_input("Persist from runtime"));
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

#[test]
fn app_state_runtime_reuses_task_sqlite_storage_with_profile_scope() {
    let _guard = TASK_SQLITE_ENV_LOCK.lock().unwrap();
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("runtime-task-profiled.sqlite");

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
    let anonymous_task = state.task_store.create(create_task_input("Anonymous task"));
    let profiled_task = state
        .task_store
        .create_in_scope(Some("profile-a"), create_task_input("Profile A task"));
    drop(state);

    let reopened = AppState::new_runtime(
        0,
        "task-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    let anonymous_tasks = reopened.task_store.list();
    let profile_a_tasks = reopened.task_store.list_in_scope(Some("profile-a"));
    let profile_b_tasks = reopened.task_store.list_in_scope(Some("profile-b"));

    // SAFETY: clear test env after assertion.
    unsafe {
        std::env::remove_var("EXOMIND_RT_TASK_SQLITE_PATH");
    }

    assert_eq!(anonymous_tasks.len(), 1, "default scope should stay isolated as anonymous");
    assert_eq!(anonymous_tasks[0].id, anonymous_task.id);
    assert_eq!(profile_a_tasks.len(), 1, "profile scope should persist independently");
    assert_eq!(profile_a_tasks[0].id, profiled_task.id);
    assert!(profile_b_tasks.is_empty(), "other profiles should not see scoped tasks");
}
