use exomind_beta_host::{BetaHost, HostError};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, MAX_ORIGINAL_CHUNK_BYTES,
    OriginalId, OriginalLifecycleAction, OriginalLifecycleCommand, ProfileId, StageId,
};
use sha2::{Digest, Sha256};
use std::io::Write;
use tempfile::TempDir;
use uuid::Uuid;

#[allow(dead_code)]
#[path = "../../../src-tauri/src/beta_native_user_export.rs"]
mod beta_native_user_export;

#[allow(dead_code)]
#[path = "../../../src-tauri/src/beta_native_original_source.rs"]
mod beta_native_original_source;

#[derive(Debug)]
struct Failure {
    code: &'static str,
    _message: &'static str,
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure {
        code,
        _message: message,
    }
}

impl From<HostError> for Failure {
    fn from(_: HostError) -> Self {
        failure("host_error", "Host original access failed")
    }
}

struct Fixture {
    _root: TempDir,
    host: std::sync::Arc<BetaHost>,
    owner: exomind_beta_host::Session,
    human: exomind_beta_host::Session,
    profile: ProfileId,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let host = std::sync::Arc::new(BetaHost::open(&root.path().join("beta")).unwrap());
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "synthetic tar export")
            .unwrap();
        let human = host.native_human_session(&owner, profile).unwrap();
        Self {
            _root: root,
            host,
            owner,
            human,
            profile,
        }
    }

    fn capture_original(&self, bytes: &[u8]) -> exomind_core::OriginalRef {
        let original_id = OriginalId::new();
        let stage_id = StageId::new();
        self.host
            .begin_stage(
                &self.human,
                &BeginStageCommand {
                    stage_id,
                    original_id,
                    profile_id: self.profile,
                    expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                    byte_length: bytes.len() as u64,
                    file_name: "private-user-name.wav".into(),
                    media_type: "audio/wav".into(),
                },
            )
            .unwrap();
        for (index, chunk) in bytes.chunks(MAX_ORIGINAL_CHUNK_BYTES).enumerate() {
            self.host
                .write_stage_chunk(
                    &self.human,
                    self.profile,
                    stage_id,
                    (index * MAX_ORIGINAL_CHUNK_BYTES) as u64,
                    chunk,
                )
                .unwrap();
        }
        let original = self
            .host
            .verify_stage(&self.human, self.profile, stage_id)
            .unwrap()
            .original;
        self.host
            .capture(
                &self.human,
                &CaptureCommand {
                    command_id: CommandId::new(),
                    event_id: EventId::new(),
                    profile_id: self.profile,
                    occurred_at_ms: 1_794_000_000_000,
                    text: "selected capture".into(),
                    tags: vec![],
                    originals: vec![original.clone()],
                },
            )
            .unwrap();
        original
    }

    fn release(&self, original_id: OriginalId) {
        let status = self
            .host
            .original_lifecycle_status(&self.owner, self.profile, original_id)
            .unwrap();
        self.host
            .apply_original_lifecycle(
                &self.owner,
                &OriginalLifecycleCommand {
                    command_id: CommandId::new(),
                    event_id: EventId::new(),
                    profile_id: self.profile,
                    original_id,
                    expected_generation: status.local.generation,
                    occurred_at_ms: 1_794_000_000_010,
                    action: OriginalLifecycleAction::ReleaseLocal,
                    cleanup_confirmed: true,
                    follow_up_device_ids: vec![],
                    responds_to_event_id: None,
                },
            )
            .unwrap();
    }
}

fn tar_entries(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    assert_eq!(bytes.len() % 512, 0, "tar blocks have 512-byte alignment");
    let mut entries = Vec::new();
    let mut offset = 0usize;
    while offset + 512 <= bytes.len() {
        let header = &bytes[offset..offset + 512];
        if header.iter().all(|byte| *byte == 0) {
            assert!(
                bytes[offset..].iter().all(|byte| *byte == 0),
                "tar trailer is zero padded"
            );
            break;
        }
        assert_eq!(&header[257..263], b"ustar\0", "archive is POSIX USTAR");
        let name_end = header[..100]
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(100);
        let name = String::from_utf8(header[..name_end].to_vec()).unwrap();
        let size_end = header[124..136]
            .iter()
            .position(|byte| *byte == 0 || *byte == b' ')
            .unwrap_or(12);
        let size = usize::from_str_radix(
            std::str::from_utf8(&header[124..124 + size_end])
                .unwrap()
                .trim(),
            8,
        )
        .unwrap();
        let start = offset + 512;
        let end = start + size;
        entries.push((name, bytes[start..end].to_vec()));
        offset = start + size.div_ceil(512) * 512;
    }
    entries
}

#[test]
fn streams_permit_checked_original_chunks_into_one_plain_ustar_without_user_filename_paths() {
    use beta_native_original_source::Source;
    use beta_native_user_export::{
        UserExportTarError, UserExportTarMember, write_user_range_tar,
    };

    let f = Fixture::new();
    let bytes: Vec<u8> = (0..MAX_ORIGINAL_CHUNK_BYTES + 37)
        .map(|index| (index % 251) as u8)
        .collect();
    let original = f.capture_original(&bytes);
    let source = Source::begin(
        f.host.clone(),
        f.human.clone(),
        f.profile,
        original.original_id,
    )
    .unwrap();
    let member = UserExportTarMember {
        original_id: original.original_id,
        byte_length: original.byte_length,
        sha256: original.sha256.clone(),
    };
    let manifest = serde_json::json!({
        "complete": true,
        "originals": [{
            "original_id": original.original_id.to_string(),
            "file_name": original.file_name,
            "archive_member": format!("originals/{}.bin", original.original_id)
        }]
    });
    let mut tar = Vec::new();
    let receipt = write_user_range_tar(
        &mut tar,
        b"# selected records\n",
        &serde_json::to_vec(&manifest).unwrap(),
        &[member],
        |member, destination| {
            let mut offset = 0u64;
            while offset < member.byte_length {
                let length = (member.byte_length - offset)
                    .min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
                let chunk = source
                    .read(offset, length)
                    .map_err(|_| UserExportTarError::OriginalRead)?;
                assert_eq!(chunk.len(), length);
                destination.write_all(&chunk)?;
                offset += length as u64;
            }
            source
                .finish()
                .map_err(|_| UserExportTarError::OriginalRead)?;
            Ok(())
        },
    )
    .expect("permit-backed original bytes produce a verified tar");
    let entries = tar_entries(&tar);

    assert_eq!(
        entries.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>(),
        vec![
            "records.md",
            "manifest.json",
            &format!("originals/{}.bin", original.original_id)
        ]
    );
    assert_eq!(entries[0].1, b"# selected records\n");
    assert_eq!(entries[2].1, bytes);
    assert!(!entries.iter().any(|(name, _)| name.contains("private-user-name")));
    assert!(!tar.starts_with(&[0x1f, 0x8b]), "tar is uncompressed");
    assert_eq!(receipt.archive_byte_length, tar.len() as u64);
    assert_eq!(
        receipt.archive_sha256,
        format!("{:x}", Sha256::digest(&tar))
    );
}

#[test]
fn stale_original_permit_aborts_archive_before_a_success_receipt() {
    use beta_native_original_source::Source;
    use beta_native_user_export::{
        UserExportTarError, UserExportTarMember, write_user_range_tar,
    };

    let f = Fixture::new();
    let bytes: Vec<u8> = (0..MAX_ORIGINAL_CHUNK_BYTES + 37)
        .map(|index| (index % 251) as u8)
        .collect();
    let original = f.capture_original(&bytes);
    let source = Source::begin(
        f.host.clone(),
        f.human.clone(),
        f.profile,
        original.original_id,
    )
    .unwrap();
    let member = UserExportTarMember {
        original_id: original.original_id,
        byte_length: original.byte_length,
        sha256: original.sha256.clone(),
    };
    let mut tar = Vec::new();
    let result = write_user_range_tar(
        &mut tar,
        b"# selected records\n",
        b"{\"complete\":true}",
        &[member],
        |member, destination| {
            let first = source
                .read(0, MAX_ORIGINAL_CHUNK_BYTES)
                .map_err(|_| UserExportTarError::OriginalRead)?;
            destination.write_all(&first)?;
            f.release(original.original_id);
            let next_offset = first.len() as u64;
            let remaining = (member.byte_length - next_offset)
                .min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
            let next = source
                .read(next_offset, remaining)
                .map_err(|_| UserExportTarError::OriginalRead)?;
            destination.write_all(&next)?;
            source
                .finish()
                .map_err(|_| UserExportTarError::OriginalRead)?;
            Ok(())
        },
    );

    assert!(matches!(result, Err(UserExportTarError::OriginalRead)));
}

#[test]
fn result_dto_keeps_cancel_failure_and_hash_without_exposing_destination_paths() {
    use beta_native_user_export::{UserRangeExportResult, UserRangeExportPhase};

    let request_id = Uuid::new_v4();
    let profile_id = ProfileId::new();
    let saved = UserRangeExportResult::saved(
        request_id,
        profile_id,
        true,
        4096,
        "a".repeat(64),
        1,
        0,
    );
    let cancelled =
        UserRangeExportResult::cancelled(request_id, profile_id, true, 0, 1);
    let failed = UserRangeExportResult::failed(
        request_id,
        profile_id,
        "original_integrity",
        true,
        0,
        1,
    );

    assert_eq!(saved.phase, UserRangeExportPhase::Saved);
    assert_eq!(saved.archive_sha256.as_deref(), Some("a".repeat(64).as_str()));
    assert!(cancelled.partial_output);
    assert_eq!(cancelled.phase, UserRangeExportPhase::Cancelled);
    assert!(failed.partial_output);
    assert_eq!(failed.phase, UserRangeExportPhase::Failed);
    for result in [saved, cancelled, failed] {
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["request_id"], request_id.to_string());
        assert_eq!(json["profile_id"], profile_id.to_string());
        assert!(json.get("partial_output").is_some());
        assert!(json.get("path").is_none());
        assert!(json.get("uri").is_none());
        assert!(json.get("destination_path").is_none());
    }
}
