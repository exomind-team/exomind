//! runtime_startup.rs - Runtime startup contract tests（运行时启动契约测试）
//!
//! TDD RED phase:
//! - default port should be 1949（默认端口应为 1949）
//! - port=0 means random assign（端口 0 表示随机分配）
//! - runtime can start/stop via lib API（可通过库 API 启停）

use exomind_runtime::{
    DEFAULT_RT_PORT, RuntimeStartOptions, configured_port_from_env,
    spawn_ts_agents_default_for_platform, start_with_options,
};
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

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
