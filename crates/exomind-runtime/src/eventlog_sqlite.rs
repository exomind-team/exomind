use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde_json::Value;

use crate::eventlog::{EventListFilter, EventRecord};

pub struct SqliteEventLogStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteEventLogStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create sqlite dir: {error}"))?;
        }

        let connection =
            Connection::open(path).map_err(|error| format!("failed to open sqlite: {error}"))?;
        let store = Self {
            path: path.to_path_buf(),
            connection: Mutex::new(connection),
        };
        store.init()?;
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list_events(&self, user_key: &str) -> Result<Vec<EventRecord>, String> {
        self.list_events_filtered(user_key, &EventListFilter::default())
    }

    pub fn list_events_filtered(
        &self,
        user_key: &str,
        filter: &EventListFilter,
    ) -> Result<Vec<EventRecord>, String> {
        let connection = self.connection();
        let mut sql = String::from(
            "SELECT id, timestamp, content, tags_json, refs_json, metadata_json
             FROM eventlog_events
             WHERE user_key = ?",
        );
        let mut query_params = vec![SqlValue::Text(user_key.to_string())];

        if let Some(since_timestamp) = filter.since_timestamp {
            sql.push_str(" AND timestamp >= ?");
            query_params.push(SqlValue::Integer(since_timestamp));
        }

        if let Some(until_timestamp) = filter.until_timestamp {
            sql.push_str(" AND timestamp <= ?");
            query_params.push(SqlValue::Integer(until_timestamp));
        }

        for tag in &filter.tags {
            sql.push_str(" AND tags_json LIKE ? ESCAPE '\\'");
            query_params.push(SqlValue::Text(build_tag_like_pattern(tag)?));
        }

        sql.push_str(" ORDER BY timestamp DESC, id DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            query_params.push(SqlValue::Integer(limit as i64));
        }

        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare event list: {error}"))?;

        let rows = statement
            .query_map(params_from_iter(query_params.iter()), map_event_row)
            .map_err(|error| format!("failed to query event list: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect event list: {error}"))
    }

    pub fn list_events_after_cursor_filtered(
        &self,
        user_key: &str,
        cursor_event: &EventRecord,
        filter: &EventListFilter,
        limit: Option<usize>,
    ) -> Result<Vec<EventRecord>, String> {
        let connection = self.connection();
        let mut sql = String::from(
            "SELECT id, timestamp, content, tags_json, refs_json, metadata_json
             FROM eventlog_events
             WHERE user_key = ?
               AND (timestamp > ? OR (timestamp = ? AND id > ?))",
        );
        let mut query_params = vec![
            SqlValue::Text(user_key.to_string()),
            SqlValue::Integer(cursor_event.timestamp),
            SqlValue::Integer(cursor_event.timestamp),
            SqlValue::Text(cursor_event.id.clone()),
        ];

        if let Some(since_timestamp) = filter.since_timestamp {
            sql.push_str(" AND timestamp >= ?");
            query_params.push(SqlValue::Integer(since_timestamp));
        }

        if let Some(until_timestamp) = filter.until_timestamp {
            sql.push_str(" AND timestamp <= ?");
            query_params.push(SqlValue::Integer(until_timestamp));
        }

        for tag in &filter.tags {
            sql.push_str(" AND tags_json LIKE ? ESCAPE '\\'");
            query_params.push(SqlValue::Text(build_tag_like_pattern(tag)?));
        }

        sql.push_str(" ORDER BY timestamp DESC, id DESC");
        if let Some(limit) = limit {
            sql.push_str(" LIMIT ?");
            query_params.push(SqlValue::Integer(limit as i64));
        }

        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare cursor event list: {error}"))?;

        let rows = statement
            .query_map(params_from_iter(query_params.iter()), map_event_row)
            .map_err(|error| format!("failed to query cursor event list: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect cursor event list: {error}"))
    }

    pub fn append_event(&self, user_key: &str, event: &EventRecord) -> Result<(), String> {
        let connection = self.connection();
        connection
            .execute(
                "INSERT INTO eventlog_events (
                    user_key, id, timestamp, content, tags_json, refs_json, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(user_key, id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    content = excluded.content,
                    tags_json = excluded.tags_json,
                    refs_json = excluded.refs_json,
                    metadata_json = excluded.metadata_json",
                params![
                    user_key,
                    event.id,
                    event.timestamp,
                    event.content,
                    serde_json::to_string(&event.tags)
                        .map_err(|error| format!("failed to encode tags: {error}"))?,
                    serde_json::to_string(&event.refs)
                        .map_err(|error| format!("failed to encode refs: {error}"))?,
                    event
                        .metadata
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()
                        .map_err(|error| format!("failed to encode metadata: {error}"))?,
                ],
            )
            .map_err(|error| format!("failed to append event: {error}"))?;
        Ok(())
    }

    pub fn get_event(&self, user_key: &str, id: &str) -> Result<Option<EventRecord>, String> {
        let connection = self.connection();
        let mut statement = connection
            .prepare(
                "SELECT id, timestamp, content, tags_json, refs_json, metadata_json
                 FROM eventlog_events
                 WHERE user_key = ?1 AND id = ?2",
            )
            .map_err(|error| format!("failed to prepare get event: {error}"))?;

        statement
            .query_row(params![user_key, id], map_event_row)
            .optional()
            .map_err(|error| format!("failed to get event: {error}"))
    }

    pub fn clear_events(&self, user_key: &str) -> Result<(), String> {
        let connection = self.connection();
        connection
            .execute(
                "DELETE FROM eventlog_events WHERE user_key = ?1",
                params![user_key],
            )
            .map_err(|error| format!("failed to clear events: {error}"))?;
        Ok(())
    }

    pub fn replace_all(&self, user_key: &str, events: &[EventRecord]) -> Result<(), String> {
        let mut connection = self.connection();
        let tx = connection
            .transaction()
            .map_err(|error| format!("failed to start eventlog transaction: {error}"))?;
        tx.execute(
            "DELETE FROM eventlog_events WHERE user_key = ?1",
            params![user_key],
        )
        .map_err(|error| format!("failed to clear events in transaction: {error}"))?;

        for event in events {
            tx.execute(
                "INSERT INTO eventlog_events (
                    user_key, id, timestamp, content, tags_json, refs_json, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    user_key,
                    event.id,
                    event.timestamp,
                    event.content,
                    serde_json::to_string(&event.tags)
                        .map_err(|error| format!("failed to encode tags: {error}"))?,
                    serde_json::to_string(&event.refs)
                        .map_err(|error| format!("failed to encode refs: {error}"))?,
                    event
                        .metadata
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()
                        .map_err(|error| format!("failed to encode metadata: {error}"))?,
                ],
            )
            .map_err(|error| format!("failed to insert event in transaction: {error}"))?;
        }

        tx.commit()
            .map_err(|error| format!("failed to commit eventlog transaction: {error}"))?;
        Ok(())
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, String> {
        std::fs::read(&self.path)
            .map_err(|error| format!("failed to read sqlite snapshot: {error}"))
    }

    pub fn list_known_user_ids(&self) -> Result<Vec<String>, String> {
        let connection = self.connection();
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT user_key
                 FROM eventlog_events
                 WHERE user_key IS NOT NULL AND TRIM(user_key) != ''
                 ORDER BY user_key ASC",
            )
            .map_err(|error| format!("failed to prepare known user list: {error}"))?;

        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to query known user list: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect known user list: {error}"))
    }

    fn init(&self) -> Result<(), String> {
        let connection = self.connection();
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS eventlog_events (
                    user_key TEXT NOT NULL,
                    id TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    refs_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NULL,
                    PRIMARY KEY (user_key, id)
                );
                CREATE INDEX IF NOT EXISTS idx_eventlog_user_timestamp_id
                    ON eventlog_events(user_key, timestamp DESC, id DESC);",
            )
            .map_err(|error| format!("failed to init eventlog sqlite schema: {error}"))?;
        ensure_refs_json_column(&connection)?;
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn map_event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventRecord> {
    let tags_json: String = row.get(3)?;
    let refs_json: String = row.get(4)?;
    let metadata_json: Option<String> = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).map_err(map_json_error)?;
    let refs = serde_json::from_str(&refs_json).map_err(map_json_error)?;
    let metadata: Option<Value> = metadata_json
        .as_deref()
        .map(serde_json::from_str::<Value>)
        .transpose()
        .map_err(map_json_error)?;

    Ok(EventRecord {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        content: row.get(2)?,
        tags,
        refs,
        metadata,
    })
}

fn ensure_refs_json_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(eventlog_events)")
        .map_err(|error| format!("failed to inspect eventlog sqlite schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to read eventlog sqlite schema: {error}"))?;
    let has_refs_json = columns
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect eventlog sqlite schema: {error}"))?
        .iter()
        .any(|column| column == "refs_json");

    if has_refs_json {
        return Ok(());
    }

    connection
        .execute(
            "ALTER TABLE eventlog_events ADD COLUMN refs_json TEXT NOT NULL DEFAULT '[]'",
            [],
        )
        .map_err(|error| format!("failed to migrate eventlog sqlite refs_json column: {error}"))?;
    Ok(())
}

fn map_json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn build_tag_like_pattern(tag: &str) -> Result<String, String> {
    let encoded = serde_json::to_string(tag)
        .map_err(|error| format!("failed to encode tag filter: {error}"))?;
    Ok(format!("%{}%", escape_like_pattern(&encoded)))
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_")
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::SqliteEventLogStore;
    use crate::eventlog::{EventListFilter, EventRecord};

    fn make_event(id: &str, timestamp: i64) -> EventRecord {
        EventRecord {
            id: id.to_string(),
            timestamp,
            content: format!("event-{id}"),
            tags: vec!["note".to_string()],
            refs: Vec::new(),
            metadata: None,
        }
    }

    #[test]
    fn list_events_filtered_applies_limit_in_sqlite_query() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");
        let store = SqliteEventLogStore::open(&sqlite_path).unwrap();

        for index in 0..5 {
            let id = format!("event-{index}");
            store
                .append_event(
                    "profile-argon",
                    &make_event(id.as_str(), 1_700_000_000_000 + index),
                )
                .unwrap();
        }

        let events = store
            .list_events_filtered(
                "profile-argon",
                &EventListFilter {
                    limit: Some(2),
                    ..EventListFilter::default()
                },
            )
            .unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "event-4");
        assert_eq!(events[1].id, "event-3");
    }

    #[test]
    fn list_events_after_cursor_filtered_applies_cursor_and_limit() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("eventlog.sqlite");
        let store = SqliteEventLogStore::open(&sqlite_path).unwrap();

        for index in 0..5 {
            let id = format!("event-{index}");
            store
                .append_event(
                    "profile-argon",
                    &make_event(id.as_str(), 1_700_000_000_000 + index),
                )
                .unwrap();
        }

        let cursor_event = store
            .get_event("profile-argon", "event-2")
            .unwrap()
            .unwrap();
        let events = store
            .list_events_after_cursor_filtered(
                "profile-argon",
                &cursor_event,
                &EventListFilter::default(),
                Some(2),
            )
            .unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "event-4");
        assert_eq!(events[1].id, "event-3");
    }
}
