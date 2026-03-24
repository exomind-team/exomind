use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::util::ServiceExt;

fn test_app() -> axum::Router {
    exomind_runtime::app(0)
}

#[tokio::test]
async fn topology_exposes_host_id() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/topology")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert!(
        payload["host_id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "topology should expose host_id"
    );
}

#[tokio::test]
async fn mesh_peers_crud_roundtrip() {
    let app = test_app();

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/peers")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "id": "rt-b",
                        "base_url": "http://127.0.0.1:3002",
                        "enabled": true,
                        "capabilities": ["relay"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create.status(), StatusCode::CREATED);
    let create_body = create.into_body().collect().await.unwrap().to_bytes();
    let created: Value = serde_json::from_slice(&create_body).unwrap();
    assert_eq!(created["id"], "rt-b");
    assert_eq!(created["base_url"], "http://127.0.0.1:3002");

    let list = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/peers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let list_body = list.into_body().collect().await.unwrap().to_bytes();
    let peers: Value = serde_json::from_slice(&list_body).unwrap();
    assert!(
        peers
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["id"] == "rt-b")
    );

    let update = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mesh/peers/rt-b")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "base_url": "http://127.0.0.1:3200",
                        "enabled": false
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update.status(), StatusCode::OK);
    let update_body = update.into_body().collect().await.unwrap().to_bytes();
    let updated: Value = serde_json::from_slice(&update_body).unwrap();
    assert_eq!(updated["base_url"], "http://127.0.0.1:3200");
    assert_eq!(updated["enabled"], json!(false));

    let delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/mesh/peers/rt-b")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    let list_after = app
        .oneshot(
            Request::builder()
                .uri("/mesh/peers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let list_after_body = list_after.into_body().collect().await.unwrap().to_bytes();
    let peers_after: Value = serde_json::from_slice(&list_after_body).unwrap();
    assert!(
        !peers_after
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["id"] == "rt-b")
    );
}

#[tokio::test]
async fn signal_routes_accept_remote_target_type() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signal-routes")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "mesh.test",
                        "target_type": "remote",
                        "target_ref": "rt-b"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["target_type"], "remote");
    assert_eq!(payload["target_ref"], "rt-b");
}
