use exomind_beta_host::{
    AgentAccessCheck, AgentCapability, BetaHost, GrantKind, GrantRequest, HostError, serve,
};
use exomind_core::{AgentId, ProfileId};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

#[test]
fn access_snapshot_is_scoped_read_only_and_rechecked_after_revocation_and_restart() {
    let root = tempfile::tempdir().unwrap();
    let host = BetaHost::open(root.path()).unwrap();
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic P").unwrap();
    host.provision_profile(&owner, q, "Synthetic Q").unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let observer = host.authenticate(&grant.token).unwrap();
    let read = AgentAccessCheck {
        required: vec![AgentCapability::EventsRead, AgentCapability::OriginalsRead],
    };
    let snapshot = host.check_agent_access(&observer, p, &read).unwrap();
    assert_eq!(snapshot.profile_id, p);
    assert_eq!(snapshot.grant_kind, GrantKind::Observer);
    assert!(
        !snapshot
            .allowed
            .contains(&AgentCapability::CaptureAppendAgentNote)
    );
    assert_eq!(
        snapshot.max_original_chunk_bytes,
        exomind_core::MAX_ORIGINAL_CHUNK_BYTES
    );
    assert!(matches!(
        host.check_agent_access(&observer, q, &read),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.check_agent_access(&owner, p, &read),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.check_agent_access(
            &observer,
            p,
            &AgentAccessCheck {
                required: vec![AgentCapability::Wait]
            }
        ),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.check_agent_access(
            &observer,
            p,
            &AgentAccessCheck {
                required: vec![AgentCapability::EventsRead; 2]
            }
        ),
        Err(HostError::InvalidRequest)
    ));
    assert!(
        host.events_page(&observer, p, &Default::default())
            .unwrap()
            .items
            .is_empty()
    );
    host.revoke_grant(&owner, grant.grant_id).unwrap();
    assert!(matches!(
        host.check_agent_access(&observer, p, &read),
        Err(HostError::Unauthorized)
    ));
    host.stop().unwrap();
    drop(host);
    let reopened = BetaHost::open(root.path()).unwrap();
    assert!(matches!(
        reopened.check_agent_access(&observer, p, &read),
        Err(HostError::Unauthorized)
    ));
    reopened.stop().unwrap();
}

#[tokio::test]
async fn real_http_access_check_rejects_unknown_fields_capabilities_and_wrong_authority() {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    host.provision_profile(&owner, p, "Synthetic access P")
        .unwrap();
    host.provision_profile(&owner, q, "Synthetic access Q")
        .unwrap();
    let agent_id = AgentId::new();
    let agent = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::AgentNote,
                agent_id: Some(agent_id),
            },
        )
        .unwrap();
    let observer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let human = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let base = format!("http://{}/beta/v1/profiles", server.addr());
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let url = format!("{base}/{p}/access/check");
    let response = http
        .post(&url)
        .bearer_auth(&agent.token)
        .json(&json!({"required":["capture_append_agent_note","originals_stage","events_read"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["protocol"], "exomind-beta/1");
    assert_eq!(value["profile_id"], p.to_string());
    assert_eq!(value["agent_id"], agent_id.to_string());
    assert_eq!(value["grant_kind"], "agent_note");
    assert!(
        value["allowed"]
            .as_array()
            .unwrap()
            .contains(&json!("originals_stage"))
    );
    assert!(
        !value["allowed"]
            .as_array()
            .unwrap()
            .contains(&json!("capture_append_human"))
    );
    assert!(
        !value["unsupported"]
            .as_array()
            .unwrap()
            .contains(&json!("external_summary_append"))
    );
    assert!(
        value["unsupported"]
            .as_array()
            .unwrap()
            .contains(&json!("export_bundle"))
    );
    assert!(!value.to_string().contains(&agent.token));
    for (token, body, status) in [
        (
            &agent.token,
            json!({"required":["capture_append_human"]}),
            403,
        ),
        (&agent.token, json!({"required":["summaries_control"]}), 403),
        (
            &observer.token,
            json!({"required":["capture_append_agent_note"]}),
            403,
        ),
        (&observer.token, json!({"required":["export_bundle"]}), 403),
        (
            &observer.token,
            json!({"required":["unrecognized_capability"]}),
            400,
        ),
        (&observer.token, json!({"required":[],"profile_id":q}), 400),
        (
            &human.token,
            json!({"required":["capture_append_human","timeblocks_control","summaries_control"]}),
            200,
        ),
    ] {
        let response = http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{body}");
    }
    assert_eq!(
        http.post(&url)
            .json(&json!({"required":[]}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        http.post(format!("{base}/{q}/access/check"))
            .bearer_auth(&agent.token)
            .json(&json!({"required":[]}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    host.revoke_grant(&owner, agent.grant_id).unwrap();
    assert_eq!(
        http.post(&url)
            .bearer_auth(&agent.token)
            .json(&json!({"required":[]}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    server.stop().await.unwrap();
}
