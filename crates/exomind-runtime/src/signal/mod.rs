pub mod actors;
pub mod bus;
pub mod journal;
pub mod route_table;
pub mod sqlite_store;
pub mod types;
pub mod window;

pub use bus::SignalBus;
pub use journal::Journal;
pub use route_table::RouteTable;
pub use sqlite_store::{SignalPoolSnapshot, SignalStoreError};
pub use types::*;
pub use window::WindowCache;

use std::path::Path;
use std::sync::Arc;
use tokio::sync::broadcast;

use sqlite_store::SqliteSignalStore;

pub struct SignalPool {
    bus: SignalBus,
    route_table: RouteTable,
    journal: Journal,
    window: WindowCache,
    store: Option<Arc<SqliteSignalStore>>,
}

impl SignalPool {
    pub fn new(config_path: Option<&str>) -> Self {
        let default_path = config_path.map(std::path::PathBuf::from);
        let default_ref = default_path
            .as_ref()
            .filter(|path| path.exists())
            .map(|path| path.as_path());

        Self {
            bus: SignalBus::new(),
            route_table: RouteTable::new(default_ref, None),
            journal: Journal::new(),
            window: WindowCache::new(),
            store: None,
        }
    }

    pub fn with_persist_path(config_path: Option<&str>, persist_path: &Path) -> Self {
        let default_path = config_path.map(std::path::PathBuf::from);
        let default_ref = default_path
            .as_ref()
            .filter(|path| path.exists())
            .map(|path| path.as_path());

        Self {
            bus: SignalBus::new(),
            route_table: RouteTable::new(default_ref, Some(persist_path.to_path_buf())),
            journal: Journal::new(),
            window: WindowCache::new(),
            store: None,
        }
    }

    pub fn with_sqlite_path(
        config_path: Option<&str>,
        sqlite_path: &Path,
    ) -> Result<Self, SignalStoreError> {
        let default_path = config_path.map(std::path::PathBuf::from);
        let default_ref = default_path
            .as_ref()
            .filter(|path| path.exists())
            .map(|path| path.as_path());

        let store = Arc::new(SqliteSignalStore::open(sqlite_path)?);

        Ok(Self {
            bus: SignalBus::new(),
            route_table: RouteTable::with_sqlite_store(default_ref, Arc::clone(&store))?,
            journal: Journal::with_sqlite_store(Arc::clone(&store))?,
            window: WindowCache::new(),
            store: Some(store),
        })
    }

    pub fn publish(&self, event: SignalEvent) -> Vec<DeliveryRecord> {
        self.bus
            .publish(event, &self.route_table, &self.journal, &self.window)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SignalEvent> {
        self.bus.subscribe()
    }

    pub fn routes(&self) -> &RouteTable {
        &self.route_table
    }

    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    pub fn window(&self) -> &WindowCache {
        &self.window
    }

    pub fn export_snapshot(&self) -> Result<SignalPoolSnapshot, SignalStoreError> {
        if let Some(store) = &self.store {
            return store.export_snapshot();
        }

        Ok(SignalPoolSnapshot {
            routes: self.route_table.get_all(),
            journal: self.journal.all_records(),
        })
    }

    pub fn import_snapshot(&self, snapshot: SignalPoolSnapshot) -> Result<(), SignalStoreError> {
        if let Some(store) = &self.store {
            store.import_snapshot(&snapshot)?;
            self.route_table.replace_all_in_memory(snapshot.routes);
            self.journal.replace_all_in_memory(snapshot.journal);
            return Ok(());
        }

        self.route_table.replace_all(snapshot.routes)?;
        self.journal.replace_all(snapshot.journal)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(topic: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-1".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({"msg": "hello"}),
        }
    }

    #[test]
    fn new_with_missing_config_does_not_panic() {
        let pool = SignalPool::new(Some("nonexistent/path.json"));
        assert_eq!(pool.routes().get_all().len(), 0);
    }

    #[test]
    fn new_with_none_config() {
        let pool = SignalPool::new(None);
        assert_eq!(pool.routes().get_all().len(), 0);
    }

    #[test]
    fn full_publish_flow() {
        let pool = SignalPool::new(None);
        let now = chrono::Utc::now().to_rfc3339();
        pool.routes()
            .add(SignalRoute {
                id: "r1".to_string(),
                enabled: true,
                topic: "test.topic".to_string(),
                target_type: TargetType::Agent,
                target_ref: "echo".to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();

        let _rx = pool.subscribe();
        let event = make_event("test.topic");
        let event_id = event.id.clone();
        let records = pool.publish(event);

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, DeliveryStatus::Sent);
        assert_eq!(pool.journal().len(), 1);
        assert_eq!(pool.window().len(), 1);
        assert_eq!(pool.window().recent(1)[0].id, event_id);
    }

    #[test]
    fn loads_default_routes_from_temp_file() {
        let dir = std::env::temp_dir().join(format!("exomind-pool-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let config = dir.join("defaults.json");
        std::fs::write(
            &config,
            r#"[
                {"topic": "user.input.text", "target_type": "agent", "target_ref": "classifier"},
                {"topic": "*", "target_type": "frontend", "target_ref": "ui"}
            ]"#,
        )
        .unwrap();

        let pool = SignalPool::new(Some(config.to_str().unwrap()));
        assert_eq!(pool.routes().get_all().len(), 2);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
