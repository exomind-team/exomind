//! Runtime 服务命令（embedded mode，内嵌模式）
//! 提供桌面端 Runtime 的启动、停止与状态查询。

use chrono::Utc;
use exomind_runtime::{
    start_with_options, RuntimeHandle, RuntimePublishRequest, RuntimeStartOptions, DEFAULT_RT_PORT,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;
use tokio::time::{sleep, Duration};

struct RuntimeInner {
    handle: Option<RuntimeHandle>,
    host: String,
    port: u16,
    started_at: Option<String>,
    last_error: Option<String>,
}

pub struct RuntimeProcessState {
    inner: Mutex<RuntimeInner>,
}

impl RuntimeProcessState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RuntimeInner {
                handle: None,
                host: "127.0.0.1".to_string(),
                port: DEFAULT_RT_PORT,
                started_at: None,
                last_error: None,
            }),
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

#[derive(Debug, Deserialize)]
pub struct SignalPublishFastRequest {
    pub topic: String,
    pub source: Option<String>,
    pub payload: serde_json::Value,
    pub trace_id: Option<String>,
    pub origin_host_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SignalPublishFastResponse {
    pub accepted: bool,
    pub event_id: String,
}

fn lock_or_error<'a>(
    state: &'a Arc<RuntimeProcessState>,
) -> Result<std::sync::MutexGuard<'a, RuntimeInner>, String> {
    state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())
}

fn compose_status(
    inner: &RuntimeInner,
    running: bool,
    error: Option<String>,
) -> RuntimeServiceStatus {
    RuntimeServiceStatus {
        running,
        host: inner.host.clone(),
        port: inner.port,
        pid: running.then_some(std::process::id()),
        started_at: inner.started_at.clone(),
        error: error.or_else(|| inner.last_error.clone()),
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

pub async fn ensure_runtime_started(
    state: Arc<RuntimeProcessState>,
    host: Option<String>,
    port: Option<u16>,
) -> Result<RuntimeServiceStatus, String> {
    let mut options = RuntimeStartOptions::default();
    let runtime_host = host
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| options.bind_host.clone());

    if runtime_host.is_empty() {
        return Err("runtime host is required".to_string());
    }
    if !is_valid_host(&runtime_host) {
        return Err("invalid host format: must be a valid IP address or hostname".to_string());
    }

    options.bind_host = runtime_host;
    if let Some(runtime_port) = port {
        options.port = runtime_port;
    }

    // Fast path: already running（快速路径：已在运行）
    {
        let mut inner = lock_or_error(&state)?;
        let running_snapshot = inner
            .handle
            .as_ref()
            .and_then(|handle| handle.is_running().then(|| (handle.host(), handle.port())));
        if let Some((host, port)) = running_snapshot {
            inner.host = host;
            inner.port = port;
            inner.last_error = None;
            return Ok(compose_status(&inner, true, None));
        }
    }

    // 等待端口可用（处理热重载时旧端口 TIME_WAIT 延迟，最多等 2s）
    {
        use std::net::TcpListener as StdTcpListener;
        let addr = format!("{}:{}", options.bind_host, options.port);
        for i in 0..20u8 {
            if StdTcpListener::bind(&addr).is_ok() {
                break;
            }
            if i == 0 {
                eprintln!("[tauri/setup] port {} busy, waiting for release...", options.port);
            }
            sleep(Duration::from_millis(100)).await;
        }
    }

    let handle = match start_with_options(options).await {
        Ok(handle) => handle,
        Err(error) => {
            // Handle startup race gracefully（处理并发启动竞争）.
            for _ in 0..10 {
                if let Ok(status) = runtime_status_snapshot(state.clone()) {
                    if status.running {
                        return Ok(status);
                    }
                }
                sleep(Duration::from_millis(25)).await;
            }

            let message = format!("failed to start embedded runtime: {error}");
            let mut inner = lock_or_error(&state)?;
            inner.last_error = Some(message.clone());
            return Err(message);
        }
    };
    let started_host = handle.host();
    let started_port = handle.port();

    let mut inner = lock_or_error(&state)?;
    inner.host = started_host;
    inner.port = started_port;
    inner.started_at = Some(Utc::now().to_rfc3339());
    inner.last_error = None;
    inner.handle = Some(handle);
    Ok(compose_status(&inner, true, None))
}

pub async fn ensure_runtime_stopped(
    state: Arc<RuntimeProcessState>,
) -> Result<RuntimeServiceStatus, String> {
    let mut handle = { lock_or_error(&state)?.handle.take() };

    if let Some(runtime) = handle.as_mut() {
        runtime
            .stop()
            .await
            .map_err(|error| format!("failed to stop embedded runtime: {error}"))?;
    }

    let mut inner = lock_or_error(&state)?;
    inner.started_at = None;
    inner.last_error = None;
    Ok(compose_status(&inner, false, None))
}

pub fn runtime_status_snapshot(
    state: Arc<RuntimeProcessState>,
) -> Result<RuntimeServiceStatus, String> {
    let mut inner = lock_or_error(&state)?;
    let running_snapshot = inner
        .handle
        .as_ref()
        .and_then(|handle| handle.is_running().then(|| (handle.host(), handle.port())));

    let running = if let Some((host, port)) = running_snapshot {
        inner.host = host;
        inner.port = port;
        true
    } else {
        inner.started_at = None;
        false
    };

    Ok(compose_status(&inner, running, None))
}

#[tauri::command]
pub async fn runtime_service_start(
    state: State<'_, Arc<RuntimeProcessState>>,
    host: Option<String>,
    port: Option<u16>,
) -> Result<RuntimeServiceStatus, String> {
    ensure_runtime_started(state.inner().clone(), host, port).await
}

#[tauri::command]
pub async fn runtime_service_stop(
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<RuntimeServiceStatus, String> {
    ensure_runtime_stopped(state.inner().clone()).await
}

#[tauri::command]
pub fn runtime_service_status(
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<RuntimeServiceStatus, String> {
    runtime_status_snapshot(state.inner().clone())
}

#[tauri::command]
pub fn signal_publish_fast(
    state: State<'_, Arc<RuntimeProcessState>>,
    request: SignalPublishFastRequest,
) -> Result<SignalPublishFastResponse, String> {
    let (signal_pool, host_id) = {
        let inner = lock_or_error(state.inner())?;
        let handle = inner
            .handle
            .as_ref()
            .ok_or_else(|| "embedded runtime not running".to_string())?;
        if !handle.is_running() {
            return Err("embedded runtime is not running".to_string());
        }
        (handle.clone_signal_pool(), handle.host_id().to_string())
    };

    let event_id = RuntimeHandle::publish_signal_to_pool(
        &signal_pool,
        &host_id,
        RuntimePublishRequest {
            topic: request.topic,
            source: request.source,
            payload: request.payload,
            trace_id: request.trace_id,
            origin_host_id: request.origin_host_id,
        },
    );

    Ok(SignalPublishFastResponse {
        accepted: true,
        event_id,
    })
}

#[cfg(test)]
mod tests {
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
