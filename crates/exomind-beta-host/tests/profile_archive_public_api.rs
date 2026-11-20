// Public API regressions for offline profile history and original bytes.
use exomind_beta_host::{
    ArchiveBudget, ArchiveLimits, BetaHost, GrantKind, GrantRequest, ProfileArchiveError,
    ProfileArchivePhase,
};
use exomind_core::{
    AgentId, AuthorKind, BeginStageCommand, CaptureCommand, CommandId, EventId, EventQuery,
    OriginalId, OriginalRef, ProfileId, StageId,
};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use tempfile::tempdir;

fn capture_command(
    profile: ProfileId,
    event_id: EventId,
    text: &str,
    originals: Vec<OriginalRef>,
) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id,
        profile_id: profile,
        occurred_at_ms: 1_000,
        text: text.to_owned(),
        tags: vec!["archive-contract".to_owned()],
        originals,
    }
}

fn committed_original(
    host: &BetaHost,
    human: &exomind_beta_host::Session,
    profile: ProfileId,
    bytes: &[u8],
) -> OriginalRef {
    let stage = StageId::new();
    let original_id = OriginalId::new();
    let expected_sha256 = format!("{:x}", Sha256::digest(bytes));
    let command = BeginStageCommand {
        stage_id: stage,
        original_id,
        profile_id: profile,
        expected_sha256: expected_sha256.clone(),
        byte_length: bytes.len() as u64,
        file_name: "source.bin".to_owned(),
        media_type: "application/octet-stream".to_owned(),
    };
    host.begin_stage(human, &command).unwrap();
    for (index, chunk) in bytes
        .chunks(exomind_core::MAX_ORIGINAL_CHUNK_BYTES)
        .enumerate()
    {
        host.write_stage_chunk(
            human,
            profile,
            stage,
            (index * exomind_core::MAX_ORIGINAL_CHUNK_BYTES) as u64,
            chunk,
        )
        .unwrap();
    }
    host.verify_stage(human, profile, stage).unwrap().original
}

fn archive_bytes(
    host: &BetaHost,
    session: &exomind_beta_host::Session,
    profile: ProfileId,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    let receipt = host
        .export_profile_archive(session, profile, &mut bytes, ArchiveBudget::default())
        .unwrap();
    assert!(receipt.complete);
    assert!(!bytes.is_empty());
    bytes
}

fn record(
    host: &BetaHost,
    session: &exomind_beta_host::Session,
    profile: ProfileId,
    id: EventId,
) -> exomind_core::EventRecord {
    host.events_page(session, profile, &EventQuery::default())
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.event_id == id)
        .unwrap()
}

#[test]
fn one_profile_roundtrip_preserves_facts_and_originals_without_copying_authority() {
    let source_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let source_owner = source.owner_session().unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(&source_owner, profile, "synthetic archive profile")
        .unwrap();
    // Archive proof must be signed by the source device. Creating its local
    // transport identity must not create peer membership or export the key.
    source.device_identity(&source_owner).unwrap();
    let source_human = source.native_human_session(&source_owner, profile).unwrap();
    let attachment = b"synthetic original bytes";
    let original = committed_original(&source, &source_human, profile, attachment);
    let capture_id = EventId::new();
    let capture = capture_command(profile, capture_id, "human capture", vec![original.clone()]);
    let capture_receipt = source.capture(&source_human, &capture).unwrap();
    let capture_before = record(&source, &source_human, profile, capture_id);

    let agent_grant = source
        .grant(
            &source_owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::AgentNote,
                agent_id: Some(AgentId::new()),
            },
        )
        .unwrap();
    let source_agent = source.authenticate(&agent_grant.token).unwrap();
    let agent_event_id = EventId::new();
    source
        .capture(
            &source_agent,
            &capture_command(profile, agent_event_id, "agent note", Vec::new()),
        )
        .unwrap();
    let agent_before = record(&source, &source_human, profile, agent_event_id);
    assert_eq!(agent_before.author_kind, AuthorKind::AgentNote);

    let source_device = source.status().unwrap().device_id;
    let archive = archive_bytes(&source, &source_human, profile);
    // AgentNote remains read/export-capable after the source key is initialized.
    assert!(!archive_bytes(&source, &source_agent, profile).is_empty());

    let target_root = tempdir().unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let target_owner = target.owner_session().unwrap();
    assert!(target.profiles(&target_owner).unwrap().is_empty());
    let preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert_eq!(preview.profile_id, profile);
    assert_eq!(
        preview.source_display_name.as_deref(),
        Some("synthetic archive profile")
    );
    assert!(preview.can_import);
    assert!(preview.conflicts.is_empty());
    assert!(preview.missing_originals.is_empty());

    let imported = target
        .import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert!(imported.complete);
    assert_eq!(imported.inserted_facts, 2);
    assert_eq!(target.profiles(&target_owner).unwrap().len(), 1);
    let target_human = target.native_human_session(&target_owner, profile).unwrap();
    let capture_after = record(&target, &target_human, profile, capture_id);
    let agent_after = record(&target, &target_human, profile, agent_event_id);
    for (before, after) in [
        (&capture_before, &capture_after),
        (&agent_before, &agent_after),
    ] {
        assert_eq!(after.event_id, before.event_id);
        assert_eq!(after.profile_id, before.profile_id);
        assert_eq!(after.device_id, before.device_id);
        assert_eq!(after.author_id, before.author_id);
        assert_eq!(after.author_kind, before.author_kind);
        assert_eq!(after.digest, before.digest);
        assert_eq!(after.text, before.text);
    }
    assert_eq!(capture_after.originals, vec![original.clone()]);
    assert_eq!(
        target
            .read_original_range(
                &target_human,
                profile,
                original.original_id,
                0,
                attachment.len()
            )
            .unwrap()
            .bytes,
        attachment,
    );
    assert_eq!(
        target
            .receipt(&target_human, profile, capture_receipt.command_id)
            .unwrap(),
        None,
        "archive import must not forge a receiver-local capture receipt"
    );
    assert_ne!(target.status().unwrap().device_id, source_device);
    assert!(
        target
            .peer_members(&target_owner, profile)
            .unwrap()
            .is_empty()
    );
    assert!(target.authenticate(&agent_grant.token).is_err());

    let repeated_preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    let repeated = target
        .import_profile_archive(
            &target_owner,
            repeated_preview.preview_id,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert_eq!(repeated.inserted_facts, 0);
    assert_eq!(repeated.duplicate_facts, 2);
    assert_eq!(
        target.peer_members(&target_owner, profile).unwrap().len(),
        0
    );

    let target_agent_grant = target
        .grant(
            &target_owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::AgentNote,
                agent_id: Some(AgentId::new()),
            },
        )
        .unwrap();
    let target_agent = target.authenticate(&target_agent_grant.token).unwrap();
    assert!(!archive_bytes(&target, &target_agent, profile).is_empty());
    assert!(
        target
            .preview_profile_archive_import(
                &target_agent,
                &mut Cursor::new(archive.as_slice()),
                ArchiveBudget::default(),
            )
            .is_err()
    );
    assert!(
        target
            .import_profile_archive(
                &target_agent,
                repeated_preview.preview_id,
                &mut Cursor::new(archive.as_slice()),
                ArchiveBudget::default(),
            )
            .is_err()
    );

    source.stop().unwrap();
    target.stop().unwrap();
}

#[test]
fn conflicting_ids_and_corrupt_archives_do_not_replace_existing_profile_facts() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let source_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let source_owner = source.owner_session().unwrap();
    source
        .provision_profile(&source_owner, profile, "source")
        .unwrap();
    source.device_identity(&source_owner).unwrap();
    let source_human = source.native_human_session(&source_owner, profile).unwrap();
    source
        .capture(
            &source_human,
            &capture_command(profile, event_id, "source body", Vec::new()),
        )
        .unwrap();
    let archive = archive_bytes(&source, &source_human, profile);

    let target_root = tempdir().unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let target_owner = target.owner_session().unwrap();
    target
        .provision_profile(&target_owner, profile, "target")
        .unwrap();
    let target_human = target.native_human_session(&target_owner, profile).unwrap();
    target
        .capture(
            &target_human,
            &capture_command(profile, event_id, "different local body", Vec::new()),
        )
        .unwrap();
    let before = record(&target, &target_human, profile, event_id);

    let conflict = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(archive.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert!(!conflict.can_import);
    assert_eq!(conflict.conflicts.len(), 1);
    assert!(
        target
            .import_profile_archive(
                &target_owner,
                conflict.preview_id,
                &mut Cursor::new(archive.as_slice()),
                ArchiveBudget::default(),
            )
            .is_err()
    );
    assert_eq!(
        record(&target, &target_human, profile, event_id).digest,
        before.digest
    );

    let mut corrupt = archive.clone();
    let offset = corrupt.len() / 2;
    corrupt[offset] ^= 0xff;
    assert!(
        target
            .preview_profile_archive_import(
                &target_owner,
                &mut Cursor::new(corrupt.as_slice()),
                ArchiveBudget::default(),
            )
            .is_err()
    );
    assert_eq!(
        record(&target, &target_human, profile, event_id).digest,
        before.digest
    );

    source.stop().unwrap();
    target.stop().unwrap();
}

#[test]
fn import_rejects_a_different_package_after_preview_without_provisioning_profile() {
    let source_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let source_owner = source.owner_session().unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(&source_owner, profile, "preview-bound archive")
        .unwrap();
    source.device_identity(&source_owner).unwrap();
    let source_human = source.native_human_session(&source_owner, profile).unwrap();
    source
        .capture(
            &source_human,
            &capture_command(
                profile,
                EventId::new(),
                "same facts, new package request",
                Vec::new(),
            ),
        )
        .unwrap();
    let first = archive_bytes(&source, &source_human, profile);
    let second = archive_bytes(&source, &source_human, profile);
    assert_ne!(first, second);

    let target_root = tempdir().unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let target_owner = target.owner_session().unwrap();
    let preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(first.as_slice()),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert!(preview.can_import);
    assert!(matches!(
        target.import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(second.as_slice()),
            ArchiveBudget::default(),
        ),
        Err(ProfileArchiveError::PreviewChanged)
    ));
    assert!(target.profiles(&target_owner).unwrap().is_empty());

    source.stop().unwrap();
    target.stop().unwrap();
}

#[test]
fn archive_roundtrip_crosses_fact_pages_and_original_chunks() {
    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let owner = source.owner_session().unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(&owner, profile, "paged archive")
        .unwrap();
    source.device_identity(&owner).unwrap();
    let human = source.native_human_session(&owner, profile).unwrap();
    let bytes = (0..exomind_core::MAX_ORIGINAL_CHUNK_BYTES * 2 + 17)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    let original = committed_original(&source, &human, profile, &bytes);
    for index in 0..105 {
        source
            .capture(
                &human,
                &capture_command(
                    profile,
                    EventId::new(),
                    &format!("event {index}"),
                    if index == 104 {
                        vec![original.clone()]
                    } else {
                        vec![]
                    },
                ),
            )
            .unwrap();
    }
    let archive = archive_bytes(&source, &human, profile);
    let target_owner = target.owner_session().unwrap();
    let preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(&archive),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert_eq!(preview.fact_count, 105);
    let imported = target
        .import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(&archive),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert!(imported.complete);
    assert_eq!(imported.inserted_facts, 105);
    let reader = target.native_human_session(&target_owner, profile).unwrap();
    let mut restored = Vec::new();
    while restored.len() < bytes.len() {
        let count = (bytes.len() - restored.len()).min(exomind_core::MAX_ORIGINAL_CHUNK_BYTES);
        restored.extend_from_slice(
            &target
                .read_original_range(
                    &reader,
                    profile,
                    original.original_id,
                    restored.len() as u64,
                    count,
                )
                .unwrap()
                .bytes,
        );
    }
    assert_eq!(restored, bytes);
    assert_eq!(format!("{:x}", Sha256::digest(&restored)), original.sha256);
    source.stop().unwrap();
    target.stop().unwrap();
}

#[test]
fn unsigned_archive_remains_explicitly_partial_after_import() {
    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let owner = source.owner_session().unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(&owner, profile, "unsigned history")
        .unwrap();
    let human = source.native_human_session(&owner, profile).unwrap();
    let command = capture_command(
        profile,
        EventId::new(),
        "unverified original author",
        vec![],
    );
    source.capture(&human, &command).unwrap();
    let mut archive = Vec::new();
    let exported = source
        .export_profile_archive(&human, profile, &mut archive, ArchiveBudget::default())
        .unwrap();
    assert!(!exported.complete);
    assert!(!exported.proofs_complete);
    let target_owner = target.owner_session().unwrap();
    let preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(&archive),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert!(preview.can_import);
    assert!(!preview.proofs_complete);
    assert_eq!(preview.unverified_origins.len(), 1);
    let imported = target
        .import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(&archive),
            ArchiveBudget::default(),
        )
        .unwrap();
    assert_eq!(imported.inserted_facts, 1);
    assert!(!imported.complete);
    assert!(!imported.proofs_complete);
    let reader = target.native_human_session(&target_owner, profile).unwrap();
    assert_eq!(
        record(&target, &reader, profile, command.event_id).text,
        command.text
    );
    source.stop().unwrap();
    target.stop().unwrap();
}

#[test]
fn cancelled_or_over_budget_import_does_not_provision_a_profile() {
    let source_root = tempdir().unwrap();
    let target_root = tempdir().unwrap();
    let source = BetaHost::open(source_root.path()).unwrap();
    let target = BetaHost::open(target_root.path()).unwrap();
    let owner = source.owner_session().unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(&owner, profile, "bounded import")
        .unwrap();
    source.device_identity(&owner).unwrap();
    let human = source.native_human_session(&owner, profile).unwrap();
    source
        .capture(
            &human,
            &capture_command(profile, EventId::new(), "bounded", vec![]),
        )
        .unwrap();
    let archive = archive_bytes(&source, &human, profile);
    let target_owner = target.owner_session().unwrap();
    let preview = target
        .preview_profile_archive_import(
            &target_owner,
            &mut Cursor::new(&archive),
            ArchiveBudget::default(),
        )
        .unwrap();
    let cancelled = ArchiveBudget::default();
    cancelled.cancel_handle().cancel();
    assert!(matches!(
        target.import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(&archive),
            cancelled.clone()
        ),
        Err(ProfileArchiveError::Cancelled)
    ));
    assert_eq!(
        cancelled.progress().unwrap().phase,
        ProfileArchivePhase::Partial
    );
    let limits = ArchiveLimits {
        max_total_bytes: 32,
        max_single_original_bytes: 32,
        ..ArchiveLimits::default()
    };
    let bounded = ArchiveBudget::with_limits(limits).unwrap();
    assert!(matches!(
        target.import_profile_archive(
            &target_owner,
            preview.preview_id,
            &mut Cursor::new(&archive),
            bounded
        ),
        Err(ProfileArchiveError::BudgetExceeded)
    ));
    assert!(target.profiles(&target_owner).unwrap().is_empty());
    source.stop().unwrap();
    target.stop().unwrap();
}
