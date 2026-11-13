use exomind_core::{CaptureCommand, CommandId, Core, CoreError, EventId, EventQuery, ProfileId};
use std::collections::BTreeMap;

fn capture(profile_id: ProfileId, text: impl Into<String>) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id,
        occurred_at_ms: 1_794_000_000_000,
        text: text.into(),
        tags: vec!["query".to_owned()],
    }
}

#[test]
fn profile_provision_is_idempotent_without_renaming_and_survives_reopen() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let id = ProfileId::new();
    let profile = core.provision_profile(id, "display").unwrap();
    assert_eq!(profile, core.provision_profile(id, "display").unwrap());
    assert!(matches!(
        core.provision_profile(id, "changed"),
        Err(CoreError::ProfileConflict)
    ));
    let other = core.create_profile("display").unwrap();
    assert_ne!(id, other);
    assert_eq!(core.profiles().unwrap().len(), 2);
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    assert_eq!(reopened.provision_profile(id, "display").unwrap(), profile);
    assert_eq!(
        reopened
            .profiles()
            .unwrap()
            .iter()
            .filter(|item| item.profile_id == id)
            .count(),
        1
    );
}

#[test]
fn frozen_three_page_snapshot_preserves_exact_ids_and_payloads_at_one_timestamp() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let other_profile = core.create_profile("Q").unwrap();
    let context = core.local_human(profile).unwrap();
    let other_context = core.local_human(other_profile).unwrap();
    for index in 0..250 {
        let input = capture(profile, format!("record {index}"));
        core.submit(&context, &input).unwrap();
        if index % 25 == 0 {
            core.submit(&other_context, &capture(other_profile, "other profile gap"))
                .unwrap();
        }
    }
    let expected: BTreeMap<_, _> = core
        .events(&context, profile)
        .unwrap()
        .into_iter()
        .map(|event| {
            (
                event.event_id.to_string(),
                serde_json::to_value(event).unwrap(),
            )
        })
        .collect();
    let first = core
        .events_page(&context, profile, &EventQuery::default())
        .unwrap();
    let highwater = first.highwater;
    assert_eq!(first.items.len(), 100);
    let late = capture(profile, "later than the captured snapshot");
    core.submit(&context, &late).unwrap();
    let mut received = first.items;
    let mut before = first.next_before;
    let mut sizes = vec![received.len()];
    while let Some(cursor) = before {
        let page = core
            .events_page(
                &context,
                profile,
                &EventQuery {
                    before: Some(cursor),
                    through: Some(highwater),
                    ..EventQuery::default()
                },
            )
            .unwrap();
        assert_eq!(page.highwater, highwater);
        assert!(
            page.items
                .iter()
                .all(|event| event.local_seq < cursor && event.local_seq <= highwater)
        );
        sizes.push(page.items.len());
        received.extend(page.items);
        before = page.next_before;
    }
    assert_eq!(sizes, vec![100, 100, 50]);
    assert_eq!(received.len(), 250);
    assert!(
        received
            .windows(2)
            .all(|pair| pair[0].local_seq > pair[1].local_seq)
    );
    let actual: BTreeMap<_, _> = received
        .into_iter()
        .map(|event| {
            (
                event.event_id.to_string(),
                serde_json::to_value(event).unwrap(),
            )
        })
        .collect();
    assert_eq!(actual, expected);
    let current = core
        .events_page(&context, profile, &EventQuery::default())
        .unwrap();
    assert_eq!(current.items[0].event_id, late.event_id);
    assert!(current.highwater > highwater);
}

#[test]
fn search_is_case_sensitive_literal_text_including_unicode_sql_wildcards_and_quotes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let context = core.local_human(profile).unwrap();
    let wanted = capture(profile, "中文 100%_ 'quoted' Case");
    core.submit(&context, &wanted).unwrap();
    core.submit(&context, &capture(profile, "中文 100xx unrelated case"))
        .unwrap();
    for needle in ["100%_", "'quoted'", "Case", "中文 100%_"] {
        let page = core
            .events_page(
                &context,
                profile,
                &EventQuery {
                    search: Some(needle.to_owned()),
                    ..EventQuery::default()
                },
            )
            .unwrap();
        assert_eq!(page.items.len(), 1, "needle: {needle}");
        assert_eq!(page.items[0].event_id, wanted.event_id);
    }
    let injection = core
        .events_page(
            &context,
            profile,
            &EventQuery {
                search: Some("' OR 1=1 --".to_owned()),
                ..EventQuery::default()
            },
        )
        .unwrap();
    assert!(injection.items.is_empty());
    assert_eq!(
        core.events_page(&context, profile, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn profile_scope_and_bad_query_errors_are_not_empty_results() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("P").unwrap();
    let other = core.create_profile("Q").unwrap();
    let context = core.local_human(profile).unwrap();
    let empty = core
        .events_page(&context, profile, &EventQuery::default())
        .unwrap();
    assert!(empty.items.is_empty());
    assert_eq!(empty.highwater, 0);
    assert_eq!(empty.next_before, None);
    assert!(matches!(
        core.events_page(&context, other, &EventQuery::default()),
        Err(CoreError::ScopeMismatch)
    ));
    for query in [
        EventQuery {
            limit: 0,
            ..EventQuery::default()
        },
        EventQuery {
            limit: 101,
            ..EventQuery::default()
        },
        EventQuery {
            before: Some(0),
            ..EventQuery::default()
        },
        EventQuery {
            before: Some(u64::MAX),
            ..EventQuery::default()
        },
        EventQuery {
            through: Some(1),
            ..EventQuery::default()
        },
    ] {
        assert!(matches!(
            core.events_page(&context, profile, &query),
            Err(CoreError::InvalidQuery(_))
        ));
    }
    core.submit(&context, &capture(profile, "after empty snapshot"))
        .unwrap();
    let frozen_empty = core
        .events_page(
            &context,
            profile,
            &EventQuery {
                through: Some(0),
                ..EventQuery::default()
            },
        )
        .unwrap();
    assert!(frozen_empty.items.is_empty());
    let fault = rusqlite::Connection::open(core.database_path()).unwrap();
    fault
        .execute_batch("ALTER TABLE events RENAME TO inaccessible_events;")
        .unwrap();
    assert!(
        core.events_page(&context, profile, &EventQuery::default())
            .is_err()
    );
}

#[test]
fn query_dto_defaults_and_unknown_fields_are_explicit() {
    let query: EventQuery = serde_json::from_str("{}").unwrap();
    assert_eq!(query.limit, 100);
    assert_eq!(query.before, None);
    assert!(serde_json::from_str::<EventQuery>(r#"{"skipUnknown":true}"#).is_err());
}
