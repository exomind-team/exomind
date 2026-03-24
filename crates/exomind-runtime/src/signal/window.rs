use std::collections::VecDeque;
use std::sync::RwLock;

use super::types::SignalEvent;

const DEFAULT_CAPACITY: usize = 1000;

/// Ring buffer caching recent SignalEvents for Last-Event-ID replay.
pub struct WindowCache {
    events: RwLock<VecDeque<SignalEvent>>,
    capacity: usize,
}

impl Default for WindowCache {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowCache {
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            events: RwLock::new(VecDeque::with_capacity(capacity)),
            capacity,
        }
    }

    /// Push a new event. Evicts oldest if at capacity.
    pub fn push(&self, event: SignalEvent) {
        let mut events = match self.events.write() {
            Ok(e) => e,
            Err(poisoned) => poisoned.into_inner(),
        };
        if events.len() >= self.capacity {
            events.pop_front();
        }
        events.push_back(event);
    }

    /// Return all events after the given event_id (exclusive).
    /// Used for SSE Last-Event-ID replay.
    /// If event_id was evicted from the buffer, returns all cached events
    /// as a best-effort fallback (client may have missed some).
    pub fn since(&self, event_id: &str) -> Vec<SignalEvent> {
        let events = match self.events.read() {
            Ok(e) => e,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Find the position of the event with the given ID.
        let pos = events.iter().position(|e| e.id == event_id);
        match pos {
            Some(idx) => events.iter().skip(idx + 1).cloned().collect(),
            // ID not found (evicted or unknown): return all cached events as fallback.
            None => events.iter().cloned().collect(),
        }
    }

    /// Return the most recent `limit` events (newest last).
    pub fn recent(&self, limit: usize) -> Vec<SignalEvent> {
        let events = match self.events.read() {
            Ok(e) => e,
            Err(poisoned) => poisoned.into_inner(),
        };
        let len = events.len();
        let skip = len.saturating_sub(limit);
        events.iter().skip(skip).cloned().collect()
    }

    pub fn len(&self) -> usize {
        let events = match self.events.read() {
            Ok(e) => e,
            Err(poisoned) => poisoned.into_inner(),
        };
        events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(id: &str, topic: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: id.to_string(),
            topic: topic.to_string(),
            ts: 1700000000000,
            source: "test".to_string(),
            origin_host_id: "host-1".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({}),
        }
    }

    #[test]
    fn push_and_recent() {
        let cache = WindowCache::new();
        cache.push(make_event("e1", "topic.a"));
        cache.push(make_event("e2", "topic.b"));
        cache.push(make_event("e3", "topic.c"));

        let recent = cache.recent(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "e2");
        assert_eq!(recent[1].id, "e3");
    }

    #[test]
    fn since_returns_events_after_id() {
        let cache = WindowCache::new();
        cache.push(make_event("e1", "a"));
        cache.push(make_event("e2", "b"));
        cache.push(make_event("e3", "c"));

        let after = cache.since("e1");
        assert_eq!(after.len(), 2);
        assert_eq!(after[0].id, "e2");
        assert_eq!(after[1].id, "e3");
    }

    #[test]
    fn since_returns_empty_for_last_event() {
        let cache = WindowCache::new();
        cache.push(make_event("e1", "a"));

        let after = cache.since("e1");
        assert!(after.is_empty());
    }

    #[test]
    fn since_returns_all_for_unknown_id() {
        let cache = WindowCache::new();
        cache.push(make_event("e1", "a"));
        cache.push(make_event("e2", "b"));

        // Unknown ID → fallback to all cached events.
        let after = cache.since("unknown");
        assert_eq!(after.len(), 2);
        assert_eq!(after[0].id, "e1");
        assert_eq!(after[1].id, "e2");
    }

    #[test]
    fn ring_buffer_evicts_oldest() {
        let cache = WindowCache::with_capacity(3);
        cache.push(make_event("e1", "a"));
        cache.push(make_event("e2", "b"));
        cache.push(make_event("e3", "c"));
        cache.push(make_event("e4", "d"));

        assert_eq!(cache.len(), 3);
        let recent = cache.recent(10);
        assert_eq!(recent[0].id, "e2");
        assert_eq!(recent[2].id, "e4");
    }

    #[test]
    fn empty_cache() {
        let cache = WindowCache::new();
        assert!(cache.is_empty());
        assert!(cache.recent(10).is_empty());
        assert!(cache.since("anything").is_empty());
    }
}
