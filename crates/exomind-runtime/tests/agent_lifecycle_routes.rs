use axum::body::Body;
use axum::http::Request;
use exomind_runtime::agent::AgentRegistry;
use exomind_runtime::routes;
use exomind_runtime::signal::SignalPool;
use exomind_runtime::AppState;
use http_body_util::BodyExt;
use serde_json::Value;
use std::sync::Arc;
use tower::ServiceExt;

#[tokio::test]
async fn create_and_delete_runtime_agent_via_http_routes() {
    let state = AppState {
        port: 3919,
        registry: AgentRegistry::new(),
        signal_pool: Arc::new(SignalPool::new(None)),
    };
    let app = routes::router().with_state(state);

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/agents")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"kind":"echo","id":"echo-manual","name":"Manual Echo"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status().as_u16(), 201);

    let created_body = create_response.into_body().collect().await.unwrap().to_bytes();
    let created_payload: Value = serde_json::from_slice(&created_body).unwrap();
    assert_eq!(created_payload["id"], "echo-manual");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/agents")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status().as_u16(), 200);
    let list_body = list_response.into_body().collect().await.unwrap().to_bytes();
    let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_payload.as_array().unwrap().len(), 1);
    assert_eq!(list_payload[0]["id"], "echo-manual");

    let delete_response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/agents/echo-manual")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status().as_u16(), 200);
}
