pub mod actors;
pub mod bus;
pub mod journal;
pub mod route_table;
pub mod types;
pub mod window;

pub use bus::SignalBus;
pub use journal::Journal;
pub use route_table::RouteTable;
pub use types::*;
pub use window::WindowCache;

use std::path::Path;
use tokio::sync::broadcast;

/// SignalPool: top-level facade composing Bus, RouteTable, Journal, WindowCache.
pub struct SignalPool {
    bus: SignalBus,
    route_table: RouteTable,
    journal: Journal,
    window: WindowCache,
}

impl SignalPool {
    /// Create a new SignalPool.
    ///
    /// `config_path` points to the default (innate) routes JSON file.
    /// If the file does not exist, an empty route table is used.
    pub fn new(config_path: Option<&str>) -> Self {
        let default_path = config_path.map(std::path::PathBuf::from);
        let default_ref = default_path
            .as_ref()
            .filter(|p| p.exists())
            .map(|p| p.as_path());

        Self {
            bus: SignalBus::new(),
            route_table: RouteTable::new(default_ref, None),
            journal: Journal::new(),
            window: WindowCache::new(),
        }
    }

    /// Create a SignalPool with a custom persist path for user routes.
    pub fn with_persist_path(config_path: Option<&str>, persist_path: &Path) -> Self {
        let default_path = config_path.map(std::path::PathBuf::from);
        let default_ref = default_path
            .as_ref()
            .filter(|p| p.exists())
            .map(|p| p.as_path());

        Self {
            bus: SignalBus::new(),
            route_table: RouteTable::new(default_ref, Some(persist_path.to_path_buf())),
            journal: Journal::new(),
            window: WindowCache::new(),
        }
    }

    /// Publish an event through the signal pool.
    pub fn publish(&self, event: SignalEvent) -> Vec<DeliveryRecord> {
        self.bus
            .publish(event, &self.route_table, &self.journal, &self.window)
    }

    /// Subscribe to the broadcast channel for real-time events.
    pub fn subscribe(&self) -> broadcast::Receiver<SignalEvent> {
        self.bus.subscribe()
    }

    /// Access the route table for CRUD operations.
    pub fn routes(&self) -> &RouteTable {
        &self.route_table
    }

    /// Access the delivery journal.
    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    /// Access the event window cache.
    pub fn window(&self) -> &WindowCache {
        &self.window
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

        // Add a route.
        let now = chrono::Utc::now().to_rfc3339();
        pool.routes().add(SignalRoute {
            id: "r1".to_string(),
            enabled: true,
            topic: "test.topic".to_string(),
            target_type: TargetType::Agent,
            target_ref: "echo".to_string(),
            created_at: now.clone(),
            updated_at: now,
        });

        // Subscribe so broadcast succeeds.
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

    #[tokio::test]
    async fn subscriber_receives_events() {
        let pool = SignalPool::new(None);

        let now = chrono::Utc::now().to_rfc3339();
        pool.routes().add(SignalRoute {
            id: "r1".to_string(),
            enabled: true,
            topic: "x".to_string(),
            target_type: TargetType::Actor,
            target_ref: "eventlog".to_string(),
            created_at: now.clone(),
            updated_at: now,
        });

        let mut rx = pool.subscribe();

        let event = make_event("x");
        let event_id = event.id.clone();
        pool.publish(event);

        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, event_id);
    }
}
