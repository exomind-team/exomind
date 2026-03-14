//! WebSocket 客户端命令
//! 用于连接远程 WebSocket 服务器（手机端连接电脑端）

use futures::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::Mutex;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::{connect_async, WebSocketStream};
use tungstenite::Message;
use url::Url;

/// WebSocket 连接状态
#[derive(Debug, Clone)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected(String), // URL
}

/// WebSocket 客户端状态
pub struct WsClientState {
    pub state: Mutex<ConnectionState>,
    pub stream: Mutex<Option<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>>>,
    pub seen_ack_keys: Mutex<HashSet<String>>,
}

impl Default for WsClientState {
    fn default() -> Self {
        Self {
            state: Mutex::new(ConnectionState::Disconnected),
            stream: Mutex::new(None),
            seen_ack_keys: Mutex::new(HashSet::new()),
        }
    }
}

/// 连接 WebSocket 服务器
#[tauri::command]
pub async fn ws_connect<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    client_state: State<'_, Arc<WsClientState>>,
) -> Result<String, String> {
    let mut state_guard = client_state.state.lock().await;

    // 检查是否已连接
    if let ConnectionState::Connected(ref current_url) = *state_guard {
        if current_url == &url {
            return Ok("Already connected".to_string());
        }
    }

    // 设置连接中状态
    *state_guard = ConnectionState::Connecting;

    // 解析 URL
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    // 建立连接
    let (ws_stream, response) = connect_async(parsed_url)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    log::info!("Connected to {}, response: {:?}", url, response.status());

    // 保存流
    let mut stream_guard = client_state.stream.lock().await;
    *stream_guard = Some(ws_stream);

    // 设置已连接状态
    *state_guard = ConnectionState::Connected(url.clone());

    // 启动消息接收线程
    let client_state_clone = Arc::clone(&client_state);
    let app_clone = app.clone();
    tokio::spawn(async move {
        receive_messages(app_clone, client_state_clone).await;
    });

    Ok(format!("Connected to {}", url))
}

/// 断开 WebSocket 连接
#[tauri::command]
pub async fn ws_disconnect<R: Runtime>(
    _app: AppHandle<R>,
    client_state: State<'_, Arc<WsClientState>>,
) -> Result<String, String> {
    let mut state_guard = client_state.state.lock().await;
    let mut stream_guard = client_state.stream.lock().await;

    // 关闭流
    if let Some(ref mut ws_stream) = *stream_guard {
        ws_stream.close(None).await.ok();
        *stream_guard = None;
    }

    *state_guard = ConnectionState::Disconnected;

    Ok("Disconnected".to_string())
}

/// 发送 WebSocket 消息
#[tauri::command]
pub async fn ws_send<R: Runtime>(
    _app: AppHandle<R>,
    message: String,
    client_state: State<'_, Arc<WsClientState>>,
) -> Result<(), String> {
    let state_guard = client_state.state.lock().await;

    match &*state_guard {
        ConnectionState::Connected(_) => {
            let mut stream_guard = client_state.stream.lock().await;
            if let Some(ref mut ws_stream) = *stream_guard {
                ws_stream
                    .send(Message::Text(message))
                    .await
                    .map_err(|e| format!("Send failed: {}", e))?;
                return Ok(());
            }
            Err("Stream not available".to_string())
        }
        ConnectionState::Connecting => Err("Still connecting".to_string()),
        ConnectionState::Disconnected => Err("Not connected".to_string()),
    }
}

/// 获取连接状态
#[tauri::command]
pub async fn ws_get_state<R: Runtime>(
    _app: AppHandle<R>,
    client_state: State<'_, Arc<WsClientState>>,
) -> Result<String, String> {
    let state = client_state.state.lock().await;
    match &*state {
        ConnectionState::Connected(url) => Ok(format!("connected:{}", url)),
        ConnectionState::Connecting => Ok("connecting".to_string()),
        ConnectionState::Disconnected => Ok("disconnected".to_string()),
    }
}

/// 接收消息的异步任务
async fn receive_messages<R: Runtime>(app: AppHandle<R>, client_state: Arc<WsClientState>) {
    // 获取流的拥有权
    let stream_opt = {
        let mut stream_guard = client_state.stream.lock().await;
        stream_guard.take()
    };

    if stream_opt.is_none() {
        return;
    }

    let mut ws_stream = stream_opt.unwrap();

    while let Some(msg_result) = ws_stream.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                log::trace!("Received message: {}", text);
                app.emit("ws-message", &text).ok();

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let payload = json.get("payload");
                    let message_id = payload
                        .and_then(|p| p.get("messageId"))
                        .and_then(|v| v.as_str())
                        .or_else(|| json.get("messageId").and_then(|v| v.as_str()));

                    if let Some(message_id) = message_id {
                        let event_id = payload
                            .and_then(|p| p.get("event_id"))
                            .and_then(|v| v.as_str());
                        let client_nonce = payload
                            .and_then(|p| p.get("client_nonce"))
                            .and_then(|v| v.as_str());

                        let dedup_key = client_nonce
                            .map(|nonce| format!("nonce:{}", nonce))
                            .unwrap_or_else(|| format!("message:{}", message_id));

                        let mut seen_ack_keys = client_state.seen_ack_keys.lock().await;
                        if seen_ack_keys.insert(dedup_key) {
                            let ack_payload = serde_json::json!({
                                "messageId": message_id,
                                "event_id": event_id,
                                "client_nonce": client_nonce,
                            });
                            app.emit("ws-ack", ack_payload).ok();
                        }
                    }
                }
            }
            Ok(Message::Binary(data)) => {
                log::trace!("Received binary data: {} bytes", data.len());
            }
            Ok(Message::Ping(ping)) => {
                log::trace!("Received ping: {:?}", ping);
            }
            Ok(Message::Pong(pong)) => {
                log::trace!("Received pong: {:?}", pong);
            }
            Ok(Message::Close(close_frame)) => {
                log::info!("Connection closed: {:?}", close_frame);
                break;
            }
            Ok(Message::Frame(_)) => {
                // 内部帧类型，通常不需要处理
            }
            Err(e) => {
                log::warn!("WebSocket error: {}", e);
                break;
            }
        }
    }

    // 清理状态
    let mut state = client_state.state.lock().await;
    *state = ConnectionState::Disconnected;
}
