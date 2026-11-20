use exomind_beta_host::user_export::{
    LocalOriginalState, OriginalAvailability, ScanCoverage, Selection, UserExportInput,
    UserExportLimits, build_user_export,
};
use exomind_core::{
    AuthorKind, DeviceId, EventId, EventRecord, NodeClock, OriginalId, OriginalRef, ProfileId,
    StartBlockSpec, TimeblockAction, TimeblockId, TimeblockNodeRecord, TimeblockPayload,
    TimeblockSource, TimeblockSourceKind, TimelineItem, TimerSpec,
};
use serde_json::{Value, json};
use uuid::Uuid;

fn capture(profile_id: ProfileId, event_id: EventId, local_seq: u64, text: &str) -> TimelineItem {
    TimelineItem::Capture(EventRecord {
        event_id,
        profile_id,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        author_kind: AuthorKind::Human,
        occurred_at_ms: 1_800_000_000_000 + local_seq as i64,
        text: text.to_owned(),
        tags: vec!["synthetic".to_owned()],
        originals: vec![],
        digest: format!("{local_seq:064x}"),
        local_seq,
    })
}

fn block_action(block_id: TimeblockId, kind: &str) -> TimeblockAction {
    match kind {
        "start" => TimeblockAction::Start {
            block_id,
            name: format!("block-{block_id}"),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
        "pause" => TimeblockAction::Pause { block_id },
        "resume" => TimeblockAction::Resume { block_id },
        "end" => TimeblockAction::EndAction { block_id },
        _ => unreachable!("test fixture action must be known"),
    }
}

fn rotate(from_block_id: TimeblockId, next_block_id: TimeblockId) -> TimeblockAction {
    TimeblockAction::Rotate {
        from_block_id,
        next: StartBlockSpec {
            block_id: next_block_id,
            name: format!("block-{next_block_id}"),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    }
}

fn timeblock(
    profile_id: ProfileId,
    local_seq: u64,
    action: TimeblockAction,
) -> (EventId, TimelineItem) {
    let event_id = EventId::new();
    (
        event_id,
        TimelineItem::Timeblock(TimeblockNodeRecord {
            event_id,
            profile_id,
            device_id: DeviceId::new(),
            source: TimeblockSource {
                kind: TimeblockSourceKind::Human,
                author_id: Uuid::new_v4(),
                owner_generation: None,
            },
            parents: vec![],
            occurred_at_ms: 1_800_000_000_000 + local_seq as i64,
            effective_at_ms: 1_800_000_000_000 + local_seq as i64,
            clock: NodeClock {
                epoch_id: Uuid::new_v4(),
                elapsed_ms: local_seq,
            },
            payload: TimeblockPayload::Action { action },
            digest: format!("{local_seq:064x}"),
            local_seq,
        }),
    )
}

fn input(
    profile_id: ProfileId,
    highwater: u64,
    selections: Vec<Selection>,
    items: Vec<TimelineItem>,
) -> UserExportInput {
    UserExportInput {
        profile_id,
        highwater,
        selections,
        scan: ScanCoverage {
            scanned_facts: items.len(),
            complete: true,
            next_before: None,
        },
        items,
        originals: vec![],
        limits: UserExportLimits::default(),
    }
}

fn fact_ids(manifest: &Value) -> Vec<String> {
    manifest["facts"]
        .as_array()
        .expect("manifest facts are an array")
        .iter()
        .map(|fact| fact["event_id"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn event_selection_keeps_only_the_exact_fact_inside_one_profile_and_highwater() {
    let profile = ProfileId::new();
    let selected_id = EventId::new();
    let unselected_id = EventId::new();
    let after_highwater_id = EventId::new();
    let selected = capture(profile, selected_id, 3, "selected synthetic body");
    let selected_device = match &selected {
        TimelineItem::Capture(record) => record.device_id,
        _ => unreachable!(),
    };
    let selected_author = match &selected {
        TimelineItem::Capture(record) => record.author_id,
        _ => unreachable!(),
    };
    let selected_digest = match &selected {
        TimelineItem::Capture(record) => record.digest.clone(),
        _ => unreachable!(),
    };
    let input = input(
        profile,
        5,
        vec![Selection::Event(selected_id)],
        vec![
            selected,
            capture(profile, unselected_id, 4, "unselected synthetic sentinel"),
            capture(profile, after_highwater_id, 6, "after snapshot sentinel"),
        ],
    );

    let package = build_user_export(&input).expect("explicit event selection should format");

    assert_eq!(package.manifest["profile_id"], json!(profile.to_string()));
    assert_eq!(package.manifest["highwater"], json!(5));
    assert_eq!(fact_ids(&package.manifest), vec![selected_id.to_string()]);
    assert_eq!(
        package.manifest["facts"][0]["digest"],
        json!(selected_digest)
    );
    assert_eq!(
        package.manifest["facts"][0]["source"]["device_id"],
        json!(selected_device.to_string())
    );
    assert_eq!(
        package.manifest["facts"][0]["source"]["author_id"],
        json!(selected_author.to_string())
    );
    assert!(package.markdown.contains("selected synthetic body"));
    assert!(!package.markdown.contains("unselected synthetic sentinel"));
    assert!(!package.markdown.contains("after snapshot sentinel"));
}

#[test]
fn block_selection_expands_all_referencing_nodes_through_highwater_only() {
    let profile = ProfileId::new();
    let selected_block = TimeblockId::new();
    let adjacent_block = TimeblockId::new();
    let (start_id, start) = timeblock(profile, 1, block_action(selected_block, "start"));
    let (pause_id, pause) = timeblock(profile, 2, block_action(selected_block, "pause"));
    let (rotate_out_id, rotate_out) = timeblock(profile, 3, rotate(selected_block, adjacent_block));
    let (rotate_in_id, rotate_in) = timeblock(profile, 4, rotate(adjacent_block, selected_block));
    let (adjacent_only_id, adjacent_only) =
        timeblock(profile, 5, block_action(adjacent_block, "pause"));
    let (after_highwater_id, after_highwater) =
        timeblock(profile, 7, block_action(selected_block, "resume"));
    let input = input(
        profile,
        6,
        vec![Selection::Timeblock(selected_block)],
        vec![
            start,
            pause,
            rotate_out,
            rotate_in,
            adjacent_only,
            after_highwater,
        ],
    );

    let package = build_user_export(&input).expect("explicit block selection should format");

    assert_eq!(
        fact_ids(&package.manifest),
        vec![
            start_id.to_string(),
            pause_id.to_string(),
            rotate_out_id.to_string(),
            rotate_in_id.to_string(),
        ]
    );
    assert!(!fact_ids(&package.manifest).contains(&after_highwater_id.to_string()));
    assert!(!fact_ids(&package.manifest).contains(&adjacent_only_id.to_string()));
}

#[test]
fn selected_originals_report_local_state_without_exposing_local_paths() {
    let profile = ProfileId::new();
    let event_id = EventId::new();
    let available = OriginalRef {
        original_id: OriginalId::new(),
        sha256: "a".repeat(64),
        byte_length: 18,
        file_name: "available.ogg".to_owned(),
        media_type: "audio/ogg".to_owned(),
    };
    let missing = OriginalRef {
        original_id: OriginalId::new(),
        sha256: "b".repeat(64),
        byte_length: 27,
        file_name: "missing.wav".to_owned(),
        media_type: "audio/wav".to_owned(),
    };
    let conflicting = OriginalRef {
        original_id: OriginalId::new(),
        sha256: "c".repeat(64),
        byte_length: 33,
        file_name: "conflict.bin".to_owned(),
        media_type: "application/octet-stream".to_owned(),
    };
    let item = TimelineItem::Capture(EventRecord {
        event_id,
        profile_id: profile,
        device_id: DeviceId::new(),
        author_id: Uuid::new_v4(),
        author_kind: AuthorKind::Human,
        occurred_at_ms: 1_800_000_000_010,
        text: "synthetic original references".to_owned(),
        tags: vec![],
        originals: vec![available.clone(), missing.clone(), conflicting.clone()],
        digest: "d".repeat(64),
        local_seq: 1,
    });
    let mut input = input(profile, 1, vec![Selection::Event(event_id)], vec![item]);
    input.originals = vec![
        OriginalAvailability {
            profile_id: profile,
            original_id: available.original_id,
            sha256: available.sha256.clone(),
            byte_length: available.byte_length,
            state: LocalOriginalState::Available,
        },
        OriginalAvailability {
            profile_id: profile,
            original_id: missing.original_id,
            sha256: missing.sha256.clone(),
            byte_length: missing.byte_length,
            state: LocalOriginalState::Missing,
        },
        OriginalAvailability {
            profile_id: profile,
            original_id: conflicting.original_id,
            sha256: "e".repeat(64),
            byte_length: conflicting.byte_length,
            state: LocalOriginalState::Available,
        },
    ];

    let package = build_user_export(&input).expect("original availability should be reportable");
    let originals = package.manifest["originals"].as_array().unwrap();
    let availability = |id: OriginalId| {
        originals
            .iter()
            .find(|value| value["original_id"] == json!(id.to_string()))
            .unwrap()["availability"]
            .as_str()
            .unwrap()
            .to_owned()
    };

    assert_eq!(availability(available.original_id), "available");
    assert_eq!(availability(missing.original_id), "missing");
    assert_eq!(availability(conflicting.original_id), "conflict");
    assert!(
        !package
            .manifest
            .to_string()
            .to_ascii_lowercase()
            .contains("path")
    );
}

#[test]
fn incomplete_block_scan_is_explained_instead_of_reported_as_missing_or_complete() {
    let profile = ProfileId::new();
    let selected_block = TimeblockId::new();
    let (_, first_node) = timeblock(profile, 2, block_action(selected_block, "start"));
    let mut input = input(
        profile,
        9,
        vec![Selection::Timeblock(selected_block)],
        vec![first_node],
    );
    input.scan = ScanCoverage {
        scanned_facts: 100,
        complete: false,
        next_before: Some(2),
    };

    let package = build_user_export(&input).expect("partial scan should produce an explained plan");

    assert_eq!(package.manifest["complete"], json!(false));
    assert_eq!(package.manifest["scan"]["complete"], json!(false));
    assert_eq!(package.manifest["scan"]["scanned_facts"], json!(100));
    assert_eq!(package.manifest["scan"]["next_before"], json!(2));
    assert_eq!(
        package.manifest["selections"][0]["status"],
        json!("incomplete")
    );
}

#[test]
fn output_limit_does_not_masquerade_as_scan_limit() {
    let profile = ProfileId::new();
    let selected_block = TimeblockId::new();
    let (_, first) = timeblock(profile, 1, block_action(selected_block, "start"));
    let (_, second) = timeblock(profile, 2, block_action(selected_block, "pause"));
    let (_, third) = timeblock(profile, 3, block_action(selected_block, "resume"));
    let mut input = input(
        profile,
        3,
        vec![Selection::Timeblock(selected_block)],
        vec![first, second, third],
    );
    input.scan.scanned_facts = 3;
    input.limits.max_output_facts = 1;

    let package = build_user_export(&input).expect("bounded output should remain explainable");

    assert_eq!(package.manifest["complete"], json!(false));
    assert_eq!(package.manifest["scan"]["complete"], json!(true));
    assert_eq!(package.manifest["scan"]["scanned_facts"], json!(3));
    assert_eq!(package.manifest["result_limit_reached"], json!(true));
    assert_eq!(package.manifest["omitted_facts"], json!(2));
    assert_eq!(package.manifest["facts"].as_array().unwrap().len(), 1);
}

#[test]
fn a_cross_profile_fact_is_rejected_instead_of_silently_joined() {
    let profile = ProfileId::new();
    let other_profile = ProfileId::new();
    let event_id = EventId::new();
    let input = input(
        profile,
        1,
        vec![Selection::Event(event_id)],
        vec![capture(
            other_profile,
            event_id,
            1,
            "foreign profile sentinel",
        )],
    );

    assert!(build_user_export(&input).is_err());
}
