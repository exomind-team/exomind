use exomind_core::*;
use std::{fs, path::Path};
use tempfile::tempdir;
use uuid::Uuid;

fn request_manual_summary(
    core: &Core,
    profile: ProfileId,
) -> (SummaryRequestCommand, SummaryTaskView) {
    let command = SummaryRequestCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        purpose: SummaryPurpose::ManualCompressV1,
        artifact_kind: SummaryArtifactKind::CompressedBlock,
        selection: SummarySelection {
            block_ids: vec![TimeblockId::new()],
            from_ms: 0,
            to_ms: 0,
            selected_original_ids: vec![],
        },
    };
    core.request_summary(&core.local_human(profile).unwrap(), &command)
        .unwrap();
    let task = core
        .summary_tasks_page(&core.local_human(profile).unwrap(), profile, None, 8)
        .unwrap()
        .items
        .into_iter()
        .find(|task| task.creator_event_id == command.event_id)
        .unwrap();
    (command, task)
}

fn copy_root(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let kind = entry.file_type().unwrap();
        if kind.is_dir() {
            copy_root(&source_path, &target_path);
        } else if kind.is_file() {
            fs::copy(source_path, target_path).unwrap();
        } else {
            panic!("unexpected synthetic Core root entry");
        }
    }
}

#[test]
fn archive_imported_summary_control_cannot_admit_an_unknown_paid_attempt() {
    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let target = Core::open(target_root.path()).unwrap();
    let profile = ProfileId::new();
    source.provision_profile(profile, "source").unwrap();
    target.provision_profile(profile, "target").unwrap();
    let target_device = target.device_id();
    let (request, task) = request_manual_summary(&source, profile);
    let takeover = SummaryControlCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        task_id: task.task_id,
        expected_owner_generation: task.owner_generation,
        expected_owner_control_event_id: task.owner_control_event_id,
        expected_control_heads: task.control_heads.clone(),
        action: SummaryControlAction::ResolveOwner {
            run_id: Uuid::new_v4(),
            owner_device_id: target_device,
            resume_cancelled: false,
        },
    };
    source
        .control_summary(&source.local_human(profile).unwrap(), &takeover)
        .unwrap();
    let page = source
        .export_origin_page(
            &source.local_human(profile).unwrap(),
            profile,
            &OriginPageQuery::default(),
        )
        .unwrap();
    let archive_context = target
        .profile_archive_import_context(&target.local_human(profile).unwrap(), profile)
        .unwrap();
    target
        .import_profile_archive_page(&archive_context, &page, None, None)
        .unwrap();

    let reader = target.local_human(profile).unwrap();
    let imported = target
        .summary_tasks_page(&reader, profile, None, 8)
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.task_id == task.task_id)
        .unwrap();
    assert_eq!(imported.owner_device_id, target_device);
    assert!(
        !target
            .summary_task_execution_admitted(
                &target.local_summary_executor(),
                profile,
                imported.task_id
            )
            .unwrap()
    );
    assert_eq!(target.receipt(&reader, request.command_id).unwrap(), None);
    assert_eq!(target.receipt(&reader, takeover.command_id).unwrap(), None);

    let run_id = imported.current_run.as_ref().unwrap().run_id;
    let attempt = target.begin_summary_attempt(
        &target.local_summary_executor(),
        &SummaryBeginCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            task_id: imported.task_id,
            expected_owner_generation: imported.owner_generation,
            expected_owner_control_event_id: imported.owner_control_event_id,
            expected_run_id: run_id,
            attempt_id: Uuid::new_v4(),
            role_config_digest: "a".repeat(64),
            max_attempts: 2,
            now_ms: 100,
        },
    );
    assert!(matches!(
        attempt,
        Err(CoreError::SummaryBlocked(
            "owner_control_not_locally_admitted"
        ))
    ));
}

#[test]
fn archive_imported_timer_is_history_only_on_a_new_device() {
    use exomind_core::{CountdownEndMode, TimeblockAction, TimeblockCommand, TimerSpec};

    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let target = Core::open(target_root.path()).unwrap();
    let profile = ProfileId::new();
    source.provision_profile(profile, "source").unwrap();
    target.provision_profile(profile, "target").unwrap();
    assert_ne!(source.device_id(), target.device_id());

    let source_human = source.local_human(profile).unwrap();
    let source_stamp = source
        .trusted_clock_stamp(Uuid::new_v4(), 1_000, 0)
        .unwrap();
    let block_id = TimeblockId::new();
    let command = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        expected_revision: source
            .timeblock_snapshot(&source_human, profile, &source_stamp)
            .unwrap()
            .revision,
        action: TimeblockAction::Start {
            block_id,
            name: "source countdown".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1_000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    source
        .apply_timeblock(&source_human, &command, &source_stamp)
        .unwrap();
    let page = source
        .export_origin_page(&source_human, profile, &OriginPageQuery::default())
        .unwrap();
    let archive_context = target
        .profile_archive_import_context(&target.local_human(profile).unwrap(), profile)
        .unwrap();
    target
        .import_profile_archive_page(&archive_context, &page, None, None)
        .unwrap();

    let target_human = target.local_human(profile).unwrap();
    let target_stamp = target
        .trusted_clock_stamp(Uuid::new_v4(), 9_000, 8_000)
        .unwrap();
    let active = target
        .timeblock_snapshot(&target_human, profile, &target_stamp)
        .unwrap()
        .active
        .unwrap();
    assert_eq!(active.block_id, block_id);
    assert!(active.deadline.is_none());
    assert!(
        target
            .due_deadlines(&target.local_scheduler(), &target_stamp, 100)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        target.receipt(&target_human, command.command_id).unwrap(),
        None
    );
}

#[test]
fn archive_new_facts_with_a_cloned_local_device_id_are_rejected_before_projection_changes() {
    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let seed = Core::open(source_root.path()).unwrap();
    let profile = ProfileId::new();
    seed.provision_profile(profile, "synthetic old backup")
        .unwrap();
    let device = seed.device_id();
    drop(seed);
    copy_root(source_root.path(), target_root.path());

    let source = Core::open(source_root.path()).unwrap();
    let target = Core::open(target_root.path()).unwrap();
    assert_eq!(source.device_id(), device);
    assert_eq!(target.device_id(), device);
    let (request, _) = request_manual_summary(&source, profile);
    let source_human = source.local_human(profile).unwrap();
    let source_stamp = source
        .trusted_clock_stamp(Uuid::new_v4(), 1_000, 0)
        .unwrap();
    let block_id = TimeblockId::new();
    let timer = TimeblockCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        expected_revision: source
            .timeblock_snapshot(&source_human, profile, &source_stamp)
            .unwrap()
            .revision,
        action: TimeblockAction::Start {
            block_id,
            name: "same-device source timer".into(),
            note: String::new(),
            timer: TimerSpec::CountDown {
                duration_ms: 1_000,
                end_mode: CountdownEndMode::Hard,
            },
        },
    };
    source
        .apply_timeblock(&source_human, &timer, &source_stamp)
        .unwrap();
    let page = source
        .export_origin_page(&source_human, profile, &OriginPageQuery::default())
        .unwrap();
    let archive_context = target
        .profile_archive_import_context(&target.local_human(profile).unwrap(), profile)
        .unwrap();
    assert!(matches!(
        target.import_profile_archive_page(&archive_context, &page, None, None),
        Err(CoreError::InvalidReplication(
            "archive origin collides with local device identity"
        ))
    ));
    assert!(
        target
            .summary_tasks_page(&target.local_human(profile).unwrap(), profile, None, 8)
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        target
            .receipt(&target.local_human(profile).unwrap(), request.command_id)
            .unwrap(),
        None
    );
    let target_human = target.local_human(profile).unwrap();
    let now = target
        .trusted_clock_stamp(Uuid::new_v4(), 9_000, 8_000)
        .unwrap();
    assert!(
        target
            .timeblock_snapshot(&target_human, profile, &now)
            .unwrap()
            .active
            .is_none()
    );
    assert!(
        target
            .due_deadlines(&target.local_scheduler(), &now, 100)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        target.receipt(&target_human, timer.command_id).unwrap(),
        None
    );
}
