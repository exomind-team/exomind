//! Volcano ASR (语音识别) Tauri 命令
//!
//! Sync points（关键对齐点）:
//! - use official websocket endpoints（使用官方 websocket endpoint）
//! - gzip request/audio frames（请求和音频都走 gzip 压缩）
//! - wait for async final flag=3（async 模式等待 flags=3 的最终包）

use std::io::{Read, Write};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite};
use tungstenite::http::Request as HttpRequest;

#[derive(Debug, Deserialize, Clone)]
pub struct VolcanoAsrRequestOptions {
    #[serde(default = "default_true")]
    #[serde(alias = "showUtterances")]
    pub show_utterances: bool,
    #[serde(default = "default_true")]
    #[serde(alias = "enableNonstream")]
    pub enable_nonstream: bool,
    #[serde(default = "default_end_window_size")]
    #[serde(alias = "endWindowSize")]
    pub end_window_size: u32,
    #[serde(default = "default_force_to_speech_time")]
    #[serde(alias = "forceToSpeechTime")]
    pub force_to_speech_time: u32,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolcanoAsrConfig {
    pub app_key: String,
    pub access_key: String,
    #[serde(default = "default_resource_id")]
    pub resource_id: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_endpoint")]
    pub endpoint: String,
    #[serde(default)]
    pub request: Option<VolcanoAsrRequestOptions>,
}

#[derive(Debug, Serialize)]
pub struct AsrResult {
    pub text: String,
    pub confidence: f64,
    pub lang: String,
    pub duration: Option<f64>,
}

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

#[derive(Debug)]
struct ParsedVolcanoFrame {
    message_type: u8,
    flags: u8,
    sequence: Option<i32>,
    response: Option<VolcanoResponse>,
}

fn default_true() -> bool {
    true
}

fn default_resource_id() -> String {
    "volc.bigasr.sauc.duration".to_string()
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_endpoint() -> String {
    "bigmodel_async".to_string()
}

fn default_end_window_size() -> u32 {
    800
}

fn default_force_to_speech_time() -> u32 {
    1000
}

fn gzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|error| format!("gzip 写入失败: {error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("gzip 完成失败: {error}"))
}

fn gunzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|error| format!("gunzip 解压失败: {error}"))?;
    Ok(output)
}

fn build_request_message(data: &serde_json::Value) -> Result<Vec<u8>, String> {
    let json_bytes = serde_json::to_vec(data).map_err(|error| format!("JSON 序列化失败: {error}"))?;
    let payload = gzip_bytes(&json_bytes)?;
    let payload_size = (payload.len() as u32).to_be_bytes();
    let header = [0x11, 0x10, 0x11, 0x00];
    let mut msg = Vec::with_capacity(4 + 4 + payload.len());
    msg.extend_from_slice(&header);
    msg.extend_from_slice(&payload_size);
    msg.extend_from_slice(&payload);
    Ok(msg)
}

fn build_audio_message(audio_data: &[u8], is_last: bool) -> Result<Vec<u8>, String> {
    let payload = gzip_bytes(audio_data)?;
    let payload_size = (payload.len() as u32).to_be_bytes();
    let header = [0x11, if is_last { 0x22 } else { 0x20 }, 0x01, 0x00];
    let mut msg = Vec::with_capacity(4 + 4 + payload.len());
    msg.extend_from_slice(&header);
    msg.extend_from_slice(&payload_size);
    msg.extend_from_slice(&payload);
    Ok(msg)
}

fn parse_response_message(data: &[u8]) -> Result<ParsedVolcanoFrame, String> {
    if data.len() < 8 {
        return Err(format!("响应长度过短: {} bytes", data.len()));
    }

    let byte1 = data[1];
    let byte2 = data[2];
    let flags = byte1 & 0x0f;
    let message_type = byte1 >> 4;
    let serialization = byte2 >> 4;
    let compression = byte2 & 0x0f;

    let mut offset = 4usize;
    let sequence = if flags == 0x01 || flags == 0x03 {
        if data.len() < offset + 4 {
            return Err("响应缺少 sequence 字段".to_string());
        }
        let seq = i32::from_be_bytes(data[offset..offset + 4].try_into().unwrap());
        offset += 4;
        Some(seq)
    } else {
        None
    };

    if data.len() < offset + 4 {
        return Err("响应缺少 payload size".to_string());
    }
    let payload_size = u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;
    if data.len() < offset + payload_size {
        return Err("响应 payload 不完整".to_string());
    }

    let payload_slice = &data[offset..offset + payload_size];
    let payload = if compression == 1 {
        gunzip_bytes(payload_slice)?
    } else {
        payload_slice.to_vec()
    };

    let response = if serialization == 1 {
        Some(
            serde_json::from_slice::<VolcanoResponse>(&payload)
                .map_err(|error| format!("响应 JSON 解析失败: {error}"))?,
        )
    } else {
        None
    };

    Ok(ParsedVolcanoFrame {
        message_type,
        flags,
        sequence,
        response,
    })
}

fn is_final_response(endpoint: &str, frame: &ParsedVolcanoFrame) -> bool {
    if frame.message_type == 15 {
        return true;
    }
    if endpoint == "bigmodel_async" {
        return frame.flags == 0x03;
    }
    frame
        .response
        .as_ref()
        .and_then(|resp| resp.audio_info.as_ref())
        .is_some()
}

fn resolve_request_options(config: &VolcanoAsrConfig) -> VolcanoAsrRequestOptions {
    config.request.clone().unwrap_or(VolcanoAsrRequestOptions {
        show_utterances: true,
        enable_nonstream: true,
        end_window_size: default_end_window_size(),
        force_to_speech_time: default_force_to_speech_time(),
    })
}

#[tauri::command]
pub async fn volcano_asr_recognize(
    audio_data: Vec<u8>,
    config: VolcanoAsrConfig,
) -> Result<AsrResult, String> {
    use futures_util::{SinkExt, StreamExt};

    if audio_data.is_empty() {
        return Err("音频数据为空".to_string());
    }

    let endpoint = config.endpoint.trim();
    let endpoint = if endpoint.is_empty() {
        "bigmodel_async"
    } else {
        endpoint
    };
    let ws_url = format!("wss://openspeech.bytedance.com/api/v3/sauc/{endpoint}");
    let connect_id = uuid::Uuid::new_v4().to_string();
    let request_options = resolve_request_options(&config);

    eprintln!("[ASR-Rust] 开始识别: endpoint={endpoint}, audio={} bytes", audio_data.len());
    eprintln!("[ASR-Rust] ResourceId: {}", config.resource_id);

    let request = HttpRequest::builder()
        .uri(&ws_url)
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
        .map_err(|error| format!("构建请求失败: {error}"))?;

    let (ws_stream, _response) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        connect_async(request),
    )
    .await
    .map_err(|_| "WebSocket 连接超时 (10s)".to_string())?
    .map_err(|error| format!("WebSocket 连接失败: {error}"))?;

    let (mut write, mut read) = ws_stream.split();

    let mut audio = serde_json::json!({
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    });
    if endpoint == "bigmodel_nostream" {
        audio["language"] = serde_json::Value::String(config.language.clone());
    }

    let mut request_payload = serde_json::json!({
        "user": { "uid": connect_id },
        "audio": audio,
        "request": {
            "model_name": "bigmodel",
            "enable_itn": true,
            "enable_punc": true,
            "show_utterances": request_options.show_utterances,
        },
    });

    if endpoint == "bigmodel_async" && request_options.enable_nonstream {
        request_payload["request"]["enable_nonstream"] = serde_json::Value::Bool(true);
        request_payload["request"]["end_window_size"] =
            serde_json::Value::Number(request_options.end_window_size.into());
        request_payload["request"]["force_to_speech_time"] =
            serde_json::Value::Number(request_options.force_to_speech_time.into());
    }

    let config_msg = build_request_message(&request_payload)?;
    write
        .send(tungstenite::Message::Binary(config_msg))
        .await
        .map_err(|error| format!("发送配置失败: {error}"))?;

    let chunk_size = 6400usize;
    let total_chunks = audio_data.chunks(chunk_size).len();
    for (index, chunk) in audio_data.chunks(chunk_size).enumerate() {
        let is_last = index == total_chunks.saturating_sub(1);
        let audio_msg = build_audio_message(chunk, is_last)?;
        write
            .send(tungstenite::Message::Binary(audio_msg))
            .await
            .map_err(|error| format!("发送音频块 {}/{} 失败: {error}", index + 1, total_chunks))?;
    }

    let mut latest_text = String::new();
    let mut latest_duration = None;

    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(tungstenite::Message::Binary(data)) => {
                    let frame = parse_response_message(&data)?;
                    if let Some(resp) = frame.response.as_ref() {
                        if let Some(code) = resp.code {
                            if code != 20000000 {
                                return Err(format!(
                                    "API 错误 {}: {}",
                                    code,
                                    resp.message.clone().unwrap_or_default()
                                ));
                            }
                        }
                        if let Some(text) = resp
                            .result
                            .as_ref()
                            .and_then(|result| result.text.as_ref())
                        {
                            latest_text = text.clone();
                        }
                        if let Some(duration) = resp
                            .audio_info
                            .as_ref()
                            .and_then(|audio| audio.duration)
                        {
                            latest_duration = Some(duration);
                        }
                    }

                    eprintln!(
                        "[ASR-Rust] frame type={} flags={} seq={:?} text=\"{}\"",
                        frame.message_type,
                        frame.flags,
                        frame.sequence,
                        latest_text
                    );

                    if is_final_response(endpoint, &frame) {
                        return Ok(AsrResult {
                            text: latest_text.clone(),
                            confidence: 1.0,
                            lang: if endpoint == "bigmodel_nostream" {
                                config.language.clone()
                            } else {
                                "zh-CN".to_string()
                            },
                            duration: latest_duration,
                        });
                    }
                }
                Ok(tungstenite::Message::Close(_)) => {
                    if !latest_text.is_empty() {
                        return Ok(AsrResult {
                            text: latest_text.clone(),
                            confidence: 1.0,
                            lang: if endpoint == "bigmodel_nostream" {
                                config.language.clone()
                            } else {
                                "zh-CN".to_string()
                            },
                            duration: latest_duration,
                        });
                    }
                    return Err("WebSocket 被服务器关闭".to_string());
                }
                Ok(tungstenite::Message::Text(text)) => {
                    if let Ok(resp) = serde_json::from_str::<VolcanoResponse>(&text) {
                        if let Some(code) = resp.code {
                            if code != 20000000 {
                                return Err(format!(
                                    "API 错误 {}: {}",
                                    code,
                                    resp.message.unwrap_or_default()
                                ));
                            }
                        }
                    }
                }
                Err(error) => {
                    return Err(format!("WebSocket 读取错误: {error}"));
                }
                _ => {}
            }
        }
        Err("WebSocket 流结束但未收到最终结果".to_string())
    })
    .await
    .map_err(|_| "等待识别结果超时 (30s)".to_string())??;

    let _ = write.close().await;
    Ok(result)
}

#[tauri::command]
pub fn volcano_asr_check_config(config: VolcanoAsrConfig) -> Result<bool, String> {
    Ok(!config.app_key.is_empty()
        && !config.access_key.is_empty()
        && !config.resource_id.is_empty())
}
