use axum::http::Method;
use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use thiserror::Error;
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

use mesh::{MeshRelayManager, MeshState};
use signal::SignalPool;

pub mod agent;
pub mod auth;
pub mod discovery;
pub mod mesh;
pub mod pairing;
pub mod routes;
pub mod signal;
pub mod task;
pub mod energy;
pub mod tick;
pub mod pty;

pub const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_RT_PORT: u16 = 1949;

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
    env::var("EXOMIND_RT_HOST_ID").unwrap_or_else(|_| format!("rt-{}", uuid::Uuid::new_v4()))
}

fn default_runtime_host_id(port: u16) -> String {
    format!("rt-local-{port}")
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
    /// optional bearer token secret for HTTP auth（可选 Bearer Token 鉴权密钥）.
    pub auth_secret: Option<String>,
    /// enable mDNS service discovery for LAN peer auto-detection（启用 mDNS 局域网自动发现）.
    pub enable_mdns: bool,
}

impl Default for RuntimeStartOptions {
    fn default() -> Self {
        let spawn_ts_agents = env::var("EXOMIND_RT_DISABLE_TS_AGENTS")
            .map(|value| {
                let value = value.to_ascii_lowercase();
                !(value == "1" || value == "true" || value == "yes")
            })
            .unwrap_or(true);

        let enable_mdns = env::var("EXOMIND_RT_MDNS")
            .map(|value| {
                let value = value.to_ascii_lowercase();
                value == "1" || value == "true"
            })
            .unwrap_or(false);

        Self {
            bind_host: configured_bind_host_from_env(),
            port: configured_port_from_env().unwrap_or(DEFAULT_RT_PORT),
            host_id: configured_host_id_from_env(),
            spawn_builtin_actors: true,
            spawn_ts_agents,
            ts_agent_command: env::var("EXOMIND_RT_AGENT_CMD")
                .unwrap_or_else(|_| "bun".to_string()),
            ts_agent_workdir: env::var("EXOMIND_RT_AGENT_WORKDIR").ok().map(PathBuf::from),
            mesh_state_path: env::var("EXOMIND_RT_MESH_STATE_PATH").ok().map(PathBuf::from),
            auth_secret: env::var("EXOMIND_RT_SECRET").ok(),
            enable_mdns,
        }
    }
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
    mesh_relay: Option<Arc<MeshRelayManager>>,
    mdns: Option<Arc<discovery::MdnsDiscovery>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: Option<JoinHandle<std::io::Result<()>>>,
    actor_tasks: Vec<JoinHandle<()>>,
    ts_agents: Vec<TsAgentProcess>,
    pty_manager: Arc<pty::PtyManager>,
    tick_cancel: Arc<std::sync::atomic::AtomicBool>,
    tick_tasks: Vec<JoinHandle<()>>,
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
    fn build_signal_event(default_origin_host_id: &str, request: RuntimePublishRequest) -> signal::types::SignalEvent {
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
            tokio::spawn(async move {
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

        self.tick_cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        for task in self.tick_tasks.drain(..) {
            task.abort();
            let _ = task.await;
        }

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
        self.tick_cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        for task in self.tick_tasks.drain(..) {
            task.abort();
        }
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

    let mut state = AppState::new_runtime(
        local_addr.port(),
        options.host_id.clone(),
        options.mesh_state_path.clone(),
        true,
        options.auth_secret.clone(),
    );

    // mDNS discovery setup.
    let mdns = if options.enable_mdns {
        match discovery::MdnsDiscovery::new(options.host_id.clone(), local_addr.port()) {
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

    let signal_pool = Arc::clone(&state.signal_pool);
    let mesh = Arc::clone(&state.mesh);
    let mesh_relay = state.mesh_relay.clone();

    let mut actor_tasks = Vec::new();
    if options.spawn_builtin_actors {
        actor_tasks.push(signal::actors::task_classifier_actor::spawn_task_actor(Arc::clone(
            &state.signal_pool,
        )));
        actor_tasks.push(signal::actors::eventlog_actor::spawn_eventlog_actor(
            Arc::clone(&state.signal_pool),
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
        state.energy_registry.register("heartbeat", energy::AgentEnergy::new(100, 10));
    }

    // Start tick scheduler for all agents with tick_interval_secs > 0
    let tick_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let tick_tasks = tick::start_all_ticks(
        &state.registry,
        &state.energy_registry,
        &state.signal_pool,
        &options.host_id,
        Arc::clone(&tick_cancel),
    );

    let pty_manager = Arc::clone(&state.pty_manager);
    let app = app_with_state(state);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_task = tokio::spawn(async move {
        axum::serve(listener, app)
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
        mesh_relay,
        mdns,
        shutdown_tx: Some(shutdown_tx),
        server_task: Some(server_task),
        actor_tasks,
        ts_agents,
        pty_manager,
        tick_cancel,
        tick_tasks,
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

fn resolve_project_root_from(ts_agent_workdir: Option<&Path>, current_dir: Option<&Path>) -> PathBuf {
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
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // Protected routes — auth middleware applied here.
    let protected = routes::router()
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    Router::new()
        .route("/health", get(health))
        .merge(routes::public_router())
        .merge(protected)
        .layer(cors)
        .with_state(state)
}

#[derive(Clone)]
pub struct AppState {
    pub port: u16,
    pub host_id: String,
    pub registry: agent::AgentRegistry,
    pub signal_pool: Arc<SignalPool>,
    pub mesh: Arc<MeshState>,
    pub mesh_relay: Option<Arc<MeshRelayManager>>,
    pub auth_secret: Option<String>,
    pub mdns: Option<Arc<discovery::MdnsDiscovery>>,
    pub pairing: Arc<pairing::PairingManager>,
    pub task_store: Arc<task::TaskStore>,
    pub energy_registry: energy::EnergyRegistry,
    pub pty_manager: Arc<pty::PtyManager>,
}

impl AppState {
    pub fn new(port: u16) -> Self {
        Self::new_runtime(port, default_runtime_host_id(port), None, false, None)
    }

    pub fn new_runtime(
        port: u16,
        host_id: String,
        mesh_persist_path: Option<PathBuf>,
        enable_mesh_relay: bool,
        auth_secret: Option<String>,
    ) -> Self {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(agent::claude::ClaudeAgent::new()));
        registry.register(Arc::new(agent::echo::EchoAgent::new()));

        let default_routes_path =
            resolve_default_signal_routes_path().map(|path| path.to_string_lossy().to_string());
        let signal_pool = Arc::new(SignalPool::new(default_routes_path.as_deref()));
        let mesh = Arc::new(MeshState::new(
            host_id.clone(),
            Arc::clone(&signal_pool),
            mesh_persist_path,
        ));
        let mesh_relay = enable_mesh_relay.then(|| Arc::new(MeshRelayManager::new(Arc::clone(&mesh))));
        let pty_manager = Arc::new(pty::PtyManager::new(
            Arc::clone(&signal_pool),
            host_id.clone(),
        ));

        Self {
            port,
            host_id,
            registry,
            signal_pool,
            mesh,
            mesh_relay,
            auth_secret,
            mdns: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            task_store: Arc::new(task::TaskStore::new()),
            energy_registry: energy::EnergyRegistry::new(),
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
    version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: RUNTIME_VERSION,
    })
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
    use tower::util::ServiceExt;

    struct TempRouteAgent;

    fn app_state_with_registry(
        port: u16,
        registry: agent::AgentRegistry,
        signal_pool: Arc<signal::SignalPool>,
    ) -> AppState {
        let host_id = format!("lib-test-{port}");
        AppState {
            port,
            host_id: host_id.clone(),
            registry,
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(mesh::MeshState::new(host_id.clone(), Arc::clone(&signal_pool), None)),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            task_store: Arc::new(task::TaskStore::new()),
            energy_registry: energy::EnergyRegistry::new(),
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
                "status": "ok",
                "version": RUNTIME_VERSION
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
            Some("*")
        );
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

        let router = routes::router().with_state(app_state_with_registry(3010, registry, signal_pool));

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

        assert!(resolved.is_some(), "should resolve default routes from workspace root");
        let resolved_path = resolved.expect("resolved path should exist");
        assert!(resolved_path.exists(), "resolved path must exist: {}", resolved_path.display());
        assert!(resolved_path.to_string_lossy().contains("config/signal-routes.default.json"));
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
}
