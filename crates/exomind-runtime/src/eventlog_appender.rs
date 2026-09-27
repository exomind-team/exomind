use chrono::{TimeZone, Utc};
use serde_json::json;
use std::sync::Arc;

use crate::eventlog::{EventLogStore, EventRecord, sanitize_user_id};
use crate::mesh::MeshRelayManager;
use crate::signal::{SignalEvent, SignalPool};

pub const EVENTLOG_REPLICATION_APPENDED_TOPIC: &str = "eventlog.replication.appended";

#[derive(Clone)]
pub struct EventLogAppender {
    store: Arc<EventLogStore>,
    host_id: String,
    signal_pool: Arc<SignalPool>,
    mesh_relay: Option<Arc<MeshRelayManager>>,
}

impl EventLogAppender {
    pub fn new(
        store: Arc<EventLogStore>,
        host_id: String,
        signal_pool: Arc<SignalPool>,
        mesh_relay: Option<Arc<MeshRelayManager>>,
    ) -> Self {
        Self {
            store,
            host_id,
            signal_pool,
            mesh_relay,
        }
    }

    pub async fn append_event(
        &self,
        user_id: Option<&str>,
        event: EventRecord,
    ) -> Result<(), String> {
        self.store.append_event(user_id, event.clone())?;
        self.publish_replication_append(user_id, &event).await;
        Ok(())
    }

    pub async fn publish_replication_append(&self, user_id: Option<&str>, event: &EventRecord) {
        let signal = build_eventlog_replication_signal(&self.host_id, user_id, event);
        self.signal_pool.publish(signal.clone());
        if let Some(mesh_relay) = &self.mesh_relay {
            mesh_relay.forward_event_to_peers(signal).await;
        }
    }
}

pub fn build_eventlog_replication_signal(
    host_id: &str,
    user_id: Option<&str>,
    event: &EventRecord,
) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: EVENTLOG_REPLICATION_APPENDED_TOPIC.to_string(),
        ts: Utc::now().timestamp_millis() as u64,
        source: "runtime:eventlog".to_string(),
        origin_host_id: host_id.to_string(),
        hop: 0,
        trace_id: Some(format!("eventlog:{}", event.id)),
        payload: build_eventlog_replication_payload(event, user_id),
    }
}

pub fn build_eventlog_replication_payload(
    event: &EventRecord,
    user_id: Option<&str>,
) -> serde_json::Value {
    let replication_seq = eventlog_replication_seq(event);
    let event_type = event
        .tags
        .first()
        .cloned()
        .unwrap_or_else(|| "note".to_string());
    let scope_key = sanitize_user_id(user_id);

    json!({
        "schemaVersion": 1,
        "scopeKey": scope_key,
        "replicationSeq": replication_seq,
        "cursor": {
            "kind": "replication_seq",
            "value": replication_seq,
        },
        "event": {
            "id": event.id,
            "content": event.content,
            "createdAt": eventlog_created_at(event.timestamp),
            "type": event_type,
            "metadata": event.metadata,
            "replicationSeq": replication_seq,
        },
        "record": event,
    })
}

pub fn eventlog_replication_seq(event: &EventRecord) -> i64 {
    if event.timestamp > 0 {
        return event.timestamp;
    }

    Utc::now().timestamp_millis().max(1)
}

pub fn eventlog_created_at(timestamp: i64) -> String {
    Utc.timestamp_millis_opt(timestamp)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    fn make_event() -> EventRecord {
        EventRecord {
            id: "event-1".to_string(),
            timestamp: 1_700_000_000_000,
            content: "hello".to_string(),
            tags: vec!["note".to_string()],
            refs: vec![],
            metadata: Some(json!({"source": {"deviceId": "dev-1"}})),
        }
    }

    #[tokio::test]
    async fn append_event_publishes_replication_signal() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let signal_pool = Arc::new(SignalPool::new(None));
        let appender = EventLogAppender::new(
            Arc::clone(&store),
            "host-a".to_string(),
            Arc::clone(&signal_pool),
            None,
        );

        appender
            .append_event(Some("profile-alpha"), make_event())
            .await
            .unwrap();

        assert_eq!(store.list_events(Some("profile-alpha")).unwrap().len(), 1);
        let replication = signal_pool
            .window()
            .recent(10)
            .into_iter()
            .find(|event| event.topic == EVENTLOG_REPLICATION_APPENDED_TOPIC)
            .expect("append should publish eventlog replication signal");

        assert_eq!(replication.origin_host_id, "host-a");
        assert_eq!(replication.trace_id.as_deref(), Some("eventlog:event-1"));
        assert_eq!(replication.payload["scopeKey"], json!("profile-alpha"));
        assert_eq!(replication.payload["event"]["id"], json!("event-1"));
        assert_eq!(
            replication.payload["event"]["metadata"]["source"]["deviceId"],
            json!("dev-1")
        );
    }

    #[test]
    fn business_code_does_not_write_eventlog_store_directly() {
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        scan_rs_files(&src_dir, &mut |path| {
            let Ok(content) = std::fs::read_to_string(path) else {
                return;
            };
            let non_test_content = content.split("#[cfg(test)]").next().unwrap_or(&content);
            let compact = non_test_content
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>();
            if compact.contains("eventlog_store.append_event(") {
                let relative = path
                    .strip_prefix(&src_dir)
                    .unwrap_or(path)
                    .display()
                    .to_string();
                offenders.push(relative);
            }
        });

        assert!(
            offenders.is_empty(),
            "business eventlog writes must use EventLogAppender, not EventLogStore::append_event: {}",
            offenders.join(", ")
        );
    }

    fn scan_rs_files(dir: &Path, visit: &mut dyn FnMut(&Path)) {
        for entry in std::fs::read_dir(dir).expect("read source directory") {
            let entry = entry.expect("read source entry");
            let path = entry.path();
            if path.is_dir() {
                scan_rs_files(&path, visit);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                visit(&path);
            }
        }
    }
}
