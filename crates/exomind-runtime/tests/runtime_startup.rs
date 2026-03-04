//! runtime_startup.rs - Runtime startup contract tests（运行时启动契约测试）
//!
//! TDD RED phase:
//! - default port should be 1949（默认端口应为 1949）
//! - port=0 means random assign（端口 0 表示随机分配）
//! - runtime can start/stop via lib API（可通过库 API 启停）

use exomind_runtime::{
    configured_port_from_env, start_with_options, RuntimeStartOptions, DEFAULT_RT_PORT,
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
