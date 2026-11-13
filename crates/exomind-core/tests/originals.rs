use exomind_core::{
    AgentId, BeginStageCommand, CaptureCommand, CommandId, Core, CoreError, EventId,
    MAX_ORIGINAL_CHUNK_BYTES, OriginalId, OriginalRef, ProfileId, StageId, StageState,
};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Barrier};

fn begin(profile_id: ProfileId, bytes: &[u8]) -> BeginStageCommand {
    BeginStageCommand {
        stage_id: StageId::new(),
        original_id: OriginalId::new(),
        profile_id,
        expected_sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "未知原件.custom".into(),
        media_type: "application/octet-stream".into(),
    }
}
fn capture(profile_id: ProfileId, originals: Vec<OriginalRef>) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1234,
        text: String::new(),
        tags: vec![],
        originals,
    }
}
fn ready(core: &Core, profile: ProfileId, bytes: &[u8]) -> (BeginStageCommand, OriginalRef) {
    let context = core.local_human(profile).unwrap();
    let command = begin(profile, bytes);
    core.begin_stage(&context, &command).unwrap();
    for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
        core.write_stage_chunk(
            &context,
            command.stage_id,
            (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        )
        .unwrap();
    }
    let ticket = core.freeze_stage(&context, command.stage_id).unwrap();
    let proof = ticket.verify(|| false).unwrap();
    let status = core.finish_stage(&context, &proof).unwrap();
    assert_eq!(status.state, StageState::Verified);
    (command, status.original)
}

#[test]
fn arbitrary_bytes_and_empty_files_roundtrip_without_becoming_facts_until_capture() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let bytes: Vec<u8> = (0..(MAX_ORIGINAL_CHUNK_BYTES * 2 + 17))
        .map(|n| (n % 251) as u8)
        .collect();
    let (stage, original) = ready(&core, profile, &bytes);
    assert!(core.events(&context, profile).unwrap().is_empty());
    assert!(matches!(
        core.read_original_range(&context, profile, original.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert_eq!(
        core.read_stage_range(&context, stage.stage_id, 0, 10)
            .unwrap()
            .bytes,
        bytes[..10]
    );
    let (_, empty) = ready(&core, profile, &[]);
    let command = capture(profile, vec![original.clone(), empty.clone()]);
    let receipt = core.submit(&context, &command).unwrap();
    assert_eq!(receipt.local_seq, 1);
    let mut actual = Vec::new();
    while actual.len() < bytes.len() {
        actual.extend(
            core.read_original_range(
                &context,
                profile,
                original.original_id,
                actual.len() as u64,
                MAX_ORIGINAL_CHUNK_BYTES,
            )
            .unwrap()
            .bytes,
        );
    }
    assert!(actual == bytes);
    assert!(
        core.read_original_range(&context, profile, empty.original_id, 0, 1)
            .unwrap()
            .bytes
            .is_empty()
    );
    let events = core.events(&context, profile).unwrap();
    assert_eq!(events[0].originals, vec![original, empty]);
    assert!(core.submit(&context, &command).unwrap().replayed);
    let mut changed = command.clone();
    changed.originals.reverse();
    assert!(matches!(
        core.submit(&context, &changed),
        Err(CoreError::CommandConflict)
    ));
}

#[test]
fn acknowledged_chunks_reopen_resume_and_conflicting_retries_never_replace_bytes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let command = begin(profile, b"abcdef");
    core.begin_stage(&context, &command).unwrap();
    assert_eq!(
        core.write_stage_chunk(&context, command.stage_id, 0, b"abc")
            .unwrap()
            .next_offset,
        3
    );
    assert_eq!(
        core.write_stage_chunk(&context, command.stage_id, 0, b"abc")
            .unwrap()
            .next_offset,
        3
    );
    assert!(matches!(
        core.write_stage_chunk(&context, command.stage_id, 0, b"xyz"),
        Err(CoreError::ChunkConflict)
    ));
    assert!(matches!(
        core.write_stage_chunk(&context, command.stage_id, 2, b"cde"),
        Err(CoreError::InvalidOriginalOffset)
    ));
    assert!(matches!(
        core.freeze_stage(&context, command.stage_id),
        Err(CoreError::StageIncomplete)
    ));
    drop(core);
    let core = Core::open(root.path()).unwrap();
    let context = core.local_human(profile).unwrap();
    assert_eq!(core.begin_stage(&context, &command).unwrap().next_offset, 3);
    core.write_stage_chunk(&context, command.stage_id, 3, b"def")
        .unwrap();
    let ticket = core.freeze_stage(&context, command.stage_id).unwrap();
    assert!(matches!(
        core.write_stage_chunk(&context, command.stage_id, 3, b"def"),
        Err(CoreError::StageNotUploading)
    ));
    assert_eq!(
        core.freeze_stage(&context, command.stage_id)
            .unwrap()
            .verify(|| false)
            .unwrap()
            .stage_id(),
        command.stage_id
    );
    let proof = ticket.verify(|| false).unwrap();
    let status = core.finish_stage(&context, &proof).unwrap();
    assert_eq!(status, core.finish_stage(&context, &proof).unwrap());
    assert!(
        core.read_stage_range(&context, command.stage_id, 0, 6)
            .unwrap()
            .bytes
            == b"abcdef"
    );
}

#[test]
fn stage_identity_author_and_profile_are_bound_and_private_drafts_are_not_shared() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("same").unwrap();
    let q = core.create_profile("same").unwrap();
    let human = core.local_human(p).unwrap();
    let agent = core.local_agent(p, AgentId::new()).unwrap();
    let (command, original) = ready(&core, p, b"private");
    let mut changed = command.clone();
    changed.file_name = "changed.bin".into();
    assert!(matches!(
        core.begin_stage(&human, &changed),
        Err(CoreError::StageConflict)
    ));
    changed = command.clone();
    changed.stage_id = StageId::new();
    assert!(matches!(
        core.begin_stage(&human, &changed),
        Err(CoreError::OriginalConflict)
    ));
    assert!(matches!(
        core.stage_status(&agent, command.stage_id),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert!(matches!(
        core.read_stage_range(&agent, command.stage_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert!(
        core.stage_status(&core.local_human(q).unwrap(), command.stage_id)
            .is_err()
    );
    assert!(matches!(
        core.submit(&agent, &capture(p, vec![original.clone()])),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert!(matches!(
        core.read_original_range(&agent, p, original.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    core.submit(&human, &capture(p, vec![original.clone()]))
        .unwrap();
    assert!(
        core.read_original_range(&agent, p, original.original_id, 0, 7)
            .unwrap()
            .bytes
            == b"private"
    );
    assert!(
        core.read_original_range(&core.local_human(q).unwrap(), q, original.original_id, 0, 1)
            .is_err()
    );
    assert!(core.submit(&agent, &capture(p, vec![original])).is_ok());
}

#[test]
fn mismatch_cancel_and_old_lifecycle_proofs_never_become_verified() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let command = begin(profile, b"good");
    core.begin_stage(&context, &command).unwrap();
    core.write_stage_chunk(&context, command.stage_id, 0, b"evil")
        .unwrap();
    let ticket = core.freeze_stage(&context, command.stage_id).unwrap();
    assert!(matches!(
        ticket.verify(|| true),
        Err(CoreError::VerificationCancelled)
    ));
    let proof = ticket.verify(|| false).unwrap();
    assert!(matches!(
        core.finish_stage(&context, &proof),
        Err(CoreError::OriginalHashMismatch)
    ));
    assert_eq!(
        core.stage_status(&context, command.stage_id).unwrap().state,
        StageState::HashMismatch
    );
    assert!(
        core.read_stage_range(&context, command.stage_id, 0, 4)
            .unwrap()
            .bytes
            == b"evil"
    );
    let good = begin(profile, b"ok");
    core.begin_stage(&context, &good).unwrap();
    core.write_stage_chunk(&context, good.stage_id, 0, b"ok")
        .unwrap();
    let proof = core
        .freeze_stage(&context, good.stage_id)
        .unwrap()
        .verify(|| false)
        .unwrap();
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    assert!(matches!(
        reopened.finish_stage(&reopened.local_human(profile).unwrap(), &proof),
        Err(CoreError::StaleVerification)
    ));
    let ctx = reopened.local_human(profile).unwrap();
    let proof = reopened
        .freeze_stage(&ctx, good.stage_id)
        .unwrap()
        .verify(|| false)
        .unwrap();
    assert_eq!(
        reopened.finish_stage(&ctx, &proof).unwrap().state,
        StageState::Verified
    );
}

#[test]
fn fixed_group_and_receipt_insert_failure_roll_back_all_fact_references() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let (_, a) = ready(&core, profile, b"A");
    let b = begin(profile, b"B");
    let b_ref = core.begin_stage(&context, &b).unwrap().original;
    let command = capture(profile, vec![a.clone(), b_ref]);
    assert!(matches!(
        core.submit(&context, &command),
        Err(CoreError::OriginalNotReady)
    ));
    assert!(core.events(&context, profile).unwrap().is_empty());
    assert!(
        core.receipt(&context, command.command_id)
            .unwrap()
            .is_none()
    );
    let input = capture(profile, vec![a.clone()]);
    let connection = rusqlite::Connection::open(core.database_path()).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_original_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;").unwrap();
    assert!(core.submit(&context, &input).is_err());
    assert!(core.events(&context, profile).unwrap().is_empty());
    assert!(matches!(
        core.read_original_range(&context, profile, a.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    connection
        .execute_batch("DROP TRIGGER fail_original_receipt")
        .unwrap();
    assert_eq!(core.submit(&context, &input).unwrap().local_seq, 1);
}

#[test]
fn independent_connections_share_idempotent_chunk_writes_without_process_locks() {
    let root = tempfile::tempdir().unwrap();
    let first = Core::open(root.path()).unwrap();
    let p = first.create_profile("P").unwrap();
    let command = begin(p, b"same");
    first
        .begin_stage(&first.local_human(p).unwrap(), &command)
        .unwrap();
    let second = Core::open(root.path()).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = [first, second]
        .into_iter()
        .map(|core| {
            let barrier = barrier.clone();
            let stage = command.stage_id;
            std::thread::spawn(move || {
                let context = core.local_human(p).unwrap();
                barrier.wait();
                core.write_stage_chunk(&context, stage, 0, b"same")
                    .unwrap()
                    .next_offset
            })
        })
        .collect();
    for worker in workers {
        assert_eq!(worker.join().unwrap(), 4);
    }
}

#[test]
fn hashing_uses_a_separate_connection_and_can_be_cancelled_between_chunks() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let context = core.local_human(p).unwrap();
    let bytes = vec![7; MAX_ORIGINAL_CHUNK_BYTES * 3];
    let command = begin(p, &bytes);
    core.begin_stage(&context, &command).unwrap();
    for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
        core.write_stage_chunk(
            &context,
            command.stage_id,
            (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        )
        .unwrap();
    }
    let ticket = core.freeze_stage(&context, command.stage_id).unwrap();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let worker = {
        let entered = entered.clone();
        let release = release.clone();
        std::thread::spawn(move || {
            let calls = std::sync::atomic::AtomicUsize::new(0);
            ticket.verify(|| {
                if calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 2 {
                    false
                } else {
                    entered.wait();
                    release.wait();
                    true
                }
            })
        })
    };
    entered.wait();
    let mut text = capture(p, vec![]);
    text.text = "text remains writable".into();
    assert_eq!(core.submit(&context, &text).unwrap().local_seq, 1);
    release.wait();
    assert!(matches!(
        worker.join().unwrap(),
        Err(CoreError::VerificationCancelled)
    ));
}

#[test]
fn actual_sql_byte_corruption_is_rejected_by_bounded_stage_and_original_reads() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let (stage, original) = ready(&core, profile, b"safe");
    let command = capture(profile, vec![original.clone()]);
    let receipt = core.submit(&context, &command).unwrap();
    // Bypass the API's immutability guard to model corrupt stored bytes. Keep
    // the length unchanged; a size check alone cannot detect this mutation.
    let database = rusqlite::Connection::open(core.database_path()).unwrap();
    database
        .execute_batch("DROP TRIGGER original_chunks_no_update")
        .unwrap();
    database
        .execute(
            "UPDATE original_chunks SET bytes=?2 WHERE stage_id=?1",
            rusqlite::params![stage.stage_id.to_string(), b"evil".as_slice()],
        )
        .unwrap();
    assert!(
        core.read_stage_range(&context, stage.stage_id, 1, 1)
            .is_err()
    );
    assert!(
        core.read_original_range(&context, profile, original.original_id, 0, 1)
            .is_err()
    );
    let stored = core.receipt(&context, command.command_id).unwrap().unwrap();
    assert_eq!(stored, receipt);
    let bytes: Vec<u8> = database
        .query_row(
            "SELECT bytes FROM original_chunks WHERE stage_id=?1",
            [stage.stage_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(bytes == b"evil");
}

#[test]
fn tiny_appends_use_fixed_physical_blocks_and_preserve_subrange_retry_semantics() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("bounded tiny appends").unwrap();
    let context = core.local_human(profile).unwrap();
    let bytes: Vec<u8> = (0..MAX_ORIGINAL_CHUNK_BYTES + 37)
        .map(|index| (index % 251) as u8)
        .collect();
    let command = begin(profile, &bytes);
    core.begin_stage(&context, &command).unwrap();
    for (offset, byte) in bytes[..257].iter().enumerate() {
        core.write_stage_chunk(
            &context,
            command.stage_id,
            offset as u64,
            std::slice::from_ref(byte),
        )
        .unwrap();
    }
    let database = rusqlite::Connection::open_with_flags(
        core.database_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let layout = || {
        let mut query = database.prepare("SELECT offset,length(bytes) FROM original_chunks WHERE stage_id=?1 ORDER BY offset").unwrap();
        query
            .query_map([command.stage_id.to_string()], |row| {
                Ok((row.get::<_, u64>(0)?, row.get::<_, usize>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(
        layout(),
        vec![(0, 257)],
        "accepted one-byte writes must coalesce into a bounded block layout"
    );
    core.write_stage_chunk(&context, command.stage_id, 17, &bytes[17..83])
        .unwrap();
    assert!(matches!(
        core.write_stage_chunk(&context, command.stage_id, 17, &[255; 66]),
        Err(CoreError::ChunkConflict)
    ));
    assert!(matches!(
        core.write_stage_chunk(&context, command.stage_id, 256, &bytes[256..261]),
        Err(CoreError::InvalidOriginalOffset)
    ));
    // One accepted append crosses the old tail boundary and creates at most one new row.
    core.write_stage_chunk(&context, command.stage_id, 257, &bytes[257..])
        .unwrap();
    assert_eq!(
        layout(),
        vec![
            (0, MAX_ORIGINAL_CHUNK_BYTES),
            (MAX_ORIGINAL_CHUNK_BYTES as u64, 37)
        ]
    );
    assert!(
        core.read_stage_range(
            &context,
            command.stage_id,
            (MAX_ORIGINAL_CHUNK_BYTES - 19) as u64,
            56
        )
        .unwrap()
        .bytes
            == bytes[MAX_ORIGINAL_CHUNK_BYTES - 19..]
    );
    // Any <=256KiB range intersects at most two physical rows, independent of write call count.
    let intersections: usize = database.query_row("SELECT count(*) FROM original_chunks WHERE stage_id=?1 AND offset<(?2+?3) AND offset+length(bytes)>?2",rusqlite::params![command.stage_id.to_string(),1,MAX_ORIGINAL_CHUNK_BYTES],|row|row.get(0)).unwrap();
    assert_eq!(intersections, 2);
    let proof = core
        .freeze_stage(&context, command.stage_id)
        .unwrap()
        .verify(|| false)
        .unwrap();
    assert_eq!(
        core.finish_stage(&context, &proof).unwrap().state,
        StageState::Verified
    );
}

#[test]
fn tail_update_guard_rejects_prefix_replacement_shrink_and_identity_changes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("tail guard").unwrap();
    let context = core.local_human(profile).unwrap();
    let command = begin(profile, b"abcdef");
    core.begin_stage(&context, &command).unwrap();
    core.write_stage_chunk(&context, command.stage_id, 0, b"abc")
        .unwrap();
    let database = rusqlite::Connection::open(core.database_path()).unwrap();
    for bytes in [b"xbcdef".as_slice(), b"ab".as_slice(), b"abc".as_slice()] {
        assert!(
            database
                .execute(
                    "UPDATE original_chunks SET bytes=?2,chunk_sha256=?3 WHERE stage_id=?1",
                    rusqlite::params![
                        command.stage_id.to_string(),
                        bytes,
                        format!("{:x}", Sha256::digest(bytes))
                    ]
                )
                .is_err()
        );
    }
    assert!(
        database
            .execute(
                "UPDATE original_chunks SET offset=?2 WHERE stage_id=?1",
                rusqlite::params![command.stage_id.to_string(), MAX_ORIGINAL_CHUNK_BYTES]
            )
            .is_err()
    );
    assert!(
        core.read_stage_range(&context, command.stage_id, 0, 3)
            .unwrap()
            .bytes
            == b"abc"
    );
    assert_eq!(
        core.stage_status(&context, command.stage_id)
            .unwrap()
            .next_offset,
        3
    );
    core.write_stage_chunk(&context, command.stage_id, 3, b"def")
        .unwrap();
    let proof = core
        .freeze_stage(&context, command.stage_id)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&context, &proof).unwrap();
    assert!(
        database
            .execute(
                "UPDATE original_chunks SET bytes=?2 WHERE stage_id=?1",
                rusqlite::params![command.stage_id.to_string(), b"abcdefg".as_slice()]
            )
            .is_err()
    );
    assert!(
        core.read_stage_range(&context, command.stage_id, 0, 6)
            .unwrap()
            .bytes
            == b"abcdef"
    );
}
