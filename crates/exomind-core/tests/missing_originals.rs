use exomind_core::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

fn ready(core: &Core, p: ProfileId, name: &str) -> OriginalRef {
    let human = core.local_human(p).unwrap();
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            original_id: OriginalId::new(),
            profile_id: p,
            expected_sha256: format!("{:x}", Sha256::digest([])),
            byte_length: 0,
            file_name: name.into(),
            media_type: "unknown".into(),
        },
    )
    .unwrap();
    let proof = core
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap().original
}
fn capture(core: &Core, p: ProfileId, originals: Vec<OriginalRef>) {
    core.submit(
        &core.local_human(p).unwrap(),
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1000,
            text: "committed references".into(),
            tags: vec![],
            originals,
        },
    )
    .unwrap();
}
#[test]
fn missing_query_is_bounded_deduplicated_profile_scoped_and_does_not_create_stages() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let source = Core::open(a.path()).unwrap();
    let target = Core::open(b.path()).unwrap();
    let p = ProfileId::new();
    let q = ProfileId::new();
    source.provision_profile(p, "P").unwrap();
    target.provision_profile(p, "P").unwrap();
    target.provision_profile(q, "Q").unwrap();
    let originals: Vec<_> = (0..201)
        .map(|i| ready(&source, p, &format!("{i}.opaque")))
        .collect();
    capture(&source, p, originals.clone());
    capture(&source, p, vec![originals[0].clone()]);
    let page = source
        .export_origin_page(
            &source.local_human(p).unwrap(),
            p,
            &OriginPageQuery::default(),
        )
        .unwrap();
    let peer = target
        .trusted_replica_context(p, source.device_id(), page.origin.restoration_epoch, 1)
        .unwrap();
    target.import_origin_page(&peer, &page).unwrap();
    let private = ready(&target, p, "private-unreferenced");
    let other = ready(&target, q, "private-Q");
    capture(&target, q, vec![other]);
    let human = target.local_human(p).unwrap();
    let db = Connection::open(target.database_path()).unwrap();
    let before:(u64,u64,u64)=db.query_row("SELECT (SELECT count(*) FROM original_stages),(SELECT count(*) FROM events),(SELECT count(*) FROM command_receipts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    let mut ids = BTreeSet::new();
    let mut after = None;
    let mut pages = 0;
    loop {
        let page = target
            .missing_originals_page(&human, p, after, 100)
            .unwrap();
        assert!(page.items.len() <= 100);
        for original in page.items {
            assert_ne!(original.original_id, private.original_id);
            assert!(ids.insert(original.original_id.to_string()));
        }
        pages += 1;
        after = page.next_after;
        if after.is_none() {
            break;
        }
    }
    assert_eq!(pages, 3);
    assert_eq!(
        ids,
        originals
            .iter()
            .map(|v| v.original_id.to_string())
            .collect()
    );
    let after:(u64,u64,u64)=db.query_row("SELECT (SELECT count(*) FROM original_stages),(SELECT count(*) FROM events),(SELECT count(*) FROM command_receipts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(before, after);
    assert!(target.missing_originals_page(&human, p, None, 0).is_err());
    assert!(target.missing_originals_page(&human, p, None, 101).is_err());
    assert!(target.missing_originals_page(&human, q, None, 100).is_err());
    let foreign = source.local_human(p).unwrap();
    assert!(matches!(
        target.missing_originals_page(&foreign, p, None, 100),
        Err(CoreError::ForeignContext)
    ));
}
