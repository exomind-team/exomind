use exomind_beta_host::{
    BetaHost, HostError,
    native_workspace::{NativeWorkspace, WorkspaceAction},
};
use exomind_core::{EventQuery, ProfileId, TimeblockCommand};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn repeated_reads_do_not_mint_grants() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = Arc::new(BetaHost::open(&root).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic observation cost")
        .unwrap();
    let workspace = NativeWorkspace::new(host.clone(), owner);
    workspace.snapshot(profile).unwrap();
    let database = rusqlite::Connection::open_with_flags(
        root.join("host-auth.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let count = || {
        database
            .query_row("SELECT count(*) FROM grants", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
    };
    let baseline = count();
    for _ in 0..10 {
        workspace.snapshot(profile).unwrap();
    }
    assert_eq!(
        count(),
        baseline,
        "read-only observation cannot create another authorization row"
    );
    host.stop().unwrap();
}

#[test]
fn native_workspace_controls_and_drafts_need_no_main_window_or_frontend_executor() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic independent workspace")
        .unwrap();
    let human = host.native_human_session(&owner, profile).unwrap();
    let snapshot = host.timeblock_snapshot(&human, profile).unwrap();
    let block = Uuid::new_v4();
    let start:TimeblockCommand=serde_json::from_value(json!({"command_id":Uuid::new_v4(),"event_id":Uuid::new_v4(),"profile_id":profile,"expected_revision":snapshot.revision,"action":{"kind":"start","block_id":block,"name":"Independent Native timer","note":"","timer":{"mode":"count_up"}}})).unwrap();
    host.apply_timeblock(&human, &start).unwrap();
    let workspace = NativeWorkspace::new(host.clone(), owner.clone());
    // There is deliberately no main document, publish call or heartbeat.
    for action in [
        WorkspaceAction::Pause { block_id: block },
        WorkspaceAction::Resume { block_id: block },
        WorkspaceAction::EndAction { block_id: block },
    ] {
        let view = workspace.snapshot(profile).unwrap();
        let revision = view["remote"]["revision"].as_str().unwrap();
        assert!(
            workspace
                .execute(profile, Uuid::new_v4(), Uuid::new_v4(), revision, &action)
                .unwrap()
                .is_some()
        );
    }
    assert_eq!(
        workspace.snapshot(profile).unwrap()["remote"]["active"]["phase"],
        "feedback_pending"
    );
    workspace
        .execute(
            profile,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "",
            &WorkspaceAction::FeedbackEdit {
                block_id: block,
                draft_revision: 0,
                text: "Native feedback without a main window".into(),
            },
        )
        .unwrap();
    // Recreating the service consumer does not own or erase shared state.
    drop(workspace);
    let workspace = NativeWorkspace::new(host.clone(), owner.clone());
    let view = workspace.snapshot(profile).unwrap();
    assert_eq!(view["feedback"][block.to_string()]["revision"], 1);
    workspace
        .execute(
            profile,
            Uuid::new_v4(),
            Uuid::new_v4(),
            view["remote"]["revision"].as_str().unwrap(),
            &WorkspaceAction::SubmitFeedback {
                block_id: block,
                draft_revision: 1,
                skipped: false,
            },
        )
        .unwrap();
    workspace
        .execute(
            profile,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "",
            &WorkspaceAction::CaptureEdit {
                draft_revision: 0,
                text: "Independent Native capture".into(),
            },
        )
        .unwrap();
    workspace
        .execute(
            profile,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "",
            &WorkspaceAction::Capture { draft_revision: 1 },
        )
        .unwrap();
    assert_eq!(
        host.events_page(&human, profile, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(workspace.snapshot(profile).unwrap()["capture"]["text"], "");
    host.stop().unwrap();
    assert!(workspace.snapshot(profile).is_err());
}

#[test]
fn a_stale_client_cannot_overwrite_another_clients_new_draft_or_a_corrupt_intent() {
    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "Synthetic CAS")
        .unwrap();
    let workspace = NativeWorkspace::new(host.clone(), owner.clone());
    let key = workspace.intent_keys(profile).unwrap()[0].clone();
    let stale = host.read_local_intent(&owner, &key).unwrap();
    workspace
        .execute(
            profile,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "",
            &WorkspaceAction::CaptureEdit {
                draft_revision: 0,
                text: "newer client input".into(),
            },
        )
        .unwrap();
    assert!(matches!(
        host.compare_local_intent(&owner, &key, stale.as_deref(), "{}"),
        Err(HostError::IntentCacheConflict)
    ));
    assert_eq!(
        workspace.snapshot(profile).unwrap()["capture"]["text"],
        "newer client input"
    );
    assert!(
        workspace
            .execute(
                profile,
                Uuid::new_v4(),
                Uuid::new_v4(),
                "",
                &WorkspaceAction::CaptureEdit {
                    draft_revision: 0,
                    text: "stale client".into()
                }
            )
            .is_err()
    );
    let raw = host.read_local_intent(&owner, &key).unwrap().unwrap();
    assert!(!raw.contains("stale client"));
    host.stop().unwrap();
}
