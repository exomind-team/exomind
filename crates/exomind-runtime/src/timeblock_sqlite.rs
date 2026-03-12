use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use crate::timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStoreError};

const ACTIVE_BLOCK_SINGLETON_KEY: &str = "current";

pub struct SqliteTimeBlockStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteTimeBlockStore {
    pub fn open(path: &Path) -> Result<Self, TimeBlockStoreError> {
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

    pub fn list_completed(&self) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, name, start_id, end_id, note, tags_json, start_time, end_time
             FROM completed_timeblocks
             ORDER BY end_time DESC, id DESC",
        )?;

        let rows = statement.query_map([], |row| {
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
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(TimeBlockStoreError::from)
    }

    pub fn replace_completed(&self, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        tx.execute("DELETE FROM completed_timeblocks", [])?;
        for block in blocks {
            tx.execute(
                "INSERT INTO completed_timeblocks (
                    id, name, start_id, end_id, note, tags_json, start_time, end_time
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    block.id,
                    block.name,
                    block.start_id,
                    block.end_id,
                    block.note,
                    serde_json::to_string(&block.tags)?,
                    block.start_time,
                    block.end_time,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_active(&self) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        let connection = self.connection();
        let payload = connection
            .query_row(
                "SELECT payload_json FROM active_timeblock WHERE singleton_key = ?1",
                params![ACTIVE_BLOCK_SINGLETON_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        payload
            .map(|json| serde_json::from_str::<ActiveBlockData>(&json))
            .transpose()
            .map_err(TimeBlockStoreError::from)
    }

    pub fn put_active(&self, block: &ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO active_timeblock (singleton_key, payload_json)
             VALUES (?1, ?2)
             ON CONFLICT(singleton_key) DO UPDATE SET payload_json = excluded.payload_json",
            params![
                ACTIVE_BLOCK_SINGLETON_KEY,
                serde_json::to_string(block)?,
            ],
        )?;
        Ok(())
    }

    pub fn delete_active(&self) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute(
            "DELETE FROM active_timeblock WHERE singleton_key = ?1",
            params![ACTIVE_BLOCK_SINGLETON_KEY],
        )?;
        Ok(())
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        let connection = self.connection();
        let count: i64 = connection.query_row("SELECT COUNT(1) FROM completed_timeblocks", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, TimeBlockStoreError> {
        std::fs::read(&self.path).map_err(TimeBlockStoreError::from)
    }

    fn init(&self) -> Result<(), TimeBlockStoreError> {
        let connection = self.connection();
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS completed_timeblocks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_id TEXT NOT NULL,
                end_id TEXT NOT NULL,
                note TEXT NULL,
                tags_json TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS active_timeblock (
                singleton_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL
             );",
        )?;
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().unwrap()
    }
}

fn to_sqlite_conversion_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}
