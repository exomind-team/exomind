//! Device-local, profile-scoped summary credentials. This store is deliberately
//! outside Core/replication and failure here must not prevent recording.
use crate::{
    BetaHost, HostError, Session, model_provider::SummaryProviderSettings, resources, storage,
};
use exomind_core::{DeviceId, ProfileId};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, TransactionBehavior, limits::Limit, params,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::Duration,
};
use uuid::Uuid;

pub(crate) const DATABASE: &str = "summary-models.sqlite3";
pub(crate) const JOURNAL: &str = "summary-models.sqlite3-journal";
pub(crate) const INITIALIZED: &str = "summary-models.initialized";
const APPLICATION: i64 = 0x45584d43;
const LAYOUT: &str = "exomind-summary-model-config/1";
const MAX_JSON: usize = 32768;
const TABLES: [(&str, &str); 2] = [
    (
        "model_layout",
        "CREATE TABLE model_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,device_id TEXT NOT NULL)",
    ),
    (
        "model_configuration",
        "CREATE TABLE model_configuration(profile_id TEXT PRIMARY KEY,revision TEXT NOT NULL UNIQUE,command_digest TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),settings TEXT NOT NULL)",
    ),
];

/// No secret is returned in this status DTO, including on the owner endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct SummaryModelConfiguration {
    pub profile_id: ProfileId,
    pub revision: Option<Uuid>,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    pub include_suggestions: bool,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SummaryModelSecretUpdate {
    #[default]
    Keep,
    Clear,
    Set {
        value: String,
    },
}
// Not Debug: command input can carry a newly entered credential.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryModelConfigurationCommand {
    pub command_id: Uuid,
    pub expected_revision: Option<Uuid>,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: SummaryModelSecretUpdate,
    pub max_output_tokens: u32,
    pub timeout_ms: u64,
    #[serde(default)]
    pub include_suggestions: bool,
}

pub(crate) struct StoredConfiguration {
    pub revision: Uuid,
    pub enabled: bool,
    pub settings: SummaryProviderSettings,
    command_digest: String,
}
impl StoredConfiguration {
    pub(crate) fn for_worker(value: &Self) -> Self {
        Self {
            revision: value.revision,
            enabled: value.enabled,
            settings: value.settings.clone(),
            command_digest: value.command_digest.clone(),
        }
    }
    pub fn view(&self, profile: ProfileId) -> SummaryModelConfiguration {
        SummaryModelConfiguration {
            profile_id: profile,
            revision: Some(self.revision),
            enabled: self.enabled,
            base_url: self.settings.base_url.clone(),
            model: self.settings.model.clone(),
            has_api_key: self.settings.api_key.is_some(),
            max_output_tokens: self.settings.max_output_tokens,
            timeout_ms: self.settings.timeout_ms,
            include_suggestions: self.settings.include_suggestions,
        }
    }
    /// Non-secret revision binding. Never publish a hash of the API key.
    pub fn role_digest(&self, profile: ProfileId) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&self.view(profile)).expect("serializable settings view")
            )
        )
    }
}
fn blank(profile: ProfileId) -> SummaryModelConfiguration {
    SummaryModelConfiguration {
        profile_id: profile,
        revision: None,
        enabled: false,
        base_url: String::new(),
        model: String::new(),
        has_api_key: false,
        max_output_tokens: 2048,
        timeout_ms: 60000,
        include_suggestions: false,
    }
}
fn unavailable<T>(_: T) -> HostError {
    HostError::ModelConfigurationUnavailable
}
fn corrupt<T>(_: T) -> HostError {
    HostError::ModelConfigurationRecoveryRequired
}
fn regular(path: &Path) -> Result<bool, HostError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            storage::check_private_tree(path).map_err(|error| match error {
                HostError::InvalidRoot => HostError::ModelConfigurationRecoveryRequired,
                _ => HostError::ModelConfigurationUnavailable,
            })?;
            Ok(true)
        }
        Ok(_) => Err(HostError::ModelConfigurationRecoveryRequired),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(unavailable(error)),
    }
}
fn present(root: &Path, device: DeviceId) -> Result<bool, HostError> {
    let database = regular(&root.join(DATABASE))?;
    let marker = regular(&root.join(INITIALIZED))?;
    if !database && !marker {
        if regular(&root.join(JOURNAL))? {
            return Err(HostError::ModelConfigurationRecoveryRequired);
        }
        return Ok(false);
    }
    if !database || !marker {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    let path = root.join(INITIALIZED);
    if fs::metadata(&path).map_err(unavailable)?.len() > 256 {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    let value = fs::read_to_string(path).map_err(unavailable)?;
    if value != format!("{LAYOUT}\n{device}\n") {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    if root.join(JOURNAL).exists() {
        regular(&root.join(JOURNAL))?;
    }
    Ok(true)
}
fn connection(root: &Path, device: DeviceId, write: bool) -> Result<Option<Connection>, HostError> {
    if !present(root, device)? {
        return Ok(None);
    }
    // Use READ_WRITE even for status to allow SQLite's own hot-journal recovery;
    // no CREATE flag, no DDL, and no domain writes occur on a read.
    let connection = Connection::open_with_flags(
        root.join(DATABASE),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(unavailable)?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(unavailable)?;
    connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_JSON as i32 + 4096);
    connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, MAX_JSON as i32);
    let app: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(unavailable)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(unavailable)?;
    if app != APPLICATION || version != 1 {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    let objects: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if objects != TABLES.len() as i64 {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    for (name, ddl) in TABLES {
        let sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)?;
        if sql.as_deref() != Some(ddl) {
            return Err(HostError::ModelConfigurationRecoveryRequired);
        }
    }
    let (layout, bound): (String, String) = connection
        .query_row(
            "SELECT layout,device_id FROM model_layout WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(corrupt)?;
    if layout != LAYOUT || bound != device.to_string() {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    if write {
        connection
            .execute_batch("PRAGMA synchronous=FULL;")
            .map_err(unavailable)?;
    }
    Ok(Some(connection))
}

pub(crate) fn load(
    root: &Path,
    device: DeviceId,
    profile: ProfileId,
) -> Result<Option<StoredConfiguration>, HostError> {
    match connection(root, device, false)? {
        Some(connection) => load_from(&connection, profile),
        None => Ok(None),
    }
}
fn load_from(
    connection: &Connection,
    profile: ProfileId,
) -> Result<Option<StoredConfiguration>, HostError> {
    let row:Option<(String,String,bool,String)>=connection.query_row("SELECT revision,command_digest,enabled,settings FROM model_configuration WHERE profile_id=?1",[profile.to_string()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(unavailable)?;
    let Some((revision, command_digest, enabled, raw)) = row else {
        return Ok(None);
    };
    if raw.len() > MAX_JSON
        || command_digest.len() != 64
        || !command_digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    let settings: SummaryProviderSettings = serde_json::from_str(&raw).map_err(corrupt)?;
    settings.endpoint().map_err(corrupt)?;
    let revision = Uuid::parse_str(&revision).map_err(corrupt)?;
    if revision.is_nil() {
        return Err(HostError::ModelConfigurationRecoveryRequired);
    }
    Ok(Some(StoredConfiguration {
        revision,
        enabled,
        settings,
        command_digest,
    }))
}
fn new_file(path: &Path) -> Result<std::fs::File, HostError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Windows children inherit the already-protected Host root DACL.
    options.open(path).map_err(unavailable)
}
fn initialize(root: &Path, device: DeviceId) -> Result<Connection, HostError> {
    new_file(&root.join(DATABASE))?
        .sync_all()
        .map_err(unavailable)?;
    let mut connection = Connection::open_with_flags(
        root.join(DATABASE),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(unavailable)?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(unavailable)?;
    connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_JSON as i32 + 4096);
    connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, MAX_JSON as i32);
    connection
        .execute_batch("PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;")
        .map_err(unavailable)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    for (_, ddl) in TABLES {
        tx.execute_batch(ddl).map_err(unavailable)?;
    }
    tx.execute(
        "INSERT INTO model_layout VALUES(1,?1,?2)",
        params![LAYOUT, device.to_string()],
    )
    .map_err(unavailable)?;
    tx.pragma_update(None, "application_id", APPLICATION)
        .map_err(unavailable)?;
    tx.pragma_update(None, "user_version", 1)
        .map_err(unavailable)?;
    tx.commit().map_err(unavailable)?;
    let mut marker = new_file(&root.join(INITIALIZED))?;
    marker
        .write_all(format!("{LAYOUT}\n{device}\n").as_bytes())
        .map_err(unavailable)?;
    marker.sync_all().map_err(unavailable)?;
    #[cfg(unix)]
    std::fs::File::open(root)
        .map_err(unavailable)?
        .sync_all()
        .map_err(unavailable)?;
    Ok(connection)
}
fn save(
    root: &Path,
    device: DeviceId,
    profile: ProfileId,
    command: &SummaryModelConfigurationCommand,
) -> Result<SummaryModelConfiguration, HostError> {
    if command.command_id.is_nil() {
        return Err(HostError::ModelConfigurationInvalid);
    }
    let encoded = serde_json::to_vec(command).map_err(unavailable)?;
    if encoded.len() > MAX_JSON {
        return Err(HostError::ModelConfigurationInvalid);
    }
    let command_digest = format!("{:x}", Sha256::digest(encoded));
    let prior = load(root, device, profile)?;
    if prior
        .as_ref()
        .is_some_and(|value| value.revision == command.command_id)
    {
        let value = prior.unwrap();
        if value.command_digest != command_digest {
            return Err(HostError::ModelConfigurationConflict);
        }
        return Ok(value.view(profile));
    }
    if prior.as_ref().map(|value| value.revision) != command.expected_revision {
        return Err(HostError::ModelConfigurationConflict);
    }
    let key = match &command.api_key {
        SummaryModelSecretUpdate::Keep => prior
            .as_ref()
            .and_then(|value| value.settings.api_key.clone()),
        SummaryModelSecretUpdate::Clear => None,
        SummaryModelSecretUpdate::Set { value } => Some(value.clone()),
    };
    let settings = SummaryProviderSettings {
        base_url: command.base_url.clone(),
        model: command.model.clone(),
        api_key: key,
        max_output_tokens: command.max_output_tokens,
        timeout_ms: command.timeout_ms,
        include_suggestions: command.include_suggestions,
    };
    settings
        .endpoint()
        .map_err(|_| HostError::ModelConfigurationInvalid)?;
    let raw=serde_json::to_string(&serde_json::json!({"base_url":settings.base_url,"model":settings.model,"api_key":settings.api_key,"max_output_tokens":settings.max_output_tokens,"timeout_ms":settings.timeout_ms,"include_suggestions":settings.include_suggestions})).map_err(unavailable)?;
    if raw.len() > MAX_JSON {
        return Err(HostError::ModelConfigurationInvalid);
    }
    let mut connection = match connection(root, device, true)? {
        Some(value) => value,
        None => initialize(root, device)?,
    };
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    let count: i64 = tx
        .query_row("SELECT count(*) FROM model_configuration", [], |row| {
            row.get(0)
        })
        .map_err(unavailable)?;
    if prior.is_none() && count >= 1024 {
        return Err(HostError::ModelConfigurationUnavailable);
    }
    tx.execute("INSERT INTO model_configuration VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,command_digest=excluded.command_digest,enabled=excluded.enabled,settings=excluded.settings",params![profile.to_string(),command.command_id.to_string(),command_digest,command.enabled,raw]).map_err(unavailable)?;
    tx.commit().map_err(unavailable)?;
    Ok(StoredConfiguration {
        revision: command.command_id,
        enabled: command.enabled,
        settings,
        command_digest,
    }
    .view(profile))
}

impl BetaHost {
    pub fn summary_model_configuration(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<SummaryModelConfiguration, HostError> {
        let state = self.active_state()?;
        self.owner(session)?;
        let resources = resources(&state)?;
        if !resources
            .core
            .profiles()?
            .iter()
            .any(|value| value.profile_id == profile)
        {
            return Err(HostError::NotFound);
        }
        Ok(load(&resources.persistence.root, self.device_id, profile)?
            .map(|value| value.view(profile))
            .unwrap_or_else(|| blank(profile)))
    }
    pub fn configure_summary_model(
        &self,
        session: &Session,
        profile: ProfileId,
        command: &SummaryModelConfigurationCommand,
    ) -> Result<SummaryModelConfiguration, HostError> {
        let state = self.active_state()?;
        self.owner(session)?;
        let resources = resources(&state)?;
        if !resources
            .core
            .profiles()?
            .iter()
            .any(|value| value.profile_id == profile)
        {
            return Err(HostError::NotFound);
        }
        save(
            &resources.persistence.root,
            self.device_id,
            profile,
            command,
        )
    }
}

#[cfg(test)]
#[path = "model_config_tests.rs"]
mod tests;
