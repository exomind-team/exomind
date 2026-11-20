use exomind_beta_host::{
    BetaHost, Session,
    user_export::{Selection, UserExportLimits},
    user_export_source::{
        UserExportOriginalDisposition as Disposition, UserExportSourceLimits,
        UserExportSourceRequest,
    },
};
use exomind_core::{
    BeginStageCommand, CaptureCommand, CommandId, EventId, OriginalId, OriginalLifecycleAction,
    OriginalLifecycleCommand, OriginalRef, ProfileId, RecordCorrectionCommand, StageId,
    StartBlockSpec, TimeblockAction, TimeblockCommand, TimeblockId, TimerSpec,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use uuid::Uuid;

struct Fixture {
    _root: TempDir,
    host: BetaHost,
    owner: Session,
    human: Session,
    profile: ProfileId,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let host = BetaHost::open(&root.path().join("beta")).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "synthetic user export")
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

    fn request(
        &self,
        selections: Vec<Selection>,
        max_original_bytes: u64,
    ) -> UserExportSourceRequest {
        UserExportSourceRequest {
            profile_id: self.profile,
            selections,
            limits: UserExportSourceLimits {
                format: UserExportLimits::default(),
                max_original_bytes,
            },
        }
    }

    fn capture(&self, text: &str, originals: Vec<OriginalRef>) -> exomind_core::Receipt {
        self.host
            .capture(
                &self.human,
                &CaptureCommand {
                    command_id: CommandId::new(),
                    event_id: EventId::new(),
                    profile_id: self.profile,
                    occurred_at_ms: 1_794_000_000_000,
                    text: text.to_owned(),
                    tags: vec![],
                    originals,
                },
            )
            .unwrap()
    }

    fn correction(
        &self,
        target_event_id: EventId,
        target_digest: String,
        text: &str,
    ) -> EventId {
        let correction_id = EventId::new();
        self.host
            .record_correction(
                &self.human,
                &RecordCorrectionCommand {
                    command_id: CommandId::new(),
                    event_id: correction_id,
                    profile_id: self.profile,
                    occurred_at_ms: 1_794_000_000_001,
                    target_event_id,
                    target_digest,
                    corrected_text: text.to_owned(),
                },
            )
            .unwrap();
        correction_id
    }

    fn original(&self, bytes: &[u8], file_name: &str) -> OriginalRef {
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
                    file_name: file_name.to_owned(),
                    media_type: "application/octet-stream".to_owned(),
                },
            )
            .unwrap();
        for (index, chunk) in bytes
            .chunks(exomind_core::MAX_ORIGINAL_CHUNK_BYTES)
            .enumerate()
        {
            self.host
                .write_stage_chunk(
                    &self.human,
                    self.profile,
                    stage_id,
                    (index * exomind_core::MAX_ORIGINAL_CHUNK_BYTES) as u64,
                    chunk,
                )
                .unwrap();
        }
        self.host
            .verify_stage(&self.human, self.profile, stage_id)
            .unwrap()
            .original
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

    fn timeblock_action(&self, event_id: EventId, action: TimeblockAction) {
        let snapshot = self
            .host
            .timeblock_snapshot(&self.human, self.profile)
            .unwrap();
        self.host
            .apply_timeblock(
                &self.human,
                &TimeblockCommand {
                    command_id: CommandId::new(),
                    event_id,
                    profile_id: self.profile,
                    expected_revision: snapshot.revision,
                    action,
                },
            )
            .unwrap();
    }
}

fn fact_ids(manifest: &Value) -> Vec<String> {
    manifest["facts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|fact| fact["event_id"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn real_host_resolves_exact_capture_and_corrections_at_one_highwater() {
    let f = Fixture::new();
    let selected = f.capture("selected capture body", vec![]);
    let matching = f.correction(
        selected.event_id,
        selected.event_digest.clone(),
        "matching correction text",
    );
    let unrelated = f.capture("unselected capture sentinel", vec![]);
    f.correction(
        unrelated.event_id,
        unrelated.event_digest,
        "unselected correction sentinel",
    );

    // Cross the Core timeline page boundary so the selected oldest capture is
    // found on a continuation page while all reads remain bound to one H.
    for index in 0..101 {
        f.capture(&format!("unselected page fixture {index}"), vec![]);
    }

    let request = f.request(vec![Selection::Event(selected.event_id)], 64);
    let result = f
        .host
        .collect_user_export_source(&f.human, &request)
        .expect("real Host source must resolve the selection");
    let manifest = &result.package.manifest;
    let highwater = manifest["highwater"].as_u64().unwrap();
    let pages = manifest["scan"]["pages"].as_array().unwrap();

    assert_eq!(manifest["scan"]["scope"], "selected_sources");
    assert_eq!(
        manifest["scan"]["selection_lookups"][0]["event_id"],
        selected.event_id.to_string()
    );
    assert_eq!(
        manifest["scan"]["selection_lookups"][0]["status"],
        "resolved"
    );
    assert!(
        pages.iter().all(|page| page["through"] == highwater),
        "every continuation must keep the first page highwater"
    );
    assert_eq!(manifest["scan"]["complete"], true);
    assert_eq!(
        fact_ids(manifest),
        vec![selected.event_id.to_string(), matching.to_string()]
    );
    assert!(result.package.markdown.contains("matching correction text"));
    assert!(!result.package.markdown.contains("unselected capture sentinel"));
    assert!(!result.package.markdown.contains("unselected correction sentinel"));
    assert_eq!(
        manifest["derived_selection"]["correction_scan"]["complete"],
        true
    );
    assert_eq!(manifest["complete"], true);
}

#[test]
fn real_host_timeblock_selection_uses_typed_references_and_rotation_sides() {
    let f = Fixture::new();
    let selected = TimeblockId::new();
    let preceding = TimeblockId::new();
    let adjacent = TimeblockId::new();

    let start_unrelated = EventId::new();
    f.timeblock_action(
        start_unrelated,
        TimeblockAction::Start {
            block_id: preceding,
            name: "preceding".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );

    let rotate_in = EventId::new();
    f.timeblock_action(
        rotate_in,
        TimeblockAction::Rotate {
            from_block_id: preceding,
            next: StartBlockSpec {
                block_id: selected,
                name: "selected".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
    );

    let rotate_out = EventId::new();
    f.timeblock_action(
        rotate_out,
        TimeblockAction::Rotate {
            from_block_id: selected,
            next: StartBlockSpec {
                block_id: adjacent,
                name: "adjacent".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
    );
    let adjacent_only = EventId::new();
    f.timeblock_action(adjacent_only, TimeblockAction::Pause { block_id: adjacent });

    let request = f.request(vec![Selection::Timeblock(selected)], 64);
    let result = f
        .host
        .collect_user_export_source(&f.human, &request)
        .expect("real Host source must resolve typed timeblock nodes");
    let manifest = &result.package.manifest;
    let ids = fact_ids(manifest);

    assert!(!ids.contains(&start_unrelated.to_string()));
    assert!(ids.contains(&rotate_out.to_string()));
    assert!(ids.contains(&rotate_in.to_string()));
    assert!(!ids.contains(&adjacent_only.to_string()));
    assert!(
        manifest["facts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|fact| fact["kind"] == "timeblock/1")
    );
    assert_eq!(manifest["complete"], true);
}

#[test]
fn released_and_over_budget_originals_have_no_member_and_make_archive_incomplete() {
    let f = Fixture::new();
    let fits = f.original(b"four", "human-name-four.wav");
    let too_large = f.original(b"seven!!", "human-name-seven.wav");
    let released = f.original(b"released", "human-name-released.wav");
    let event = f.capture(
        "capture with local originals",
        vec![fits.clone(), too_large.clone(), released.clone()],
    );
    f.release(released.original_id);

    let request = f.request(
        vec![Selection::Event(event.event_id)],
        fits.byte_length,
    );
    let result = f
        .host
        .collect_user_export_source(&f.human, &request)
        .expect("missing and budget omissions remain reportable");
    let manifest = &result.package.manifest;
    let included_bytes: u64 = result
        .original_members
        .iter()
        .filter(|member| member.disposition == Disposition::Included)
        .map(|member| member.original.byte_length)
        .sum();

    assert!(included_bytes <= fits.byte_length);
    assert!(result.original_members.iter().any(|member| {
        member.original.original_id == fits.original_id
            && member.disposition == Disposition::Included
            && member.member_name.as_deref()
                == Some(format!("originals/{}.bin", fits.original_id).as_str())
    }));
    assert!(result.original_members.iter().any(|member| {
        member.original.original_id == too_large.original_id
            && member.disposition == Disposition::BudgetExceeded
            && member.member_name.is_none()
    }));
    assert!(result.original_members.iter().any(|member| {
        member.original.original_id == released.original_id
            && member.disposition == Disposition::Missing
            && member.member_name.is_none()
    }));
    assert_eq!(manifest["complete"], false);
    for original in manifest["originals"].as_array().unwrap() {
        if original["original_id"] == released.original_id.to_string()
            || original["original_id"] == too_large.original_id.to_string()
        {
            assert!(original["archive_member"].is_null());
        }
    }
    assert!(
        !manifest
            .to_string()
            .contains("private/local/path"),
        "manifest never exposes a local filesystem path"
    );
}

#[test]
fn exact_old_capture_lookup_is_not_displaced_by_newer_unrelated_captures() {
    let f = Fixture::new();
    let selected = f.capture("old selected capture sentinel", vec![]);
    for index in 0..12 {
        f.capture(&format!("new unrelated capture {index}"), vec![]);
    }

    let mut request = f.request(vec![Selection::Event(selected.event_id)], 64);
    request.limits.format.max_scanned_facts = 2;
    let result = f
        .host
        .collect_user_export_source(&f.human, &request)
        .expect("an exact selected capture lookup must not scan newer unrelated rows");
    let manifest = &result.package.manifest;

    assert!(manifest["highwater"].as_u64().unwrap() > selected.local_seq + 2);
    assert_eq!(fact_ids(manifest), vec![selected.event_id.to_string()]);
    assert_eq!(manifest["selections"][0]["status"], "included");
    assert_eq!(manifest["complete"], true);
    assert!(result.package.markdown.contains("old selected capture sentinel"));
    assert!(!result.package.markdown.contains("new unrelated capture"));
}

#[test]
fn old_block_references_are_not_displaced_by_newer_unrelated_captures() {
    let f = Fixture::new();
    let selected = TimeblockId::new();
    let adjacent = TimeblockId::new();

    let start_selected = EventId::new();
    f.timeblock_action(
        start_selected,
        TimeblockAction::Start {
            block_id: selected,
            name: "old selected block".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );
    let rotate_out = EventId::new();
    f.timeblock_action(
        rotate_out,
        TimeblockAction::Rotate {
            from_block_id: selected,
            next: StartBlockSpec {
                block_id: adjacent,
                name: "adjacent".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
    );
    let adjacent_only = EventId::new();
    f.timeblock_action(adjacent_only, TimeblockAction::Pause { block_id: adjacent });

    for index in 0..12 {
        f.capture(&format!("new unrelated capture {index}"), vec![]);
    }

    let mut request = f.request(vec![Selection::Timeblock(selected)], 64);
    request.limits.format.max_scanned_facts = 3;
    let result = f
        .host
        .collect_user_export_source(&f.human, &request)
        .expect("block-reference lookup must be bounded by typed timeblock facts");
    let manifest = &result.package.manifest;
    let ids = fact_ids(manifest);

    assert!(manifest["highwater"].as_u64().unwrap() > 12);
    assert!(ids.contains(&start_selected.to_string()));
    assert!(ids.contains(&rotate_out.to_string()));
    assert!(!ids.contains(&adjacent_only.to_string()));
    assert_eq!(ids.len(), 2);
    assert!(manifest["facts"].as_array().unwrap().iter().all(|fact| {
        fact["kind"] == "timeblock/1"
    }));
    assert_eq!(manifest["selections"][0]["status"], "included");
    assert_eq!(manifest["complete"], true);
    assert!(!result.package.markdown.contains("new unrelated capture"));
}
