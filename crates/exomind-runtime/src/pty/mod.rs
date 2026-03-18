use chrono::{DateTime, Utc};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{broadcast, Mutex};

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Max scrollback buffer size in bytes (256 KB).
const MAX_OUTPUT_BUFFER: usize = 256 * 1024;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("failed to spawn PTY process: {reason}")]
    SpawnFailed { reason: String },

    #[error("PTY instance not found: {id}")]
    NotFound { id: String },

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// Output message broadcast type
// ---------------------------------------------------------------------------

/// Messages sent through the broadcast channel.
#[derive(Debug, Clone)]
pub enum PtyOutputMsg {
    /// Raw bytes from the PTY process.
    Data(Vec<u8>),
    /// The PTY process has exited / reader hit EOF.
    Eof,
}

// ---------------------------------------------------------------------------
// Enums & public structs (serializable for HTTP API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PtyAgentStatus {
    Running,
    Stopped,
    Exited { code: i32 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PtyAgentType {
    Claude,
    Codex,
}

impl Default for PtyAgentType {
    fn default() -> Self {
        Self::Claude
    }
}

impl PtyAgentType {
    fn command(self) -> String {
        match self {
            Self::Claude => "claude".to_string(),
            Self::Codex => "codex".to_string(),
        }
    }

    fn display_prefix(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Codex => "Codex",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyAgentInfo {
    pub id: String,
    pub name: String,
    pub session_id: Option<String>,
    pub workdir: String,
    pub command: String,
    pub status: PtyAgentStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySpawnRequest {
    #[serde(default)]
    pub name: String,
    pub workdir: Option<String>,
    #[serde(default = "default_command")]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

fn default_command() -> String {
    "claude".to_string()
}

fn default_rows() -> u16 {
    24
}

fn default_cols() -> u16 {
    80
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyResumeRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub agent_type: PtyAgentType,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub session_id: String,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyHistoricalSessionInfo {
    pub agent_type: PtyAgentType,
    pub session_id: String,
    pub project_path: String,
    pub last_modified: String,
}

pub type ClaudeSessionInfo = PtyHistoricalSessionInfo;

// ---------------------------------------------------------------------------
// Internal PTY instance (not serializable — holds OS resources)
// ---------------------------------------------------------------------------

struct PtyInstance {
    info: PtyAgentInfo,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Scrollback buffer — stores recent output for replay on SSE reconnect.
    output_buffer: Arc<Mutex<Vec<u8>>>,
    /// Broadcast sender — every SSE consumer subscribes here for live data.
    output_tx: broadcast::Sender<PtyOutputMsg>,
}

impl Drop for PtyInstance {
    fn drop(&mut self) {
        // Kill the child process when the instance is dropped to prevent orphans.
        let _ = self.child.kill();
    }
}

// ---------------------------------------------------------------------------
// PtyManager
// ---------------------------------------------------------------------------

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
    signal_pool: Arc<SignalPool>,
    host_id: String,
}

impl PtyManager {
    pub fn new(signal_pool: Arc<SignalPool>, host_id: String) -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            signal_pool,
            host_id,
        }
    }

    /// Spawn a new PTY process.
    pub async fn spawn(&self, request: PtySpawnRequest) -> Result<PtyAgentInfo, PtyError> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed {
                reason: format!("openpty failed: {e}"),
            })?;

        let resolved_command = resolve_spawn_command(&request.command);
        let mut cmd = CommandBuilder::new(&resolved_command);
        for arg in &request.args {
            cmd.arg(arg);
        }
        // Auto-add --dangerously-skip-permissions for Claude to avoid interactive permission prompts
        if request.command == "claude"
            && !request
                .args
                .iter()
                .any(|a| a.contains("dangerously-skip-permissions"))
        {
            cmd.arg("--dangerously-skip-permissions");
        }
        if let Some(ref workdir) = request.workdir {
            cmd.cwd(workdir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed {
                reason: format!("spawn_command failed: {e}"),
            })?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed {
                reason: format!("try_clone_reader failed: {e}"),
            })?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed {
                reason: format!("take_writer failed: {e}"),
            })?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();

        // Generate a default name if none provided
        let name = if request.name.is_empty() {
            format!("{}-{}", request.command, &id[..8])
        } else {
            request.name
        };

        let info = PtyAgentInfo {
            id: id.clone(),
            name,
            session_id: None,
            workdir: request.workdir.unwrap_or_else(|| ".".to_string()),
            command: request.command,
            status: PtyAgentStatus::Running,
            created_at: now.to_rfc3339(),
        };

        // Create output buffering infrastructure
        let output_buffer = Arc::new(Mutex::new(Vec::new()));
        let (output_tx, _) = broadcast::channel::<PtyOutputMsg>(1024);

        // Spawn background reader task that reads from PTY and:
        // 1. Appends to the scrollback buffer (capped at MAX_OUTPUT_BUFFER)
        // 2. Broadcasts to all SSE consumers
        let buffer_clone = Arc::clone(&output_buffer);
        let tx_clone = output_tx.clone();
        tokio::task::spawn_blocking(move || {
            Self::reader_loop(reader, buffer_clone, tx_clone);
        });

        let instance = PtyInstance {
            info: info.clone(),
            master: pair.master,
            child,
            writer: Arc::new(Mutex::new(writer)),
            output_buffer,
            output_tx,
        };

        self.instances.lock().await.insert(id, instance);

        self.publish_lifecycle_signal("pty.spawned", &info);

        Ok(info)
    }

    /// Background reader loop — runs on a blocking thread.
    fn reader_loop(
        mut reader: Box<dyn Read + Send>,
        buffer: Arc<Mutex<Vec<u8>>>,
        tx: broadcast::Sender<PtyOutputMsg>,
    ) {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF
                    let _ = tx.send(PtyOutputMsg::Eof);
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    // Append to scrollback buffer
                    {
                        let mut b = buffer.blocking_lock();
                        b.extend_from_slice(&data);
                        if b.len() > MAX_OUTPUT_BUFFER {
                            let drain = b.len() - MAX_OUTPUT_BUFFER;
                            b.drain(..drain);
                        }
                    }
                    // Broadcast to SSE consumers (ignore if no receivers)
                    let _ = tx.send(PtyOutputMsg::Data(data));
                }
                Err(_) => {
                    let _ = tx.send(PtyOutputMsg::Eof);
                    break;
                }
            }
        }
    }

    pub async fn resume(&self, request: PtyResumeRequest) -> Result<PtyAgentInfo, PtyError> {
        let session_id = request.session_id.clone();
        let spawn_request = build_resume_spawn_request(request);
        let mut info = self.spawn(spawn_request).await?;
        // Attach the session_id to the info and update the stored instance.
        info.session_id = Some(session_id);
        {
            let mut instances = self.instances.lock().await;
            if let Some(instance) = instances.get_mut(&info.id) {
                instance.info.session_id = info.session_id.clone();
            }
        }

        Ok(info)
    }

    /// Write raw input data to the PTY.
    ///
    /// Uses `spawn_blocking` to avoid blocking the tokio runtime with synchronous I/O.
    pub async fn write_input(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let writer = {
            let instances = self.instances.lock().await;
            let instance = instances
                .get(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
            Arc::clone(&instance.writer)
        };
        // Release instances lock before spawning blocking task
        let data = data.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut w = writer.blocking_lock();
            w.write_all(&data)?;
            w.flush()?;
            Ok::<(), std::io::Error>(())
        })
        .await
        .map_err(|e| PtyError::SpawnFailed {
            reason: format!("write_input task failed: {e}"),
        })??;
        Ok(())
    }

    /// Refresh the PTY process state from the underlying child handle.
    pub async fn refresh_process_state(&self, id: &str) -> Result<Option<PtyAgentInfo>, PtyError> {
        let mut instances = self.instances.lock().await;
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        if !matches!(instance.info.status, PtyAgentStatus::Running) {
            return Ok(Some(instance.info.clone()));
        }

        match instance.child.try_wait() {
            Ok(Some(exit_status)) => {
                let info = if matches!(instance.info.status, PtyAgentStatus::Running) {
                    instance.info.status = PtyAgentStatus::Exited {
                        code: exit_status.exit_code() as i32,
                    };
                    instance.info.clone()
                } else {
                    instance.info.clone()
                };
                drop(instances);
                self.publish_lifecycle_signal("pty.exited", &info);
                Ok(Some(info))
            }
            Ok(None) => Ok(None),
            Err(error) => Err(PtyError::IoError(error)),
        }
    }

    /// Get the output buffer snapshot and a broadcast receiver for live output.
    ///
    /// The caller should:
    /// 1. Send the buffer snapshot first (replay)
    /// 2. Then stream from the receiver (live)
    pub async fn subscribe_output(
        &self,
        id: &str,
    ) -> Result<(Vec<u8>, broadcast::Receiver<PtyOutputMsg>), PtyError> {
        // Extract Arc clones while holding the instances lock, then drop it
        // before awaiting the output_buffer lock. Holding both locks across
        // an await would make the future !Send (PtyInstance contains
        // Box<dyn MasterPty + Send> which is !Sync).
        let (output_buffer, rx) = {
            let instances = self.instances.lock().await;
            let instance = instances
                .get(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
            (Arc::clone(&instance.output_buffer), instance.output_tx.subscribe())
        };

        let buffer_snapshot = output_buffer.lock().await.clone();
        Ok((buffer_snapshot, rx))
    }

    /// Resize the PTY terminal.
    pub async fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), PtyError> {
        let instances = self.instances.lock().await;
        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::SpawnFailed {
                reason: format!("resize failed: {e}"),
            })?;

        Ok(())
    }

    /// Stop (kill) a PTY child process and update its status.
    pub async fn stop(&self, id: &str) -> Result<PtyAgentInfo, PtyError> {
        let mut instances = self.instances.lock().await;
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        if let Some(exit_status) = instance.child.try_wait().map_err(PtyError::IoError)? {
            instance.info.status = PtyAgentStatus::Exited {
                code: exit_status.exit_code() as i32,
            };
            let info = instance.info.clone();
            drop(instances);
            self.publish_lifecycle_signal("pty.exited", &info);
            return Ok(info);
        }

        instance.child.kill().map_err(|e| PtyError::IoError(e))?;
        instance.info.status = PtyAgentStatus::Stopped;

        let info = instance.info.clone();
        drop(instances);

        self.publish_lifecycle_signal("pty.stopped", &info);

        Ok(info)
    }

    /// Remove a PTY instance from the manager entirely.
    pub async fn remove(&self, id: &str) -> Result<(), PtyError> {
        let mut instances = self.instances.lock().await;
        instances
            .remove(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
        Ok(())
    }

    /// List all PTY agent instances.
    pub async fn list(&self) -> Vec<PtyAgentInfo> {
        let instances = self.instances.lock().await;
        instances.values().map(|i| i.info.clone()).collect()
    }

    /// Discover existing historical CLI sessions by agent type.
    pub fn list_historical_sessions(agent_type: PtyAgentType) -> Vec<PtyHistoricalSessionInfo> {
        match agent_type {
            PtyAgentType::Claude => match dirs_claude_projects() {
                Some(projects_dir) => discover_claude_sessions(&projects_dir),
                None => Vec::new(),
            },
            PtyAgentType::Codex => match dirs_codex_sessions() {
                Some(sessions_dir) => discover_codex_sessions(&sessions_dir),
                None => Vec::new(),
            },
        }
    }

    /// Discover existing Claude CLI sessions from ~/.claude/projects/.
    pub fn list_claude_sessions() -> Vec<ClaudeSessionInfo> {
        Self::list_historical_sessions(PtyAgentType::Claude)
    }

    /// Kill all running PTY child processes and clear instances (graceful shutdown).
    pub async fn shutdown(&self) {
        let mut instances = self.instances.lock().await;
        // Drop triggers PtyInstance::drop which kills the child process.
        instances.clear();
    }

    /// Publish a lifecycle signal to the SignalPool.
    fn publish_lifecycle_signal(&self, topic: &str, info: &PtyAgentInfo) {
        let event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: Utc::now().timestamp_millis() as u64,
            source: format!("pty:{}", info.id),
            origin_host_id: self.host_id.clone(),
            hop: 0,
            trace_id: None,
            payload: serde_json::to_value(info).unwrap_or_default(),
        };

        // Publish — ignore delivery records for lifecycle signals.
        let _rx = self.signal_pool.subscribe();
        self.signal_pool.publish(event);
    }
}

// ---------------------------------------------------------------------------
// Helper functions for Claude session discovery
// ---------------------------------------------------------------------------

/// Returns the path to `~/.claude/projects/` if it exists.
fn dirs_claude_projects() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let projects = home.join(".claude").join("projects");
    if projects.is_dir() {
        Some(projects)
    } else {
        None
    }
}

/// Returns the path to `~/.codex/sessions/` if it exists.
fn dirs_codex_sessions() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let sessions = home.join(".codex").join("sessions");
    if sessions.is_dir() {
        Some(sessions)
    } else {
        None
    }
}

/// Scan the Claude projects directory for session JSONL files.
///
/// Directory structure: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`
fn discover_claude_sessions(projects_dir: &PathBuf) -> Vec<PtyHistoricalSessionInfo> {
    let mut sessions = Vec::new();

    let entries = match std::fs::read_dir(projects_dir) {
        Ok(entries) => entries,
        Err(_) => return sessions,
    };

    for project_entry in entries.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }

        // The directory name is the encoded project path.
        let project_name = project_entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let session_entries = match std::fs::read_dir(&project_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for session_entry in session_entries.flatten() {
            let session_path = session_entry.path();
            let file_name = session_entry.file_name().to_string_lossy().to_string();

            if !file_name.ends_with(".jsonl") {
                continue;
            }

            let session_id = file_name.trim_end_matches(".jsonl").to_string();

            let last_modified = session_path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: DateTime<Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();

            sessions.push(PtyHistoricalSessionInfo {
                agent_type: PtyAgentType::Claude,
                session_id,
                project_path: project_name.clone(),
                last_modified,
            });
        }
    }

    // Sort by last_modified descending (most recent first).
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

fn discover_codex_sessions(sessions_dir: &Path) -> Vec<PtyHistoricalSessionInfo> {
    let mut sessions = Vec::new();
    let mut stack = vec![sessions_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }

            let Some((session_id, project_path)) = read_codex_session_meta(&path) else {
                continue;
            };

            let last_modified = path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: DateTime<Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default();

            sessions.push(PtyHistoricalSessionInfo {
                agent_type: PtyAgentType::Codex,
                session_id,
                project_path,
                last_modified,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

fn read_codex_session_meta(path: &Path) -> Option<(String, String)> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    for line in reader.lines().take(20).flatten() {
        let value: serde_json::Value = serde_json::from_str(&line).ok()?;
        if value.get("type").and_then(|kind| kind.as_str()) != Some("session_meta") {
            continue;
        }

        let payload = value.get("payload")?;
        let session_id = payload.get("id").and_then(|id| id.as_str())?;
        let cwd = payload
            .get("cwd")
            .and_then(|cwd| cwd.as_str())
            .unwrap_or_default();

        return Some((session_id.to_string(), cwd.to_string()));
    }

    None
}

fn build_resume_spawn_request(request: PtyResumeRequest) -> PtySpawnRequest {
    let name = if request.name.is_empty() {
        let len = 8.min(request.session_id.len());
        format!(
            "{}-{}",
            request.agent_type.display_prefix(),
            &request.session_id[..len]
        )
    } else {
        request.name
    };

    let mut args = Vec::new();
    match request.agent_type {
        PtyAgentType::Claude => {
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("--resume".to_string());
            args.push(request.session_id.clone());
        }
        PtyAgentType::Codex => {
            args.push("exec".to_string());
            args.push("resume".to_string());
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                args.push("-m".to_string());
                args.push(model.to_string());
            }
            if let Some(reasoning_effort) = request
                .reasoning_effort
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                args.push("-c".to_string());
                args.push(format!("model_reasoning_effort=\"{reasoning_effort}\""));
            }
            args.push(request.session_id.clone());
        }
    }
    args.extend(request.extra_args.clone());

    PtySpawnRequest {
        name,
        workdir: request.workdir,
        command: request.agent_type.command(),
        args,
        rows: request.rows,
        cols: request.cols,
    }
}

fn resolve_spawn_command(command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        if command.eq_ignore_ascii_case("codex") {
            return "codex.cmd".to_string();
        }
    }

    command.to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn pty_agent_status_serializes() {
        let running = serde_json::to_string(&PtyAgentStatus::Running).unwrap();
        assert_eq!(running, "\"running\"");

        let stopped = serde_json::to_string(&PtyAgentStatus::Stopped).unwrap();
        assert_eq!(stopped, "\"stopped\"");

        let exited = serde_json::to_string(&PtyAgentStatus::Exited { code: 42 }).unwrap();
        assert!(exited.contains("42"));
    }

    #[test]
    fn pty_spawn_request_defaults() {
        let json = r#"{"name": "test-agent"}"#;
        let req: PtySpawnRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "test-agent");
        assert_eq!(req.command, "claude");
        assert_eq!(req.rows, 24);
        assert_eq!(req.cols, 80);
        assert!(req.args.is_empty());
        assert!(req.workdir.is_none());
    }

    #[test]
    fn pty_spawn_request_name_defaults_to_empty() {
        let json = r#"{}"#;
        let req: PtySpawnRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "");
        assert_eq!(req.command, "claude");
    }

    #[test]
    fn pty_resume_request_name_and_workdir_default() {
        let json = r#"{"session_id": "abc-12345678-xyz"}"#;
        let req: PtyResumeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "");
        assert!(req.workdir.is_none());
        assert_eq!(req.session_id, "abc-12345678-xyz");
        assert_eq!(req.agent_type, PtyAgentType::Claude);
        assert_eq!(req.model, None);
        assert_eq!(req.reasoning_effort, None);
        assert!(req.extra_args.is_empty());
        assert_eq!(req.rows, 24);
        assert_eq!(req.cols, 80);
    }

    #[test]
    fn discover_codex_sessions_reads_rollout_metadata() {
        let dir = tempdir().unwrap();
        let day_dir = dir.path().join("2026").join("03").join("18");
        fs::create_dir_all(&day_dir).unwrap();
        let session_path = day_dir.join(
            "rollout-2026-03-18T10-20-30-019d0011-aaaa-bbbb-cccc-1234567890ab.jsonl",
        );
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-03-18T02:20:32.696Z\",\"type\":\"session_meta\",",
                "\"payload\":{\"id\":\"019d0011-aaaa-bbbb-cccc-1234567890ab\",",
                "\"cwd\":\"D:\\\\project\\\\exomind\",\"originator\":\"codex_cli_rs\"}}\n"
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&day_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].agent_type, PtyAgentType::Codex);
        assert_eq!(sessions[0].session_id, "019d0011-aaaa-bbbb-cccc-1234567890ab");
        assert_eq!(sessions[0].project_path, "D:\\project\\exomind");
    }

    #[test]
    fn build_resume_spawn_request_supports_codex_exec_resume() {
        let req = PtyResumeRequest {
            name: "".to_string(),
            workdir: Some("D:/project/exomind".to_string()),
            agent_type: PtyAgentType::Codex,
            model: None,
            reasoning_effort: None,
            extra_args: vec![],
            session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab".to_string(),
            rows: 24,
            cols: 80,
        };

        let spawn_request = build_resume_spawn_request(req);
        assert_eq!(spawn_request.command, "codex");
        assert_eq!(
            spawn_request.args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "019d0011-aaaa-bbbb-cccc-1234567890ab".to_string(),
            ]
        );
        assert_eq!(spawn_request.name, "Codex-019d0011");
    }

    #[test]
    fn build_resume_spawn_request_for_codex_keeps_model_reasoning_and_extra_args() {
        let req = PtyResumeRequest {
            name: "resume-codex".to_string(),
            workdir: Some("D:/project/exomind".to_string()),
            agent_type: PtyAgentType::Codex,
            model: Some("gpt-5.4".to_string()),
            reasoning_effort: Some("xhigh".to_string()),
            extra_args: vec!["--search".to_string(), "--full-auto".to_string()],
            session_id: "019d0011-aaaa-bbbb-cccc-1234567890ab".to_string(),
            rows: 24,
            cols: 80,
        };

        let spawn_request = build_resume_spawn_request(req);
        assert_eq!(spawn_request.command, "codex");
        assert_eq!(
            spawn_request.args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "-m".to_string(),
                "gpt-5.4".to_string(),
                "-c".to_string(),
                "model_reasoning_effort=\"xhigh\"".to_string(),
                "019d0011-aaaa-bbbb-cccc-1234567890ab".to_string(),
                "--search".to_string(),
                "--full-auto".to_string(),
            ]
        );
    }

    #[test]
    fn pty_agent_info_round_trip() {
        let info = PtyAgentInfo {
            id: "abc-123".to_string(),
            name: "dev-agent".to_string(),
            session_id: Some("sess-456".to_string()),
            workdir: "/tmp".to_string(),
            command: "claude".to_string(),
            status: PtyAgentStatus::Running,
            created_at: "2026-03-09T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: PtyAgentInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "abc-123");
        assert_eq!(deserialized.session_id, Some("sess-456".to_string()));
    }

    #[test]
    fn discover_claude_sessions_on_temp_dir() {
        let dir = std::env::temp_dir().join(format!("exomind-pty-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("project-a")).unwrap();
        fs::write(dir.join("project-a").join("sess-1.jsonl"), "{}").unwrap();
        fs::write(dir.join("project-a").join("sess-2.jsonl"), "{}").unwrap();
        // Non-jsonl file should be ignored.
        fs::write(dir.join("project-a").join("readme.txt"), "hi").unwrap();

        let sessions = discover_claude_sessions(&dir);
        assert_eq!(sessions.len(), 2);
        assert!(sessions.iter().all(|s| s.project_path == "project-a"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn discover_claude_sessions_empty_dir() {
        let dir = std::env::temp_dir().join(format!("exomind-pty-empty-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let sessions = discover_claude_sessions(&dir);
        assert!(sessions.is_empty());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn discover_claude_sessions_nonexistent_dir() {
        let dir = PathBuf::from("/nonexistent/path/that/does/not/exist");
        let sessions = discover_claude_sessions(&dir);
        assert!(sessions.is_empty());
    }
}
