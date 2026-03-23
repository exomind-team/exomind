//! Volcano ASR (语音识别) Tauri 命令
//!
//! Sync points（关键对齐点）:
//! - use official websocket endpoints（使用官方 websocket endpoint）
//! - gzip request/audio frames（请求和音频都走 gzip 压缩）
//! - wait for async final flag=3（async 模式等待 flags=3 的最终包）

use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Arc,
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{interval, Duration, MissedTickBehavior};
use tokio_tungstenite::{connect_async, tungstenite, MaybeTlsStream, WebSocketStream};
use tungstenite::{http::Request as HttpRequest, Message};

const VOLCANO_STREAM_EVENT_NAME: &str = "volcano-asr-stream-event";
const VOLCANO_STREAM_CANCELLED_MESSAGE: &str = "火山流式会话已取消";
const VOLCANO_STREAM_FINISH_TIMEOUT_SECS: u64 = 30;
const VOLCANO_STREAM_KEEPALIVE_SECS: u64 = 3;

type VolcanoWsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type VolcanoWriteHalf = SplitSink<VolcanoWsStream, Message>;
type VolcanoReadHalf = SplitStream<VolcanoWsStream>;

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct VolcanoAsrRequestOptions {
    #[serde(default = "default_model_name")]
    #[serde(alias = "modelName")]
    pub model_name: String,
    #[serde(default = "default_true")]
    #[serde(alias = "enableItn")]
    pub enable_itn: bool,
    #[serde(default = "default_true")]
    #[serde(alias = "enablePunc")]
    pub enable_punc: bool,
    #[serde(default)]
    #[serde(alias = "enableDdc")]
    pub enable_ddc: bool,
    #[serde(default = "default_true")]
    #[serde(alias = "showUtterances")]
    pub show_utterances: bool,
    #[serde(default)]
    #[serde(alias = "enableNonstream")]
    pub enable_nonstream: bool,
    #[serde(default = "default_end_window_size")]
    #[serde(alias = "endWindowSize")]
    pub end_window_size: u32,
    #[serde(default = "default_force_to_speech_time")]
    #[serde(alias = "forceToSpeechTime")]
    pub force_to_speech_time: u32,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
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
    utterances: Option<Vec<VolcanoUtterance>>,
}

#[derive(Debug, Deserialize)]
struct VolcanoUtterance {
    definite: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct VolcanoAudioInfo {
    duration: Option<f64>,
}

#[derive(Debug)]
struct ParsedVolcanoFrame {
    message_type: u8,
    flags: u8,
    _sequence: Option<i32>,
    response: Option<VolcanoResponse>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VolcanoAsrStreamEventPayload {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_final: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_definite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

enum VolcanoStreamCommand {
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

struct VolcanoAsrStreamSession {
    command_tx: mpsc::UnboundedSender<VolcanoStreamCommand>,
    result_rx: Mutex<Option<oneshot::Receiver<Result<AsrResult, String>>>>,
}

/// Volcano 流式会话状态（stream session state，会话状态）.
pub struct VolcanoAsrStreamState {
    sessions: Mutex<HashMap<String, Arc<VolcanoAsrStreamSession>>>,
}

impl Default for VolcanoAsrStreamState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl VolcanoAsrStreamState {
    async fn insert_session(&self, session_id: String, session: Arc<VolcanoAsrStreamSession>) {
        self.sessions.lock().await.insert(session_id, session);
    }

    async fn get_session(&self, session_id: &str) -> Option<Arc<VolcanoAsrStreamSession>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    async fn remove_session(&self, session_id: &str) -> Option<Arc<VolcanoAsrStreamSession>> {
        self.sessions.lock().await.remove(session_id)
    }
}

fn default_true() -> bool {
    true
}

fn default_model_name() -> String {
    "bigmodel".to_string()
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
    let json_bytes =
        serde_json::to_vec(data).map_err(|error| format!("JSON 序列化失败: {error}"))?;
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

    if message_type == 15 {
        if data.len() < 12 {
            return Err("错误响应长度过短".to_string());
        }

        let error_code = u32::from_be_bytes(data[4..8].try_into().unwrap());
        let payload_size = u32::from_be_bytes(data[8..12].try_into().unwrap()) as usize;
        if data.len() < 12 + payload_size {
            return Err("错误响应 payload 不完整".to_string());
        }

        let payload_slice = &data[12..12 + payload_size];
        let payload = if compression == 1 {
            gunzip_bytes(payload_slice)?
        } else {
            payload_slice.to_vec()
        };

        let mut response = if serialization == 1 {
            serde_json::from_slice::<VolcanoResponse>(&payload)
                .map_err(|error| format!("错误响应 JSON 解析失败: {error}"))?
        } else {
            VolcanoResponse {
                code: None,
                message: Some(String::from_utf8_lossy(&payload).to_string()),
                result: None,
                audio_info: None,
            }
        };
        if response.code.is_none() {
            response.code = Some(error_code as i64);
        }

        return Ok(ParsedVolcanoFrame {
            message_type,
            flags,
            _sequence: None,
            response: Some(response),
        });
    }

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
        _sequence: sequence,
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
        model_name: default_model_name(),
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        show_utterances: true,
        enable_nonstream: false,
        end_window_size: default_end_window_size(),
        force_to_speech_time: default_force_to_speech_time(),
        extra: serde_json::Map::new(),
    })
}

fn resolve_endpoint(config: &VolcanoAsrConfig) -> String {
    let endpoint = config.endpoint.trim();
    if endpoint.is_empty() {
        default_endpoint()
    } else {
        endpoint.to_string()
    }
}

fn resolve_result_language(config: &VolcanoAsrConfig, endpoint: &str) -> String {
    if endpoint == "bigmodel_nostream" {
        let language = config.language.trim();
        if language.is_empty() {
            default_language()
        } else {
            language.to_string()
        }
    } else {
        "zh-CN".to_string()
    }
}

fn build_volcano_request_payload(
    connect_id: &str,
    endpoint: &str,
    config: &VolcanoAsrConfig,
) -> serde_json::Value {
    let request_options = resolve_request_options(config);
    let mut audio = serde_json::json!({
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    });
    if endpoint == "bigmodel_nostream" {
        audio["language"] = serde_json::Value::String(resolve_result_language(config, endpoint));
    }

    let mut request_json =
        serde_json::to_value(&request_options).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(request_object) = request_json.as_object_mut() {
        request_object.insert(
            "model_name".to_string(),
            serde_json::Value::String(request_options.model_name.clone()),
        );
        request_object.insert(
            "enable_itn".to_string(),
            serde_json::Value::Bool(request_options.enable_itn),
        );
        request_object.insert(
            "enable_punc".to_string(),
            serde_json::Value::Bool(request_options.enable_punc),
        );
        request_object.insert(
            "enable_ddc".to_string(),
            serde_json::Value::Bool(request_options.enable_ddc),
        );
        request_object.insert(
            "show_utterances".to_string(),
            serde_json::Value::Bool(request_options.show_utterances),
        );
    }

    let mut request_payload = serde_json::json!({
        "user": { "uid": connect_id },
        "audio": audio,
        "request": request_json,
    });

    if endpoint == "bigmodel_async" {
        request_payload["request"]["enable_nonstream"] =
            serde_json::Value::Bool(request_options.enable_nonstream);
        request_payload["request"]["end_window_size"] =
            serde_json::Value::Number(request_options.end_window_size.into());
        request_payload["request"]["force_to_speech_time"] =
            serde_json::Value::Number(request_options.force_to_speech_time.into());
    }

    request_payload
}

fn ensure_success_response(response: &VolcanoResponse) -> Result<(), String> {
    if let Some(code) = response.code {
        if code != 20000000 {
            return Err(format!(
                "API 错误 {}: {}",
                code,
                response.message.clone().unwrap_or_default()
            ));
        }
    }
    Ok(())
}

fn update_latest_response(
    response: &VolcanoResponse,
    latest_text: &mut String,
    latest_duration: &mut Option<f64>,
) {
    if let Some(text) = response
        .result
        .as_ref()
        .and_then(|result| result.text.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        *latest_text = text.to_string();
    }

    if let Some(duration) = response
        .audio_info
        .as_ref()
        .and_then(|audio| audio.duration)
    {
        *latest_duration = Some(duration);
    }
}

fn has_definite_utterance(response: &VolcanoResponse) -> bool {
    response
        .result
        .as_ref()
        .and_then(|result| result.utterances.as_ref())
        .map(|utterances| {
            utterances
                .iter()
                .any(|utterance| utterance.definite.unwrap_or(false))
        })
        .unwrap_or(false)
}

fn is_definite_response(endpoint: &str, frame: &ParsedVolcanoFrame) -> bool {
    is_final_response(endpoint, frame)
        || frame
            .response
            .as_ref()
            .map(has_definite_utterance)
            .unwrap_or(false)
}

fn build_stream_event_payload(
    session_id: &str,
    endpoint: &str,
    frame: &ParsedVolcanoFrame,
) -> Option<VolcanoAsrStreamEventPayload> {
    let response = frame.response.as_ref()?;
    let text = response
        .result
        .as_ref()
        .and_then(|result| result.text.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let is_final = is_final_response(endpoint, frame);
    let is_definite = is_definite_response(endpoint, frame);

    if text.is_none() && !is_final {
        return None;
    }

    Some(VolcanoAsrStreamEventPayload {
        session_id: session_id.to_string(),
        text,
        is_final: Some(is_final),
        is_definite: Some(is_definite),
        error_message: None,
    })
}

fn build_stream_error_payload(
    session_id: &str,
    error_message: String,
) -> VolcanoAsrStreamEventPayload {
    VolcanoAsrStreamEventPayload {
        session_id: session_id.to_string(),
        text: None,
        is_final: None,
        is_definite: None,
        error_message: Some(error_message),
    }
}

fn format_stream_start_log_line(session_id: &str, endpoint: &str) -> String {
    format!(
        "[ASR-Rust/stream] 开始流式识别: session={} endpoint={}",
        session_id, endpoint
    )
}

fn format_stream_finish_log_line(
    session_id: &str,
    endpoint: &str,
    outcome: &Result<AsrResult, String>,
) -> String {
    match outcome {
        Ok(_) => format!(
            "[ASR-Rust/stream] 流式识别结束: session={} endpoint={} status=ok",
            session_id, endpoint
        ),
        Err(error) if error == VOLCANO_STREAM_CANCELLED_MESSAGE => format!(
            "[ASR-Rust/stream] 流式识别结束: session={} endpoint={} status=cancelled",
            session_id, endpoint
        ),
        Err(error) => format!(
            "[ASR-Rust/stream] 流式识别结束: session={} endpoint={} status=error error={}",
            session_id, endpoint, error
        ),
    }
}

fn format_recognize_finish_log_line(
    endpoint: &str,
    outcome: &Result<AsrResult, String>,
) -> String {
    match outcome {
        Ok(_) => format!("[ASR-Rust] 识别结束: endpoint={} status=ok", endpoint),
        Err(error) => format!(
            "[ASR-Rust] 识别结束: endpoint={} status=error error={}",
            endpoint, error
        ),
    }
}

fn build_asr_result(
    config: &VolcanoAsrConfig,
    endpoint: &str,
    latest_text: &str,
    latest_duration: Option<f64>,
) -> AsrResult {
    AsrResult {
        text: latest_text.to_string(),
        confidence: 1.0,
        lang: resolve_result_language(config, endpoint),
        duration: latest_duration,
    }
}

async fn open_configured_ws(
    config: &VolcanoAsrConfig,
) -> Result<(VolcanoWsStream, String), String> {
    if !volcano_asr_check_config(config.clone())? {
        return Err("火山 ASR 配置不完整".to_string());
    }

    let endpoint = resolve_endpoint(config);
    let ws_url = format!("wss://openspeech.bytedance.com/api/v3/sauc/{endpoint}");
    let connect_id = uuid::Uuid::new_v4().to_string();

    let request = HttpRequest::builder()
        .uri(&ws_url)
        .header("Host", "openspeech.bytedance.com")
        .header("X-Api-App-Key", &config.app_key)
        .header("X-Api-Access-Key", &config.access_key)
        .header("X-Api-Resource-Id", &config.resource_id)
        .header("X-Api-Connect-Id", &connect_id)
        .header(
            "Sec-WebSocket-Key",
            tungstenite::handshake::client::generate_key(),
        )
        .header("Sec-WebSocket-Version", "13")
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .body(())
        .map_err(|error| format!("构建请求失败: {error}"))?;

    let (mut ws_stream, _response) =
        tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(request))
            .await
            .map_err(|_| "WebSocket 连接超时 (10s)".to_string())?
            .map_err(|error| format!("WebSocket 连接失败: {error}"))?;

    let request_payload = build_volcano_request_payload(&connect_id, &endpoint, config);
    let config_msg = build_request_message(&request_payload)?;
    ws_stream
        .send(Message::Binary(config_msg))
        .await
        .map_err(|error| format!("发送配置失败: {error}"))?;

    Ok((ws_stream, endpoint))
}

async fn send_audio_frame(
    write: &mut VolcanoWriteHalf,
    audio_data: &[u8],
    is_last: bool,
) -> Result<(), String> {
    let audio_msg = build_audio_message(audio_data, is_last)?;
    write
        .send(Message::Binary(audio_msg))
        .await
        .map_err(|error| {
            if is_last {
                format!("发送最终音频块失败: {error}")
            } else {
                format!("发送音频块失败: {error}")
            }
        })
}

async fn run_volcano_stream_session(
    app: AppHandle,
    stream_state: Arc<VolcanoAsrStreamState>,
    session_id: String,
    config: VolcanoAsrConfig,
    endpoint: String,
    ws_stream: VolcanoWsStream,
    mut command_rx: mpsc::UnboundedReceiver<VolcanoStreamCommand>,
    result_tx: oneshot::Sender<Result<AsrResult, String>>,
) {
    let (mut write, mut read): (VolcanoWriteHalf, VolcanoReadHalf) = ws_stream.split();
    let mut latest_text = String::new();
    let mut latest_duration = None;
    let mut finish_requested = false;
    let mut keepalive = interval(Duration::from_secs(VOLCANO_STREAM_KEEPALIVE_SECS));
    keepalive.set_missed_tick_behavior(MissedTickBehavior::Delay);
    keepalive.tick().await;

    let outcome: Result<AsrResult, String> = loop {
        tokio::select! {
            _ = keepalive.tick(), if !finish_requested => {
                if let Err(error) = write.send(Message::Ping(Vec::new().into())).await {
                    break Err(format!("发送 keepalive ping 失败: {error}"));
                }
            }
            maybe_command = command_rx.recv() => {
                match maybe_command {
                    Some(VolcanoStreamCommand::Push { audio_data, ack_tx }) => {
                        let send_result = if finish_requested {
                            Err("火山流式会话已进入 finish，不能继续 push".to_string())
                        } else if audio_data.is_empty() {
                            Ok(())
                        } else {
                            send_audio_frame(&mut write, &audio_data, false).await
                        };

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
                    Some(VolcanoStreamCommand::Finish { audio_data, ack_tx }) => {
                        let send_result = if finish_requested {
                            Err("火山流式会话 finish 已发送".to_string())
                        } else {
                            finish_requested = true;
                            send_audio_frame(&mut write, &audio_data, true).await
                        };

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
                    Some(VolcanoStreamCommand::Cancel) => {
                        let _ = write.close().await;
                        break Err(VOLCANO_STREAM_CANCELLED_MESSAGE.to_string());
                    }
                    None => {
                        break Err("火山流式会话命令通道已关闭".to_string());
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Binary(data))) => {
                        let frame = match parse_response_message(&data) {
                            Ok(frame) => frame,
                            Err(error) => break Err(error),
                        };

                        if let Some(response) = frame.response.as_ref() {
                            if let Err(error) = ensure_success_response(response) {
                                break Err(error);
                            }
                            update_latest_response(response, &mut latest_text, &mut latest_duration);
                        }

                        if let Some(payload) = build_stream_event_payload(&session_id, &endpoint, &frame) {
                            app.emit(VOLCANO_STREAM_EVENT_NAME, payload).ok();
                        }

                        if is_final_response(&endpoint, &frame) {
                            break Ok(build_asr_result(&config, &endpoint, &latest_text, latest_duration));
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(response) = serde_json::from_str::<VolcanoResponse>(&text) {
                            if let Err(error) = ensure_success_response(&response) {
                                break Err(error);
                            }
                            update_latest_response(&response, &mut latest_text, &mut latest_duration);
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            break Err(format!("发送 Pong 失败: {error}"));
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        if finish_requested && !latest_text.is_empty() {
                            break Ok(build_asr_result(&config, &endpoint, &latest_text, latest_duration));
                        }
                        if finish_requested {
                            break Err("WebSocket 被服务器关闭（未收到最终结果）".to_string());
                        }
                        break Err("WebSocket 被服务器关闭".to_string());
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => {
                        break Err(format!("WebSocket 读取错误: {error}"));
                    }
                    None => {
                        if finish_requested && !latest_text.is_empty() {
                            break Ok(build_asr_result(&config, &endpoint, &latest_text, latest_duration));
                        }
                        break Err("WebSocket 流结束但未收到最终结果".to_string());
                    }
                }
            }
        }
    };

    let _ = write.close().await;
    stream_state.remove_session(&session_id).await;
    match &outcome {
        Ok(_) => log::info!("{}", format_stream_finish_log_line(&session_id, &endpoint, &outcome)),
        Err(error) if error == VOLCANO_STREAM_CANCELLED_MESSAGE => {
            log::debug!("{}", format_stream_finish_log_line(&session_id, &endpoint, &outcome))
        }
        Err(_) => log::warn!("{}", format_stream_finish_log_line(&session_id, &endpoint, &outcome)),
    }

    if let Err(error) = &outcome {
        if error != VOLCANO_STREAM_CANCELLED_MESSAGE {
            app.emit(
                VOLCANO_STREAM_EVENT_NAME,
                build_stream_error_payload(&session_id, error.clone()),
            )
            .ok();
        }
    }

    let _ = result_tx.send(outcome);
}

#[tauri::command]
pub async fn volcano_asr_recognize(
    audio_data: Vec<u8>,
    config: VolcanoAsrConfig,
) -> Result<AsrResult, String> {
    if audio_data.is_empty() {
        return Err("音频数据为空".to_string());
    }

    let (ws_stream, endpoint) = open_configured_ws(&config).await?;
    let (mut write, mut read): (VolcanoWriteHalf, VolcanoReadHalf) = ws_stream.split();

    log::debug!("[ASR] 开始识别: endpoint={endpoint}, audio={} bytes", audio_data.len());

    let chunk_size = 6400usize;
    let total_chunks = audio_data.chunks(chunk_size).len();
    for (index, chunk) in audio_data.chunks(chunk_size).enumerate() {
        let is_last = index == total_chunks.saturating_sub(1);
        send_audio_frame(&mut write, chunk, is_last)
            .await
            .map_err(|error| format!("{error}（第 {}/{} 块）", index + 1, total_chunks))?;
    }

    let mut latest_text = String::new();
    let mut latest_duration = None;

    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    let frame = parse_response_message(&data)?;
                    if let Some(resp) = frame.response.as_ref() {
                        ensure_success_response(resp)?;
                        update_latest_response(resp, &mut latest_text, &mut latest_duration);
                    }

                    if is_final_response(&endpoint, &frame) {
                        return Ok(build_asr_result(
                            &config,
                            &endpoint,
                            &latest_text,
                            latest_duration,
                        ));
                    }
                }
                Ok(Message::Close(_)) => {
                    if !latest_text.is_empty() {
                        return Ok(build_asr_result(
                            &config,
                            &endpoint,
                            &latest_text,
                            latest_duration,
                        ));
                    }
                    return Err("WebSocket 被服务器关闭".to_string());
                }
                Ok(Message::Text(text)) => {
                    if let Ok(resp) = serde_json::from_str::<VolcanoResponse>(&text) {
                        ensure_success_response(&resp)?;
                        update_latest_response(&resp, &mut latest_text, &mut latest_duration);
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
    .map_err(|_| "等待识别结果超时 (30s)".to_string())
    .and_then(|result| result);

    let _ = write.close().await;
    match &result {
        Ok(_) => log::info!("{}", format_recognize_finish_log_line(&endpoint, &result)),
        Err(_) => log::warn!("{}", format_recognize_finish_log_line(&endpoint, &result)),
    }
    result
}

#[tauri::command]
pub async fn volcano_asr_stream_start(
    app: AppHandle,
    config: VolcanoAsrConfig,
    stream_state: State<'_, Arc<VolcanoAsrStreamState>>,
) -> Result<String, String> {
    let (ws_stream, endpoint) = open_configured_ws(&config).await?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let (result_tx, result_rx) = oneshot::channel();
    let session = Arc::new(VolcanoAsrStreamSession {
        command_tx,
        result_rx: Mutex::new(Some(result_rx)),
    });
    let stream_state = Arc::clone(stream_state.inner());

    stream_state
        .insert_session(session_id.clone(), Arc::clone(&session))
        .await;

    log::debug!("{}", format_stream_start_log_line(&session_id, &endpoint));

    tokio::spawn(run_volcano_stream_session(
        app,
        Arc::clone(&stream_state),
        session_id.clone(),
        config,
        endpoint,
        ws_stream,
        command_rx,
        result_tx,
    ));

    Ok(session_id)
}

#[tauri::command]
pub async fn volcano_asr_stream_push(
    session_id: String,
    audio_data: Vec<u8>,
    stream_state: State<'_, Arc<VolcanoAsrStreamState>>,
) -> Result<(), String> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let session = stream_state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("火山流式会话不存在: {session_id}"))?;
    let (ack_tx, ack_rx) = oneshot::channel();
    session
        .command_tx
        .send(VolcanoStreamCommand::Push { audio_data, ack_tx })
        .map_err(|_| format!("火山流式会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("火山流式会话 push 确认通道已关闭: {session_id}"))?
}

#[tauri::command]
pub async fn volcano_asr_stream_finish(
    session_id: String,
    audio_data: Vec<u8>,
    stream_state: State<'_, Arc<VolcanoAsrStreamState>>,
) -> Result<AsrResult, String> {
    let session = stream_state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("火山流式会话不存在: {session_id}"))?;
    let (ack_tx, ack_rx) = oneshot::channel();

    session
        .command_tx
        .send(VolcanoStreamCommand::Finish { audio_data, ack_tx })
        .map_err(|_| format!("火山流式会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("火山流式会话 finish 确认通道已关闭: {session_id}"))??;

    let mut result_rx = session.result_rx.lock().await;
    let receiver = result_rx
        .take()
        .ok_or_else(|| format!("火山流式会话 finish 已被消费: {session_id}"))?;
    drop(result_rx);

    match tokio::time::timeout(
        std::time::Duration::from_secs(VOLCANO_STREAM_FINISH_TIMEOUT_SECS),
        receiver,
    )
    .await
    {
        Ok(result) => result.map_err(|_| format!("火山流式会话结果通道已关闭: {session_id}"))?,
        Err(_) => {
            let _ = stream_state.remove_session(&session_id).await;
            let _ = session.command_tx.send(VolcanoStreamCommand::Cancel);
            Err(format!(
                "等待火山流式最终结果超时 ({}s)",
                VOLCANO_STREAM_FINISH_TIMEOUT_SECS
            ))
        }
    }
}

#[tauri::command]
pub async fn volcano_asr_stream_cancel(
    session_id: String,
    stream_state: State<'_, Arc<VolcanoAsrStreamState>>,
) -> Result<(), String> {
    let Some(session) = stream_state.remove_session(&session_id).await else {
        return Ok(());
    };

    let _ = session.command_tx.send(VolcanoStreamCommand::Cancel);
    Ok(())
}

#[tauri::command]
pub async fn volcano_asr_stream_session_exists(
    session_id: String,
    stream_state: State<'_, Arc<VolcanoAsrStreamState>>,
) -> Result<bool, String> {
    Ok(stream_state.get_session(&session_id).await.is_some())
}

#[tauri::command]
pub fn volcano_asr_check_config(config: VolcanoAsrConfig) -> Result<bool, String> {
    Ok(!config.app_key.is_empty()
        && !config.access_key.is_empty()
        && !config.resource_id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_frame(flags: u8, text: Option<&str>, duration: Option<f64>) -> ParsedVolcanoFrame {
        ParsedVolcanoFrame {
            message_type: 9,
            flags,
            _sequence: Some(1),
            response: Some(VolcanoResponse {
                code: Some(20000000),
                message: None,
                result: Some(VolcanoResultPayload {
                    text: text.map(|value| value.to_string()),
                    utterances: None,
                }),
                audio_info: duration.map(|value| VolcanoAudioInfo {
                    duration: Some(value),
                }),
            }),
        }
    }

    #[test]
    fn volcano_stream_async_flags_3_counts_as_final() {
        let frame = make_frame(0x03, Some("最终文本"), None);

        assert!(is_final_response("bigmodel_async", &frame));
    }

    #[test]
    fn volcano_stream_event_marks_partial_and_final() {
        let partial = build_stream_event_payload(
            "session-1",
            "bigmodel_async",
            &make_frame(0x01, Some("实时结果"), None),
        )
        .expect("partial event should exist（partial 事件应存在）");
        assert_eq!(partial.session_id, "session-1");
        assert_eq!(partial.text.as_deref(), Some("实时结果"));
        assert_eq!(partial.is_final, Some(false));
        assert_eq!(partial.is_definite, Some(false));

        let final_event = build_stream_event_payload(
            "session-1",
            "bigmodel_async",
            &make_frame(0x03, Some("最终结果"), Some(1800.0)),
        )
        .expect("final event should exist（final 事件应存在）");
        assert_eq!(final_event.text.as_deref(), Some("最终结果"));
        assert_eq!(final_event.is_final, Some(true));
        assert_eq!(final_event.is_definite, Some(true));
    }

    #[test]
    fn volcano_stream_finish_log_line_only_reports_summary() {
        let log_line = format_stream_finish_log_line(
            "session-1",
            "bigmodel_async",
            &Ok(AsrResult {
                text: "感觉还不错，现在的话就好很多。".to_string(),
                confidence: 1.0,
                lang: "zh-CN".to_string(),
                duration: Some(1800.0),
            }),
        );

        assert!(log_line.contains("[ASR-Rust/stream]"));
        assert!(log_line.contains("流式识别结束"));
        assert!(log_line.contains("session=session-1"));
        assert!(log_line.contains("endpoint=bigmodel_async"));
        assert!(log_line.contains("status=ok"));
        assert!(!log_line.contains("感觉还不错，现在的话就好很多。"));
    }

    #[test]
    fn volcano_recognize_finish_log_line_only_reports_summary() {
        let log_line = format_recognize_finish_log_line(
            "bigmodel_async",
            &Ok(AsrResult {
                text: "感觉还不错，现在的话就好很多。".to_string(),
                confidence: 1.0,
                lang: "zh-CN".to_string(),
                duration: Some(1800.0),
            }),
        );

        assert!(log_line.contains("[ASR-Rust]"));
        assert!(log_line.contains("识别结束"));
        assert!(log_line.contains("endpoint=bigmodel_async"));
        assert!(log_line.contains("status=ok"));
        assert!(!log_line.contains("感觉还不错，现在的话就好很多。"));
    }

    #[test]
    fn volcano_stream_request_payload_keeps_documented_request_fields() {
        let config: VolcanoAsrConfig = serde_json::from_value(serde_json::json!({
            "appKey": "app-key",
            "accessKey": "access-key",
            "resourceId": "volc.seedasr.sauc.duration",
            "endpoint": "bigmodel_async",
            "request": {
                "model_name": "bigmodel",
                "enable_itn": true,
                "enable_punc": true,
                "enable_ddc": true,
                "show_utterances": false,
                "enable_nonstream": false,
                "end_window_size": 600,
                "force_to_speech_time": 900
            }
        }))
        .expect("config json should deserialize（配置 JSON 应能反序列化）");

        let payload = build_volcano_request_payload("session-1", "bigmodel_async", &config);
        let request = payload
            .get("request")
            .and_then(|value| value.as_object())
            .expect("request payload should be object（request 应为对象）");

        assert_eq!(
            request.get("enable_ddc").and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            request
                .get("end_window_size")
                .and_then(|value| value.as_u64()),
            Some(600)
        );
        assert_eq!(
            request
                .get("force_to_speech_time")
                .and_then(|value| value.as_u64()),
            Some(900)
        );
        assert_eq!(
            request
                .get("enable_nonstream")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn volcano_stream_error_frame_uses_error_code_and_message_layout() {
        let error_body = serde_json::json!({
            "code": 45000001,
            "message": "payload invalid"
        });
        let payload = serde_json::to_vec(&error_body).expect("error payload should serialize");
        let mut frame = vec![0x11, 0xF0, 0x10, 0x00];
        frame.extend_from_slice(&45000001u32.to_be_bytes());
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);

        let parsed =
            parse_response_message(&frame).expect("error frame should parse（错误帧应能解析）");
        let response = parsed
            .response
            .expect("error frame should map to response（错误帧应映射为响应）");

        assert_eq!(parsed.message_type, 15);
        assert_eq!(response.code, Some(45000001));
        assert_eq!(response.message.as_deref(), Some("payload invalid"));
    }
}
