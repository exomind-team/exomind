use axum::{extract::State, Json};
use serde::Serialize;
use sysinfo::System;

use crate::{RuntimeState, RUNTIME_VERSION};

#[derive(Debug, Serialize)]
pub struct TopologyResponse {
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub version: &'static str,
    pub port: u16,
}

pub async fn get_topology(State(state): State<RuntimeState>) -> Json<TopologyResponse> {
    Json(TopologyResponse {
        hostname: read_hostname(),
        os: read_os(),
        arch: read_arch(),
        uptime_secs: System::uptime(),
        version: RUNTIME_VERSION,
        port: state.port,
    })
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
