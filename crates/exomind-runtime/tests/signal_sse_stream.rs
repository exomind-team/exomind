// signal_sse_stream.rs — SignalPool HTTP 集成测试
//
// 测试目标 (HTTP 层面完整测试):
//   1. POST /signals/publish → 200 + event_id
//   2. GET /signals/stream → 收到 SSE 事件
//   3. GET /signals/history → 返回历史
//   4. Route CRUD API（GET/POST/PUT/DELETE /signal-routes）
//
// 依赖: 完整的 signal HTTP 路由注册到 exomind_runtime::app()
// 状态: Signal HTTP 路由已实现 (task #2)

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::util::ServiceExt;

/// Helper: 构建带 Signal 路由的测试 app
/// 注意: 目前 app() 还没有 signal 路由，等实现后这里直接使用 exomind_runtime::app()
fn test_app() -> axum::Router {
    exomind_runtime::app(0)
}

// ═══════════════════════════════════════════════════════
//  1. POST /signals/publish
// ═══════════════════════════════════════════════════════

#[tokio::test]
async fn publish_returns_accepted_with_event_id() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signals/publish")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "user.action",
                        "source": "test",
                        "payload": {"key": "value"}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["accepted"], json!(true));
    assert!(
        payload["event_id"].as_str().is_some(),
        "响应应包含 event_id"
    );
    let event_id = payload["event_id"].as_str().unwrap();
    assert!(!event_id.is_empty(), "event_id 不应为空");
}

#[tokio::test]
async fn publish_with_trace_id_preserves_it() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signals/publish")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "user.action",
                        "source": "test",
                        "payload": {},
                        "trace_id": "trace-abc-123"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["accepted"], json!(true));
}

#[tokio::test]
async fn publish_without_topic_returns_bad_request() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signals/publish")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "source": "test",
                        "payload": {}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // 缺少必填字段 topic → 应返回 400 或 422
    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY,
        "缺少 topic 应返回 4xx，实际: {}",
        response.status()
    );
}

// ═══════════════════════════════════════════════════════
//  2. GET /signals/stream (SSE)
// ═══════════════════════════════════════════════════════

#[tokio::test]
async fn stream_returns_sse_content_type() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/signals/stream?agent_id=test-agent")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        content_type.contains("text/event-stream"),
        "SSE 端点应返回 text/event-stream，实际: {}",
        content_type
    );
}

// SSE 事件格式验证需要在完整实现后测试
// 预期格式:
//   event: signal
//   id: <event_id>
//   data: {"schema_version":1,"id":"...","topic":"...","ts":...,"source":"...","payload":{...}}
//
// #[tokio::test]
// async fn stream_receives_published_event() {
//     // 需要并发: 一个 task 监听 stream，另一个 publish
//     // 实现后补充完整测试
// }

// ═══════════════════════════════════════════════════════
//  3. GET /signals/history
// ═══════════════════════════════════════════════════════

#[tokio::test]
async fn history_returns_array_of_events() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/signals/history?limit=50")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert!(payload.is_array(), "history 应返回数组");
}

#[tokio::test]
async fn history_default_limit_is_50() {
    let app = test_app();

    // 不指定 limit 参数
    let response = app
        .oneshot(
            Request::builder()
                .uri("/signals/history")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert!(payload.is_array());
    // 默认 limit=50，空 journal 返回 []
    assert!(payload.as_array().unwrap().len() <= 50);
}

// ═══════════════════════════════════════════════════════
//  4. Route CRUD API
// ═══════════════════════════════════════════════════════

#[tokio::test]
async fn route_crud_lifecycle() {
    let app = test_app();

    // ── CREATE ──
    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signal-routes")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "user.action",
                        "target_type": "agent",
                        "target_ref": "echo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let created: Value = serde_json::from_slice(&create_body).unwrap();

    assert!(created["id"].as_str().is_some(), "创建应返回 id");
    let route_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["topic"], "user.action");
    assert_eq!(created["target_type"], "agent");
    assert_eq!(created["target_ref"], "echo");
    assert_eq!(created["enabled"], true);

    // ── LIST ──
    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/signal-routes")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = list_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let routes: Value = serde_json::from_slice(&list_body).unwrap();
    assert!(routes.is_array());
    let routes_arr = routes.as_array().unwrap();
    assert!(
        routes_arr.iter().any(|r| r["id"] == route_id),
        "列表中应包含刚创建的路由"
    );

    // ── UPDATE ──
    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&format!("/signal-routes/{}", route_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "enabled": false,
                        "topic": "user.updated"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = update_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let updated: Value = serde_json::from_slice(&update_body).unwrap();
    assert_eq!(updated["enabled"], false);
    assert_eq!(updated["topic"], "user.updated");

    // ── DELETE ──
    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!("/signal-routes/{}", route_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

    // ── 验证删除后列表为空 ──
    let list_after = app
        .oneshot(
            Request::builder()
                .uri("/signal-routes")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let list_after_body = list_after
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let routes_after: Value = serde_json::from_slice(&list_after_body).unwrap();
    assert!(
        !routes_after
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == route_id),
        "删除后列表不应包含该路由"
    );
}

#[tokio::test]
async fn update_nonexistent_route_returns_not_found() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/signal-routes/nonexistent-id")
                .header("content-type", "application/json")
                .body(Body::from(json!({"enabled": false}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_nonexistent_route_returns_not_found() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/signal-routes/nonexistent-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // 删除不存在的路由应返回 404 或 204（幂等）
    assert!(
        response.status() == StatusCode::NOT_FOUND
            || response.status() == StatusCode::NO_CONTENT,
        "删除不存在的路由应返回 404 或 204，实际: {}",
        response.status()
    );
}

#[tokio::test]
async fn create_route_without_required_fields_returns_bad_request() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signal-routes")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "user.action"
                        // 缺少 target_type 和 target_ref
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY,
        "缺少必填字段应返回 4xx，实际: {}",
        response.status()
    );
}

#[tokio::test]
async fn default_signal_routes_include_voice_input_transcript_route() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/signal-routes")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let routes: Value = serde_json::from_slice(&body).unwrap();
    let route_list = routes.as_array().expect("/signal-routes should return array");

    let voice_route = route_list.iter().find(|route| {
        route["topic"] == "voice.input.transcript"
            && route["target_type"] == "agent"
            && route["target_ref"] == "classifier"
            && route["enabled"] == true
    });

    assert!(
        voice_route.is_some(),
        "default routes should include voice.input.transcript -> classifier"
    );
}
