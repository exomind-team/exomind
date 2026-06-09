use std::sync::Arc;

use tracing::warn;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

const LINK_PROOF_REQUEST_TOPIC: &str = "system.link_proof.request";
const LINK_PROOF_ACK_TOPIC: &str = "system.link_proof.ack";

/// Spawn the link proof actor（启动链路验证 Actor）.
/// 当前职责只包含 request -> receipt 自动回执。
pub fn spawn_link_proof_actor(
    pool: Arc<SignalPool>,
    local_host_id: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != LINK_PROOF_REQUEST_TOPIC {
                        continue;
                    }
                    handle_link_proof_request(&pool, &local_host_id, &event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "link_proof_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("link_proof_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_link_proof_request(pool: &SignalPool, local_host_id: &str, event: &SignalEvent) {
    let target_peer_id = match event
        .payload
        .get("target_peer_id")
        .and_then(|value| value.as_str())
    {
        Some(value) if value == local_host_id => value,
        _ => return,
    };

    let Some(proof_session_id) = event
        .payload
        .get("proof_session_id")
        .and_then(|value| value.as_str())
    else {
        warn!(
            event_id = %event.id,
            "link_proof_actor: missing proof_session_id, skipping receipt ack"
        );
        return;
    };

    let Some(attempt_id) = event
        .payload
        .get("attempt_id")
        .and_then(|value| value.as_str())
    else {
        warn!(
            event_id = %event.id,
            "link_proof_actor: missing attempt_id, skipping receipt ack"
        );
        return;
    };

    let Some(initiated_by_peer_id) = event
        .payload
        .get("initiated_by_peer_id")
        .and_then(|value| value.as_str())
    else {
        warn!(
            event_id = %event.id,
            "link_proof_actor: missing initiated_by_peer_id, skipping receipt ack"
        );
        return;
    };

    let ack_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: LINK_PROOF_ACK_TOPIC.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "actor:link_proof".to_string(),
        origin_host_id: local_host_id.to_string(),
        hop: event.hop.saturating_add(1),
        trace_id: event.trace_id.clone(),
        payload: serde_json::json!({
            "proof_session_id": proof_session_id,
            "attempt_id": attempt_id,
            "initiated_by_peer_id": initiated_by_peer_id,
            "target_peer_id": initiated_by_peer_id,
            "receipt_for_target_peer_id": target_peer_id,
            "ack_kind": "receipt",
            "acked_by_peer_id": local_host_id,
            "completed_at_ms": chrono::Utc::now().timestamp_millis() as u64
        }),
    };

    pool.publish(ack_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const LOCAL_HOST_ID: &str = "host-desktop";
    const REMOTE_HOST_ID: &str = "host-phone";

    fn make_request(target_peer_id: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: LINK_PROOF_REQUEST_TOPIC.to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "ui:pairing".to_string(),
            origin_host_id: REMOTE_HOST_ID.to_string(),
            hop: 0,
            trace_id: Some("trace-link-proof".to_string()),
            payload: serde_json::json!({
                "proof_session_id": "proof-session-1",
                "attempt_id": "attempt-1",
                "initiated_by_peer_id": REMOTE_HOST_ID,
                "target_peer_id": target_peer_id,
                "trigger": "pairing_auto",
                "sent_at_ms": 1710000000000u64
            }),
        }
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn link_proof_actor_publishes_receipt_for_targeted_local_request() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_link_proof_actor(Arc::clone(&pool), LOCAL_HOST_ID.to_string());
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_request(LOCAL_HOST_ID));

        let first = rx.recv().await.expect("should receive original request");
        assert_eq!(first.topic, LINK_PROOF_REQUEST_TOPIC);

        let second = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for link proof receipt ack")
            .expect("should receive receipt ack");

        assert_eq!(second.topic, "system.link_proof.ack");
        assert_eq!(second.source, "actor:link_proof");
        assert_eq!(second.origin_host_id, LOCAL_HOST_ID);
        assert_eq!(second.trace_id, Some("trace-link-proof".to_string()));
        assert_eq!(second.payload["proof_session_id"], "proof-session-1");
        assert_eq!(second.payload["attempt_id"], "attempt-1");
        assert_eq!(second.payload["initiated_by_peer_id"], REMOTE_HOST_ID);
        assert_eq!(second.payload["target_peer_id"], REMOTE_HOST_ID);
        assert_eq!(second.payload["acked_by_peer_id"], LOCAL_HOST_ID);
        assert_eq!(second.payload["ack_kind"], "receipt");
        assert!(
            second.payload["completed_at_ms"].is_number(),
            "receipt ack should include completed_at_ms（完成时间戳）"
        );
    }

    #[tokio::test]
    async fn link_proof_actor_ignores_non_targeted_request() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_link_proof_actor(Arc::clone(&pool), LOCAL_HOST_ID.to_string());
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_request("host-tablet"));

        let first = rx.recv().await.expect("should receive original request");
        assert_eq!(first.topic, LINK_PROOF_REQUEST_TOPIC);

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(
            result.is_err(),
            "non-targeted request should not emit receipt ack"
        );
    }
}
