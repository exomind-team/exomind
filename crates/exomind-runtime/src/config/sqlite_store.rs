use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use super::store::ConfigStoreError;
use super::types::{ConfigEntry, PutConfigEntryInput};

pub struct SqliteConfigStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteConfigStore {
    pub fn open(path: &Path) -> Result<Self, ConfigStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
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

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .expect("config store connection lock poisoned")
    }

    fn init(&self) -> Result<(), ConfigStoreError> {
        let conn = self.connection();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS runtime_config_entries (
                scope         TEXT NOT NULL,
                entry_key     TEXT NOT NULL,
                value         TEXT NOT NULL,
                sensitive     INTEGER NOT NULL DEFAULT 0,
                updated_at    TEXT NOT NULL,
                source        TEXT,
                source_origin TEXT,
                PRIMARY KEY (scope, entry_key)
            );

            CREATE INDEX IF NOT EXISTS idx_runtime_config_scope
                ON runtime_config_entries(scope);
            CREATE INDEX IF NOT EXISTS idx_runtime_config_scope_key
                ON runtime_config_entries(scope, entry_key);",
        )?;
        Ok(())
    }

    pub fn put(&self, input: PutConfigEntryInput) -> Result<ConfigEntry, ConfigStoreError> {
        let updated_at = chrono::Utc::now().to_rfc3339();
        let entry = ConfigEntry {
            scope: input.scope,
            key: input.key,
            value: input.value,
            sensitive: input.sensitive,
            updated_at,
            source: input.source,
            source_origin: input.source_origin,
        };

        let conn = self.connection();
        conn.execute(
            "INSERT INTO runtime_config_entries (
                scope, entry_key, value, sensitive, updated_at, source, source_origin
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(scope, entry_key) DO UPDATE SET
                value = excluded.value,
                sensitive = excluded.sensitive,
                updated_at = excluded.updated_at,
                source = excluded.source,
                source_origin = excluded.source_origin",
            params![
                entry.scope,
                entry.key,
                entry.value,
                i64::from(entry.sensitive),
                entry.updated_at,
                entry.source,
                entry.source_origin,
            ],
        )?;

        Ok(entry)
    }

    pub fn get(&self, scope: &str, key: &str) -> Result<Option<ConfigEntry>, ConfigStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT scope, entry_key, value, sensitive, updated_at, source, source_origin
             FROM runtime_config_entries
             WHERE scope = ?1 AND entry_key = ?2",
        )?;

        stmt.query_row(params![scope, key], map_config_row)
            .optional()
            .map_err(ConfigStoreError::from)
    }

    pub fn list(
        &self,
        scope: Option<&str>,
        prefix: Option<&str>,
    ) -> Result<Vec<ConfigEntry>, ConfigStoreError> {
        let conn = self.connection();
        let prefix_like = prefix.map(|value| format!("{value}%"));
        let mut stmt = conn.prepare(
            "SELECT scope, entry_key, value, sensitive, updated_at, source, source_origin
             FROM runtime_config_entries
             WHERE (?1 IS NULL OR scope = ?1)
               AND (?2 IS NULL OR entry_key LIKE ?2)
             ORDER BY scope ASC, entry_key ASC",
        )?;
        let rows = stmt.query_map(params![scope, prefix_like], map_config_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ConfigStoreError::from)
    }

    pub fn delete(&self, scope: &str, key: &str) -> Result<Option<ConfigEntry>, ConfigStoreError> {
        let existing = self.get(scope, key)?;
        if existing.is_none() {
            return Ok(None);
        }

        let conn = self.connection();
        conn.execute(
            "DELETE FROM runtime_config_entries WHERE scope = ?1 AND entry_key = ?2",
            params![scope, key],
        )?;
        Ok(existing)
    }
}

fn map_config_row(row: &rusqlite::Row<'_>) -> Result<ConfigEntry, rusqlite::Error> {
    Ok(ConfigEntry {
        scope: row.get(0)?,
        key: row.get(1)?,
        value: row.get(2)?,
        sensitive: row.get::<_, i64>(3)? != 0,
        updated_at: row.get(4)?,
        source: row.get(5)?,
        source_origin: row.get(6)?,
    })
}
