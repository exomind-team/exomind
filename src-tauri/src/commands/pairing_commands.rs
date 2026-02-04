//! 配对命令模块
//! 处理设备间的配对流程（配对码生成、确认等）

use tauri::{AppHandle, State};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use rand::Rng;
use chrono::{DateTime, Utc};

/// 配对请求结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingRequest {
    pub code: String,
    pub device_name: String,
    pub device_ip: String,
    pub public_key: String,
    pub created_at: DateTime<Utc>,
}

/// 配对状态管理
#[derive(Clone, Default)]
pub struct PairingState {
    /// 待确认的配对请求（code -> request）
    pub pending_requests: Arc<Mutex<HashMap<String, PairingRequest>>>,
    /// 已配对的设备列表
    pub paired_devices: Arc<Mutex<HashMap<String, PairedDevice>>>,
}

/// 已配对设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub public_key: String,
    pub paired_at: DateTime<Utc>,
}

/// 生成 6 位数字配对码
#[tauri::command]
pub async fn generate_pairing_code(
    _app: AppHandle,
    state: State<'_, PairingState>,
    device_name: String,
    device_ip: String,
    public_key: String,
) -> Result<String, String> {
    // 生成 6 位数字配对码
    let code: String = rand::thread_rng()
        .gen_range(100000..=999999)
        .to_string();

    let request = PairingRequest {
        code: code.clone(),
        device_name,
        device_ip,
        public_key,
        created_at: Utc::now(),
    };

    // 存储配对请求（5 分钟超时）
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;
    requests.insert(code.clone(), request);

    // TODO: 后续可以实现 mDNS/UDP 广播发现局域网内的设备

    Ok(code)
}

/// 确认配对请求
#[tauri::command]
pub async fn confirm_pairing(
    state: State<'_, PairingState>,
    code: String,
    accept: bool,
) -> Result<bool, String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    if let Some(request) = requests.get(&code) {
        // 检查是否超时（5 分钟）
        let now = Utc::now();
        let duration = now.signed_duration_since(request.created_at);

        if duration.num_minutes() > 5 {
            requests.remove(&code);
            return Err("配对码已过期，请重新生成".to_string());
        }

        if accept {
            // TODO: 建立加密通道，交换密钥
            // 存储配对设备信息
            let paired_device = PairedDevice {
                id: request.public_key.clone(),
                name: request.device_name.clone(),
                ip: request.device_ip.clone(),
                public_key: request.public_key.clone(),
                paired_at: now,
            };

            let mut devices = state.paired_devices.lock()
                .map_err(|e| format!("获取已配对设备失败: {}", e))?;
            devices.insert(request.public_key.clone(), paired_device);

            requests.remove(&code);
            return Ok(true);
        } else {
            requests.remove(&code);
            return Ok(false);
        }
    }

    Err("配对码无效或已过期".to_string())
}

/// 获取所有待确认的配对请求
#[tauri::command]
pub async fn get_pairing_requests(
    state: State<'_, PairingState>,
) -> Result<Vec<PairingRequest>, String> {
    let requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    // 清理过期的请求
    let now = Utc::now();
    let mut valid_requests = Vec::new();

    for (_code, request) in requests.iter() {
        let duration = now.signed_duration_since(request.created_at);
        if duration.num_minutes() <= 5 {
            valid_requests.push(request.clone());
        }
    }

    Ok(valid_requests)
}

/// 获取所有已配对的设备
#[tauri::command]
pub async fn get_paired_devices(
    state: State<'_, PairingState>,
) -> Result<Vec<PairedDevice>, String> {
    let devices = state.paired_devices.lock()
        .map_err(|e| format!("获取已配对设备失败: {}", e))?;

    Ok(devices.values().cloned().collect())
}

/// 取消配对（移除已配对的设备）
#[tauri::command]
pub async fn remove_paired_device(
    state: State<'_, PairingState>,
    device_id: String,
) -> Result<bool, String> {
    let mut devices = state.paired_devices.lock()
        .map_err(|e| format!("获取已配对设备失败: {}", e))?;

    if devices.remove(&device_id).is_some() {
        Ok(true)
    } else {
        Err("设备不存在或已被移除".to_string())
    }
}

/// 清除所有待确认的配对请求
#[tauri::command]
pub async fn clear_pairing_requests(
    state: State<'_, PairingState>,
) -> Result<(), String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;
    requests.clear();
    Ok(())
}
