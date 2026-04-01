use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use super::store::ReminderStoreError;
use super::types::{CreateReminderInput, Reminder, ReminderStatus, UpdateReminderInput};

pub struct SqliteReminderStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteReminderStore {
    pub fn open(path: &Path) -> Result<Self, ReminderStoreError> {
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
            .expect("reminder store connection lock poisoned")
    }

    fn init(&self) -> Result<(), ReminderStoreError> {
        let conn = self.connection();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS reminders (
                scope_key     TEXT NOT NULL,
                id            TEXT NOT NULL,
                title         TEXT NOT NULL,
                content       TEXT NOT NULL,
                due_at        INTEGER NOT NULL,
                status        TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL,
                completed_at  INTEGER,
                PRIMARY KEY (scope_key, id)
            );
            CREATE INDEX IF NOT EXISTS idx_reminders_scope_due_at
                ON reminders(scope_key, due_at);
            CREATE INDEX IF NOT EXISTS idx_reminders_scope_status
                ON reminders(scope_key, status, due_at);",
        )?;
        Ok(())
    }

    pub fn list_scoped(
        &self,
        scope_key: &str,
        status: Option<ReminderStatus>,
    ) -> Result<Vec<Reminder>, ReminderStoreError> {
        let conn = self.connection();
        let status_filter = status.map(status_to_str);
        let mut stmt = conn.prepare(
            "SELECT id, title, content, due_at, status, created_at, updated_at, completed_at
             FROM reminders
             WHERE scope_key = ?1
               AND (?2 IS NULL OR status = ?2)
             ORDER BY due_at ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![scope_key, status_filter], map_reminder_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ReminderStoreError::from)
    }

    pub fn get_scoped(
        &self,
        scope_key: &str,
        id: &str,
    ) -> Result<Option<Reminder>, ReminderStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, title, content, due_at, status, created_at, updated_at, completed_at
             FROM reminders
             WHERE scope_key = ?1 AND id = ?2",
        )?;
        stmt.query_row(params![scope_key, id], map_reminder_row)
            .optional()
            .map_err(ReminderStoreError::from)
    }

    pub fn create_scoped(
        &self,
        scope_key: &str,
        input: CreateReminderInput,
    ) -> Result<Reminder, ReminderStoreError> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let reminder = Reminder {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            content: input.content,
            due_at: input.due_at,
            status: ReminderStatus::Pending,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        self.upsert_scoped(scope_key, &reminder)?;
        Ok(reminder)
    }

    pub fn update_scoped(
        &self,
        scope_key: &str,
        id: &str,
        input: UpdateReminderInput,
    ) -> Result<Option<Reminder>, ReminderStoreError> {
        let existing = self.get_scoped(scope_key, id)?;
        let Some(mut reminder) = existing else {
            return Ok(None);
        };

        if let Some(title) = input.title {
            reminder.title = title;
        }
        if let Some(content) = input.content {
            reminder.content = content;
        }
        if let Some(due_at) = input.due_at {
            reminder.due_at = due_at;
        }
        reminder.updated_at = chrono::Utc::now().timestamp_millis() as u64;
        self.upsert_scoped(scope_key, &reminder)?;
        Ok(Some(reminder))
    }

    pub fn transition_scoped(
        &self,
        scope_key: &str,
        id: &str,
        to: ReminderStatus,
        at: u64,
    ) -> Result<Option<Reminder>, ReminderStoreError> {
        let existing = self.get_scoped(scope_key, id)?;
        let Some(mut reminder) = existing else {
            return Ok(None);
        };

        if !reminder.status.can_transition_to(to) && reminder.status != to {
            return Err(ReminderStoreError::InvalidTransition {
                from: reminder.status,
                to,
            });
        }

        reminder.status = to;
        reminder.updated_at = at;
        if to == ReminderStatus::Completed {
            reminder.completed_at = Some(at);
        }
        self.upsert_scoped(scope_key, &reminder)?;
        Ok(Some(reminder))
    }

    pub fn upsert_scoped(
        &self,
        scope_key: &str,
        reminder: &Reminder,
    ) -> Result<(), ReminderStoreError> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO reminders (
                scope_key, id, title, content, due_at, status, created_at, updated_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(scope_key, id) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                due_at = excluded.due_at,
                status = excluded.status,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                completed_at = excluded.completed_at",
            params![
                scope_key,
                reminder.id,
                reminder.title,
                reminder.content,
                reminder.due_at,
                status_to_str(reminder.status),
                reminder.created_at,
                reminder.updated_at,
                reminder.completed_at,
            ],
        )?;
        Ok(())
    }
}

fn status_to_str(status: ReminderStatus) -> &'static str {
    match status {
        ReminderStatus::Pending => "pending",
        ReminderStatus::Triggered => "triggered",
        ReminderStatus::Completed => "completed",
    }
}

fn parse_status(raw: String) -> Result<ReminderStatus, ReminderStoreError> {
    match raw.as_str() {
        "pending" => Ok(ReminderStatus::Pending),
        "triggered" => Ok(ReminderStatus::Triggered),
        "completed" => Ok(ReminderStatus::Completed),
        _ => Err(ReminderStoreError::InvalidStoredStatus(raw)),
    }
}

fn map_reminder_row(row: &rusqlite::Row<'_>) -> Result<Reminder, rusqlite::Error> {
    let status_raw: String = row.get(4)?;
    let status = parse_status(status_raw)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(error),
        ))?;

    Ok(Reminder {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        due_at: row.get(3)?,
        status,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        completed_at: row.get(7)?,
    })
}
