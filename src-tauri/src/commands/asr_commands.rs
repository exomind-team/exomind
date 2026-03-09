//! 火山引擎 ASR (语音识别) Tauri 命令
//!
//! 通过 WebSocket 连接火山引擎大模型流式语音识别服务，
//! 解决浏览器无法设置 WebSocket 自定义头部的限制。
//!
//! 协议文档: https://www.volcengine.com/docs/6561/1354869
//! WebSocket 地址: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel

use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite};
use tungstenite::http::Request as HttpRequest;

// ========== 类型定义 ==========

/// 前端传入的 ASR 配置
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolcanoAsrConfig {
    pub app_key: String,
    pub access_key: String,
    #[serde(default = "default_resource_id")]
    pub resource_id: String,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_resource_id() -> String {
    "volc.bigasr.sauc.duration".to_string()
}

fn default_language() -> String {
    "zh-CN".to_string()
}

/// ASR 识别结果（返回给前端）
#[derive(Debug, Serialize)]
pub struct AsrResult {
    pub text: String,
    pub confidence: f64,
    pub lang: String,
    pub duration: Option<f64>,
}

/// 火山引擎 API 响应
#[derive(Debug, Deserialize)]
struct VolcanoResponse {
    code: Option<i64>,
    message: Option<String>,
    result: Option<VolcanoResultPayload>,
    audio_info: Option<VolcanoAudioInfo>,
}

#[derive(Debug, Deserialize)]
struct VolcanoResultPayload {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VolcanoAudioInfo {
    duration: Option<f64>,
}

// ========== 二进制协议 ==========
//
// 火山引擎自定义二进制 WebSocket 协议:
//
// Header (4 bytes):
//   Byte 0: (version << 4) | header_size    → 0x11 (version=1, header=1*4=4 bytes)
//   Byte 1: (message_type << 4) | flags
//   Byte 2: (serialization << 4) | compression
//   Byte 3: reserved (0x00)
//
// Payload Size (4 bytes): big-endian u32
// Payload: raw bytes or JSON
//
// Message Types:
//   1 = Full Client Request (JSON config)
//   2 = Audio Only
//   9 = Server ASR Result
//  15 = Server Error
//
// Serialization: 0=raw, 1=JSON
// Compression: 0=none, 1=gzip

/// 构建请求消息 (Full Client Request, JSON)
fn build_request_message(data: &serde_json::Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(data).expect("JSON serialization failed");
    let payload_size = (json_bytes.len() as u32).to_be_bytes();
    let header: [u8; 4] = [
        0x11, // version=1, headerSize=1
        0x10, // messageType=1 (full client request), flags=0
        0x10, // serialization=1 (JSON), compression=0
        0x00, // reserved
    ];
    let mut msg = Vec::with_capacity(4 + 4 + json_bytes.len());
    msg.extend_from_slice(&header);
    msg.extend_from_slice(&payload_size);
    msg.extend_from_slice(&json_bytes);
    msg
}

/// 构建音频消息
fn build_audio_message(audio_data: &[u8], is_last: bool) -> Vec<u8> {
    // messageType=2 (audio only)
    // flags: 0x00=normal, 0x02=last packet
    let flags: u8 = if is_last { 0x02 } else { 0x00 };
    let header: [u8; 4] = [
        0x11,                  // version=1, headerSize=1
        (0x02 << 4) | flags,   // messageType=2, flags
        0x00,                  // serialization=0 (raw), compression=0
        0x00,                  // reserved
    ];
    let payload_size = (audio_data.len() as u32).to_be_bytes();
    let mut msg = Vec::with_capacity(4 + 4 + audio_data.len());
    msg.extend_from_slice(&header);
    msg.extend_from_slice(&payload_size);
    msg.extend_from_slice(audio_data);
    msg
}

/// 解析响应消息
fn parse_response_message(data: &[u8]) -> Result<VolcanoResponse, String> {
    // 先尝试直接 JSON 解析（某些情况下服务器返回纯 JSON）
    if let Ok(resp) = serde_json::from_slice::<VolcanoResponse>(data) {
        return Ok(resp);
    }

    // 二进制格式：跳过 4 字节 header + 4 字节 payload size
    if data.len() < 8 {
        return Err(format!("Response too short: {} bytes", data.len()));
    }

    let json_bytes = &data[8..];

    // 尝试找到 JSON 的起始位置（跳过可能的前缀）
    if let Some(pos) = json_bytes.iter().position(|&b| b == b'{') {
        let json_slice = &json_bytes[pos..];
        serde_json::from_slice(json_slice)
            .map_err(|e| format!("JSON parse error: {e}"))
    } else {
        Err(format!(
            "No JSON found in response ({} bytes)",
            data.len()
        ))
    }
}

// ========== Tauri 命令 ==========

/// 一次性语音识别：接收 PCM 音频数据，返回识别结果
///
/// 前端调用: invoke('volcano_asr_recognize', { audioData: Uint8Array, config: {...} })
#[tauri::command]
pub async fn volcano_asr_recognize(
    audio_data: Vec<u8>,
    config: VolcanoAsrConfig,
) -> Result<AsrResult, String> {
    use futures_util::{SinkExt, StreamExt};

    eprintln!("[ASR-Rust] 开始识别, 音频大小: {} bytes", audio_data.len());
    eprintln!(
        "[ASR-Rust] AppKey: {}***",
        &config.app_key[..config.app_key.len().min(8)]
    );
    eprintln!("[ASR-Rust] ResourceId: {}", config.resource_id);

    if audio_data.is_empty() {
        return Err("音频数据为空".to_string());
    }

    let ws_url = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
    let connect_id = uuid::Uuid::new_v4().to_string();

    // 构建带认证头的 HTTP 升级请求
    let request = HttpRequest::builder()
        .uri(ws_url)
        .header("Host", "openspeech.bytedance.com")
        .header("X-Api-App-Key", &config.app_key)
        .header("X-Api-Access-Key", &config.access_key)
        .header("X-Api-Resource-Id", &config.resource_id)
        .header("X-Api-Connect-Id", &connect_id)
        .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
        .header("Sec-WebSocket-Version", "13")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .body(())
        .map_err(|e| format!("构建请求失败: {e}"))?;

    // 连接 WebSocket
    eprintln!("[ASR-Rust] 正在连接 WebSocket...");
    let (ws_stream, _response) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        connect_async(request),
    )
    .await
    .map_err(|_| "WebSocket 连接超时 (10s)".to_string())?
    .map_err(|e| format!("WebSocket 连接失败: {e}"))?;

    eprintln!("[ASR-Rust] WebSocket 已连接");

    let (mut write, mut read) = ws_stream.split();

    // 1. 发送 Full Client Request (配置)
    let request_payload = serde_json::json!({
        "user": { "uid": connect_id },
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": config.language,
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": true,
            "enable_punc": true,
            "show_utterances": true,
        },
    });

    let config_msg = build_request_message(&request_payload);
    write
        .send(tungstenite::Message::Binary(config_msg))
        .await
        .map_err(|e| format!("发送配置失败: {e}"))?;
    eprintln!("[ASR-Rust] 配置请求已发送");

    // 2. 分块发送音频数据（每块 3200 bytes ≈ 100ms @ 16kHz 16bit mono）
    let chunk_size = 3200;
    let chunks: Vec<&[u8]> = audio_data.chunks(chunk_size).collect();
    let total_chunks = chunks.len();

    for (i, chunk) in chunks.iter().enumerate() {
        let is_last = i == total_chunks - 1;
        let audio_msg = build_audio_message(chunk, is_last);
        write
            .send(tungstenite::Message::Binary(audio_msg))
            .await
            .map_err(|e| format!("发送音频块 {}/{} 失败: {e}", i + 1, total_chunks))?;
    }
    eprintln!(
        "[ASR-Rust] 音频已发送: {} 块, {} bytes",
        total_chunks,
        audio_data.len()
    );

    // 3. 等待识别结果
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(tungstenite::Message::Binary(data)) => {
                    match parse_response_message(&data) {
                        Ok(resp) => {
                            // 检查错误码
                            if let Some(code) = resp.code {
                                if code != 20000000 {
                                    return Err(format!(
                                        "API 错误 {}: {}",
                                        code,
                                        resp.message.unwrap_or_default()
                                    ));
                                }
                            }

                            // 检查是否有最终结果（audio_info 表示识别完成）
                            if resp.audio_info.is_some() {
                                let text = resp
                                    .result
                                    .as_ref()
                                    .and_then(|r| r.text.as_deref())
                                    .unwrap_or("")
                                    .to_string();
                                let duration = resp
                                    .audio_info
                                    .as_ref()
                                    .and_then(|a| a.duration);

                                eprintln!("[ASR-Rust] 识别完成: \"{}\"", text);

                                return Ok(AsrResult {
                                    text,
                                    confidence: 1.0,
                                    lang: config.language.clone(),
                                    duration,
                                });
                            }

                            // 中间结果，继续等待
                            if let Some(ref result_payload) = resp.result {
                                if let Some(ref text) = result_payload.text {
                                    eprintln!("[ASR-Rust] 中间结果: \"{}\"", text);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[ASR-Rust] 解析响应失败: {}", e);
                        }
                    }
                }
                Ok(tungstenite::Message::Text(text)) => {
                    // 某些情况下服务器返回纯文本 JSON
                    match serde_json::from_str::<VolcanoResponse>(&text) {
                        Ok(resp) => {
                            if let Some(code) = resp.code {
                                if code != 20000000 {
                                    return Err(format!(
                                        "API 错误 {}: {}",
                                        code,
                                        resp.message.unwrap_or_default()
                                    ));
                                }
                            }
                            if resp.audio_info.is_some() {
                                let text_result = resp
                                    .result
                                    .as_ref()
                                    .and_then(|r| r.text.as_deref())
                                    .unwrap_or("")
                                    .to_string();
                                return Ok(AsrResult {
                                    text: text_result,
                                    confidence: 1.0,
                                    lang: config.language.clone(),
                                    duration: resp.audio_info.as_ref().and_then(|a| a.duration),
                                });
                            }
                        }
                        Err(e) => {
                            eprintln!("[ASR-Rust] 解析文本响应失败: {}", e);
                        }
                    }
                }
                Ok(tungstenite::Message::Close(_)) => {
                    return Err("WebSocket 被服务器关闭".to_string());
                }
                Err(e) => {
                    return Err(format!("WebSocket 读取错误: {e}"));
                }
                _ => {}
            }
        }
        Err("WebSocket 流结束但未收到最终结果".to_string())
    })
    .await
    .map_err(|_| "等待识别结果超时 (30s)".to_string())?;

    // 关闭连接
    let _ = write.close().await;

    result
}

/// 检查火山引擎 ASR 配置是否有效（快速检查，不建立连接）
#[tauri::command]
pub fn volcano_asr_check_config(config: VolcanoAsrConfig) -> Result<bool, String> {
    Ok(!config.app_key.is_empty()
        && !config.access_key.is_empty()
        && !config.resource_id.is_empty())
}
