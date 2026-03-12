use exomind_runtime::{
    AppState,
    timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStore},
};
use tempfile::tempdir;

#[test]
fn app_state_runtime_reuses_timeblock_sqlite_storage_for_completed_and_active() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("runtime-timeblocks.sqlite");

    // SAFETY: test-scoped env mutation; no concurrent reliance on this key in the same test.
    unsafe {
        std::env::set_var("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH", &sqlite_path);
    }

    let state = AppState::new_runtime(
        0,
        "timeblock-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );

    state
        .timeblock_store
        .replace_completed(&[TimeBlockData {
            id: "tb-1".to_string(),
            name: "Persist block".to_string(),
            start_id: "start-1".to_string(),
            end_id: "end-1".to_string(),
            note: Some("focus".to_string()),
            tags: vec!["block_feedback".to_string()],
            start_time: 1_700_000_000_000,
            end_time: 1_700_000_060_000,
        }])
        .unwrap();

    state
        .timeblock_store
        .put_active(ActiveBlockData {
            start_id: "start-active".to_string(),
            name: "Persist active".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            elapsed: 300_000,
            updated_at: Some(1_700_000_010_000),
            phase: Some("running".to_string()),
            version: Some(1),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(1_700_000_010_000),
            last_resumed_at: Some(1_700_000_010_000),
            accumulated_run_ms: Some(0),
            start_time: 1_700_000_000_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_id: Some("task-1".to_string()),
        })
        .unwrap();
    drop(state);

    let reopened = AppState::new_runtime(
        0,
        "timeblock-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    let completed = reopened.timeblock_store.list_completed().unwrap();
    let active = reopened.timeblock_store.get_active().unwrap();

    // SAFETY: clear test env after assertion.
    unsafe {
        std::env::remove_var("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH");
    }

    assert_eq!(completed.len(), 1, "completed blocks should persist across runtime restarts");
    assert_eq!(completed[0].id, "tb-1");
    assert_eq!(active.as_ref().map(|block| block.start_id.as_str()), Some("start-active"));
    assert_eq!(active.as_ref().and_then(|block| block.task_id.as_deref()), Some("task-1"));
}

#[test]
fn timeblock_store_clearing_active_block_preserves_completed_blocks() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("timeblocks.sqlite");
    let store = TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap();

    store
        .replace_completed(&[TimeBlockData {
            id: "tb-2".to_string(),
            name: "Keep completed".to_string(),
            start_id: "start-2".to_string(),
            end_id: "end-2".to_string(),
            note: None,
            tags: vec!["block_feedback".to_string()],
            start_time: 1_700_000_100_000,
            end_time: 1_700_000_160_000,
        }])
        .unwrap();

    store
        .put_active(ActiveBlockData {
            start_id: "active-2".to_string(),
            name: "Clear me".to_string(),
            mode: "countup".to_string(),
            target_minutes: None,
            elapsed: 60_000,
            updated_at: Some(1_700_000_120_000),
            phase: Some("paused".to_string()),
            version: Some(2),
            actor_id: Some("actor-b".to_string()),
            last_transition_at: Some(1_700_000_120_000),
            last_resumed_at: Some(1_700_000_110_000),
            accumulated_run_ms: Some(60_000),
            start_time: 1_700_000_100_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(5_000),
            paused: true,
            paused_at: Some(1_700_000_120_000),
            task_id: None,
        })
        .unwrap();

    store.delete_active().unwrap();

    let completed = store.list_completed().unwrap();
    let active = store.get_active().unwrap();

    assert_eq!(completed.len(), 1, "completed blocks should remain after active block deletion");
    assert!(active.is_none(), "active block should be cleared independently");
}
