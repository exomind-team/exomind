//! 配对命令模块
//! 处理设备间的配对流程（配对码生成、确认等）
//! 实现了配对状态机：idle → discovering → pairing → paired/error/timeout/cancelled

use tauri::{AppHandle, State};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use rand::Rng;
use chrono::{DateTime, Utc, Duration};
use uuid::Uuid;

// ============================================================================
// 配对状态机定义
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairingState {
    Idle,           // 空闲状态
    Discovering,    // 发现设备中
    Generating,     // 生成配对码
    Pairing,        // 等待对方确认配对
    Confirming,     // 等待用户确认
    Paired,         // 配对成功
    Error,          // 配对失败
    Timeout,        // 配对超时
    Cancelled,      // 配对取消
}

impl Default for PairingState {
    fn default() -> Self {
        PairingState::Idle
    }
}

// ============================================================================
// 配对配置
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingConfig {
    /// 超时时间（秒），默认 30 秒
    pub timeout_seconds: u64,
    /// 配对码长度，默认 6 位
    pub code_length: usize,
    /// 是否自动开始发现设备
    pub auto_discover: bool,
}

impl Default for PairingConfig {
    fn default() -> Self {
        PairingConfig {
            timeout_seconds: 30,
            code_length: 6,
            auto_discover: false,
        }
    }
}

// ============================================================================
// 配对数据模型
// ============================================================================

/// 配对请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingRequest {
    pub id: String,
    pub code: String,
    pub device_name: String,
    pub device_ip: String,
    pub device_type: DeviceType,
    pub public_key: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl PairingRequest {
    /// 检查请求是否过期
    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at
    }

    /// 获取剩余有效时间（秒）
    pub fn remaining_seconds(&self) -> i64 {
        let remaining = self.expires_at.signed_duration_since(Utc::now());
        remaining.num_seconds().max(0)
    }
}

/// 设备类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeviceType {
    Desktop,
    Mobile,
}

/// 已配对设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub device_type: DeviceType,
    pub public_key: String,
    pub paired_at: DateTime<Utc>,
    pub confirmed: bool,
}

/// 配对结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingResult {
    pub success: bool,
    pub code: Option<String>,
    pub device: Option<PairedDevice>,
    pub error_message: Option<String>,
}

// ============================================================================
// 配对状态管理
// ============================================================================

/// 配对状态存储
#[derive(Clone, Default)]
pub struct PairingStateManager {
    /// 当前配对状态
    pub current_state: Arc<Mutex<PairingState>>,
    /// 当前配对配置
    pub config: Arc<Mutex<PairingConfig>>,
    /// 待确认的配对请求（code -> request）
    pub pending_requests: Arc<Mutex<HashMap<String, PairingRequest>>>,
    /// 已配对的设备列表
    pub paired_devices: Arc<Mutex<HashMap<String, PairedDevice>>>,
    /// 正在进行的配对请求 ID
    pub active_request_id: Arc<Mutex<Option<String>>>,
}

impl PairingStateManager {
    /// 创建新的状态管理器
    pub fn new() -> Self {
        Self {
            current_state: Arc::new(Mutex::new(PairingState::Idle)),
            config: Arc::new(Mutex::new(PairingConfig::default())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            paired_devices: Arc::new(Mutex::new(HashMap::new())),
            active_request_id: Arc::new(Mutex::new(None)),
        }
    }

    /// 获取当前状态
    pub fn get_state(&self) -> PairingState {
        self.current_state.lock().unwrap().clone()
    }

    /// 设置状态
    pub fn set_state(&self, state: PairingState) {
        *self.current_state.lock().unwrap() = state;
    }

    /// 检查是否处于活跃状态
    pub fn is_active(&self) -> bool {
        let state = self.get_state();
        matches!(
            state,
            PairingState::Discovering
                | PairingState::Generating
                | PairingState::Pairing
                | PairingState::Confirming
        )
    }
}

// ============================================================================
// 工具函数
// ============================================================================

/// 生成指定长度的配对码
fn generate_pairing_code(length: usize) -> String {
    const CHARSET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    let code: String = (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect();
    code
}

/// 清理过期的配对请求
fn cleanup_expired_requests(requests: &mut HashMap<String, PairingRequest>) {
    let now = Utc::now();
    requests.retain(|_, request| !request.is_expired());
}

// ============================================================================
// 配对命令实现
// ============================================================================

/// 更新配对配置
#[tauri::command]
pub async fn update_pairing_config(
    state: State<'_, Arc<PairingStateManager>>,
    config: PairingConfig,
) -> Result<(), String> {
    let mut current_config = state.config.lock()
        .map_err(|e| format!("获取配对配置失败: {}", e))?;
    *current_config = config;
    Ok(())
}

/// 获取当前配对配置
#[tauri::command]
pub async fn get_pairing_config(
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<PairingConfig, String> {
    let config = state.config.lock()
        .map_err(|e| format!("获取配对配置失败: {}", e))?;
    Ok(config.clone())
}

/// 获取当前配对状态
#[tauri::command]
pub async fn get_pairing_state(
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<String, String> {
    let current_state = state.get_state();
    Ok(format!("{:?}", current_state))
}

/// 生成配对码并发起配对请求
#[tauri::command]
pub async fn generate_pairing_code_and_request(
    _app: AppHandle,
    state: State<'_, Arc<PairingStateManager>>,
    device_name: String,
    device_ip: String,
    device_type: DeviceType,
    public_key: Option<String>,
) -> Result<PairingResult, String> {
    // 检查是否已有活跃配对
    if state.is_active() {
        return Ok(PairingResult {
            success: false,
            code: None,
            device: None,
            error_message: Some(format!("Cannot start pairing: current state is {:?}", state.get_state())),
        });
    }

    // 设置状态为生成中
    state.set_state(PairingState::Generating);

    // 获取配置
    let config = state.config.lock()
        .map_err(|e| format!("获取配对配置失败: {}", e))?.clone();

    // 生成配对码
    let code = generate_pairing_code(config.code_length);
    let now = Utc::now();
    let expires_at = now + Duration::seconds(config.timeout_seconds as i64);

    let request = PairingRequest {
        id: Uuid::new_v4().to_string(),
        code: code.clone(),
        device_name: device_name.clone(),
        device_ip: device_ip.clone(),
        device_type,
        public_key,
        created_at: now,
        expires_at,
    };

    // 存储配对请求
    {
        let mut requests = state.pending_requests.lock()
            .map_err(|e| format!("获取配对状态失败: {}", e))?;
        cleanup_expired_requests(&mut requests);
        requests.insert(code.clone(), request.clone());
    }

    // 设置活跃请求 ID
    {
        let mut active_id = state.active_request_id.lock()
            .map_err(|e| format!("获取活跃请求失败: {}", e))?;
        *active_id = Some(request.id.clone());
    }

    // 切换到 pairing 状态
    state.set_state(PairingState::Pairing);

    // TODO: 后续可以实现 mDNS/UDP 广播发现局域网内的设备

    Ok(PairingResult {
        success: true,
        code: Some(code),
        device: None,
        error_message: None,
    })
}

/// 确认配对请求（接收方调用）
#[tauri::command]
pub async fn confirm_pairing(
    state: State<'_, Arc<PairingStateManager>>,
    code: String,
    accept: bool,
) -> Result<PairingResult, String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    // 清理过期请求
    cleanup_expired_requests(&mut requests);

    if let Some(request) = requests.get(&code) {
        // 检查是否过期
        if request.is_expired() {
            requests.remove(&code);
            state.set_state(PairingState::Timeout);
            return Ok(PairingResult {
                success: false,
                code: Some(code),
                device: None,
                error_message: Some("配对码已过期，请重新生成".to_string()),
            });
        }

        if accept {
            // 创建设备记录
            let paired_device = PairedDevice {
                id: request.public_key.clone().unwrap_or_else(|| request.id.clone()),
                name: request.device_name.clone(),
                ip: request.device_ip.clone(),
                device_type: request.device_type.clone(),
                public_key: request.public_key.clone().unwrap_or_default(),
                paired_at: Utc::now(),
                confirmed: true,
            };

            // 保存到已配对设备
            {
                let mut devices = state.paired_devices.lock()
                    .map_err(|e| format!("获取已配对设备失败: {}", e))?;
                devices.insert(paired_device.id.clone(), paired_device.clone());
            }

            // 移除待确认请求
            requests.remove(&code);

            // 清除活跃请求 ID
            {
                let mut active_id = state.active_request_id.lock()
                    .map_err(|e| format!("获取活跃请求失败: {}", e))?;
                *active_id = None;
            }

            // 切换到配对成功状态
            state.set_state(PairingState::Paired);

            return Ok(PairingResult {
                success: true,
                code: Some(code),
                device: Some(paired_device),
                error_message: None,
            });
        } else {
            // 用户拒绝配对
            requests.remove(&code);

            // 清除活跃请求 ID
            {
                let mut active_id = state.active_request_id.lock()
                    .map_err(|e| format!("获取活跃请求失败: {}", e))?;
                *active_id = None;
            }

            // 切换到取消状态
            state.set_state(PairingState::Cancelled);

            return Ok(PairingResult {
                success: false,
                code: Some(code),
                device: None,
                error_message: Some("用户拒绝配对".to_string()),
            });
        }
    }

    Err("配对码无效或已过期".to_string())
}

/// 开始确认配对流程（接收方）
#[tauri::command]
pub async fn start_confirming_pairing(
    state: State<'_, Arc<PairingStateManager>>,
    code: String,
    device_name: String,
    device_ip: String,
    device_type: DeviceType,
    public_key: Option<String>,
) -> Result<bool, String> {
    // 检查是否已有活跃配对
    if state.is_active() {
        return Err(format!("Cannot start confirming: current state is {:?}", state.get_state()));
    }

    // 验证配对码格式
    if code.len() != state.config.lock()
        .map_err(|e| format!("获取配对配置失败: {}", e))?.code_length {
        state.set_state(PairingState::Error);
        return Err("配对码长度无效".to_string());
    }

    // 验证字符集
    let valid_chars: std::collections::HashSet<char> =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".chars().collect();
    if !code.chars().all(|c| valid_chars.contains(&c)) {
        state.set_state(PairingState::Error);
        return Err("配对码包含无效字符".to_string());
    }

    // 检查是否有相同配对码的请求
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    if requests.contains_key(&code) {
        return Err("配对码已被使用".to_string());
    }

    // 创建配对请求
    let config = state.config.lock()
        .map_err(|e| format!("获取配对配置失败: {}", e))?.clone();

    let now = Utc::now();
    let expires_at = now + Duration::seconds(config.timeout_seconds as i64);

    let request = PairingRequest {
        id: Uuid::new_v4().to_string(),
        code: code.clone(),
        device_name,
        device_ip,
        device_type,
        public_key,
        created_at: now,
        expires_at,
    };

    // 存储请求
    requests.insert(code.clone(), request.clone());

    // 设置活跃请求 ID
    {
        let mut active_id = state.active_request_id.lock()
            .map_err(|e| format!("获取活跃请求失败: {}", e))?;
        *active_id = Some(request.id.clone());
    }

    // 切换到确认状态
    state.set_state(PairingState::Confirming);

    Ok(true)
}

/// 取消当前配对流程
#[tauri::command]
pub async fn cancel_pairing(
    state: State<'_, Arc<PairingStateManager>>,
    reason: Option<String>,
) -> Result<(), String> {
    if !matches!(
        state.get_state(),
        PairingState::Discovering
            | PairingState::Generating
            | PairingState::Pairing
            | PairingState::Confirming
    ) {
        return Err(format!("Cannot cancel: current state is {:?}", state.get_state()));
    }

    // 清除活跃请求 ID
    {
        let mut active_id = state.active_request_id.lock()
            .map_err(|e| format!("获取活跃请求失败: {}", e))?;
        *active_id = None;
    }

    // 切换到取消状态
    state.set_state(PairingState::Cancelled);

    Ok(())
}

/// 重置配对状态
#[tauri::command]
pub async fn reset_pairing_state(
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<(), String> {
    // 清除活跃请求 ID
    {
        let mut active_id = state.active_request_id.lock()
            .map_err(|e| format!("获取活跃请求失败: {}", e))?;
        *active_id = None;
    }

    // 重置状态
    state.set_state(PairingState::Idle);

    Ok(())
}

/// 获取所有待确认的配对请求
#[tauri::command]
pub async fn get_pairing_requests(
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<Vec<PairingRequest>, String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    // 清理过期的请求
    cleanup_expired_requests(&mut requests);

    Ok(requests.values().cloned().collect())
}

/// 检查配对码是否有效
#[tauri::command]
pub async fn validate_pairing_code(
    state: State<'_, Arc<PairingStateManager>>,
    code: String,
) -> Result<bool, String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    // 清理过期请求
    cleanup_expired_requests(&mut requests);

    // 检查配对码是否存在且未过期
    if let Some(request) = requests.get(&code) {
        return Ok(!request.is_expired());
    }

    Ok(false)
}

/// 获取配对码剩余有效时间
#[tauri::command]
pub async fn get_pairing_code_remaining_time(
    state: State<'_, Arc<PairingStateManager>>,
    code: String,
) -> Result<u64, String> {
    let requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;

    if let Some(request) = requests.get(&code) {
        return Ok(request.remaining_seconds() as u64);
    }

    Err("配对码不存在".to_string())
}

/// 获取所有已配对的设备
#[tauri::command]
pub async fn get_paired_devices(
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<Vec<PairedDevice>, String> {
    let devices = state.paired_devices.lock()
        .map_err(|e| format!("获取已配对设备失败: {}", e))?;

    Ok(devices.values().cloned().collect())
}

/// 获取单个已配对设备
#[tauri::command]
pub async fn get_paired_device(
    state: State<'_, Arc<PairingStateManager>>,
    device_id: String,
) -> Result<Option<PairedDevice>, String> {
    let devices = state.paired_devices.lock()
        .map_err(|e| format!("获取已配对设备失败: {}", e))?;

    Ok(devices.get(&device_id).cloned())
}

/// 取消配对（移除已配对的设备）
#[tauri::command]
pub async fn remove_paired_device(
    state: State<'_, Arc<PairingStateManager>>,
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
    state: State<'_, Arc<PairingStateManager>>,
) -> Result<(), String> {
    let mut requests = state.pending_requests.lock()
        .map_err(|e| format!("获取配对状态失败: {}", e))?;
    requests.clear();
    Ok(())
}

/// 检查设备是否已配对
#[tauri::command]
pub async fn is_device_paired(
    state: State<'_, Arc<PairingStateManager>>,
    device_id: String,
) -> Result<bool, String> {
    let devices = state.paired_devices.lock()
        .map_err(|e| format!("获取已配对设备失败: {}", e))?;

    Ok(devices.contains_key(&device_id))
}

// ============================================================================
// 兼容性类型（供迁移使用）
// ============================================================================

/// 旧版配对请求结构（兼容性）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyPairingRequest {
    pub code: String,
    pub device_name: String,
    pub device_ip: String,
    pub public_key: String,
    pub created_at: DateTime<Utc>,
}

/// 旧版配对状态管理（兼容性）
#[derive(Clone, Default)]
#[deprecated(since = "0.2.0", note = "Use PairingStateManager instead")]
pub struct PairingStateLegacy {
    pub pending_requests: Arc<Mutex<HashMap<String, LegacyPairingRequest>>>,
    pub paired_devices: Arc<Mutex<HashMap<String, PairedDevice>>>,
}
