use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use crate::timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStoreError};

const ACTIVE_BLOCK_SINGLETON_KEY: &str = "current";
const DEFAULT_SCOPE_KEY: &str = "anonymous";

pub struct SqliteTimeBlockStore {
    _path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteTimeBlockStore {
    pub fn open(path: &Path) -> Result<Self, TimeBlockStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let store = Self {
            _path: path.to_path_buf(),
            connection: Mutex::new(connection),
        };
        store.init()?;
        Ok(store)
    }

    pub fn list_completed(&self) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        self.list_completed_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn list_completed_scoped(
        &self,
        scope_key: &str,
    ) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, name, start_id, end_id, note, tags_json, start_time, end_time,
                    task_ids_json, task_status_outcomes_json, task_association_log_json
             FROM completed_timeblocks
             WHERE scope_key = ?1
             ORDER BY end_time DESC, id DESC",
        )?;

        let rows = statement.query_map(params![normalize_scope_key(scope_key)], |row| {
            Ok(TimeBlockData {
                id: row.get(0)?,
                name: row.get(1)?,
                start_id: row.get(2)?,
                end_id: row.get(3)?,
                note: row.get(4)?,
                tags: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(5)?)
                    .map_err(to_sqlite_conversion_error)?,
                start_time: row.get(6)?,
                end_time: row.get(7)?,
                task_ids: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(8)?)
                    .map_err(to_sqlite_conversion_error)?,
                task_status_outcomes: row
                    .get::<_, Option<String>>(9)?
                    .map(|value| serde_json::from_str(&value).map_err(to_sqlite_conversion_error))
                    .transpose()?,
                task_association_log: serde_json::from_str(&row.get::<_, String>(10)?)
                    .map_err(to_sqlite_conversion_error)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn replace_completed(&self, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        self.replace_completed_scoped(DEFAULT_SCOPE_KEY, blocks)
    }

    pub fn replace_completed_scoped(
        &self,
        scope_key: &str,
        blocks: &[TimeBlockData],
    ) -> Result<(), TimeBlockStoreError> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        tx.execute(
            "DELETE FROM completed_timeblocks WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
        )?;
        for block in blocks {
            tx.execute(
                "INSERT OR REPLACE INTO completed_timeblocks (
                    scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                    task_ids_json, task_status_outcomes_json, task_association_log_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    normalize_scope_key(scope_key),
                    block.id,
                    block.name,
                    block.start_id,
                    block.end_id,
                    block.note,
                    serde_json::to_string(&block.tags)?,
                    block.start_time,
                    block.end_time,
                    serde_json::to_string(&block.task_ids)?,
                    block
                        .task_status_outcomes
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    serde_json::to_string(&block.task_association_log)?,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_active(&self) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        self.get_active_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn get_active_scoped(
        &self,
        scope_key: &str,
    ) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        let connection = self.connection();
        let payload = connection
            .query_row(
                "SELECT payload_json FROM active_timeblock WHERE scope_key = ?1 AND singleton_key = ?2",
                params![normalize_scope_key(scope_key), ACTIVE_BLOCK_SINGLETON_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        payload
            .map(|json| {
                serde_json::from_str::<ActiveBlockData>(&json)
                    .map(ActiveBlockData::normalize_task_ids)
            })
            .transpose()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn put_active(&self, block: &ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        self.put_active_scoped(DEFAULT_SCOPE_KEY, block)
    }

    pub fn put_active_scoped(
        &self,
        scope_key: &str,
        block: &ActiveBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO active_timeblock (scope_key, singleton_key, payload_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(scope_key, singleton_key) DO UPDATE SET payload_json = excluded.payload_json",
            params![
                normalize_scope_key(scope_key),
                ACTIVE_BLOCK_SINGLETON_KEY,
                serde_json::to_string(&block.clone().normalize_task_ids())?,
            ],
        )?;
        Ok(())
    }

    pub fn delete_active(&self) -> Result<(), TimeBlockStoreError> {
        self.delete_active_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn delete_active_scoped(&self, scope_key: &str) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "DELETE FROM active_timeblock WHERE scope_key = ?1 AND singleton_key = ?2",
            params![normalize_scope_key(scope_key), ACTIVE_BLOCK_SINGLETON_KEY],
        )?;
        Ok(())
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn len_completed_scoped(&self, scope_key: &str) -> Result<usize, TimeBlockStoreError> {
        let connection = self.connection();
        let count: i64 = connection.query_row(
            "SELECT COUNT(1) FROM completed_timeblocks WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, TimeBlockStoreError> {
        let temp_root = std::env::temp_dir().join(format!(
            "exomind-timeblocks-snapshot-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_root)?;
        let snapshot_path = temp_root.join("timeblocks-snapshot.sqlite");
        let escaped_snapshot_path = snapshot_path.to_string_lossy().replace('\'', "''");

        {
            let connection = self.connection();
            connection.execute_batch(&format!("VACUUM INTO '{}';", escaped_snapshot_path))?;
        }

        let bytes = std::fs::read(&snapshot_path)?;
        let _ = std::fs::remove_file(&snapshot_path);
        let _ = std::fs::remove_dir_all(&temp_root);
        Ok(bytes)
    }

    fn init(&self) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        let has_completed_table: bool = connection.query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'completed_timeblocks'",
            [],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        )?;

        if has_completed_table {
            let columns = completed_timeblock_columns(&connection)?;
            if !columns.iter().any(|column| column == "scope_key") {
                connection.execute_batch(
                    "ALTER TABLE completed_timeblocks RENAME TO completed_timeblocks_legacy;
                     CREATE TABLE completed_timeblocks (
                        scope_key TEXT NOT NULL,
                        id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        start_id TEXT NOT NULL,
                        end_id TEXT NOT NULL,
                        note TEXT NULL,
                        tags_json TEXT NOT NULL,
                        start_time INTEGER NOT NULL,
                        end_time INTEGER NOT NULL,
                        task_ids_json TEXT NOT NULL DEFAULT '[]',
                        task_status_outcomes_json TEXT NULL,
                        task_association_log_json TEXT NOT NULL DEFAULT '[]',
                        PRIMARY KEY (scope_key, id)
                     );
                     INSERT INTO completed_timeblocks (
                        scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        task_ids_json, task_status_outcomes_json, task_association_log_json
                     )
                     SELECT
                        'anonymous', id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        '[]', NULL, '[]'
                      FROM completed_timeblocks_legacy;
                      DROP TABLE completed_timeblocks_legacy;",
                )?;
            }

            let columns = completed_timeblock_columns(&connection)?;
            if !columns.iter().any(|column| column == "task_ids_json") {
                connection.execute(
                    "ALTER TABLE completed_timeblocks ADD COLUMN task_ids_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }

            if !columns
                .iter()
                .any(|column| column == "task_status_outcomes_json")
            {
                connection.execute(
                    "ALTER TABLE completed_timeblocks ADD COLUMN task_status_outcomes_json TEXT NULL",
                    [],
                )?;
            }

            if !columns
                .iter()
                .any(|column| column == "task_association_log_json")
            {
                connection.execute(
                    "ALTER TABLE completed_timeblocks ADD COLUMN task_association_log_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )?;
            }
        }

        let has_active_table: bool = connection.query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'active_timeblock'",
            [],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        )?;

        if has_active_table {
            let mut statement = connection.prepare("PRAGMA table_info(active_timeblock)")?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            if !columns.iter().any(|column| column == "scope_key") {
                connection.execute_batch(
                    "ALTER TABLE active_timeblock RENAME TO active_timeblock_legacy;
                     CREATE TABLE active_timeblock (
                        scope_key TEXT NOT NULL,
                        singleton_key TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        PRIMARY KEY (scope_key, singleton_key)
                     );
                     INSERT INTO active_timeblock (scope_key, singleton_key, payload_json)
                     SELECT 'anonymous', singleton_key, payload_json
                     FROM active_timeblock_legacy;
                     DROP TABLE active_timeblock_legacy;",
                )?;
            }
        }

        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS completed_timeblocks (
                scope_key TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_id TEXT NOT NULL,
                end_id TEXT NOT NULL,
                note TEXT NULL,
                tags_json TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                task_ids_json TEXT NOT NULL DEFAULT '[]',
                task_status_outcomes_json TEXT NULL,
                task_association_log_json TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (scope_key, id)
             );
             CREATE TABLE IF NOT EXISTS active_timeblock (
                scope_key TEXT NOT NULL,
                singleton_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                PRIMARY KEY (scope_key, singleton_key)
             );",
        )?;
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().unwrap()
    }
}

fn normalize_scope_key(scope_key: &str) -> &str {
    let normalized = scope_key.trim();
    if normalized.is_empty() {
        DEFAULT_SCOPE_KEY
    } else {
        normalized
    }
}

fn completed_timeblock_columns(
    connection: &Connection,
) -> Result<Vec<String>, TimeBlockStoreError> {
    let mut statement = connection.prepare("PRAGMA table_info(completed_timeblocks)")?;
    statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(TimeBlockStoreError::from)
}

fn to_sqlite_conversion_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
