//! runtime_startup.rs - Runtime startup contract tests（运行时启动契约测试）
//!
//! TDD RED phase:
//! - default port should be 1949（默认端口应为 1949）
//! - port=0 means random assign（端口 0 表示随机分配）
//! - runtime can start/stop via lib API（可通过库 API 启停）

use exomind_runtime::{
    DEFAULT_RT_PORT, RuntimeStartOptions, configured_port_from_env,
    ens::{
        EnsInterfaceMedium, EnsInterfaceTopology, EnsTransportSnapshot,
        ReticulumEnsInterfaceConfig, ReticulumEnsProviderConfig,
    },
    spawn_ts_agents_default_for_platform, start_with_options,
};
use std::ffi::OsString;
use std::sync::Mutex;
use std::time::Duration;
use tempfile::tempdir;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(key);
        // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
        unsafe {
            std::env::set_var(key, value);
        }
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
        unsafe {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

#[test]
fn configured_port_defaults_to_1949_when_env_missing() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");
    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::remove_var("EXOMIND_RT_PORT");
    }
    let port = configured_port_from_env().expect("port should parse");
    assert_eq!(port, DEFAULT_RT_PORT);
    assert_eq!(port, 1949);
}

#[test]
fn configured_port_accepts_zero_for_random_assignment() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");
    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::set_var("EXOMIND_RT_PORT", "0");
    }
    let port = configured_port_from_env().expect("port should parse");
    assert_eq!(port, 0);
}

#[test]
fn reticulum_ens_startup_config_can_be_read_from_env() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");
    let dir = tempdir().expect("temp dir should be available");
    let registry_path = dir.path().join("reticulum-local-registry.json");
    let config_sqlite_path = dir.path().join("config.sqlite");
    let jsonl_dir = dir.path().join("jsonl");
    let file_path = dir.path().join("reticulum-file.jsonl");

    let _reticulum_flag = EnvVarGuard::set("EXOMIND_RT_ENS_RETICULUM", "1");
    let _host_id = EnvVarGuard::set("EXOMIND_RT_HOST_ID", "rt-env-reticulum");
    let _device_id = EnvVarGuard::set("EXOMIND_RT_DEVICE_ID", "dev-env-reticulum");
    let _config_sqlite = EnvVarGuard::set(
        "EXOMIND_RT_CONFIG_SQLITE_PATH",
        config_sqlite_path.as_os_str(),
    );
    let _registry = EnvVarGuard::set(
        "EXOMIND_RT_RETICULUM_LOCAL_REGISTRY_PATH",
        registry_path.as_os_str(),
    );
    let _udp = EnvVarGuard::set("EXOMIND_RT_RETICULUM_UDP_BIND", "127.0.0.1:0");
    let _udp_forward = EnvVarGuard::set("EXOMIND_RT_RETICULUM_UDP_FORWARD", "127.0.0.1:4242");
    let _tcp_listen = EnvVarGuard::set("EXOMIND_RT_RETICULUM_TCP_LISTEN", "127.0.0.1:0");
    let _tcp_connect = EnvVarGuard::set("EXOMIND_RT_RETICULUM_TCP_CONNECT", "127.0.0.1:5252");
    let _jsonl_dir = EnvVarGuard::set("EXOMIND_RT_RETICULUM_JSONL_DIR", jsonl_dir.as_os_str());
    let _jsonl_node = EnvVarGuard::set("EXOMIND_RT_RETICULUM_JSONL_NODE", "runtime-jsonl-env");
    let _file_path = EnvVarGuard::set("EXOMIND_RT_RETICULUM_FILE_PATH", file_path.as_os_str());
    let _file_name = EnvVarGuard::set("EXOMIND_RT_RETICULUM_FILE_NAME", "runtime-file-env");

    let options = RuntimeStartOptions::default();
    let config = options
        .reticulum_ens
        .expect("Reticulum ENS config should be enabled by env");

    assert_eq!(
        config.local_registry_path.as_deref(),
        Some(registry_path.as_path())
    );
    assert!(config.load_local_registry);
    assert!(config.publish_local_registry);
    assert_eq!(config.interfaces.len(), 5);
    assert!(config.interfaces.iter().any(|interface| {
        matches!(
            interface,
            ReticulumEnsInterfaceConfig::Udp {
                bind_addr,
                forward_addr: Some(forward_addr),
                topology: EnsInterfaceTopology::Active,
            } if bind_addr == "127.0.0.1:0" && forward_addr == "127.0.0.1:4242"
        )
    }));
    assert!(config.interfaces.iter().any(|interface| {
        matches!(
            interface,
            ReticulumEnsInterfaceConfig::TcpServer {
                bind_addr,
                topology: EnsInterfaceTopology::Active,
            } if bind_addr == "127.0.0.1:0"
        )
    }));
    assert!(config.interfaces.iter().any(|interface| {
        matches!(
            interface,
            ReticulumEnsInterfaceConfig::TcpClient {
                remote_addr,
                topology: EnsInterfaceTopology::Active,
            } if remote_addr == "127.0.0.1:5252"
        )
    }));
    assert!(config.interfaces.iter().any(|interface| {
        matches!(
            interface,
            ReticulumEnsInterfaceConfig::Jsonl {
                node_name,
                stream_dir,
                topology: EnsInterfaceTopology::Active,
            } if node_name == "runtime-jsonl-env" && stream_dir == &jsonl_dir
        )
    }));
    assert!(config.interfaces.iter().any(|interface| {
        matches!(
            interface,
            ReticulumEnsInterfaceConfig::File {
                name,
                file_path: configured_file_path,
                topology: EnsInterfaceTopology::Active,
            } if name == "runtime-file-env" && configured_file_path == &file_path
        )
    }));
}

#[test]
fn spawn_ts_agents_default_is_disabled_on_mobile_platforms() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");
    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::remove_var("EXOMIND_RT_DISABLE_TS_AGENTS");
    }

    assert!(
        !spawn_ts_agents_default_for_platform(true, None),
        "mobile platforms should default to not spawning Bun-based TS agents"
    );
}

#[test]
fn spawn_ts_agents_default_stays_enabled_on_desktop_when_env_missing() {
    let _guard = ENV_LOCK.lock().expect("env lock should be available");
    // SAFETY: tests guard env mutation with a global mutex（用全局锁保护环境变量修改）
    unsafe {
        std::env::remove_var("EXOMIND_RT_DISABLE_TS_AGENTS");
    }

    assert!(
        spawn_ts_agents_default_for_platform(false, None),
        "desktop platforms should keep existing default behavior"
    );
}

#[test]
fn spawn_ts_agents_disable_flag_can_be_explicitly_cleared_on_mobile() {
    assert!(
        spawn_ts_agents_default_for_platform(true, Some("false")),
        "mobile should still allow explicit opt-in for TS agents"
    );
}

#[tokio::test]
async fn start_with_port_zero_binds_a_random_available_port() {
    let mut handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        spawn_ts_agents: false,
        ..Default::default()
    })
    .await
    .expect("runtime should start");

    assert!(handle.port() > 0);
    assert_eq!(handle.host(), "127.0.0.1");

    handle.stop().await.expect("runtime should stop");
}

async fn wait_for_reticulum_udp_snapshot(port: u16) -> EnsTransportSnapshot {
    let url = format!("http://127.0.0.1:{port}/mesh/ens/snapshot");
    let mut last_snapshot = None;

    for _ in 0..100 {
        let response = reqwest::get(&url)
            .await
            .expect("ENS snapshot request should succeed");
        assert!(
            response.status().is_success(),
            "ENS snapshot request should succeed: {}",
            response.status()
        );
        let snapshot = response
            .json::<EnsTransportSnapshot>()
            .await
            .expect("ENS snapshot payload should decode");

        let projected_udp = snapshot.interfaces.iter().any(|interface| {
            interface
                .interface_address
                .as_deref()
                .is_some_and(|address| {
                    address.starts_with("udp://127.0.0.1:") && !address.ends_with(":0")
                })
        });
        if snapshot.provider_id == "runtime-reticulum-ens" && projected_udp {
            return snapshot;
        }

        last_snapshot = Some(snapshot);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    panic!("Reticulum UDP endpoint was not projected into ENS snapshot: {last_snapshot:#?}");
}

#[tokio::test]
async fn start_with_options_projects_reticulum_ens_snapshot() {
    let dir = tempdir().expect("temp dir should be available");
    let mut handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-start-reticulum".to_string(),
        device_id: "dev-start-reticulum".to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: Some(dir.path().join("mesh-state.json")),
        signal_storage_path: Some(dir.path().join("signals.sqlite")),
        enable_mdns: false,
        reticulum_ens: Some(ReticulumEnsProviderConfig {
            local_registry_path: None,
            interfaces: vec![ReticulumEnsInterfaceConfig::Udp {
                bind_addr: "127.0.0.1:0".to_string(),
                forward_addr: None,
                topology: EnsInterfaceTopology::Active,
            }],
            load_local_registry: false,
            publish_local_registry: false,
        }),
        data_dir: Some(dir.path().to_path_buf()),
        ..Default::default()
    })
    .await
    .expect("runtime should start with Reticulum ENS provider");

    let snapshot = wait_for_reticulum_udp_snapshot(handle.port()).await;

    handle.stop().await.expect("runtime should stop");

    assert_eq!(snapshot.provider_id, "runtime-reticulum-ens");
    assert_eq!(snapshot.global_topology, EnsInterfaceTopology::Active);
    let local_identity = snapshot
        .local_identity
        .as_ref()
        .expect("Reticulum provider should expose local identity");
    assert_eq!(
        local_identity.host_id.as_deref(),
        Some("rt-start-reticulum")
    );
    let endpoint = snapshot
        .local_endpoint
        .as_ref()
        .expect("Reticulum provider should expose local endpoint");
    assert_eq!(endpoint.host_id.as_deref(), Some("rt-start-reticulum"));
    assert_eq!(
        endpoint.runtime_base_url.as_deref(),
        Some(format!("http://127.0.0.1:{}", handle.port()).as_str())
    );
    assert_eq!(endpoint.via_medium, Some(EnsInterfaceMedium::Udp));
    assert!(endpoint.reticulum_destination.is_some());
    let interface_address = endpoint
        .interface_address
        .as_deref()
        .expect("Reticulum endpoint should expose physical interface address");
    assert!(interface_address.starts_with("udp://127.0.0.1:"));
    assert!(!interface_address.ends_with(":0"));

    let udp_interface = snapshot
        .interfaces
        .iter()
        .find(|interface| interface.interface_type == "udp_interface")
        .expect("configured UDP interface should be visible");
    assert!(udp_interface.online);
    assert_eq!(udp_interface.topology, EnsInterfaceTopology::Active);
    assert_eq!(
        udp_interface.effective_topology,
        EnsInterfaceTopology::Active
    );
    let udp_interface_address = udp_interface
        .interface_address
        .as_deref()
        .expect("UDP interface should expose physical interface address");
    assert!(udp_interface_address.starts_with("udp://127.0.0.1:"));
    assert!(!udp_interface_address.ends_with(":0"));
}

#[tokio::test]
async fn start_with_options_uses_persistent_sqlite_task_backend_by_default() {
    let dir = tempdir().expect("temp dir should be available");

    let mut handle = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        spawn_ts_agents: false,
        data_dir: Some(dir.path().to_path_buf()),
        ..Default::default()
    })
    .await
    .expect("runtime should start");

    let response = reqwest::get(format!(
        "http://127.0.0.1:{}/tasks/backend/status",
        handle.port()
    ))
    .await
    .expect("backend status request should succeed");
    let payload = response
        .json::<serde_json::Value>()
        .await
        .expect("backend status payload should decode");

    handle.stop().await.expect("runtime should stop");

    assert_eq!(payload["backend"], "rt-sqlite");
    assert_eq!(payload["supports_sqlite_snapshot"], true);
}
