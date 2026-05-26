use axum::http::Method;
use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};
use thiserror::Error;
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use eventlog::EventLogStore;
use mesh::{MeshRelayManager, MeshState};
use signal::SignalPool;

pub mod agent;
pub mod agent_await;
pub mod auth;
pub mod config;
pub mod discovery;
pub mod energy;
pub mod eventlog;
pub mod eventlog_sqlite;
pub mod mesh;
pub mod pairing;
pub mod plugins;
pub mod proposal;
#[cfg(not(target_os = "android"))]
pub mod pty;
pub mod reminder;
pub mod routes;
pub mod session;
pub mod signal;
mod sqlite_json_bridge;
pub mod task;
pub mod tick;
pub mod timeblock;
pub mod timeblock_sqlite;

pub const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const BUILD_GIT_HASH: &str = env!("BUILD_GIT_HASH");
pub const BUILD_TIME: &str = env!("BUILD_TIME");
pub const DEFAULT_RT_PORT: u16 = 1949;
const RUNTIME_HOST_ID_CONFIG_KEY: &str = "exomind:runtimeHostId";
const RUNTIME_DEVICE_ID_CONFIG_KEY: &str = "exomind:deviceId";

#[derive(Debug, Error)]
pub enum PortConfigError {
    #[error("EXOMIND_RT_PORT must be a valid u16 number, got: {raw}")]
    InvalidPort { raw: String },
}

/// Read EXOMIND_RT_PORT from env (从环境变量读取运行端口).
/// Missing value means `1949`（缺省时用 1949）.
/// `0` means random available port（0 表示随机可用端口）.
pub fn configured_port_from_env() -> Result<u16, PortConfigError> {
    match env::var("EXOMIND_RT_PORT") {
        Ok(raw) => raw
            .parse::<u16>()
            .map_err(|_| PortConfigError::InvalidPort { raw }),
        Err(env::VarError::NotPresent) => Ok(DEFAULT_RT_PORT),
        Err(env::VarError::NotUnicode(_)) => Err(PortConfigError::InvalidPort {
            raw: "<non-unicode>".to_string(),
        }),
    }
}

/// Read EXOMIND_RT_BIND from env（读取绑定地址，默认 127.0.0.1）.
pub fn configured_bind_host_from_env() -> String {
    env::var("EXOMIND_RT_BIND").unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Read EXOMIND_RT_HOST_ID from env（读取逻辑主机 ID）.
pub fn configured_host_id_from_env() -> String {
    if let Ok(raw) = env::var("EXOMIND_RT_HOST_ID") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let path = env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_data_dir().join("config.sqlite"));
    if let Some(host_id) = load_or_create_persisted_runtime_identity(
        &path,
        RUNTIME_HOST_ID_CONFIG_KEY,
        "rt",
        "runtime host id",
    ) {
        return host_id;
    }

    format!("rt-{}", uuid::Uuid::new_v4())
}

/// Read EXOMIND_RT_DEVICE_ID from env（读取逻辑设备 ID）.
pub fn configured_device_id_from_env() -> String {
    if let Ok(raw) = env::var("EXOMIND_RT_DEVICE_ID") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let path = env::var_os("EXOMIND_RT_CONFIG_SQLITE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_data_dir().join("config.sqlite"));
    if let Some(device_id) = load_or_create_persisted_runtime_identity(
        &path,
        RUNTIME_DEVICE_ID_CONFIG_KEY,
        "dev",
        "runtime device id",
    ) {
        return device_id;
    }

    format!("dev-{}", uuid::Uuid::new_v4())
}

fn load_or_create_persisted_runtime_identity(
    path: &Path,
    key: &str,
    prefix: &str,
    identity_label: &str,
) -> Option<String> {
    let store = match config::ConfigStore::with_sqlite_path(path) {
        Ok(store) => store,
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                error = %error,
                "failed to open config store for persisted runtime identity"
            );
            return None;
        }
    };

    match store.get(config::types::DEVICE_CONFIG_SCOPE, key) {
        Ok(Some(entry)) => {
            let trimmed = entry.value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                error = %error,
                key,
                "failed to read persisted runtime identity from config store"
            );
            return None;
        }
    }

    let generated = format!("{prefix}-{}", uuid::Uuid::new_v4());
    match store.put_if_absent(config::PutConfigEntryInput {
        scope: config::types::DEVICE_CONFIG_SCOPE.to_string(),
        key: key.to_string(),
        value: generated.clone(),
        sensitive: false,
        source: Some("runtime-start".to_string()),
        source_origin: None,
    }) {
        Ok(true) => Some(generated),
        Ok(false) => store
            .get(config::types::DEVICE_CONFIG_SCOPE, key)
            .ok()
            .flatten()
            .and_then(|entry| {
                let trimmed = entry.value.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }),
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                error = %error,
                key,
                identity_label,
                "failed to persist runtime identity into config store"
            );
            None
        }
    }
}

fn default_runtime_host_id(port: u16) -> String {
    format!("rt-local-{port}")
}

fn default_runtime_device_id(port: u16) -> String {
    format!("dev-local-{port}")
}

fn bind_host_is_loopback_or_local(host: &str) -> bool {
    let normalized = host.trim().trim_matches(['[', ']']);
    if normalized.eq_ignore_ascii_case("localhost") {
        return true;
    }

    normalized
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn ensure_auth_secret_for_bind_host(options: &mut RuntimeStartOptions) {
    if options.auth_secret.is_some() || bind_host_is_loopback_or_local(&options.bind_host) {
        return;
    }

    tracing::warn!(
        "EXOMIND_RT_SECRET not configured for non-loopback bind host {}; generating ephemeral admin secret for this runtime session",
        options.bind_host
    );
    options.auth_secret = Some(format!("rt-admin-{}", uuid::Uuid::new_v4()));
}

fn configured_mesh_state_path_from_env(data_dir: Option<&Path>) -> Option<PathBuf> {
    env::var("EXOMIND_RT_MESH_STATE_PATH")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            Some(
                data_dir
                    .map(Path::to_path_buf)
                    .unwrap_or_else(resolve_data_dir)
                    .join("mesh-state.json"),
            )
        })
}

fn ret_mesh_identity_path(options: &RuntimeStartOptions) -> PathBuf {
    env::var("EXOMIND_RET_MESH_IDENTITY_PATH")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            options
                .data_dir
                .clone()
                .unwrap_or_else(resolve_data_dir)
                .join("reticulum-identity.hex")
        })
}

fn load_ret_mesh_identity_seed(options: &RuntimeStartOptions) -> Option<String> {
    if let Ok(raw) = env::var("EXOMIND_RET_MESH_IDENTITY_SEED") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let path = ret_mesh_identity_path(options);
    std::fs::read_to_string(&path).ok().and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn persist_ret_mesh_identity_seed(options: &RuntimeStartOptions, seed: &str) {
    if env::var("EXOMIND_RET_MESH_IDENTITY_SEED").is_ok() {
        return;
    }

    let path = ret_mesh_identity_path(options);
    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::warn!(
                path = %parent.display(),
                error = %error,
                "failed to create Reticulum identity seed directory"
            );
            return;
        }
    }

    if let Err(error) = std::fs::write(&path, seed) {
        tracing::warn!(
            path = %path.display(),
            error = %error,
            "failed to persist Reticulum identity seed"
        );
    }
}

fn prepare_ret_mesh_identity(options: &RuntimeStartOptions) -> (String, String) {
    let identity_seed = load_ret_mesh_identity_seed(options);
    let identity =
        exomind_net_pairing::RetMeshNode::load_or_create_identity(identity_seed.as_deref());
    let private_seed = exomind_net_pairing::RetMeshNode::private_identity_seed_hex(&identity);
    persist_ret_mesh_identity_seed(options, &private_seed);
    let public_identity_hex = exomind_net_pairing::RetMeshNode::public_identity_hex(&identity);
    (private_seed, public_identity_hex)
}

/// Runtime startup options（运行时启动选项）.
#[derive(Debug, Clone)]
pub struct RuntimeStartOptions {
    /// bind host（绑定地址）.
    pub bind_host: String,
    /// bind port（绑定端口）. `0` means random available port.
    pub port: u16,
    /// logical runtime host id（逻辑运行时主机 ID）.
    pub host_id: String,
    /// logical runtime device id（逻辑运行时设备 ID）.
    pub device_id: String,
    /// spawn built-in rust actors（是否拉起内置 Rust Actor）.
    pub spawn_builtin_actors: bool,
    /// spawn ts agents (reviewer/classifier)（是否拉起 TS Agent）.
    pub spawn_ts_agents: bool,
    /// command to run TS agents（启动 TS Agent 的命令）.
    pub ts_agent_command: String,
    /// project root used for spawning TS agents（TS Agent 工作目录）.
    pub ts_agent_workdir: Option<PathBuf>,
    /// optional mesh state path（可选 peer/interest 持久化路径）.
    pub mesh_state_path: Option<PathBuf>,
    /// optional signal sqlite path（可选 SignalPool SQLite 路径）.
    pub signal_storage_path: Option<PathBuf>,
    /// optional bearer token secret for HTTP auth（可选 Bearer Token 鉴权密钥）.
    pub auth_secret: Option<String>,
    /// allow private-network clients to skip token auth（允许局域网客户端免 Token 访问）.
    pub allow_lan_without_auth: bool,
    /// enable mDNS service discovery for LAN peer auto-detection（启用 mDNS 局域网自动发现）.
    pub enable_mdns: bool,
    /// enable Reticulum mesh networking for device discovery and pairing.
    pub enable_ret_mesh: bool,
    /// optional data directory for agent workspaces（可选 Agent workspace 数据目录）.
    pub data_dir: Option<PathBuf>,
}

impl Default for RuntimeStartOptions {
    fn default() -> Self {
        let spawn_ts_agents = spawn_ts_agents_default_for_platform(
            cfg!(any(target_os = "android", target_os = "ios")),
            env::var("EXOMIND_RT_DISABLE_TS_AGENTS").ok().as_deref(),
        );
        let data_dir = env::var("EXOMIND_RT_DATA_DIR").ok().map(PathBuf::from);

        let enable_mdns = env::var("EXOMIND_RT_MDNS")
            .map(|value| {
                let value = value.to_ascii_lowercase();
                value == "1" || value == "true"
            })
            .unwrap_or(false);

        let enable_ret_mesh = true;

        Self {
            bind_host: configured_bind_host_from_env(),
            port: configured_port_from_env().unwrap_or(DEFAULT_RT_PORT),
            host_id: configured_host_id_from_env(),
            device_id: configured_device_id_from_env(),
            spawn_builtin_actors: true,
            spawn_ts_agents,
            ts_agent_command: env::var("EXOMIND_RT_AGENT_CMD")
                .unwrap_or_else(|_| "bun".to_string()),
            ts_agent_workdir: env::var("EXOMIND_RT_AGENT_WORKDIR").ok().map(PathBuf::from),
            mesh_state_path: configured_mesh_state_path_from_env(data_dir.as_deref()),
            signal_storage_path: env::var("EXOMIND_RT_SIGNAL_SQLITE_PATH")
                .ok()
                .map(PathBuf::from),
            auth_secret: env::var("EXOMIND_RT_SECRET").ok(),
            allow_lan_without_auth: false,
            enable_mdns,
            enable_ret_mesh,
            data_dir,
        }
    }
}

/// Resolve TS agent default by platform + env（按平台 + 环境变量决定 TS Agent 默认值）.
/// Mobile defaults to disabled because packaged Android/iOS runtimes usually have no Bun/tooling.
/// （移动端默认关闭，因为打包后的 Android/iOS 运行时通常没有 Bun/tooling）
pub fn spawn_ts_agents_default_for_platform(
    is_mobile_platform: bool,
    disable_env: Option<&str>,
) -> bool {
    if let Some(value) = disable_env {
        let normalized = value.trim().to_ascii_lowercase();
        if normalized == "1" || normalized == "true" || normalized == "yes" {
            return false;
        }
        if normalized == "0" || normalized == "false" || normalized == "no" {
            return true;
        }
    }

    !is_mobile_platform
}

#[derive(Debug, Error)]
pub enum RuntimeStartError {
    #[error("invalid bind address: {raw}")]
    InvalidBindAddress {
        raw: String,
        #[source]
        source: std::net::AddrParseError,
    },
    #[error("failed to bind runtime listener on {bind_addr}: {source}")]
    BindListener {
        bind_addr: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to read listener local address: {0}")]
    ReadLocalAddr(#[source] std::io::Error),
}

#[derive(Debug, Error)]
pub enum RuntimeStopError {
    #[error("runtime server task join failed: {0}")]
    JoinServerTask(#[source] tokio::task::JoinError),
    #[error("runtime server returned IO error: {0}")]
    ServerIo(#[source] std::io::Error),
    #[error("failed to stop ts agent `{agent}`: {source}")]
    KillTsAgent {
        agent: String,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug)]
struct TsAgentProcess {
    name: String,
    child: Child,
}

/// Runtime handle（运行句柄）.
pub struct RuntimeHandle {
    local_addr: SocketAddr,
    host_id: String,
    signal_pool: Arc<SignalPool>,
    mesh: Arc<MeshState>,
    runtime_handle: tokio::runtime::Handle,
    mesh_relay: Option<Arc<MeshRelayManager>>,
    mdns: Option<Arc<discovery::MdnsDiscovery>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: Option<JoinHandle<std::io::Result<()>>>,
    actor_tasks: Vec<JoinHandle<()>>,
    ts_agents: Vec<TsAgentProcess>,
    #[cfg(not(target_os = "android"))]
    pty_manager: Arc<pty::PtyManager>,
    tick_manager: Arc<tick::TickManager>,
}

/// Publish request for in-process fast path（进程内快速发布请求）.
#[derive(Debug, Clone)]
pub struct RuntimePublishRequest {
    pub topic: String,
    pub source: Option<String>,
    pub payload: serde_json::Value,
    pub trace_id: Option<String>,
    pub origin_host_id: Option<String>,
}

impl RuntimeHandle {
    fn build_signal_event(
        default_origin_host_id: &str,
        request: RuntimePublishRequest,
    ) -> signal::types::SignalEvent {
        signal::types::SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: request.topic,
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: request.source.unwrap_or_else(|| "tauri:invoke".to_string()),
            origin_host_id: request
                .origin_host_id
                .unwrap_or_else(|| default_origin_host_id.to_string()),
            hop: 0,
            trace_id: request.trace_id,
            payload: request.payload,
        }
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn host_id(&self) -> &str {
        &self.host_id
    }

    pub fn host(&self) -> String {
        self.local_addr.ip().to_string()
    }

    pub fn port(&self) -> u16 {
        self.local_addr.port()
    }

    pub fn is_running(&self) -> bool {
        self.server_task
            .as_ref()
            .map(|task| !task.is_finished())
            .unwrap_or(false)
    }

    /// Clone underlying SignalPool Arc（克隆底层 SignalPool 引用）.
    pub fn clone_signal_pool(&self) -> Arc<SignalPool> {
        Arc::clone(&self.signal_pool)
    }

    /// Clone underlying MeshState Arc（克隆底层 MeshState 引用）.
    pub fn clone_mesh_state(&self) -> Arc<MeshState> {
        Arc::clone(&self.mesh)
    }

    /// Publish via a provided SignalPool（在指定 SignalPool 上发布）.
    pub fn publish_signal_to_pool(
        signal_pool: &SignalPool,
        default_origin_host_id: &str,
        request: RuntimePublishRequest,
    ) -> String {
        let event = Self::build_signal_event(default_origin_host_id, request);
        let event_id = event.id.clone();
        signal_pool.publish(event);
        event_id
    }

    /// Publish a signal directly via in-process SignalPool（进程内直发）.
    pub fn publish_signal(&self, request: RuntimePublishRequest) -> String {
        let event = Self::build_signal_event(&self.host_id, request);
        let event_id = event.id.clone();
        self.signal_pool.publish(event.clone());
        if let Some(mesh_relay) = &self.mesh_relay {
            let relay = Arc::clone(mesh_relay);
            // Use the runtime captured at startup so Tauri sync commands can publish safely
            // even when they are not currently executing inside a Tokio reactor.
            self.runtime_handle.spawn(async move {
                relay.forward_event_to_peers(event).await;
            });
        }
        event_id
    }

    /// Graceful shutdown（优雅停止）.
    pub async fn stop(&mut self) -> Result<(), RuntimeStopError> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        self.tick_manager.stop_all().await;

        for task in &self.actor_tasks {
            task.abort();
        }
        while let Some(task) = self.actor_tasks.pop() {
            let _ = task.await;
        }

        for agent in &mut self.ts_agents {
            match agent.child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    agent
                        .child
                        .kill()
                        .await
                        .map_err(|source| RuntimeStopError::KillTsAgent {
                            agent: agent.name.clone(),
                            source,
                        })?;
                    let _ = agent.child.wait().await;
                }
                Err(source) => {
                    return Err(RuntimeStopError::KillTsAgent {
                        agent: agent.name.clone(),
                        source,
                    });
                }
            }
        }
        self.ts_agents.clear();

        #[cfg(not(target_os = "android"))]
        self.pty_manager.shutdown().await;

        if let Some(mdns) = self.mdns.take() {
            mdns.shutdown();
        }

        if let Some(mesh_relay) = &self.mesh_relay {
            mesh_relay.shutdown().await;
        }

        if let Some(server_task) = self.server_task.take() {
            let mut server_task = server_task;
            match tokio::time::timeout(std::time::Duration::from_secs(2), &mut server_task).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(error))) => return Err(RuntimeStopError::ServerIo(error)),
                Ok(Err(error)) if error.is_cancelled() => {}
                Ok(Err(error)) => return Err(RuntimeStopError::JoinServerTask(error)),
                Err(_) => {
                    server_task.abort();
                    match server_task.await {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => return Err(RuntimeStopError::ServerIo(error)),
                        Err(error) if error.is_cancelled() => {}
                        Err(error) => return Err(RuntimeStopError::JoinServerTask(error)),
                    }
                }
            }
        }

        Ok(())
    }
}

impl Drop for RuntimeHandle {
    fn drop(&mut self) {
        if let Some(mdns) = self.mdns.take() {
            mdns.shutdown();
        }
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.tick_manager.abort_all();
        for task in self.actor_tasks.drain(..) {
            task.abort();
        }
        for agent in &mut self.ts_agents {
            let _ = agent.child.start_kill();
        }
        if let Some(server_task) = self.server_task.take() {
            server_task.abort();
        }
    }
}

/// Start runtime with env defaults（按环境变量默认值启动）.
pub async fn start() -> Result<RuntimeHandle, RuntimeStartError> {
    start_with_options(RuntimeStartOptions::default()).await
}

/// Start runtime with explicit options（按显式参数启动）.
pub async fn start_with_options(
    options: RuntimeStartOptions,
) -> Result<RuntimeHandle, RuntimeStartError> {
    let mut options = options;
    ensure_auth_secret_for_bind_host(&mut options);
    let ret_mesh_identity_seed = if options.enable_ret_mesh {
        let (identity_seed, public_identity_hex) = prepare_ret_mesh_identity(&options);
        if options.host_id != public_identity_hex {
            tracing::info!(
                legacy_host_id = %options.host_id,
                reticulum_identity = %public_identity_hex,
                "using Reticulum identity as runtime host_id"
            );
            options.host_id = public_identity_hex;
        }
        Some(identity_seed)
    } else {
        None
    };

    let bind_addr_raw = format!("{}:{}", options.bind_host, options.port);
    let bind_addr: SocketAddr =
        bind_addr_raw
            .parse()
            .map_err(|source| RuntimeStartError::InvalidBindAddress {
                raw: bind_addr_raw.clone(),
                source,
            })?;

    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|source| RuntimeStartError::BindListener {
            bind_addr: bind_addr_raw.clone(),
            source,
        })?;
    let local_addr = listener
        .local_addr()
        .map_err(RuntimeStartError::ReadLocalAddr)?;

    let mut state = AppState::new_runtime_with_storage_paths(
        local_addr.port(),
        options.host_id.clone(),
        options.mesh_state_path.clone(),
        options.signal_storage_path.clone(),
        true,
        options.auth_secret.clone(),
        runtime_storage_paths_for_persistent_start(options.data_dir.clone()),
    );
    state.device_id = options.device_id.clone();
    state.allow_lan_without_auth = options.allow_lan_without_auth;

    // Reticulum mesh networking (default enabled).
    // Start ret_mesh first so we know the actual UDP port before mDNS registration.
    let mut mdns: Option<Arc<discovery::MdnsDiscovery>> = None;
    let _ret_mesh = if options.enable_ret_mesh {
        tracing::info!("Reticulum mesh networking enabled (default)");
        match try_start_ret_mesh(
            &options,
            local_addr.port(),
            ret_mesh_identity_seed.as_deref(),
        )
        .await
        {
            Ok((node, actual_udp_port)) => {
                let discovered = node.discovered.clone();
                state.ret_mesh_peers = Some(discovered);
                state.ret_udp_port.store(actual_udp_port, Ordering::Relaxed);

                // mDNS registration — now that the actual UDP port is known.
                mdns = if options.enable_mdns {
                    let actual_port = actual_udp_port;
                    match discovery::MdnsDiscovery::new(
                        options.host_id.clone(),
                        local_addr.port(),
                        actual_port,
                    ) {
                        Ok(mdns) => {
                            if let Err(e) = mdns.register() {
                                tracing::warn!("mDNS register failed: {e}");
                            }
                            if let Err(e) = mdns.start_browsing() {
                                tracing::warn!("mDNS browsing failed: {e}");
                            }
                            let arc = Arc::new(mdns);
                            state.mdns = Some(Arc::clone(&arc));
                            Some(arc)
                        }
                        Err(e) => {
                            tracing::warn!("mDNS daemon creation failed: {e}");
                            None
                        }
                    }
                } else {
                    None
                };

                let handle = node.event_tx.subscribe();
                let mdns_clone = state.mdns.clone();
                let (connect_tx, connect_rx) =
                    tokio::sync::broadcast::channel::<(String, String)>(64);
                let (pairing_tx, pairing_rx) =
                    tokio::sync::mpsc::channel::<RetMeshPairingCommand>(64);
                state.ret_mesh_connect_tx = Some(connect_tx);
                state.ret_mesh_pairing_tx = Some(pairing_tx);
                let (ret_mesh_event_tx, _ret_mesh_event_rx) =
                    tokio::sync::broadcast::channel::<String>(64);
                state.ret_mesh_event_tx = Some(ret_mesh_event_tx.clone());
                let ret_mesh_mode = state.ret_mesh_mode.clone();
                let ret_runtime_state = state.clone();
                tokio::spawn(ret_mesh_background(
                    node,
                    mdns_clone,
                    connect_rx,
                    pairing_rx,
                    ret_mesh_mode,
                    ret_runtime_state,
                ));
                Some(handle)
            }
            Err(e) => {
                tracing::warn!("Reticulum mesh startup failed: {e}, continuing without it");
                None
            }
        }
    } else {
        None
    };

    let signal_pool = Arc::clone(&state.signal_pool);
    let mesh = Arc::clone(&state.mesh);
    let runtime_handle = tokio::runtime::Handle::current();
    let mesh_relay = state.mesh_relay.clone();

    let mut actor_tasks = Vec::new();
    if options.spawn_builtin_actors {
        actor_tasks.push(
            signal::actors::signal_dispatcher_actor::spawn_signal_dispatcher_actor(
                Arc::clone(&state.signal_pool),
                state.registry.clone(),
            ),
        );
        actor_tasks.push(
            signal::actors::input_ingest_actor::spawn_input_ingest_actor(Arc::clone(
                &state.signal_pool,
            )),
        );
        actor_tasks.push(
            signal::actors::external_input_actor::spawn_external_input_actor(Arc::clone(
                &state.signal_pool,
            )),
        );
        actor_tasks.push(
            signal::actors::external_source_actor::spawn_external_source_actor(
                Arc::clone(&state.signal_pool),
                signal::actors::external_source_actor::ExternalSourceConfig::default(),
            ),
        );
        actor_tasks.push(signal::actors::task_classifier_actor::spawn_task_actor(
            Arc::clone(&state.signal_pool),
        ));
        actor_tasks.push(signal::actors::eventlog_actor::spawn_eventlog_actor(
            Arc::clone(&state.signal_pool),
        ));
        actor_tasks.push(signal::actors::link_proof_actor::spawn_link_proof_actor(
            Arc::clone(&state.signal_pool),
            options.host_id.clone(),
        ));
        actor_tasks.push(signal::actors::replication_actor::spawn_replication_actor(
            Arc::clone(&state.signal_pool),
            options.host_id.clone(),
            Arc::clone(&state.eventlog_store),
            Arc::clone(&state.task_store),
            Arc::clone(&state.timeblock_store),
            Arc::clone(&state.proposal_store),
        ));
        actor_tasks.push(task::actor::spawn_task_store_actor(
            Arc::clone(&state.signal_pool),
            Arc::clone(&state.task_store),
        ));
    }

    let ts_agents = if options.spawn_ts_agents {
        spawn_default_ts_agents(local_addr.port(), &options)
    } else {
        Vec::new()
    };

    // Register heartbeat demo agent + energy
    if options.spawn_builtin_actors {
        let heartbeat = Arc::new(agent::heartbeat::HeartbeatAgent::new("heartbeat"));
        state.registry.register(heartbeat);
        state
            .energy_registry
            .register("heartbeat", energy::AgentEnergy::new(100, 10));

        // Register cognitive life agent
        let data_dir = options
            .data_dir
            .clone()
            .unwrap_or_else(|| PathBuf::from("runtime-data"));
        match agent::workspace::AgentWorkspace::init("life-alpha", &data_dir) {
            Ok(workspace) => {
                let soul = workspace.load_soul().unwrap_or_default();
                let cognition =
                    Box::new(agent::llm_cognition::LlmCognition::new("life-alpha", soul));
                let life_agent = Arc::new(
                    agent::life::CognitiveLifeAgent::new(
                        "life-alpha",
                        "认知生命体 Alpha",
                        workspace,
                        cognition,
                    )
                    .with_agent_api_tick_trigger(
                        agent::life::AgentApiTickTrigger::new(
                            agent::session::AgentSessionRuntime::from_state(&state),
                        ),
                    ),
                );
                state
                    .registry
                    .register(Arc::clone(&life_agent) as Arc<dyn agent::Agent>);
                state
                    .life_agents
                    .insert("life-alpha".to_string(), life_agent);
                state
                    .energy_registry
                    .register("life-alpha", energy::AgentEnergy::new(200, 5));
            }
            Err(e) => {
                tracing::warn!("failed to init life agent workspace: {e}");
            }
        }
    }

    // Start tick scheduler for all agents with tick_interval_secs > 0.
    // 启动所有启用 tick 的 agent 生命周期循环。
    let tick_manager = Arc::clone(&state.tick_manager);
    tick_manager.start_all_ticks();

    #[cfg(not(target_os = "android"))]
    let pty_manager = Arc::clone(&state.pty_manager);
    let app = app_with_state(state);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_task = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await
    });

    if let Some(mesh_relay) = &mesh_relay {
        mesh_relay.sync_local_interests_to_all_peers().await;
        mesh_relay.reconcile_all_peers().await;
    }

    Ok(RuntimeHandle {
        local_addr,
        host_id: options.host_id,
        signal_pool,
        mesh,
        runtime_handle,
        mesh_relay,
        mdns,
        shutdown_tx: Some(shutdown_tx),
        server_task: Some(server_task),
        actor_tasks,
        ts_agents,
        #[cfg(not(target_os = "android"))]
        pty_manager,
        tick_manager,
    })
}

fn spawn_default_ts_agents(port: u16, options: &RuntimeStartOptions) -> Vec<TsAgentProcess> {
    const REVIEWER_ENTRY: &str = "packages/ts-agent-cli/agents/reviewer/index.ts";
    const CLASSIFIER_ENTRY: &str = "packages/ts-agent-cli/agents/classifier/index.ts";
    let project_root = resolve_project_root(options);
    let rt_url = format!("http://127.0.0.1:{port}");

    let mut out = Vec::new();
    if let Some(proc) = try_spawn_ts_agent(
        "reviewer",
        REVIEWER_ENTRY,
        &project_root,
        &options.ts_agent_command,
        &rt_url,
    ) {
        out.push(proc);
    }
    if let Some(proc) = try_spawn_ts_agent(
        "classifier",
        CLASSIFIER_ENTRY,
        &project_root,
        &options.ts_agent_command,
        &rt_url,
    ) {
        out.push(proc);
    }
    out
}

fn resolve_project_root(options: &RuntimeStartOptions) -> PathBuf {
    let current_dir = env::current_dir().ok();
    resolve_project_root_from(options.ts_agent_workdir.as_deref(), current_dir.as_deref())
}

fn resolve_project_root_from(
    ts_agent_workdir: Option<&Path>,
    current_dir: Option<&Path>,
) -> PathBuf {
    const REVIEWER_ENTRY: &str = "packages/ts-agent-cli/agents/reviewer/index.ts";
    const CLASSIFIER_ENTRY: &str = "packages/ts-agent-cli/agents/classifier/index.ts";

    fn has_default_ts_agent_entries(root: &Path) -> bool {
        root.join(REVIEWER_ENTRY).is_file() && root.join(CLASSIFIER_ENTRY).is_file()
    }

    if let Some(path) = ts_agent_workdir {
        return path.to_path_buf();
    }

    if let Some(cwd) = current_dir
        && has_default_ts_agent_entries(cwd)
    {
        return cwd.to_path_buf();
    }

    if let Some(workspace_root) = workspace_root_from_manifest()
        && has_default_ts_agent_entries(&workspace_root)
    {
        return workspace_root;
    }

    current_dir
        .map(Path::to_path_buf)
        .or_else(workspace_root_from_manifest)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn workspace_root_from_manifest() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .map(|path| path.to_path_buf())
}

fn try_spawn_ts_agent(
    name: &str,
    entry: &str,
    project_root: &PathBuf,
    cmd: &str,
    rt_url: &str,
) -> Option<TsAgentProcess> {
    let mut command = Command::new(cmd);
    command
        .arg("run")
        .arg(entry)
        .current_dir(project_root)
        .env("EXOMIND_RT_URL", rt_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => Some(TsAgentProcess {
            name: name.to_string(),
            child,
        }),
        Err(error) => {
            eprintln!("exomind-rt: failed to spawn ts agent `{name}`: {error}");
            None
        }
    }
}

/// Build HTTP router (HTTP 路由构建入口).
pub fn app(runtime_port: u16) -> Router {
    app_with_state(AppState::new(runtime_port))
}

/// Build HTTP router from an existing AppState.
pub fn app_with_state(state: AppState) -> Router {
    // Enable CORS for browser-side host aggregation (允许浏览器跨端口访问 runtime).
    // CORS must be outermost so that preflight OPTIONS requests (which carry no token) are handled.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _parts| {
            origin
                .to_str()
                .ok()
                .map(auth::is_trusted_loopback_origin_value)
                .unwrap_or(false)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // Protected routes — auth middleware applied here.
    let protected = routes::router().route_layer(axum::middleware::from_fn_with_state(
        state.clone(),
        auth::require_auth,
    ));

    Router::new()
        .route("/health", get(health))
        .route("/version", get(version))
        .merge(routes::public_router())
        .merge(protected)
        .layer(cors)
        .with_state(state)
}


#[derive(Debug)]
pub enum RetMeshPairingFailure {
    Transport(String),
    Rejected(String),
    Timeout,
}

#[derive(Debug)]
pub struct RetMeshPairingSuccess {
    pub request_id: String,
    pub initiator_inbound_token: String,
}

#[derive(Debug)]
pub enum RetMeshPairingCommand {
    /// Send a PIN pairing response (responder → initiator).
    PairWithPeer {
        peer: exomind_net_pairing::DiscoveredPeer,
        pin: String,
        responder_inbound_token: String,
        responder_base_url: String,
        reply: tokio::sync::oneshot::Sender<
            Result<RetMeshPairingSuccess, RetMeshPairingFailure>,
        >,
    },
    /// Send a PairingOffer to notify the target peer that a pairing session
    /// has been initiated. Fire-and-forget (no reply needed).
    SendPairingOffer {
        peer: exomind_net_pairing::DiscoveredPeer,
        session_id: String,
        initiator_peer_id: String,
        initiator_host_id: String,
        initiator_node_name: String,
    },
    /// Set per-interface mode (0=Off, 1=Passive, 2=Active).
    SetInterfaceMode {
        name: String,
        mode: exomind_net_pairing::RetMeshMode,
    },
}

#[derive(Clone)]
pub struct AppState {
    pub port: u16,
    pub host_id: String,
    pub device_id: String,
    pub registry: agent::AgentRegistry,
    pub signal_pool: Arc<SignalPool>,
    pub mesh: Arc<MeshState>,
    pub mesh_relay: Option<Arc<MeshRelayManager>>,
    pub auth_secret: Option<String>,
    pub allow_lan_without_auth: bool,
    pub mdns: Option<Arc<discovery::MdnsDiscovery>>,
    pub ret_mesh_peers: Option<
        Arc<
            tokio::sync::RwLock<
                std::collections::HashMap<String, exomind_net_pairing::DiscoveredPeer>,
            >,
        >,
    >,
    /// Sender to trigger Reticulum TCP connection from the pairing/http layer.
    /// Value is (host_id, tcp_addr).
    pub ret_mesh_connect_tx: Option<tokio::sync::broadcast::Sender<(String, String)>>,
    /// Sender for PIN-over-Reticulum pairing requests from the UI route.
    pub ret_mesh_pairing_tx: Option<tokio::sync::mpsc::Sender<RetMeshPairingCommand>>,
    /// Controls the Reticulum announce/connectivity mode (Off/Passive/Active).
    pub ret_mesh_mode: std::sync::Arc<std::sync::Mutex<exomind_net_pairing::RetMeshMode>>,
    /// Actual UDP port assigned by OS for Reticulum discovery (0 until bound).
    pub ret_udp_port: std::sync::Arc<std::sync::atomic::AtomicU16>,
    /// SSE broadcast for Reticulum mesh state snapshots.
    pub ret_mesh_event_tx: Option<tokio::sync::broadcast::Sender<String>>,
    pub pairing: Arc<pairing::PairingManager>,
    pub config_store: Arc<config::ConfigStore>,
    pub reminder_store: Arc<reminder::ReminderStore>,
    pub task_store: Arc<task::TaskStore>,
    pub proposal_store: Arc<proposal::ProposalStore>,
    pub session_store: Arc<session::SessionStore>,
    pub agent_api_session_store: Arc<agent::session::AgentSessionStore>,
    pub session_event_tx: Option<tokio::sync::broadcast::Sender<routes::sessions::SessionEvent>>,
    pub eventlog_watch_tx: tokio::sync::broadcast::Sender<String>,
    pub timeblock_store: Arc<timeblock::TimeBlockStore>,
    pub energy_registry: energy::EnergyRegistry,
    pub tick_manager: Arc<tick::TickManager>,
    /// Typed reference to CognitiveLifeAgent instances for workspace API access.
    pub life_agents: std::collections::HashMap<String, Arc<agent::life::CognitiveLifeAgent>>,
    pub eventlog_store: Arc<EventLogStore>,
    #[cfg(not(target_os = "android"))]
    pub pty_manager: Arc<pty::PtyManager>,
}

/// Resolve the runtime data directory from `EXOMIND_RT_DATA_DIR` env var,
/// falling back to `./runtime-data`.
fn resolve_data_dir() -> PathBuf {
    env::var("EXOMIND_RT_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./runtime-data"))
}

#[derive(Debug, Clone)]
struct RuntimeStoragePaths {
    data_dir: PathBuf,
    eventlog_sqlite_path: Option<PathBuf>,
    config_sqlite_path: Option<PathBuf>,
    reminder_sqlite_path: Option<PathBuf>,
    task_sqlite_path: Option<PathBuf>,
    proposal_sqlite_path: Option<PathBuf>,
    timeblock_sqlite_path: Option<PathBuf>,
    session_sqlite_path: Option<PathBuf>,
}

fn runtime_storage_paths_from_env() -> RuntimeStoragePaths {
    RuntimeStoragePaths {
        data_dir: resolve_data_dir(),
        eventlog_sqlite_path: env::var("EXOMIND_RT_EVENTLOG_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        config_sqlite_path: env::var("EXOMIND_RT_CONFIG_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        reminder_sqlite_path: env::var("EXOMIND_RT_REMINDER_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        task_sqlite_path: env::var("EXOMIND_RT_TASK_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        proposal_sqlite_path: env::var("EXOMIND_RT_PROPOSAL_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        timeblock_sqlite_path: env::var("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
        session_sqlite_path: env::var("EXOMIND_RT_SESSION_SQLITE_PATH")
            .ok()
            .map(PathBuf::from),
    }
}

fn runtime_storage_paths_for_persistent_start(data_dir: Option<PathBuf>) -> RuntimeStoragePaths {
    let data_dir = data_dir.unwrap_or_else(resolve_data_dir);
    RuntimeStoragePaths {
        eventlog_sqlite_path: env::var("EXOMIND_RT_EVENTLOG_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("eventlog.sqlite"))),
        config_sqlite_path: env::var("EXOMIND_RT_CONFIG_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("config.sqlite"))),
        reminder_sqlite_path: env::var("EXOMIND_RT_REMINDER_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("reminders.sqlite"))),
        task_sqlite_path: env::var("EXOMIND_RT_TASK_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("tasks.sqlite"))),
        proposal_sqlite_path: env::var("EXOMIND_RT_PROPOSAL_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("proposals.sqlite"))),
        timeblock_sqlite_path: env::var("EXOMIND_RT_TIMEBLOCK_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("timeblocks.sqlite"))),
        session_sqlite_path: env::var("EXOMIND_RT_SESSION_SQLITE_PATH")
            .ok()
            .map(PathBuf::from)
            .or_else(|| Some(data_dir.join("sessions.sqlite"))),
        data_dir,
    }
}

impl AppState {
    pub fn new(port: u16) -> Self {
        Self::new_runtime(port, default_runtime_host_id(port), None, None, false, None)
    }

    pub fn new_runtime(
        port: u16,
        host_id: String,
        mesh_persist_path: Option<PathBuf>,
        signal_storage_path: Option<PathBuf>,
        enable_mesh_relay: bool,
        auth_secret: Option<String>,
    ) -> Self {
        Self::new_runtime_with_storage_paths(
            port,
            host_id,
            mesh_persist_path,
            signal_storage_path,
            enable_mesh_relay,
            auth_secret,
            runtime_storage_paths_from_env(),
        )
    }

    #[cfg(test)]
    pub fn new_isolated_test_runtime(port: u16, host_id: String) -> (tempfile::TempDir, Self) {
        let tempdir = tempfile::tempdir().expect("create isolated runtime tempdir");
        let storage_paths = RuntimeStoragePaths {
            data_dir: tempdir.path().join("runtime-data"),
            eventlog_sqlite_path: Some(tempdir.path().join("eventlog.sqlite")),
            config_sqlite_path: Some(tempdir.path().join("config.sqlite")),
            reminder_sqlite_path: Some(tempdir.path().join("reminders.sqlite")),
            task_sqlite_path: Some(tempdir.path().join("tasks.sqlite")),
            proposal_sqlite_path: Some(tempdir.path().join("proposals.sqlite")),
            timeblock_sqlite_path: Some(tempdir.path().join("timeblocks.sqlite")),
            session_sqlite_path: Some(tempdir.path().join("sessions.sqlite")),
        };
        let state = Self::new_runtime_with_storage_paths(
            port,
            host_id,
            None,
            None,
            false,
            None,
            storage_paths,
        );
        (tempdir, state)
    }

    fn new_runtime_with_storage_paths(
        port: u16,
        host_id: String,
        mesh_persist_path: Option<PathBuf>,
        signal_storage_path: Option<PathBuf>,
        enable_mesh_relay: bool,
        auth_secret: Option<String>,
        storage_paths: RuntimeStoragePaths,
    ) -> Self {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(agent::claude::ClaudeAgent::new()));
        registry.register(Arc::new(agent::echo::EchoAgent::new()));

        let default_routes_path =
            resolve_default_signal_routes_path().map(|path| path.to_string_lossy().to_string());
        let signal_pool = Arc::new(match signal_storage_path {
            Some(path) => match SignalPool::with_sqlite_path(default_routes_path.as_deref(), &path)
            {
                Ok(pool) => pool,
                Err(error) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "signal sqlite init failed, falling back to in-memory pool (Signal SQLite 初始化失败，降级到内存池)"
                    );
                    SignalPool::new(default_routes_path.as_deref())
                }
            },
            None => SignalPool::new(default_routes_path.as_deref()),
        });
        let mesh = Arc::new(MeshState::new(
            host_id.clone(),
            Arc::clone(&signal_pool),
            mesh_persist_path,
        ));
        let mesh_relay =
            enable_mesh_relay.then(|| Arc::new(MeshRelayManager::new(Arc::clone(&mesh))));
        #[cfg(not(target_os = "android"))]
        let pty_manager = Arc::new(pty::PtyManager::new_with_transcript_dir(
            Arc::clone(&signal_pool),
            host_id.clone(),
            Some(storage_paths.data_dir.join("pty-transcripts")),
        ));

        let data_dir = storage_paths.data_dir;
        if let Err(error) = std::fs::create_dir_all(&data_dir) {
            tracing::warn!(
                path = %data_dir.display(),
                error = %error,
                "failed to create runtime data dir (创建运行时数据目录失败)"
            );
        }
        let config_store = storage_paths
            .config_sqlite_path
            .map(|path| {
                config::ConfigStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "config sqlite init failed, falling back to in-memory store (Config SQLite 初始化失败，降级到内存存储)"
                    );
                    config::ConfigStore::new()
                })
            })
            .unwrap_or_default();
        let config_store = Arc::new(config_store);
        let eventlog_store = storage_paths
            .eventlog_sqlite_path
            .map(|path| {
                EventLogStore::with_sqlite_path(data_dir.clone(), &path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "eventlog sqlite init failed, falling back to json-file store (EventLog SQLite 初始化失败，降级到 JSON 文件存储)"
                    );
                    EventLogStore::new(data_dir.clone())
                })
            })
            .unwrap_or_else(|| EventLogStore::new(data_dir));
        eventlog_store.set_config_store(Arc::clone(&config_store));
        let reminder_store = storage_paths
            .reminder_sqlite_path
            .map(|path| {
                reminder::ReminderStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "reminder sqlite init failed, falling back to in-memory store (Reminder SQLite 初始化失败，降级到内存存储)"
                    );
                    reminder::ReminderStore::new()
                })
            })
            .unwrap_or_default();
        let task_store = storage_paths
            .task_sqlite_path
            .map(|path| {
                task::TaskStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "task sqlite init failed, falling back to in-memory store (Task SQLite 初始化失败，降级到内存存储)"
                    );
                    task::TaskStore::new()
                })
            })
            .unwrap_or_default();
        let proposal_store = storage_paths
            .proposal_sqlite_path
            .map(|path| {
                proposal::ProposalStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "proposal sqlite init failed, falling back to in-memory store (Proposal SQLite 初始化失败，降级到内存存储)"
                    );
                    proposal::ProposalStore::new()
                })
            })
            .unwrap_or_default();
        let timeblock_store = storage_paths
            .timeblock_sqlite_path
            .map(|path| {
                timeblock::TimeBlockStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "timeblock sqlite init failed, falling back to in-memory store (TimeBlock SQLite 初始化失败，降级到内存存储)"
                    );
                    timeblock::TimeBlockStore::new()
                })
            })
            .unwrap_or_default();
        let session_sqlite_path = storage_paths.session_sqlite_path.clone();
        let session_store = session_sqlite_path
            .clone()
            .map(|path| {
                session::SessionStore::with_sqlite_path(&path).unwrap_or_else(|error| {
                    tracing::warn!(
                        path = %path.display(),
                        error = %error,
                        "session sqlite init failed, falling back to in-memory store (Session SQLite 初始化失败，降级到内存存储)"
                    );
                    session::SessionStore::new()
                })
            })
            .unwrap_or_default();
        let agent_api_session_store = session_sqlite_path
            .map(|path| {
                agent::session::AgentSessionStore::with_sqlite_path(&path).unwrap_or_else(
                    |error| {
                        tracing::warn!(
                            path = %path.display(),
                            error = %error,
                            "agent api session sqlite init failed, falling back to in-memory store (Agent API Session SQLite 初始化失败，降级到内存存储)"
                        );
                        agent::session::AgentSessionStore::new()
                    },
                )
            })
            .unwrap_or_default();
        let energy_registry = energy::EnergyRegistry::new();
        let tick_manager = Arc::new(tick::TickManager::new(
            host_id.clone(),
            registry.clone(),
            energy_registry.clone(),
            Arc::clone(&signal_pool),
        ));

        let (eventlog_watch_tx, _rx) = routes::eventlog::eventlog_watch_channel();
        eventlog_store.set_watch_tx(eventlog_watch_tx.clone());

        Self {
            port,
            host_id,
            device_id: default_runtime_device_id(port),
            registry,
            signal_pool,
            mesh,
            mesh_relay,
            auth_secret,
            allow_lan_without_auth: false,
            mdns: None,
            ret_mesh_peers: None,
            ret_mesh_connect_tx: None,
            ret_mesh_pairing_tx: None,
            ret_mesh_mode: std::sync::Arc::new(std::sync::Mutex::new(
                exomind_net_pairing::RetMeshMode::Active,
            )),
            ret_udp_port: std::sync::Arc::new(std::sync::atomic::AtomicU16::new(0)),
            ret_mesh_event_tx: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            config_store,
            reminder_store: Arc::new(reminder_store),
            task_store: Arc::new(task_store),
            proposal_store: Arc::new(proposal_store),
            session_store: Arc::new(session_store),
            agent_api_session_store: Arc::new(agent_api_session_store),
            session_event_tx: {
                let (tx, _rx) = routes::sessions::session_event_channel();
                Some(tx)
            },
            eventlog_watch_tx,
            timeblock_store: Arc::new(timeblock_store),
            energy_registry,
            tick_manager,
            life_agents: std::collections::HashMap::new(),
            eventlog_store: Arc::new(eventlog_store),
            #[cfg(not(target_os = "android"))]
            pty_manager,
        }
    }
}

fn resolve_default_signal_routes_path() -> Option<PathBuf> {
    let current_dir = env::current_dir().ok();
    resolve_default_signal_routes_path_from(current_dir.as_deref())
}

fn resolve_default_signal_routes_path_from(current_dir: Option<&Path>) -> Option<PathBuf> {
    const DEFAULT_ROUTES_RELATIVE_PATH: &str = "config/signal-routes.default.json";

    if let Ok(override_path) = env::var("EXOMIND_RT_SIGNAL_ROUTES_DEFAULT") {
        let candidate = PathBuf::from(override_path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Some(cwd) = current_dir {
        let candidate = cwd.join(DEFAULT_ROUTES_RELATIVE_PATH);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let workspace_candidate =
        workspace_root_from_manifest().map(|root| root.join(DEFAULT_ROUTES_RELATIVE_PATH));
    if let Some(candidate) = workspace_candidate
        && candidate.is_file()
    {
        return Some(candidate);
    }

    None
}

pub type RuntimeState = AppState;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[derive(Debug, Serialize)]
struct VersionResponse {
    version: &'static str,
    git_hash: &'static str,
    build_time: &'static str,
}

async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        version: RUNTIME_VERSION,
        git_hash: BUILD_GIT_HASH,
        build_time: BUILD_TIME,
    })
}

// ── Reticulum mesh networking ──────────────────────────────────────

/// Try to start a Reticulum mesh node for device discovery and pairing.
/// UDP discovery uses OS-assigned dynamic port (0.0.0.0:0); actual port is
/// published via mDNS TXT `ret_port` and local file registry.
async fn try_start_ret_mesh(
    options: &RuntimeStartOptions,
    port: u16,
    identity_seed: Option<&str>,
) -> Result<(exomind_net_pairing::RetMeshNode, u16), Box<dyn std::error::Error>> {
    let config = exomind_net_pairing::RetMeshConfig {
        host_id: options.host_id.clone(),
        node_name: options.device_id.clone(),
        app_version: format!("{}", env!("CARGO_PKG_VERSION")),
        port,
        ..Default::default()
    };

    let identity = exomind_net_pairing::RetMeshNode::load_or_create_identity(identity_seed);
    let local_identity_hex = exomind_net_pairing::RetMeshNode::public_identity_hex(&identity);
    let transport = exomind_net_pairing::RetMeshNode::create_transport(
        &config.node_name,
        &identity,
        config.broadcast_capacity,
    );
    tracing::info!(
        "Reticulum public identity initialized: {}",
        local_identity_hex
    );

    // Add a UDP interface for discovery (dynamic port, OS-assigned).
    // Broadcast to 255.255.255.255 does not work on Windows loopback;
    // peer discovery is handled by mDNS + file registry which create
    // directed interfaces to specific peer addresses.
    let bound_port = exomind_net_pairing::RetMeshNode::add_udp_interface(
        &transport,
        "0.0.0.0:0",
        None, // RX-only initially; directed peers create their own forward interfaces
    )
    .await;
    // Wait for the OS to assign a port
    let mut actual_udp_port: u16 = 0;
    for _ in 0..50 {
        use std::sync::atomic::Ordering;
        actual_udp_port = bound_port.load(Ordering::Relaxed);
        if actual_udp_port > 0 {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    tracing::info!(
        "Reticulum UDP discovery bound to 0.0.0.0:{} (dynamic, rx-only)",
        actual_udp_port
    );

    // Also add a TCP server interface for remote/seed connections.
    // When RT port is in ephemeral range (> 60535), port+5000 exceeds u16::MAX.
    // Use subtractive offset: port - 5000 instead, keeping result in valid range.
    let (tcp_port, tcp_bias) = if port > 60535 {
        (port - 5000, "low")
    } else {
        (port + 5000, "high")
    };
    let tcp_addr = format!("127.0.0.1:{}", tcp_port);
    exomind_net_pairing::RetMeshNode::add_tcp_interface(&transport, &tcp_addr).await;
    tracing::info!("Reticulum TCP interface listening on {} (RT port {}, {} bias)", tcp_addr, port, tcp_bias);

    // Optionally connect to a seed peer via RET_MESH_SEED env var.
    if let Ok(seed) = std::env::var("RET_MESH_SEED") {
        let seed = seed.trim().to_string();
        if !seed.is_empty() {
            exomind_net_pairing::RetMeshNode::add_tcp_client(&transport, &seed).await;
            tracing::info!("Reticulum connecting to seed peer at {}", seed);
        }
    }

    let mut node = exomind_net_pairing::RetMeshNode::new(config, transport, identity).await;

    // Brief delay to allow seed TCP connections to be established,
    // then announce so the announce propagates through all interfaces.
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    tracing::info!("Reticulum identity ready, announcing presence...");
    node.announce().await;
    tracing::info!("Reticulum presence announced");

    Ok((node, actual_udp_port))
}

/// Background loop for Reticulum mesh events.
struct PendingRetPairing {
    peer_id: String,
    pin: String,
    responder_inbound_token: String,
    reply: tokio::sync::oneshot::Sender<Result<RetMeshPairingSuccess, RetMeshPairingFailure>>,
    created_at: std::time::Instant,
}

fn ret_discovered_peer_id(peer: &exomind_net_pairing::DiscoveredPeer) -> String {
    if peer.identity_hex.is_empty() {
        peer.host_id.clone()
    } else {
        peer.identity_hex.clone()
    }
}

async fn ret_mesh_authorize_pairing_response(
    state: &AppState,
    frame: exomind_net_pairing::RetPairingLinkFrame,
) -> exomind_net_pairing::RetPairingResultAnnounce {
    let exomind_net_pairing::RetPairingLinkFrame::PairingResponse {
        request_id,
        session_id,
        pin,
        initiator_peer_id,
        responder_peer_id,
        responder_host_id: _,
        responder_node_name: _,
        responder_port,
        responder_base_url,
        responder_inbound_token,
    } = frame else {
        unreachable!("ret_mesh_authorize_pairing_response called with non-PairingResponse frame");
    };

    if initiator_peer_id != state.host_id {
        return exomind_net_pairing::RetPairingResultAnnounce {
            request_id,
            accepted: false,
            initiator_peer_id: state.host_id.clone(),
            responder_peer_id,
            error: Some("pairing frame targeted a different Reticulum identity".to_string()),
        };
    }

    let pairing_result = if let Some(session_id) = session_id.as_deref().filter(|value| !value.is_empty()) {
        state.pairing.respond(session_id, &pin, &responder_peer_id)
    } else {
        state
            .pairing
            .respond_by_initiator(&state.host_id, &pin, &responder_peer_id)
    };

    let Ok(result) = pairing_result else {
        return exomind_net_pairing::RetPairingResultAnnounce {
            request_id,
            accepted: false,
            initiator_peer_id: state.host_id.clone(),
            responder_peer_id,
            error: Some("PIN 验证失败或会话已过期".to_string()),
        };
    };

    let initiator_inbound_token =
        exomind_net_pairing::pairing::derive_initiator_inbound_token(
            &request_id,
            &pin,
            &state.host_id,
            &responder_peer_id,
            &responder_inbound_token,
        );
    let now = chrono::Utc::now().to_rfc3339();
    let base_url = if responder_base_url.trim().is_empty() {
        format!("http://127.0.0.1:{responder_port}")
    } else {
        responder_base_url
    };

    let mesh_peer = state.mesh.upsert_peer(mesh::PeerInfo {
        id: responder_peer_id.clone(),
        base_url,
        enabled: true,
        capabilities: vec![],
        status: mesh::PeerStatus::Unknown,
        last_seen: None,
        last_error: None,
        created_at: now.clone(),
        updated_at: now,
        auth_token: Some(responder_inbound_token),
        inbound_secret: Some(initiator_inbound_token),
    });

    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&mesh_peer.id).await;
        relay.sync_local_interests_to_peer(&mesh_peer.id).await.ok();
    }

    tracing::info!(
        peer_id = %mesh_peer.id,
        peer_token_len = result.peer_token.len(),
        "Reticulum PIN pairing authorized responder peer"
    );

    exomind_net_pairing::RetPairingResultAnnounce {
        request_id,
        accepted: true,
        initiator_peer_id: state.host_id.clone(),
        responder_peer_id,
        error: None,
    }
}

fn ret_mesh_complete_pairing_result(
    state: &AppState,
    pending_pairings: &mut std::collections::HashMap<String, PendingRetPairing>,
    result: exomind_net_pairing::RetPairingResultAnnounce,
) {
    let Some(pending) = pending_pairings.remove(&result.request_id) else {
        return;
    };

    if result.responder_peer_id != state.host_id || result.initiator_peer_id != pending.peer_id {
        let _ = pending.reply.send(Err(RetMeshPairingFailure::Rejected(
            "pairing result identity mismatch".to_string(),
        )));
        return;
    }

    if !result.accepted {
        let _ = pending.reply.send(Err(RetMeshPairingFailure::Rejected(
            result.error.unwrap_or_else(|| "配对被远端拒绝".to_string()),
        )));
        return;
    }

    let initiator_inbound_token =
        exomind_net_pairing::pairing::derive_initiator_inbound_token(
            &result.request_id,
            &pending.pin,
            &pending.peer_id,
            &state.host_id,
            &pending.responder_inbound_token,
        );

    let _ = pending.reply.send(Ok(RetMeshPairingSuccess {
        request_id: result.request_id,
        initiator_inbound_token,
    }));
}

/// Build and push a Reticulum mesh state snapshot through the SSE channel.
async fn try_push_ret_mesh_snapshot(
    state: &AppState,
    interfaces: Vec<exomind_net_pairing::InterfaceInfo>,
) {
    try_push_ret_mesh_snapshot_with_offer(state, interfaces, None).await;
}

/// Build and push a Reticulum mesh state snapshot, optionally including
/// a `pairing_pending` field (used to notify the frontend of an incoming
/// PairingOffer from a remote peer).
async fn try_push_ret_mesh_snapshot_with_offer(
    state: &AppState,
    interfaces: Vec<exomind_net_pairing::InterfaceInfo>,
    pairing_pending: Option<String>,
) {
    use std::sync::atomic::Ordering;
    let Some(tx) = &state.ret_mesh_event_tx else { return };
    let mode = *state.ret_mesh_mode.lock().unwrap();
    let (discovered_count, authorized_count, peers_list) =
        if let Some(peers) = &state.ret_mesh_peers {
            let map = peers.read().await;
            let auth_count = map
                .values()
                .filter(|p| {
                    matches!(
                        p.trust_state,
                        exomind_net_pairing::discovery::TrustState::Paired
                            | exomind_net_pairing::discovery::TrustState::Trusted
                    )
                })
                .count();
            let list: Vec<serde_json::Value> = map
                .values()
                .map(|peer| {
                    let peer_id = if peer.identity_hex.is_empty() {
                        peer.host_id.clone()
                    } else {
                        peer.identity_hex.clone()
                    };
                    let authorized = state
                        .mesh
                        .get_peer(&peer_id)
                        .or_else(|| {
                            (peer_id != peer.host_id)
                                .then(|| state.mesh.get_peer(&peer.host_id))
                                .flatten()
                        })
                        .filter(|mp| mp.enabled && mp.inbound_secret.is_some())
                        .is_some();
                    let connection_state = match peer.trust_state {
                        exomind_net_pairing::discovery::TrustState::Blocked => "blocked",
                        exomind_net_pairing::discovery::TrustState::Trusted if authorized => {
                            "trusted"
                        }
                        _ if authorized => "connected_authorized",
                        _ if peer.online => "connected_unauthorized",
                        _ => "discovered",
                    };
                    serde_json::json!({
                        "host_id": peer.host_id,
                        "node_name": peer.node_name,
                        "app_version": peer.app_version,
                        "port": peer.port,
                        "identity_hex": peer.identity_hex,
                        "destination_hex": peer.destination_hex,
                        "peer_id": peer_id,
                        "last_seen_ms": peer.last_seen_ms,
                        "online": peer.online,
                        "trust_state": peer.trust_state,
                        "connection_state": connection_state,
                        "authorized": authorized,
                        "rtt_ms": peer.rtt_ms,
                    })
                })
                .collect();
            (map.len(), auth_count, list)
        } else {
            (0, 0, vec![])
        };

    let snapshot = serde_json::json!({
        "type": "ret_mesh_snapshot",
        "payload": {
            "status": {
                "mesh_enabled": state.ret_mesh_peers.is_some(),
                "announce_mode": mode,
                "local_host_id": state.host_id,
                "local_port": state.port,
                "discovered_count": discovered_count,
                "authorized_count": authorized_count,
                "announce_period_ms": 10_000u64,
            },
            "interfaces": interfaces,
            "peers": peers_list,
            "pairing_pending": pairing_pending,
        },
    });
    let _ = tx.send(snapshot.to_string());
}

async fn ret_mesh_background(
    mut node: exomind_net_pairing::RetMeshNode,
    mdns: Option<std::sync::Arc<discovery::MdnsDiscovery>>,
    mut connect_rx: tokio::sync::broadcast::Receiver<(String, String)>,
    mut pairing_rx: tokio::sync::mpsc::Receiver<RetMeshPairingCommand>,
    ret_mesh_mode: std::sync::Arc<std::sync::Mutex<exomind_net_pairing::RetMeshMode>>,
    state: AppState,
) {
    use std::collections::{HashMap, HashSet};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::time::{Duration, interval};

    let mut announce_rx = node.transport.recv_announces().await;
    let mut link_in_rx = node.transport.in_link_events();
    let mut tick = interval(Duration::from_secs(10));
    let offline_timeout_ms: u64 = 30_000;
    let pairing_timeout = Duration::from_secs(30);
    let discovered = node.discovered.clone();
    let local_identity_hex = node.local_identity_hex();
    let mut pending_pairings: HashMap<String, PendingRetPairing> = HashMap::new();
    let mut pairing_pending_peer_id: Option<String> = None;
    let mut last_local_announce_ms: u64 = 0;
    let mut tick_count: u64 = 0;
    let mut select_hit_connect: u64 = 0;
    let mut select_hit_pairing: u64 = 0;
    let mut select_hit_link: u64 = 0;
    let mut select_hit_announce: u64 = 0;
    let mut select_hit_tick: u64 = 0;

    tracing::info!("ret_mesh_background started (local_identity={})", local_identity_hex);

    // MdnsBridge: mDNS peer discovery → Reticulum UDP Interface
    let mdns_bridge =
        exomind_net_pairing::mdns_bridge::MdnsBridge::new("0.0.0.0:0".to_string());
    let mut connected_mdns_ids: HashSet<String> = HashSet::new();

    // Local peer registry: file-based discovery for same-machine instances.
    // Windows loopback does not forward 255.255.255.255 broadcasts between local sockets,
    // so same-machine instances need a separate discovery channel. This file registry
    // writes the instance's Reticulum address info to %TEMP%\exomind-ret-peers\ and
    // scans for other instances on each background tick.
    let local_registry_dir = {
        let mut d = std::env::temp_dir();
        d.push("exomind-ret-peers");
        let _ = std::fs::create_dir_all(&d);
        let info = serde_json::json!({
            "host_id": state.host_id,
            "host": "127.0.0.1",
            "ret_port": state.ret_udp_port.load(Ordering::Relaxed),
            "pid": std::process::id(),
        });
        let peer_file = d.join(format!("{}.json", state.host_id));
        let _ = std::fs::write(&peer_file, info.to_string());
        tracing::info!(file = %peer_file.display(), "local peer registry entry written");
        d
    };

    loop {
        tracing::trace!("ret_mesh_background: select loop top");
        tokio::select! {
            Ok((host_id, addr)) = connect_rx.recv() => {
                select_hit_connect += 1;
                tracing::info!("[select] connect_rx(hit:{}) connect to peer {} at {}", select_hit_connect, host_id, addr);
                exomind_net_pairing::RetMeshNode::add_tcp_client(&node.transport, &addr).await;
            }
            Some(command) = pairing_rx.recv() => {
                select_hit_pairing += 1;
                tracing::info!("[select] pairing_rx(hit:{}) command", select_hit_pairing);
                match command {
                    RetMeshPairingCommand::PairWithPeer {
                        peer,
                        pin,
                        responder_inbound_token,
                        responder_base_url,
                        reply,
                    } => {
                        let peer_id = ret_discovered_peer_id(&peer);
                        let request_id = uuid::Uuid::new_v4().to_string();
                        let tcp_port = if peer.port > 60535 { peer.port - 5000 } else { peer.port + 5000 };
                        let tcp_addr = format!("127.0.0.1:{}", tcp_port);
                        // Only create TCP client if not already connected (dedup).
                        let tcp_already_connected = {
                            let mgr = node.transport.iface_manager();
                            let mgr_lock = mgr.lock().await;
                            mgr_lock.list_interfaces().iter().any(|iface| {
                                iface.iface_type == "tcp_client" && iface.name.contains(&tcp_addr)
                            })
                        };
                        if !tcp_already_connected {
                            tracing::info!("Reticulum connecting TCP to peer {} at {}", peer_id, tcp_addr);
                            exomind_net_pairing::RetMeshNode::add_tcp_client(&node.transport, &tcp_addr).await;
                        } else {
                            tracing::debug!("Reticulum TCP already connected to peer {} at {}, skipping", peer_id, tcp_addr);
                        }
                        let frame = exomind_net_pairing::RetPairingLinkFrame::PairingResponse {
                            request_id: request_id.clone(),
                            session_id: None,
                            pin: pin.clone(),
                            initiator_peer_id: peer_id.clone(),
                            responder_peer_id: state.host_id.clone(),
                            responder_host_id: state.host_id.clone(),
                            responder_node_name: state.device_id.clone(),
                            responder_port: state.port,
                            responder_base_url,
                            responder_inbound_token: responder_inbound_token.clone(),
                        };

                        pending_pairings.insert(request_id.clone(), PendingRetPairing {
                            peer_id: peer_id.clone(),
                            pin,
                            responder_inbound_token,
                            reply,
                            created_at: std::time::Instant::now(),
                        });

                        if let Err(error) = node.send_pairing_frame(&peer, &frame).await {
                            tracing::error!(peer_id = %peer_id, request_id = %request_id, error = %error, "Reticulum send_pairing_frame failed");
                            if let Some(pending) = pending_pairings.remove(&request_id) {
                                let _ = pending.reply.send(Err(RetMeshPairingFailure::Transport(error.to_string())));
                            }
                        } else {
                            tracing::info!(
                                peer_id = %peer_id,
                                request_id = %request_id,
                                "Reticulum PIN pairing response sent over encrypted Link"
                            );
                        }
                    }
                    RetMeshPairingCommand::SendPairingOffer {
                        peer,
                        session_id,
                        initiator_peer_id,
                        initiator_host_id,
                        initiator_node_name,
                    } => {
                        let peer_id = ret_discovered_peer_id(&peer);
                        let tcp_port = if peer.port > 60535 { peer.port - 5000 } else { peer.port + 5000 };
                        let tcp_addr = format!("127.0.0.1:{}", tcp_port);
                        let tcp_already_connected = {
                            let mgr = node.transport.iface_manager();
                            let mgr_lock = mgr.lock().await;
                            mgr_lock.list_interfaces().iter().any(|iface| {
                                iface.iface_type == "tcp_client" && iface.name.contains(&tcp_addr)
                            })
                        };
                        if !tcp_already_connected {
                            tracing::info!("Reticulum connecting TCP to send PairingOffer to peer {} at {}", peer_id, tcp_addr);
                            exomind_net_pairing::RetMeshNode::add_tcp_client(&node.transport, &tcp_addr).await;
                        }
                        let frame = exomind_net_pairing::RetPairingLinkFrame::PairingOffer {
                            session_id,
                            initiator_peer_id,
                            initiator_host_id,
                            initiator_node_name,
                        };
                        if let Err(error) = node.send_pairing_frame(&peer, &frame).await {
                            tracing::error!(peer_id = %peer_id, error = %error, "Reticulum send PairingOffer failed");
                        } else {
                            tracing::info!(peer_id = %peer_id, "Reticulum PairingOffer sent over encrypted Link");
                        }
                    }
                    RetMeshPairingCommand::SetInterfaceMode { name, mode } => {
                        let mgr = node.transport.iface_manager();
                        let mut mgr_lock = mgr.lock().await;
                        if mgr_lock.set_interface_mode(&name, mode) {
                            tracing::info!(iface = %name, mode = %mode, "Reticulum interface mode set");
                        } else {
                            tracing::warn!(iface = %name, "Reticulum interface not found for set_mode");
                        }
                        drop(mgr_lock);
                        let interfaces = mgr.lock().await.list_interfaces();
                        try_push_ret_mesh_snapshot_with_offer(&state, interfaces, pairing_pending_peer_id.clone()).await;
                    }
                }
            }
            Ok(link_event) = link_in_rx.recv() => {
                select_hit_link += 1;
                tracing::info!("[select] link_in_rx(hit:{}) link event", select_hit_link);
                if let exomind_net_pairing::LinkEvent::Data(payload) = link_event.event {
                    match serde_json::from_slice::<exomind_net_pairing::RetPairingLinkFrame>(payload.as_slice()) {
                        Ok(exomind_net_pairing::RetPairingLinkFrame::PairingResponse { .. }) => {
                            // Re-parse to get full ownership for the existing authorize function.
                            if let Ok(frame) = serde_json::from_slice::<exomind_net_pairing::RetPairingLinkFrame>(payload.as_slice()) {
                                let result = ret_mesh_authorize_pairing_response(&state, frame).await;
                                node.announce_with_pairing_result(Some(result)).await;
                                // Clear pairing_pending if this was a response to an offer.
                                pairing_pending_peer_id = None;
                            }
                        }
                        Ok(exomind_net_pairing::RetPairingLinkFrame::PairingOffer { session_id: _, initiator_peer_id, initiator_host_id: _, initiator_node_name: _ }) => {
                            tracing::info!(
                                initiator_peer_id = %initiator_peer_id,
                                "received PairingOffer from remote peer"
                            );
                            pairing_pending_peer_id = Some(initiator_peer_id.clone());
                            let interfaces = {
                                let mgr = node.transport.iface_manager();
                                let mgr_lock = mgr.lock().await;
                                mgr_lock.list_interfaces()
                            };
                            try_push_ret_mesh_snapshot_with_offer(
                                &state, interfaces, pairing_pending_peer_id.clone(),
                            ).await;
                        }
                        Err(error) => {
                            tracing::debug!(error = %error, "ignoring non-pairing Reticulum Link payload");
                        }
                    }
                }
            }
            Ok(announce) = announce_rx.recv() => {
                select_hit_announce += 1;
                tracing::info!("[select] announce_rx(hit:{}) announce arrived", select_hit_announce);
                let data: &[u8] = announce.app_data.as_slice();
                if let Some(meta) = exomind_net_pairing::discovery::parse_announce_data(data) {
                    let (identity_hex, destination_hex) = {
                        let destination = announce.destination.lock().await;
                        (
                            destination.identity.address_hash.to_hex_string(),
                            destination.desc.address_hash.to_hex_string(),
                        )
                    };
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    let peer = exomind_net_pairing::DiscoveredPeer {
                        host_id: meta.host_id.clone(),
                        node_name: meta.node_name,
                        app_version: meta.version,
                        port: meta.port,
                        identity_hex,
                        destination_hex: Some(destination_hex),
                        last_seen_ms: now,
                        online: true,
                        trust_state: exomind_net_pairing::discovery::TrustState::Discovered,
                        rtt_ms: None,
                    };

                    // Skip self by either legacy runtime host_id or Reticulum identity.
                    if peer.host_id == node.config.host_id || peer.identity_hex == local_identity_hex {
                        continue;
                    }

                    let pairing_result = meta.pairing_result.clone();
                    let peer_host_id = peer.host_id.clone();
                    let peer_map_id = if peer.identity_hex.is_empty() {
                        peer_host_id.clone()
                    } else {
                        peer.identity_hex.clone()
                    };
                    {
                        let mut map = discovered.write().await;
                        let is_new = !map.contains_key(&peer_map_id);
                        map.entry(peer_map_id.clone())
                            .and_modify(|existing| {
                                let trust_state = existing.trust_state;
                                let rtt_ms = existing.rtt_ms;
                                *existing = peer.clone();
                                existing.trust_state = trust_state;
                                existing.rtt_ms = rtt_ms;
                            })
                            .or_insert(peer);
                        if is_new {
                            tracing::info!(
                                "Reticulum discovered new peer: {} ({})",
                                peer_host_id,
                                peer_map_id
                            );
                        }
                        // Estimate RTT from last local announce time.
                        if last_local_announce_ms > 0 {
                            let elapsed = (now as i64 - last_local_announce_ms as i64).unsigned_abs();
                            if elapsed < 5000 {
                                if let Some(p) = map.get_mut(&peer_map_id) {
                                    p.rtt_ms = Some(elapsed / 2);
                                }
                            }
                        }
                    }

                    if let Some(result) = pairing_result {
                        ret_mesh_complete_pairing_result(&state, &mut pending_pairings, result);
                    }
                    let interfaces = {
                        let mgr = node.transport.iface_manager();
                        let mgr_lock = mgr.lock().await;
                        mgr_lock.list_interfaces()
                    };
                    try_push_ret_mesh_snapshot_with_offer(&state, interfaces, pairing_pending_peer_id.clone()).await;
                }
            }
            _ = tick.tick() => {
                tick_count += 1;
                select_hit_tick += 1;
                if tick_count % 10 == 0 {
                    tracing::info!("[select] tick #{}  hits_tick:{} connect:{} pairing:{} link:{} announce:{}",
                        tick_count, select_hit_tick, select_hit_connect, select_hit_pairing, select_hit_link, select_hit_announce);
                } else {
                    tracing::info!("[select] tick #{}  ticks:{}", tick_count, select_hit_tick);
                }
                // Evict stale peers and re-announce
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                {
                    let mut map = discovered.write().await;
                    let stale: Vec<String> = map.iter()
                        .filter(|(_, p)| now - p.last_seen_ms > offline_timeout_ms && p.online)
                        .map(|(id, _)| id.clone())
                        .collect();
                    for id in &stale {
                        if let Some(peer) = map.get_mut(id) {
                            peer.online = false;
                            tracing::info!("Reticulum peer offline: {}", id);
                        }
                    }
                }

                let expired: Vec<String> = pending_pairings
                    .iter()
                    .filter(|(_, pending)| pending.created_at.elapsed() > pairing_timeout)
                    .map(|(request_id, _)| request_id.clone())
                    .collect();
                for request_id in expired {
                    if let Some(pending) = pending_pairings.remove(&request_id) {
                        let _ = pending.reply.send(Err(RetMeshPairingFailure::Timeout));
                    }
                }

                // mDNS peer discovery → Reticulum UDP Interface
                if let Some(ref mdns) = mdns {
                    for peer in mdns.discovered_peers() {
                        if peer.host_id == node.config.host_id {
                            continue;
                        }
                        if connected_mdns_ids.insert(peer.host_id.clone()) {
                            let ret_port = if peer.ret_port > 0 {
                                peer.ret_port
                            } else {
                                peer.port + 6000
                            };
                            tracing::info!(
                                "[tick] mDNS new peer host_id={} host={} ret_port={}",
                                peer.host_id, peer.host, ret_port
                            );
                            mdns_bridge
                                .on_peer_resolved(&node.transport, &peer.host_id, &peer.host, ret_port)
                                .await;
                        }
                    }
                }

                // Scan local peer registry (same-machine discovery)
                if let Ok(entries) = std::fs::read_dir(&local_registry_dir) {
                    let registry_count = entries.count();
                    tracing::info!("[tick] file registry scan: {} entries found", registry_count);
                }
                if let Ok(entries) = std::fs::read_dir(&local_registry_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().and_then(|e| e.to_str()) != Some("json") {
                            continue;
                        }
                        let raw = match std::fs::read_to_string(&path) {
                            Ok(s) => s,
                            _ => continue,
                        };
                        let info: std::collections::HashMap<String, serde_json::Value> =
                            match serde_json::from_str(&raw) {
                                Ok(v) => v,
                                _ => continue,
                            };
                        let peer_host_id = match info.get("host_id").and_then(|v| v.as_str()) {
                            Some(h) => h,
                            _ => continue,
                        };
                        if peer_host_id == state.host_id {
                            continue;
                        }
                        let host = info
                            .get("host")
                            .and_then(|v| v.as_str())
                            .unwrap_or("127.0.0.1");
                        let ret_port = info
                            .get("ret_port")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u16;
                        if ret_port > 0 {
                            let is_new = connected_mdns_ids.insert(peer_host_id.to_string());
                            tracing::info!(
                                "[tick] registry peer host_id={} host={} ret_port={} is_new={}",
                                peer_host_id, host, ret_port, is_new
                            );
                            if is_new {
                                mdns_bridge
                                    .on_peer_resolved(
                                        &node.transport,
                                        peer_host_id,
                                        host,
                                        ret_port,
                                    )
                                    .await;
                            }
                        }
                    }
                }

                let mode = *ret_mesh_mode.lock().unwrap();
                // Sync global mode to InterfaceManager so send() can filter by it.
                node.set_global_mode(mode).await;
                if mode.can_announce() {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    node.announce().await;
                    last_local_announce_ms = now;
                    tracing::debug!("Reticulum periodic announce sent");
                }
                let interfaces = {
                    let mgr = node.transport.iface_manager();
                    let mgr_lock = mgr.lock().await;
                    mgr_lock.list_interfaces()
                };
                try_push_ret_mesh_snapshot_with_offer(&state, interfaces, pairing_pending_peer_id.clone()).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use futures_util::stream::{self, BoxStream, StreamExt};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;
    use std::sync::OnceLock;
    use tower::util::ServiceExt;

    struct TempRouteAgent;

    fn env_lock() -> &'static StdMutex<()> {
        static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| StdMutex::new(()))
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn remove(key: &'static str) -> Self {
            let previous = std::env::var(key).ok();
            // SAFETY: tests hold a process-wide env lock while mutating env vars.
            unsafe {
                std::env::remove_var(key);
            }
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            // SAFETY: tests hold a process-wide env lock while mutating env vars.
            unsafe {
                match &self.previous {
                    Some(value) => std::env::set_var(self.key, value),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }

    fn app_state_with_registry(
        port: u16,
        registry: agent::AgentRegistry,
        signal_pool: Arc<signal::SignalPool>,
    ) -> AppState {
        let host_id = format!("lib-test-{port}");
        let registry_clone = registry.clone();
        let energy_registry = energy::EnergyRegistry::new();
        let (eventlog_watch_tx, _rx) = routes::eventlog::eventlog_watch_channel();
        let eventlog_store = Arc::new(eventlog::EventLogStore::new(
            std::env::temp_dir().join("exomind-test-lib"),
        ));
        eventlog_store.set_watch_tx(eventlog_watch_tx.clone());
        AppState {
            port,
            host_id: host_id.clone(),
            device_id: format!("dev-lib-test-{port}"),
            registry,
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(mesh::MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            allow_lan_without_auth: false,
            mdns: None,
            ret_mesh_peers: None,
            ret_mesh_connect_tx: None,
            ret_mesh_pairing_tx: None,
            ret_mesh_mode: std::sync::Arc::new(std::sync::Mutex::new(
                exomind_net_pairing::RetMeshMode::Active,
            )),
            ret_udp_port: std::sync::Arc::new(std::sync::atomic::AtomicU16::new(0)),
            ret_mesh_event_tx: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            config_store: Arc::new(config::ConfigStore::new()),
            reminder_store: Arc::new(reminder::ReminderStore::new()),
            task_store: Arc::new(task::TaskStore::new()),
            proposal_store: Arc::new(proposal::ProposalStore::new()),
            session_store: Arc::new(session::SessionStore::new()),
            agent_api_session_store: Arc::new(agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx,
            timeblock_store: Arc::new(timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(tick::TickManager::new(
                host_id.clone(),
                registry_clone,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(pty::PtyManager::new(Arc::clone(&signal_pool), host_id)),
        }
    }

    impl agent::Agent for TempRouteAgent {
        fn id(&self) -> &'static str {
            "temp-route"
        }

        fn name(&self) -> &'static str {
            "Temp Route Agent"
        }

        fn description(&self) -> &'static str {
            "用于路由注册/注销可见性测试"
        }

        fn chat_stream(&self, request: agent::ChatRequest) -> BoxStream<'static, agent::ChatChunk> {
            stream::iter(vec![agent::ChatChunk::content_only(request.message)]).boxed()
        }
    }

    #[derive(Default)]
    struct TempSessionAgent {
        sessions: Arc<StdMutex<HashMap<String, agent::SessionInfo>>>,
    }

    impl TempSessionAgent {
        fn new_with_one_session() -> Self {
            let session = agent::SessionInfo {
                session_id: "temp-session-1".to_string(),
                status: "idle".to_string(),
                created_at: "2026-02-28T10:30:00Z".to_string(),
                last_active: "2026-02-28T10:35:00Z".to_string(),
                message_count: 3,
                uptime_secs: 300,
            };

            let mut sessions = HashMap::new();
            sessions.insert(session.session_id.clone(), session);
            Self {
                sessions: Arc::new(StdMutex::new(sessions)),
            }
        }

        fn lock_sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, agent::SessionInfo>> {
            match self.sessions.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            }
        }
    }

    impl agent::Agent for TempSessionAgent {
        fn id(&self) -> &'static str {
            "temp-session"
        }

        fn name(&self) -> &'static str {
            "Temp Session Agent"
        }

        fn description(&self) -> &'static str {
            "用于会话端点 JSON 结构测试"
        }

        fn chat_stream(&self, request: agent::ChatRequest) -> BoxStream<'static, agent::ChatChunk> {
            stream::iter(vec![agent::ChatChunk::content_only(request.message)]).boxed()
        }

        fn list_sessions(&self) -> Vec<agent::SessionInfo> {
            let mut sessions = self.lock_sessions().values().cloned().collect::<Vec<_>>();
            sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
            sessions
        }

        fn get_session(&self, session_id: &str) -> Option<agent::SessionInfo> {
            self.lock_sessions().get(session_id).cloned()
        }

        fn close_session(&self, session_id: &str) -> bool {
            self.lock_sessions().remove(session_id).is_some()
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok_with_version() {
        const TEST_PORT: u16 = 3001;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "status": "ok"
            })
        );
    }

    #[tokio::test]
    async fn topology_endpoint_returns_runtime_topology() {
        const TEST_PORT: u16 = 3002;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/topology")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert!(!payload["hostname"].as_str().unwrap_or_default().is_empty());
        assert!(!payload["os"].as_str().unwrap_or_default().is_empty());
        assert!(!payload["arch"].as_str().unwrap_or_default().is_empty());
        assert!(payload["uptime_secs"].is_u64());
        assert_eq!(payload["version"], RUNTIME_VERSION);
        assert_eq!(payload["port"], serde_json::json!(TEST_PORT));
        assert!(payload["total_memory_mb"].is_u64());
        assert!(payload["used_memory_mb"].is_u64());
        assert!(payload["capabilities"].is_object());
        assert!(payload["capabilities"]["agent_kinds"].is_array());
        assert!(payload["capabilities"]["api_providers"].is_array());
        let agent_kinds = payload["capabilities"]["agent_kinds"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let api_providers = payload["capabilities"]["api_providers"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert!(agent_kinds.iter().any(|item| item == "api"));
        assert!(api_providers.iter().any(|item| item == "openai"));
        assert!(api_providers.iter().any(|item| item == "anthropic"));
    }

    #[tokio::test]
    async fn agents_endpoint_returns_builtin_agents() {
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(
            payload,
            serde_json::json!([
                {
                    "id": "claude",
                    "name": "Claude Agent",
                    "description": "通过 Claude Code CLI 提供流式对话",
                    "status": "available",
                    "subscriptions": [],
                    "publications": [],
                    "tick_interval_secs": 0
                },
                {
                    "id": "echo",
                    "name": "Echo Agent",
                    "description": "回显输入内容",
                    "status": "available",
                    "subscriptions": [],
                    "publications": [],
                    "tick_interval_secs": 0
                }
            ])
        );
    }

    #[tokio::test]
    async fn agents_endpoint_sets_cors_header_for_browser_fetch() {
        const TEST_PORT: u16 = 3004;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .header("origin", "http://127.0.0.1:1420")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:1420")
        );
    }

    #[tokio::test]
    async fn agents_endpoint_omits_cors_header_for_untrusted_origin() {
        const TEST_PORT: u16 = 3004;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .header("origin", "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none(),
            "untrusted origin must not receive a CORS allow header"
        );
    }

    #[tokio::test]
    async fn pairing_initiate_preflight_allows_trusted_local_origin() {
        const TEST_PORT: u16 = 3004;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/mesh/pairing/initiate")
                    .header("origin", "http://127.0.0.1:1420")
                    .header("access-control-request-method", "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(matches!(
            response.status(),
            StatusCode::OK | StatusCode::NO_CONTENT
        ));
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:1420")
        );
    }

    #[tokio::test]
    async fn sessions_patch_preflight_allows_trusted_local_origin() {
        const TEST_PORT: u16 = 3007;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/sessions/test-session")
                    .header("origin", "http://127.0.0.1:1420")
                    .header("access-control-request-method", "PATCH")
                    .header("access-control-request-headers", "content-type")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(matches!(
            response.status(),
            StatusCode::OK | StatusCode::NO_CONTENT
        ));
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:1420")
        );
        assert!(
            response
                .headers()
                .get("access-control-allow-methods")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.contains("PATCH"))
                .unwrap_or(false),
            "PATCH must be included in the CORS allow-methods preflight response"
        );
    }

    #[tokio::test]
    async fn protected_routes_allow_private_lan_requests_without_token_when_enabled() {
        const TEST_PORT: u16 = 3005;
        let registry = agent::AgentRegistry::new();
        let signal_pool = Arc::new(signal::SignalPool::new(None));
        let mut state = app_state_with_registry(TEST_PORT, registry, signal_pool);
        state.auth_secret = Some("lan-secret".to_string());
        state.allow_lan_without_auth = true;

        let mut request = Request::builder()
            .uri("/topology")
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                [192, 168, 1, 48],
                42000,
            ))));

        let response = app_with_state(state).oneshot(request).await.unwrap();

        assert_eq!(StatusCode::OK, response.status());
    }

    #[tokio::test]
    async fn protected_routes_still_require_token_for_public_ips_even_when_lan_bypass_enabled() {
        const TEST_PORT: u16 = 3006;
        let registry = agent::AgentRegistry::new();
        let signal_pool = Arc::new(signal::SignalPool::new(None));
        let mut state = app_state_with_registry(TEST_PORT, registry, signal_pool);
        state.auth_secret = Some("lan-secret".to_string());
        state.allow_lan_without_auth = true;

        let mut request = Request::builder()
            .uri("/topology")
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                [8, 8, 8, 8],
                42000,
            ))));

        let response = app_with_state(state).oneshot(request).await.unwrap();

        assert_eq!(StatusCode::UNAUTHORIZED, response.status());
    }

    #[test]
    fn new_runtime_falls_back_when_signal_sqlite_init_fails() {
        let dir = std::env::temp_dir().join(format!(
            "exomind-runtime-invalid-sqlite-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let blocked_parent = dir.join("not-a-directory");
        std::fs::write(&blocked_parent, "file blocks sqlite parent").unwrap();
        let invalid_sqlite_path = blocked_parent.join("signal-pool.sqlite");

        let runtime = std::panic::catch_unwind(|| {
            AppState::new_runtime(
                0,
                "host-invalid-sqlite".to_string(),
                None,
                Some(invalid_sqlite_path.clone()),
                false,
                None,
            )
        })
        .expect("runtime should degrade instead of panicking when sqlite init fails");

        let initial_route_count = runtime.signal_pool.routes().get_all().len();
        let now = chrono::Utc::now().to_rfc3339();
        let route_id = uuid::Uuid::new_v4().to_string();
        runtime
            .signal_pool
            .routes()
            .add(crate::signal::SignalRoute {
                id: route_id.clone(),
                enabled: true,
                topic: "runtime.fallback.topic".to_string(),
                target_type: crate::signal::TargetType::Agent,
                target_ref: "fallback-agent".to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();

        assert_eq!(
            runtime.signal_pool.routes().get_all().len(),
            initial_route_count + 1
        );
        assert!(runtime.signal_pool.routes().get_by_id(&route_id).is_some());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn echo_chat_stream_returns_typed_events_and_done_marker() {
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/echo/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"message":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body_text = String::from_utf8(body_bytes.to_vec()).unwrap();

        let data_marker = r#"data: {"type":"output.delta","content":"Echo: hello"}"#;
        let typed_done_marker = r#"data: {"type":"done","finish_reason":"stop"}"#;
        let done_marker = "data: [DONE]";
        let data_index = body_text.find(data_marker).unwrap();
        let typed_done_index = body_text.find(typed_done_marker).unwrap();
        let done_index = body_text.find(done_marker).unwrap();

        assert!(data_index < typed_done_index);
        assert!(typed_done_index < done_index);
    }

    #[tokio::test]
    async fn unknown_agent_chat_returns_not_found() {
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/not-found/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"message":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn sessions_endpoint_returns_empty_array_for_echo_agent() {
        const TEST_PORT: u16 = 3005;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/echo/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(payload, serde_json::json!([]));
    }

    #[tokio::test]
    async fn claude_stats_endpoint_returns_default_zero_snapshot() {
        const TEST_PORT: u16 = 3005;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/claude/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(
            payload,
            serde_json::json!({
                "session_id": null,
                "session_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "message_count": 0,
                "uptime_secs": 0,
                "total_cost_usd": 0.0
            })
        );
    }

    #[tokio::test]
    async fn claude_stats_endpoint_returns_not_found_for_unknown_session_id() {
        const TEST_PORT: u16 = 3006;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/claude/stats?session_id=session-404")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn unknown_agent_sessions_returns_not_found() {
        const TEST_PORT: u16 = 3006;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/not-found/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn unknown_session_detail_returns_not_found() {
        const TEST_PORT: u16 = 3007;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/echo/sessions/missing-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn close_unknown_session_returns_not_found() {
        const TEST_PORT: u16 = 3008;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/echo/sessions/missing-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn session_endpoints_return_expected_json_payloads() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempSessionAgent::new_with_one_session()));
        let signal_pool = Arc::new(signal::SignalPool::new(None));

        let router = routes::router().with_state(app_state_with_registry(
            3009,
            registry.clone(),
            signal_pool,
        ));

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, list_response.status());
        let list_body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
        assert_eq!(
            list_payload,
            serde_json::json!([
                {
                    "session_id": "temp-session-1",
                    "status": "idle",
                    "created_at": "2026-02-28T10:30:00Z",
                    "last_active": "2026-02-28T10:35:00Z",
                    "message_count": 3,
                    "uptime_secs": 300
                }
            ])
        );

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, get_response.status());
        let get_body = get_response.into_body().collect().await.unwrap().to_bytes();
        let get_payload: Value = serde_json::from_slice(&get_body).unwrap();
        assert_eq!(
            get_payload,
            serde_json::json!({
                "session_id": "temp-session-1",
                "status": "idle",
                "created_at": "2026-02-28T10:30:00Z",
                "last_active": "2026-02-28T10:35:00Z",
                "message_count": 3,
                "uptime_secs": 300
            })
        );

        let delete_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, delete_response.status());
        let delete_body = delete_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let delete_payload: Value = serde_json::from_slice(&delete_body).unwrap();
        assert_eq!(
            delete_payload,
            serde_json::json!({
                "status": "closed",
                "session_id": "temp-session-1"
            })
        );

        let after_close_response = router
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, after_close_response.status());
    }

    #[tokio::test]
    async fn unknown_session_on_existing_agent_returns_not_found() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempSessionAgent::new_with_one_session()));
        let signal_pool = Arc::new(signal::SignalPool::new(None));

        let router =
            routes::router().with_state(app_state_with_registry(3010, registry, signal_pool));

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/not-found")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, get_response.status());

        let delete_response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/temp-session/sessions/not-found")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, delete_response.status());
    }

    #[tokio::test]
    async fn agents_endpoint_reflects_runtime_register_and_unregister() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempRouteAgent));
        let signal_pool = Arc::new(signal::SignalPool::new(None));

        let router = routes::router().with_state(app_state_with_registry(
            3003,
            registry.clone(),
            signal_pool,
        ));

        let first_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, first_response.status());
        let first_body = first_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let first_payload: Value = serde_json::from_slice(&first_body).unwrap();
        assert_eq!(
            first_payload,
            serde_json::json!([
                {
                    "id": "temp-route",
                    "name": "Temp Route Agent",
                    "description": "用于路由注册/注销可见性测试",
                    "status": "available",
                    "subscriptions": [],
                    "publications": [],
                    "tick_interval_secs": 0
                }
            ])
        );

        registry.unregister("temp-route");

        let second_response = router
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, second_response.status());
        let second_body = second_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let second_payload: Value = serde_json::from_slice(&second_body).unwrap();
        assert_eq!(second_payload, serde_json::json!([]));
    }

    #[test]
    fn resolve_default_signal_routes_path_falls_back_to_workspace_config() {
        let fake_cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/non-existent-cwd");
        let resolved = resolve_default_signal_routes_path_from(Some(fake_cwd.as_path()));

        assert!(
            resolved.is_some(),
            "should resolve default routes from workspace root"
        );
        let resolved_path = resolved.expect("resolved path should exist");
        assert!(
            resolved_path.exists(),
            "resolved path must exist: {}",
            resolved_path.display()
        );
        assert!(
            resolved_path
                .to_string_lossy()
                .contains("config/signal-routes.default.json")
        );
    }

    #[test]
    fn resolve_project_root_falls_back_to_workspace_when_cwd_has_no_agent_entries() {
        let fake_cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/non-existent-cwd");
        let resolved = resolve_project_root_from(None, Some(fake_cwd.as_path()));

        let workspace_root = workspace_root_from_manifest().expect("workspace root should resolve");
        assert_eq!(resolved, workspace_root);
        assert!(
            resolved
                .join("packages/ts-agent-cli/agents/reviewer/index.ts")
                .is_file(),
            "resolved project root must contain reviewer agent entry: {}",
            resolved.display()
        );
        assert!(
            resolved
                .join("packages/ts-agent-cli/agents/classifier/index.ts")
                .is_file(),
            "resolved project root must contain classifier agent entry: {}",
            resolved.display()
        );
    }

    #[test]
    fn ret_mesh_identity_seed_persists_and_derives_stable_host_id() {
        let _env_lock = env_lock().lock().expect("env lock");
        let _seed_guard = EnvVarGuard::remove("EXOMIND_RET_MESH_IDENTITY_SEED");
        let _path_guard = EnvVarGuard::remove("EXOMIND_RET_MESH_IDENTITY_PATH");
        let temp_dir = tempfile::tempdir().expect("create ret mesh identity tempdir");
        let data_dir = temp_dir.path().join("runtime-data");
        let options = RuntimeStartOptions {
            enable_ret_mesh: true,
            data_dir: Some(data_dir.clone()),
            ..RuntimeStartOptions::default()
        };

        let (first_seed, first_identity) = prepare_ret_mesh_identity(&options);
        let persisted_path = data_dir.join("reticulum-identity.hex");
        assert_eq!(
            std::fs::read_to_string(&persisted_path)
                .expect("identity seed should persist")
                .trim(),
            first_seed,
        );

        let (second_seed, second_identity) = prepare_ret_mesh_identity(&options);
        assert_eq!(first_seed, second_seed);
        assert_eq!(first_identity, second_identity);
        assert!(!first_identity.is_empty());
    }

    #[test]
    fn persisted_runtime_host_id_reuses_device_scope_config_entry() {
        let temp_dir = tempfile::tempdir().expect("create config sqlite tempdir");
        let config_path = temp_dir.path().join("config.sqlite");

        let first = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_HOST_ID_CONFIG_KEY,
            "rt",
            "runtime host id",
        )
        .expect("first runtime host id should persist");
        let second = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_HOST_ID_CONFIG_KEY,
            "rt",
            "runtime host id",
        )
        .expect("second runtime host id should reuse persisted value");

        assert_eq!(first, second, "runtime host id must survive restarts");

        let store = config::ConfigStore::with_sqlite_path(&config_path)
            .expect("config store should reopen");
        let entry = store
            .get(
                config::types::DEVICE_CONFIG_SCOPE,
                RUNTIME_HOST_ID_CONFIG_KEY,
            )
            .expect("config get should succeed")
            .expect("runtime host id entry should exist");

        assert_eq!(entry.value, first);
    }

    #[test]
    fn persisted_runtime_device_id_reuses_device_scope_config_entry() {
        let temp_dir = tempfile::tempdir().expect("create config sqlite tempdir");
        let config_path = temp_dir.path().join("config.sqlite");

        let first = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_DEVICE_ID_CONFIG_KEY,
            "dev",
            "runtime device id",
        )
        .expect("first runtime device id should persist");
        let second = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_DEVICE_ID_CONFIG_KEY,
            "dev",
            "runtime device id",
        )
        .expect("second runtime device id should reuse persisted value");

        assert_eq!(first, second, "runtime device id must survive restarts");

        let store = config::ConfigStore::with_sqlite_path(&config_path)
            .expect("config store should reopen");
        let entry = store
            .get(
                config::types::DEVICE_CONFIG_SCOPE,
                RUNTIME_DEVICE_ID_CONFIG_KEY,
            )
            .expect("config get should succeed")
            .expect("runtime device id entry should exist");

        assert_eq!(entry.value, first);
    }

    #[test]
    fn persisted_runtime_device_id_is_distinct_from_host_id() {
        let temp_dir = tempfile::tempdir().expect("create config sqlite tempdir");
        let config_path = temp_dir.path().join("config.sqlite");

        let host_id = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_HOST_ID_CONFIG_KEY,
            "rt",
            "runtime host id",
        )
        .expect("runtime host id should persist");
        let device_id = load_or_create_persisted_runtime_identity(
            &config_path,
            RUNTIME_DEVICE_ID_CONFIG_KEY,
            "dev",
            "runtime device id",
        )
        .expect("runtime device id should persist");

        assert_ne!(
            host_id, device_id,
            "runtime device id must not alias runtime host id"
        );
    }

    #[test]
    fn mesh_state_path_defaults_to_runtime_data_dir() {
        let _env_guard = env_lock().lock().expect("env lock");
        let _mesh_path_guard = EnvVarGuard::remove("EXOMIND_RT_MESH_STATE_PATH");
        let runtime_data_dir =
            std::env::temp_dir().join(format!("exomind-runtime-data-{}", uuid::Uuid::new_v4()));

        let resolved = configured_mesh_state_path_from_env(Some(runtime_data_dir.as_path()))
            .expect("mesh state path should default from runtime data dir");

        assert_eq!(resolved, runtime_data_dir.join("mesh-state.json"));
    }

    #[test]
    fn publish_signal_uses_captured_runtime_outside_reactor_context() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
            .expect("tokio runtime should build");

        let mut handle = runtime
            .block_on(start_with_options(RuntimeStartOptions {
                bind_host: "127.0.0.1".to_string(),
                port: 0,
                host_id: "publish-outside-reactor".to_string(),
                spawn_builtin_actors: false,
                spawn_ts_agents: false,
                enable_mdns: false,
                ..RuntimeStartOptions::default()
            }))
            .expect("runtime should start");

        let signal_pool = handle.clone_signal_pool();
        let publish_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            handle.publish_signal(RuntimePublishRequest {
                topic: "system.test.publish_outside_reactor".to_string(),
                source: Some("unit:test".to_string()),
                payload: serde_json::json!({ "ok": true }),
                trace_id: None,
                origin_host_id: None,
            })
        }));

        assert!(
            publish_result.is_ok(),
            "publish_signal should not panic outside reactor context（离开 reactor 上下文也不能崩）"
        );

        let events = signal_pool.window().recent_filtered(
            10,
            Some("system.test.publish_outside_reactor"),
            None,
            None,
        );
        assert_eq!(events.len(), 1, "signal should still be published locally");

        runtime
            .block_on(async { handle.stop().await })
            .expect("runtime should stop cleanly");
    }

    #[test]
    fn ensure_auth_secret_for_lan_bind_generates_ephemeral_secret() {
        let mut options = RuntimeStartOptions {
            bind_host: "0.0.0.0".to_string(),
            auth_secret: None,
            ..RuntimeStartOptions::default()
        };

        ensure_auth_secret_for_bind_host(&mut options);

        assert!(
            options.auth_secret.is_some(),
            "non-loopback bind host must not run without an admin secret"
        );
    }

    #[test]
    fn ensure_auth_secret_for_loopback_bind_keeps_secret_optional() {
        let mut options = RuntimeStartOptions {
            bind_host: "127.0.0.1".to_string(),
            auth_secret: None,
            ..RuntimeStartOptions::default()
        };

        ensure_auth_secret_for_bind_host(&mut options);

        assert!(
            options.auth_secret.is_none(),
            "loopback bind host may keep secret optional for local-only dev mode"
        );
    }

    #[tokio::test]
    async fn try_push_ret_mesh_snapshot_includes_peers() {
        use exomind_net_pairing::discovery::TrustState;
        use exomind_net_pairing::DiscoveredPeer;
        use std::time::Duration;
        use tokio::time::timeout;

        let (tx, mut rx) = tokio::sync::broadcast::channel::<String>(16);
        let mut state = AppState::new(0);
        state.ret_mesh_event_tx = Some(tx.clone());

        let test_peer = DiscoveredPeer {
            host_id: "snapshot-peer-host".to_string(),
            node_name: "snapshot-node".to_string(),
            app_version: "0.1.0".to_string(),
            port: 9999,
            identity_hex: "snapshot-identity-0123456789abcdef".to_string(),
            destination_hex: Some("snapshot-dest-hex".to_string()),
            last_seen_ms: 1_800_000_000_000,
            online: true,
            trust_state: TrustState::Discovered,
            rtt_ms: Some(25),
        };
        let peers_map = std::sync::Arc::new(tokio::sync::RwLock::new(
            std::collections::HashMap::from([(
                test_peer.identity_hex.clone(),
                test_peer,
            )]),
        ));
        state.ret_mesh_peers = Some(peers_map);

        let _ = try_push_ret_mesh_snapshot(&state, vec![]).await;

        let event = timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("should receive snapshot event within 2s")
            .expect("broadcast should yield a value");
        let parsed: serde_json::Value =
            serde_json::from_str(&event).expect("snapshot should be valid JSON");

        assert_eq!(
            parsed["type"],
            "ret_mesh_snapshot",
            "event type should be ret_mesh_snapshot"
        );
        assert!(
            parsed["payload"]["peers"].is_array(),
            "payload.peers should be an array"
        );
        let peers = parsed["payload"]["peers"].as_array().unwrap();
        assert_eq!(peers.len(), 1, "should have 1 peer in snapshot");

        let peer = &peers[0];
        assert_eq!(peer["host_id"], "snapshot-peer-host");
        assert_eq!(peer["node_name"], "snapshot-node");
        assert_eq!(peer["peer_id"], "snapshot-identity-0123456789abcdef");
        assert_eq!(peer["connection_state"], "connected_unauthorized");
        assert_eq!(peer["authorized"], false);
        assert_eq!(peer["online"], true);
        assert_eq!(peer["port"], 9999);
        assert_eq!(peer["rtt_ms"], 25);
        assert_eq!(peer["trust_state"], "Discovered");
    }
}
