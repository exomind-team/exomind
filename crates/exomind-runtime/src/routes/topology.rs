use axum::{Json, extract::State};
use serde::Serialize;
use std::sync::OnceLock;
use sysinfo::System;

use crate::{RUNTIME_VERSION, RuntimeState};

#[derive(Debug, Clone)]
struct TopologyStaticInfo {
    hostname: String,
    os: String,
    arch: String,
}

static TOPOLOGY_STATIC_INFO: OnceLock<TopologyStaticInfo> = OnceLock::new();

#[derive(Debug, Serialize)]
pub struct TopologyResponse {
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub version: &'static str,
    pub port: u16,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
}

pub async fn get_topology(State(state): State<RuntimeState>) -> Json<TopologyResponse> {
    // Cache mostly-static host identity data（缓存基本静态的主机身份信息）.
    let static_info = TOPOLOGY_STATIC_INFO.get_or_init(build_static_info);
    let (total_memory_mb, used_memory_mb) = read_memory_stats_mb();
    Json(TopologyResponse {
        hostname: static_info.hostname.clone(),
        os: static_info.os.clone(),
        arch: static_info.arch.clone(),
        uptime_secs: System::uptime(),
        version: RUNTIME_VERSION,
        port: state.port,
        total_memory_mb,
        used_memory_mb,
    })
}

fn build_static_info() -> TopologyStaticInfo {
    TopologyStaticInfo {
        hostname: read_hostname(),
        os: read_os(),
        arch: read_arch(),
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
