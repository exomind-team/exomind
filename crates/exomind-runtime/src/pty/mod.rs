use chrono::{DateTime, Utc};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::BufRead;
use std::io::BufReader;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::{Mutex, broadcast};

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Default scrollback buffer size in bytes (256 KB).
const DEFAULT_OUTPUT_BUFFER_LIMIT_BYTES: usize = 256 * 1024;
const MIN_OUTPUT_BUFFER_LIMIT_BYTES: usize = 128 * 1024;
const MAX_OUTPUT_BUFFER_LIMIT_BYTES: usize = 2048 * 1024;
const CODEX_SESSION_SCAN_LINE_LIMIT: usize = 128;
const HISTORICAL_SESSION_PREVIEW_CHAR_LIMIT: usize = 200;

fn clamp_output_buffer_limit_bytes(value: usize) -> usize {
    value.clamp(MIN_OUTPUT_BUFFER_LIMIT_BYTES, MAX_OUTPUT_BUFFER_LIMIT_BYTES)
}

#[derive(Debug, Clone, Default)]
pub struct PtyOutputReplaySnapshot {
    pub offset: u64,
    pub data: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default)]
struct PtyOutputBufferState {
    start_offset: u64,
    data: Vec<u8>,
    eof_offset: Option<u64>,
}

impl PtyOutputBufferState {
    fn end_offset(&self) -> u64 {
        self.start_offset.saturating_add(self.data.len() as u64)
    }
}

fn trim_output_buffer_to_limit(buffer: &mut PtyOutputBufferState, limit_bytes: usize) {
    if buffer.data.len() > limit_bytes {
        let drain = buffer.data.len() - limit_bytes;
        buffer.data.drain(..drain);
        buffer.start_offset = buffer.start_offset.saturating_add(drain as u64);
    }
}

fn slice_output_replay_snapshot(
    buffer: &PtyOutputBufferState,
    cursor: Option<u64>,
) -> PtyOutputReplaySnapshot {
    let start_offset = buffer.start_offset;
    let end_offset = start_offset.saturating_add(buffer.data.len() as u64);

    match cursor {
        None => PtyOutputReplaySnapshot {
            offset: start_offset,
            data: buffer.data.clone(),
            truncated: start_offset > 0,
        },
        Some(cursor) if cursor <= start_offset => PtyOutputReplaySnapshot {
            offset: start_offset,
            data: buffer.data.clone(),
            truncated: cursor < start_offset,
        },
        Some(cursor) if cursor >= end_offset => PtyOutputReplaySnapshot {
            offset: end_offset,
            data: Vec::new(),
            truncated: false,
        },
        Some(cursor) => {
            let skip = (cursor - start_offset) as usize;
            PtyOutputReplaySnapshot {
                offset: cursor,
                data: buffer.data[skip..].to_vec(),
                truncated: false,
            }
        }
    }
}

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
    Data { offset: u64, data: Vec<u8> },
    /// The PTY process has exited / reader hit EOF.
    Eof { offset: u64 },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_user_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_user_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyHistoricalSessionPreview {
    pub agent_type: PtyAgentType,
    pub session_id: String,
    pub project_path: String,
    pub last_modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_user_message_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_user_message_preview: Option<String>,
}

impl PtyHistoricalSessionInfo {
    pub fn into_preview(self) -> PtyHistoricalSessionPreview {
        PtyHistoricalSessionPreview {
            agent_type: self.agent_type,
            session_id: self.session_id,
            project_path: self.project_path,
            last_modified: self.last_modified,
            display_title: self.display_title,
            display_path: self.display_path,
            first_user_message_preview: truncate_unicode_preview_text(
                self.first_user_message.as_deref(),
            ),
            last_user_message_preview: truncate_unicode_preview_text(
                self.last_user_message.as_deref(),
            ),
        }
    }
}

pub type ClaudeSessionInfo = PtyHistoricalSessionPreview;

// ---------------------------------------------------------------------------
// Internal PTY instance (not serializable — holds OS resources)
// ---------------------------------------------------------------------------

struct PtyInstance {
    info: PtyAgentInfo,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Monotonic PTY activity clock used for idle -> waiting_input detection.
    last_activity_at: Arc<StdMutex<Instant>>,
    /// Scrollback buffer — stores recent output for replay on SSE reconnect.
    output_buffer: Arc<Mutex<PtyOutputBufferState>>,
    /// Broadcast sender — every SSE consumer subscribes here for live data.
    output_tx: broadcast::Sender<PtyOutputMsg>,
}

struct TranscriptWriter {
    path: PathBuf,
    eof_path: PathBuf,
    file: File,
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
    transcript_dir: Option<PathBuf>,
    scrollback_limit_bytes: Arc<AtomicUsize>,
}

impl PtyManager {
    pub fn new(signal_pool: Arc<SignalPool>, host_id: String) -> Self {
        Self::new_with_transcript_dir(signal_pool, host_id, None)
    }

    pub fn new_with_transcript_dir(
        signal_pool: Arc<SignalPool>,
        host_id: String,
        transcript_dir: Option<PathBuf>,
    ) -> Self {
        let transcript_dir = transcript_dir.and_then(|path| match std::fs::create_dir_all(&path) {
            Ok(()) => Some(path),
            Err(error) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %error,
                    "failed to create PTY transcript directory"
                );
                None
            }
        });

        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            signal_pool,
            host_id,
            transcript_dir,
            scrollback_limit_bytes: Arc::new(AtomicUsize::new(DEFAULT_OUTPUT_BUFFER_LIMIT_BYTES)),
        }
    }

    pub fn set_scrollback_limit_bytes(&self, limit_bytes: usize) {
        self.scrollback_limit_bytes.store(
            clamp_output_buffer_limit_bytes(limit_bytes),
            Ordering::Relaxed,
        );
    }

    pub fn scrollback_limit_bytes(&self) -> usize {
        clamp_output_buffer_limit_bytes(self.scrollback_limit_bytes.load(Ordering::Relaxed))
    }

    /// Spawn a new PTY process.
    pub async fn spawn(&self, request: PtySpawnRequest) -> Result<PtyAgentInfo, PtyError> {
        let pty_system = native_pty_system();
        let resolved_workdir = resolve_workdir_path(request.workdir.as_deref())?;

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
        cmd.cwd(&resolved_workdir);

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
            workdir: resolved_workdir.to_string_lossy().to_string(),
            command: request.command,
            status: PtyAgentStatus::Running,
            created_at: now.to_rfc3339(),
        };

        // Create output buffering infrastructure
        let output_buffer = Arc::new(Mutex::new(PtyOutputBufferState::default()));
        let last_activity_at = Arc::new(StdMutex::new(Instant::now()));
        let (output_tx, _) = broadcast::channel::<PtyOutputMsg>(1024);
        let transcript_writer = self
            .transcript_path(&id)
            .and_then(|path| create_transcript_writer(&id, path));

        // Spawn background reader task that reads from PTY and:
        // 1. Appends to the scrollback buffer (capped at the current replay limit)
        // 2. Broadcasts to all SSE consumers
        let pty_id = id.clone();
        let buffer_clone = Arc::clone(&output_buffer);
        let activity_clone = Arc::clone(&last_activity_at);
        let scrollback_limit_bytes = Arc::clone(&self.scrollback_limit_bytes);
        let tx_clone = output_tx.clone();
        tokio::task::spawn_blocking(move || {
            Self::reader_loop(
                pty_id,
                reader,
                activity_clone,
                buffer_clone,
                scrollback_limit_bytes,
                tx_clone,
                transcript_writer,
            );
        });

        let instance = PtyInstance {
            info: info.clone(),
            master: pair.master,
            child,
            writer: Arc::new(Mutex::new(writer)),
            last_activity_at,
            output_buffer,
            output_tx,
        };

        self.instances.lock().await.insert(id, instance);

        self.publish_lifecycle_signal("pty.spawned", &info);

        Ok(info)
    }

    /// Background reader loop — runs on a blocking thread.
    fn reader_loop(
        pty_id: String,
        mut reader: Box<dyn Read + Send>,
        activity: Arc<StdMutex<Instant>>,
        buffer: Arc<Mutex<PtyOutputBufferState>>,
        scrollback_limit_bytes: Arc<AtomicUsize>,
        tx: broadcast::Sender<PtyOutputMsg>,
        mut transcript_writer: Option<TranscriptWriter>,
    ) {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF
                    let offset = {
                        let mut b = buffer.blocking_lock();
                        let offset = b.end_offset();
                        b.eof_offset = Some(offset);
                        offset
                    };
                    if let Some(writer) = transcript_writer.as_ref() {
                        persist_transcript_completion_marker(writer, offset);
                    }
                    let _ = tx.send(PtyOutputMsg::Eof { offset });
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if let Some(writer) = transcript_writer.as_mut()
                        && let Err(error) = writer
                            .file
                            .write_all(&data)
                            .and_then(|_| writer.file.flush())
                    {
                        tracing::warn!(
                            pty_id = %pty_id,
                            path = %writer.path.display(),
                            error = %error,
                            "failed to persist PTY transcript chunk"
                        );
                        transcript_writer = None;
                    }
                    // Append to scrollback buffer
                    let offset = {
                        let mut b = buffer.blocking_lock();
                        let offset = b.end_offset();
                        b.data.extend_from_slice(&data);
                        trim_output_buffer_to_limit(
                            &mut b,
                            clamp_output_buffer_limit_bytes(
                                scrollback_limit_bytes.load(Ordering::Relaxed),
                            ),
                        );
                        offset
                    };
                    Self::record_activity(&activity);
                    // Broadcast to SSE consumers (ignore if no receivers)
                    let _ = tx.send(PtyOutputMsg::Data { offset, data });
                }
                Err(_) => {
                    let offset = {
                        let mut b = buffer.blocking_lock();
                        let offset = b.end_offset();
                        b.eof_offset = Some(offset);
                        offset
                    };
                    if let Some(writer) = transcript_writer.as_ref() {
                        persist_transcript_completion_marker(writer, offset);
                    }
                    let _ = tx.send(PtyOutputMsg::Eof { offset });
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

    pub async fn attach_session_id(
        &self,
        id: &str,
        session_id: String,
    ) -> Result<PtyAgentInfo, PtyError> {
        let mut instances = self.instances.lock().await;
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
        instance.info.session_id = Some(session_id);
        Ok(instance.info.clone())
    }

    /// Write raw input data to the PTY.
    ///
    /// Uses `spawn_blocking` to avoid blocking the tokio runtime with synchronous I/O.
    pub async fn write_input(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let (writer, activity) = {
            let instances = self.instances.lock().await;
            let instance = instances
                .get(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
            (
                Arc::clone(&instance.writer),
                Arc::clone(&instance.last_activity_at),
            )
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
        Self::record_activity(&activity);
        Ok(())
    }

    pub async fn activity_idle_for(&self, id: &str) -> Result<Duration, PtyError> {
        let activity = {
            let instances = self.instances.lock().await;
            let instance = instances
                .get(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
            Arc::clone(&instance.last_activity_at)
        };
        let last_activity = *activity
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(Instant::now().saturating_duration_since(last_activity))
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
        cursor: Option<u64>,
    ) -> Result<
        (
            PtyOutputReplaySnapshot,
            Option<u64>,
            broadcast::Receiver<PtyOutputMsg>,
        ),
        PtyError,
    > {
        // Extract Arc clones while holding the instances lock, then drop it
        // before awaiting the output_buffer lock. Holding both locks across
        // an await would make the future !Send (PtyInstance contains
        // Box<dyn MasterPty + Send> which is !Sync).
        let (output_buffer, rx) = {
            let instances = self.instances.lock().await;
            let instance = instances
                .get(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;
            (
                Arc::clone(&instance.output_buffer),
                instance.output_tx.subscribe(),
            )
        };

        let buffer_snapshot = output_buffer.lock().await.clone();
        Ok((
            slice_output_replay_snapshot(&buffer_snapshot, cursor),
            buffer_snapshot.eof_offset,
            rx,
        ))
    }

    pub async fn load_persisted_output(
        &self,
        id: &str,
        cursor: Option<u64>,
    ) -> Result<Option<PtyOutputReplaySnapshot>, PtyError> {
        let Some(path) = self.transcript_path(id) else {
            return Ok(None);
        };
        let limit_bytes = self.scrollback_limit_bytes();

        tokio::task::spawn_blocking(move || read_transcript_tail(&path, limit_bytes, cursor))
            .await
            .map_err(|error| PtyError::SpawnFailed {
                reason: format!("load_persisted_output task failed: {error}"),
            })?
    }

    pub async fn load_completed_output(
        &self,
        id: &str,
        cursor: Option<u64>,
    ) -> Result<Option<PtyOutputReplaySnapshot>, PtyError> {
        let Some(path) = self.transcript_path(id) else {
            return Ok(None);
        };
        let limit_bytes = self.scrollback_limit_bytes();

        tokio::task::spawn_blocking(move || {
            read_completed_transcript_tail(&path, limit_bytes, cursor)
        })
        .await
        .map_err(|error| PtyError::SpawnFailed {
            reason: format!("load_completed_output task failed: {error}"),
        })?
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

    pub fn list_historical_session_previews(
        agent_type: PtyAgentType,
    ) -> Vec<PtyHistoricalSessionPreview> {
        Self::list_historical_sessions(agent_type)
            .into_iter()
            .map(PtyHistoricalSessionInfo::into_preview)
            .collect()
    }

    pub fn get_historical_session(
        agent_type: PtyAgentType,
        session_id: &str,
    ) -> Option<PtyHistoricalSessionInfo> {
        Self::list_historical_sessions(agent_type)
            .into_iter()
            .find(|session| session.session_id == session_id)
    }

    /// Discover existing Claude CLI sessions from ~/.claude/projects/.
    pub fn list_claude_sessions() -> Vec<ClaudeSessionInfo> {
        Self::list_historical_session_previews(PtyAgentType::Claude)
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

    fn transcript_path(&self, id: &str) -> Option<PathBuf> {
        self.transcript_dir
            .as_ref()
            .map(|dir| dir.join(format!("{id}.log")))
    }

    fn record_activity(activity: &Arc<StdMutex<Instant>>) {
        let mut guard = activity
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Instant::now();
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

#[derive(Debug, Clone, Default)]
struct HistoricalSessionDisplayMeta {
    display_title: Option<String>,
    fallback_title: Option<String>,
    display_path: Option<String>,
    last_modified: Option<String>,
    first_user_message: Option<String>,
    last_user_message: Option<String>,
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
        let project_name = project_entry.file_name().to_string_lossy().to_string();
        let project_index = read_claude_project_index(&project_path);

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
            let index_meta = project_index.get(&session_id).cloned().unwrap_or_default();
            let direct_meta = read_claude_session_display_meta(&session_path);
            let display_meta = HistoricalSessionDisplayMeta {
                display_title: direct_meta
                    .display_title
                    .or(index_meta.display_title)
                    .or(direct_meta.fallback_title),
                fallback_title: None,
                display_path: index_meta.display_path,
                last_modified: index_meta.last_modified,
                first_user_message: direct_meta
                    .first_user_message
                    .or(index_meta.first_user_message),
                last_user_message: direct_meta
                    .last_user_message
                    .or(index_meta.last_user_message),
            };

            let last_modified = display_meta.last_modified.clone().unwrap_or_else(|| {
                session_path
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let dt: DateTime<Utc> = t.into();
                        dt.to_rfc3339()
                    })
                    .unwrap_or_default()
            });

            sessions.push(PtyHistoricalSessionInfo {
                agent_type: PtyAgentType::Claude,
                session_id,
                project_path: project_name.clone(),
                last_modified,
                display_title: display_meta.display_title,
                display_path: display_meta.display_path,
                first_user_message: display_meta.first_user_message,
                last_user_message: display_meta.last_user_message,
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
    let history_meta = read_codex_history_meta(sessions_dir);
    let session_index = read_codex_session_index(sessions_dir);

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

            let Some(session_meta) = read_codex_session_meta(&path) else {
                continue;
            };
            let history_display_meta = history_meta
                .get(&session_meta.session_id)
                .cloned()
                .unwrap_or_default();
            let index_display_title = session_index
                .get(&session_meta.session_id)
                .cloned();
            let display_meta = HistoricalSessionDisplayMeta {
                display_title: session_meta
                    .display_title
                    .or(index_display_title)
                    .or(history_display_meta.display_title),
                fallback_title: history_display_meta.fallback_title,
                display_path: history_display_meta.display_path,
                last_modified: history_display_meta.last_modified,
                first_user_message: history_display_meta
                    .first_user_message
                    .or(session_meta.first_user_message),
                last_user_message: history_display_meta
                    .last_user_message
                    .or(session_meta.last_user_message),
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
                session_id: session_meta.session_id,
                project_path: session_meta.project_path.clone(),
                last_modified,
                display_title: display_meta.display_title,
                display_path: display_meta
                    .display_path
                    .or_else(|| normalize_trimmed_text(Some(session_meta.project_path.as_str()))),
                first_user_message: display_meta.first_user_message,
                last_user_message: display_meta.last_user_message,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

struct CodexSessionScanResult {
    session_id: String,
    project_path: String,
    display_title: Option<String>,
    first_user_message: Option<String>,
    last_user_message: Option<String>,
}

fn read_codex_session_meta(path: &Path) -> Option<CodexSessionScanResult> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut session_id = None;
    let mut project_path = None;
    let mut display_title = None;
    let mut first_user_message = None;
    let mut last_user_message = None;

    for line in reader.lines().take(CODEX_SESSION_SCAN_LINE_LIMIT).flatten() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        if value.get("type").and_then(|kind| kind.as_str()) == Some("session_meta") {
            let payload = value.get("payload")?;
            if session_id.is_none() {
                session_id = payload
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(ToString::to_string);
            }
            if project_path.is_none() {
                project_path = payload
                    .get("cwd")
                    .and_then(|cwd| cwd.as_str())
                    .map(ToString::to_string);
            }
        }

        if let Some(thread_name) = find_string_field_recursive(&value, "thread_name") {
            display_title = Some(thread_name);
        }

        update_message_preview(
            &mut first_user_message,
            &mut last_user_message,
            extract_codex_user_message(&value),
        );
    }

    Some(CodexSessionScanResult {
        session_id: session_id?,
        project_path: project_path.unwrap_or_default(),
        display_title,
        first_user_message,
        last_user_message,
    })
}

fn read_claude_project_index(project_path: &Path) -> HashMap<String, HistoricalSessionDisplayMeta> {
    let index_path = project_path.join("sessions-index.json");
    let index = std::fs::read_to_string(index_path).ok();
    let Some(index) = index else {
        return HashMap::new();
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(&index) else {
        return HashMap::new();
    };
    let Some(entries) = value.get("entries").and_then(|entries| entries.as_array()) else {
        return HashMap::new();
    };

    let mut by_session_id = HashMap::new();
    for entry in entries {
        let Some(session_id) = entry.get("sessionId").and_then(|value| value.as_str()) else {
            continue;
        };

        let display_title = normalize_title_text(
            entry
                .get("summary")
                .and_then(|value| value.as_str())
                .or_else(|| entry.get("firstPrompt").and_then(|value| value.as_str())),
        );
        let display_path =
            normalize_trimmed_text(entry.get("projectPath").and_then(|value| value.as_str()));
        let last_modified =
            normalize_trimmed_text(entry.get("modified").and_then(|value| value.as_str()));
        let first_user_message = normalize_message_preview_text(
            entry.get("firstPrompt").and_then(|value| value.as_str()),
        );

        by_session_id.insert(
            session_id.to_string(),
            HistoricalSessionDisplayMeta {
                display_title,
                fallback_title: None,
                display_path,
                last_modified,
                first_user_message,
                last_user_message: None,
            },
        );
    }

    by_session_id
}

fn read_claude_session_display_meta(path: &Path) -> HistoricalSessionDisplayMeta {
    let file = File::open(path).ok();
    let Some(file) = file else {
        return HistoricalSessionDisplayMeta::default();
    };

    let reader = BufReader::new(file);
    let mut display_title = None;
    let mut fallback_title = None;
    let mut first_user_message = None;
    let mut last_user_message = None;

    for line in reader.lines().flatten() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        if let Some(custom_title) = find_string_field_recursive(&value, "customTitle") {
            display_title = Some(custom_title);
            continue;
        }

        if let Some(rename_title) = find_claude_rename_command(&value) {
            display_title = Some(rename_title);
            continue;
        }

        if display_title.is_none() {
            if let Some(agent_name) = find_string_field_recursive(&value, "agentName") {
                fallback_title = Some(agent_name);
            }
        }

        update_message_preview(
            &mut first_user_message,
            &mut last_user_message,
            extract_claude_user_message(&value),
        );
    }

    HistoricalSessionDisplayMeta {
        display_title,
        fallback_title,
        first_user_message,
        last_user_message,
        ..Default::default()
    }
}

/// 读取 ~/.codex/session_index.jsonl，构建 session_id → thread_name 的映射。
/// 这是 Codex 会话重命名（/rename）名称的最权威来源。
/// 格式：{"id":"019d6ab6-...","thread_name":"日报","updated_at":"..."}
fn read_codex_session_index(sessions_dir: &Path) -> HashMap<String, String> {
    let Some(index_path) = sessions_dir.parent().map(|p| p.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    let file = File::open(index_path).ok();
    let Some(file) = file else {
        return HashMap::new();
    };

    let reader = BufReader::new(file);
    let mut map = HashMap::new();

    for line in reader.lines().flatten() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(name) = value.get("thread_name").and_then(|v| v.as_str()) else {
            continue;
        };
        if !name.is_empty() {
            map.insert(id.to_string(), name.to_string());
        }
    }
    map
}

fn read_codex_history_meta(sessions_dir: &Path) -> HashMap<String, HistoricalSessionDisplayMeta> {
    let Some(history_path) = sessions_dir
        .parent()
        .map(|parent| parent.join("history.jsonl"))
    else {
        return HashMap::new();
    };
    let file = File::open(history_path).ok();
    let Some(file) = file else {
        return HashMap::new();
    };

    let reader = BufReader::new(file);
    let mut by_session_id = HashMap::new();

    for line in reader.lines().flatten() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(session_id) = value.get("session_id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(text) = value.get("text").and_then(|value| value.as_str()) else {
            continue;
        };

        let entry = by_session_id
            .entry(session_id.to_string())
            .or_insert_with(HistoricalSessionDisplayMeta::default);

        if let Some(rename_title) = parse_codex_rename_command(text) {
            entry.display_title = Some(rename_title);
            continue;
        }

        if let Some(message_preview) = normalize_message_preview_text(Some(text)) {
            if entry.first_user_message.is_none() {
                entry.first_user_message = Some(message_preview.clone());
            }
            entry.last_user_message = Some(message_preview.clone());

            if entry.display_title.is_none() {
                entry.display_title = Some(message_preview);
            }
        }
    }

    by_session_id
}

fn extract_claude_user_message(value: &serde_json::Value) -> Option<String> {
    let message = value.get("message")?;
    if message.get("role").and_then(|role| role.as_str()) != Some("user") {
        return None;
    }

    extract_message_text_from_content(message.get("content")?)
}

fn extract_codex_user_message(value: &serde_json::Value) -> Option<String> {
    let payload = value.get("payload")?;
    if payload.get("role").and_then(|role| role.as_str()) != Some("user") {
        return None;
    }

    extract_message_text_from_content(payload.get("content")?)
}

fn extract_message_text_from_content(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => normalize_message_preview_text(Some(text)),
        serde_json::Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(extract_message_text_item)
                .collect::<Vec<_>>()
                .join(" ");
            normalize_message_preview_text(Some(text.as_str()))
        }
        serde_json::Value::Object(_) => extract_message_text_item(value),
        _ => None,
    }
}

fn extract_message_text_item(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => normalize_message_preview_text(Some(text)),
        serde_json::Value::Object(map) => {
            let item_type = map
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if matches!(item_type, "tool_result" | "tool_use") {
                return None;
            }

            normalize_message_preview_text(
                map.get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| map.get("value").and_then(|value| value.as_str())),
            )
            .or_else(|| {
                map.get("content")
                    .and_then(extract_message_text_from_content)
            })
        }
        _ => None,
    }
}

fn update_message_preview(
    first: &mut Option<String>,
    last: &mut Option<String>,
    next: Option<String>,
) {
    let Some(next) = next else {
        return;
    };

    if first.is_none() {
        *first = Some(next.clone());
    }
    *last = Some(next);
}

fn find_string_field_recursive(value: &serde_json::Value, target_key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(direct) = map
                .get(target_key)
                .and_then(|value| value.as_str())
                .and_then(|value| normalize_title_text(Some(value)))
            {
                return Some(direct);
            }

            map.values()
                .filter_map(|value| find_string_field_recursive(value, target_key))
                .last()
        }
        serde_json::Value::Array(values) => values
            .iter()
            .filter_map(|value| find_string_field_recursive(value, target_key))
            .last(),
        _ => None,
    }
}

fn find_string_value_recursive(
    value: &serde_json::Value,
    predicate: &impl Fn(&str) -> Option<String>,
) -> Option<String> {
    match value {
        serde_json::Value::String(text) => predicate(text),
        serde_json::Value::Object(map) => map
            .values()
            .filter_map(|value| find_string_value_recursive(value, predicate))
            .last(),
        serde_json::Value::Array(values) => values
            .iter()
            .filter_map(|value| find_string_value_recursive(value, predicate))
            .last(),
        _ => None,
    }
}

fn normalize_trimmed_text(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_title_text(value: Option<&str>) -> Option<String> {
    let normalized = value
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_message_preview_text(value: Option<&str>) -> Option<String> {
    let normalized = normalize_title_text(value)?;
    if is_codex_title_candidate(&normalized) {
        Some(normalized)
    } else {
        None
    }
}

fn parse_codex_rename_command(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if !trimmed.to_ascii_lowercase().starts_with("/rename") {
        return None;
    }

    let renamed = trimmed.get("/rename".len()..).unwrap_or_default().trim();
    normalize_title_text(Some(renamed))
}

fn parse_claude_rename_command(text: &str) -> Option<String> {
    if !text.contains("<command-name>/rename</command-name>") {
        return None;
    }

    let args_tag = "<command-args>";
    let args_start = text.find(args_tag)?;
    let args_value_start = args_start + args_tag.len();
    let args_end = text[args_value_start..].find("</command-args>")?;
    let args = &text[args_value_start..args_value_start + args_end];
    normalize_title_text(Some(args))
}

fn find_claude_rename_command(value: &serde_json::Value) -> Option<String> {
    find_string_value_recursive(value, &parse_claude_rename_command)
}

fn is_codex_title_candidate(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.starts_with('/') {
        return false;
    }

    !matches!(trimmed.to_ascii_lowercase().as_str(), "exit" | "resume")
}

fn truncate_unicode_preview_text(value: Option<&str>) -> Option<String> {
    let value = value?;
    let mut chars = value.chars();
    let mut result = String::new();

    for _ in 0..HISTORICAL_SESSION_PREVIEW_CHAR_LIMIT {
        match chars.next() {
            Some(ch) => result.push(ch),
            None => return Some(result),
        }
    }

    if chars.next().is_some() && HISTORICAL_SESSION_PREVIEW_CHAR_LIMIT > 0 {
        result.pop();
        result.push('…');
    }

    Some(result)
}

fn create_transcript_writer(pty_id: &str, path: PathBuf) -> Option<TranscriptWriter> {
    let eof_path = transcript_completion_marker_path(&path);
    if let Err(error) = std::fs::remove_file(&eof_path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(
            pty_id = %pty_id,
            path = %eof_path.display(),
            error = %error,
            "failed to clear PTY transcript completion marker"
        );
    }

    match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
    {
        Ok(file) => Some(TranscriptWriter {
            path,
            eof_path,
            file,
        }),
        Err(error) => {
            tracing::warn!(
                pty_id = %pty_id,
                path = %path.display(),
                error = %error,
                "failed to create PTY transcript file"
            );
            None
        }
    }
}

fn transcript_completion_marker_path(path: &Path) -> PathBuf {
    path.with_extension("eof")
}

fn persist_transcript_completion_marker(writer: &TranscriptWriter, offset: u64) {
    if let Err(error) = std::fs::write(&writer.eof_path, offset.to_string()) {
        tracing::warn!(
            path = %writer.eof_path.display(),
            error = %error,
            "failed to persist PTY transcript completion marker"
        );
    }
}

fn read_transcript_tail(
    path: &Path,
    limit_bytes: usize,
    cursor: Option<u64>,
) -> Result<Option<PtyOutputReplaySnapshot>, PtyError> {
    if !path.is_file() {
        return Ok(None);
    }

    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();
    let start = file_len.saturating_sub(clamp_output_buffer_limit_bytes(limit_bytes) as u64);
    file.seek(SeekFrom::Start(start))?;

    let mut data = Vec::with_capacity((file_len - start) as usize);
    file.read_to_end(&mut data)?;

    let snapshot = match cursor {
        None => PtyOutputReplaySnapshot {
            offset: start,
            data,
            truncated: start > 0,
        },
        Some(cursor) if cursor <= start => PtyOutputReplaySnapshot {
            offset: start,
            data,
            truncated: cursor < start,
        },
        Some(cursor) if cursor >= file_len => PtyOutputReplaySnapshot {
            offset: file_len,
            data: Vec::new(),
            truncated: false,
        },
        Some(cursor) => {
            let skip = (cursor - start) as usize;
            PtyOutputReplaySnapshot {
                offset: cursor,
                data: data[skip..].to_vec(),
                truncated: false,
            }
        }
    };

    Ok(Some(snapshot))
}

fn read_completed_transcript_tail(
    path: &Path,
    limit_bytes: usize,
    cursor: Option<u64>,
) -> Result<Option<PtyOutputReplaySnapshot>, PtyError> {
    let eof_path = transcript_completion_marker_path(path);
    if !eof_path.is_file() {
        return Ok(None);
    }

    read_transcript_tail(path, limit_bytes, cursor)
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
            if let Some(model) = request
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("--resume".to_string());
            args.push(request.session_id.clone());
            args.extend(request.extra_args.clone());
        }
        PtyAgentType::Codex => {
            args.push("resume".to_string());
            if let Some(model) = request
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
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
            args.extend(request.extra_args.clone());
            args.push(request.session_id.clone());
        }
    }

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
        if command.eq_ignore_ascii_case("claude") {
            return "claude.cmd".to_string();
        }
        if command.eq_ignore_ascii_case("codex") {
            return "codex.cmd".to_string();
        }
    }

    command.to_string()
}

fn resolve_workdir_path(workdir: Option<&str>) -> Result<PathBuf, PtyError> {
    let current_dir = std::env::current_dir()?;
    resolve_workdir_path_from(workdir, current_dir.as_path())
}

fn resolve_workdir_path_from(
    workdir: Option<&str>,
    current_dir: &Path,
) -> Result<PathBuf, PtyError> {
    let configured_agent_workdir = std::env::var("EXOMIND_RT_AGENT_WORKDIR")
        .ok()
        .map(PathBuf::from);
    let default_base_dir =
        crate::resolve_project_root_from(configured_agent_workdir.as_deref(), Some(current_dir));
    let trimmed = workdir.map(str::trim).filter(|value| !value.is_empty());

    Ok(match trimmed {
        Some(value) => {
            let candidate = PathBuf::from(value);
            if candidate.is_absolute() {
                candidate
            } else {
                default_base_dir.join(candidate)
            }
        }
        None => default_base_dir,
    })
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
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("03").join("18");
        fs::create_dir_all(&day_dir).unwrap();
        let session_path =
            day_dir.join("rollout-2026-03-18T10-20-30-019d0011-aaaa-bbbb-cccc-1234567890ab.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-03-18T02:20:32.696Z\",\"type\":\"session_meta\",",
                "\"payload\":{\"id\":\"019d0011-aaaa-bbbb-cccc-1234567890ab\",",
                "\"cwd\":\"D:\\\\project\\\\exomind\",\"originator\":\"codex_cli_rs\"}}\n",
                "{\"timestamp\":\"2026-03-18T02:20:33.000Z\",\"type\":\"event\",",
                "\"payload\":{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",",
                "\"text\":\"Investigate pane tree regression\"}]}}\n",
                "{\"timestamp\":\"2026-03-18T02:20:35.000Z\",\"type\":\"event\",",
                "\"payload\":{\"thread_name\":\"Codex renamed title\"}}\n",
                "{\"timestamp\":\"2026-03-18T02:25:35.000Z\",\"type\":\"event\",",
                "\"payload\":{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",",
                "\"text\":\"Verify fullscreen empty pane layout\"}]}}\n"
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].agent_type, PtyAgentType::Codex);
        assert_eq!(
            sessions[0].session_id,
            "019d0011-aaaa-bbbb-cccc-1234567890ab"
        );
        assert_eq!(sessions[0].project_path, "D:\\project\\exomind");
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Codex renamed title")
        );
        assert_eq!(
            sessions[0].display_path.as_deref(),
            Some("D:\\project\\exomind")
        );
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("Investigate pane tree regression")
        );
        assert_eq!(
            sessions[0].last_user_message.as_deref(),
            Some("Verify fullscreen empty pane layout")
        );
    }

    #[test]
    fn discover_codex_sessions_prefers_history_user_previews_over_head_scan() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("04").join("06");
        fs::create_dir_all(&day_dir).unwrap();
        let session_path = day_dir.join("rollout-2026-04-06T10-20-30-codex-session-1.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-04-06T10:20:32.696Z\",\"type\":\"session_meta\",",
                "\"payload\":{\"id\":\"codex-session-1\",\"cwd\":\"D:\\\\project\\\\exomind\"}}\n",
                "{\"timestamp\":\"2026-04-06T10:20:33.000Z\",\"type\":\"event\",",
                "\"payload\":{\"thread_name\":\"Codex renamed title\"}}\n",
                "{\"timestamp\":\"2026-04-06T10:20:34.000Z\",\"type\":\"event\",",
                "\"payload\":{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",",
                "\"text\":\"Head scan prompt\"}]}}\n"
            ),
        )
        .unwrap();
        fs::write(
            codex_root.join("history.jsonl"),
            concat!(
                "{\"session_id\":\"codex-session-1\",\"ts\":1,\"text\":\"Investigate pane tree regression\"}\n",
                "{\"session_id\":\"codex-session-1\",\"ts\":2,\"text\":\"Verify fullscreen empty pane layout\"}\n"
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Codex renamed title")
        );
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("Investigate pane tree regression")
        );
        assert_eq!(
            sessions[0].last_user_message.as_deref(),
            Some("Verify fullscreen empty pane layout")
        );
    }

    /// Tests that session_index.jsonl is used as a fallback for display_title
    /// when the session file itself has no thread_name event.
    #[test]
    fn discover_codex_sessions_reads_session_index_thread_name() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("04").join("13");
        fs::create_dir_all(&day_dir).unwrap();
        let session_path =
            day_dir.join("rollout-2026-04-13T10-20-30-019d8888-aaaa-bbbb-cccc-1234567890ab.jsonl");
        // Session file has no thread_name event — only session_meta
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-04-13T02:20:32.696Z\",\"type\":\"session_meta\",",
                "\"payload\":{\"id\":\"019d8888-aaaa-bbbb-cccc-1234567890ab\",",
                "\"cwd\":\"D:\\\\project\\\\exomind\",\"originator\":\"codex_cli_rs\"}}\n",
                "{\"timestamp\":\"2026-04-13T02:20:33.000Z\",\"type\":\"event\",",
                "\"payload\":{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",",
                "\"text\":\"Some user prompt\"}]}}\n"
            ),
        )
        .unwrap();
        // session_index.jsonl has the thread_name
        fs::write(
            codex_root.join("session_index.jsonl"),
            concat!(
                "{\"id\":\"019d8888-aaaa-bbbb-cccc-1234567890ab\",",
                "\"thread_name\":\"issue跟踪\",\"updated_at\":\"2026-04-13T02:06:02.19584Z\"}\n"
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].session_id,
            "019d8888-aaaa-bbbb-cccc-1234567890ab"
        );
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("issue跟踪")
        );
    }

    /// Tests that session file's thread_name takes priority over session_index.jsonl.
    #[test]
    fn discover_codex_sessions_prefers_session_file_over_index() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("04").join("13");
        fs::create_dir_all(&day_dir).unwrap();
        let session_path =
            day_dir.join("rollout-2026-04-13T10-20-30-019d9999-aaaa-bbbb-cccc-1234567890ab.jsonl");
        // Session file has thread_name "Session file title"
        fs::write(
            &session_path,
            concat!(
                "{\"timestamp\":\"2026-04-13T02:20:32.696Z\",\"type\":\"session_meta\",",
                "\"payload\":{\"id\":\"019d9999-aaaa-bbbb-cccc-1234567890ab\",",
                "\"cwd\":\"D:\\\\project\\\\exomind\"}}\n",
                "{\"timestamp\":\"2026-04-13T02:20:35.000Z\",\"type\":\"event\",",
                "\"payload\":{\"thread_name\":\"Session file title\"}}\n"
            ),
        )
        .unwrap();
        // session_index.jsonl has "Index title" — should NOT be used
        fs::write(
            codex_root.join("session_index.jsonl"),
            concat!(
                "{\"id\":\"019d9999-aaaa-bbbb-cccc-1234567890ab\",",
                "\"thread_name\":\"Index title\",\"updated_at\":\"2026-04-13T03:00:00.00000Z\"}\n"
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Session file title")
        );
    }

    #[test]
    fn discover_codex_sessions_prefers_session_index_over_history_prompt_fallback() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("04").join("13");
        fs::create_dir_all(&day_dir).unwrap();
        let session_id = "019d7777-aaaa-bbbb-cccc-1234567890ab";
        let session_path =
            day_dir.join(format!("rollout-2026-04-13T10-20-30-{session_id}.jsonl"));
        fs::write(
            &session_path,
            format!(
                concat!(
                    "{{\"timestamp\":\"2026-04-13T02:20:32.696Z\",\"type\":\"session_meta\",",
                    "\"payload\":{{\"id\":\"{session_id}\",",
                    "\"cwd\":\"D:\\\\project\\\\exomind\",\"originator\":\"codex_cli_rs\"}}}}\n",
                    "{{\"timestamp\":\"2026-04-13T02:20:33.000Z\",\"type\":\"event\",",
                    "\"payload\":{{\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",",
                    "\"text\":\"Session file prompt\"}}]}}}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();
        fs::write(
            codex_root.join("history.jsonl"),
            format!(
                concat!(
                    "{{\"session_id\":\"{session_id}\",\"ts\":1,\"text\":\"/model gpt-5.4\"}}\n",
                    "{{\"session_id\":\"{session_id}\",\"ts\":2,\"text\":\"History prompt title\"}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();
        fs::write(
            codex_root.join("session_index.jsonl"),
            format!(
                concat!(
                    "{{\"id\":\"{session_id}\",",
                    "\"thread_name\":\"Index rename title\",",
                    "\"updated_at\":\"2026-04-13T02:06:02.19584Z\"}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, session_id);
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Index rename title")
        );
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("History prompt title")
        );
        assert_eq!(
            sessions[0].last_user_message.as_deref(),
            Some("History prompt title")
        );
    }

    #[test]
    fn discover_codex_sessions_prefers_session_index_over_history_rename() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        let day_dir = sessions_dir.join("2026").join("04").join("13");
        fs::create_dir_all(&day_dir).unwrap();
        let session_id = "019d7778-aaaa-bbbb-cccc-1234567890ab";
        let session_path =
            day_dir.join(format!("rollout-2026-04-13T10-20-30-{session_id}.jsonl"));
        fs::write(
            &session_path,
            format!(
                concat!(
                    "{{\"timestamp\":\"2026-04-13T02:20:32.696Z\",\"type\":\"session_meta\",",
                    "\"payload\":{{\"id\":\"{session_id}\",",
                    "\"cwd\":\"D:\\\\project\\\\exomind\",\"originator\":\"codex_cli_rs\"}}}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();
        fs::write(
            codex_root.join("history.jsonl"),
            format!(
                concat!(
                    "{{\"session_id\":\"{session_id}\",\"ts\":1,\"text\":\"/rename History rename title\"}}\n",
                    "{{\"session_id\":\"{session_id}\",\"ts\":2,\"text\":\"Follow-up history prompt\"}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();
        fs::write(
            codex_root.join("session_index.jsonl"),
            format!(
                concat!(
                    "{{\"id\":\"{session_id}\",",
                    "\"thread_name\":\"Index rename title\",",
                    "\"updated_at\":\"2026-04-13T02:06:02.19584Z\"}}\n"
                ),
                session_id = session_id,
            ),
        )
        .unwrap();

        let sessions = discover_codex_sessions(&sessions_dir);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, session_id);
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Index rename title")
        );
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("Follow-up history prompt")
        );
        assert_eq!(
            sessions[0].last_user_message.as_deref(),
            Some("Follow-up history prompt")
        );
    }

    #[test]
    fn build_resume_spawn_request_supports_codex_interactive_resume() {
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
                "resume".to_string(),
                "-m".to_string(),
                "gpt-5.4".to_string(),
                "-c".to_string(),
                "model_reasoning_effort=\"xhigh\"".to_string(),
                "--search".to_string(),
                "--full-auto".to_string(),
                "019d0011-aaaa-bbbb-cccc-1234567890ab".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_spawn_command_uses_windows_cli_shims_for_builtin_agents() {
        if cfg!(windows) {
            assert_eq!(resolve_spawn_command("claude"), "claude.cmd");
            assert_eq!(resolve_spawn_command("codex"), "codex.cmd");
            assert_eq!(resolve_spawn_command("CLAUDE"), "claude.cmd");
        } else {
            assert_eq!(resolve_spawn_command("claude"), "claude");
            assert_eq!(resolve_spawn_command("codex"), "codex");
        }
    }

    #[test]
    fn resolve_spawn_command_keeps_custom_commands_unchanged() {
        assert_eq!(resolve_spawn_command("pwsh"), "pwsh");
        assert_eq!(resolve_spawn_command("claude.cmd"), "claude.cmd");
        assert_eq!(
            resolve_spawn_command("C:/tools/claude.exe"),
            "C:/tools/claude.exe"
        );
    }

    #[test]
    fn resolve_workdir_path_defaults_to_current_dir() {
        let resolved = resolve_workdir_path(None).expect("current dir should resolve");
        assert!(resolved.is_absolute());
        assert_eq!(
            resolved,
            crate::resolve_project_root_from(None, std::env::current_dir().ok().as_deref())
        );
    }

    #[test]
    fn resolve_workdir_path_expands_relative_input_against_current_dir() {
        let resolved = resolve_workdir_path(Some(".")).expect("relative workdir should resolve");
        assert!(resolved.is_absolute());
        assert_eq!(
            resolved,
            crate::resolve_project_root_from(None, std::env::current_dir().ok().as_deref())
        );
    }

    #[test]
    fn resolve_workdir_path_defaults_to_workspace_root_when_cwd_has_no_agent_entries() {
        let workspace_root =
            crate::workspace_root_from_manifest().expect("workspace root should resolve");
        let fake_cwd = workspace_root.join("src-tauri");

        let resolved = resolve_workdir_path_from(None, fake_cwd.as_path())
            .expect("default workdir should resolve from workspace root");
        assert_eq!(resolved, workspace_root);
    }

    #[test]
    fn resolve_workdir_path_expands_relative_input_against_workspace_root_when_cwd_has_no_agent_entries()
     {
        let workspace_root =
            crate::workspace_root_from_manifest().expect("workspace root should resolve");
        let fake_cwd = workspace_root.join("src-tauri");

        let resolved = resolve_workdir_path_from(Some("."), fake_cwd.as_path())
            .expect("relative workdir should resolve against workspace root");
        assert_eq!(resolved, workspace_root);
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
    fn discover_claude_sessions_reads_display_metadata_from_sessions_index() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("project-a");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("sess-1.jsonl"),
            concat!(
                "{\"message\":{\"role\":\"user\",\"content\":\"Plan pane tree recovery\"},\"sessionId\":\"sess-1\"}\n",
                "{\"type\":\"custom-title\",\"customTitle\":\"Claude renamed title\",\"sessionId\":\"sess-1\"}\n",
                "{\"type\":\"agent-name\",\"agentName\":\"Fallback agent name\",\"sessionId\":\"sess-1\"}\n",
                "{\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Validate fullscreen empty pane layout\"}]},\"sessionId\":\"sess-1\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            project_dir.join("sessions-index.json"),
            r#"{
                "version": 1,
                "entries": [
                    {
                        "sessionId": "sess-1",
                        "summary": "Index summary fallback",
                        "firstPrompt": "fallback prompt",
                        "projectPath": "D:\\project\\exomind",
                        "modified": "2026-04-05T02:20:32.696Z"
                    }
                ]
            }"#,
        )
        .unwrap();

        let sessions = discover_claude_sessions(&dir.path().to_path_buf());
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-1");
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Claude renamed title")
        );
        assert_eq!(
            sessions[0].display_path.as_deref(),
            Some("D:\\project\\exomind")
        );
        assert_eq!(sessions[0].last_modified, "2026-04-05T02:20:32.696Z");
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("Plan pane tree recovery")
        );
        assert_eq!(
            sessions[0].last_user_message.as_deref(),
            Some("Validate fullscreen empty pane layout")
        );
    }

    #[test]
    fn discover_claude_sessions_falls_back_to_index_first_prompt_for_first_message() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("project-a");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(project_dir.join("sess-1.jsonl"), "{}").unwrap();
        fs::write(
            project_dir.join("sessions-index.json"),
            r#"{
                "version": 1,
                "entries": [
                    {
                        "sessionId": "sess-1",
                        "summary": "Index summary fallback",
                        "firstPrompt": "Fallback first user prompt",
                        "projectPath": "D:\\project\\exomind",
                        "modified": "2026-04-05T02:20:32.696Z"
                    }
                ]
            }"#,
        )
        .unwrap();

        let sessions = discover_claude_sessions(&dir.path().to_path_buf());
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].first_user_message.as_deref(),
            Some("Fallback first user prompt")
        );
        assert_eq!(sessions[0].last_user_message, None);
    }

    #[test]
    fn discover_claude_sessions_prefers_index_summary_over_agent_name_fallback() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("project-a");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join("sess-1.jsonl"),
            concat!(
                "{\"type\":\"agent-name\",\"agentName\":\"Fallback agent name\",\"sessionId\":\"sess-1\"}\n",
                "{\"message\":{\"role\":\"user\",\"content\":\"Plan pane tree recovery\"},\"sessionId\":\"sess-1\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            project_dir.join("sessions-index.json"),
            r#"{
                "version": 1,
                "entries": [
                    {
                        "sessionId": "sess-1",
                        "summary": "Index summary fallback",
                        "firstPrompt": "Fallback first user prompt",
                        "projectPath": "D:\\project\\exomind",
                        "modified": "2026-04-05T02:20:32.696Z"
                    }
                ]
            }"#,
        )
        .unwrap();

        let sessions = discover_claude_sessions(&dir.path().to_path_buf());
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].display_title.as_deref(),
            Some("Index summary fallback")
        );
    }

    #[test]
    fn read_codex_history_meta_falls_back_to_first_user_prompt() {
        let dir = tempdir().unwrap();
        let codex_root = dir.path().join(".codex");
        let sessions_dir = codex_root.join("sessions");
        fs::create_dir_all(&sessions_dir).unwrap();
        fs::write(
            codex_root.join("history.jsonl"),
            concat!(
                "{\"session_id\":\"codex-session-1\",\"ts\":1,\"text\":\"/model codex 5.2\"}\n",
                "{\"session_id\":\"codex-session-1\",\"ts\":2,\"text\":\"Investigate pane tree regression\"}\n"
            ),
        )
        .unwrap();

        let history_meta = read_codex_history_meta(&sessions_dir);
        assert_eq!(
            history_meta
                .get("codex-session-1")
                .and_then(|meta| meta.display_title.as_deref()),
            Some("Investigate pane tree regression")
        );
        assert_eq!(
            history_meta
                .get("codex-session-1")
                .and_then(|meta| meta.first_user_message.as_deref()),
            Some("Investigate pane tree regression")
        );
        assert_eq!(
            history_meta
                .get("codex-session-1")
                .and_then(|meta| meta.last_user_message.as_deref()),
            Some("Investigate pane tree regression")
        );
    }

    #[test]
    fn historical_session_preview_truncates_user_messages_to_200_unicode_chars() {
        let long_preview = "界".repeat(205);
        let preview = PtyHistoricalSessionInfo {
            agent_type: PtyAgentType::Codex,
            session_id: "codex-preview-session".to_string(),
            project_path: "D:/project/exomind".to_string(),
            last_modified: "2026-04-06T10:20:32.696Z".to_string(),
            display_title: Some("Codex preview".to_string()),
            display_path: Some("D:/project/exomind".to_string()),
            first_user_message: Some(long_preview.clone()),
            last_user_message: Some(long_preview),
        }
        .into_preview();

        let first_preview = preview
            .first_user_message_preview
            .as_deref()
            .expect("first preview should exist");
        let last_preview = preview
            .last_user_message_preview
            .as_deref()
            .expect("last preview should exist");

        assert_eq!(first_preview.chars().count(), 200);
        assert_eq!(last_preview.chars().count(), 200);
        assert!(first_preview.ends_with('…'));
        assert!(last_preview.ends_with('…'));
    }

    #[test]
    fn read_transcript_tail_respects_runtime_scrollback_limit() {
        let dir = tempdir().unwrap();
        let transcript_path = dir.path().join("tail.log");
        let expected_limit = MIN_OUTPUT_BUFFER_LIMIT_BYTES;
        let requested_limit = 64 * 1024;
        let data = (0..(expected_limit + 64 * 1024))
            .map(|value| (value % 251) as u8)
            .collect::<Vec<_>>();
        fs::write(&transcript_path, &data).unwrap();

        let replay = read_transcript_tail(&transcript_path, requested_limit, None)
            .unwrap()
            .expect("tail should exist");

        assert_eq!(replay.offset, (data.len() - expected_limit) as u64);
        assert!(replay.truncated);
        assert_eq!(replay.data.len(), expected_limit);
        assert_eq!(replay.data, data[data.len() - expected_limit..].to_vec());
    }

    #[test]
    fn slice_output_replay_snapshot_clamps_future_cursor_to_buffer_end() {
        let snapshot = slice_output_replay_snapshot(
            &PtyOutputBufferState {
                start_offset: 10,
                data: b"hello".to_vec(),
                eof_offset: None,
            },
            Some(999),
        );

        assert_eq!(snapshot.offset, 15);
        assert!(snapshot.data.is_empty());
        assert!(!snapshot.truncated);
    }

    #[test]
    fn read_transcript_tail_clamps_future_cursor_to_file_end() {
        let dir = tempdir().unwrap();
        let transcript_path = dir.path().join("cursor-tail.log");
        fs::write(&transcript_path, b"abcdef").unwrap();

        let replay = read_transcript_tail(&transcript_path, 1024, Some(999))
            .unwrap()
            .expect("tail should exist");

        assert_eq!(replay.offset, 6);
        assert!(replay.data.is_empty());
        assert!(!replay.truncated);
    }

    #[test]
    fn read_completed_transcript_tail_requires_completion_marker() {
        let dir = tempdir().unwrap();
        let transcript_path = dir.path().join("completed-tail.log");
        fs::write(&transcript_path, b"abcdef").unwrap();

        assert!(
            read_completed_transcript_tail(&transcript_path, 1024, None)
                .unwrap()
                .is_none()
        );

        let eof_path = transcript_completion_marker_path(&transcript_path);
        fs::write(&eof_path, b"6").unwrap();

        let replay = read_completed_transcript_tail(&transcript_path, 1024, None)
            .unwrap()
            .expect("completed tail should exist");
        assert_eq!(replay.offset, 0);
        assert_eq!(replay.data, b"abcdef".to_vec());
        assert!(!replay.truncated);
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
