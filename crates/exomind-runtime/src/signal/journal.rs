use std::collections::VecDeque;
use std::sync::{Arc, RwLock};

use super::sqlite_store::{SignalStoreError, SqliteSignalStore};
use super::types::DeliveryRecord;

const DEFAULT_CAPACITY: usize = 1000;

pub struct Journal {
    records: RwLock<VecDeque<DeliveryRecord>>,
    capacity: usize,
    store: Option<Arc<SqliteSignalStore>>,
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
            store: None,
        }
    }

    pub(crate) fn with_sqlite_store(store: Arc<SqliteSignalStore>) -> Result<Self, SignalStoreError> {
        let initial = store.load_recent_journal(DEFAULT_CAPACITY)?;
        let mut records = VecDeque::with_capacity(DEFAULT_CAPACITY);
        for record in initial {
            records.push_back(record);
        }

        Ok(Self {
            records: RwLock::new(records),
            capacity: DEFAULT_CAPACITY,
            store: Some(store),
        })
    }

    pub fn append(&self, record: DeliveryRecord) -> Result<(), SignalStoreError> {
        if let Some(store) = &self.store {
            store.append_journal(&record)?;
        }

        let mut records = match self.records.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if records.len() >= self.capacity {
            records.pop_front();
        }
        records.push_back(record);
        Ok(())
    }

    pub fn recent(&self, limit: usize) -> Vec<DeliveryRecord> {
        let records = match self.records.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let len = records.len();
        let skip = len.saturating_sub(limit);
        records.iter().skip(skip).cloned().collect()
    }

    pub fn len(&self) -> usize {
        let records = match self.records.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn all_records(&self) -> Vec<DeliveryRecord> {
        if let Some(store) = &self.store {
            return match store.load_all_journal() {
                Ok(records) => records,
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "signal journal reload failed, falling back to memory cache (日志重载失败，回退到内存缓存)"
                    );
                    self.recent(self.capacity)
                }
            };
        }
        self.recent(self.capacity)
    }

    pub fn replace_all(&self, records: Vec<DeliveryRecord>) -> Result<(), SignalStoreError> {
        if let Some(store) = &self.store {
            store.replace_journal(&records)?;
        }

        let mut buffer = VecDeque::with_capacity(self.capacity);
        let start = records.len().saturating_sub(self.capacity);
        for record in records.iter().skip(start) {
            buffer.push_back(record.clone());
        }

        let mut current = match self.records.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *current = buffer;
        Ok(())
    }

    pub(crate) fn replace_all_in_memory(&self, records: Vec<DeliveryRecord>) {
        let mut buffer = VecDeque::with_capacity(self.capacity);
        let start = records.len().saturating_sub(self.capacity);
        for record in records.iter().skip(start) {
            buffer.push_back(record.clone());
        }

        let mut current = match self.records.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *current = buffer;
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
        journal.append(make_record("evt-1")).unwrap();
        journal.append(make_record("evt-2")).unwrap();
        journal.append(make_record("evt-3")).unwrap();

        let recent = journal.recent(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].event_id, "evt-2");
        assert_eq!(recent[1].event_id, "evt-3");
    }

    #[test]
    fn recent_returns_all_when_limit_exceeds_length() {
        let journal = Journal::new();
        journal.append(make_record("evt-1")).unwrap();

        let recent = journal.recent(100);
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn ring_buffer_evicts_oldest() {
        let journal = Journal::with_capacity(3);
        journal.append(make_record("evt-1")).unwrap();
        journal.append(make_record("evt-2")).unwrap();
        journal.append(make_record("evt-3")).unwrap();
        journal.append(make_record("evt-4")).unwrap();

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
