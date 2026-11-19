use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, Core, CoreError, EventId, OriginalBytesState,
    OriginalId, OriginalLifecycleAction, OriginalLifecycleCommand, ProfileId, StageId,
};
use sha2::{Digest, Sha256};

fn captured(core: &Core, profile: ProfileId, bytes: &[u8]) -> (exomind_core::OriginalRef, EventId) {
    let human = core.local_human(profile).unwrap();
    let original_id = OriginalId::new();
    let stage_id = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id,
            profile_id: profile,
            original_id,
            expected_sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
            file_name: "synthetic.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    )
    .unwrap();
    core.write_stage_chunk(&human, stage_id, 0, bytes).unwrap();
    let proof = core
        .freeze_stage(&human, stage_id)
        .unwrap()
        .verify(|| false)
        .unwrap();
    let original = core.finish_stage(&human, &proof).unwrap().original;
    let event = EventId::new();
    core.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: event,
            profile_id: profile,
            occurred_at_ms: 1_000,
            text: "synthetic source reference".into(),
            tags: vec![],
            originals: vec![original.clone()],
        },
    )
    .unwrap();
    (original, event)
}

fn lifecycle_command(
    profile: ProfileId,
    original: OriginalId,
    action: OriginalLifecycleAction,
    generation: u64,
) -> OriginalLifecycleCommand {
    OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        original_id: original,
        expected_generation: generation,
        occurred_at_ms: 2_000,
        action,
        cleanup_confirmed: action == OriginalLifecycleAction::ReleaseLocal,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    }
}

#[test]
fn local_release_is_idempotent_and_leaves_another_profile_copy_and_fact_history_intact() {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let p = core.create_profile("synthetic P").unwrap();
    let q = core.create_profile("synthetic Q").unwrap();
    let bytes = b"same hash but separate original IDs";
    let (p_original, p_event) = captured(&core, p, bytes);
    let (q_original, _) = captured(&core, q, bytes);
    assert_eq!(p_original.sha256, q_original.sha256);
    assert_ne!(p_original.original_id, q_original.original_id);

    let p_human = core.local_human(p).unwrap();
    let q_human = core.local_human(q).unwrap();
    let reclaim = lifecycle_command(
        p,
        p_original.original_id,
        OriginalLifecycleAction::Reclaim,
        0,
    );
    core.apply_original_lifecycle(&p_human, &reclaim).unwrap();
    let release = lifecycle_command(
        p,
        p_original.original_id,
        OriginalLifecycleAction::ReleaseLocal,
        1,
    );
    let first = core.apply_original_lifecycle(&p_human, &release).unwrap();
    assert!(
        core.apply_original_lifecycle(&p_human, &release)
            .unwrap()
            .replayed
    );
    assert!(matches!(
        core.read_original_range(&p_human, p, p_original.original_id, 0, bytes.len()),
        Err(CoreError::OriginalNotReady)
    ));
    assert_eq!(
        core.original_lifecycle_status(&p_human, p, p_original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::Released
    );
    assert_eq!(
        core.read_original_range(&q_human, q, q_original.original_id, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
    assert!(
        core.events(&p_human, p)
            .unwrap()
            .iter()
            .any(|event| event.event_id == p_event
                && event.originals.len() == 1
                && event.originals.first() == Some(&p_original))
    );
    assert_eq!(first.event_id, release.event_id);
}
