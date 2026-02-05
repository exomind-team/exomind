//! P2P 连接命令模块
//! 处理设备间的 P2P 连接（连接、断开、状态查询）

use tauri::{State, AppHandle};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

/// P2P 连接状态
#[derive(Clone, Default)]
pub struct P2PConnectionState {
    /// 当前连接的 peers
    pub connected_peers: Arc<Mutex<HashMap<String, PeerConnection>>>,
}

/// Peer 连接信息
#[derive(Debug, Clone)]
pub struct PeerConnection {
    pub peer_id: String,
    pub ip: String,
    pub status: ConnectionStatus,
    pub connected_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatusResponse {
    pub connected: bool,
    pub peer_count: usize,
    pub peers: Vec<PeerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub ip: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionResult {
    pub success: bool,
    pub error: Option<String>,
}

/// 连接到 peer
#[tauri::command]
pub async fn connect_to_peer(
    state: State<'_, Arc<P2PConnectionState>>,
    peer_id: String,
) -> Result<ConnectionResult, String> {
    // TODO: 实现实际的 libp2p 连接逻辑
    // 目前是占位实现

    let mut peers = state.connected_peers.lock()
        .map_err(|e| format!("获取连接状态失败: {}", e))?;

    // 检查是否已连接
    if peers.contains_key(&peer_id) {
        return Ok(ConnectionResult {
            success: true,
            error: None,
        });
    }

    // 添加连接记录
    peers.insert(peer_id.clone(), PeerConnection {
        peer_id: peer_id.clone(),
        ip: String::new(),
        status: ConnectionStatus::Connected,
        connected_at: chrono::Utc::now(),
    });

    Ok(ConnectionResult {
        success: true,
        error: None,
    })
}

/// 断开与 peer 的连接
#[tauri::command]
pub async fn disconnect_from_peer(
    state: State<'_, Arc<P2PConnectionState>>,
    peer_id: String,
) -> Result<ConnectionResult, String> {
    let mut peers = state.connected_peers.lock()
        .map_err(|e| format!("获取连接状态失败: {}", e))?;

    if peers.remove(&peer_id).is_some() {
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
    state: State<'_, Arc<P2PConnectionState>>,
) -> Result<ConnectionStatusResponse, String> {
    let peers = state.connected_peers.lock()
        .map_err(|e| format!("获取连接状态失败: {}", e))?;

    let peer_info_list: Vec<PeerInfo> = peers.values()
        .filter(|p| p.status == ConnectionStatus::Connected)
        .map(|p| PeerInfo {
            peer_id: p.peer_id.clone(),
            ip: p.ip.clone(),
            status: format!("{:?}", p.status),
        })
        .collect();

    Ok(ConnectionStatusResponse {
        connected: !peer_info_list.is_empty(),
        peer_count: peer_info_list.len(),
        peers: peer_info_list,
    })
}

/// 断开所有连接
#[tauri::command]
pub async fn disconnect_all(
    state: State<'_, Arc<P2PConnectionState>>,
) -> Result<(), String> {
    let mut peers = state.connected_peers.lock()
        .map_err(|e| format!("获取连接状态失败: {}", e))?;

    peers.clear();
    Ok(())
}
