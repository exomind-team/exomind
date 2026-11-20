use exomind_beta_host::user_export::{
    CorrectionRead, CorrectionTargetScan, ScanCoverage, Selection, UserExportError,
    UserExportInput, UserExportLimits, UserExportOptions, build_user_export_with_options,
};
use exomind_core::{
    AuthorKind, CorrectionRecord, DeviceId, EventId, EventRecord, ProfileId, TimelineItem,
};
use serde_json::{Value, json};
use uuid::Uuid;

fn capture(profile_id: ProfileId, event_id: EventId, seq: u64, text: &str) -> TimelineItem {
    TimelineItem::Capture(EventRecord {
        event_id,
        profile_id,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        author_kind: AuthorKind::Human,
        occurred_at_ms: 1_800_000_000_000 + seq as i64,
        text: text.to_owned(),
        tags: vec![],
        originals: vec![],
        digest: format!("{seq:064x}"),
        local_seq: seq,
    })
}

fn correction(
    profile_id: ProfileId,
    target_event_id: EventId,
    target_digest: &str,
    seq: u64,
    text: &str,
) -> CorrectionRecord {
    CorrectionRecord {
        event_id: EventId::new(),
        profile_id,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        author_kind: AuthorKind::Human,
        occurred_at_ms: 1_800_000_000_000 + seq as i64,
        target_event_id,
        target_digest: target_digest.to_owned(),
        corrected_text: text.to_owned(),
        digest: format!("{seq:064x}"),
        local_seq: seq,
    }
}

fn input(profile_id: ProfileId, highwater: u64, event_id: EventId, text: &str) -> UserExportInput {
    UserExportInput {
        profile_id,
        highwater,
        selections: vec![Selection::Event(event_id)],
        scan: ScanCoverage {
            scanned_facts: 1,
            complete: true,
            next_before: None,
        },
        items: vec![capture(profile_id, event_id, 1, text)],
        originals: vec![],
        limits: UserExportLimits::default(),
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

fn target_scan(
    profile_id: ProfileId,
    target_event_id: EventId,
    highwater: u64,
    scanned_facts: usize,
    complete: bool,
    next_before: Option<u64>,
) -> CorrectionTargetScan {
    CorrectionTargetScan {
        profile_id,
        target_event_id,
        highwater,
        coverage: ScanCoverage {
            scanned_facts,
            complete,
            next_before,
        },
    }
}

#[test]
fn default_correction_derivation_freezes_profile_target_digest_and_highwater() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let capture_text = "immutable original wording";
    let capture_digest = format!("{:064x}", 1);
    let input = input(profile, 4, event_id, capture_text);
    let valid = correction(
        profile,
        event_id,
        &capture_digest,
        2,
        "append-only correction",
    );
    let conflict = correction(
        profile,
        event_id,
        &"f".repeat(64),
        3,
        "must stay out of valid correction text",
    );
    let after_snapshot = correction(
        profile,
        event_id,
        &capture_digest,
        5,
        "too late for snapshot",
    );
    let corrections = vec![valid.clone(), conflict.clone(), after_snapshot];
    let targets = vec![target_scan(profile, event_id, 4, 3, true, None)];

    let package = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &corrections,
            targets: &targets,
        },
        UserExportOptions::default(),
    )
    .expect("a bounded same-profile correction read should format");

    assert_eq!(UserExportOptions::default().include_corrections, true);
    assert_eq!(
        package.manifest["derived_selection"]["include_corrections"],
        json!(true)
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scope"],
        "selected_capture_same_profile_target_event_id_and_digest_local_seq_lte_highwater"
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["targets"][0]["highwater"],
        json!(4)
    );
    assert_eq!(
        fact_ids(&package.manifest),
        vec![event_id.to_string(), valid.event_id.to_string()]
    );
    assert_eq!(package.manifest["facts"][1]["kind"], "correction/1");
    assert_eq!(
        package.manifest["facts"][1]["target_event_id"],
        json!(event_id.to_string())
    );
    assert!(package.markdown.contains(capture_text));
    assert!(package.markdown.contains("append-only correction"));
    assert!(
        !package
            .markdown
            .contains("must stay out of valid correction text")
    );
    assert!(!package.markdown.contains("too late for snapshot"));
    assert_eq!(package.manifest["complete"], json!(false));
    assert_eq!(
        package.manifest["derived_selection"]["corrections"][1]["status"],
        "target_digest_conflict"
    );
}

#[test]
fn cross_profile_correction_is_rejected_before_it_can_be_joined() {
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    let event_id = EventId::new();
    let digest = format!("{:064x}", 1);
    let input = input(profile, 3, event_id, "selected capture");
    let records = vec![correction(
        other_profile,
        event_id,
        &digest,
        2,
        "cross-profile sentinel",
    )];

    let result = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &[target_scan(profile, event_id, 3, 1, true, None)],
        },
        UserExportOptions::default(),
    );

    assert!(matches!(result, Err(UserExportError::ProfileMismatch)));
}

#[test]
fn correction_target_page_must_use_the_frozen_highwater() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let input = input(profile, 4, event_id, "selected capture");
    let records = vec![];

    let result = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &[target_scan(profile, event_id, 3, 0, true, None)],
        },
        UserExportOptions::default(),
    );

    assert!(matches!(result, Err(UserExportError::SnapshotMismatch)));
}

#[test]
fn missing_target_scope_cannot_look_like_an_uncorrected_complete_capture() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let input = input(profile, 3, event_id, "old wording");
    let records = vec![];
    let targets = vec![];

    let package = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &targets,
        },
        UserExportOptions::default(),
    )
    .expect("missing target scan is represented as incomplete");

    assert_eq!(package.manifest["complete"], json!(false));
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["complete"],
        json!(false)
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["missing_targets"][0],
        json!(event_id.to_string())
    );
    assert!(package.markdown.contains("INCOMPLETE"));
}

#[test]
fn an_unresolved_target_is_kept_as_metadata_without_exporting_its_corrected_text() {
    let profile = ProfileId::new();
    let selected_id = EventId::new();
    let mut input = input(
        profile,
        3,
        selected_id,
        "capture missing from this snapshot",
    );
    input.items.clear();
    let unresolved = correction(
        profile,
        selected_id,
        &"a".repeat(64),
        2,
        "unresolved correction body",
    );
    let records = vec![unresolved.clone()];

    let package = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &[target_scan(profile, selected_id, 3, 1, true, None)],
        },
        UserExportOptions::default(),
    )
    .expect("unresolved correction is reviewable as conflict metadata");

    assert!(
        fact_ids(&package.manifest).is_empty(),
        "a missing capture cannot become an exported fact"
    );
    assert_eq!(
        package.manifest["selections"][0]["id"],
        selected_id.to_string()
    );
    assert_eq!(package.manifest["selections"][0]["status"], "missing");
    assert_eq!(package.manifest["complete"], false);
    assert_eq!(
        package.manifest["derived_selection"]["corrections"][0]["status"],
        "unresolved_target"
    );
    assert_eq!(
        package.manifest["derived_selection"]["corrections"][0]["event_id"],
        json!(unresolved.event_id.to_string())
    );
    assert!(!package.markdown.contains("unresolved correction body"));
    assert!(
        package
            .markdown
            .contains("Correction conflict metadata only")
    );
}

#[test]
fn explicit_correction_opt_out_is_visible_and_does_not_read_corrections() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let input = input(profile, 3, event_id, "selected capture");
    let options = UserExportOptions {
        include_corrections: false,
    };

    let package = build_user_export_with_options(&input, CorrectionRead::NotPerformed, options)
        .expect("explicit opt-out remains a complete declared selection");

    assert_eq!(package.manifest["complete"], json!(true));
    assert_eq!(
        package.manifest["derived_selection"]["include_corrections"],
        json!(false)
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["status"],
        "disabled"
    );
    assert_eq!(fact_ids(&package.manifest), vec![event_id.to_string()]);
    assert!(package.markdown.contains("include_corrections=false"));
}

#[test]
fn incomplete_correction_scan_reports_its_cursor_and_keeps_found_rows_separate() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let digest = format!("{:064x}", 1);
    let input = input(profile, 8, event_id, "selected capture");
    let found = correction(profile, event_id, &digest, 2, "found correction");
    let records = vec![found.clone()];

    let package = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &[target_scan(profile, event_id, 8, 7, false, Some(2))],
        },
        UserExportOptions::default(),
    )
    .expect("partial correction scan remains explicitly incomplete");

    assert_eq!(package.manifest["complete"], json!(false));
    assert_eq!(package.manifest["scan"]["complete"], json!(true));
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["complete"],
        json!(false)
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["scanned_facts"],
        json!(7)
    );
    assert_eq!(
        package.manifest["derived_selection"]["correction_scan"]["targets"][0]["next_before"],
        json!(2)
    );
    assert!(fact_ids(&package.manifest).contains(&found.event_id.to_string()));
    assert!(package.markdown.contains("correction history scan stopped"));
}

#[test]
fn scan_and_result_budgets_are_accounted_separately() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let digest = format!("{:064x}", 1);
    let mut input = input(profile, 3, event_id, "selected capture");
    input.limits.max_scanned_facts = 4;
    input.limits.max_output_facts = 1;
    let related = correction(profile, event_id, &digest, 2, "related correction");
    let records = vec![related.clone()];

    let package = build_user_export_with_options(
        &input,
        CorrectionRead::Scanned {
            records: &records,
            targets: &[target_scan(profile, event_id, 3, 3, true, None)],
        },
        UserExportOptions::default(),
    )
    .expect("scan budget and output limit are independent");

    assert_eq!(package.manifest["scan"]["scanned_facts"], json!(1));
    assert_eq!(package.manifest["scan"]["total_scanned_facts"], json!(4));
    assert_eq!(package.manifest["scan"]["complete"], json!(true));
    assert_eq!(package.manifest["result_limit_reached"], json!(true));
    assert_eq!(package.manifest["omitted_facts"], json!(1));
    assert_eq!(
        package.manifest["derived_selection"]["corrections"][0]["status"],
        "omitted_output_limit"
    );
    assert_eq!(package.manifest["facts"].as_array().unwrap().len(), 1);
}

#[test]
fn markdown_encoding_budget_fails_explicitly_without_returning_a_cut_document() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let mut input = input(profile, 1, event_id, &"large synthetic body ".repeat(100));
    input.limits.max_markdown_bytes = 512;

    let result = build_user_export_with_options(
        &input,
        CorrectionRead::NotPerformed,
        UserExportOptions {
            include_corrections: false,
        },
    );

    assert!(matches!(
        result,
        Err(UserExportError::MarkdownBudgetExceeded)
    ));
}

#[test]
fn manifest_encoding_budget_fails_explicitly() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let mut input = input(profile, 1, event_id, "small body");
    input.limits.max_manifest_bytes = 64;

    let result = build_user_export_with_options(
        &input,
        CorrectionRead::NotPerformed,
        UserExportOptions {
            include_corrections: false,
        },
    );

    assert!(matches!(
        result,
        Err(UserExportError::ManifestBudgetExceeded)
    ));
}
