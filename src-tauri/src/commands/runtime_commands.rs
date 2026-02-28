//! Runtime 服务命令
//! 提供桌面端 Agent Runtime 的启动、停止与状态查询

use chrono::Utc;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct RuntimeProcessState {
    pub child: Mutex<Option<Child>>,
    pub host: Mutex<String>,
    pub port: Mutex<u16>,
    pub started_at: Mutex<Option<String>>,
}

impl RuntimeProcessState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            host: Mutex::new("127.0.0.1".to_string()),
            port: Mutex::new(4077),
            started_at: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeServiceStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub error: Option<String>,
}

fn lock_or_error<'a, T>(mutex: &'a Mutex<T>, label: &str) -> Result<std::sync::MutexGuard<'a, T>, String> {
    mutex
        .lock()
        .map_err(|_| format!("failed to lock runtime state: {label}"))
}

fn current_status(state: &Arc<RuntimeProcessState>, running: bool, pid: Option<u32>, error: Option<String>) -> Result<RuntimeServiceStatus, String> {
    let host = lock_or_error(&state.host, "host")?.clone();
    let port = *lock_or_error(&state.port, "port")?;
    let started_at = lock_or_error(&state.started_at, "started_at")?.clone();

    Ok(RuntimeServiceStatus {
        running,
        host,
        port,
        pid,
        started_at,
        error,
    })
}

fn refresh_child_running_state(child: &mut Option<Child>) -> Result<(bool, Option<u32>), String> {
    if let Some(process) = child.as_mut() {
        match process.try_wait() {
            Ok(Some(_)) => {
                *child = None;
                Ok((false, None))
            }
            Ok(None) => Ok((true, Some(process.id()))),
            Err(error) => Err(format!("runtime process status check failed: {error}")),
        }
    } else {
        Ok((false, None))
    }
}

fn runtime_entry_candidates(base_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut push_candidate = |path: PathBuf| {
        if !candidates.iter().any(|item| item == &path) {
            candidates.push(path);
        }
    };

    push_candidate(base_dir.join("server").join("agent-runtime-server.js"));

    if let Some(parent) = base_dir.parent() {
        push_candidate(parent.join("server").join("agent-runtime-server.js"));
    }

    let manifest_parent = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf());
    if let Some(root) = manifest_parent {
        push_candidate(root.join("server").join("agent-runtime-server.js"));
    }

    candidates
}

fn resolve_runtime_entry_path_from_base(base_dir: &Path) -> Result<PathBuf, String> {
    // Canonicalize base_dir to prevent path traversal
    let canonical_base = base_dir
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize base directory: {e}"))?;

    let candidates = runtime_entry_candidates(&canonical_base);
    for path in &candidates {
        if path.exists() {
            // Canonicalize resolved path to eliminate any remaining .. components
            let canonical = path
                .canonicalize()
                .map_err(|e| format!("failed to canonicalize runtime entry path: {e}"))?;
            return Ok(canonical);
        }
    }

    #[cfg(debug_assertions)]
    {
        let searched = candidates
            .iter()
            .map(|item| item.to_string_lossy().to_string())
            .collect::<Vec<String>>()
            .join(" | ");
        Err(format!("runtime entry not found: {searched}"))
    }
    #[cfg(not(debug_assertions))]
    {
        Err("runtime entry not found".to_string())
    }
}

fn is_valid_host(host: &str) -> bool {
    // Allow IPv4
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    // Allow IPv6
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        return true;
    }
    // Allow valid hostnames: alphanumeric, hyphens, dots
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !label.starts_with('-')
            && !label.ends_with('-')
    })
}

fn resolve_runtime_entry_path() -> Result<PathBuf, String> {
    let base_dir = std::env::current_dir()
        .map_err(|_error| {
            #[cfg(debug_assertions)]
            { format!("failed to resolve current directory: {_error}") }
            #[cfg(not(debug_assertions))]
            { "failed to resolve current directory".to_string() }
        })?;
    resolve_runtime_entry_path_from_base(&base_dir)
}

#[tauri::command]
pub fn runtime_service_start(
    _app: AppHandle,
    state: State<'_, Arc<RuntimeProcessState>>,
    host: Option<String>,
    port: Option<u16>,
) -> Result<RuntimeServiceStatus, String> {
    let runtime_host = host.unwrap_or_else(|| "127.0.0.1".to_string()).trim().to_string();
    if runtime_host.is_empty() {
        return Err("runtime host is required".to_string());
    }

    if !is_valid_host(&runtime_host) {
        return Err("invalid host format: must be a valid IP address or hostname".to_string());
    }

    let runtime_port = port.unwrap_or(4077);
    if runtime_port == 0 {
        return Err("runtime port must be greater than 0".to_string());
    }

    let mut child_guard = lock_or_error(&state.child, "child")?;
    let (running, pid) = refresh_child_running_state(&mut child_guard)?;
    if running {
        return current_status(&state.inner().clone(), true, pid, None);
    }

    let script_path = resolve_runtime_entry_path()?;

    let child = Command::new("bun")
        .arg(script_path.to_string_lossy().to_string())
        .arg("--host")
        .arg(runtime_host.clone())
        .arg("--port")
        .arg(runtime_port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to start runtime process: {error}"))?;

    let pid = Some(child.id());
    *child_guard = Some(child);

    *lock_or_error(&state.host, "host")? = runtime_host.clone();
    *lock_or_error(&state.port, "port")? = runtime_port;
    *lock_or_error(&state.started_at, "started_at")? = Some(Utc::now().to_rfc3339());

    current_status(&state.inner().clone(), true, pid, None)
}

#[tauri::command]
pub fn runtime_service_stop(state: State<'_, Arc<RuntimeProcessState>>) -> Result<RuntimeServiceStatus, String> {
    let mut child_guard = lock_or_error(&state.child, "child")?;

    if let Some(process) = child_guard.as_mut() {
        process
            .kill()
            .map_err(|error| format!("failed to stop runtime process: {error}"))?;
        let _ = process.wait();
    }
    *child_guard = None;
    *lock_or_error(&state.started_at, "started_at")? = None;

    current_status(&state.inner().clone(), false, None, None)
}

#[tauri::command]
pub fn runtime_service_status(state: State<'_, Arc<RuntimeProcessState>>) -> Result<RuntimeServiceStatus, String> {
    let mut child_guard = lock_or_error(&state.child, "child")?;
    let (running, pid) = refresh_child_running_state(&mut child_guard)?;

    if !running {
        *lock_or_error(&state.started_at, "started_at")? = None;
    }

    current_status(&state.inner().clone(), running, pid, None)
}

#[cfg(test)]
mod tests {
    use super::resolve_runtime_entry_path_from_base;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_root(prefix: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{now}-{}", std::process::id()))
    }

    #[test]
    fn resolve_runtime_entry_uses_project_root_server_when_cwd_is_src_tauri() {
        let root = make_temp_root("runtime-entry-success");
        let src_tauri = root.join("src-tauri");
        let server_dir = root.join("server");
        let entry = server_dir.join("agent-runtime-server.js");

        fs::create_dir_all(&src_tauri).expect("should create src-tauri directory");
        fs::create_dir_all(&server_dir).expect("should create server directory");
        fs::write(&entry, "// runtime server").expect("should create runtime entry");

        let resolved = resolve_runtime_entry_path_from_base(&src_tauri).expect("should resolve runtime entry");
        let expected = entry.canonicalize().expect("should canonicalize expected entry");
        assert_eq!(resolved, expected);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_runtime_entry_falls_back_to_manifest_root() {
        let root = make_temp_root("runtime-entry-missing");
        let src_tauri = root.join("src-tauri");
        fs::create_dir_all(&src_tauri).expect("should create src-tauri directory");

        let resolved = resolve_runtime_entry_path_from_base(&src_tauri).expect("should fallback to manifest root server path");
        assert!(resolved.ends_with(PathBuf::from("server").join("agent-runtime-server.js")));
        assert!(resolved.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn is_valid_host_accepts_ipv4() {
        assert!(super::is_valid_host("127.0.0.1"));
        assert!(super::is_valid_host("192.168.1.1"));
        assert!(super::is_valid_host("0.0.0.0"));
    }

    #[test]
    fn is_valid_host_accepts_hostname() {
        assert!(super::is_valid_host("localhost"));
        assert!(super::is_valid_host("my-server.local"));
        assert!(super::is_valid_host("agent.exomind.dev"));
    }

    #[test]
    fn is_valid_host_rejects_invalid() {
        assert!(!super::is_valid_host(""));
        assert!(!super::is_valid_host("host with spaces"));
        assert!(!super::is_valid_host("../etc/passwd"));
        assert!(!super::is_valid_host("-invalid"));
        assert!(!super::is_valid_host("invalid-"));
    }
}
