use axum::body::Body;
use axum::http::Request;
use exomind_runtime::agent::AgentRegistry;
use exomind_runtime::mesh::MeshState;
use exomind_runtime::routes;
use exomind_runtime::signal::SignalPool;
use exomind_runtime::AppState;
use http_body_util::BodyExt;
use serde_json::Value;
use std::sync::Mutex;
use std::sync::Arc;
use tower::ServiceExt;

static CODEX_ENV_LOCK: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn create_and_delete_runtime_agent_via_http_routes() {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-agent-lifecycle".to_string();
    let state = AppState {
        port: 3919,
        host_id: host_id.clone(),
        registry: AgentRegistry::new(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(host_id, Arc::clone(&signal_pool), None)),
        mesh_relay: None,
        auth_secret: None,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        energy_registry: exomind_runtime::energy::EnergyRegistry::new(),
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

#[tokio::test]
async fn create_and_delete_codex_runtime_agent_via_http_routes() {
    let _guard = CODEX_ENV_LOCK.lock().unwrap();
    unsafe {
        std::env::set_var("EXOMIND_CODEX_COMMAND", env!("CARGO_BIN_EXE_fake-codex-cli"));
    }

    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-codex-lifecycle".to_string();
    let state = AppState {
        port: 3920,
        host_id: host_id.clone(),
        registry: AgentRegistry::new(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(host_id, Arc::clone(&signal_pool), None)),
        mesh_relay: None,
        auth_secret: None,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        energy_registry: exomind_runtime::energy::EnergyRegistry::new(),
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
                    r#"{"kind":"codex_cli","id":"codex-manual","name":"Manual Codex"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    unsafe {
        std::env::remove_var("EXOMIND_CODEX_COMMAND");
    }

    assert_eq!(create_response.status().as_u16(), 201);

    let created_body = create_response.into_body().collect().await.unwrap().to_bytes();
    let created_payload: Value = serde_json::from_slice(&created_body).unwrap();
    assert_eq!(created_payload["id"], "codex-manual");
    assert_eq!(created_payload["name"], "Manual Codex");
}

#[tokio::test]
async fn create_and_delete_api_runtime_agent_via_http_routes() {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-api-lifecycle".to_string();
    let state = AppState {
        port: 3921,
        host_id: host_id.clone(),
        registry: AgentRegistry::new(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(host_id, Arc::clone(&signal_pool), None)),
        mesh_relay: None,
        auth_secret: None,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        energy_registry: exomind_runtime::energy::EnergyRegistry::new(),
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
                    r#"{"kind":"api","id":"api-manual","provider_profile":{"provider":"openai","model":"gpt-5","base_url":"http://127.0.0.1:1","api_key":"sk-test"}}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status().as_u16(), 201);

    let delete_response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/agents/api-manual")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status().as_u16(), 200);
}

#[tokio::test]
async fn codex_runtime_agent_chat_route_streams_typed_events() {
    let _guard = CODEX_ENV_LOCK.lock().unwrap();
    unsafe {
        std::env::set_var("EXOMIND_CODEX_COMMAND", env!("CARGO_BIN_EXE_fake-codex-cli"));
    }

    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-codex-chat-route".to_string();
    let state = AppState {
        port: 3922,
        host_id: host_id.clone(),
        registry: AgentRegistry::new(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(host_id, Arc::clone(&signal_pool), None)),
        mesh_relay: None,
        auth_secret: None,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        energy_registry: exomind_runtime::energy::EnergyRegistry::new(),
    };
    let app = routes::router().with_state(state);

    let _create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/agents")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"kind":"codex_cli","id":"codex-stream"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    let chat_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/agents/codex-stream/chat")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"message":"hello my name is xiaoming"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    unsafe {
        std::env::remove_var("EXOMIND_CODEX_COMMAND");
    }

    assert_eq!(chat_response.status().as_u16(), 200);
    let body_bytes = chat_response.into_body().collect().await.unwrap().to_bytes();
    let body_text = String::from_utf8(body_bytes.to_vec()).unwrap();

    assert!(body_text.contains(r#""type":"session.started""#), "{body_text}");
    assert!(body_text.contains(r#""type":"output.delta""#), "{body_text}");
    assert!(body_text.contains("xiaoming"), "{body_text}");
    assert!(body_text.contains(r#""type":"done""#), "{body_text}");
}
