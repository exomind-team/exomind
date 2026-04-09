use axum::{Json, extract::State};
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use sysinfo::System;

use crate::{RUNTIME_VERSION, RuntimeState};

#[derive(Debug, Clone)]
struct TopologyStaticInfo {
    hostname: String,
    os: String,
    arch: String,
    capabilities: RuntimeCapabilitiesResponse,
}

static TOPOLOGY_STATIC_INFO: OnceLock<TopologyStaticInfo> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeCapabilitiesResponse {
    pub agent_kinds: Vec<String>,
    pub api_providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeHostResponse {
    pub host_id: String,
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub version: &'static str,
    pub port: u16,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub capabilities: RuntimeCapabilitiesResponse,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceResponse {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub primary_runtime_host_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceComponentResponse {
    pub id: String,
    pub device_id: String,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub protocol: Option<String>,
    pub runtime_host_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceLinkResponse {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub transport: String,
    pub status: String,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct TopologyResponse {
    pub host_id: String,
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub version: &'static str,
    pub port: u16,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub capabilities: RuntimeCapabilitiesResponse,
    pub runtime_host: RuntimeHostResponse,
    pub device: DeviceResponse,
    pub device_components: Vec<DeviceComponentResponse>,
    pub device_links: Vec<DeviceLinkResponse>,
}

pub async fn get_topology(State(state): State<RuntimeState>) -> Json<TopologyResponse> {
    // Cache mostly-static host identity data（缓存基本静态的主机身份信息）.
    let static_info = TOPOLOGY_STATIC_INFO.get_or_init(build_static_info);
    let (total_memory_mb, used_memory_mb) = read_memory_stats_mb();
    let runtime_host = RuntimeHostResponse {
        host_id: state.host_id.clone(),
        hostname: static_info.hostname.clone(),
        os: static_info.os.clone(),
        arch: static_info.arch.clone(),
        uptime_secs: System::uptime(),
        version: RUNTIME_VERSION,
        port: state.port,
        total_memory_mb,
        used_memory_mb,
        capabilities: static_info.capabilities.clone(),
    };
    let device = DeviceResponse {
        id: state.host_id.clone(),
        name: static_info.hostname.clone(),
        kind: infer_device_kind(&static_info.os),
        primary_runtime_host_id: state.host_id.clone(),
    };

    Json(TopologyResponse {
        host_id: state.host_id.clone(),
        hostname: static_info.hostname.clone(),
        os: static_info.os.clone(),
        arch: static_info.arch.clone(),
        uptime_secs: System::uptime(),
        version: RUNTIME_VERSION,
        port: state.port,
        total_memory_mb,
        used_memory_mb,
        capabilities: static_info.capabilities.clone(),
        runtime_host,
        device,
        device_components: Vec::new(),
        device_links: Vec::new(),
    })
}

fn build_static_info() -> TopologyStaticInfo {
    TopologyStaticInfo {
        hostname: read_hostname(),
        os: read_os(),
        arch: read_arch(),
        capabilities: detect_runtime_capabilities(),
    }
}

fn detect_runtime_capabilities() -> RuntimeCapabilitiesResponse {
    let mut agent_kinds = vec!["api".to_string()];

    if command_exists("claude") {
        agent_kinds.push("claude_cli".to_string());
    }
    if command_exists("codex") {
        agent_kinds.push("codex_cli".to_string());
    }

    RuntimeCapabilitiesResponse {
        agent_kinds,
        api_providers: vec!["openai".to_string(), "anthropic".to_string()],
    }
}

fn read_hostname() -> String {
    System::host_name()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown-host".to_string())
}

fn read_os() -> String {
    System::long_os_version()
        .or_else(System::name)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| std::env::consts::OS.to_string())
}

fn read_arch() -> String {
    System::cpu_arch()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_string())
}

fn infer_device_kind(os: &str) -> String {
    let normalized = os.to_ascii_lowercase();
    if normalized.contains("android") {
        return "phone".to_string();
    }
    if normalized.contains("windows")
        || normalized.contains("mac")
        || normalized.contains("darwin")
        || normalized.contains("linux")
    {
        return "desktop".to_string();
    }
    "unknown".to_string()
}

fn read_memory_stats_mb() -> (u64, u64) {
    // sysinfo v0.30 reports memory in bytes（sysinfo v0.30 的内存单位是 bytes）.
    let mut system = System::new();
    system.refresh_memory();
    let total_memory_mb = bytes_to_mb(system.total_memory());
    let used_memory_mb = bytes_to_mb(system.used_memory());
    (total_memory_mb, used_memory_mb)
}

fn bytes_to_mb(bytes: u64) -> u64 {
    bytes / (1024 * 1024)
}

fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }

    let candidate = Path::new(command);
    if candidate.is_absolute() || command.contains(std::path::MAIN_SEPARATOR) {
        return candidate.is_file();
    }

    let Some(raw_path) = env::var_os("PATH") else {
        return false;
    };

    #[cfg(windows)]
    let path_exts: Vec<String> = env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();

    for dir in env::split_paths(&raw_path) {
        let base = dir.join(command);
        if base.is_file() {
            return true;
        }

        #[cfg(windows)]
        {
            if base.extension().is_none()
                && path_exts
                    .iter()
                    .map(|ext| PathBuf::from(format!("{command}{ext}")))
                    .any(|suffix| dir.join(suffix).is_file())
            {
                return true;
            }
        }
    }

    false
}
