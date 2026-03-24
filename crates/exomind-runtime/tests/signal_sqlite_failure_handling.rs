use exomind_runtime::signal::{
    DeliveryRecord, DeliveryStatus, SignalEvent, SignalPool, SignalPoolSnapshot, SignalRoute,
    TargetType,
};
use rusqlite::Connection;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::subscriber::with_default;
use tracing_subscriber::fmt::MakeWriter;

fn temp_signal_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("exomind-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
}

fn open_signal_pool(sqlite_path: &Path) -> SignalPool {
    SignalPool::with_sqlite_path(None, sqlite_path)
        .expect("sqlite-backed signal pool should initialize")
}

fn make_route(topic: &str, target_ref: &str) -> SignalRoute {
    let now = chrono::Utc::now().to_rfc3339();
    SignalRoute {
        id: uuid::Uuid::new_v4().to_string(),
        enabled: true,
        topic: topic.to_string(),
        target_type: TargetType::Agent,
        target_ref: target_ref.to_string(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn make_record(event_id: &str, route_id: &str, target_ref: &str) -> DeliveryRecord {
    DeliveryRecord {
        event_id: event_id.to_string(),
        route_id: route_id.to_string(),
        target_ref: target_ref.to_string(),
        status: DeliveryStatus::Sent,
        reason: None,
        started_at: "2026-01-01T00:00:00Z".to_string(),
        finished_at: "2026-01-01T00:00:01Z".to_string(),
    }
}

fn make_event(topic: &str) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "test".to_string(),
        origin_host_id: "host-read-only".to_string(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({"message": "readonly publish"}),
    }
}

#[derive(Clone, Default)]
struct SharedLogBuffer {
    inner: Arc<Mutex<Vec<u8>>>,
}

impl SharedLogBuffer {
    fn into_string(&self) -> String {
        String::from_utf8(
            self.inner
                .lock()
                .expect("log buffer lock should succeed")
                .clone(),
        )
        .expect("captured logs should be valid utf-8")
    }
}

struct SharedLogWriter {
    inner: Arc<Mutex<Vec<u8>>>,
}

impl Write for SharedLogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.inner
            .lock()
            .expect("log writer lock should succeed")
            .extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for SharedLogBuffer {
    type Writer = SharedLogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        SharedLogWriter {
            inner: Arc::clone(&self.inner),
        }
    }
}

fn capture_warn_logs(action: impl FnOnce()) -> String {
    let buffer = SharedLogBuffer::default();
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_max_level(tracing::Level::WARN)
        .with_writer(buffer.clone())
        .finish();

    with_default(subscriber, action);
    buffer.into_string()
}

fn make_sqlite_read_only(path: &Path) -> std::fs::Permissions {
    let original = std::fs::metadata(path)
        .expect("sqlite file should exist")
        .permissions();
    let mut read_only = original.clone();
    read_only.set_readonly(true);
    std::fs::set_permissions(path, read_only).expect("sqlite file should become read-only");
    original
}

fn restore_permissions(path: &Path, permissions: std::fs::Permissions) {
    std::fs::set_permissions(path, permissions).expect("sqlite file permissions should restore");
}

#[test]
fn route_add_returns_error_when_sqlite_is_read_only() {
    let dir = temp_signal_dir("signal-sqlite-route-warning");
    let sqlite_path = dir.join("signal-pool.sqlite");

    drop(open_signal_pool(&sqlite_path));
    let original_permissions = make_sqlite_read_only(&sqlite_path);

    let reopened = open_signal_pool(&sqlite_path);
    assert!(
        reopened
            .routes()
            .add(make_route("read.only.topic", "warning-agent"))
            .is_err(),
        "route add should surface sqlite write failure on a read-only database"
    );

    drop(reopened);
    restore_permissions(&sqlite_path, original_permissions);
    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}

#[test]
fn publish_logs_warning_when_journal_append_fails_on_read_only_sqlite() {
    let dir = temp_signal_dir("signal-sqlite-journal-append-warning");
    let sqlite_path = dir.join("signal-pool.sqlite");

    let pool = open_signal_pool(&sqlite_path);
    pool.routes()
        .add(make_route("readonly.publish", "warning-agent"))
        .expect("seed route should persist");
    drop(pool);

    let original_permissions = make_sqlite_read_only(&sqlite_path);

    let reopened = open_signal_pool(&sqlite_path);
    let _rx = reopened.subscribe();
    let logs = capture_warn_logs(|| {
        let _ = reopened.publish(make_event("readonly.publish"));
    });

    assert!(
        logs.contains("signal journal append failed during publish")
            && logs.contains("日志追加失败"),
        "expected publish path to log journal append failure, got: {logs}"
    );

    drop(reopened);
    restore_permissions(&sqlite_path, original_permissions);
    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}

#[test]
fn journal_replace_all_returns_error_when_sqlite_is_read_only() {
    let dir = temp_signal_dir("signal-sqlite-journal-replace-warning");
    let sqlite_path = dir.join("signal-pool.sqlite");

    drop(open_signal_pool(&sqlite_path));
    let original_permissions = make_sqlite_read_only(&sqlite_path);

    let reopened = open_signal_pool(&sqlite_path);
    assert!(
        reopened
            .journal()
            .replace_all(vec![make_record(
                "evt-read-only-replace",
                "route-2",
                "target-2",
            )])
            .is_err(),
        "journal replace_all should surface sqlite write failure on a read-only database"
    );

    drop(reopened);
    restore_permissions(&sqlite_path, original_permissions);
    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}

#[test]
fn snapshot_import_rolls_back_routes_when_journal_insert_fails() {
    let dir = temp_signal_dir("signal-sqlite-atomic-import");
    let sqlite_path = dir.join("signal-pool.sqlite");

    let pool = open_signal_pool(&sqlite_path);
    let original_route = make_route("existing.topic", "existing-agent");
    let original_record = make_record("evt-existing", &original_route.id, "existing-agent");
    pool.routes().add(original_route.clone()).unwrap();
    pool.journal().append(original_record.clone()).unwrap();
    drop(pool);

    let connection = Connection::open(&sqlite_path).expect("sqlite should open for trigger setup");
    connection
        .execute_batch(
            "CREATE TRIGGER fail_signal_journal_insert
             BEFORE INSERT ON signal_journal
             BEGIN
                 SELECT RAISE(ABORT, 'journal blocked for test');
             END;",
        )
        .expect("journal failure trigger should be created");
    drop(connection);

    let reopened = open_signal_pool(&sqlite_path);
    let import_result = reopened.import_snapshot(SignalPoolSnapshot {
        routes: vec![make_route("incoming.topic", "incoming-agent")],
        journal: vec![make_record(
            "evt-incoming",
            "route-incoming",
            "incoming-agent",
        )],
    });

    assert!(
        import_result.is_err(),
        "snapshot import should fail when journal insertion is blocked"
    );

    drop(reopened);

    let verified = open_signal_pool(&sqlite_path);
    let snapshot = verified
        .export_snapshot()
        .expect("snapshot export should succeed after failed import");
    assert_eq!(snapshot.routes.len(), 1);
    assert_eq!(snapshot.routes[0].id, original_route.id);
    assert_eq!(snapshot.routes[0].topic, "existing.topic");
    assert_eq!(snapshot.journal.len(), 1);
    assert_eq!(snapshot.journal[0].event_id, original_record.event_id);
    assert_eq!(snapshot.journal[0].route_id, original_record.route_id);
    drop(verified);

    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}
