//! Runtime 服务命令
//! 提供桌面端 Agent Runtime 的启动、停止与状态查询

use chrono::Utc;
use serde::Serialize;
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

fn lock_or_error<T>(mutex: &Mutex<T>, label: &str) -> Result<std::sync::MutexGuard<'_, T>, String> {
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

    let runtime_port = port.unwrap_or(4077);
    if runtime_port == 0 {
        return Err("runtime port must be greater than 0".to_string());
    }

    let mut child_guard = lock_or_error(&state.child, "child")?;
    let (running, pid) = refresh_child_running_state(&mut child_guard)?;
    if running {
        return current_status(&state.inner().clone(), true, pid, None);
    }

    let script_path = std::env::current_dir()
        .map_err(|error| format!("failed to resolve current directory: {error}"))?
        .join("server")
        .join("agent-runtime-server.js");

    if !script_path.exists() {
        return Err(format!("runtime entry not found: {}", script_path.to_string_lossy()));
    }

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

    if let Some(child) = child_guard.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
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
