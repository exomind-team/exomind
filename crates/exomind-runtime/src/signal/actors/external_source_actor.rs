use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::{info, warn};

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

const EXTERNAL_INPUT_RECEIVED_TOPIC: &str = "external.input.received";
const EXTERNAL_SOURCE_NAME: &str = "actor:external_source";
const DEFAULT_DEDUP_CAPACITY: usize = 1000;
const WEFLOW_FETCH_PAGE_SIZE: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalSourceConfig {
    pub enabled: bool,
    pub poll_interval_secs: u64,
    pub weflow_base_url: String,
    pub watched_chatrooms: Vec<WatchedChatroom>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedChatroom {
    pub id: String,
    pub label: String,
}

impl Default for ExternalSourceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poll_interval_secs: 10,
            weflow_base_url: "http://127.0.0.1:5031".to_string(),
            watched_chatrooms: vec![
                WatchedChatroom {
                    id: "44880347605@chatroom".to_string(),
                    label: "collective-buffer".to_string(),
                },
                WatchedChatroom {
                    id: "43757039905@chatroom".to_string(),
                    label: "personal-external-buffer".to_string(),
                },
            ],
        }
    }
}

#[derive(Debug)]
struct DedupState {
    seen_keys: VecDeque<String>,
    last_seen_ts: HashMap<String, u64>,
    capacity: usize,
}

impl Default for DedupState {
    fn default() -> Self {
        Self {
            seen_keys: VecDeque::with_capacity(DEFAULT_DEDUP_CAPACITY),
            last_seen_ts: HashMap::new(),
            capacity: DEFAULT_DEDUP_CAPACITY,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct WeFlowMessagesResponse {
    success: bool,
    talker: String,
    #[serde(rename = "hasMore", default)]
    has_more: bool,
    messages: Vec<WeFlowMessage>,
}

#[derive(Debug, Clone, Deserialize)]
struct WeFlowMessage {
    #[serde(rename = "localId")]
    local_id: Option<u64>,
    #[serde(rename = "serverId")]
    server_id: Option<i64>,
    #[serde(rename = "localType")]
    local_type: Option<i64>,
    #[serde(rename = "createTime")]
    create_time: Option<u64>,
    #[serde(rename = "sortSeq")]
    sort_seq: Option<u64>,
    #[serde(rename = "senderUsername")]
    sender_username: Option<String>,
    content: Option<String>,
    #[serde(rename = "rawContent")]
    raw_content: Option<String>,
    #[serde(rename = "parsedContent")]
    parsed_content: Option<String>,
}

pub fn spawn_external_source_actor(
    pool: Arc<SignalPool>,
    config: ExternalSourceConfig,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if !config.enabled {
            info!("external_source_actor: disabled by config, exiting");
            return;
        }

        let client = Client::new();
        let mut dedup = DedupState::default();

        loop {
            for chatroom in &config.watched_chatrooms {
                if let Err(error) = poll_chatroom_once(
                    &client,
                    &pool,
                    &config.weflow_base_url,
                    chatroom,
                    &mut dedup,
                )
                .await
                {
                    warn!(
                        chatroom = %chatroom.id,
                        error = %error,
                        "external_source_actor: poll failed"
                    );
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(config.poll_interval_secs)).await;
        }
    })
}

async fn fetch_weflow_messages(
    client: &Client,
    base_url: &str,
    chatroom_id: &str,
    limit: usize,
    offset: usize,
) -> Result<WeFlowMessagesResponse, reqwest::Error> {
    let response = client
        .get(format!(
            "{}/api/v1/messages",
            base_url.trim_end_matches('/')
        ))
        .query(&[
            ("talker", chatroom_id),
            ("limit", &limit.min(500).to_string()),
            ("offset", &offset.to_string()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json::<WeFlowMessagesResponse>()
        .await?;

    if !response.success || response.talker != chatroom_id {
        return Ok(WeFlowMessagesResponse {
            success: false,
            talker: chatroom_id.to_string(),
            has_more: false,
            messages: Vec::new(),
        });
    }

    Ok(response)
}

async fn poll_chatroom_once(
    client: &Client,
    pool: &SignalPool,
    base_url: &str,
    chatroom: &WatchedChatroom,
    dedup: &mut DedupState,
) -> Result<usize, reqwest::Error> {
    let previous_last_seen = dedup.last_seen_ts.get(&chatroom.id).copied().unwrap_or(0);
    let mut latest_seen = previous_last_seen;
    let mut publishable = Vec::new();
    let mut offset = 0usize;

    loop {
        let page = fetch_weflow_messages(
            client,
            base_url,
            &chatroom.id,
            WEFLOW_FETCH_PAGE_SIZE,
            offset,
        )
        .await?;
        if page.messages.is_empty() {
            break;
        }

        let mut reached_old_messages = false;
        let page_len = page.messages.len();

        for message in page.messages {
            let timestamp_ms = message_timestamp_ms(&message);
            latest_seen = latest_seen.max(timestamp_ms);

            if timestamp_ms <= previous_last_seen {
                reached_old_messages = true;
                continue;
            }

            let Some(text) = extract_message_text(&message) else {
                continue;
            };

            if should_skip_text(&text, message.local_type) {
                continue;
            }

            let url = extract_first_url(&text);
            let dedup_key = build_dedup_key(chatroom, &message, timestamp_ms, &text);
            if dedup.seen_keys.iter().any(|key| key == &dedup_key) {
                continue;
            }

            publishable.push((timestamp_ms, message, text, url, dedup_key));
        }

        if reached_old_messages || !page.has_more {
            break;
        }

        offset += page_len;
    }

    if latest_seen > previous_last_seen {
        dedup.last_seen_ts.insert(chatroom.id.clone(), latest_seen);
    }

    publishable.sort_by_key(|(timestamp_ms, _, _, _, _)| *timestamp_ms);

    let mut published = 0;
    for (timestamp_ms, message, text, url, dedup_key) in publishable {
        remember_dedup_key(dedup, dedup_key.clone());
        let media_type = if url.is_some() { "link" } else { "text" };
        let sender = message
            .sender_username
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

        pool.publish(SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: EXTERNAL_INPUT_RECEIVED_TOPIC.to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: EXTERNAL_SOURCE_NAME.to_string(),
            origin_host_id: std::env::var("EXOMIND_RT_HOST_ID")
                .unwrap_or_else(|_| "rt-external-source".to_string()),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({
                "source_type": "wechat",
                "sender": sender,
                "text": text,
                "url": url,
                "media_type": media_type,
                "original_timestamp": timestamp_ms,
                "chatroom_id": chatroom.id,
                "dedup_key": dedup_key,
            }),
        });
        published += 1;
    }

    Ok(published)
}

fn message_timestamp_ms(message: &WeFlowMessage) -> u64 {
    message
        .sort_seq
        .or_else(|| {
            message
                .create_time
                .map(|seconds| seconds.saturating_mul(1000))
        })
        .unwrap_or(0)
}

fn extract_message_text(message: &WeFlowMessage) -> Option<String> {
    message
        .parsed_content
        .as_deref()
        .or(message.content.as_deref())
        .or(message.raw_content.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn should_skip_text(text: &str, local_type: Option<i64>) -> bool {
    if matches!(local_type, Some(kind) if kind != 1) {
        return true;
    }

    matches!(
        text,
        "[图片]" | "[视频]" | "[语音]" | "[动画表情]" | "[表情]" | "[文件]"
    ) || text.contains("撤回了一条消息")
}

fn extract_first_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| {
            part.trim_end_matches(|ch: char| {
                matches!(ch, ',' | '.' | ';' | ')' | ']' | '}' | '"' | '\'')
            })
            .to_string()
        })
}

fn build_dedup_key(
    chatroom: &WatchedChatroom,
    message: &WeFlowMessage,
    timestamp_ms: u64,
    text: &str,
) -> String {
    if let (Some(server_id), Some(local_id)) = (message.server_id, message.local_id) {
        return format!("{}:{}:{}", chatroom.id, server_id, local_id);
    }

    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    format!(
        "{}:{}:{}:{}",
        chatroom.id,
        timestamp_ms,
        message.sender_username.as_deref().unwrap_or("unknown"),
        &hash[..16]
    )
}

fn remember_dedup_key(dedup: &mut DedupState, key: String) {
    if dedup.seen_keys.len() >= dedup.capacity {
        dedup.seen_keys.pop_front();
    }
    dedup.seen_keys.push_back(key);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Json, Router, extract::Query, routing::get};
    use serde::Deserialize;
    use serde_json::json;
    use tokio::net::TcpListener;

    #[derive(Debug, Deserialize)]
    struct MessageQuery {
        talker: String,
        limit: Option<usize>,
        offset: Option<usize>,
    }

    async fn spawn_weflow_server(
        response: serde_json::Value,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/api/v1/messages",
            get(move |query: Query<MessageQuery>| {
                let response = response.clone();
                async move {
                    assert!(
                        !query.talker.is_empty(),
                        "talker query param should be present"
                    );
                    assert!(
                        query.limit.unwrap_or_default() > 0,
                        "limit should be positive"
                    );
                    let limit = query.limit.unwrap_or(20);
                    let offset = query.offset.unwrap_or(0);
                    let source_messages = response
                        .get("messages")
                        .and_then(|value| value.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let page = source_messages
                        .iter()
                        .skip(offset)
                        .take(limit)
                        .cloned()
                        .collect::<Vec<_>>();
                    Json(json!({
                        "success": response.get("success").cloned().unwrap_or(json!(true)),
                        "talker": response.get("talker").cloned().unwrap_or(json!(query.talker)),
                        "count": page.len(),
                        "hasMore": offset + page.len() < source_messages.len(),
                        "messages": page,
                    }))
                }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind test server");
        let addr = listener.local_addr().expect("should read local addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should run");
        });
        (format!("http://{}", addr), handle)
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    async fn recv_next(rx: &mut tokio::sync::broadcast::Receiver<SignalEvent>) -> SignalEvent {
        tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for signal")
            .expect("should receive signal")
    }

    #[tokio::test]
    async fn poll_chatroom_publishes_text_and_link_messages() {
        let (base_url, _server) = spawn_weflow_server(json!({
            "success": true,
            "talker": "room-1",
            "count": 3,
            "hasMore": false,
            "messages": [
                {
                    "localId": 3,
                    "serverId": 103,
                    "localType": 1,
                    "createTime": 1773809300,
                    "sortSeq": 1773809300000_u64,
                    "senderUsername": "wxid-c",
                    "content": "[图片]",
                    "rawContent": "wxid-c:\n[图片]",
                    "parsedContent": "[图片]"
                },
                {
                    "localId": 2,
                    "serverId": 102,
                    "localType": 1,
                    "createTime": 1773809200,
                    "sortSeq": 1773809200000_u64,
                    "senderUsername": "wxid-b",
                    "content": "See https://example.com/alpha",
                    "rawContent": "wxid-b:\nSee https://example.com/alpha",
                    "parsedContent": "See https://example.com/alpha"
                },
                {
                    "localId": 1,
                    "serverId": 101,
                    "localType": 1,
                    "createTime": 1773809100,
                    "sortSeq": 1773809100000_u64,
                    "senderUsername": "wxid-a",
                    "content": "hello from wechat",
                    "rawContent": "wxid-a:\nhello from wechat",
                    "parsedContent": "hello from wechat"
                }
            ]
        }))
        .await;

        let pool = Arc::new(SignalPool::new(None));
        let client = Client::new();
        let mut dedup = DedupState::default();
        let chatroom = WatchedChatroom {
            id: "room-1".to_string(),
            label: "room-1".to_string(),
        };
        let mut rx = pool.subscribe();

        let published = poll_chatroom_once(&client, &pool, &base_url, &chatroom, &mut dedup)
            .await
            .expect("poll should succeed");

        assert_eq!(published, 2, "image placeholder should be skipped");

        let first = recv_next(&mut rx).await;
        assert_eq!(first.topic, EXTERNAL_INPUT_RECEIVED_TOPIC);
        assert_eq!(first.source, EXTERNAL_SOURCE_NAME);
        assert_eq!(first.payload["chatroom_id"], "room-1");
        assert_eq!(first.payload["sender"], "wxid-a");
        assert_eq!(first.payload["text"], "hello from wechat");
        assert_eq!(first.payload["media_type"], "text");

        let second = recv_next(&mut rx).await;
        assert_eq!(second.topic, EXTERNAL_INPUT_RECEIVED_TOPIC);
        assert_eq!(second.payload["sender"], "wxid-b");
        assert_eq!(second.payload["text"], "See https://example.com/alpha");
        assert_eq!(second.payload["url"], "https://example.com/alpha");
        assert_eq!(second.payload["media_type"], "link");
    }

    #[tokio::test]
    async fn second_poll_skips_messages_that_were_already_seen() {
        let (base_url, _server) = spawn_weflow_server(json!({
            "success": true,
            "talker": "room-2",
            "count": 1,
            "hasMore": false,
            "messages": [
                {
                    "localId": 11,
                    "serverId": 201,
                    "localType": 1,
                    "createTime": 1773809400,
                    "sortSeq": 1773809400000_u64,
                    "senderUsername": "wxid-repeat",
                    "content": "same message",
                    "rawContent": "wxid-repeat:\nsame message",
                    "parsedContent": "same message"
                }
            ]
        }))
        .await;

        let pool = Arc::new(SignalPool::new(None));
        let client = Client::new();
        let mut dedup = DedupState::default();
        let chatroom = WatchedChatroom {
            id: "room-2".to_string(),
            label: "room-2".to_string(),
        };
        let mut rx = pool.subscribe();

        let first_count = poll_chatroom_once(&client, &pool, &base_url, &chatroom, &mut dedup)
            .await
            .expect("first poll should succeed");
        assert_eq!(first_count, 1);
        let first = recv_next(&mut rx).await;
        assert_eq!(first.payload["dedup_key"], "room-2:201:11");

        let second_count = poll_chatroom_once(&client, &pool, &base_url, &chatroom, &mut dedup)
            .await
            .expect("second poll should succeed");
        assert_eq!(
            second_count, 0,
            "same payload should not be published twice"
        );

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(
            result.is_err(),
            "second poll should not publish more events"
        );
    }

    #[tokio::test]
    async fn poll_chatroom_consumes_bursts_larger_than_single_page() {
        let messages = (0..25)
            .rev()
            .map(|index| {
                let sequence = index + 1;
                json!({
                    "localId": sequence,
                    "serverId": 5000 + sequence,
                    "localType": 1,
                    "createTime": 1773809000 + sequence,
                    "sortSeq": 1773809000000_u64 + (sequence as u64 * 1000),
                    "senderUsername": format!("wxid-{sequence}"),
                    "content": format!("burst-message-{sequence}"),
                    "rawContent": format!("wxid-{sequence}:\\nburst-message-{sequence}"),
                    "parsedContent": format!("burst-message-{sequence}")
                })
            })
            .collect::<Vec<_>>();

        let (base_url, _server) = spawn_weflow_server(json!({
            "success": true,
            "talker": "room-burst",
            "messages": messages,
        }))
        .await;

        let pool = Arc::new(SignalPool::new(None));
        let client = Client::new();
        let mut dedup = DedupState::default();
        let chatroom = WatchedChatroom {
            id: "room-burst".to_string(),
            label: "room-burst".to_string(),
        };
        let mut rx = pool.subscribe();

        let published = poll_chatroom_once(&client, &pool, &base_url, &chatroom, &mut dedup)
            .await
            .expect("burst poll should succeed");

        assert_eq!(
            published, 25,
            "poll should page through all unseen messages"
        );

        let mut received_texts = Vec::new();
        for _ in 0..25 {
            let event = recv_next(&mut rx).await;
            received_texts.push(
                event.payload["text"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            );
        }

        assert!(received_texts.contains(&"burst-message-1".to_string()));
        assert!(received_texts.contains(&"burst-message-25".to_string()));

        let second_count = poll_chatroom_once(&client, &pool, &base_url, &chatroom, &mut dedup)
            .await
            .expect("second burst poll should succeed");
        assert_eq!(
            second_count, 0,
            "cursor should advance only after full backlog is consumed"
        );
    }

    #[tokio::test]
    async fn disabled_actor_exits_without_polling() {
        let pool = Arc::new(SignalPool::new(None));
        let handle = spawn_external_source_actor(
            Arc::clone(&pool),
            ExternalSourceConfig {
                enabled: false,
                poll_interval_secs: 1,
                weflow_base_url: "http://127.0.0.1:5031".to_string(),
                watched_chatrooms: vec![WatchedChatroom {
                    id: "room-disabled".to_string(),
                    label: "room-disabled".to_string(),
                }],
            },
        );

        yield_for_actor().await;
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), handle).await;
        assert!(result.is_ok(), "disabled actor should exit quickly");
    }
}
