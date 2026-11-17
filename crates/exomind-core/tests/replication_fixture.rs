//! Explicit, immutable fixture production with the current executable. Retain
//! the output before changing the schema; never manufacture an old fixture by
//! changing user_version or deleting tables from a newer database.
use exomind_core::*;
use sha2::{Digest, Sha256};

#[test]
#[ignore = "explicit external EXOMIND_CORE_REPLICATION_FIXTURE_OUT; refuses existing output"]
fn retain_current_replication_fixture() {
    let root = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE_REPLICATION_FIXTURE_OUT")
            .expect("explicit new fixture root"),
    );
    assert!(root.is_absolute());
    std::fs::create_dir(&root).expect("never replace an existing fixture");
    let core = Core::open(&root).unwrap();
    let p = core
        .create_profile("synthetic retained replication fixture")
        .unwrap();
    let human = core.local_human(p).unwrap();
    let bytes = b"synthetic retained original bytes";
    let original = OriginalRef {
        original_id: OriginalId::new(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "synthetic.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            original_id: original.original_id,
            profile_id: p,
            expected_sha256: original.sha256.clone(),
            byte_length: original.byte_length,
            file_name: original.file_name.clone(),
            media_type: original.media_type.clone(),
        },
    )
    .unwrap();
    core.write_stage_chunk(&human, stage, 0, bytes).unwrap();
    let proof = core
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap();
    core.submit(
        &human,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1000,
            text: "synthetic local retained capture".into(),
            tags: vec!["fixture".into()],
            originals: vec![original],
        },
    )
    .unwrap();
    let source_root = tempfile::tempdir().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    source
        .provision_profile(p, "synthetic retained replication fixture")
        .unwrap();
    let remote_reader = source.local_human(p).unwrap();
    for i in 0..3 {
        source
            .submit(
                &remote_reader,
                &CaptureCommand {
                    command_id: CommandId::new(),
                    event_id: EventId::new(),
                    profile_id: p,
                    occurred_at_ms: 2000 + i,
                    text: format!("synthetic remote capture {i}"),
                    tags: vec![],
                    originals: vec![],
                },
            )
            .unwrap();
    }
    let page = source
        .export_origin_page(&remote_reader, p, &OriginPageQuery::default())
        .unwrap();
    let context = core
        .trusted_replica_context(p, page.origin.device_id, page.origin.restoration_epoch, 1)
        .unwrap();
    core.import_origin_page(&context, &page).unwrap();
    let schema = CORE_SCHEMA_VERSION;
    drop(core);
    println!(
        "retained actual Core{schema} synthetic local/remote facts, receipts and original bytes"
    );
}
