use super::*;

fn setup() -> (tempfile::TempDir, Core, WriterContext, BeginStageCommand) {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic").unwrap();
    let context = core.local_human(profile).unwrap();
    let command = BeginStageCommand {
        stage_id: StageId::new(),
        original_id: OriginalId::new(),
        profile_id: profile,
        expected_sha256: "0".repeat(64),
        byte_length: (MAX_ORIGINAL_CHUNK_BYTES * 4) as u64,
        file_name: "full.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    core.begin_stage(&context, &command).unwrap();
    (root, core, context, command)
}

#[test]
fn real_sqlite_full_rolls_back_chunk_bytes_and_offset_without_resetting_the_saved_prefix() {
    let (_root, core, context, command) = setup();
    core.write_stage_chunk(&context, command.stage_id, 0, b"a")
        .unwrap();
    {
        let connection = core.connection().unwrap();
        let pages: i64 = connection
            .pragma_query_value(None, "page_count", |row| row.get(0))
            .unwrap();
        connection
            .pragma_update(None, "max_page_count", pages)
            .unwrap();
    }
    let bytes = vec![42; MAX_ORIGINAL_CHUNK_BYTES];
    let error = core
        .write_stage_chunk(&context, command.stage_id, 1, &bytes)
        .unwrap_err();
    assert!(
        matches!(error,CoreError::Storage(rusqlite::Error::SqliteFailure(code,_)) if code.code==rusqlite::ErrorCode::DiskFull)
    );
    assert_eq!(
        core.stage_status(&context, command.stage_id)
            .unwrap()
            .next_offset,
        1
    );
    assert!(
        core.read_stage_range(&context, command.stage_id, 0, 2)
            .unwrap()
            .bytes
            == b"a"
    );
    assert!(
        core.events(&context, context.profile_id)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn sqlite_write_denial_does_not_advance_stage_or_fall_back_to_another_store() {
    let (_root, core, context, command) = setup();
    core.connection()
        .unwrap()
        .pragma_update(None, "query_only", true)
        .unwrap();
    let error = core
        .write_stage_chunk(&context, command.stage_id, 0, b"a")
        .unwrap_err();
    assert!(
        matches!(error,CoreError::Storage(rusqlite::Error::SqliteFailure(code,_)) if code.code==rusqlite::ErrorCode::ReadOnly)
    );
    assert_eq!(
        core.stage_status(&context, command.stage_id)
            .unwrap()
            .next_offset,
        0
    );
    core.connection()
        .unwrap()
        .pragma_update(None, "query_only", false)
        .unwrap();
    assert_eq!(
        core.write_stage_chunk(&context, command.stage_id, 0, b"a")
            .unwrap()
            .next_offset,
        1
    );
}

#[test]
fn metadata_accepts_large_originals_without_allocating_their_whole_contents_and_ranges_are_bounded()
{
    let (_root, core, context, mut command) = setup();
    command.stage_id = StageId::new();
    command.original_id = OriginalId::new();
    command.byte_length = 5 * 1024 * 1024 * 1024;
    assert_eq!(
        core.begin_stage(&context, &command)
            .unwrap()
            .original
            .byte_length,
        command.byte_length
    );
    assert!(matches!(
        core.read_stage_range(&context, command.stage_id, 0, MAX_ORIGINAL_CHUNK_BYTES + 1),
        Err(CoreError::InvalidOriginalOffset)
    ));
    command.expected_sha256 = "not a digest".into();
    assert!(matches!(
        core.begin_stage(&context, &command),
        Err(CoreError::InvalidOriginal(_))
    ));
}

#[test]
fn tickets_and_proofs_are_send_without_transport_deserialization() {
    fn assert_send<T: Send>() {}
    assert_send::<VerificationTicket>();
    assert_send::<VerificationProof>();
}
