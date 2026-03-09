use chrono::{DateTime, Utc};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

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
// Enums & public structs (serializable for HTTP API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PtyAgentStatus {
    Running,
    Stopped,
    Exited { code: i32 },
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
    pub name: String,
    pub workdir: Option<String>,
    pub session_id: String,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSessionInfo {
    pub session_id: String,
    pub project_path: String,
    pub last_modified: String,
}

// ---------------------------------------------------------------------------
// Internal PTY instance (not serializable — holds OS resources)
// ---------------------------------------------------------------------------

struct PtyInstance {
    info: PtyAgentInfo,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Arc<Mutex<Box<dyn Read + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
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

        let mut cmd = CommandBuilder::new(&request.command);
        for arg in &request.args {
            cmd.arg(arg);
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

        let info = PtyAgentInfo {
            id: id.clone(),
            name: request.name,
            session_id: None,
            workdir: request.workdir.unwrap_or_default(),
            command: request.command,
            status: PtyAgentStatus::Running,
            created_at: now.to_rfc3339(),
        };

        let instance = PtyInstance {
            info: info.clone(),
            master: pair.master,
            child,
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
        };

        self.instances.lock().await.insert(id, instance);

        self.publish_lifecycle_signal("pty.spawned", &info);

        Ok(info)
    }

    /// Resume an existing Claude session by spawning with `--resume --session-id`.
    pub async fn resume(&self, request: PtyResumeRequest) -> Result<PtyAgentInfo, PtyError> {
        let spawn_request = PtySpawnRequest {
            name: request.name,
            workdir: request.workdir,
            command: default_command(),
            args: vec![
                "--resume".to_string(),
                "--session-id".to_string(),
                request.session_id.clone(),
            ],
            rows: request.rows,
            cols: request.cols,
        };

        let mut info = self.spawn(spawn_request).await?;
        // Attach the session_id to the info and update the stored instance.
        info.session_id = Some(request.session_id);
        {
            let mut instances = self.instances.lock().await;
            if let Some(instance) = instances.get_mut(&info.id) {
                instance.info.session_id = info.session_id.clone();
            }
        }

        Ok(info)
    }

    /// Write raw input data to the PTY.
    pub async fn write_input(&self, id: &str, data: &[u8]) -> Result<(), PtyError> {
        let instances = self.instances.lock().await;
        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        let mut writer = instance.writer.lock().await;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    /// Get a cloned Arc of the reader for SSE streaming.
    pub async fn get_reader(
        &self,
        id: &str,
    ) -> Result<Arc<Mutex<Box<dyn Read + Send>>>, PtyError> {
        let instances = self.instances.lock().await;
        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        Ok(Arc::clone(&instance.reader))
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

    /// Discover existing Claude CLI sessions from ~/.claude/projects/.
    pub fn list_claude_sessions() -> Vec<ClaudeSessionInfo> {
        match dirs_claude_projects() {
            Some(projects_dir) => discover_claude_sessions(&projects_dir),
            None => Vec::new(),
        }
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

/// Scan the Claude projects directory for session JSONL files.
///
/// Directory structure: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`
fn discover_claude_sessions(projects_dir: &PathBuf) -> Vec<ClaudeSessionInfo> {
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

            sessions.push(ClaudeSessionInfo {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
