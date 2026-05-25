use axum::body::Body;
use axum::http::Request;
use exomind_runtime::AppState;
use exomind_runtime::agent::AgentRegistry;
use exomind_runtime::mesh::MeshState;
use exomind_runtime::routes;
use exomind_runtime::signal::SignalPool;
use http_body_util::BodyExt;
use serde_json::Value;
use std::sync::Arc;
use std::sync::Mutex;
use tower::ServiceExt;

static CODEX_ENV_LOCK: Mutex<()> = Mutex::new(());

fn test_app_state(port: u16, host_id: &str, signal_pool: Arc<SignalPool>) -> AppState {
    let registry = AgentRegistry::new();
    let energy_registry = exomind_runtime::energy::EnergyRegistry::new();

    AppState {
        port,
        host_id: host_id.to_string(),
        device_id: format!("dev-{host_id}"),
        registry: registry.clone(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(
            host_id.to_string(),
            Arc::clone(&signal_pool),
            None,
        )),
        mesh_relay: None,
        auth_secret: None,
        allow_lan_without_auth: false,
        mdns: None,
        ret_mesh_peers: None,
        ret_mesh_connect_tx: None,
        ret_mesh_mode: std::sync::Arc::new(std::sync::atomic::AtomicU8::new(exomind_net_pairing::RetMeshMode::Active as u8)),
        ret_mesh_pairing_tx: None,
        ret_mesh_event_tx: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        config_store: Arc::new(exomind_runtime::config::ConfigStore::new()),
        reminder_store: Arc::new(exomind_runtime::reminder::ReminderStore::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        proposal_store: Arc::new(exomind_runtime::proposal::ProposalStore::new()),
        session_store: Arc::new(exomind_runtime::session::SessionStore::new()),
        agent_api_session_store: Arc::new(exomind_runtime::agent::session::AgentSessionStore::new()),
        session_event_tx: None,
        eventlog_watch_tx: {
            let (tx, _rx) = exomind_runtime::routes::eventlog::eventlog_watch_channel();
            tx
        },
        timeblock_store: Arc::new(exomind_runtime::timeblock::TimeBlockStore::new()),
        energy_registry: energy_registry.clone(),
        tick_manager: Arc::new(exomind_runtime::tick::TickManager::new(
            host_id.to_string(),
            registry,
            energy_registry,
            Arc::clone(&signal_pool),
        )),
        life_agents: std::collections::HashMap::new(),
        eventlog_store: Arc::new(exomind_runtime::eventlog::EventLogStore::new(
            std::env::temp_dir().join("exomind-test-agent-lifecycle"),
        )),
        #[cfg(not(target_os = "android"))]
        pty_manager: Arc::new(exomind_runtime::pty::PtyManager::new(
            Arc::clone(&signal_pool),
            host_id.to_string(),
        )),
    }
}

#[tokio::test]
async fn create_and_delete_runtime_agent_via_http_routes() {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-agent-lifecycle".to_string();
    let state = test_app_state(3919, &host_id, signal_pool);
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

    let created_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
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
    let list_body = list_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
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
        std::env::set_var(
            "EXOMIND_CODEX_COMMAND",
            env!("CARGO_BIN_EXE_fake-codex-cli"),
        );
    }

    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-codex-lifecycle".to_string();
    let state = test_app_state(3920, &host_id, signal_pool);
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

    let created_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let created_payload: Value = serde_json::from_slice(&created_body).unwrap();
    assert_eq!(created_payload["id"], "codex-manual");
    assert_eq!(created_payload["name"], "Manual Codex");
}

#[tokio::test]
async fn create_and_delete_api_runtime_agent_via_http_routes() {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-api-lifecycle".to_string();
    let state = test_app_state(3921, &host_id, signal_pool);
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
        std::env::set_var(
            "EXOMIND_CODEX_COMMAND",
            env!("CARGO_BIN_EXE_fake-codex-cli"),
        );
    }

    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "test-codex-chat-route".to_string();
    let state = test_app_state(3922, &host_id, signal_pool);
    let session_store = Arc::clone(&state.session_store);
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
    let body_bytes = chat_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let body_text = String::from_utf8(body_bytes.to_vec()).unwrap();

    assert!(
        body_text.contains(r#""type":"session.started""#),
        "{body_text}"
    );
    assert!(
        body_text.contains(r#""type":"output.delta""#),
        "{body_text}"
    );
    assert!(body_text.contains("xiaoming"), "{body_text}");
    assert!(body_text.contains(r#""type":"done""#), "{body_text}");

    let sessions = session_store.list().unwrap();
    assert_eq!(
        sessions.len(),
        1,
        "agent chat should register a unified session"
    );
    let session = &sessions[0];
    assert_eq!(session.agent_kind, "codex");
    assert_eq!(session.interaction_mode.as_str(), "structured");
    assert_eq!(session.agent_id.as_deref(), Some("codex-stream"));
    assert_eq!(session.source_host_id.as_deref(), Some(host_id.as_str()));
    assert!(
        session.inner_session_id.is_some(),
        "runtime agent session should be linked to the unified session"
    );
    assert!(
        session
            .last_output_preview
            .as_deref()
            .unwrap_or_default()
            .contains("xiaoming"),
        "latest output preview should track the streamed assistant text"
    );
}
