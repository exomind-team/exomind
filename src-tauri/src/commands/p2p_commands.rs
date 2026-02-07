//! P2P 连接命令模块
//!
//! 现代化 P2P 连接状态管理，准备 libp2p 集成架构
//!
//! ## 连接状态机
//!
//! ```text
//! disconnected ──→ connecting ──→ connected ──→ error
//!      ↑                              │            │
//!      │                              │            │
//!      └──────────────────────────────┘
//! ```
//!
//! ## 事件系统
//!
//! - `state_changed` - 连接状态变更
//! - `peer_connected` - peer 连接成功
//! - `peer_disconnected` - peer 断开连接
//! - `error` - 发生错误

use tauri::{State, AppHandle};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

// ============================================================================
// 类型定义
// ============================================================================

/// P2P 连接状态
#[derive(Clone, Debug, PartialEq)]
pub enum P2PState {
    /// 断开状态
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接
    Connected,
    /// 错误状态
    Error(String),
}

impl Default for P2PState {
    fn default() -> Self {
        Self::Disconnected
    }
}

/// Peer 连接状态
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum PeerStatus {
    /// 连接中
    #[serde(rename = "connecting")]
    Connecting,
    /// 已连接
    #[serde(rename = "connected")]
    Connected,
    /// 已断开
    #[serde(rename = "disconnected")]
    Disconnected,
    /// 连接失败
    #[serde(rename = "failed")]
    Failed,
}

/// Peer 连接信息
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerConnection {
    /// Peer ID
    pub peer_id: String,
    /// IP 地址
    pub ip: String,
    /// 连接状态
    pub status: PeerStatus,
    /// 连接时间
    #[serde(default)]
    pub connected_at: Option<DateTime<Utc>>,
    /// 最后活动时间
    #[serde(default)]
    pub last_seen: Option<DateTime<Utc>>,
}

/// P2P 连接状态管理器
#[derive(Clone, Default)]
pub struct P2PManagerState {
    /// 当前全局状态
    pub state: Arc<Mutex<P2PState>>,
    /// 当前连接的 peers
    pub connected_peers: Arc<Mutex<HashMap<String, PeerConnection>>>,
    /// 最后错误信息
    pub last_error: Arc<Mutex<Option<String>>>,
}

/// 连接状态响应
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionStatusResponse {
    /// 是否已连接
    pub is_connected: bool,
    /// 当前状态
    pub state: String,
    /// Peer 数量
    pub peer_count: usize,
    /// Peer 列表
    pub peers: Vec<PeerInfo>,
    /// 最后错误
    #[serde(default)]
    pub last_error: Option<String>,
}

/// Peer 信息（序列化用）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    /// Peer ID
    #[serde(rename = "peer_id")]
    pub peer_id: String,
    /// IP 地址
    pub ip: String,
    /// 连接状态
    pub status: String,
    /// 连接时间
    #[serde(default)]
    pub connected_at: Option<String>,
}

/// 连接结果
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionResult {
    /// 是否成功
    pub success: bool,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
}

/// 状态变更事件
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateChangedEvent {
    /// 前一个状态
    pub previous_state: String,
    /// 当前状态
    pub current_state: String,
}

// ============================================================================
// 命令实现
// ============================================================================

/// 设置连接状态
fn set_state(state: &State<'_, Arc<P2PManagerState>>, new_state: P2PState) {
    let mut current = state.state.lock().unwrap();
    *current = new_state;
}

/// 获取当前连接状态
fn get_current_state(state: &State<'_, Arc<P2PManagerState>>) -> P2PState {
    state.state.lock().unwrap().clone()
}

/// 连接到 peer
///
/// ## 状态机转换
///
/// ```text
/// disconnected/connecting → connecting → connected
/// ```
#[tauri::command]
pub async fn connect_to_peer(
    state: State<'_, Arc<P2PManagerState>>,
    peer_id: String,
) -> Result<ConnectionResult, String> {
    // 获取当前状态
    let current_state = get_current_state(&state);

    // 检查是否已经在连接中
    if current_state == P2PState::Connecting {
        return Ok(ConnectionResult {
            success: false,
            error: Some("Already connecting".to_string()),
        });
    }

    // 设置为连接中状态
    set_state(&state, P2PState::Connecting);

    // 检查是否已连接
    let mut peers = state.connected_peers.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(existing) = peers.get(&peer_id) {
        if existing.status == PeerStatus::Connected {
            // 已连接，直接返回成功
            set_state(&state, P2PState::Connected);
            return Ok(ConnectionResult {
                success: true,
                error: None,
            });
        }
    }

    // TODO: 实现实际的 libp2p 连接逻辑
    // 目前是占位实现，模拟连接成功

    // 添加连接记录
    let connection = PeerConnection {
        peer_id: peer_id.clone(),
        ip: String::new(),
        status: PeerStatus::Connected,
        connected_at: Some(Utc::now()),
        last_seen: Some(Utc::now()),
    };
    peers.insert(peer_id.clone(), connection);

    // 更新为已连接状态
    set_state(&state, P2PState::Connected);

    Ok(ConnectionResult {
        success: true,
        error: None,
    })
}

/// 断开与 peer 的连接
#[tauri::command]
pub async fn disconnect_from_peer(
    state: State<'_, Arc<P2PManagerState>>,
    peer_id: String,
) -> Result<ConnectionResult, String> {
    let mut peers = state.connected_peers.lock().map_err(|e| format!("Lock error: {}", e))?;

    if peers.remove(&peer_id).is_some() {
        // 检查是否还有连接的 peers
        let connected_count = peers.values()
            .filter(|p| p.status == PeerStatus::Connected)
            .count();

        if connected_count == 0 {
            set_state(&state, P2PState::Disconnected);
        }

        Ok(ConnectionResult {
            success: true,
            error: None,
        })
    } else {
        Ok(ConnectionResult {
            success: false,
            error: Some("Peer not found".to_string()),
        })
    }
}

/// 获取连接状态
#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, Arc<P2PManagerState>>,
) -> Result<ConnectionStatusResponse, String> {
    let peers = state.connected_peers.lock().map_err(|e| format!("Lock error: {}", e))?;
    let current_state = get_current_state(&state);
    let last_error = state.last_error.lock().unwrap().clone();

    let peer_info_list: Vec<PeerInfo> = peers.values()
        .filter(|p| p.status == PeerStatus::Connected)
        .map(|p| PeerInfo {
            peer_id: p.peer_id.clone(),
            ip: p.ip.clone(),
            status: format!("{:?}", p.status),
            connected_at: p.connected_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    let state_str = match &current_state {
        P2PState::Disconnected => "disconnected",
        P2PState::Connecting => "connecting",
        P2PState::Connected => "connected",
        P2PState::Error(_) => "error",
    };

    Ok(ConnectionStatusResponse {
        is_connected: !peer_info_list.is_empty(),
        state: state_str.to_string(),
        peer_count: peer_info_list.len(),
        peers: peer_info_list,
        last_error,
    })
}

/// 断开所有连接
#[tauri::command]
pub async fn disconnect_all(
    state: State<'_, Arc<P2PManagerState>>,
) -> Result<(), String> {
    let mut peers = state.connected_peers.lock().map_err(|e| format!("Lock error: {}", e))?;
    peers.clear();

    set_state(&state, P2PState::Disconnected);

    Ok(())
}

/// 设置全局状态（用于测试）
#[tauri::command]
pub async fn set_p2p_state(
    state: State<'_, Arc<P2PManagerState>>,
    new_state: String,
) -> Result<(), String> {
    let parsed_state = match new_state.as_str() {
        "disconnected" => P2PState::Disconnected,
        "connecting" => P2PState::Connecting,
        "connected" => P2PState::Connected,
        _ => return Err("Invalid state".to_string()),
    };

    set_state(&state, parsed_state);
    Ok(())
}

/// 获取当前全局状态
#[tauri::command]
pub async fn get_p2p_state(
    state: State<'_, Arc<P2PManagerState>>,
) -> Result<String, String> {
    let current = get_current_state(&state);
    let state_str = match current {
        P2PState::Disconnected => "disconnected",
        P2PState::Connecting => "connecting",
        P2PState::Connected => "connected",
        P2PState::Error(e) => return Err(e),
    };
    Ok(state_str.to_string())
}

// ============================================================================
// libp2p 预留接口（待实现）
// ============================================================================

/// libp2p 配置（预留）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Libp2pConfig {
    /// 监听地址列表
    #[serde(default)]
    pub listen_addresses: Vec<String>,
    /// 最大连接数
    #[serde(default)]
    pub max_connections: u32,
    /// 最小连接数
    #[serde(default)]
    pub min_connections: u32,
    /// 是否启用中继
    #[serde(default)]
    pub relay_enabled: bool,
}

/// 初始化 libp2p（预留）
///
/// 预留未来 libp2p 集成的接口
#[tauri::command]
pub async fn init_libp2p(
    _state: State<'_, Arc<P2PManagerState>>,
    _config: Libp2pConfig,
) -> Result<ConnectionResult, String> {
    // TODO: 实现 libp2p 初始化
    Ok(ConnectionResult {
        success: false,
        error: Some("libp2p integration not yet implemented".to_string()),
    })
}

/// 获取节点信息（预留）
#[tauri::command]
pub async fn get_node_info(
    _state: State<'_, Arc<P2PManagerState>>,
) -> Result<Option<String>, String> {
    // TODO: 实现 libp2p 节点信息获取
    Ok(None)
}

/// 发布消息到指定 topic（预留）
#[tauri::command]
pub async fn publish_message(
    _state: State<'_, Arc<P2PManagerState>>,
    _topic: String,
    _message: String,
) -> Result<ConnectionResult, String> {
    // TODO: 实现 libp2p pubsub
    Ok(ConnectionResult {
        success: false,
        error: Some("libp2p pubsub not yet implemented".to_string()),
    })
}

/// 订阅 topic（预留）
#[tauri::command]
pub async fn subscribe_topic(
    _state: State<'_, Arc<P2PManagerState>>,
    _topic: String,
) -> Result<ConnectionResult, String> {
    // TODO: 实现 libp2p pubsub 订阅
    Ok(ConnectionResult {
        success: false,
        error: Some("libp2p pubsub not yet implemented".to_string()),
    })
}

// ============================================================================
// 模块导出
// ============================================================================

/// 导出 P2PManagerState 用于在其他模块中使用
pub type P2PStateManager = Arc<P2PManagerState>;

/// 创建新的 P2P 状态管理器
pub fn new_p2p_state() -> P2PStateManager {
    Arc::new(P2PManagerState {
        state: Arc::new(Mutex::new(P2PState::Disconnected)),
        connected_peers: Arc::new(Mutex::new(HashMap::new())),
        last_error: Arc::new(Mutex::new(None)),
    })
}
