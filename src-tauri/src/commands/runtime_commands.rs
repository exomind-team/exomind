//! Runtime 服务命令（embedded mode，内嵌模式）
//! 提供桌面端 Runtime 的启动、停止与状态查询。

use crate::dev_instance_paths::resolve_instance_app_data_dir;
use chrono::Utc;
use exomind_android_keepalive::AndroidRuntimeKeepaliveExt;
use exomind_runtime::{
    start_with_options, RuntimeHandle, RuntimePublishRequest, RuntimeStartError,
    RuntimeStartOptions, DEFAULT_RT_PORT,
};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, TcpListener as StdTcpListener, ToSocketAddrs, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, timeout, Duration};

struct RuntimeInner {
    handle: Option<RuntimeHandle>,
    host: String,
    port: u16,
    host_id: Option<String>,
    auth_secret: Option<String>,
    started_at: Option<String>,
    last_error: Option<String>,
    external_runtime: bool,
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
                host_id: None,
                auth_secret: std::env::var("EXOMIND_RT_SECRET").ok(),
                started_at: None,
                last_error: None,
                external_runtime: false,
            }),
        }
    }

    /// Return the HTTP base URL for the embedded runtime (e.g. `http://127.0.0.1:7234`).
    pub fn runtime_base_url(&self) -> Result<String, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        Ok(format!("http://{}:{}", inner.host, inner.port))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeServiceStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub external_runtime: bool,
    pub host_id: Option<String>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReachableAddress {
    pub host: String,
    pub port: u16,
    pub host_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDialAddress {
    pub host: String,
    pub port: u16,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeNetworkMode {
    #[default]
    Local,
    Lan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeNetworkModePersisted {
    network_mode: RuntimeNetworkMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeTargetMode {
    #[default]
    Embedded,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTargetModePersisted {
    target_mode: RuntimeTargetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeExternalAddressPersisted {
    address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLanNoAuthPersisted {
    allow_lan_without_auth: bool,
}

impl RuntimeNetworkMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Lan => "lan",
        }
    }

    pub fn bind_host(self) -> &'static str {
        match self {
            Self::Local => "127.0.0.1",
            Self::Lan => "0.0.0.0",
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "local" => Ok(Self::Local),
            "lan" => Ok(Self::Lan),
            other => Err(format!("unsupported runtime network mode: {other}")),
        }
    }
}

impl RuntimeTargetMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Embedded => "embedded",
            Self::External => "external",
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "embedded" => Ok(Self::Embedded),
            "external" => Ok(Self::External),
            other => Err(format!("unsupported runtime target mode: {other}")),
        }
    }
}

fn runtime_network_mode_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("settings")
        .join("runtime-network-mode.json")
}

fn runtime_target_mode_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("settings")
        .join("runtime-target-mode.json")
}

fn runtime_external_address_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("settings")
        .join("runtime-external-address.json")
}

fn runtime_lan_no_auth_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("settings")
        .join("runtime-lan-no-auth.json")
}

fn load_runtime_network_mode_from_path(path: &Path) -> Result<RuntimeNetworkMode, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<RuntimeNetworkModePersisted>(&raw)
            .map(|persisted| persisted.network_mode)
            .map_err(|error| format!("failed to parse runtime network mode file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(RuntimeNetworkMode::Local),
        Err(error) => Err(format!("failed to read runtime network mode file: {error}")),
    }
}

fn save_runtime_network_mode_to_path(path: &Path, mode: RuntimeNetworkMode) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create runtime settings dir: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(&RuntimeNetworkModePersisted { network_mode: mode })
        .map_err(|error| format!("failed to serialize runtime network mode: {error}"))?;
    std::fs::write(path, payload)
        .map_err(|error| format!("failed to write runtime network mode file: {error}"))
}

fn load_runtime_target_mode_from_path(path: &Path) -> Result<RuntimeTargetMode, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<RuntimeTargetModePersisted>(&raw)
            .map(|persisted| persisted.target_mode)
            .map_err(|error| format!("failed to parse runtime target mode file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(RuntimeTargetMode::Embedded)
        }
        Err(error) => Err(format!("failed to read runtime target mode file: {error}")),
    }
}

fn save_runtime_target_mode_to_path(path: &Path, mode: RuntimeTargetMode) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create runtime settings dir: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(&RuntimeTargetModePersisted { target_mode: mode })
        .map_err(|error| format!("failed to serialize runtime target mode: {error}"))?;
    std::fs::write(path, payload)
        .map_err(|error| format!("failed to write runtime target mode file: {error}"))
}

fn normalize_runtime_external_address(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("runtime external address is required".to_string());
    }
    if trimmed.contains("://")
        || trimmed.contains('/')
        || trimmed.contains('?')
        || trimmed.contains('#')
    {
        return Err("invalid runtime external address format".to_string());
    }

    let split_index = trimmed
        .rfind(':')
        .ok_or_else(|| "invalid runtime external address format".to_string())?;
    if split_index == 0 || split_index >= trimmed.len() - 1 {
        return Err("invalid runtime external address format".to_string());
    }

    let host_raw = trimmed[..split_index].trim();
    let port_raw = trimmed[split_index + 1..].trim();
    let host = if host_raw.starts_with('[') && host_raw.ends_with(']') {
        host_raw[1..host_raw.len() - 1].trim()
    } else {
        host_raw
    };

    if host.is_empty() || !is_valid_host(host) {
        return Err("invalid runtime external host".to_string());
    }

    let port = port_raw
        .parse::<u16>()
        .map_err(|_| "invalid runtime external port".to_string())?;
    if port == 0 {
        return Err("invalid runtime external port".to_string());
    }

    let formatted_host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Ok(format!("{formatted_host}:{port}"))
}

fn load_runtime_external_address_from_path(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let parsed =
                serde_json::from_str::<RuntimeExternalAddressPersisted>(&raw).map_err(|error| {
                    format!("failed to parse runtime external address file: {error}")
                })?;
            normalize_runtime_external_address(&parsed.address)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(format!("127.0.0.1:{}", DEFAULT_RT_PORT))
        }
        Err(error) => Err(format!(
            "failed to read runtime external address file: {error}"
        )),
    }
}

fn save_runtime_external_address_to_path(path: &Path, address: &str) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create runtime settings dir: {error}"))?;
    }

    let normalized = normalize_runtime_external_address(address)?;
    let payload = serde_json::to_string_pretty(&RuntimeExternalAddressPersisted {
        address: normalized.clone(),
    })
    .map_err(|error| format!("failed to serialize runtime external address: {error}"))?;
    std::fs::write(path, payload)
        .map_err(|error| format!("failed to write runtime external address file: {error}"))?;
    Ok(normalized)
}

fn load_runtime_lan_no_auth_from_path(path: &Path) -> Result<bool, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<RuntimeLanNoAuthPersisted>(&raw)
            .map(|persisted| persisted.allow_lan_without_auth)
            .map_err(|error| format!("failed to parse runtime lan no-auth file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("failed to read runtime lan no-auth file: {error}")),
    }
}

fn save_runtime_lan_no_auth_to_path(path: &Path, enabled: bool) -> Result<bool, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create runtime settings dir: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(&RuntimeLanNoAuthPersisted {
        allow_lan_without_auth: enabled,
    })
    .map_err(|error| format!("failed to serialize runtime lan no-auth setting: {error}"))?;
    std::fs::write(path, payload)
        .map_err(|error| format!("failed to write runtime lan no-auth file: {error}"))?;
    Ok(enabled)
}

pub fn load_persisted_runtime_network_mode(app: &AppHandle) -> Result<RuntimeNetworkMode, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    load_runtime_network_mode_from_path(&runtime_network_mode_path(&app_data_dir))
}

pub fn load_persisted_runtime_target_mode(app: &AppHandle) -> Result<RuntimeTargetMode, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    load_runtime_target_mode_from_path(&runtime_target_mode_path(&app_data_dir))
}

pub fn load_persisted_runtime_external_address(app: &AppHandle) -> Result<String, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    load_runtime_external_address_from_path(&runtime_external_address_path(&app_data_dir))
}

pub fn load_persisted_runtime_lan_no_auth(app: &AppHandle) -> Result<bool, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    load_runtime_lan_no_auth_from_path(&runtime_lan_no_auth_path(&app_data_dir))
}

fn save_persisted_runtime_network_mode(
    app: &AppHandle,
    mode: RuntimeNetworkMode,
) -> Result<RuntimeNetworkMode, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    save_runtime_network_mode_to_path(&runtime_network_mode_path(&app_data_dir), mode)?;
    Ok(mode)
}

fn save_persisted_runtime_target_mode(
    app: &AppHandle,
    mode: RuntimeTargetMode,
) -> Result<RuntimeTargetMode, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    save_runtime_target_mode_to_path(&runtime_target_mode_path(&app_data_dir), mode)?;
    Ok(mode)
}

fn save_persisted_runtime_external_address(
    app: &AppHandle,
    address: &str,
) -> Result<String, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    save_runtime_external_address_to_path(&runtime_external_address_path(&app_data_dir), address)
}

fn save_persisted_runtime_lan_no_auth(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let app_data_dir = resolve_instance_app_data_dir(app)?;
    save_runtime_lan_no_auth_to_path(&runtime_lan_no_auth_path(&app_data_dir), enabled)
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
        external_runtime: inner.external_runtime,
        host_id: inner.host_id.clone(),
        pid: (running && inner.handle.is_some()).then_some(std::process::id()),
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

fn should_restart_running_runtime(
    current_host: &str,
    current_port: u16,
    requested_host: &str,
    requested_port: u16,
) -> bool {
    current_host != requested_host || (requested_port != 0 && current_port != requested_port)
}

fn should_fallback_to_random_port(
    requested_port: u16,
    healthy_runtime_on_requested_port: bool,
) -> bool {
    requested_port > 0 && !healthy_runtime_on_requested_port
}

fn should_enable_mdns_for_bind_host(host: &str) -> bool {
    let normalized = host.trim().trim_matches(['[', ']']);
    if normalized.eq_ignore_ascii_case("localhost") {
        return false;
    }

    match normalized.parse::<IpAddr>() {
        Ok(ip) => !ip.is_loopback(),
        Err(_) => true,
    }
}

fn resolve_reachable_host(remote_host: &str, remote_port: u16) -> Result<String, String> {
    let remote_addr = format!("{remote_host}:{remote_port}");
    let mut resolved = remote_addr
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve remote host: {error}"))?;
    let target = resolved
        .next()
        .ok_or_else(|| "remote host did not resolve to any address".to_string())?;
    let bind_addr = if target.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let socket = UdpSocket::bind(bind_addr)
        .map_err(|error| format!("failed to bind udp socket: {error}"))?;
    socket
        .connect(target)
        .map_err(|error| format!("failed to connect udp probe socket: {error}"))?;
    let local_addr = socket
        .local_addr()
        .map_err(|error| format!("failed to inspect local udp address: {error}"))?;
    Ok(local_addr.ip().to_string())
}

fn adb_command_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for env_key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(raw) = std::env::var_os(env_key) {
            let sdk_adb = PathBuf::from(raw)
                .join("platform-tools")
                .join(if cfg!(windows) { "adb.exe" } else { "adb" });
            candidates.push(sdk_adb);
        }
    }

    candidates.push(PathBuf::from(if cfg!(windows) { "adb.exe" } else { "adb" }));
    candidates.push(PathBuf::from("adb"));
    candidates
}

fn parse_adb_forward_tcp_port(raw: &str) -> Option<u16> {
    raw.strip_prefix("tcp:")?.parse::<u16>().ok()
}

fn looks_like_android_emulator_guest(host: &str) -> bool {
    host.starts_with("10.0.2.") || host.starts_with("10.0.3.")
}
/// Only allow reusing existing ADB forwards for Android emulator guest addresses.
/// LAN IP addresses should NEVER reuse an existing forward that might
/// belong to a different device.
fn should_reuse_existing_adb_forward(remote_host: &str) -> bool {
    looks_like_android_emulator_guest(remote_host)
}

fn reserve_local_tcp_port() -> Result<u16, String> {
    let listener = StdTcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("failed to reserve local tcp port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("failed to inspect reserved local tcp port: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn run_adb_forward_command(args: &[String]) -> Result<(), String> {
    let mut last_error: Option<String> = None;

    for candidate in adb_command_candidates() {
        let output = Command::new(&candidate).args(args).output();
        match output {
            Ok(output) if output.status.success() => return Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                last_error = Some(if stderr.is_empty() {
                    format!(
                        "{} {} failed with status {}",
                        candidate.display(),
                        args.join(" "),
                        output.status
                    )
                } else {
                    stderr
                });
            }
            Err(error) => {
                last_error = Some(format!(
                    "failed to run {} {}: {error}",
                    candidate.display(),
                    args.join(" ")
                ));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "adb command unavailable".to_string()))
}

fn ensure_adb_forward_host_port(remote_port: u16) -> Result<Option<u16>, String> {
    if let Some(existing_port) = find_adb_forward_host_port(remote_port)? {
        return Ok(Some(existing_port));
    }

    let local_port = reserve_local_tcp_port()?;
    run_adb_forward_command(&[
        "forward".to_string(),
        format!("tcp:{local_port}"),
        format!("tcp:{remote_port}"),
    ])?;
    Ok(Some(local_port))
}

fn find_adb_forward_host_port(remote_port: u16) -> Result<Option<u16>, String> {
    let mut last_error: Option<String> = None;

    for candidate in adb_command_candidates() {
        let output = Command::new(&candidate)
            .args(["forward", "--list"])
            .output();
        match output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let columns = line.split_whitespace().collect::<Vec<_>>();
                    if columns.len() < 3 {
                        continue;
                    }

                    let Some(local_port) = parse_adb_forward_tcp_port(columns[1]) else {
                        continue;
                    };
                    let Some(mapped_remote_port) = parse_adb_forward_tcp_port(columns[2]) else {
                        continue;
                    };

                    if mapped_remote_port == remote_port {
                        return Ok(Some(local_port));
                    }
                }

                return Ok(None);
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                last_error = Some(if stderr.is_empty() {
                    format!("adb forward --list failed with status {}", output.status)
                } else {
                    stderr
                });
            }
            Err(error) => {
                last_error = Some(format!("failed to run {}: {error}", candidate.display()));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "adb command unavailable".to_string()))
}

async fn resolve_peer_dial_address(remote_host: &str, remote_port: u16) -> RuntimeDialAddress {
    if probe_runtime_health(remote_host, remote_port).await {
        return RuntimeDialAddress {
            host: remote_host.to_string(),
            port: remote_port,
        };
    }

    // Issue 773: Only use ADB forwarding for Android emulator guest addresses.
    // LAN IP addresses should never reuse an existing ADB forward that might
    // belong to a different device.
    let adb_forward_port = if should_reuse_existing_adb_forward(remote_host) {
        ensure_adb_forward_host_port(remote_port).ok().flatten()
    } else {
        // For LAN addresses, do not use ADB forwarding at all
        None
    };

    if let Some(local_port) = adb_forward_port {
        return RuntimeDialAddress {
            host: "127.0.0.1".to_string(),
            port: local_port,
        };
    }

    RuntimeDialAddress {
        host: remote_host.to_string(),
        port: remote_port,
    }
}

async fn probe_runtime_health(host: &str, port: u16) -> bool {
    let address = format!("{host}:{port}");
    let mut stream = match timeout(
        Duration::from_millis(250),
        tokio::net::TcpStream::connect(&address),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        _ => return false,
    };

    let request = format!("GET /health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if timeout(
        Duration::from_millis(250),
        stream.write_all(request.as_bytes()),
    )
    .await
    .is_err()
    {
        return false;
    }

    let mut response = [0u8; 128];
    match timeout(Duration::from_millis(250), stream.read(&mut response)).await {
        Ok(Ok(size)) if size > 0 => {
            let head = String::from_utf8_lossy(&response[..size]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn mark_external_runtime_running(
    state: &Arc<RuntimeProcessState>,
    host: &str,
    port: u16,
) -> Result<RuntimeServiceStatus, String> {
    let mut inner = lock_or_error(state)?;
    inner.host = host.to_string();
    inner.port = port;
    inner.host_id = None;
    inner.auth_secret = std::env::var("EXOMIND_RT_SECRET").ok();
    inner.started_at = None;
    inner.last_error = None;
    inner.external_runtime = true;
    Ok(compose_status(&inner, true, None))
}

pub fn sync_android_runtime_keepalive(app: &AppHandle, enabled: bool, host: &str, port: u16) {
    let title = enabled.then_some("ExoMind RT 正在后台运行".to_string());
    let text = enabled.then_some(format!(
        "后台保持 RT 可连接：{}:{}。返回应用后会自动隐藏常驻通知。",
        host, port
    ));

    if let Err(error) = app
        .android_runtime_keepalive()
        .set_enabled(enabled, title, text)
    {
        log::warn!("failed to sync android runtime keepalive: {error}");
    }
}

pub async fn ensure_runtime_started(
    app: &AppHandle,
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
    // Tauri embedded runtime follows UI network mode directly:
    // LAN bind => enable mDNS discovery, loopback bind => disable mDNS.
    //（桌面/移动端内嵌 RT：局域网监听开启 mDNS，本机监听关闭 mDNS）
    options.enable_mdns = should_enable_mdns_for_bind_host(&options.bind_host);
    if let Some(runtime_port) = port {
        options.port = runtime_port;
    }
    options.allow_lan_without_auth =
        load_persisted_runtime_lan_no_auth(app).unwrap_or_else(|error| {
            log::warn!(
            "failed to load persisted runtime LAN no-auth setting, fallback to disabled: {error}"
        );
            false
        });
    let requested_host = options.bind_host.clone();
    let requested_port = options.port;
    let requested_auth_secret = options.auth_secret.clone();
    let mut should_restart_embedded_runtime = false;

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
            inner.host_id = inner
                .handle
                .as_ref()
                .map(|handle| handle.host_id().to_string());
            inner.auth_secret = requested_auth_secret.clone();
            inner.last_error = None;
            inner.external_runtime = false;
            if !should_restart_running_runtime(
                &inner.host,
                inner.port,
                &requested_host,
                requested_port,
            ) {
                return Ok(compose_status(&inner, true, None));
            }
            should_restart_embedded_runtime = true;
        }
    }

    if should_restart_embedded_runtime {
        ensure_runtime_stopped(state.clone()).await?;
    }

    if requested_port > 0 {
        // 等待端口可用（处理热重载时旧端口 TIME_WAIT 延迟，最多等 2s）
        let addr = format!("{}:{}", options.bind_host, options.port);
        let mut requested_port_available = false;
        for i in 0..20u8 {
            if StdTcpListener::bind(&addr).is_ok() {
                requested_port_available = true;
                break;
            }
            if probe_runtime_health(&options.bind_host, options.port).await {
                return mark_external_runtime_running(&state, &options.bind_host, options.port);
            }
            if i == 0 {
                log::warn!(
                    "embedded runtime requested port {} on {} is busy; waiting for release or healthy runtime reuse",
                    requested_port,
                    requested_host
                );
            }
            sleep(Duration::from_millis(100)).await;
        }

        if !requested_port_available {
            log::warn!(
                "embedded runtime requested port {} on {} remained occupied by a non-runtime listener; retrying on a random available port",
                requested_port,
                requested_host
            );
            options.port = 0;
        }
    }

    let handle = loop {
        match start_with_options(options.clone()).await {
            Ok(handle) => break handle,
            Err(error) => {
                if let RuntimeStartError::BindListener { source, .. } = &error {
                    if source.kind() == std::io::ErrorKind::AddrInUse {
                        let healthy_runtime_on_requested_port =
                            probe_runtime_health(&requested_host, requested_port).await;
                        if healthy_runtime_on_requested_port {
                            return mark_external_runtime_running(
                                &state,
                                &requested_host,
                                requested_port,
                            );
                        }
                        if should_fallback_to_random_port(
                            requested_port,
                            healthy_runtime_on_requested_port,
                        ) && options.port != 0
                        {
                            log::warn!(
                                "embedded runtime requested port {} on {} became busy during startup; retrying on a random available port",
                                requested_port,
                                requested_host
                            );
                            options.port = 0;
                            continue;
                        }
                    }
                }

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
                inner.external_runtime = false;
                return Err(message);
            }
        }
    };
    let started_host = handle.host();
    let started_port = handle.port();

    if requested_port == 0 {
        log::info!(
            "embedded runtime selected random available port {} on {}",
            started_port,
            started_host
        );
    } else if started_host != requested_host || started_port != requested_port {
        log::warn!(
            "embedded runtime requested {}:{} but started on {}:{} after fallback",
            requested_host,
            requested_port,
            started_host,
            started_port
        );
    }

    let mut inner = lock_or_error(&state)?;
    inner.host = started_host;
    inner.port = started_port;
    inner.host_id = Some(handle.host_id().to_string());
    inner.auth_secret = requested_auth_secret;
    inner.started_at = Some(Utc::now().to_rfc3339());
    inner.last_error = None;
    inner.external_runtime = false;
    inner.handle = Some(handle);
    Ok(compose_status(&inner, true, None))
}

pub async fn ensure_runtime_stopped(
    state: Arc<RuntimeProcessState>,
) -> Result<RuntimeServiceStatus, String> {
    let (mut handle, external_snapshot) = {
        let mut inner = lock_or_error(&state)?;
        (
            inner.handle.take(),
            (inner.external_runtime, inner.host.clone(), inner.port),
        )
    };

    if let Some(runtime) = handle.as_mut() {
        if let Err(error) = runtime.stop().await {
            let message = format!("failed to stop embedded runtime: {error}");
            let mut inner = lock_or_error(&state)?;
            inner.handle = handle;
            inner.last_error = Some(message.clone());
            inner.external_runtime = false;
            return Err(message);
        }
    }

    if handle.is_none()
        && external_snapshot.0
        && probe_runtime_health(&external_snapshot.1, external_snapshot.2).await
    {
        let message = format!(
            "embedded runtime is managed by another process at {}:{}; stop request skipped",
            external_snapshot.1, external_snapshot.2
        );
        let mut inner = lock_or_error(&state)?;
        inner.started_at = None;
        inner.last_error = Some(message.clone());
        inner.external_runtime = true;
        return Ok(compose_status(&inner, true, Some(message)));
    }

    let mut inner = lock_or_error(&state)?;
    inner.started_at = None;
    inner.last_error = None;
    inner.external_runtime = false;
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
        inner.host_id = inner
            .handle
            .as_ref()
            .map(|handle| handle.host_id().to_string());
        inner.external_runtime = false;
        true
    } else if inner.external_runtime {
        true
    } else {
        inner.started_at = None;
        false
    };

    Ok(compose_status(&inner, running, None))
}

#[tauri::command]
pub async fn runtime_service_start(
    app: AppHandle,
    state: State<'_, Arc<RuntimeProcessState>>,
    host: Option<String>,
    port: Option<u16>,
) -> Result<RuntimeServiceStatus, String> {
    let status = ensure_runtime_started(&app, state.inner().clone(), host, port).await?;
    sync_android_runtime_keepalive(&app, true, &status.host, status.port);
    Ok(status)
}

#[tauri::command]
pub async fn runtime_service_stop(
    app: AppHandle,
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<RuntimeServiceStatus, String> {
    let status = ensure_runtime_stopped(state.inner().clone()).await?;
    sync_android_runtime_keepalive(&app, false, &status.host, status.port);
    Ok(status)
}

#[tauri::command]
pub fn runtime_service_status(
    state: State<'_, Arc<RuntimeProcessState>>,
) -> Result<RuntimeServiceStatus, String> {
    runtime_status_snapshot(state.inner().clone())
}

#[tauri::command]
pub fn runtime_network_mode_set(app: AppHandle, mode: String) -> Result<String, String> {
    let parsed = RuntimeNetworkMode::parse(&mode)?;
    Ok(save_persisted_runtime_network_mode(&app, parsed)?
        .as_str()
        .to_string())
}

#[tauri::command]
pub fn runtime_network_mode_get(app: AppHandle) -> Result<String, String> {
    let mode = load_persisted_runtime_network_mode(&app)?;
    Ok(mode.as_str().to_string())
}

#[tauri::command]
pub fn runtime_target_mode_set(app: AppHandle, mode: String) -> Result<String, String> {
    let parsed = RuntimeTargetMode::parse(&mode)?;
    Ok(save_persisted_runtime_target_mode(&app, parsed)?
        .as_str()
        .to_string())
}

#[tauri::command]
pub fn runtime_target_mode_get(app: AppHandle) -> Result<String, String> {
    let mode = load_persisted_runtime_target_mode(&app)?;
    Ok(mode.as_str().to_string())
}

#[tauri::command]
pub fn runtime_external_address_set(app: AppHandle, address: String) -> Result<String, String> {
    save_persisted_runtime_external_address(&app, &address)
}

#[tauri::command]
pub fn runtime_external_address_get(app: AppHandle) -> Result<String, String> {
    load_persisted_runtime_external_address(&app)
}

#[tauri::command]
pub fn runtime_lan_no_auth_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    save_persisted_runtime_lan_no_auth(&app, enabled)
}

#[tauri::command]
pub fn runtime_lan_no_auth_get(app: AppHandle) -> Result<bool, String> {
    load_persisted_runtime_lan_no_auth(&app)
}

#[tauri::command]
pub fn runtime_service_reachable_address(
    state: State<'_, Arc<RuntimeProcessState>>,
    remote_host: String,
    remote_port: u16,
) -> Result<RuntimeReachableAddress, String> {
    let (host_id, port) = {
        let inner = lock_or_error(state.inner())?;
        let handle = match inner.handle.as_ref() {
            Some(handle) if handle.is_running() => handle,
            Some(_) => return Err("embedded runtime is not running".to_string()),
            None if inner.external_runtime => {
                return Err("embedded runtime is managed by another process".to_string());
            }
            None => return Err("embedded runtime not running".to_string()),
        };
        (handle.host_id().to_string(), handle.port())
    };

    let host = resolve_reachable_host(&remote_host, remote_port)?;
    Ok(RuntimeReachableAddress {
        host,
        port,
        host_id: Some(host_id),
    })
}

#[tauri::command]
pub async fn runtime_service_peer_dial_address(
    remote_host: String,
    remote_port: u16,
) -> Result<RuntimeDialAddress, String> {
    Ok(resolve_peer_dial_address(&remote_host, remote_port).await)
}

#[tauri::command]
pub fn signal_publish_fast(
    state: State<'_, Arc<RuntimeProcessState>>,
    request: SignalPublishFastRequest,
) -> Result<SignalPublishFastResponse, String> {
    let event_id = {
        let inner = lock_or_error(state.inner())?;
        let handle = match inner.handle.as_ref() {
            Some(handle) if handle.is_running() => handle,
            Some(_) => return Err("embedded runtime is not running".to_string()),
            None if inner.external_runtime => {
                return Err(format!(
                    "embedded runtime is managed by another process at {}:{}; fast publish is unavailable",
                    inner.host, inner.port
                ));
            }
            None => return Err("embedded runtime not running".to_string()),
        };
        handle.publish_signal(RuntimePublishRequest {
            topic: request.topic,
            source: request.source,
            payload: request.payload,
            trace_id: request.trace_id,
            origin_host_id: request.origin_host_id,
        })
    };

    Ok(SignalPublishFastResponse {
        accepted: true,
        event_id,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

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

    #[test]
    fn should_restart_running_runtime_when_bind_changes() {
        assert!(super::should_restart_running_runtime(
            "127.0.0.1",
            9124,
            "0.0.0.0",
            9124,
        ));
    }

    #[test]
    fn should_not_restart_running_runtime_when_bind_matches() {
        assert!(!super::should_restart_running_runtime(
            "127.0.0.1",
            9124,
            "127.0.0.1",
            9124,
        ));
    }

    #[test]
    fn should_not_restart_running_runtime_when_requested_port_is_dynamic() {
        assert!(!super::should_restart_running_runtime(
            "127.0.0.1",
            9231,
            "127.0.0.1",
            0,
        ));
    }

    #[test]
    fn fixed_requested_port_without_healthy_runtime_falls_back_to_random_port() {
        assert!(super::should_fallback_to_random_port(9124, false));
        assert!(!super::should_fallback_to_random_port(9124, true));
        assert!(!super::should_fallback_to_random_port(0, false));
    }

    #[test]
    fn enables_mdns_for_lan_bind_hosts() {
        assert!(super::should_enable_mdns_for_bind_host("0.0.0.0"));
        assert!(super::should_enable_mdns_for_bind_host("192.168.1.10"));
        assert!(super::should_enable_mdns_for_bind_host("my-laptop.local"));
    }

    #[test]
    fn runtime_network_mode_maps_to_expected_bind_hosts() {
        assert_eq!(super::RuntimeNetworkMode::Local.bind_host(), "127.0.0.1");
        assert_eq!(super::RuntimeNetworkMode::Lan.bind_host(), "0.0.0.0");
    }

    #[test]
    fn runtime_network_mode_file_roundtrip() {
        let temp_dir =
            std::env::temp_dir().join(format!("exomind-rt-network-mode-{}", uuid::Uuid::new_v4()));
        let path = temp_dir.join("runtime-network-mode.json");

        super::save_runtime_network_mode_to_path(&path, super::RuntimeNetworkMode::Lan)
            .expect("runtime network mode should persist");

        let loaded = super::load_runtime_network_mode_from_path(&path)
            .expect("runtime network mode should load");
        assert_eq!(loaded, super::RuntimeNetworkMode::Lan);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_runtime_network_mode_file_defaults_to_local() {
        let temp_dir = std::env::temp_dir().join(format!(
            "exomind-rt-network-mode-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let path = temp_dir.join("missing-runtime-network-mode.json");

        let loaded = super::load_runtime_network_mode_from_path(&path)
            .expect("missing runtime network mode file should fall back");
        assert_eq!(loaded, super::RuntimeNetworkMode::Local);
    }

    #[test]
    fn runtime_lan_no_auth_file_roundtrip() {
        let temp_dir =
            std::env::temp_dir().join(format!("exomind-rt-lan-no-auth-{}", uuid::Uuid::new_v4()));
        let path = temp_dir.join("runtime-lan-no-auth.json");

        let saved = super::save_runtime_lan_no_auth_to_path(&path, true)
            .expect("runtime lan no-auth setting should persist");
        assert!(saved);

        let loaded = super::load_runtime_lan_no_auth_from_path(&path)
            .expect("runtime lan no-auth setting should load");
        assert!(loaded);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_runtime_lan_no_auth_file_defaults_to_disabled() {
        let temp_dir = std::env::temp_dir().join(format!(
            "exomind-rt-lan-no-auth-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let path = temp_dir.join("missing-runtime-lan-no-auth.json");

        let loaded = super::load_runtime_lan_no_auth_from_path(&path)
            .expect("missing runtime lan no-auth file should fall back");
        assert!(!loaded);
    }

    #[test]
    fn runtime_target_mode_file_roundtrip() {
        let temp_dir =
            std::env::temp_dir().join(format!("exomind-rt-target-mode-{}", uuid::Uuid::new_v4()));
        let path = temp_dir.join("runtime-target-mode.json");

        super::save_runtime_target_mode_to_path(&path, super::RuntimeTargetMode::External)
            .expect("runtime target mode should persist");

        let loaded = super::load_runtime_target_mode_from_path(&path)
            .expect("runtime target mode should load");
        assert_eq!(loaded, super::RuntimeTargetMode::External);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_runtime_target_mode_file_defaults_to_embedded() {
        let temp_dir = std::env::temp_dir().join(format!(
            "exomind-rt-target-mode-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let path = temp_dir.join("missing-runtime-target-mode.json");

        let loaded = super::load_runtime_target_mode_from_path(&path)
            .expect("missing runtime target mode file should fall back");
        assert_eq!(loaded, super::RuntimeTargetMode::Embedded);
    }

    #[test]
    fn runtime_external_address_file_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!(
            "exomind-rt-external-address-{}",
            uuid::Uuid::new_v4()
        ));
        let path = temp_dir.join("runtime-external-address.json");

        let saved = super::save_runtime_external_address_to_path(&path, "192.168.1.48:9124")
            .expect("runtime external address should persist");
        assert_eq!(saved, "192.168.1.48:9124");

        let loaded = super::load_runtime_external_address_from_path(&path)
            .expect("runtime external address should load");
        assert_eq!(loaded, "192.168.1.48:9124");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_runtime_external_address_file_defaults_to_loopback_rt_port() {
        let temp_dir = std::env::temp_dir().join(format!(
            "exomind-rt-external-address-missing-{}",
            uuid::Uuid::new_v4()
        ));
        let path = temp_dir.join("missing-runtime-external-address.json");

        let loaded = super::load_runtime_external_address_from_path(&path)
            .expect("missing runtime external address file should fall back");
        assert_eq!(loaded, format!("127.0.0.1:{}", super::DEFAULT_RT_PORT));
    }

    #[test]
    fn disables_mdns_for_loopback_bind_hosts() {
        assert!(!super::should_enable_mdns_for_bind_host("127.0.0.1"));
        assert!(!super::should_enable_mdns_for_bind_host("localhost"));
        assert!(!super::should_enable_mdns_for_bind_host("::1"));
    }

    #[test]
    fn parses_adb_forward_tcp_ports() {
        assert_eq!(super::parse_adb_forward_tcp_port("tcp:39124"), Some(39124));
        assert_eq!(super::parse_adb_forward_tcp_port("udp:39124"), None);
    }

    #[test]
    fn detects_android_emulator_guest_hosts() {
        assert!(super::looks_like_android_emulator_guest("10.0.2.15"));
        assert!(super::looks_like_android_emulator_guest("10.0.3.15"));
        assert!(!super::looks_like_android_emulator_guest("192.168.1.88"));
    }

    #[test]
    fn compose_status_hides_pid_for_external_runtime() {
        let inner = super::RuntimeInner {
            handle: None,
            host: "127.0.0.1".to_string(),
            port: 9124,
            host_id: None,
            auth_secret: None,
            started_at: None,
            last_error: None,
            external_runtime: true,
        };
        let status = super::compose_status(&inner, true, None);

        assert!(status.running);
        assert_eq!(status.pid, None);
    }

    #[test]
    fn runtime_status_snapshot_reports_external_runtime_running() {
        let state = Arc::new(super::RuntimeProcessState::new());
        {
            let mut inner = super::lock_or_error(&state).expect("runtime state lock");
            inner.host = "127.0.0.1".to_string();
            inner.port = 9124;
            inner.host_id = Some("host-local".to_string());
            inner.auth_secret = Some("embedded-secret".to_string());
            inner.external_runtime = true;
        }

        let status = super::runtime_status_snapshot(state).expect("status snapshot");
        assert!(status.running);
        assert_eq!(status.pid, None);
        assert_eq!(status.host_id.as_deref(), Some("host-local"));
        let serialized = serde_json::to_value(&status).expect("status should serialize");
        assert!(
            serialized.get("authSecret").is_none(),
            "runtime status must not expose authSecret"
        );
    }

    #[test]
    fn compose_status_hides_auth_secret_for_embedded_runtime() {
        let inner = super::RuntimeInner {
            handle: None,
            host: "127.0.0.1".to_string(),
            port: 9124,
            host_id: Some("host-local".to_string()),
            started_at: None,
            last_error: None,
            external_runtime: false,
            auth_secret: Some("embedded-secret".to_string()),
        };
        let status = super::compose_status(&inner, true, None);

        assert!(status.running);
        let serialized = serde_json::to_value(&status).expect("status should serialize");
        assert!(
            serialized.get("authSecret").is_none(),
            "embedded runtime status must not expose authSecret"
        );
    }
    #[test]
    fn only_android_emulator_guests_may_reuse_existing_adb_forwards() {
        // Issue 773: LAN phone nodes should not reuse existing ADB forwards
        // that might belong to a different device. Only Android emulator guest
        // addresses can safely reuse ADB forwards since they are on a special
        // virtual network that cannot be reached directly from the host.

        // Emulator guests CAN reuse ADB forwards
        assert!(super::should_reuse_existing_adb_forward("10.0.2.15"));
        assert!(super::should_reuse_existing_adb_forward("10.0.3.15"));

        // LAN IP addresses should NEVER reuse existing ADB forwards
        assert!(!super::should_reuse_existing_adb_forward("192.168.1.88"));
        assert!(!super::should_reuse_existing_adb_forward("192.168.101.5"));
        // Note: 10.0.2.2 is a special emulator-host alias that IS allowed

        // Loopback should not use ADB forwarding
        assert!(!super::should_reuse_existing_adb_forward("127.0.0.1"));
        assert!(!super::should_reuse_existing_adb_forward("localhost"));

        // Public IPs should not use ADB forwarding
        assert!(!super::should_reuse_existing_adb_forward("8.8.8.8"));
    }
}
