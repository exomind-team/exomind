//! Doubao Realtime S2S（豆包端到端实时语音）Tauri 命令

use std::{collections::HashMap, io::Read, sync::Arc, time::Duration};

use flate2::read::GzDecoder;
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tungstenite::handshake::client::generate_key;
use tungstenite::{http::Request as HttpRequest, Message};
use url::Url;

const DOUBAO_REALTIME_EVENT_NAME: &str = "doubao-realtime-event";
const DOUBAO_REALTIME_DEFAULT_MODEL_VERSION: &str = "1.2.1.1";
const DOUBAO_REALTIME_DEFAULT_WEBSOCKET_URL: &str =
    "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
const DOUBAO_REALTIME_RESOURCE_ID: &str = "volc.speech.dialog";
const DOUBAO_REALTIME_APP_KEY: &str = "PlgvMymc7f3tQnJ6";
const DOUBAO_REALTIME_DEFAULT_SPEAKER: &str = "zh_female_vv_jupiter_bigtts";
const DOUBAO_REALTIME_DEFAULT_INPUT_MODE: &str = "push_to_talk";
const DOUBAO_REALTIME_DEFAULT_TTS_AUDIO_FORMAT: &str = "pcm_s16le";
const DOUBAO_REALTIME_DEFAULT_TTS_SAMPLE_RATE: u32 = 24000;
const DOUBAO_REALTIME_CONNECT_TIMEOUT_SECS: u64 = 10;
const DOUBAO_REALTIME_ALLOWED_WS_HOSTS: [&str; 1] = ["openspeech.bytedance.com"];
const DOUBAO_REALTIME_ALLOWED_WS_PATH: &str = "/api/v3/realtime/dialogue";

const EVENT_START_CONNECTION: u32 = 1;
const EVENT_FINISH_CONNECTION: u32 = 2;
const EVENT_START_SESSION: u32 = 100;
const EVENT_FINISH_SESSION: u32 = 102;
const EVENT_TASK_REQUEST: u32 = 200;
const EVENT_END_ASR: u32 = 400;

const EVENT_CONNECTION_STARTED: u32 = 50;
const EVENT_CONNECTION_FAILED: u32 = 51;
const EVENT_CONNECTION_FINISHED: u32 = 52;
const EVENT_SESSION_STARTED: u32 = 150;
const EVENT_SESSION_FINISHED: u32 = 152;
const EVENT_SESSION_FAILED: u32 = 153;
const EVENT_USAGE_RESPONSE: u32 = 154;
const EVENT_CONFIG_UPDATED: u32 = 251;
const EVENT_TTS_SENTENCE_START: u32 = 350;
const EVENT_TTS_SENTENCE_END: u32 = 351;
const EVENT_TTS_RESPONSE: u32 = 352;
const EVENT_TTS_ENDED: u32 = 359;
const EVENT_ASR_INFO: u32 = 450;
const EVENT_ASR_RESPONSE: u32 = 451;
const EVENT_ASR_ENDED: u32 = 459;
const EVENT_CHAT_RESPONSE: u32 = 550;
const EVENT_CHAT_TEXT_QUERY_CONFIRMED: u32 = 553;
const EVENT_CHAT_ENDED: u32 = 559;
const EVENT_CONVERSATION_CREATED: u32 = 567;
const EVENT_CONVERSATION_UPDATED: u32 = 568;
const EVENT_DIALOG_COMMON_ERROR: u32 = 599;

type DoubaoWsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type DoubaoWriteHalf = SplitSink<DoubaoWsStream, Message>;
type DoubaoReadHalf = SplitStream<DoubaoWsStream>;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoRealtimeConfig {
    pub provider: String,
    #[serde(default = "default_model_version")]
    pub model_version: String,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub app_id: Option<String>,
    pub access_token: Option<String>,
    pub secret_key: Option<String>,
    pub websocket_url: Option<String>,
    pub connect_id: Option<String>,
    pub speaker: Option<String>,
    pub input_mode: Option<String>,
    pub tts_audio_format: Option<String>,
    pub tts_sample_rate: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoRealtimeEventPayload {
    pub session_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}

#[derive(Debug)]
struct ParsedRealtimeFrame {
    message_type: u8,
    _flags: u8,
    _serialization: u8,
    _compression: u8,
    event_id: Option<u32>,
    session_id: Option<String>,
    payload_bytes: Vec<u8>,
    payload_json: Option<serde_json::Value>,
    error_code: Option<u32>,
}

enum DoubaoRealtimeCommand {
    Push {
        audio_data: Vec<u8>,
        ack_tx: oneshot::Sender<Result<(), String>>,
    },
    Finish {
        audio_data: Vec<u8>,
        ack_tx: oneshot::Sender<Result<(), String>>,
    },
    Cancel,
}

struct DoubaoRealtimeSession {
    command_tx: mpsc::UnboundedSender<DoubaoRealtimeCommand>,
}

/// Doubao Realtime 会话状态（session state，会话状态）
pub struct DoubaoRealtimeSessionState {
    sessions: Mutex<HashMap<String, Arc<DoubaoRealtimeSession>>>,
}

impl Default for DoubaoRealtimeSessionState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl DoubaoRealtimeSessionState {
    async fn insert_session(&self, session_id: String, session: Arc<DoubaoRealtimeSession>) {
        self.sessions.lock().await.insert(session_id, session);
    }

    async fn get_session(&self, session_id: &str) -> Option<Arc<DoubaoRealtimeSession>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    async fn remove_session(&self, session_id: &str) -> Option<Arc<DoubaoRealtimeSession>> {
        self.sessions.lock().await.remove(session_id)
    }
}

fn default_model_version() -> String {
    DOUBAO_REALTIME_DEFAULT_MODEL_VERSION.to_string()
}

fn now_iso_string() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn trim_to_option(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn resolve_model_version(config: &DoubaoRealtimeConfig) -> String {
    trim_to_option(Some(config.model_version.as_str()))
        .unwrap_or_else(|| DOUBAO_REALTIME_DEFAULT_MODEL_VERSION.to_string())
}

fn resolve_sample_rate(config: &DoubaoRealtimeConfig) -> u32 {
    if config.sample_rate == 0 {
        16000
    } else {
        config.sample_rate
    }
}

fn resolve_app_id(config: &DoubaoRealtimeConfig) -> Result<String, String> {
    trim_to_option(config.app_id.as_deref())
        .ok_or_else(|| "Doubao Realtime APP ID 不能为空（APP ID is required）".to_string())
}

fn resolve_access_token(config: &DoubaoRealtimeConfig) -> Result<String, String> {
    trim_to_option(config.access_token.as_deref()).ok_or_else(|| {
        "Doubao Realtime Access Token 不能为空（Access Token is required）".to_string()
    })
}

fn resolve_connect_id(config: &DoubaoRealtimeConfig) -> Option<String> {
    trim_to_option(config.connect_id.as_deref())
}

fn resolve_websocket_url(config: &DoubaoRealtimeConfig) -> String {
    trim_to_option(config.websocket_url.as_deref())
        .unwrap_or_else(|| DOUBAO_REALTIME_DEFAULT_WEBSOCKET_URL.to_string())
}

fn resolve_input_mode(config: &DoubaoRealtimeConfig) -> String {
    trim_to_option(config.input_mode.as_deref())
        .unwrap_or_else(|| DOUBAO_REALTIME_DEFAULT_INPUT_MODE.to_string())
}

fn resolve_speaker(config: &DoubaoRealtimeConfig) -> String {
    trim_to_option(config.speaker.as_deref())
        .unwrap_or_else(|| DOUBAO_REALTIME_DEFAULT_SPEAKER.to_string())
}

fn resolve_tts_audio_format(config: &DoubaoRealtimeConfig) -> String {
    trim_to_option(config.tts_audio_format.as_deref())
        .unwrap_or_else(|| DOUBAO_REALTIME_DEFAULT_TTS_AUDIO_FORMAT.to_string())
}

fn resolve_tts_sample_rate(config: &DoubaoRealtimeConfig) -> u32 {
    config
        .tts_sample_rate
        .filter(|value| *value > 0)
        .unwrap_or(DOUBAO_REALTIME_DEFAULT_TTS_SAMPLE_RATE)
}

fn build_realtime_ws_request(
    base_url: &str,
    app_id: &str,
    access_token: &str,
    connect_id: Option<&str>,
) -> Result<tungstenite::http::Request<()>, String> {
    let url = Url::parse(base_url.trim())
        .map_err(|error| format!("Doubao Realtime WebSocket 地址无效: {error}"))?;
    if url.scheme() != "wss" {
        return Err(format!(
            "Doubao Realtime 仅允许 wss 协议（only wss is allowed）: {}",
            url.scheme()
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Doubao Realtime WebSocket 地址缺少 host".to_string())?;
    if !DOUBAO_REALTIME_ALLOWED_WS_HOSTS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
    {
        return Err(format!(
            "Doubao Realtime WebSocket host 不在白名单内（host not allowed）: {host}"
        ));
    }
    if url.path() != DOUBAO_REALTIME_ALLOWED_WS_PATH {
        return Err(format!(
            "Doubao Realtime WebSocket path 非法（path not allowed）: {}",
            url.path()
        ));
    }
    if url.port().is_some() {
        return Err(
            "Doubao Realtime WebSocket 不允许自定义端口（custom port is not allowed）".to_string(),
        );
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Doubao Realtime WebSocket 不允许携带用户信息（userinfo is not allowed）".to_string(),
        );
    }

    let mut builder = HttpRequest::builder()
        .method("GET")
        .uri(url.as_str())
        .header("Host", host)
        .header("X-Api-App-ID", app_id.trim())
        .header("X-Api-Access-Key", access_token.trim())
        .header("X-Api-Resource-Id", DOUBAO_REALTIME_RESOURCE_ID)
        .header("X-Api-App-Key", DOUBAO_REALTIME_APP_KEY)
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Version", "13")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket");

    if let Some(connect_id) = trim_to_option(connect_id) {
        builder = builder.header("X-Api-Connect-Id", connect_id);
    }

    builder
        .body(())
        .map_err(|error| format!("Doubao Realtime 握手请求构造失败: {error}"))
}

fn gunzip_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|error| format!("gunzip 解压失败: {error}"))?;
    Ok(output)
}

fn format_hex_prefix(bytes: &[u8], limit: usize) -> String {
    bytes
        .iter()
        .take(limit)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_utf8_payload(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec())
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn event_name_from_id(event_id: u32) -> Option<&'static str> {
    match event_id {
        EVENT_CONNECTION_STARTED => Some("ConnectionStarted"),
        EVENT_CONNECTION_FAILED => Some("ConnectionFailed"),
        EVENT_CONNECTION_FINISHED => Some("ConnectionFinished"),
        EVENT_SESSION_STARTED => Some("SessionStarted"),
        EVENT_SESSION_FINISHED => Some("SessionFinished"),
        EVENT_SESSION_FAILED => Some("SessionFailed"),
        EVENT_USAGE_RESPONSE => Some("UsageResponse"),
        EVENT_CONFIG_UPDATED => Some("ConfigUpdated"),
        EVENT_TTS_SENTENCE_START => Some("TTSSentenceStart"),
        EVENT_TTS_SENTENCE_END => Some("TTSSentenceEnd"),
        EVENT_TTS_RESPONSE => Some("TTSResponse"),
        EVENT_TTS_ENDED => Some("TTSEnded"),
        EVENT_ASR_INFO => Some("ASRInfo"),
        EVENT_ASR_RESPONSE => Some("ASRResponse"),
        EVENT_ASR_ENDED => Some("ASREnded"),
        EVENT_CHAT_RESPONSE => Some("ChatResponse"),
        EVENT_CHAT_TEXT_QUERY_CONFIRMED => Some("ChatTextQueryConfirmed"),
        EVENT_CHAT_ENDED => Some("ChatEnded"),
        EVENT_CONVERSATION_CREATED => Some("ConversationCreated"),
        EVENT_CONVERSATION_UPDATED => Some("ConversationUpdated"),
        EVENT_DIALOG_COMMON_ERROR => Some("DialogCommonError"),
        _ => None,
    }
}

fn is_session_event(event_id: u32) -> bool {
    event_id >= 100
}

fn is_sequence_present(flags: u8) -> bool {
    matches!(flags & 0b0011, 0b0001 | 0b0011)
}

fn build_full_client_event(
    event_id: u32,
    payload: &serde_json::Value,
    session_id: Option<&str>,
) -> Result<Vec<u8>, String> {
    let payload_bytes = serde_json::to_vec(payload)
        .map_err(|error| format!("Doubao Realtime JSON 序列化失败: {error}"))?;
    let mut frame = Vec::new();
    frame.extend_from_slice(&[0x11, 0x14, 0x10, 0x00]);
    frame.extend_from_slice(&event_id.to_be_bytes());
    if let Some(session_id) = session_id {
        frame.extend_from_slice(&(session_id.len() as u32).to_be_bytes());
        frame.extend_from_slice(session_id.as_bytes());
    }
    frame.extend_from_slice(&(payload_bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload_bytes);
    Ok(frame)
}

fn build_audio_client_event(
    event_id: u32,
    session_id: &str,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    if payload.is_empty() {
        return Err("音频数据为空，无法构造 TaskRequest".to_string());
    }

    let mut frame = Vec::new();
    frame.extend_from_slice(&[0x11, 0x24, 0x00, 0x00]);
    frame.extend_from_slice(&event_id.to_be_bytes());
    frame.extend_from_slice(&(session_id.len() as u32).to_be_bytes());
    frame.extend_from_slice(session_id.as_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

fn build_start_session_payload(config: &DoubaoRealtimeConfig) -> serde_json::Value {
    json!({
        "asr": {
            "audio_info": {
                "format": "pcm",
                "sample_rate": resolve_sample_rate(config),
                "channel": 1,
            }
        },
        "tts": {
            "speaker": resolve_speaker(config),
            "audio_config": {
                "channel": 1,
                "format": resolve_tts_audio_format(config),
                "sample_rate": resolve_tts_sample_rate(config),
            }
        },
        "dialog": {
            "bot_name": "豆包",
            "dialog_id": "",
            "extra": {
                "model": resolve_model_version(config),
                "input_mod": resolve_input_mode(config),
            }
        }
    })
}

fn build_start_connection_event() -> Result<Vec<u8>, String> {
    build_full_client_event(EVENT_START_CONNECTION, &json!({}), None)
}

fn build_finish_connection_event() -> Result<Vec<u8>, String> {
    build_full_client_event(EVENT_FINISH_CONNECTION, &json!({}), None)
}

fn build_start_session_event(
    config: &DoubaoRealtimeConfig,
    session_id: &str,
) -> Result<Vec<u8>, String> {
    build_full_client_event(
        EVENT_START_SESSION,
        &build_start_session_payload(config),
        Some(session_id),
    )
}

fn build_finish_session_event(session_id: &str) -> Result<Vec<u8>, String> {
    build_full_client_event(EVENT_FINISH_SESSION, &json!({}), Some(session_id))
}

fn build_end_asr_event(session_id: &str) -> Result<Vec<u8>, String> {
    build_full_client_event(EVENT_END_ASR, &json!({}), Some(session_id))
}

fn build_audio_task_request(session_id: &str, audio_data: &[u8]) -> Result<Vec<u8>, String> {
    build_audio_client_event(EVENT_TASK_REQUEST, session_id, audio_data)
}

fn parse_realtime_frame(data: &[u8]) -> Result<ParsedRealtimeFrame, String> {
    if data.len() < 8 {
        return Err(format!("响应长度过短: {} bytes", data.len()));
    }

    let flags = data[1] & 0x0f;
    let message_type = data[1] >> 4;
    let serialization = data[2] >> 4;
    let compression = data[2] & 0x0f;
    let mut offset = 4usize;
    let mut event_id = None;
    let mut session_id = None;
    let mut error_code = None;

    if message_type == 0b1111 {
        if data.len() < offset + 4 {
            return Err("错误帧缺少 error code".to_string());
        }
        error_code = Some(u32::from_be_bytes(
            data[offset..offset + 4].try_into().unwrap(),
        ));
        offset += 4;
    } else {
        if is_sequence_present(flags) {
            if data.len() < offset + 4 {
                return Err("响应缺少 sequence 字段".to_string());
            }
            offset += 4;
        }

        if flags & 0b0100 != 0 {
            if data.len() < offset + 4 {
                return Err("响应缺少 event id".to_string());
            }
            event_id = Some(u32::from_be_bytes(
                data[offset..offset + 4].try_into().unwrap(),
            ));
            offset += 4;
        }

        if let Some(event_id_value) = event_id {
            if is_session_event(event_id_value) {
                if data.len() < offset + 4 {
                    return Err("响应缺少 session id size".to_string());
                }
                let session_id_size =
                    u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
                offset += 4;
                if data.len() < offset + session_id_size {
                    return Err("响应 session id 数据不完整".to_string());
                }
                session_id = Some(
                    String::from_utf8(data[offset..offset + session_id_size].to_vec())
                        .map_err(|error| format!("session id 不是合法 UTF-8: {error}"))?,
                );
                offset += session_id_size;
            }
        }
    }

    if data.len() < offset + 4 {
        return Err("响应缺少 payload size".to_string());
    }
    let payload_size = u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;
    if data.len() < offset + payload_size {
        return Err("响应 payload 不完整".to_string());
    }

    let payload_slice = &data[offset..offset + payload_size];
    let payload_bytes = match compression {
        0 => payload_slice.to_vec(),
        1 => gunzip_bytes(payload_slice)?,
        other => return Err(format!("暂不支持的压缩方式: {other}")),
    };

    let payload_json = match serialization {
        0 => None,
        1 => serde_json::from_slice::<serde_json::Value>(&payload_bytes).ok(),
        other => return Err(format!("暂不支持的序列化方式: {other}")),
    };

    Ok(ParsedRealtimeFrame {
        message_type,
        _flags: flags,
        _serialization: serialization,
        _compression: compression,
        event_id,
        session_id,
        payload_bytes,
        payload_json,
        error_code,
    })
}

fn build_error_event_payload(
    session_id: &str,
    default_model: &str,
    message: impl Into<String>,
) -> DoubaoRealtimeEventPayload {
    DoubaoRealtimeEventPayload {
        session_id: session_id.to_string(),
        event_type: "error".to_string(),
        model: Some(default_model.to_string()),
        payload: Some(json!({
            "message": message.into(),
        })),
        audio_data: None,
        audio_format: None,
        sample_rate: None,
        captured_at: Some(now_iso_string()),
    }
}

fn map_server_frame_to_event_payload(
    frame: &[u8],
    default_model: &str,
) -> Result<Option<DoubaoRealtimeEventPayload>, String> {
    let parsed = parse_realtime_frame(frame)?;

    if parsed.message_type == 0b1111 {
        let message = parsed
            .payload_json
            .as_ref()
            .and_then(|value| value.get("error"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| "Doubao Realtime 返回错误帧".to_string());
        return Ok(Some(DoubaoRealtimeEventPayload {
            session_id: parsed.session_id.unwrap_or_default(),
            event_type: "error".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(json!({
                "message": message,
                "code": parsed.error_code,
            })),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        }));
    }

    let Some(event_id) = parsed.event_id else {
        return Ok(None);
    };

    let event_type = event_name_from_id(event_id)
        .map(str::to_string)
        .unwrap_or_else(|| format!("UnknownEvent:{event_id}"));

    if parsed.message_type == 0b1011 {
        return Ok(Some(DoubaoRealtimeEventPayload {
            session_id: parsed.session_id.unwrap_or_default(),
            event_type,
            model: Some(default_model.to_string()),
            payload: Some(json!({
                "byteLength": parsed.payload_bytes.len(),
                "audioFormat": DOUBAO_REALTIME_DEFAULT_TTS_AUDIO_FORMAT,
                "sampleRate": DOUBAO_REALTIME_DEFAULT_TTS_SAMPLE_RATE,
            })),
            audio_data: Some(parsed.payload_bytes),
            audio_format: Some(DOUBAO_REALTIME_DEFAULT_TTS_AUDIO_FORMAT.to_string()),
            sample_rate: Some(DOUBAO_REALTIME_DEFAULT_TTS_SAMPLE_RATE),
            captured_at: Some(now_iso_string()),
        }));
    }

    if event_id == EVENT_CONNECTION_STARTED || event_id == EVENT_CONNECTION_FINISHED {
        let payload = decode_utf8_payload(&parsed.payload_bytes)
            .map(|connect_id| json!({ "connect_id": connect_id }))
            .unwrap_or_else(|| json!({}));
        return Ok(Some(DoubaoRealtimeEventPayload {
            session_id: parsed.session_id.unwrap_or_default(),
            event_type,
            model: Some(default_model.to_string()),
            payload: Some(payload),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        }));
    }

    let payload = if let Some(payload_json) = parsed.payload_json {
        payload_json
    } else if parsed.payload_bytes.is_empty() {
        json!({})
    } else if let Some(text) = decode_utf8_payload(&parsed.payload_bytes) {
        json!({ "text": text })
    } else {
        return Err(format!(
            "响应 JSON 解析失败: expected JSON payload for event {event_id}; header_prefix={}; payload_prefix={}",
            format_hex_prefix(frame, 12),
            format_hex_prefix(&parsed.payload_bytes, 24),
        ));
    };

    Ok(Some(DoubaoRealtimeEventPayload {
        session_id: parsed.session_id.unwrap_or_default(),
        event_type,
        model: Some(default_model.to_string()),
        payload: Some(payload),
        audio_data: None,
        audio_format: None,
        sample_rate: None,
        captured_at: Some(now_iso_string()),
    }))
}

async fn emit_realtime_event(app: &AppHandle, payload: DoubaoRealtimeEventPayload) {
    app.emit(DOUBAO_REALTIME_EVENT_NAME, payload).ok();
}

async fn send_binary_frame(write: &mut DoubaoWriteHalf, frame: Vec<u8>) -> Result<(), String> {
    write
        .send(Message::Binary(frame.into()))
        .await
        .map_err(|error| format!("Doubao Realtime 二进制帧发送失败: {error}"))
}

async fn connect_realtime_ws(config: &DoubaoRealtimeConfig) -> Result<DoubaoWsStream, String> {
    let connect_id = resolve_connect_id(config);
    let request = build_realtime_ws_request(
        &resolve_websocket_url(config),
        &resolve_app_id(config)?,
        &resolve_access_token(config)?,
        connect_id.as_deref(),
    )?;

    let (ws_stream, _response) = tokio::time::timeout(
        Duration::from_secs(DOUBAO_REALTIME_CONNECT_TIMEOUT_SECS),
        connect_async(request),
    )
    .await
    .map_err(|_| {
        format!(
            "Doubao Realtime WebSocket 连接超时 ({}s)",
            DOUBAO_REALTIME_CONNECT_TIMEOUT_SECS
        )
    })?
    .map_err(|error| format!("Doubao Realtime WebSocket 连接失败: {error}"))?;

    Ok(ws_stream)
}

async fn finalize_session(write: &mut DoubaoWriteHalf, session_id: &str) -> Result<(), String> {
    send_binary_frame(write, build_finish_session_event(session_id)?).await?;
    send_binary_frame(write, build_finish_connection_event()?).await
}

async fn run_doubao_realtime_session(
    app: AppHandle,
    state: Arc<DoubaoRealtimeSessionState>,
    session_id: String,
    default_model: String,
    mut write: DoubaoWriteHalf,
    mut read: DoubaoReadHalf,
    mut command_rx: mpsc::UnboundedReceiver<DoubaoRealtimeCommand>,
) {
    let mut input_finished = false;
    let mut closing_requested = false;

    let outcome: Result<(), String> = loop {
        tokio::select! {
            maybe_command = command_rx.recv() => {
                match maybe_command {
                    Some(DoubaoRealtimeCommand::Push { audio_data, ack_tx }) => {
                        if audio_data.is_empty() {
                            let _ = ack_tx.send(Ok(()));
                            continue;
                        }
                        let send_result: Result<(), String> = async {
                            send_binary_frame(
                                &mut write,
                                build_audio_task_request(&session_id, &audio_data)?,
                            ).await
                        }.await;
                        match send_result {
                            Ok(()) => {
                                let _ = ack_tx.send(Ok(()));
                            }
                            Err(error) => {
                                let _ = ack_tx.send(Err(error.clone()));
                                break Err(error);
                            }
                        }
                    }
                    Some(DoubaoRealtimeCommand::Finish { audio_data, ack_tx }) => {
                        if input_finished {
                            let error = "Doubao Realtime finish 已经发送，不能重复提交".to_string();
                            let _ = ack_tx.send(Err(error));
                            continue;
                        }
                        input_finished = true;
                        let send_result: Result<(), String> = async {
                            if !audio_data.is_empty() {
                                send_binary_frame(
                                    &mut write,
                                    build_audio_task_request(&session_id, &audio_data)?,
                                ).await?;
                            }
                            send_binary_frame(&mut write, build_end_asr_event(&session_id)?).await
                        }.await;
                        match send_result {
                            Ok(()) => {
                                let _ = ack_tx.send(Ok(()));
                            }
                            Err(error) => {
                                let _ = ack_tx.send(Err(error.clone()));
                                break Err(error);
                            }
                        }
                    }
                    Some(DoubaoRealtimeCommand::Cancel) => {
                        let _ = finalize_session(&mut write, &session_id).await;
                        break Ok(());
                    }
                    None => {
                        break Ok(());
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Binary(binary))) => {
                        match map_server_frame_to_event_payload(&binary, &default_model) {
                            Ok(Some(payload)) => {
                                let event_type = payload.event_type.clone();
                                emit_realtime_event(&app, payload).await;

                                if event_type == "TTSEnded" && input_finished && !closing_requested {
                                    if let Err(error) = finalize_session(&mut write, &session_id).await {
                                        break Err(error);
                                    }
                                    closing_requested = true;
                                    continue;
                                }

                                if matches!(event_type.as_str(), "SessionFinished" | "ConnectionFinished") && closing_requested {
                                    break Ok(());
                                }

                                if matches!(event_type.as_str(), "SessionFailed" | "ConnectionFailed" | "DialogCommonError" | "error") {
                                    break Err(format!("Doubao Realtime 会话失败: {event_type}"));
                                }
                            }
                            Ok(None) => {}
                            Err(error) => {
                                emit_realtime_event(
                                    &app,
                                    build_error_event_payload(&session_id, &default_model, &error),
                                ).await;
                                break Err(error);
                            }
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        emit_realtime_event(
                            &app,
                            build_error_event_payload(
                                &session_id,
                                &default_model,
                                format!("收到非预期文本消息: {text}"),
                            ),
                        ).await;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            break Err(format!("Doubao Realtime Pong 发送失败: {error}"));
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) => {
                        if closing_requested || input_finished {
                            break Ok(());
                        }
                        break Err("Doubao Realtime 会话被服务端提前关闭".to_string());
                    }
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => {
                        break Err(format!("Doubao Realtime WebSocket 读取失败: {error}"));
                    }
                    None => {
                        if closing_requested || input_finished {
                            break Ok(());
                        }
                        break Err("Doubao Realtime WebSocket 已结束".to_string());
                    }
                }
            }
        }
    };

    let _ = write.close().await;
    state.remove_session(&session_id).await;

    if let Err(error) = outcome {
        emit_realtime_event(
            &app,
            build_error_event_payload(&session_id, &default_model, error),
        )
        .await;
    }
}

#[tauri::command]
pub async fn doubao_realtime_session_start(
    app: AppHandle,
    config: DoubaoRealtimeConfig,
    state: State<'_, Arc<DoubaoRealtimeSessionState>>,
) -> Result<String, String> {
    let ws_stream = connect_realtime_ws(&config).await?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let default_model = resolve_model_version(&config);
    let (mut write, read) = ws_stream.split();

    send_binary_frame(&mut write, build_start_connection_event()?).await?;
    send_binary_frame(&mut write, build_start_session_event(&config, &session_id)?).await?;

    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let session = Arc::new(DoubaoRealtimeSession { command_tx });
    let shared_state = Arc::clone(state.inner());
    shared_state
        .insert_session(session_id.clone(), Arc::clone(&session))
        .await;

    tauri::async_runtime::spawn(run_doubao_realtime_session(
        app,
        Arc::clone(&shared_state),
        session_id.clone(),
        default_model,
        write,
        read,
        command_rx,
    ));

    Ok(session_id)
}

#[tauri::command]
pub async fn doubao_realtime_session_push(
    session_id: String,
    audio_data: Vec<u8>,
    state: State<'_, Arc<DoubaoRealtimeSessionState>>,
) -> Result<(), String> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Doubao Realtime 会话不存在: {session_id}"))?;
    let (ack_tx, ack_rx) = oneshot::channel();
    session
        .command_tx
        .send(DoubaoRealtimeCommand::Push { audio_data, ack_tx })
        .map_err(|_| format!("Doubao Realtime 会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("Doubao Realtime push 确认通道已关闭: {session_id}"))?
}

#[tauri::command]
pub async fn doubao_realtime_session_finish(
    session_id: String,
    audio_data: Vec<u8>,
    state: State<'_, Arc<DoubaoRealtimeSessionState>>,
) -> Result<(), String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Doubao Realtime 会话不存在: {session_id}"))?;
    let (ack_tx, ack_rx) = oneshot::channel();
    session
        .command_tx
        .send(DoubaoRealtimeCommand::Finish { audio_data, ack_tx })
        .map_err(|_| format!("Doubao Realtime 会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("Doubao Realtime finish 确认通道已关闭: {session_id}"))?
}

#[tauri::command]
pub async fn doubao_realtime_session_cancel(
    session_id: String,
    state: State<'_, Arc<DoubaoRealtimeSessionState>>,
) -> Result<(), String> {
    let Some(session) = state.remove_session(&session_id).await else {
        return Ok(());
    };

    let _ = session.command_tx.send(DoubaoRealtimeCommand::Cancel);
    Ok(())
}

#[cfg(test)]
fn build_server_json_frame(
    event_id: u32,
    session_id: Option<&str>,
    payload: serde_json::Value,
) -> Result<Vec<u8>, String> {
    let payload_bytes =
        serde_json::to_vec(&payload).map_err(|error| format!("test frame json failed: {error}"))?;
    let mut frame = vec![0x11, 0x94, 0x10, 0x00];
    frame.extend_from_slice(&event_id.to_be_bytes());
    if let Some(session_id) = session_id {
        frame.extend_from_slice(&(session_id.len() as u32).to_be_bytes());
        frame.extend_from_slice(session_id.as_bytes());
    }
    frame.extend_from_slice(&(payload_bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload_bytes);
    Ok(frame)
}

#[cfg(test)]
fn build_server_utf8_frame(
    event_id: u32,
    session_id: Option<&str>,
    payload: &str,
) -> Result<Vec<u8>, String> {
    let payload_bytes = payload.as_bytes();
    let mut frame = vec![0x11, 0x94, 0x10, 0x00];
    frame.extend_from_slice(&event_id.to_be_bytes());
    if let Some(session_id) = session_id {
        frame.extend_from_slice(&(session_id.len() as u32).to_be_bytes());
        frame.extend_from_slice(session_id.as_bytes());
    }
    frame.extend_from_slice(&(payload_bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload_bytes);
    Ok(frame)
}

#[cfg(test)]
fn build_server_audio_frame(
    event_id: u32,
    session_id: Option<&str>,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    let mut frame = vec![0x11, 0xB4, 0x00, 0x00];
    frame.extend_from_slice(&event_id.to_be_bytes());
    if let Some(session_id) = session_id {
        frame.extend_from_slice(&(session_id.len() as u32).to_be_bytes());
        frame.extend_from_slice(session_id.as_bytes());
    }
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, path::PathBuf, time::Instant};
    use tokio::time::sleep;

    fn read_online_smoke_env(keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| env::var(key).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn require_online_smoke_env(keys: &[&str]) -> String {
        read_online_smoke_env(keys).unwrap_or_else(|| {
            panic!(
                "missing online smoke env, expected one of: {}",
                keys.join(", ")
            )
        })
    }

    fn resolve_online_smoke_fixture_path() -> PathBuf {
        let fixture = read_online_smoke_env(&[
            "EXOMIND_VOICE_RUNTIME_SMOKE_FIXTURE",
            "DOUBAO_REALTIME_SMOKE_FIXTURE",
        ])
        .unwrap_or_else(|| "tests/fixtures/voice-runtime/codex-smoke-short.pcm".to_string());
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root should exist（项目根目录应存在）")
            .to_path_buf();
        project_root.join(fixture)
    }

    async fn stream_online_smoke_audio(
        write: &mut DoubaoWriteHalf,
        session_id: &str,
        audio_bytes: &[u8],
    ) -> Result<(), String> {
        for chunk in audio_bytes.chunks(3200) {
            send_binary_frame(write, build_audio_task_request(session_id, chunk)?).await?;
            sleep(Duration::from_millis(20)).await;
        }
        send_binary_frame(write, build_end_asr_event(session_id)?).await
    }

    #[test]
    fn doubao_realtime_request_includes_s2s_headers() {
        let request = build_realtime_ws_request(
            "wss://openspeech.bytedance.com/api/v3/realtime/dialogue",
            "4587429383",
            "vei-access-token",
            Some("connect-1"),
        )
        .expect("request should build（握手请求应能构造）");

        assert_eq!(
            request.uri().to_string(),
            "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"
        );
        assert_eq!(
            request
                .headers()
                .get("X-Api-App-ID")
                .and_then(|value| value.to_str().ok()),
            Some("4587429383")
        );
        assert_eq!(
            request
                .headers()
                .get("X-Api-Access-Key")
                .and_then(|value| value.to_str().ok()),
            Some("vei-access-token")
        );
        assert_eq!(
            request
                .headers()
                .get("X-Api-Resource-Id")
                .and_then(|value| value.to_str().ok()),
            Some("volc.speech.dialog")
        );
        assert_eq!(
            request
                .headers()
                .get("X-Api-App-Key")
                .and_then(|value| value.to_str().ok()),
            Some("PlgvMymc7f3tQnJ6")
        );
        assert_eq!(
            request
                .headers()
                .get("X-Api-Connect-Id")
                .and_then(|value| value.to_str().ok()),
            Some("connect-1")
        );
        assert_eq!(
            request
                .headers()
                .get("Connection")
                .and_then(|value| value.to_str().ok()),
            Some("Upgrade")
        );
        assert_eq!(
            request
                .headers()
                .get("Upgrade")
                .and_then(|value| value.to_str().ok()),
            Some("websocket")
        );
        assert_eq!(
            request
                .headers()
                .get("Sec-WebSocket-Version")
                .and_then(|value| value.to_str().ok()),
            Some("13")
        );
        assert!(
            request
                .headers()
                .get("Sec-WebSocket-Key")
                .and_then(|value| value.to_str().ok())
                .is_some(),
            "Sec-WebSocket-Key should be present（应带有标准 WS 握手 key）"
        );
    }

    #[test]
    fn doubao_realtime_request_rejects_non_wss_scheme() {
        let error = build_realtime_ws_request(
            "ws://openspeech.bytedance.com/api/v3/realtime/dialogue",
            "4587429383",
            "vei-access-token",
            None,
        )
        .expect_err("non-wss scheme should be rejected（非 wss 协议应被拒绝）");

        assert!(
            error.contains("仅允许 wss 协议"),
            "error should mention wss restriction（错误信息应包含 wss 限制）: {error}"
        );
    }

    #[test]
    fn doubao_realtime_request_rejects_non_whitelisted_host() {
        let error = build_realtime_ws_request(
            "wss://example.com/api/v3/realtime/dialogue",
            "4587429383",
            "vei-access-token",
            None,
        )
        .expect_err("non-whitelisted host should be rejected（非白名单 host 应被拒绝）");

        assert!(
            error.contains("host 不在白名单"),
            "error should mention host whitelist（错误信息应包含 host 白名单）: {error}"
        );
    }

    #[test]
    fn doubao_realtime_request_rejects_non_whitelisted_path() {
        let error = build_realtime_ws_request(
            "wss://openspeech.bytedance.com/api/v3/realtime/other",
            "4587429383",
            "vei-access-token",
            None,
        )
        .expect_err("non-whitelisted path should be rejected（非白名单 path 应被拒绝）");

        assert!(
            error.contains("path 非法"),
            "error should mention path whitelist（错误信息应包含 path 白名单）: {error}"
        );
    }

    #[test]
    fn doubao_realtime_start_connection_frame_matches_documented_shape() {
        let frame = build_start_connection_event()
            .expect("start connection frame should build（StartConnection 帧应能构造）");

        assert_eq!(frame, vec![17, 20, 16, 0, 0, 0, 0, 1, 0, 0, 0, 2, 123, 125]);
    }

    #[test]
    fn doubao_realtime_start_session_event_matches_documented_shape() {
        let frame = build_start_session_event(
            &DoubaoRealtimeConfig {
                provider: "doubao-o2-realtime".to_string(),
                model_version: "1.2.1.1".to_string(),
                sample_rate: 16000,
                language: Some("zh-CN".to_string()),
                app_id: Some("4587429383".to_string()),
                access_token: Some("vei-access-token".to_string()),
                secret_key: Some("vei-secret-key".to_string()),
                websocket_url: Some(
                    "wss://openspeech.bytedance.com/api/v3/realtime/dialogue".to_string(),
                ),
                connect_id: Some("connect-1".to_string()),
                speaker: Some("zh_female_vv_jupiter_bigtts".to_string()),
                input_mode: Some("push_to_talk".to_string()),
                tts_audio_format: Some("pcm_s16le".to_string()),
                tts_sample_rate: Some(24000),
            },
            "session-1",
        )
        .expect("start session event should build（StartSession 帧应能构造）");

        let parsed = parse_realtime_frame(&frame)
            .expect("start session frame should parse（StartSession 帧应能被解析）");
        let payload = parsed
            .payload_json
            .expect("json payload should exist（应带有 JSON payload）");

        assert_eq!(parsed.message_type, 0b0001);
        assert_eq!(parsed.event_id, Some(100));
        assert_eq!(parsed.session_id.as_deref(), Some("session-1"));
        assert_eq!(payload["dialog"]["extra"]["model"], "1.2.1.1");
        assert_eq!(payload["dialog"]["extra"]["input_mod"], "push_to_talk");
        assert_eq!(payload["tts"]["speaker"], "zh_female_vv_jupiter_bigtts");
        assert_eq!(payload["tts"]["audio_config"]["format"], "pcm_s16le");
        assert_eq!(payload["tts"]["audio_config"]["sample_rate"], 24000);
        assert_eq!(payload["asr"]["audio_info"]["sample_rate"], 16000);
        assert_eq!(payload["asr"]["audio_info"]["format"], "pcm");
    }

    #[test]
    fn doubao_realtime_audio_request_wraps_task_payload() {
        let frame = build_audio_task_request("session-1", &[1_u8, 2, 3, 4])
            .expect("audio task request should build（音频任务帧应能构造）");

        let parsed = parse_realtime_frame(&frame)
            .expect("audio task request should parse（音频任务帧应能被解析）");

        assert_eq!(parsed.message_type, 0b0010);
        assert_eq!(parsed.event_id, Some(200));
        assert_eq!(parsed.session_id.as_deref(), Some("session-1"));
        assert_eq!(parsed.payload_bytes, vec![1_u8, 2, 3, 4]);
    }

    #[test]
    fn doubao_realtime_maps_full_server_response_into_frontend_payload() {
        let payload = map_server_frame_to_event_payload(
            &build_server_json_frame(
                150,
                Some("session-1"),
                serde_json::json!({
                    "dialog_id": "dialog-1",
                }),
            )
            .expect("server frame should build（服务端 JSON 帧应能构造）"),
            "1.2.1.1",
        )
        .expect("server frame should parse（服务端帧应能解析）")
        .expect("recognized event should map（可识别事件应被映射）");

        assert_eq!(payload.session_id, "session-1");
        assert_eq!(payload.event_type, "SessionStarted");
        assert_eq!(payload.model.as_deref(), Some("1.2.1.1"));
        assert_eq!(
            payload
                .payload
                .as_ref()
                .and_then(|value| value.get("dialog_id"))
                .and_then(|value| value.as_str()),
            Some("dialog-1")
        );
        assert!(payload.audio_data.is_none());
    }

    #[test]
    fn doubao_realtime_maps_connection_started_utf8_payload() {
        let payload = map_server_frame_to_event_payload(
            &build_server_utf8_frame(50, None, "connect-1")
                .expect("utf8 frame should build（UTF-8 响应帧应能构造）"),
            "1.2.1.1",
        )
        .expect("utf8 frame should parse（UTF-8 响应帧应能解析）")
        .expect("connection started should map（连接开始事件应被映射）");

        assert_eq!(payload.session_id, "");
        assert_eq!(payload.event_type, "ConnectionStarted");
        assert_eq!(
            payload
                .payload
                .as_ref()
                .and_then(|value| value.get("connect_id"))
                .and_then(|value| value.as_str()),
            Some("connect-1")
        );
    }

    #[test]
    fn doubao_realtime_maps_audio_server_response_into_frontend_payload() {
        let payload = map_server_frame_to_event_payload(
            &build_server_audio_frame(352, Some("session-1"), &[79_u8, 103, 103, 83])
                .expect("audio response frame should build（音频响应帧应能构造）"),
            "1.2.1.1",
        )
        .expect("audio response frame should parse（音频响应帧应能解析）")
        .expect("recognized audio event should map（可识别音频事件应被映射）");

        assert_eq!(payload.event_type, "TTSResponse");
        assert_eq!(payload.audio_format.as_deref(), Some("pcm_s16le"));
        assert_eq!(payload.sample_rate, Some(24000));
        assert_eq!(
            payload.audio_data.as_deref(),
            Some(&[79_u8, 103, 103, 83][..])
        );
    }

    #[test]
    fn doubao_realtime_finish_session_frame_matches_documented_shape() {
        let frame = build_finish_session_event("session-1")
            .expect("finish session frame should build（FinishSession 帧应能构造）");
        let parsed = parse_realtime_frame(&frame)
            .expect("finish session frame should parse（FinishSession 帧应能被解析）");

        assert_eq!(parsed.message_type, 0b0001);
        assert_eq!(parsed.event_id, Some(102));
        assert_eq!(parsed.session_id.as_deref(), Some("session-1"));
        assert_eq!(parsed.payload_json, Some(serde_json::json!({})));
    }

    #[test]
    fn doubao_realtime_finish_connection_frame_matches_documented_shape() {
        let frame = build_finish_connection_event()
            .expect("finish connection frame should build（FinishConnection 帧应能构造）");
        let parsed = parse_realtime_frame(&frame)
            .expect("finish connection frame should parse（FinishConnection 帧应能被解析）");

        assert_eq!(parsed.message_type, 0b0001);
        assert_eq!(parsed.event_id, Some(2));
        assert_eq!(parsed.payload_json, Some(serde_json::json!({})));
    }

    #[test]
    fn doubao_realtime_config_default_values_align_with_official_model() {
        assert_eq!(
            resolve_model_version(&DoubaoRealtimeConfig {
                provider: "doubao-o2-realtime".to_string(),
                model_version: "".to_string(),
                sample_rate: 16000,
                language: Some("zh-CN".to_string()),
                app_id: Some("4587429383".to_string()),
                access_token: Some("vei-access-token".to_string()),
                secret_key: Some("vei-secret-key".to_string()),
                websocket_url: Some(
                    "wss://openspeech.bytedance.com/api/v3/realtime/dialogue".to_string()
                ),
                connect_id: None,
                speaker: None,
                input_mode: None,
                tts_audio_format: None,
                tts_sample_rate: None,
            }),
            "1.2.1.1"
        );
    }

    #[test]
    #[ignore = "requires live Doubao S2S credentials and audio fixture（需要真实豆包 S2S 凭据与音频样本）"]
    fn doubao_realtime_online_smoke_with_real_api() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime should build（Tokio 运行时应能构造）");

        runtime.block_on(async {
            let fixture_path = resolve_online_smoke_fixture_path();
            let fixture_bytes = fs::read(&fixture_path).unwrap_or_else(|error| {
                panic!(
                    "online smoke fixture read failed（在线 smoke 音频样本读取失败）: {}: {}",
                    fixture_path.display(),
                    error
                )
            });

            let config = DoubaoRealtimeConfig {
                provider: "doubao-o2-realtime".to_string(),
                model_version: read_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_MODEL_VERSION",
                    "DOUBAO_REALTIME_MODEL_VERSION",
                ])
                .unwrap_or_else(|| "1.2.1.1".to_string()),
                sample_rate: read_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_SAMPLE_RATE",
                    "DOUBAO_REALTIME_SAMPLE_RATE",
                ])
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(16000),
                language: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_LANGUAGE",
                        "DOUBAO_REALTIME_LANGUAGE",
                    ])
                    .unwrap_or_else(|| "en-US".to_string()),
                ),
                app_id: Some(require_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_APP_ID",
                    "DOUBAO_REALTIME_APP_ID",
                ])),
                access_token: Some(require_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN",
                    "DOUBAO_REALTIME_ACCESS_TOKEN",
                ])),
                secret_key: Some(require_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_SECRET_KEY",
                    "DOUBAO_REALTIME_SECRET_KEY",
                ])),
                websocket_url: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_WEBSOCKET_URL",
                        "DOUBAO_REALTIME_WEBSOCKET_URL",
                    ])
                    .unwrap_or_else(|| {
                        "wss://openspeech.bytedance.com/api/v3/realtime/dialogue".to_string()
                    }),
                ),
                connect_id: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_CONNECT_ID",
                        "DOUBAO_REALTIME_CONNECT_ID",
                    ])
                    .unwrap_or_else(|| format!("codex-online-smoke-{}", uuid::Uuid::new_v4())),
                ),
                speaker: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_SPEAKER",
                        "DOUBAO_REALTIME_SPEAKER",
                    ])
                    .unwrap_or_else(|| "zh_female_vv_jupiter_bigtts".to_string()),
                ),
                input_mode: Some("push_to_talk".to_string()),
                tts_audio_format: Some("pcm_s16le".to_string()),
                tts_sample_rate: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_TTS_SAMPLE_RATE",
                        "DOUBAO_REALTIME_TTS_SAMPLE_RATE",
                    ])
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(24000),
                ),
            };

            let session_id = format!("doubao-online-smoke-{}", uuid::Uuid::new_v4());
            let mut event_types = Vec::new();
            let mut final_asr = String::new();
            let mut chat_text = String::new();
            let mut tts_bytes = 0usize;
            let mut sent_audio = false;
            let mut completed = false;

            let ws_stream = connect_realtime_ws(&config)
                .await
                .expect("live websocket should connect（真实 WebSocket 应能建立连接）");
            let (mut write, mut read) = ws_stream.split();

            send_binary_frame(
                &mut write,
                build_start_connection_event()
                    .expect("start connection frame should build（StartConnection 帧应能构造）"),
            )
            .await
            .expect("start connection should send（StartConnection 应能发送）");
            send_binary_frame(
                &mut write,
                build_start_session_event(&config, &session_id)
                    .expect("start session frame should build（StartSession 帧应能构造）"),
            )
            .await
            .expect("start session should send（StartSession 应能发送）");

            let started_at = Instant::now();
            while started_at.elapsed() < Duration::from_secs(30) {
                let next_message = tokio::time::timeout(Duration::from_secs(5), read.next())
                    .await
                    .expect("read timeout should not elapse（读取超时不应触发）");

                let Some(message_result) = next_message else {
                    break;
                };

                match message_result.expect("websocket message should succeed（WebSocket 消息应成功）") {
                    Message::Binary(binary) => {
                        let maybe_payload = map_server_frame_to_event_payload(&binary, &config.model_version)
                            .expect("server payload should parse（服务端 payload 应能解析）");
                        let Some(payload) = maybe_payload else {
                            continue;
                        };

                        let event_type = payload.event_type.clone();
                        event_types.push(event_type.clone());

                        match event_type.as_str() {
                            "SessionStarted" if !sent_audio => {
                                stream_online_smoke_audio(&mut write, &session_id, &fixture_bytes)
                                    .await
                                    .expect("fixture audio should stream（音频样本应能流式发送）");
                                sent_audio = true;
                            }
                            "ASRResponse" => {
                                if let Some(results) = payload
                                    .payload
                                    .as_ref()
                                    .and_then(|value| value.get("results"))
                                    .and_then(|value| value.as_array())
                                {
                                    for result in results {
                                        let text = result.get("text").and_then(|value| value.as_str()).unwrap_or("");
                                        let is_interim = result
                                            .get("is_interim")
                                            .and_then(|value| value.as_bool())
                                            .unwrap_or(false);
                                        if !text.trim().is_empty() && !is_interim {
                                            final_asr = text.trim().to_string();
                                        }
                                    }
                                }
                            }
                            "ChatResponse" => {
                                if let Some(content) = payload
                                    .payload
                                    .as_ref()
                                    .and_then(|value| value.get("content"))
                                    .and_then(|value| value.as_str())
                                {
                                    chat_text.push_str(content);
                                }
                            }
                            "TTSResponse" => {
                                tts_bytes += payload.audio_data.as_ref().map(|bytes| bytes.len()).unwrap_or(0);
                            }
                            "TTSEnded" => {
                                completed = true;
                                break;
                            }
                            "SessionFailed" | "ConnectionFailed" | "DialogCommonError" | "error" => {
                                panic!(
                                    "online smoke received failure event（在线 smoke 收到失败事件）: {} {:?}",
                                    event_type,
                                    payload.payload
                                );
                            }
                            _ => {}
                        }
                    }
                    Message::Ping(payload) => {
                        write
                            .send(Message::Pong(payload))
                            .await
                            .expect("pong should send（Pong 应能发送）");
                    }
                    Message::Close(_) if completed => {
                        break;
                    }
                    Message::Close(frame) => {
                        panic!("websocket closed before completion（完成前连接被关闭）: {:?}", frame);
                    }
                    Message::Text(text) => {
                        panic!("unexpected text frame from live api（真实 API 返回了非预期文本帧）: {text}");
                    }
                    Message::Pong(_) | Message::Frame(_) => {}
                }
            }

            let _ = finalize_session(&mut write, &session_id).await;
            let _ = write.close().await;

            println!(
                "doubao-online-smoke summary: finalAsr={:?} chatText={:?} ttsBytes={} completed={} events={:?}",
                final_asr,
                chat_text,
                tts_bytes,
                completed,
                event_types
            );

            assert!(completed, "online smoke should reach TTSEnded（在线 smoke 应走到 TTSEnded）");
            assert!(
                event_types.iter().any(|value| value == "SessionStarted"),
                "should include SessionStarted（应包含 SessionStarted）"
            );
            assert!(
                event_types.iter().any(|value| value == "ASRResponse"),
                "should include ASRResponse（应包含 ASRResponse）"
            );
            assert!(
                event_types.iter().any(|value| value == "ChatResponse"),
                "should include ChatResponse（应包含 ChatResponse）"
            );
            assert!(
                event_types.iter().any(|value| value == "TTSResponse"),
                "should include TTSResponse（应包含 TTSResponse）"
            );
            assert!(!final_asr.is_empty(), "final ASR should not be empty（最终 ASR 结果不应为空）");
            assert!(
                !chat_text.trim().is_empty(),
                "chat response text should not be empty（模型回复文本不应为空）"
            );
            assert!(tts_bytes > 0, "tts audio bytes should be positive（TTS 音频字节数应大于 0）");
        });
    }
}
