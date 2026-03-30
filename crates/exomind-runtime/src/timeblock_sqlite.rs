use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use crate::timeblock::{
    ActiveBlockData, PlannedTimeBlockData, PlannedTimeBlockType, SchedulingWindowData,
    TimeBlockData, TimeBlockStoreError,
};

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
                    task_ids_json, task_status_outcomes_json, task_association_log_json,
                    source_planned_block_id
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
                source_planned_block_id: row.get(11)?,
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
                    task_ids_json, task_status_outcomes_json, task_association_log_json,
                    source_planned_block_id
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                    block.source_planned_block_id,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_planned_scoped(
        &self,
        scope_key: &str,
    ) -> Result<Vec<PlannedTimeBlockData>, TimeBlockStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, date, block_type, title, planned_start_at, planned_duration_minutes, note,
                    linked_task_ids_json, block_order, created_at, updated_at
             FROM planned_timeblocks
             WHERE scope_key = ?1
             ORDER BY date ASC, block_order ASC, planned_start_at ASC, id ASC",
        )?;

        let rows = statement.query_map(params![normalize_scope_key(scope_key)], |row| {
            let block_type: String = row.get(2)?;
            Ok(PlannedTimeBlockData {
                id: row.get(0)?,
                date: row.get(1)?,
                block_type: parse_planned_block_type(&block_type)?,
                title: row.get(3)?,
                planned_start_at: row.get(4)?,
                planned_duration_minutes: row.get(5)?,
                note: row.get(6)?,
                linked_task_ids: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(7)?)
                    .map_err(to_sqlite_conversion_error)?,
                order: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn replace_planned_scoped(
        &self,
        scope_key: &str,
        blocks: &[PlannedTimeBlockData],
    ) -> Result<(), TimeBlockStoreError> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        tx.execute(
            "DELETE FROM planned_timeblocks WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
        )?;
        for block in blocks {
            insert_or_replace_planned_block(&tx, scope_key, block)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn put_planned_scoped(
        &self,
        scope_key: &str,
        block: &PlannedTimeBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        insert_or_replace_planned_block(&connection, scope_key, block)
    }

    pub fn delete_planned_scoped(
        &self,
        scope_key: &str,
        block_id: &str,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "DELETE FROM planned_timeblocks WHERE scope_key = ?1 AND id = ?2",
            params![normalize_scope_key(scope_key), block_id],
        )?;
        Ok(())
    }

    pub fn list_windows_scoped(
        &self,
        scope_key: &str,
    ) -> Result<Vec<SchedulingWindowData>, TimeBlockStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, date, title, planned_start_at, planned_end_at, preset_json, segments_json, created_at, updated_at
             FROM planner_windows
             WHERE scope_key = ?1
             ORDER BY date ASC, planned_start_at ASC, id ASC",
        )?;

        let rows = statement.query_map(params![normalize_scope_key(scope_key)], |row| {
            Ok(SchedulingWindowData {
                id: row.get(0)?,
                date: row.get(1)?,
                title: row.get(2)?,
                planned_start_at: row.get(3)?,
                planned_end_at: row.get(4)?,
                rhythm_preset: serde_json::from_str(&row.get::<_, String>(5)?)
                    .map_err(to_sqlite_conversion_error)?,
                segments: serde_json::from_str(&row.get::<_, String>(6)?)
                    .map_err(to_sqlite_conversion_error)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn replace_windows_scoped(
        &self,
        scope_key: &str,
        windows: &[SchedulingWindowData],
    ) -> Result<(), TimeBlockStoreError> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        tx.execute(
            "DELETE FROM planner_windows WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
        )?;
        for window in windows {
            insert_or_replace_window(&tx, scope_key, window)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn put_window_scoped(
        &self,
        scope_key: &str,
        window: &SchedulingWindowData,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        insert_or_replace_window(&connection, scope_key, window)
    }

    pub fn delete_window_scoped(
        &self,
        scope_key: &str,
        window_id: &str,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "DELETE FROM planner_windows WHERE scope_key = ?1 AND id = ?2",
            params![normalize_scope_key(scope_key), window_id],
        )?;
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

            if !columns
                .iter()
                .any(|column| column == "source_planned_block_id")
            {
                connection.execute(
                    "ALTER TABLE completed_timeblocks ADD COLUMN source_planned_block_id TEXT NULL",
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
                source_planned_block_id TEXT NULL,
                PRIMARY KEY (scope_key, id)
             );
             CREATE TABLE IF NOT EXISTS active_timeblock (
                scope_key TEXT NOT NULL,
                singleton_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                PRIMARY KEY (scope_key, singleton_key)
             );
             CREATE TABLE IF NOT EXISTS planned_timeblocks (
                scope_key TEXT NOT NULL,
                id TEXT NOT NULL,
                date TEXT NOT NULL,
                block_type TEXT NOT NULL,
                title TEXT NOT NULL,
                planned_start_at INTEGER NOT NULL,
                planned_duration_minutes INTEGER NOT NULL,
                note TEXT NULL,
                linked_task_ids_json TEXT NOT NULL DEFAULT '[]',
                block_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (scope_key, id)
             );
             CREATE TABLE IF NOT EXISTS planner_windows (
                scope_key TEXT NOT NULL,
                id TEXT NOT NULL,
                date TEXT NOT NULL,
                title TEXT NULL,
                planned_start_at INTEGER NOT NULL,
                planned_end_at INTEGER NOT NULL,
                preset_json TEXT NOT NULL,
                segments_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (scope_key, id)
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

fn insert_or_replace_planned_block(
    connection: &Connection,
    scope_key: &str,
    block: &PlannedTimeBlockData,
) -> Result<(), TimeBlockStoreError> {
    connection.execute(
        "INSERT INTO planned_timeblocks (
            scope_key, id, date, block_type, title, planned_start_at, planned_duration_minutes,
            note, linked_task_ids_json, block_order, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(scope_key, id) DO UPDATE SET
            date = excluded.date,
            block_type = excluded.block_type,
            title = excluded.title,
            planned_start_at = excluded.planned_start_at,
            planned_duration_minutes = excluded.planned_duration_minutes,
            note = excluded.note,
            linked_task_ids_json = excluded.linked_task_ids_json,
            block_order = excluded.block_order,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at",
        params![
            normalize_scope_key(scope_key),
            block.id,
            block.date,
            planned_block_type_to_str(&block.block_type),
            block.title,
            block.planned_start_at,
            block.planned_duration_minutes,
            block.note,
            serde_json::to_string(&block.linked_task_ids)?,
            block.order,
            block.created_at,
            block.updated_at,
        ],
    )?;
    Ok(())
}

fn insert_or_replace_window(
    connection: &Connection,
    scope_key: &str,
    window: &SchedulingWindowData,
) -> Result<(), TimeBlockStoreError> {
    connection.execute(
        "INSERT INTO planner_windows (
            scope_key, id, date, title, planned_start_at, planned_end_at, preset_json, segments_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(scope_key, id) DO UPDATE SET
            date = excluded.date,
            title = excluded.title,
            planned_start_at = excluded.planned_start_at,
            planned_end_at = excluded.planned_end_at,
            preset_json = excluded.preset_json,
            segments_json = excluded.segments_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at",
        params![
            normalize_scope_key(scope_key),
            window.id,
            window.date,
            window.title,
            window.planned_start_at,
            window.planned_end_at,
            serde_json::to_string(&window.rhythm_preset)?,
            serde_json::to_string(&window.segments)?,
            window.created_at,
            window.updated_at,
        ],
    )?;
    Ok(())
}

fn planned_block_type_to_str(value: &PlannedTimeBlockType) -> &'static str {
    match value {
        PlannedTimeBlockType::Work => "work",
        PlannedTimeBlockType::Rest => "rest",
    }
}

fn parse_planned_block_type(value: &str) -> Result<PlannedTimeBlockType, rusqlite::Error> {
    match value {
        "work" => Ok(PlannedTimeBlockType::Work),
        "rest" => Ok(PlannedTimeBlockType::Rest),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(format!(
                "invalid planned block type: {other}"
            ))),
        )),
    }
}

fn to_sqlite_conversion_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
