use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, serve};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, OriginalId, OriginalLifecycleAction,
    OriginalLifecycleCommand, OriginalRef, ProfileId, StageId,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};

struct Fixture {
    root: tempfile::TempDir,
    host: Arc<BetaHost>,
    owner: exomind_beta_host::Session,
    profile: ProfileId,
    other_profile: ProfileId,
    observer: exomind_beta_host::IssuedGrant,
    server: exomind_beta_host::RunningServer,
    http: reqwest::Client,
}

async fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic export P")
        .unwrap();
    host.provision_profile(&owner, other_profile, "Synthetic export Q")
        .unwrap();
    let observer = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    let server = serve(host.clone(), "127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    Fixture {
        root,
        host,
        owner,
        profile,
        other_profile,
        observer,
        server,
        http,
    }
}

fn export_url(fixture: &Fixture, profile: ProfileId) -> String {
    format!(
        "http://{}/beta/v1/profiles/{profile}/export-bundle",
        fixture.server.addr()
    )
}

fn append_capture(
    host: &BetaHost,
    session: &exomind_beta_host::Session,
    profile: ProfileId,
    text: &str,
    originals: Vec<OriginalRef>,
) -> EventId {
    let event_id = EventId::new();
    host.capture(
        session,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id,
            profile_id: profile,
            occurred_at_ms: 1,
            text: text.to_owned(),
            tags: vec!["synthetic".to_owned()],
            originals,
        },
    )
    .unwrap();
    event_id
}

async fn bundle(fixture: &Fixture, body: Value) -> reqwest::Response {
    fixture
        .http
        .post(export_url(fixture, fixture.profile))
        .bearer_auth(&fixture.observer.token)
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn stop(fixture: Fixture) {
    fixture.server.stop().await.unwrap();
    let _ = fixture.host.stop();
    let _ = fixture.root;
}

#[tokio::test]
async fn export_bundle_fixes_highwater_and_pages_only_the_requested_timeline_scope() {
    let fixture = fixture().await;
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.profile)
        .unwrap();
    let ids = (0..3)
        .map(|index| {
            append_capture(
                &fixture.host,
                &writer,
                fixture.profile,
                &format!("synthetic fact {index}"),
                Vec::new(),
            )
        })
        .collect::<Vec<_>>();
    let first_response = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":null,
            "before":null,
            "max_pages":1,
            "max_bytes":131072,
            "include_original_ids":[]
        }),
    )
    .await;
    assert_eq!(first_response.status(), 200);
    let first: Value = first_response.json().await.unwrap();
    assert_eq!(first["protocol"], "exomind-beta/1");
    assert_eq!(first["profile_id"], fixture.profile.to_string());
    assert_eq!(first["facts"][0]["fact_id"], ids[2].to_string());
    assert_eq!(first["coverage"]["complete"], false);
    let highwater = first["coverage"]["through"].as_u64().unwrap();
    let next_before = first["coverage"]["next_before"].as_u64().unwrap();

    let late_id = append_capture(
        &fixture.host,
        &writer,
        fixture.profile,
        "late fact beyond the frozen snapshot",
        Vec::new(),
    );
    let second_response = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":highwater,
            "before":next_before,
            "max_pages":1,
            "max_bytes":131072,
            "include_original_ids":[]
        }),
    )
    .await;
    assert_eq!(second_response.status(), 200);
    let second: Value = second_response.json().await.unwrap();
    assert_eq!(second["coverage"]["through"], highwater);
    assert_ne!(second["facts"][0]["fact_id"], late_id.to_string());

    let repeat_response = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":highwater,
            "before":next_before,
            "max_pages":1,
            "max_bytes":131072,
            "include_original_ids":[]
        }),
    )
    .await;
    let repeat: Value = repeat_response.json().await.unwrap();
    assert_eq!(second["facts"], repeat["facts"]);
    stop(fixture).await;
}

#[tokio::test]
async fn export_bundle_reports_byte_limited_coverage_without_calling_it_complete() {
    let fixture = fixture().await;
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.profile)
        .unwrap();
    append_capture(
        &fixture.host,
        &writer,
        fixture.profile,
        &"synthetic".repeat(8_000),
        Vec::new(),
    );
    let response = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":null,
            "before":null,
            "max_pages":4,
            "max_bytes":4096,
            "include_original_ids":[]
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["facts"].as_array().unwrap().len(), 0);
    assert_eq!(value["coverage"]["complete"], false);
    assert_eq!(value["coverage"]["stop_reason"], "byte_budget");
    assert!(value["coverage"]["next_before"].as_u64().is_some());
    stop(fixture).await;
}

#[tokio::test]
async fn export_bundle_includes_only_explicitly_selected_verified_original_bytes() {
    let fixture = fixture().await;
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.profile)
        .unwrap();
    let bytes = b"synthetic attachment bytes";
    let original_id = OriginalId::new();
    let stage_id = StageId::new();
    let reference = OriginalRef {
        original_id,
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "synthetic.txt".to_owned(),
        media_type: "text/plain".to_owned(),
    };
    fixture
        .host
        .begin_stage(
            &writer,
            &BeginStageCommand {
                stage_id,
                original_id,
                profile_id: fixture.profile,
                expected_sha256: reference.sha256.clone(),
                byte_length: reference.byte_length,
                file_name: reference.file_name.clone(),
                media_type: reference.media_type.clone(),
            },
        )
        .unwrap();
    fixture
        .host
        .write_stage_chunk(&writer, fixture.profile, stage_id, 0, bytes)
        .unwrap();
    fixture
        .host
        .verify_stage(&writer, fixture.profile, stage_id)
        .unwrap();
    let event_id = append_capture(
        &fixture.host,
        &writer,
        fixture.profile,
        "synthetic fact with original",
        vec![reference],
    );

    let metadata_only = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":null,
            "before":null,
            "max_pages":4,
            "max_bytes":131072,
            "include_original_ids":[]
        }),
    )
    .await;
    let metadata: Value = metadata_only.json().await.unwrap();
    assert_eq!(metadata["facts"][0]["fact_id"], event_id.to_string());
    assert_eq!(
        metadata["originals"][0]["sha256"],
        format!("{:x}", Sha256::digest(bytes))
    );
    assert_eq!(metadata["originals"][0]["byte_length"], bytes.len());
    assert_eq!(metadata["originals"][0]["included"], false);

    let included = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":null,
            "before":null,
            "max_pages":4,
            "max_bytes":131072,
            "include_original_ids":[original_id.to_string()]
        }),
    )
    .await;
    let value: Value = included.json().await.unwrap();
    assert_eq!(value["originals"][0]["included"], true);
    assert_eq!(
        value["originals"][0]["bytes_hex"],
        "73796e746865746963206174746163686d656e74206279746573"
    );
    stop(fixture).await;
}

#[tokio::test]
async fn export_bundle_reports_released_original_metadata_without_faking_zero_bytes() {
    let fixture = fixture().await;
    let writer = fixture
        .host
        .native_human_session(&fixture.owner, fixture.profile)
        .unwrap();
    let bytes = b"synthetic releasable attachment";
    let original_id = OriginalId::new();
    let stage_id = StageId::new();
    let reference = OriginalRef {
        original_id,
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "synthetic-release.txt".to_owned(),
        media_type: "text/plain".to_owned(),
    };
    fixture
        .host
        .begin_stage(
            &writer,
            &BeginStageCommand {
                stage_id,
                original_id,
                profile_id: fixture.profile,
                expected_sha256: reference.sha256.clone(),
                byte_length: reference.byte_length,
                file_name: reference.file_name.clone(),
                media_type: reference.media_type.clone(),
            },
        )
        .unwrap();
    fixture
        .host
        .write_stage_chunk(&writer, fixture.profile, stage_id, 0, bytes)
        .unwrap();
    fixture
        .host
        .verify_stage(&writer, fixture.profile, stage_id)
        .unwrap();
    append_capture(
        &fixture.host,
        &writer,
        fixture.profile,
        "synthetic released source fact",
        vec![reference.clone()],
    );

    let status = fixture
        .host
        .original_lifecycle_status(&fixture.owner, fixture.profile, original_id)
        .unwrap();
    let reclaim = OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: fixture.profile,
        original_id,
        expected_generation: status.local.generation,
        occurred_at_ms: 2,
        action: OriginalLifecycleAction::Reclaim,
        cleanup_confirmed: false,
        follow_up_device_ids: Vec::new(),
        responds_to_event_id: None,
    };
    fixture
        .host
        .apply_original_lifecycle(&fixture.owner, &reclaim)
        .unwrap();
    let reclaimed = fixture
        .host
        .original_lifecycle_status(&fixture.owner, fixture.profile, original_id)
        .unwrap();
    let release = OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: fixture.profile,
        original_id,
        expected_generation: reclaimed.local.generation,
        occurred_at_ms: 3,
        action: OriginalLifecycleAction::ReleaseLocal,
        cleanup_confirmed: true,
        follow_up_device_ids: Vec::new(),
        responds_to_event_id: None,
    };
    fixture
        .host
        .apply_original_lifecycle(&fixture.owner, &release)
        .unwrap();

    let response = bundle(
        &fixture,
        json!({
            "after_local_seq":0,
            "through":null,
            "before":null,
            "max_pages":4,
            "max_bytes":131072,
            "include_original_ids":[original_id.to_string()]
        }),
    )
    .await;
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["originals"][0]["byte_length"], bytes.len());
    assert_eq!(value["originals"][0]["included"], false);
    assert_eq!(value["originals"][0]["local_availability"], "released");
    assert_eq!(value["originals"][0]["reason"], "locally_released");
    assert!(value["originals"][0]["bytes_hex"].is_null());
    stop(fixture).await;
}

#[tokio::test]
async fn export_bundle_rejects_cross_profile_reads_and_owner_authority() {
    let fixture = fixture().await;
    assert_eq!(
        fixture
            .http
            .post(export_url(&fixture, fixture.other_profile))
            .bearer_auth(&fixture.observer.token)
            .json(&json!({
                "after_local_seq":0,
                "through":null,
                "before":null,
                "max_pages":1,
                "max_bytes":131072,
                "include_original_ids":[]
            }))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        fixture
            .http
            .post(export_url(&fixture, fixture.profile))
            .bearer_auth("owner-token-is-never-issued-to-this-route")
            .json(&json!({
                "after_local_seq":0,
                "through":null,
                "before":null,
                "max_pages":1,
                "max_bytes":131072,
                "include_original_ids":[]
            }))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    stop(fixture).await;
}
