use super::*;
use crate::{GrantKind, GrantRequest};
use exomind_core::{AgentId, CaptureCommand, CommandId, EventId, EventQuery};
use tempfile::TempDir;

fn setup() -> (TempDir, BetaHost, Session, ProfileId, ProfileId) {
    let directory = tempfile::tempdir().unwrap();
    let host = BetaHost::open(&directory.path().join("host")).unwrap();
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic P").unwrap();
    host.provision_profile(&owner, q, "Synthetic Q").unwrap();
    (directory, host, owner, p, q)
}
fn command() -> SummaryModelConfigurationCommand {
    SummaryModelConfigurationCommand {
        command_id: Uuid::new_v4(),
        expected_revision: None,
        enabled: true,
        base_url: "http://127.0.0.1:32123/v1".into(),
        model: "synthetic-review".into(),
        api_key: SummaryModelSecretUpdate::Set {
            value: "synthetic-private-key".into(),
        },
        max_output_tokens: 2048,
        timeout_ms: 60000,
        include_suggestions: false,
    }
}
fn session(host: &BetaHost, owner: &Session, p: ProfileId, kind: GrantKind) -> Session {
    let grant = host
        .grant(
            owner,
            GrantRequest {
                profile_id: p,
                kind,
                agent_id: if kind == GrantKind::AgentNote {
                    Some(AgentId::new())
                } else {
                    None
                },
            },
        )
        .unwrap();
    host.authenticate(&grant.token).unwrap()
}

#[test]
fn owner_profile_config_persists_without_returning_or_replicating_keys() {
    let (directory, host, owner, p, q) = setup();
    let root = directory.path().join("host");
    let empty = host.summary_model_configuration(&owner, p).unwrap();
    assert!(!empty.enabled);
    assert!(!empty.include_suggestions);
    assert!(empty.revision.is_none());
    assert!(!root.join(DATABASE).exists());
    let mut input = command();
    input.include_suggestions = true;
    let saved = host.configure_summary_model(&owner, p, &input).unwrap();
    assert_eq!(saved.revision, Some(input.command_id));
    assert!(saved.has_api_key);
    assert!(saved.include_suggestions);
    let wire = serde_json::to_string(&saved).unwrap();
    assert!(!wire.contains("synthetic-private-key"));
    assert!(!wire.contains("\"api_key\""));
    assert!(
        host.summary_model_configuration(&owner, q)
            .unwrap()
            .revision
            .is_none()
    );
    assert!(
        host.events_page(
            &session(&host, &owner, p, GrantKind::Observer),
            p,
            &EventQuery::default()
        )
        .unwrap()
        .items
        .is_empty()
    );
    let device = host.device_id;
    let digest = load(&root, device, p).unwrap().unwrap().role_digest(p);
    host.stop().unwrap();
    drop(host);
    let restarted = BetaHost::open(&root).unwrap();
    let owner = restarted.owner_session().unwrap();
    let after = restarted.summary_model_configuration(&owner, p).unwrap();
    assert_eq!(after.revision, saved.revision);
    assert!(after.has_api_key);
    assert!(after.include_suggestions);
    let private = load(&root, device, p).unwrap().unwrap();
    assert_eq!(
        private.settings.api_key.as_deref(),
        Some("synthetic-private-key")
    );
    assert_eq!(private.role_digest(p), digest);
    restarted.stop().unwrap();
}

#[test]
fn configuration_requires_owner_current_runtime_and_real_profile() {
    let (_directory, host, owner, p, q) = setup();
    for kind in [GrantKind::Observer, GrantKind::Human, GrantKind::AgentNote] {
        let caller = session(&host, &owner, p, kind);
        assert!(matches!(
            host.summary_model_configuration(&caller, p),
            Err(HostError::Forbidden)
        ));
        assert!(matches!(
            host.configure_summary_model(&caller, q, &command()),
            Err(HostError::Forbidden)
        ));
    }
    assert!(matches!(
        host.configure_summary_model(&owner, ProfileId::new(), &command()),
        Err(HostError::NotFound)
    ));
    let (_other_directory, other, other_owner, _, _) = setup();
    assert!(matches!(
        host.summary_model_configuration(&other_owner, p),
        Err(HostError::Unauthorized)
    ));
    other.stop().unwrap();
    host.request_stop();
    assert!(matches!(
        host.configure_summary_model(&owner, p, &command()),
        Err(HostError::Stopped)
    ));
    host.stop().unwrap();
}

#[test]
fn command_retry_is_idempotent_conflicting_revision_cannot_replace_credentials() {
    let (directory, host, owner, p, _) = setup();
    let initial = command();
    let saved = host.configure_summary_model(&owner, p, &initial).unwrap();
    let again = host.configure_summary_model(&owner, p, &initial).unwrap();
    assert_eq!(again.revision, saved.revision);
    let mut conflicting = initial.clone();
    conflicting.model = "different payload".into();
    assert!(matches!(
        host.configure_summary_model(&owner, p, &conflicting),
        Err(HostError::ModelConfigurationConflict)
    ));
    let mut next = command();
    next.expected_revision = saved.revision;
    next.api_key = SummaryModelSecretUpdate::Keep;
    next.enabled = false;
    let disabled = host.configure_summary_model(&owner, p, &next).unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.has_api_key);
    assert!(matches!(
        host.configure_summary_model(&owner, p, &initial),
        Err(HostError::ModelConfigurationConflict)
    ));
    let root = directory.path().join("host");
    let value = load(&root, host.device_id, p).unwrap().unwrap();
    assert_eq!(
        value.settings.api_key.as_deref(),
        Some("synthetic-private-key")
    );
    next.command_id = Uuid::new_v4();
    next.expected_revision = disabled.revision;
    next.api_key = SummaryModelSecretUpdate::Clear;
    assert!(
        !host
            .configure_summary_model(&owner, p, &next)
            .unwrap()
            .has_api_key
    );
    host.stop().unwrap();
}

#[test]
fn missing_or_corrupt_private_config_never_becomes_empty_and_recording_still_works() {
    let (directory, host, owner, p, _) = setup();
    host.configure_summary_model(&owner, p, &command()).unwrap();
    let root = directory.path().join("host");
    let caller = session(&host, &owner, p, GrantKind::Human);
    let capture = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: p,
        occurred_at_ms: 1794560000000,
        text: "Synthetic record remains independent".into(),
        tags: vec![],
        originals: vec![],
    };
    let before = fs::read(root.join(INITIALIZED)).unwrap();
    fs::rename(
        root.join(DATABASE),
        root.join("synthetic-missing-config.saved"),
    )
    .unwrap();
    assert!(matches!(
        host.summary_model_configuration(&owner, p),
        Err(HostError::ModelConfigurationRecoveryRequired)
    ));
    assert!(matches!(
        host.configure_summary_model(&owner, p, &command()),
        Err(HostError::ModelConfigurationRecoveryRequired)
    ));
    assert_eq!(fs::read(root.join(INITIALIZED)).unwrap(), before);
    assert!(!root.join(DATABASE).exists());
    host.capture(&caller, &capture).unwrap();
    assert_eq!(
        host.receipt(&caller, p, capture.command_id)
            .unwrap()
            .unwrap()
            .event_id,
        capture.event_id
    );
    fs::rename(
        root.join("synthetic-missing-config.saved"),
        root.join(DATABASE),
    )
    .unwrap();
    let database = Connection::open(root.join(DATABASE)).unwrap();
    database
        .execute_batch("DROP TABLE model_configuration")
        .unwrap();
    drop(database);
    assert!(matches!(
        host.summary_model_configuration(&owner, p),
        Err(HostError::ModelConfigurationRecoveryRequired)
    ));
    assert_eq!(
        host.events_page(&caller, p, &EventQuery::default())
            .unwrap()
            .items[0]
            .event_id,
        capture.event_id
    );
    host.stop().unwrap();
}

#[test]
fn invalid_credentials_do_not_initialize_store_and_locked_store_has_bounded_failure() {
    let (directory, host, owner, p, _) = setup();
    let root = directory.path().join("host");
    let mut invalid = command();
    invalid.api_key = SummaryModelSecretUpdate::Set {
        value: "synthetic\r\ninjected-header".into(),
    };
    assert!(matches!(
        host.configure_summary_model(&owner, p, &invalid),
        Err(HostError::ModelConfigurationInvalid)
    ));
    assert!(!root.join(DATABASE).exists());
    let mut url_invalid = command();
    url_invalid.base_url =
        "http://synthetic-user:synthetic-secret@127.0.0.1/v1?token=synthetic".into();
    assert!(matches!(
        host.configure_summary_model(&owner, p, &url_invalid),
        Err(HostError::ModelConfigurationInvalid)
    ));
    assert!(!root.join(DATABASE).exists());
    host.configure_summary_model(&owner, p, &command()).unwrap();
    let database = Connection::open(root.join(DATABASE)).unwrap();
    database.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let started = std::time::Instant::now();
    assert!(matches!(
        host.summary_model_configuration(&owner, p),
        Err(HostError::ModelConfigurationUnavailable)
    ));
    assert!(started.elapsed() < Duration::from_secs(2));
    database.execute_batch("ROLLBACK").unwrap();
    assert!(
        host.summary_model_configuration(&owner, p)
            .unwrap()
            .has_api_key
    );
    host.stop().unwrap();
}

#[tokio::test]
async fn real_http_owner_route_redacts_secret_and_rejects_scoped_grants() {
    use std::sync::Arc;
    let (directory, host, owner, p, q) = setup();
    let host = Arc::new(host);
    let owner_token = serde_json::from_slice::<serde_json::Value>(
        &fs::read(directory.path().join("host/connection.beta.json")).unwrap(),
    )
    .unwrap()["owner_token"]
        .as_str()
        .unwrap()
        .to_owned();
    let observer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap()
        .token;
    let server = crate::serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let url = format!(
        "http://{}/beta/v1/profiles/{p}/summary-model",
        server.addr()
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    assert_eq!(client.get(&url).send().await.unwrap().status(), 401);
    let config = command();
    let response = client
        .post(&url)
        .bearer_auth(&owner_token)
        .json(&config)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let raw = response.text().await.unwrap();
    assert!(!raw.contains("synthetic-private-key"));
    assert!(!raw.contains("\"api_key\""));
    assert_eq!(
        client
            .get(&url)
            .bearer_auth(&observer)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth(&observer)
            .json(&config)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let q_url = format!(
        "http://{}/beta/v1/profiles/{q}/summary-model",
        server.addr()
    );
    let value: serde_json::Value = client
        .get(&q_url)
        .bearer_auth(&owner_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(value["revision"], serde_json::Value::Null);
    let mut stale = config.clone();
    stale.command_id = Uuid::new_v4();
    let response = client
        .post(&url)
        .bearer_auth(&owner_token)
        .json(&stale)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 409);
    let value: serde_json::Value = response.json().await.unwrap();
    assert_eq!(value["error"]["code"], "model_configuration_conflict");
    server.stop().await.unwrap();
}
