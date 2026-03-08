use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::types::{DeliveryRecord, DeliveryStatus, SignalRoute, TargetType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalPoolSnapshot {
    pub routes: Vec<SignalRoute>,
    pub journal: Vec<DeliveryRecord>,
}

#[derive(Debug, Error)]
pub enum SignalStoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid target type: {value}")]
    InvalidTargetType { value: String },
    #[error("invalid delivery status: {value}")]
    InvalidDeliveryStatus { value: String },
}

pub struct SqliteSignalStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteSignalStore {
    pub fn open(path: &Path) -> Result<Self, SignalStoreError> {
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

    pub fn load_routes(&self) -> Result<Vec<SignalRoute>, SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut statement = connection.prepare(
            "SELECT id, enabled, topic, target_type, target_ref, created_at, updated_at
             FROM signal_routes
             ORDER BY rowid ASC",
        )?;
        let rows = statement.query_map([], |row| {
            let target_type: String = row.get(3)?;
            Ok(SignalRoute {
                id: row.get(0)?,
                enabled: row.get::<_, i64>(1)? != 0,
                topic: row.get(2)?,
                target_type: parse_target_type(&target_type).map_err(map_target_type_error)?,
                target_ref: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(SignalStoreError::from)
    }

    pub fn replace_routes(&self, routes: &[SignalRoute]) -> Result<(), SignalStoreError> {
        let mut connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let tx = connection.transaction()?;
        tx.execute("DELETE FROM signal_routes", [])?;
        for route in routes {
            tx.execute(
                "INSERT INTO signal_routes
                 (id, enabled, topic, target_type, target_ref, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    route.id,
                    if route.enabled { 1 } else { 0 },
                    route.topic,
                    target_type_to_db(&route.target_type),
                    route.target_ref,
                    route.created_at,
                    route.updated_at,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn has_routes(&self) -> Result<bool, SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let count: i64 =
            connection.query_row("SELECT COUNT(1) FROM signal_routes", [], |row| row.get(0))?;
        Ok(count > 0)
    }

    pub fn append_journal(&self, record: &DeliveryRecord) -> Result<(), SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        connection.execute(
            "INSERT INTO signal_journal
             (event_id, route_id, target_ref, status, reason, started_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.event_id,
                record.route_id,
                record.target_ref,
                delivery_status_to_db(&record.status),
                record.reason,
                record.started_at,
                record.finished_at,
            ],
        )?;
        Ok(())
    }

    pub fn load_recent_journal(
        &self,
        limit: usize,
    ) -> Result<Vec<DeliveryRecord>, SignalStoreError> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut statement = connection.prepare(
            "SELECT event_id, route_id, target_ref, status, reason, started_at, finished_at
             FROM signal_journal
             ORDER BY seq DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], |row| {
            let status: String = row.get(3)?;
            Ok(DeliveryRecord {
                event_id: row.get(0)?,
                route_id: row.get(1)?,
                target_ref: row.get(2)?,
                status: parse_delivery_status(&status).map_err(map_delivery_status_error)?,
                reason: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
            })
        })?;

        let mut collected = rows.collect::<Result<Vec<_>, _>>()?;
        collected.reverse();
        Ok(collected)
    }

    pub fn load_all_journal(&self) -> Result<Vec<DeliveryRecord>, SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut statement = connection.prepare(
            "SELECT event_id, route_id, target_ref, status, reason, started_at, finished_at
             FROM signal_journal
             ORDER BY seq ASC",
        )?;
        let rows = statement.query_map([], |row| {
            let status: String = row.get(3)?;
            Ok(DeliveryRecord {
                event_id: row.get(0)?,
                route_id: row.get(1)?,
                target_ref: row.get(2)?,
                status: parse_delivery_status(&status).map_err(map_delivery_status_error)?,
                reason: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(SignalStoreError::from)
    }

    pub fn replace_journal(&self, records: &[DeliveryRecord]) -> Result<(), SignalStoreError> {
        let mut connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let tx = connection.transaction()?;
        tx.execute("DELETE FROM signal_journal", [])?;
        for record in records {
            tx.execute(
                "INSERT INTO signal_journal
                 (event_id, route_id, target_ref, status, reason, started_at, finished_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    record.event_id,
                    record.route_id,
                    record.target_ref,
                    delivery_status_to_db(&record.status),
                    record.reason,
                    record.started_at,
                    record.finished_at,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn export_snapshot(&self) -> Result<SignalPoolSnapshot, SignalStoreError> {
        Ok(SignalPoolSnapshot {
            routes: self.load_routes()?,
            journal: self.load_all_journal()?,
        })
    }

    pub fn import_snapshot(&self, snapshot: &SignalPoolSnapshot) -> Result<(), SignalStoreError> {
        self.replace_routes(&snapshot.routes)?;
        self.replace_journal(&snapshot.journal)?;
        Ok(())
    }

    pub fn import_legacy_routes_if_needed(
        &self,
        legacy_path: &Path,
    ) -> Result<(), SignalStoreError> {
        if self.has_routes()? || self.meta_flag("legacy_routes_imported")? || !legacy_path.is_file()
        {
            return Ok(());
        }

        let data = std::fs::read_to_string(legacy_path)?;
        let routes = match serde_json::from_str::<Vec<SignalRoute>>(&data) {
            Ok(routes) => routes,
            Err(_) => return Ok(()),
        };

        self.replace_routes(&routes)?;
        self.set_meta_flag("legacy_routes_imported", true)?;
        Ok(())
    }

    fn init(&self) -> Result<(), SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS signal_routes (
                id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL,
                topic TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_ref TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signal_journal (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                route_id TEXT NOT NULL,
                target_ref TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signal_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    fn meta_flag(&self, key: &str) -> Result<bool, SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let value = connection
            .query_row(
                "SELECT value FROM signal_meta WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(matches!(value.as_deref(), Some("true")))
    }

    fn set_meta_flag(&self, key: &str, value: bool) -> Result<(), SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        connection.execute(
            "INSERT INTO signal_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, if value { "true" } else { "false" }],
        )?;
        Ok(())
    }
}

fn target_type_to_db(target_type: &TargetType) -> &'static str {
    match target_type {
        TargetType::Actor => "actor",
        TargetType::Agent => "agent",
        TargetType::Frontend => "frontend",
        TargetType::Remote => "remote",
    }
}

fn parse_target_type(value: &str) -> Result<TargetType, SignalStoreError> {
    match value {
        "actor" => Ok(TargetType::Actor),
        "agent" => Ok(TargetType::Agent),
        "frontend" => Ok(TargetType::Frontend),
        "remote" => Ok(TargetType::Remote),
        _ => Err(SignalStoreError::InvalidTargetType {
            value: value.to_string(),
        }),
    }
}

fn delivery_status_to_db(status: &DeliveryStatus) -> &'static str {
    match status {
        DeliveryStatus::Sent => "sent",
        DeliveryStatus::Failed => "failed",
        DeliveryStatus::Skipped => "skipped",
    }
}

fn parse_delivery_status(value: &str) -> Result<DeliveryStatus, SignalStoreError> {
    match value {
        "sent" => Ok(DeliveryStatus::Sent),
        "failed" => Ok(DeliveryStatus::Failed),
        "skipped" => Ok(DeliveryStatus::Skipped),
        _ => Err(SignalStoreError::InvalidDeliveryStatus {
            value: value.to_string(),
        }),
    }
}

fn map_target_type_error(error: SignalStoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn map_delivery_status_error(error: SignalStoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
