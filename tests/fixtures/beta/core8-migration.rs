use std::error::Error;
use std::path::PathBuf;

use exomind_core::*;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const SYNTHETIC_TIME_MS: i64 = 1_794_560_000_000;
const SYNTHETIC_ORIGINAL: &[u8] = b"Core8 synthetic attachment\x00\xff with a verified BLOB";

fn capture(profile_id: ProfileId, text: &str, originals: Vec<OriginalRef>) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: SYNTHETIC_TIME_MS,
        text: text.into(),
        tags: vec!["synthetic-migration".into()],
        originals,
    }
}

fn stage_and_verify_original(
    core: &Core,
    profile_id: ProfileId,
    bytes: &[u8],
) -> Result<OriginalRef, Box<dyn Error>> {
    let context = core.local_human(profile_id)?;
    let stage = BeginStageCommand {
        stage_id: StageId::new(),
        original_id: OriginalId::new(),
        profile_id,
        expected_sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "core8-synthetic.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    core.begin_stage(&context, &stage)?;
    for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
        core.write_stage_chunk(
            &context,
            stage.stage_id,
            (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        )?;
    }
    let proof = core.freeze_stage(&context, stage.stage_id)?.verify(|| false)?;
    let status = core.finish_stage(&context, &proof)?;
    if status.state != StageState::Verified {
        return Err("synthetic original did not reach verified state".into());
    }
    Ok(status.original)
}

fn main() -> Result<(), Box<dyn Error>> {
    assert_eq!(CORE_SCHEMA_VERSION, 8);
    let root = PathBuf::from(
        std::env::var_os("EXOMIND_SYNTHETIC_FIXTURE_OUT").ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "explicit synthetic fixture output root is required",
            )
        })?,
    );
    assert!(root.is_absolute() && !root.exists());
    let source = Core::open(&root.join("source"))?;
    let receiver = Core::open(&root.join("archive"))?;
    let p = source.create_profile("Synthetic Core8 migration fixture")?;
    receiver
        .provision_profile(p, "Synthetic Core8 migration fixture")?;
    let source_context = source.local_human(p)?;
    source.submit(&source_context, &capture(p, "Synthetic remote fact", vec![]))?;

    // Build the attachment through Core8's normal stage, chunk, verify, and
    // capture APIs so the archive contains a referenced non-empty BLOB.
    let receiver_context = receiver.local_human(p)?;
    let original = stage_and_verify_original(&receiver, p, SYNTHETIC_ORIGINAL)?;
    receiver.submit(
        &receiver_context,
        &capture(p, "Synthetic local attachment receipt", vec![original]),
    )?;

    // Keep one real timeblock node in the Core8 archive as an additional
    // schema migration fact; the essential attachment assertion is separate.
    let stamp = receiver.trusted_clock_stamp(Uuid::from_u128(17), SYNTHETIC_TIME_MS, 1)?;
    let expected_revision = receiver
        .timeblock_snapshot(&receiver_context, p, &stamp)?
        .revision;
    receiver.apply_timeblock(
        &receiver_context,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision,
            action: TimeblockAction::Start {
                block_id: TimeblockId::new(),
                name: "Core8 migration fixture".into(),
                note: "synthetic timeblock node".into(),
                timer: TimerSpec::CountUp,
            },
        },
        &stamp,
    )?;
    let page = source
        .export_origin_page(
            &source_context,
            p,
            &OriginPageQuery::default(),
        )?;
    let mut spki = vec![
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    spki.extend_from_slice(&[7; 32]);
    let key = OriginProvenanceKey {
        fingerprint_sha256: format!("{:x}", Sha256::digest(&spki)),
        public_key_spki: spki,
    };
    let context = receiver
        .trusted_verified_origin_context(p, DeviceId::new(), &page.origin, 9, key)?;
    // Exercise Core's trusted Host admission boundary, as its provenance unit
    // fixtures do. These synthetic bytes are not an Ed25519 verification test.
    let proof = OriginPageProof {
        entry_signatures: vec![vec![17; 64]; page.entries.len()],
        through_signature: vec![17; 64],
    };
    receiver
        .import_verified_origin_page(&context, &page, &proof)?;
    drop(receiver);
    drop(source);
    println!("Synthetic Core8 fixture generated with one verified attachment and one timeblock; no user archive or credential read");
    Ok(())
}
