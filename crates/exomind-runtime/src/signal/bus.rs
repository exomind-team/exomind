use tokio::sync::broadcast;

use super::journal::Journal;
use super::route_table::RouteTable;
use super::types::{DeliveryRecord, DeliveryStatus, SignalEvent};
use super::window::WindowCache;

/// Broadcast channel capacity for subscribers.
const BROADCAST_CAPACITY: usize = 256;

/// SignalBus: publish events, fan out to matched routes, record deliveries.
pub struct SignalBus {
    sender: broadcast::Sender<SignalEvent>,
}

impl Default for SignalBus {
    fn default() -> Self {
        Self::new()
    }
}

impl SignalBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self { sender }
    }

    /// Publish an event: look up matching routes, broadcast to subscribers,
    /// record each fanout as a DeliveryRecord in the journal, and cache
    /// the event in the window.
    pub fn publish(
        &self,
        event: SignalEvent,
        route_table: &RouteTable,
        journal: &Journal,
        window: &WindowCache,
    ) -> Vec<DeliveryRecord> {
        let matched = route_table.match_routes(&event.topic);
        let now = chrono::Utc::now().to_rfc3339();

        // Broadcast once to all SSE subscribers (not per-route).
        let (broadcast_status, broadcast_reason) = match self.sender.send(event.clone()) {
            Ok(_) => (DeliveryStatus::Sent, None),
            Err(_) => (
                DeliveryStatus::Failed,
                Some("no active receivers".to_string()),
            ),
        };

        // Record a DeliveryRecord for each matched route (routing is logical,
        // actual delivery filtering happens at the SSE stream handler).
        let mut records = Vec::with_capacity(matched.len());

        for route in &matched {
            let record = DeliveryRecord {
                event_id: event.id.clone(),
                route_id: route.id.clone(),
                target_ref: route.target_ref.clone(),
                status: broadcast_status.clone(),
                reason: broadcast_reason.clone(),
                started_at: now.clone(),
                finished_at: chrono::Utc::now().to_rfc3339(),
            };

            if let Err(error) = journal.append(record.clone()) {
                tracing::warn!(
                    event_id = %record.event_id,
                    route_id = %record.route_id,
                    error = %error,
                    "signal journal append failed during publish (日志追加失败)"
                );
            }
            records.push(record);
        }

        // Cache the event in the window for SSE replay.
        window.push(event);

        records
    }

    /// Subscribe to the broadcast channel.
    pub fn subscribe(&self) -> broadcast::Receiver<SignalEvent> {
        self.sender.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::types::TargetType;

    fn make_event(topic: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: 1700000000000,
            source: "test".to_string(),
            origin_host_id: "host-1".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({"msg": "hello"}),
        }
    }

    fn make_route_table_with_routes() -> RouteTable {
        let table = RouteTable::new(None, None);
        let now = chrono::Utc::now().to_rfc3339();
        table.add(crate::signal::types::SignalRoute {
            id: "route-classifier".to_string(),
            enabled: true,
            topic: "user.input.text".to_string(),
            target_type: TargetType::Agent,
            target_ref: "classifier".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .unwrap();
        table.add(crate::signal::types::SignalRoute {
            id: "route-ui".to_string(),
            enabled: true,
            topic: "*".to_string(),
            target_type: TargetType::Frontend,
            target_ref: "ui".to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
        .unwrap();
        table
    }

    #[test]
    fn publish_creates_delivery_records() {
        let bus = SignalBus::new();
        let route_table = make_route_table_with_routes();
        let journal = Journal::new();
        let window = WindowCache::new();

        // Need at least one subscriber so send() succeeds.
        let _rx = bus.subscribe();

        let event = make_event("user.input.text");
        let records = bus.publish(event, &route_table, &journal, &window);

        // "user.input.text" matches route-classifier (exact) + route-ui (wildcard) = 2
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|r| r.status == DeliveryStatus::Sent));
    }

    #[test]
    fn publish_records_failure_when_no_subscribers() {
        let bus = SignalBus::new();
        let route_table = make_route_table_with_routes();
        let journal = Journal::new();
        let window = WindowCache::new();

        // No subscribers.
        let event = make_event("user.input.text");
        let records = bus.publish(event, &route_table, &journal, &window);

        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|r| r.status == DeliveryStatus::Failed));
    }

    #[test]
    fn publish_writes_to_journal() {
        let bus = SignalBus::new();
        let route_table = make_route_table_with_routes();
        let journal = Journal::new();
        let window = WindowCache::new();
        let _rx = bus.subscribe();

        let event = make_event("user.input.text");
        bus.publish(event, &route_table, &journal, &window);

        assert_eq!(journal.len(), 2);
    }

    #[test]
    fn publish_writes_to_window() {
        let bus = SignalBus::new();
        let route_table = make_route_table_with_routes();
        let journal = Journal::new();
        let window = WindowCache::new();
        let _rx = bus.subscribe();

        let event = make_event("user.input.text");
        let event_id = event.id.clone();
        bus.publish(event, &route_table, &journal, &window);

        assert_eq!(window.len(), 1);
        assert_eq!(window.recent(1)[0].id, event_id);
    }

    #[test]
    fn publish_no_matching_routes_still_caches_event() {
        let bus = SignalBus::new();
        let route_table = RouteTable::new(None, None); // Empty routes.
        let journal = Journal::new();
        let window = WindowCache::new();

        let event = make_event("unmatched.topic");
        let records = bus.publish(event, &route_table, &journal, &window);

        assert!(records.is_empty());
        assert_eq!(window.len(), 1); // Event still cached.
        assert!(journal.is_empty()); // No delivery records.
    }

    #[tokio::test]
    async fn subscriber_receives_published_event() {
        let bus = SignalBus::new();
        let route_table = make_route_table_with_routes();
        let journal = Journal::new();
        let window = WindowCache::new();

        let mut rx = bus.subscribe();

        let event = make_event("user.input.text");
        let event_id = event.id.clone();
        bus.publish(event, &route_table, &journal, &window);

        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, event_id);
    }
}
