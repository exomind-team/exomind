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
            "SELECT id, timestamp, content, tags_json, metadata_json
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

        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare event list: {error}"))?;

        let rows = statement
            .query_map(params_from_iter(query_params.iter()), map_event_row)
            .map_err(|error| format!("failed to query event list: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect event list: {error}"))
    }

    pub fn append_event(&self, user_key: &str, event: &EventRecord) -> Result<(), String> {
        let connection = self.connection();
        connection
            .execute(
                "INSERT INTO eventlog_events (
                    user_key, id, timestamp, content, tags_json, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(user_key, id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    content = excluded.content,
                    tags_json = excluded.tags_json,
                    metadata_json = excluded.metadata_json",
                params![
                    user_key,
                    event.id,
                    event.timestamp,
                    event.content,
                    serde_json::to_string(&event.tags)
                        .map_err(|error| format!("failed to encode tags: {error}"))?,
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
                "SELECT id, timestamp, content, tags_json, metadata_json
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
                    user_key, id, timestamp, content, tags_json, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    user_key,
                    event.id,
                    event.timestamp,
                    event.content,
                    serde_json::to_string(&event.tags)
                        .map_err(|error| format!("failed to encode tags: {error}"))?,
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
                    metadata_json TEXT NULL,
                    PRIMARY KEY (user_key, id)
                );",
            )
            .map_err(|error| format!("failed to init eventlog sqlite schema: {error}"))?;
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
    let metadata_json: Option<String> = row.get(4)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).map_err(map_json_error)?;
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
        metadata,
    })
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
