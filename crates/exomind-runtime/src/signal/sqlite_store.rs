use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::types::{DeliveryRecord, DeliveryStatus, SignalRoute, TargetType};

/// 信号 journal 在 SQLite 中保留的最大行数。内存环形缓冲只保留 1000 条
/// (见 `journal.rs` 的 `DEFAULT_CAPACITY`);持久层保留更多以便排障,但**必须有
/// 上限**,否则只增不删无限膨胀(issue #959 实测涨到 ~100 万行 / 177MB)。
const JOURNAL_RETENTION_ROWS: i64 = 10_000;

/// 每追加多少条触发一次增量裁剪。把 `DELETE` 成本摊薄,避免在每条 `INSERT` 后
/// 都再删一次(那等于又加一倍写)。
const PRUNE_EVERY_N_APPENDS: u64 = 512;

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
    /// 自上次裁剪以来的追加计数,达到 `PRUNE_EVERY_N_APPENDS` 触发一次增量裁剪。
    appends_since_prune: AtomicU64,
}

impl SqliteSignalStore {
    pub fn open(path: &Path) -> Result<Self, SignalStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        crate::sqlite_util::configure_connection(&connection)?;
        let store = Self {
            path: path.to_path_buf(),
            connection: Mutex::new(connection),
            appends_since_prune: AtomicU64::new(0),
        };
        store.init()?;
        // 启动时一次性把历史膨胀裁剪到保留上限并回收磁盘空间。
        store.prune_on_open()?;
        Ok(store)
    }

    /// 把 `signal_journal` 裁剪到只保留最近 `JOURNAL_RETENTION_ROWS` 行。
    /// `seq` 为单调自增主键,删掉低于 `MAX(seq) - 保留行数` 的旧行;表为空或行数
    /// 不足时 `MAX(seq)` 为 NULL / 阈值为负,删 0 行。返回删除的行数。
    fn prune_journal(connection: &Connection) -> Result<usize, SignalStoreError> {
        let deleted = connection.execute(
            "DELETE FROM signal_journal
             WHERE seq <= (SELECT MAX(seq) FROM signal_journal) - ?1",
            params![JOURNAL_RETENTION_ROWS],
        )?;
        Ok(deleted)
    }

    /// 启动时裁剪;若删除了大量历史行,跑一次 `VACUUM` 把物理文件缩回去
    /// (issue #959 现网已膨胀到 177MB,DELETE 不会自动还盘,需 VACUUM 回收)。
    /// best-effort:裁剪/回收失败(如库只读)不应让 `open()` 失败,记日志后继续。
    fn prune_on_open(&self) -> Result<(), SignalStoreError> {
        let connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        match Self::prune_journal(&connection) {
            Ok(deleted) if deleted > 0 => {
                // VACUUM 不能在事务中执行;此处为 autocommit,安全。
                if let Err(error) = connection.execute_batch("VACUUM;") {
                    tracing::warn!(
                        error = %error,
                        "signal journal VACUUM failed after prune (裁剪后回收磁盘失败)"
                    );
                }
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "signal journal prune-on-open skipped (启动裁剪跳过,可能库只读)"
                );
            }
        }
        Ok(())
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
        replace_routes_in_tx(&tx, routes)?;
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

        // 每 PRUNE_EVERY_N_APPENDS 条做一次增量裁剪,把表行数稳定在保留上限内,
        // 否则只增不删会无限膨胀(issue #959)。
        if self.appends_since_prune.fetch_add(1, Ordering::Relaxed) + 1 >= PRUNE_EVERY_N_APPENDS {
            self.appends_since_prune.store(0, Ordering::Relaxed);
            Self::prune_journal(&connection)?;
        }
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
        replace_journal_in_tx(&tx, records)?;
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
        let mut connection = match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let tx = connection.transaction()?;
        replace_routes_in_tx(&tx, &snapshot.routes)?;
        replace_journal_in_tx(&tx, &snapshot.journal)?;
        tx.commit()?;
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

fn replace_routes_in_tx(
    tx: &Transaction<'_>,
    routes: &[SignalRoute],
) -> Result<(), rusqlite::Error> {
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
    Ok(())
}

fn replace_journal_in_tx(
    tx: &Transaction<'_>,
    records: &[DeliveryRecord],
) -> Result<(), rusqlite::Error> {
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("exomind-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir.join("signal-pool.sqlite")
    }

    fn make_record(n: usize) -> DeliveryRecord {
        DeliveryRecord {
            event_id: format!("evt-{n}"),
            route_id: "route-1".to_string(),
            target_ref: "target-1".to_string(),
            status: DeliveryStatus::Sent,
            reason: None,
            started_at: "2026-01-01T00:00:00Z".to_string(),
            finished_at: "2026-01-01T00:00:01Z".to_string(),
        }
    }

    fn row_count(store: &SqliteSignalStore) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row("SELECT COUNT(1) FROM signal_journal", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn append_prunes_journal_to_retention_bound() {
        let path = temp_db_path("signal-retention");
        let store = SqliteSignalStore::open(&path).unwrap();

        // 追加远超保留上限的记录,验证表行数被增量裁剪稳定在上限附近,
        // 不会无限增长(issue #959 回归)。
        let total = (JOURNAL_RETENTION_ROWS as usize) + (PRUNE_EVERY_N_APPENDS as usize) * 4;
        for n in 0..total {
            store.append_journal(&make_record(n)).unwrap();
        }

        let count = row_count(&store);
        // 裁剪发生在每 PRUNE_EVERY_N_APPENDS 条之后,故上界为
        // 保留行数 + 一个裁剪周期内可能积压的行数。
        let upper_bound = JOURNAL_RETENTION_ROWS + PRUNE_EVERY_N_APPENDS as i64;
        assert!(
            count <= upper_bound,
            "journal row count {count} should stay within {upper_bound}"
        );
        // 仍应保留至少接近上限的历史,而不是被清空。
        assert!(count >= JOURNAL_RETENTION_ROWS - PRUNE_EVERY_N_APPENDS as i64);

        // 最新记录必须仍在,裁剪只删旧的(seq 小的)。
        let recent = store.load_recent_journal(1).unwrap();
        assert_eq!(
            recent.last().unwrap().event_id,
            format!("evt-{}", total - 1)
        );
    }

    #[test]
    fn reopen_prunes_preexisting_bloat() {
        let path = temp_db_path("signal-reopen-prune");
        {
            // 用原始 INSERT 直接灌入超量历史(不走 append 的增量裁剪),
            // 模拟现网已膨胀的库。
            let store = SqliteSignalStore::open(&path).unwrap();
            let connection = store.connection.lock().unwrap();
            for n in 0..(JOURNAL_RETENTION_ROWS as usize + 5_000) {
                connection
                    .execute(
                        "INSERT INTO signal_journal
                         (event_id, route_id, target_ref, status, reason, started_at, finished_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![
                            format!("evt-{n}"),
                            "route-1",
                            "target-1",
                            "sent",
                            Option::<String>::None,
                            "2026-01-01T00:00:00Z",
                            "2026-01-01T00:00:01Z",
                        ],
                    )
                    .unwrap();
            }
        }

        // 重新打开应触发一次性裁剪,把历史膨胀压回保留上限。
        let store = SqliteSignalStore::open(&path).unwrap();
        assert!(row_count(&store) <= JOURNAL_RETENTION_ROWS);
    }
}
