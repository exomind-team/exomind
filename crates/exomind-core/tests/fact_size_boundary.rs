use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, Core, EventId, OriginalId, OriginalRef, StageId,
    StageState,
};
use sha2::{Digest, Sha256};

#[test]
fn largest_legal_escaped_capture_remains_readable_and_does_not_block_the_next_append() {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("legal fact encoding boundary").unwrap();
    let human = core.local_human(profile).unwrap();
    let mut originals = vec![];
    for _ in 0..256 {
        let original = OriginalRef {
            original_id: OriginalId::new(),
            sha256: format!("{:x}", Sha256::digest([])),
            byte_length: 0,
            file_name: "\"".repeat(1024),
            media_type: "\"".repeat(256),
        };
        let stage_id = StageId::new();
        core.begin_stage(
            &human,
            &BeginStageCommand {
                stage_id,
                original_id: original.original_id,
                profile_id: profile,
                expected_sha256: original.sha256.clone(),
                byte_length: 0,
                file_name: original.file_name.clone(),
                media_type: original.media_type.clone(),
            },
        )
        .unwrap();
        let proof = core
            .freeze_stage(&human, stage_id)
            .unwrap()
            .verify(|| false)
            .unwrap();
        assert_eq!(
            core.finish_stage(&human, &proof).unwrap().state,
            StageState::Verified
        );
        originals.push(original);
    }
    let command = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1794000000000,
        text: "\u{1}".repeat(128 * 1024),
        tags: (0..64)
            .map(|index| format!("{index:02}{}", "\u{1}".repeat(126)))
            .collect(),
        originals,
    };
    let receipt = core.submit(&human, &command).unwrap();
    let records = core.events(&human, profile).unwrap();
    let record = &records[0];
    // This is a supported local fact, even though a later bounded wire page
    // must report it as oversized instead of dropping it or changing its text.
    assert!(serde_json::to_vec(record).unwrap().len() > 1024 * 1024);
    assert_eq!(record.text.len(), command.text.len());
    assert_eq!(record.originals.len(), 256);
    assert_eq!(core.origin_checkpoint(&human, profile).unwrap().seq, 1);
    let next = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: command.occurred_at_ms + 1,
        text: "ordinary next fact".into(),
        tags: vec![],
        originals: vec![],
    };
    core.submit(&human, &next).unwrap();
    assert_eq!(core.origin_checkpoint(&human, profile).unwrap().seq, 2);
    assert!(core.submit(&human, &command).unwrap().replayed);
    assert_eq!(
        core.receipt(&human, command.command_id)
            .unwrap()
            .unwrap()
            .event_digest,
        receipt.event_digest
    );
    drop(core);
    let reopened = Core::open(directory.path()).unwrap();
    let human = reopened.local_human(profile).unwrap();
    assert_eq!(reopened.origin_checkpoint(&human, profile).unwrap().seq, 2);
    let facts = reopened.events(&human, profile).unwrap();
    assert_eq!(
        facts
            .iter()
            .find(|fact| fact.event_id == command.event_id)
            .unwrap()
            .text,
        command.text
    );
}
