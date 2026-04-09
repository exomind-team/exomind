//! Omni Realtime（实时音频对话）Tauri 命令

use std::{collections::HashMap, sync::Arc, time::Duration};

use base64::Engine as _;
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::{HeaderValue, Request as HttpRequest};
use tungstenite::Message;
use url::Url;

const OMNI_REALTIME_EVENT_NAME: &str = "omni-realtime-event";
const OMNI_REALTIME_DEFAULT_MODEL_VERSION: &str = concat!("q", "wen3.5-omni-plus-realtime");
const OMNI_REALTIME_DEFAULT_WEBSOCKET_URL: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const OMNI_REALTIME_DEFAULT_VOICE: &str = "Ethan";
const OMNI_REALTIME_DEFAULT_INSTRUCTIONS: &str =
    "你是 ExoMind 的实时语音助手，请准确、简洁地回答用户问题。";
const OMNI_REALTIME_CONNECT_TIMEOUT_SECS: u64 = 10;
const OMNI_REALTIME_ALLOWED_WS_HOSTS: [&str; 2] =
    ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"];
const OMNI_REALTIME_ALLOWED_WS_PATH: &str = "/api-ws/v1/realtime";

type OmniWsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type OmniWriteHalf = SplitSink<OmniWsStream, Message>;
type OmniReadHalf = SplitStream<OmniWsStream>;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QwenOmniRealtimeSearchOptions {
    pub enable_source: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QwenOmniRealtimeConfig {
    pub provider: String,
    #[serde(default = "default_model_version")]
    pub model_version: String,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub api_key: Option<String>,
    pub websocket_url: Option<String>,
    pub speaker: Option<String>,
    pub instructions: Option<String>,
    pub input_mode: Option<String>,
    pub enable_search: Option<bool>,
    pub search_options: Option<QwenOmniRealtimeSearchOptions>,
    pub tools: Option<Vec<Value>>,
    pub tool_choice: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OmniRealtimeEventPayload {
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

enum OmniRealtimeCommand {
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

struct OmniRealtimeSession {
    command_tx: mpsc::UnboundedSender<OmniRealtimeCommand>,
}

/// Omni Realtime 会话状态（session state，会话状态）
pub struct QwenOmniRealtimeSessionState {
    sessions: Mutex<HashMap<String, Arc<OmniRealtimeSession>>>,
}

impl Default for QwenOmniRealtimeSessionState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl QwenOmniRealtimeSessionState {
    async fn insert_session(&self, session_id: String, session: Arc<OmniRealtimeSession>) {
        self.sessions.lock().await.insert(session_id, session);
    }

    async fn get_session(&self, session_id: &str) -> Option<Arc<OmniRealtimeSession>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    async fn remove_session(&self, session_id: &str) -> Option<Arc<OmniRealtimeSession>> {
        self.sessions.lock().await.remove(session_id)
    }
}

fn default_model_version() -> String {
    OMNI_REALTIME_DEFAULT_MODEL_VERSION.to_string()
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

fn resolve_model_version(config: &QwenOmniRealtimeConfig) -> String {
    trim_to_option(Some(config.model_version.as_str()))
        .unwrap_or_else(|| OMNI_REALTIME_DEFAULT_MODEL_VERSION.to_string())
}

fn resolve_api_key(config: &QwenOmniRealtimeConfig) -> Result<String, String> {
    trim_to_option(config.api_key.as_deref())
        .ok_or_else(|| "Omni Realtime API Key 不能为空（API Key is required）".to_string())
}

fn resolve_websocket_url(config: &QwenOmniRealtimeConfig) -> String {
    trim_to_option(config.websocket_url.as_deref())
        .unwrap_or_else(|| OMNI_REALTIME_DEFAULT_WEBSOCKET_URL.to_string())
}

fn resolve_voice(config: &QwenOmniRealtimeConfig) -> String {
    trim_to_option(config.speaker.as_deref())
        .unwrap_or_else(|| OMNI_REALTIME_DEFAULT_VOICE.to_string())
}

fn resolve_instructions(config: &QwenOmniRealtimeConfig) -> String {
    trim_to_option(config.instructions.as_deref())
        .unwrap_or_else(|| OMNI_REALTIME_DEFAULT_INSTRUCTIONS.to_string())
}

fn resolve_input_mode(config: &QwenOmniRealtimeConfig) -> String {
    trim_to_option(config.input_mode.as_deref()).unwrap_or_else(|| "push_to_talk".to_string())
}

fn resolve_search_options(config: &QwenOmniRealtimeConfig) -> Option<Value> {
    let search_options = config.search_options.as_ref()?;
    let mut payload = Map::new();

    if let Some(enable_source) = search_options.enable_source {
        payload.insert("enable_source".to_string(), Value::Bool(enable_source));
    }

    if payload.is_empty() {
        return None;
    }

    Some(Value::Object(payload))
}

fn resolve_tools(config: &QwenOmniRealtimeConfig) -> Option<Vec<Value>> {
    let tools = config.tools.as_ref()?;
    let filtered = tools
        .iter()
        .filter_map(|tool| match tool {
            Value::Object(map) if !map.is_empty() => Some(Value::Object(map.clone())),
            _ => None,
        })
        .collect::<Vec<_>>();

    if filtered.is_empty() {
        return None;
    }

    Some(filtered)
}

fn resolve_tool_choice(config: &QwenOmniRealtimeConfig) -> Option<Value> {
    let tool_choice = config.tool_choice.as_ref()?;
    match tool_choice {
        Value::Null => None,
        Value::String(value) if value.trim().is_empty() => None,
        _ => Some(tool_choice.clone()),
    }
}

fn build_realtime_ws_request(
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<tungstenite::http::Request<()>, String> {
    let mut url = Url::parse(base_url.trim())
        .map_err(|error| format!("Omni Realtime WebSocket 地址无效: {error}"))?;
    if url.scheme() != "wss" {
        return Err(format!(
            "Omni Realtime 仅允许 wss 协议（only wss is allowed）: {}",
            url.scheme()
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Omni Realtime WebSocket 地址缺少 host".to_string())?
        .to_string();
    if !OMNI_REALTIME_ALLOWED_WS_HOSTS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host.as_str()))
    {
        return Err(format!(
            "Omni Realtime WebSocket host 不在白名单内（host not allowed）: {host}"
        ));
    }
    if url.path() != OMNI_REALTIME_ALLOWED_WS_PATH {
        return Err(format!(
            "Omni Realtime WebSocket path 非法（path not allowed）: {}",
            url.path()
        ));
    }
    if url.port().is_some() {
        return Err(
            "Omni Realtime WebSocket 不允许自定义端口（custom port is not allowed）".to_string(),
        );
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Omni Realtime WebSocket 不允许携带用户信息（userinfo is not allowed）".to_string(),
        );
    }
    url.query_pairs_mut().append_pair("model", model);

    let request_url = url.as_str().to_string();
    let mut request: HttpRequest<()> = request_url
        .into_client_request()
        .map_err(|error| format!("Omni Realtime 握手请求构造失败: {error}"))?;

    let auth_header_value = HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
        .map_err(|error| format!("Omni Realtime Authorization 头无效: {error}"))?;
    request
        .headers_mut()
        .insert("Authorization", auth_header_value);

    Ok(request)
}

fn build_error_event_payload(
    session_id: &str,
    default_model: &str,
    message: impl Into<String>,
) -> OmniRealtimeEventPayload {
    OmniRealtimeEventPayload {
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

fn map_server_event_to_payload(
    session_id: &str,
    default_model: &str,
    event: &Value,
) -> Option<OmniRealtimeEventPayload> {
    let source_type = event.get("type")?.as_str()?.trim();

    let mapped = match source_type {
        "session.created" => OmniRealtimeEventPayload {
            session_id: session_id.to_string(),
            event_type: "SessionStarted".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(event.clone()),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        },
        "session.closed" => OmniRealtimeEventPayload {
            session_id: session_id.to_string(),
            event_type: "ConnectionFinished".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(event.clone()),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        },
        "session.updated" => OmniRealtimeEventPayload {
            session_id: session_id.to_string(),
            event_type: "SessionUpdated".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(event.clone()),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        },
        "conversation.item.input_audio_transcription.completed" => {
            let transcript = event.get("transcript").and_then(|value| value.as_str())?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ASRResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({
                    "results": [
                        {
                            "text": transcript,
                            "is_interim": false,
                        }
                    ]
                })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "conversation.item.input_audio_transcription.delta" => {
            let transcript = event.get("delta").and_then(|value| value.as_str())?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ASRResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({
                    "results": [
                        {
                            "text": transcript,
                            "is_interim": true,
                        }
                    ]
                })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.audio_transcript.delta" | "response.text.delta" => {
            let content = event.get("delta").and_then(|value| value.as_str())?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ChatResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({ "content": content })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.audio_transcript.done" => {
            let content = event.get("transcript").and_then(|value| value.as_str())?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ChatResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({ "content": content })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.text.done" => {
            let content = event.get("text").and_then(|value| value.as_str())?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ChatResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({ "content": content })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.audio.delta" => {
            let encoded_audio = event.get("delta").and_then(|value| value.as_str())?;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(encoded_audio.as_bytes())
                .ok()?;
            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "TTSResponse".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(event.clone()),
                audio_data: Some(decoded),
                audio_format: Some("pcm_s16le".to_string()),
                sample_rate: Some(24000),
                captured_at: Some(now_iso_string()),
            }
        }
        "response.audio.done" => OmniRealtimeEventPayload {
            session_id: session_id.to_string(),
            event_type: "TTSEnded".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(event.clone()),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        },
        "response.function_call_arguments.delta" => {
            let arguments_delta = event
                .get("delta")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let call_id = event
                .get("call_id")
                .and_then(|value| value.as_str())
                .or_else(|| event.get("id").and_then(|value| value.as_str()));
            let name = event
                .get("name")
                .and_then(|value| value.as_str())
                .or_else(|| event.get("function_name").and_then(|value| value.as_str()));

            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ToolCallDelta".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({
                    "call_id": call_id,
                    "name": name,
                    "arguments_delta": arguments_delta,
                    "raw": event,
                })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.function_call_arguments.done" => {
            let arguments = event
                .get("arguments")
                .and_then(|value| value.as_str())
                .or_else(|| event.get("final").and_then(|value| value.as_str()))
                .unwrap_or_default();
            let call_id = event
                .get("call_id")
                .and_then(|value| value.as_str())
                .or_else(|| event.get("id").and_then(|value| value.as_str()));
            let name = event
                .get("name")
                .and_then(|value| value.as_str())
                .or_else(|| event.get("function_name").and_then(|value| value.as_str()));

            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: "ToolCallDone".to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({
                    "call_id": call_id,
                    "name": name,
                    "arguments": arguments,
                    "raw": event,
                })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.output_item.added" | "response.output_item.done" => {
            let item = event.get("item")?;
            let item_type = item.get("type").and_then(|value| value.as_str())?;
            if item_type != "function_call" {
                return None;
            }

            let event_type = if source_type == "response.output_item.added" {
                "ToolCallRequested"
            } else {
                "ToolCallDone"
            };

            OmniRealtimeEventPayload {
                session_id: session_id.to_string(),
                event_type: event_type.to_string(),
                model: Some(default_model.to_string()),
                payload: Some(json!({
                    "call_id": item.get("call_id").and_then(|value| value.as_str()),
                    "name": item.get("name").and_then(|value| value.as_str()),
                    "arguments": item.get("arguments").and_then(|value| value.as_str()),
                    "item": item,
                    "raw": event,
                })),
                audio_data: None,
                audio_format: None,
                sample_rate: None,
                captured_at: Some(now_iso_string()),
            }
        }
        "response.done" => {
            let output = event
                .get("response")
                .and_then(|value| value.get("output"))
                .and_then(|value| value.as_array());

            if let Some(function_call_item) = output.and_then(|items| {
                items.iter().find(|item| {
                    item.get("type")
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| value == "function_call")
                })
            }) {
                OmniRealtimeEventPayload {
                    session_id: session_id.to_string(),
                    event_type: "ToolCallDone".to_string(),
                    model: Some(default_model.to_string()),
                    payload: Some(json!({
                        "call_id": function_call_item.get("call_id").and_then(|value| value.as_str()),
                        "name": function_call_item.get("name").and_then(|value| value.as_str()),
                        "arguments": function_call_item.get("arguments").and_then(|value| value.as_str()),
                        "item": function_call_item,
                        "raw": event,
                    })),
                    audio_data: None,
                    audio_format: None,
                    sample_rate: None,
                    captured_at: Some(now_iso_string()),
                }
            } else {
                OmniRealtimeEventPayload {
                    session_id: session_id.to_string(),
                    event_type: "ResponseDone".to_string(),
                    model: Some(default_model.to_string()),
                    payload: Some(event.clone()),
                    audio_data: None,
                    audio_format: None,
                    sample_rate: None,
                    captured_at: Some(now_iso_string()),
                }
            }
        }
        "input_audio_buffer.speech_started" => OmniRealtimeEventPayload {
            session_id: session_id.to_string(),
            event_type: "ASRInfo".to_string(),
            model: Some(default_model.to_string()),
            payload: Some(event.clone()),
            audio_data: None,
            audio_format: None,
            sample_rate: None,
            captured_at: Some(now_iso_string()),
        },
        "error" => {
            let message = event
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str())
                .or_else(|| event.get("message").and_then(|value| value.as_str()))
                .unwrap_or("Omni Realtime 返回错误事件");
            build_error_event_payload(session_id, default_model, message)
        }
        _ => return None,
    };

    Some(mapped)
}

async fn emit_realtime_event(app: &AppHandle, payload: OmniRealtimeEventPayload) {
    app.emit(OMNI_REALTIME_EVENT_NAME, payload).ok();
}

async fn send_json_event(write: &mut OmniWriteHalf, payload: Value) -> Result<(), String> {
    write
        .send(Message::Text(payload.to_string().into()))
        .await
        .map_err(|error| format!("Omni Realtime 文本事件发送失败: {error}"))
}

fn build_session_update_event(config: &QwenOmniRealtimeConfig) -> Value {
    let input_mode = resolve_input_mode(config);
    let turn_detection = if input_mode == "keep_alive" {
        json!({
            "type": "server_vad",
            "threshold": 0.5,
            "silence_duration_ms": 800,
        })
    } else {
        Value::Null
    };

    let mut session_payload = Map::new();
    session_payload.insert("modalities".to_string(), json!(["text", "audio"]));
    session_payload.insert("voice".to_string(), Value::String(resolve_voice(config)));
    session_payload.insert(
        "input_audio_format".to_string(),
        Value::String("pcm".to_string()),
    );
    session_payload.insert(
        "output_audio_format".to_string(),
        Value::String("pcm".to_string()),
    );
    session_payload.insert(
        "instructions".to_string(),
        Value::String(resolve_instructions(config)),
    );
    session_payload.insert("turn_detection".to_string(), turn_detection);

    if let Some(enable_search) = config.enable_search {
        session_payload.insert("enable_search".to_string(), Value::Bool(enable_search));
    }
    if let Some(search_options) = resolve_search_options(config) {
        session_payload.insert("search_options".to_string(), search_options);
    }
    if let Some(tools) = resolve_tools(config) {
        session_payload.insert("tools".to_string(), Value::Array(tools));
    }
    if let Some(tool_choice) = resolve_tool_choice(config) {
        session_payload.insert("tool_choice".to_string(), tool_choice);
    }

    json!({
        "event_id": format!("event_{}", uuid::Uuid::new_v4()),
        "type": "session.update",
        "session": Value::Object(session_payload),
    })
}

fn build_audio_append_event(audio_data: &[u8]) -> Value {
    json!({
        "event_id": format!("event_{}", uuid::Uuid::new_v4()),
        "type": "input_audio_buffer.append",
        "audio": base64::engine::general_purpose::STANDARD.encode(audio_data),
    })
}

fn build_audio_commit_event() -> Value {
    json!({
        "event_id": format!("event_{}", uuid::Uuid::new_v4()),
        "type": "input_audio_buffer.commit",
    })
}

fn build_create_response_event() -> Value {
    json!({
        "event_id": format!("event_{}", uuid::Uuid::new_v4()),
        "type": "response.create",
    })
}

async fn connect_realtime_ws(config: &QwenOmniRealtimeConfig) -> Result<OmniWsStream, String> {
    let request = build_realtime_ws_request(
        &resolve_websocket_url(config),
        &resolve_model_version(config),
        &resolve_api_key(config)?,
    )?;
    let (ws_stream, _response) = tokio::time::timeout(
        Duration::from_secs(OMNI_REALTIME_CONNECT_TIMEOUT_SECS),
        connect_async(request),
    )
    .await
    .map_err(|_| {
        format!(
            "Omni Realtime WebSocket 连接超时 ({}s)",
            OMNI_REALTIME_CONNECT_TIMEOUT_SECS
        )
    })?
    .map_err(|error| format!("Omni Realtime WebSocket 连接失败: {error}"))?;
    Ok(ws_stream)
}

async fn run_omni_realtime_session(
    app: AppHandle,
    state: Arc<QwenOmniRealtimeSessionState>,
    session_id: String,
    default_model: String,
    mut write: OmniWriteHalf,
    mut read: OmniReadHalf,
    mut command_rx: mpsc::UnboundedReceiver<OmniRealtimeCommand>,
    config: QwenOmniRealtimeConfig,
) {
    let setup_result = send_json_event(&mut write, build_session_update_event(&config)).await;
    if let Err(error) = setup_result {
        state.remove_session(&session_id).await;
        emit_realtime_event(
            &app,
            build_error_event_payload(&session_id, &default_model, error),
        )
        .await;
        return;
    }

    let mut input_finished = false;

    let outcome: Result<(), String> = loop {
        tokio::select! {
            maybe_command = command_rx.recv() => {
                match maybe_command {
                    Some(OmniRealtimeCommand::Push { audio_data, ack_tx }) => {
                        if audio_data.is_empty() {
                            let _ = ack_tx.send(Ok(()));
                            continue;
                        }
                        let send_result = send_json_event(&mut write, build_audio_append_event(&audio_data)).await;
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
                    Some(OmniRealtimeCommand::Finish { audio_data, ack_tx }) => {
                        if input_finished {
                            let error = "Omni Realtime finish 已经发送，不能重复提交".to_string();
                            let _ = ack_tx.send(Err(error));
                            continue;
                        }
                        input_finished = true;

                        let send_result: Result<(), String> = async {
                            if !audio_data.is_empty() {
                                send_json_event(&mut write, build_audio_append_event(&audio_data)).await?;
                            }
                            send_json_event(&mut write, build_audio_commit_event()).await?;
                            send_json_event(&mut write, build_create_response_event()).await
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
                    Some(OmniRealtimeCommand::Cancel) => {
                        break Ok(());
                    }
                    None => {
                        break Ok(());
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<Value>(&text) {
                            Ok(json_message) => {
                                if let Some(payload) = map_server_event_to_payload(&session_id, &default_model, &json_message) {
                                    let event_type = payload.event_type.clone();
                                    emit_realtime_event(&app, payload).await;
                                    if event_type == "TTSEnded" && input_finished {
                                        break Ok(());
                                    }
                                    if event_type == "error" {
                                        break Err("Omni Realtime 会话失败: error".to_string());
                                    }
                                }
                            }
                            Err(error) => {
                                emit_realtime_event(
                                    &app,
                                    build_error_event_payload(
                                        &session_id,
                                        &default_model,
                                        format!("Omni Realtime JSON 解析失败: {error}"),
                                    ),
                                ).await;
                            }
                        }
                    }
                    Some(Ok(Message::Binary(binary))) => {
                        if let Ok(text) = String::from_utf8(binary.to_vec()) {
                            if let Ok(json_message) = serde_json::from_str::<Value>(&text) {
                                if let Some(payload) = map_server_event_to_payload(&session_id, &default_model, &json_message) {
                                    let event_type = payload.event_type.clone();
                                    emit_realtime_event(&app, payload).await;
                                    if event_type == "TTSEnded" && input_finished {
                                        break Ok(());
                                    }
                                    if event_type == "error" {
                                        break Err("Omni Realtime 会话失败: error".to_string());
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            break Err(format!("Omni Realtime Pong 发送失败: {error}"));
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(close_frame))) => {
                        if input_finished {
                            break Ok(());
                        }
                        let close_reason = close_frame
                            .map(|frame| {
                                format!(
                                    "close_code={}, close_reason={}",
                                    u16::from(frame.code),
                                    frame.reason
                                )
                            })
                            .unwrap_or_else(|| "close_frame=none".to_string());
                        break Err(format!(
                            "Omni Realtime 会话被服务端提前关闭（{close_reason}）"
                        ));
                    }
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => {
                        break Err(format!("Omni Realtime WebSocket 读取失败: {error}"));
                    }
                    None => {
                        if input_finished {
                            break Ok(());
                        }
                        break Err(
                            "Omni Realtime WebSocket 已结束（未收到可用 close reason）".to_string(),
                        );
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
pub async fn omni_realtime_session_start(
    app: AppHandle,
    config: QwenOmniRealtimeConfig,
    state: State<'_, Arc<QwenOmniRealtimeSessionState>>,
) -> Result<String, String> {
    let ws_stream = connect_realtime_ws(&config).await?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let default_model = resolve_model_version(&config);
    let (write, read) = ws_stream.split();

    let (command_tx, command_rx) = mpsc::unbounded_channel();
    let session = Arc::new(OmniRealtimeSession { command_tx });
    let shared_state = Arc::clone(state.inner());
    shared_state
        .insert_session(session_id.clone(), Arc::clone(&session))
        .await;

    tauri::async_runtime::spawn(run_omni_realtime_session(
        app,
        Arc::clone(&shared_state),
        session_id.clone(),
        default_model,
        write,
        read,
        command_rx,
        config,
    ));

    Ok(session_id)
}

#[tauri::command]
pub async fn omni_realtime_session_push(
    session_id: String,
    audio_data: Vec<u8>,
    state: State<'_, Arc<QwenOmniRealtimeSessionState>>,
) -> Result<(), String> {
    if audio_data.is_empty() {
        return Ok(());
    }

    let Some(session) = state.get_session(&session_id).await else {
        // Session might already be closed by server; treat late audio chunks as no-op.
        // 会话可能已被服务端关闭；后续尾随音频按 no-op 处理，避免前端报错风暴。
        return Ok(());
    };
    let (ack_tx, ack_rx) = oneshot::channel();
    session
        .command_tx
        .send(OmniRealtimeCommand::Push { audio_data, ack_tx })
        .map_err(|_| format!("Omni Realtime 会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("Omni Realtime push 确认通道已关闭: {session_id}"))?
}

#[tauri::command]
pub async fn omni_realtime_session_finish(
    session_id: String,
    audio_data: Vec<u8>,
    state: State<'_, Arc<QwenOmniRealtimeSessionState>>,
) -> Result<(), String> {
    let Some(session) = state.get_session(&session_id).await else {
        // Session might already be closed by server; treat finish as no-op.
        // 会话可能已被服务端关闭；finish 按 no-op 处理，避免重复报错。
        return Ok(());
    };
    let (ack_tx, ack_rx) = oneshot::channel();
    session
        .command_tx
        .send(OmniRealtimeCommand::Finish { audio_data, ack_tx })
        .map_err(|_| format!("Omni Realtime 会话已关闭: {session_id}"))?;

    ack_rx
        .await
        .map_err(|_| format!("Omni Realtime finish 确认通道已关闭: {session_id}"))?
}

#[tauri::command]
pub async fn omni_realtime_session_cancel(
    session_id: String,
    state: State<'_, Arc<QwenOmniRealtimeSessionState>>,
) -> Result<(), String> {
    let Some(session) = state.remove_session(&session_id).await else {
        return Ok(());
    };

    let _ = session.command_tx.send(OmniRealtimeCommand::Cancel);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{Duration, Instant},
    };

    use base64::Engine as _;
    use futures_util::{SinkExt, StreamExt};

    use super::{
        build_session_update_event, connect_realtime_ws, map_server_event_to_payload,
        send_json_event, QwenOmniRealtimeConfig,
    };
    use serde_json::json;
    use tungstenite::Message;

    fn build_test_config() -> QwenOmniRealtimeConfig {
        QwenOmniRealtimeConfig {
            provider: "qwen-omni-realtime".to_string(),
            model_version: "qwen3.5-omni-plus-realtime".to_string(),
            sample_rate: 16000,
            language: Some("zh-CN".to_string()),
            api_key: Some("test-key".to_string()),
            websocket_url: Some("wss://dashscope.aliyuncs.com/api-ws/v1/realtime".to_string()),
            speaker: Some("Ethan".to_string()),
            instructions: Some("你是测试助手".to_string()),
            input_mode: Some("push_to_talk".to_string()),
            enable_search: Some(true),
            search_options: Some(super::QwenOmniRealtimeSearchOptions {
                enable_source: Some(true),
            }),
            tools: Some(vec![json!({
                "type": "function",
                "name": "get_weather",
                "description": "Get weather by city",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": { "type": "string" }
                    },
                    "required": ["city"]
                }
            })]),
            tool_choice: Some(json!({"type": "auto"})),
        }
    }

    fn read_online_smoke_env(keys: &[&str]) -> Option<String> {
        keys.iter().find_map(|key| {
            std::env::var(key).ok().and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
        })
    }

    fn require_online_smoke_env(keys: &[&str]) -> String {
        read_online_smoke_env(keys).unwrap_or_else(|| {
            panic!(
                "missing online smoke env, expected one of: {}（缺少在线 smoke 环境变量）",
                keys.join(", ")
            )
        })
    }

    fn resolve_online_smoke_fixture_path() -> PathBuf {
        let fixture = read_online_smoke_env(&[
            "EXOMIND_VOICE_RUNTIME_SMOKE_FIXTURE",
            "OMNI_REALTIME_SMOKE_FIXTURE",
        ])
        .unwrap_or_else(|| "public/dev-assets/voice-runtime/codex-smoke-short.pcm".to_string());
        let fixture_path = PathBuf::from(&fixture);
        if fixture_path.is_file() {
            return fixture_path;
        }

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let manifest_relative = manifest_dir.join(&fixture);
        if manifest_relative.is_file() {
            return manifest_relative;
        }

        let workspace_relative = manifest_dir.join("..").join(&fixture);
        if workspace_relative.is_file() {
            return workspace_relative;
        }

        fixture_path
    }

    #[test]
    fn build_session_update_event_includes_search_and_tools() {
        let event = build_session_update_event(&build_test_config());
        let session = event.get("session").expect("session payload should exist");

        assert_eq!(
            session.get("enable_search"),
            Some(&json!(true)),
            "enable_search should be forwarded"
        );
        assert_eq!(
            session.get("search_options"),
            Some(&json!({ "enable_source": true })),
            "search_options should be forwarded"
        );
        assert_eq!(
            session
                .get("tools")
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(1),
            "tools should include configured function schema"
        );
        assert_eq!(
            session.get("tool_choice"),
            Some(&json!({ "type": "auto" })),
            "tool_choice should be forwarded"
        );
    }

    #[test]
    fn map_function_call_arguments_events() {
        let delta_payload = map_server_event_to_payload(
            "session-1",
            "qwen3.5-omni-plus-realtime",
            &json!({
                "type": "response.function_call_arguments.delta",
                "call_id": "call-1",
                "name": "get_weather",
                "delta": "{\"city\":\"Bei"
            }),
        )
        .expect("delta event should be mapped");
        assert_eq!(delta_payload.event_type, "ToolCallDelta");
        assert_eq!(
            delta_payload
                .payload
                .as_ref()
                .and_then(|payload| payload.get("call_id"))
                .and_then(|value| value.as_str()),
            Some("call-1")
        );

        let done_payload = map_server_event_to_payload(
            "session-1",
            "qwen3.5-omni-plus-realtime",
            &json!({
                "type": "response.function_call_arguments.done",
                "call_id": "call-1",
                "name": "get_weather",
                "arguments": "{\"city\":\"Beijing\"}"
            }),
        )
        .expect("done event should be mapped");
        assert_eq!(done_payload.event_type, "ToolCallDone");
        assert_eq!(
            done_payload
                .payload
                .as_ref()
                .and_then(|payload| payload.get("arguments"))
                .and_then(|value| value.as_str()),
            Some("{\"city\":\"Beijing\"}")
        );
    }

    #[test]
    fn map_response_done_function_call_to_tool_call_done() {
        let payload = map_server_event_to_payload(
            "session-1",
            "qwen3.5-omni-plus-realtime",
            &json!({
                "type": "response.done",
                "response": {
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "call-2",
                            "name": "search_web",
                            "arguments": "{\"query\":\"ExoMind\"}"
                        }
                    ]
                }
            }),
        )
        .expect("response.done should be mapped");

        assert_eq!(payload.event_type, "ToolCallDone");
        assert_eq!(
            payload
                .payload
                .as_ref()
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str()),
            Some("search_web")
        );
    }

    #[test]
    #[ignore = "requires DASHSCOPE_API_KEY and live DashScope endpoint（需要 DASHSCOPE_API_KEY 与在线 DashScope 连接）"]
    fn omni_realtime_online_smoke_with_real_api() {
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
            assert!(
                !fixture_bytes.is_empty(),
                "online smoke fixture should not be empty（在线 smoke 音频样本不应为空）"
            );

            let config = QwenOmniRealtimeConfig {
                provider: "qwen-omni-realtime".to_string(),
                model_version: read_online_smoke_env(&[
                    "EXOMIND_VOICE_RUNTIME_OMNI_MODEL",
                    "QWEN_OMNI_REALTIME_MODEL",
                ])
                .unwrap_or_else(|| "qwen3.5-omni-plus-realtime".to_string()),
                sample_rate: 16000,
                language: Some("zh-CN".to_string()),
                api_key: Some(require_online_smoke_env(&[
                    "DASHSCOPE_API_KEY",
                    "EXOMIND_VOICE_RUNTIME_OMNI_API_KEY",
                ])),
                websocket_url: Some(
                    read_online_smoke_env(&[
                        "EXOMIND_VOICE_RUNTIME_OMNI_WEBSOCKET_URL",
                        "QWEN_OMNI_REALTIME_WEBSOCKET_URL",
                    ])
                    .unwrap_or_else(|| "wss://dashscope.aliyuncs.com/api-ws/v1/realtime".to_string()),
                ),
                speaker: Some("Ethan".to_string()),
                instructions: Some(
                    "你是 ExoMind 的实时语音助手，请简洁回答并在可能时调用函数。".to_string(),
                ),
                input_mode: Some("push_to_talk".to_string()),
                enable_search: Some(true),
                search_options: Some(super::QwenOmniRealtimeSearchOptions {
                    enable_source: Some(true),
                }),
                tools: Some(vec![json!({
                    "type": "function",
                    "name": "get_weather",
                    "description": "Get weather by city",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "city": { "type": "string" }
                        },
                        "required": ["city"]
                    }
                })]),
                tool_choice: Some(json!({"type": "auto"})),
            };

            let ws_stream = connect_realtime_ws(&config)
                .await
                .expect("live websocket should connect（真实 WebSocket 应可连接）");
            let (mut write, mut read) = ws_stream.split();

            send_json_event(&mut write, build_session_update_event(&config))
                .await
                .expect("session.update should send（session.update 应可发送）");

            let started_at = Instant::now();
            let mut event_types: Vec<String> = Vec::new();
            let mut session_started = false;
            let mut response_done = false;
            let mut tool_call_seen = false;
            let mut chat_text = String::new();
            let mut response_audio_bytes = 0usize;
            let mut smoke_input_sent = false;

            while started_at.elapsed() < Duration::from_secs(30) {
                let next_message = tokio::time::timeout(Duration::from_secs(5), read.next())
                    .await
                    .expect("read timeout should not elapse（读取超时不应触发）");

                let Some(message_result) = next_message else {
                    break;
                };

                let message = message_result.expect("websocket message should succeed（WebSocket 消息应成功）");
                match message {
                    Message::Text(text) => {
                        let event = serde_json::from_str::<serde_json::Value>(&text)
                            .expect("text frame should be valid json（文本帧应为 JSON）");
                        let event_type = event
                            .get("type")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !event_type.is_empty() {
                            event_types.push(event_type.clone());
                        }

                        match event_type.as_str() {
                            "session.created" | "session.updated" => {
                                session_started = true;
                                if !smoke_input_sent {
                                    for chunk in fixture_bytes.chunks(3200) {
                                        send_json_event(
                                            &mut write,
                                            json!({
                                                "event_id": format!("event_{}", uuid::Uuid::new_v4()),
                                                "type": "input_audio_buffer.append",
                                                "audio": base64::engine::general_purpose::STANDARD.encode(chunk),
                                            }),
                                        )
                                        .await
                                        .expect("input_audio_buffer.append should send（append 音频事件应可发送）");
                                        tokio::time::sleep(Duration::from_millis(10)).await;
                                    }

                                    send_json_event(
                                        &mut write,
                                        json!({
                                            "event_id": format!("event_{}", uuid::Uuid::new_v4()),
                                            "type": "input_audio_buffer.commit",
                                        }),
                                    )
                                    .await
                                    .expect("input_audio_buffer.commit should send（commit 音频事件应可发送）");

                                    send_json_event(
                                        &mut write,
                                        json!({
                                            "event_id": format!("event_{}", uuid::Uuid::new_v4()),
                                            "type": "response.create",
                                        }),
                                    )
                                    .await
                                    .expect("response.create should send（response.create 应可发送）");

                                    smoke_input_sent = true;
                                }
                            }
                            "response.audio_transcript.delta" | "response.text.delta" => {
                                if let Some(delta) = event.get("delta").and_then(|value| value.as_str()) {
                                    chat_text.push_str(delta);
                                }
                            }
                            "response.audio_transcript.done" => {
                                if let Some(transcript) =
                                    event.get("transcript").and_then(|value| value.as_str())
                                {
                                    chat_text.push_str(transcript);
                                }
                            }
                            "response.text.done" => {
                                if let Some(text) = event.get("text").and_then(|value| value.as_str()) {
                                    chat_text.push_str(text);
                                }
                            }
                            "response.function_call_arguments.delta"
                            | "response.function_call_arguments.done" => {
                                tool_call_seen = true;
                            }
                            "response.output_item.added" | "response.output_item.done" => {
                                let is_function_call = event
                                    .get("item")
                                    .and_then(|value| value.get("type"))
                                    .and_then(|value| value.as_str())
                                    .is_some_and(|value| value == "function_call");
                                if is_function_call {
                                    tool_call_seen = true;
                                }
                            }
                            "response.done" => {
                                response_done = true;
                                let has_function_call = event
                                    .get("response")
                                    .and_then(|value| value.get("output"))
                                    .and_then(|value| value.as_array())
                                    .is_some_and(|items| {
                                        items.iter().any(|item| {
                                            item.get("type")
                                                .and_then(|value| value.as_str())
                                                .is_some_and(|value| value == "function_call")
                                        })
                                    });
                                if has_function_call {
                                    tool_call_seen = true;
                                }
                            }
                            "response.audio.delta" => {
                                if let Some(encoded_audio) = event.get("delta").and_then(|value| value.as_str()) {
                                    if let Ok(decoded_audio) = base64::engine::general_purpose::STANDARD
                                        .decode(encoded_audio.as_bytes())
                                    {
                                        response_audio_bytes += decoded_audio.len();
                                    }
                                }
                            }
                            "error" => {
                                panic!(
                                    "online smoke received error event（在线 smoke 收到错误事件）: {}",
                                    event
                                );
                            }
                            _ => {}
                        }
                    }
                    Message::Binary(binary) => {
                        if let Ok(text) = String::from_utf8(binary.to_vec()) {
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                                let event_type = event
                                    .get("type")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if !event_type.is_empty() {
                                    event_types.push(event_type.clone());
                                }
                                if event_type == "session.created" || event_type == "session.updated" {
                                    session_started = true;
                                }
                                if event_type == "error" {
                                    panic!(
                                        "online smoke received binary error event（在线 smoke 收到错误二进制事件）: {}",
                                        event
                                    );
                                }
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        write
                            .send(Message::Pong(payload))
                            .await
                            .expect("pong should send（Pong 应可发送）");
                    }
                    Message::Pong(_) | Message::Frame(_) => {}
                    Message::Close(_) => break,
                }

                if response_done && (tool_call_seen || !chat_text.trim().is_empty()) {
                    break;
                }
                if response_audio_bytes > 0 && response_done {
                    break;
                }
            }

            let _ = write.close().await;

            println!(
                "omni-online-smoke summary: sessionStarted={} inputSent={} responseDone={} toolCallSeen={} chatChars={} audioBytes={} events={:?}",
                session_started,
                smoke_input_sent,
                response_done,
                tool_call_seen,
                chat_text.chars().count(),
                response_audio_bytes,
                event_types
            );

            assert!(
                session_started,
                "should receive session lifecycle event（应收到 session 生命周期事件）"
            );
            assert!(
                smoke_input_sent,
                "should send online smoke input after session created（session 创建后应成功发送音频输入）"
            );
            assert!(
                response_done
                    || tool_call_seen
                    || !chat_text.trim().is_empty()
                    || response_audio_bytes > 0,
                "should receive model response or tool-call signal（应收到模型响应或工具调用信号）"
            );
        });
    }
}
