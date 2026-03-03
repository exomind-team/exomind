use std::collections::VecDeque;
use std::sync::RwLock;

use super::types::DeliveryRecord;

const DEFAULT_CAPACITY: usize = 1000;

/// Ring buffer storing delivery records for observability.
pub struct Journal {
    records: RwLock<VecDeque<DeliveryRecord>>,
    capacity: usize,
}

impl Default for Journal {
    fn default() -> Self {
        Self::new()
    }
}

impl Journal {
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            records: RwLock::new(VecDeque::with_capacity(capacity)),
            capacity,
        }
    }

    /// Append a delivery record. Evicts oldest if at capacity.
    pub fn append(&self, record: DeliveryRecord) {
        let mut records = match self.records.write() {
            Ok(r) => r,
            Err(poisoned) => poisoned.into_inner(),
        };
        if records.len() >= self.capacity {
            records.pop_front();
        }
        records.push_back(record);
    }

    /// Return the most recent `limit` records (newest last).
    pub fn recent(&self, limit: usize) -> Vec<DeliveryRecord> {
        let records = match self.records.read() {
            Ok(r) => r,
            Err(poisoned) => poisoned.into_inner(),
        };
        let len = records.len();
        let skip = len.saturating_sub(limit);
        records.iter().skip(skip).cloned().collect()
    }

    /// Return total number of records currently held.
    pub fn len(&self) -> usize {
        let records = match self.records.read() {
            Ok(r) => r,
            Err(poisoned) => poisoned.into_inner(),
        };
        records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::types::DeliveryStatus;

    fn make_record(event_id: &str) -> DeliveryRecord {
        DeliveryRecord {
            event_id: event_id.to_string(),
            route_id: "route-1".to_string(),
            target_ref: "target-1".to_string(),
            status: DeliveryStatus::Sent,
            reason: None,
            started_at: "2026-01-01T00:00:00Z".to_string(),
            finished_at: "2026-01-01T00:00:01Z".to_string(),
        }
    }

    #[test]
    fn append_and_recent() {
        let journal = Journal::new();
        journal.append(make_record("evt-1"));
        journal.append(make_record("evt-2"));
        journal.append(make_record("evt-3"));

        let recent = journal.recent(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].event_id, "evt-2");
        assert_eq!(recent[1].event_id, "evt-3");
    }

    #[test]
    fn recent_returns_all_when_limit_exceeds_length() {
        let journal = Journal::new();
        journal.append(make_record("evt-1"));

        let recent = journal.recent(100);
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn ring_buffer_evicts_oldest() {
        let journal = Journal::with_capacity(3);
        journal.append(make_record("evt-1"));
        journal.append(make_record("evt-2"));
        journal.append(make_record("evt-3"));
        journal.append(make_record("evt-4"));

        assert_eq!(journal.len(), 3);
        let recent = journal.recent(10);
        assert_eq!(recent[0].event_id, "evt-2");
        assert_eq!(recent[2].event_id, "evt-4");
    }

    #[test]
    fn empty_journal() {
        let journal = Journal::new();
        assert!(journal.is_empty());
        assert_eq!(journal.recent(10).len(), 0);
    }
}
