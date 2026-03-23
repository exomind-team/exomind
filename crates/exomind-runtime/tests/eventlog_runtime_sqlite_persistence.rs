use exomind_runtime::AppState;
use exomind_runtime::eventlog::{EventLogBackendKind, EventRecord};
use tempfile::tempdir;

#[test]
fn app_state_runtime_reuses_eventlog_sqlite_storage() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("eventlog.sqlite");
    let data_dir = dir.path().join("runtime-data");

    // SAFETY: test-scoped env mutation for runtime startup configuration.
    unsafe {
        std::env::set_var("EXOMIND_RT_EVENTLOG_SQLITE_PATH", &sqlite_path);
        std::env::set_var("EXOMIND_RT_DATA_DIR", &data_dir);
    }

    let state = AppState::new_runtime(
        0,
        "eventlog-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    state
        .eventlog_store
        .append_event(
            None,
            EventRecord {
                id: "evt-runtime-1".to_string(),
                timestamp: 1700000000000,
                content: "runtime persisted".to_string(),
                tags: vec!["note".to_string()],
                metadata: None,
            },
        )
        .unwrap();
    drop(state);

    let reopened = AppState::new_runtime(
        0,
        "eventlog-runtime-host".to_string(),
        None,
        None,
        false,
        None,
    );
    let events = reopened.eventlog_store.list_events(None).unwrap();

    // SAFETY: clear test env after assertion.
    unsafe {
        std::env::remove_var("EXOMIND_RT_EVENTLOG_SQLITE_PATH");
        std::env::remove_var("EXOMIND_RT_DATA_DIR");
    }

    assert_eq!(
        reopened.eventlog_store.backend_kind(),
        EventLogBackendKind::Sqlite
    );
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, "evt-runtime-1");
}
