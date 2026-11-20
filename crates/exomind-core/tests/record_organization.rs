use exomind_core::{
    AgentId, CaptureCommand, CommandId, Core, CoreError, CorrectionTargetState, EventId,
    EventQuery, ProfileId, RecordCorrectionCommand,
};

fn capture(profile_id: ProfileId, text: &str, tags: &[&str]) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1_794_000_000_000,
        text: text.to_owned(),
        tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
        originals: vec![],
    }
}

fn correction(
    profile_id: ProfileId,
    target_event_id: EventId,
    target_digest: &str,
    corrected_text: &str,
) -> RecordCorrectionCommand {
    RecordCorrectionCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1_794_000_000_001,
        target_event_id,
        target_digest: target_digest.to_owned(),
        corrected_text: corrected_text.to_owned(),
    }
}

#[test]
fn corrected_text_search_returns_the_unchanged_capture_with_its_exact_tag() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let context = core.local_human(profile).unwrap();
    let original = capture(profile, "original wording", &["daily"]);
    core.submit(&context, &original).unwrap();
    let target = core
        .events(&context, profile)
        .unwrap()
        .into_iter()
        .find(|item| item.event_id == original.event_id)
        .unwrap();
    core.record_correction(
        &context,
        &correction(
            profile,
            original.event_id,
            &target.digest,
            "searchable corrected phrase",
        ),
    )
    .unwrap();
    let page = core
        .events_page_with_tag(
            &context,
            profile,
            &EventQuery {
                search: Some("corrected phrase".into()),
                ..EventQuery::default()
            },
            Some("daily"),
        )
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].event_id, original.event_id);
    assert_eq!(page.items[0].text, "original wording");
}

#[test]
fn correction_target_page_is_bounded_and_keeps_its_highwater() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let context = core.local_human(profile).unwrap();
    let first = capture(profile, "first", &["daily"]);
    let second = capture(profile, "second", &["daily"]);
    core.submit(&context, &first).unwrap();
    core.submit(&context, &second).unwrap();
    let captures = core.events(&context, profile).unwrap();
    let first_digest = &captures
        .iter()
        .find(|item| item.event_id == first.event_id)
        .unwrap()
        .digest;
    let second_digest = &captures
        .iter()
        .find(|item| item.event_id == second.event_id)
        .unwrap()
        .digest;
    core.record_correction(
        &context,
        &correction(profile, first.event_id, first_digest, "first correction"),
    )
    .unwrap();
    core.record_correction(
        &context,
        &correction(profile, second.event_id, second_digest, "second correction"),
    )
    .unwrap();
    let fixed = core
        .corrections_page(&context, profile, &EventQuery::default())
        .unwrap()
        .highwater;
    core.record_correction(
        &context,
        &correction(
            profile,
            first.event_id,
            first_digest,
            "later first correction",
        ),
    )
    .unwrap();
    let bounded = core
        .corrections_page_for_target(
            &context,
            profile,
            &EventQuery {
                through: Some(fixed),
                limit: 100,
                ..EventQuery::default()
            },
            first.event_id,
        )
        .unwrap();
    let current = core
        .corrections_page_for_target(&context, profile, &EventQuery::default(), first.event_id)
        .unwrap();
    assert_eq!(bounded.highwater, fixed);
    assert_eq!(bounded.items.len(), 1);
    assert_eq!(bounded.items[0].record.target_event_id, first.event_id);
    assert_eq!(current.items.len(), 2);
    assert!(
        current
            .items
            .iter()
            .all(|item| item.record.target_event_id == first.event_id)
    );
}

#[test]
fn tag_query_matches_one_normalized_tag_and_composes_with_literal_search() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let context = core.local_human(profile).unwrap();
    let wanted = capture(
        profile,
        "Needle in the record",
        &["Topic", "topic", "Topic"],
    );
    core.submit(&context, &wanted).unwrap();
    core.submit(
        &context,
        &capture(profile, "Needle in another record", &["topic"]),
    )
    .unwrap();

    let page = core
        .events_page_with_tag(
            &context,
            profile,
            &EventQuery {
                search: Some("Needle in the record".to_owned()),
                ..EventQuery::default()
            },
            Some("Topic"),
        )
        .unwrap();

    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].event_id, wanted.event_id);
    assert_eq!(
        page.items[0].tags,
        vec!["Topic".to_owned(), "topic".to_owned()]
    );
}

#[test]
fn tag_filter_uses_exact_bound_values_and_rejects_invalid_boundaries() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let context = core.local_human(profile).unwrap();
    core.submit(&context, &capture(profile, "tagged", &["%_'"]))
        .unwrap();

    let literal = core
        .events_page_with_tag(&context, profile, &EventQuery::default(), Some("%_'"))
        .unwrap();
    let injected = core
        .events_page_with_tag(
            &context,
            profile,
            &EventQuery::default(),
            Some("' OR 1=1 --"),
        )
        .unwrap();

    assert_eq!(literal.items.len(), 1);
    assert!(injected.items.is_empty());
    let too_long = "x".repeat(129);
    for tag in ["", " \t\n", too_long.as_str()] {
        assert!(matches!(
            core.events_page_with_tag(&context, profile, &EventQuery::default(), Some(tag)),
            Err(CoreError::InvalidQuery(_))
        ));
    }
    assert!(
        core.events_page_with_tag(
            &context,
            profile,
            &EventQuery::default(),
            Some(&"x".repeat(128)),
        )
        .is_ok()
    );
}

#[test]
fn sparse_tag_pages_keep_one_highwater_without_gaps_or_duplicates() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let other_profile = core.create_profile("synthetic Q").unwrap();
    let context = core.local_human(profile).unwrap();
    let other_context = core.local_human(other_profile).unwrap();
    let mut expected = Vec::new();
    for index in 0..233 {
        let tags = if index % 17 == 0 {
            expected.push(
                core.submit(
                    &context,
                    &capture(profile, &format!("target {index}"), &["sparse"]),
                )
                .unwrap()
                .event_id,
            );
            continue;
        } else {
            &["other"]
        };
        core.submit(&context, &capture(profile, &format!("other {index}"), tags))
            .unwrap();
        if index % 4 == 0 {
            core.submit(
                &other_context,
                &capture(other_profile, "Q gap", &["sparse"]),
            )
            .unwrap();
        }
    }

    let first = core
        .events_page_with_tag(
            &context,
            profile,
            &EventQuery {
                limit: 3,
                ..EventQuery::default()
            },
            Some("sparse"),
        )
        .unwrap();
    let highwater = first.highwater;
    let late = capture(profile, "after snapshot", &["sparse"]);
    core.submit(&context, &late).unwrap();
    let mut received = first.items;
    let mut cursor = first.next_before;
    while let Some(before) = cursor {
        let page = core
            .events_page_with_tag(
                &context,
                profile,
                &EventQuery {
                    before: Some(before),
                    through: Some(highwater),
                    limit: 3,
                    ..EventQuery::default()
                },
                Some("sparse"),
            )
            .unwrap();
        assert_eq!(page.highwater, highwater);
        assert!(page.items.iter().all(|event| event.local_seq < before));
        received.extend(page.items);
        cursor = page.next_before;
    }

    let received_ids = received
        .iter()
        .map(|event| event.event_id)
        .collect::<std::collections::HashSet<_>>();
    let expected_ids = expected
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(received_ids, expected_ids);
    assert_eq!(received.len(), received_ids.len());
    assert!(!received_ids.contains(&late.event_id));
}

#[test]
fn tag_query_stays_inside_the_writer_profile_scope() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let other_profile = core.create_profile("synthetic Q").unwrap();
    let context = core.local_human(profile).unwrap();

    let result = core.events_page_with_tag(
        &context,
        other_profile,
        &EventQuery::default(),
        Some("private-tag"),
    );

    assert!(matches!(result, Err(CoreError::ScopeMismatch)));
}

#[test]
fn correction_adds_a_human_fact_without_changing_its_target_and_replays_receipt() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let context = core.local_human(profile).unwrap();
    let original = capture(profile, "immutable original", &["notes"]);
    core.submit(&context, &original).unwrap();
    let original_before = core
        .events(&context, profile)
        .unwrap()
        .into_iter()
        .find(|record| record.event_id == original.event_id)
        .unwrap();
    let command = correction(
        profile,
        original.event_id,
        &original_before.digest,
        "corrected wording",
    );

    let first = core.record_correction(&context, &command).unwrap();
    let replay = core.record_correction(&context, &command).unwrap();
    let changed_same_command = RecordCorrectionCommand {
        corrected_text: "changed under the old command ID".into(),
        ..command.clone()
    };
    let changed_same_event = RecordCorrectionCommand {
        command_id: CommandId::new(),
        corrected_text: "changed under the old event ID".into(),
        ..command.clone()
    };
    let page = core
        .corrections_page(&context, profile, &EventQuery::default())
        .unwrap();
    let original_after = core
        .events(&context, profile)
        .unwrap()
        .into_iter()
        .find(|record| record.event_id == original.event_id)
        .unwrap();

    assert_eq!(first.event_id, command.event_id);
    assert!(!first.replayed);
    assert!(replay.replayed);
    assert_eq!(first.local_seq, replay.local_seq);
    assert!(matches!(
        core.record_correction(&context, &changed_same_command),
        Err(CoreError::CommandConflict)
    ));
    assert!(matches!(
        core.record_correction(&context, &changed_same_event),
        Err(CoreError::EventConflict)
    ));
    assert_eq!(
        serde_json::to_value(&original_after).unwrap(),
        serde_json::to_value(&original_before).unwrap()
    );
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].record.target_digest, original_before.digest);
    assert_eq!(page.items[0].record.corrected_text, "corrected wording");
    assert_eq!(
        page.items[0].target_state,
        CorrectionTargetState::DigestMatches
    );
}

#[test]
fn correction_rejects_agent_context_cross_profile_targets_and_wrong_digests() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let other_profile = core.create_profile("synthetic Q").unwrap();
    let human = core.local_human(profile).unwrap();
    let agent = core.local_agent(profile, AgentId::new()).unwrap();
    let other_context = core.local_human(other_profile).unwrap();
    let private_target = capture(other_profile, "Q only", &["private"]);
    core.submit(&other_context, &private_target).unwrap();
    let own_target = capture(profile, "P target", &["visible"]);
    core.submit(&human, &own_target).unwrap();

    let attempted_cross_profile = correction(
        profile,
        private_target.event_id,
        &"a".repeat(64),
        "must not enter P",
    );
    assert!(matches!(
        core.record_correction(&human, &attempted_cross_profile),
        Err(CoreError::CorrectionTargetConflict)
    ));

    let wrong_digest = correction(
        profile,
        own_target.event_id,
        &"c".repeat(64),
        "must bind the original digest",
    );
    assert!(matches!(
        core.record_correction(&human, &wrong_digest),
        Err(CoreError::CorrectionTargetConflict)
    ));

    let missing = correction(
        profile,
        EventId::new(),
        &"b".repeat(64),
        "not authored by an agent",
    );
    assert!(matches!(
        core.record_correction(&agent, &missing),
        Err(CoreError::CorrectionRequiresHuman)
    ));
}

#[test]
fn correction_keeps_missing_reference_and_surfaces_later_digest_conflict() {
    let source_root = tempfile::tempdir().unwrap();
    let local_root = tempfile::tempdir().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let local = Core::open(local_root.path()).unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(profile, "synthetic shared profile")
        .unwrap();
    local
        .provision_profile(profile, "synthetic shared profile")
        .unwrap();
    let source_context = source.local_human(profile).unwrap();
    let local_context = local.local_human(profile).unwrap();
    let target_id = EventId::new();
    let expected_target = CaptureCommand {
        event_id: target_id,
        ..capture(profile, "expected remote text", &["source"])
    };
    source.submit(&source_context, &expected_target).unwrap();
    let target_digest = source
        .events(&source_context, profile)
        .unwrap()
        .into_iter()
        .find(|record| record.event_id == target_id)
        .unwrap()
        .digest;
    let command = correction(profile, target_id, &target_digest, "corrected remote fact");

    local.record_correction(&local_context, &command).unwrap();
    let pending = local
        .corrections_page(&local_context, profile, &EventQuery::default())
        .unwrap();
    let conflicting_target = CaptureCommand {
        event_id: target_id,
        ..capture(
            profile,
            "different fact under the same expected reference",
            &["source"],
        )
    };
    local.submit(&local_context, &conflicting_target).unwrap();
    let resolved = local
        .corrections_page(&local_context, profile, &EventQuery::default())
        .unwrap();

    assert_eq!(
        pending.items[0].target_state,
        CorrectionTargetState::Unresolved
    );
    assert_eq!(
        resolved.items[0].target_state,
        CorrectionTargetState::DigestConflict
    );
    assert_eq!(resolved.items[0].record.target_event_id, target_id);
    assert_eq!(resolved.items[0].record.target_digest, target_digest);
}
