use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use crate::timeblock::{
    ActiveBlockData, PlannedTimeBlockData, PlannedTimeBlockType, SchedulingWindowData,
    TimeBlockData, TimeBlockStoreError,
};

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

    // ── Completed blocks (end_time IS NOT NULL) ──────────────────────

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
                    source_planned_block_id, block_type, transitions_json
             FROM timeblocks
             WHERE scope_key = ?1 AND end_time IS NOT NULL
             ORDER BY end_time DESC, id DESC",
        )?;

        let rows =
            statement.query_map(params![normalize_scope_key(scope_key)], map_completed_row)?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn get_completed_scoped(
        &self,
        scope_key: &str,
        block_id: &str,
    ) -> Result<Option<TimeBlockData>, TimeBlockStoreError> {
        if block_id.trim().is_empty() {
            return Ok(None);
        }

        let connection = self.connection();
        connection
            .query_row(
                "SELECT id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        task_ids_json, task_status_outcomes_json, task_association_log_json,
                        source_planned_block_id, block_type, transitions_json
                 FROM timeblocks
                 WHERE scope_key = ?1 AND id = ?2 AND end_time IS NOT NULL",
                params![normalize_scope_key(scope_key), block_id.trim()],
                map_completed_row,
            )
            .optional()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn get_completed_by_start_id_scoped(
        &self,
        scope_key: &str,
        start_id: &str,
    ) -> Result<Option<TimeBlockData>, TimeBlockStoreError> {
        if start_id.trim().is_empty() {
            return Ok(None);
        }

        let connection = self.connection();
        connection
            .query_row(
                "SELECT id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        task_ids_json, task_status_outcomes_json, task_association_log_json,
                        source_planned_block_id, block_type, transitions_json
                 FROM timeblocks
                 WHERE scope_key = ?1 AND start_id = ?2 AND end_time IS NOT NULL
                 ORDER BY end_time DESC, id DESC
                 LIMIT 1",
                params![normalize_scope_key(scope_key), start_id.trim()],
                map_completed_row,
            )
            .optional()
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
            "DELETE FROM timeblocks WHERE scope_key = ?1 AND end_time IS NOT NULL",
            params![normalize_scope_key(scope_key)],
        )?;
        for block in blocks {
            insert_or_replace_completed_block(&tx, scope_key, block)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn put_completed_scoped(
        &self,
        scope_key: &str,
        block: &TimeBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        insert_or_replace_completed_block(&connection, scope_key, block)
    }

    // ── Planned blocks ───────────────────────────────────────────────

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

    // ── Planner windows ──────────────────────────────────────────────

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

    // ── Active block (end_time IS NULL) ──────────────────────────────

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
                "SELECT payload_json FROM timeblocks WHERE scope_key = ?1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1",
                params![normalize_scope_key(scope_key)],
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
        let normalized = block.clone().normalize_task_ids();
        let payload_json = serde_json::to_string(&normalized)?;
        let connection = self.connection();
        // Use start_id as the row id for the active block
        connection.execute(
            "INSERT INTO timeblocks (
                scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                task_ids_json, task_status_outcomes_json, task_association_log_json,
                source_planned_block_id, block_type, transitions_json, payload_json
            ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, '[]', ?5, NULL, ?6, NULL, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(scope_key, id) DO UPDATE SET
                name = excluded.name,
                start_id = excluded.start_id,
                tags_json = excluded.tags_json,
                start_time = excluded.start_time,
                task_ids_json = excluded.task_ids_json,
                task_association_log_json = excluded.task_association_log_json,
                source_planned_block_id = excluded.source_planned_block_id,
                block_type = excluded.block_type,
                transitions_json = excluded.transitions_json,
                payload_json = excluded.payload_json",
            params![
                normalize_scope_key(scope_key),
                normalized.start_id,
                normalized.name,
                normalized.start_id,
                normalized.start_time,
                serde_json::to_string(&normalized.task_ids)?,
                serde_json::to_string(&normalized.task_association_log)?,
                normalized.source_planned_block_id,
                normalized.block_type.as_deref().unwrap_or("active"),
                serde_json::to_string(&normalized.transitions)?,
                payload_json,
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
            "DELETE FROM timeblocks WHERE scope_key = ?1 AND end_time IS NULL",
            params![normalize_scope_key(scope_key)],
        )?;
        Ok(())
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn len_completed_scoped(&self, scope_key: &str) -> Result<usize, TimeBlockStoreError> {
        let connection = self.connection();
        let count: i64 = connection.query_row(
            "SELECT COUNT(1) FROM timeblocks WHERE scope_key = ?1 AND end_time IS NOT NULL",
            params![normalize_scope_key(scope_key)],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, TimeBlockStoreError> {
        let exomind_temp = std::env::temp_dir().join("exomind");
        let _ = std::fs::create_dir_all(&exomind_temp);
        let temp_dir = tempfile::Builder::new()
            .prefix("timeblocks-snapshot-")
            .tempdir_in(&exomind_temp)?;
        let snapshot_path = temp_dir.path().join("timeblocks-snapshot.sqlite");
        let escaped_snapshot_path = snapshot_path.to_string_lossy().replace('\'', "''");

        {
            let connection = self.connection();
            connection.execute_batch(&format!("VACUUM INTO '{}';", escaped_snapshot_path))?;
        }

        let bytes = std::fs::read(&snapshot_path)?;
        if let Err(e) = temp_dir.close() {
            tracing::warn!(error = %e, "failed to clean exomind temp dir");
        }
        Ok(bytes)
    }

    fn init(&self) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();

        // Enable WAL mode first
        connection.execute_batch("PRAGMA journal_mode = WAL;")?;

        // ── Step 1: Create the unified timeblocks table ──────────────
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS timeblocks (
                scope_key                  TEXT    NOT NULL,
                id                         TEXT    NOT NULL,
                name                       TEXT    NOT NULL,
                start_id                   TEXT    NOT NULL,
                end_id                     TEXT    NULL,
                note                       TEXT    NULL,
                tags_json                  TEXT    NOT NULL DEFAULT '[]',
                start_time                 INTEGER NOT NULL,
                end_time                   INTEGER NULL,
                block_type                 TEXT    NULL DEFAULT 'active',
                transitions_json           TEXT    NOT NULL DEFAULT '[]',
                task_ids_json              TEXT    NOT NULL DEFAULT '[]',
                task_status_outcomes_json  TEXT    NULL,
                task_association_log_json  TEXT    NOT NULL DEFAULT '[]',
                source_planned_block_id    TEXT    NULL,
                payload_json               TEXT    NULL,
                PRIMARY KEY (scope_key, id)
            );
            CREATE INDEX IF NOT EXISTS idx_timeblocks_completed_scope_end
                ON timeblocks(scope_key, end_time DESC, id DESC)
                WHERE end_time IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_timeblocks_completed_scope_start_id
                ON timeblocks(scope_key, start_id)
                WHERE end_time IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_timeblocks_active_scope_start_time
                ON timeblocks(scope_key, start_time DESC)
                WHERE end_time IS NULL;",
        )?;

        // ── Step 2: Migrate data from legacy tables ──────────────────

        let has_old_completed: bool = connection.query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'completed_timeblocks'",
            [],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        )?;

        if has_old_completed {
            // First apply any pending column migrations on the old table
            let columns = table_columns(&connection, "completed_timeblocks")?;
            if columns.iter().any(|c| c == "scope_key") {
                // Old table has scope_key — migrate column-compatible rows
                // Build the column list dynamically based on what exists
                let has_task_ids = columns.iter().any(|c| c == "task_ids_json");
                let has_outcomes = columns.iter().any(|c| c == "task_status_outcomes_json");
                let has_assoc_log = columns.iter().any(|c| c == "task_association_log_json");
                let has_source = columns.iter().any(|c| c == "source_planned_block_id");
                let has_block_type = columns.iter().any(|c| c == "block_type");
                let has_transitions = columns.iter().any(|c| c == "transitions_json");

                let select_task_ids = if has_task_ids {
                    "task_ids_json"
                } else {
                    "'[]'"
                };
                let select_outcomes = if has_outcomes {
                    "task_status_outcomes_json"
                } else {
                    "NULL"
                };
                let select_assoc = if has_assoc_log {
                    "task_association_log_json"
                } else {
                    "'[]'"
                };
                let select_source = if has_source {
                    "source_planned_block_id"
                } else {
                    "NULL"
                };
                let select_block_type = if has_block_type {
                    "block_type"
                } else {
                    "'active'"
                };
                let select_transitions = if has_transitions {
                    "transitions_json"
                } else {
                    "'[]'"
                };

                let sql = format!(
                    "INSERT OR IGNORE INTO timeblocks (
                        scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        task_ids_json, task_status_outcomes_json, task_association_log_json,
                        source_planned_block_id, block_type, transitions_json
                    )
                    SELECT
                        scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                        {select_task_ids}, {select_outcomes}, {select_assoc},
                        {select_source}, {select_block_type}, {select_transitions}
                    FROM completed_timeblocks"
                );
                connection.execute_batch(&sql)?;
            } else {
                // Very old table without scope_key — migrate with 'anonymous' scope
                connection.execute_batch(
                    "INSERT OR IGNORE INTO timeblocks (
                        scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time
                    )
                    SELECT
                        'anonymous', id, name, start_id, end_id, note, tags_json, start_time, end_time
                    FROM completed_timeblocks"
                )?;
            }
            connection.execute_batch("DROP TABLE completed_timeblocks;")?;
        }

        let has_old_active: bool = connection.query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'active_timeblock'",
            [],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        )?;

        if has_old_active {
            // Migrate active block(s) from the JSON-blob table
            let active_columns = table_columns(&connection, "active_timeblock")?;
            let has_scope = active_columns.iter().any(|c| c == "scope_key");

            let mut stmt = if has_scope {
                connection.prepare("SELECT scope_key, payload_json FROM active_timeblock")?
            } else {
                connection.prepare(
                    "SELECT 'anonymous' AS scope_key, payload_json FROM active_timeblock",
                )?
            };

            let rows: Vec<(String, String)> = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            for (scope_key, payload_json) in &rows {
                if let Ok(active) = serde_json::from_str::<ActiveBlockData>(payload_json) {
                    let normalized = active.normalize_task_ids();
                    connection.execute(
                        "INSERT OR IGNORE INTO timeblocks (
                            scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
                            task_ids_json, task_status_outcomes_json, task_association_log_json,
                            source_planned_block_id, block_type, transitions_json, payload_json
                        ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, '[]', ?5, NULL, ?6, NULL, ?7, ?8, ?9, ?10, ?11)",
                        params![
                            normalize_scope_key(scope_key),
                            normalized.start_id,
                            normalized.name,
                            normalized.start_id,
                            normalized.start_time,
                            serde_json::to_string(&normalized.task_ids).unwrap_or_else(|_| "[]".to_string()),
                            serde_json::to_string(&normalized.task_association_log).unwrap_or_else(|_| "[]".to_string()),
                            normalized.source_planned_block_id,
                            normalized.block_type.as_deref().unwrap_or("active"),
                            serde_json::to_string(&normalized.transitions).unwrap_or_else(|_| "[]".to_string()),
                            payload_json,
                        ],
                    )?;
                }
            }

            connection.execute_batch("DROP TABLE active_timeblock;")?;
        }

        // ── Step 3: Ensure payload_json column exists (for databases
        //    that already have the timeblocks table from an older build) ──
        let tb_columns = table_columns(&connection, "timeblocks")?;
        if !tb_columns.iter().any(|c| c == "payload_json") {
            connection.execute(
                "ALTER TABLE timeblocks ADD COLUMN payload_json TEXT NULL",
                [],
            )?;
        }

        // ── Step 4: Create other tables ──────────────────────────────
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS planned_timeblocks (
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

fn table_columns(
    connection: &Connection,
    table_name: &str,
) -> Result<Vec<String>, TimeBlockStoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({})", table_name))?;
    statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(TimeBlockStoreError::from)
}

fn map_completed_row(row: &rusqlite::Row<'_>) -> Result<TimeBlockData, rusqlite::Error> {
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
        block_type: row.get(12)?,
        transitions: row
            .get::<_, Option<String>>(13)?
            .map(|value| serde_json::from_str(&value).unwrap_or_default())
            .unwrap_or_default(),
    })
}

fn insert_or_replace_completed_block(
    connection: &Connection,
    scope_key: &str,
    block: &TimeBlockData,
) -> Result<(), TimeBlockStoreError> {
    connection.execute(
        "INSERT INTO timeblocks (
            scope_key, id, name, start_id, end_id, note, tags_json, start_time, end_time,
            task_ids_json, task_status_outcomes_json, task_association_log_json,
            source_planned_block_id, block_type, transitions_json, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL)
         ON CONFLICT(scope_key, id) DO UPDATE SET
            name = excluded.name,
            start_id = excluded.start_id,
            end_id = excluded.end_id,
            note = excluded.note,
            tags_json = excluded.tags_json,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            task_ids_json = excluded.task_ids_json,
            task_status_outcomes_json = excluded.task_status_outcomes_json,
            task_association_log_json = excluded.task_association_log_json,
            source_planned_block_id = excluded.source_planned_block_id,
            block_type = excluded.block_type,
            transitions_json = excluded.transitions_json,
            payload_json = excluded.payload_json",
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
            block.block_type.as_deref(),
            serde_json::to_string(&block.transitions)?,
        ],
    )?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::SqliteTimeBlockStore;
    use crate::timeblock::TimeBlockData;

    fn sample_completed_block(id: &str, end_time: u64) -> TimeBlockData {
        TimeBlockData {
            id: id.to_string(),
            name: format!("block-{id}"),
            start_id: id.to_string(),
            end_id: format!("end-{id}"),
            note: None,
            tags: vec!["focus".to_string()],
            start_time: end_time.saturating_sub(100),
            end_time,
            task_ids: vec![],
            task_status_outcomes: None,
            task_association_log: vec![],
            source_planned_block_id: None,
            block_type: Some("active".to_string()),
            transitions: vec![],
        }
    }

    #[test]
    fn put_completed_scoped_updates_single_block_without_clearing_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks.sqlite");
        let store = SqliteTimeBlockStore::open(&sqlite_path).unwrap();

        let existing = sample_completed_block("tb-existing", 200);
        let updating = sample_completed_block("tb-upsert", 400);
        store
            .replace_completed_scoped("profile-argon", &[existing.clone(), updating.clone()])
            .unwrap();

        store
            .put_completed_scoped(
                "profile-argon",
                &TimeBlockData {
                    name: "updated".to_string(),
                    note: Some("patched".to_string()),
                    end_time: 450,
                    ..updating
                },
            )
            .unwrap();

        let blocks = store.list_completed_scoped("profile-argon").unwrap();
        assert_eq!(blocks.len(), 2);
        assert!(blocks.iter().any(|block| block.id == existing.id));
        let updated = blocks
            .into_iter()
            .find(|block| block.id == "tb-upsert")
            .expect("updated block should exist");
        assert_eq!(updated.name, "updated");
        assert_eq!(updated.note.as_deref(), Some("patched"));
        assert_eq!(updated.end_time, 450);
    }

    #[test]
    fn get_completed_by_start_id_scoped_reads_single_completed_block() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks.sqlite");
        let store = SqliteTimeBlockStore::open(&sqlite_path).unwrap();

        store
            .put_completed_scoped("profile-argon", &sample_completed_block("tb-find", 300))
            .unwrap();

        let found = store
            .get_completed_by_start_id_scoped("profile-argon", "tb-find")
            .unwrap()
            .expect("block should be found by start_id");
        assert_eq!(found.id, "tb-find");
        assert_eq!(
            store
                .get_completed_by_start_id_scoped("profile-argon", "missing")
                .unwrap(),
            None
        );
    }
}
