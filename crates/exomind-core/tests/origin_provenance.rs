//! Core trusts the in-process Host's crypto admission, not a wire DTO. Real
//! Ed25519 verification is covered by Host tests; these inject storage faults
//! and exercise legacy cursor/proof divergence at the transaction boundary.
use exomind_core::*;
use sha2::{Digest, Sha256};

fn key(byte: u8) -> OriginProvenanceKey {
    let mut spki = vec![
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    spki.extend_from_slice(&[byte; 32]);
    OriginProvenanceKey {
        fingerprint_sha256: format!("{:x}", Sha256::digest(&spki)),
        public_key_spki: spki,
    }
}
fn proof(page: &OriginPage) -> OriginPageProof {
    OriginPageProof {
        entry_signatures: vec![vec![17; 64]; page.entries.len()],
        through_signature: vec![17; 64],
    }
}
struct Rig {
    _a: tempfile::TempDir,
    _b: tempfile::TempDir,
    source: Core,
    receiver: Core,
    p: ProfileId,
    carrier: DeviceId,
}
impl Rig {
    fn new() -> Self {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let source = Core::open(a.path()).unwrap();
        let receiver = Core::open(b.path()).unwrap();
        let p = source.create_profile("synthetic provenance P").unwrap();
        receiver
            .provision_profile(p, "synthetic provenance P")
            .unwrap();
        for i in 0..3 {
            source
                .submit(
                    &source.local_human(p).unwrap(),
                    &CaptureCommand {
                        command_id: CommandId::new(),
                        event_id: EventId::new(),
                        profile_id: p,
                        occurred_at_ms: 1000 + i,
                        text: format!("synthetic source {i}"),
                        tags: vec![],
                        originals: vec![],
                    },
                )
                .unwrap();
        }
        Self {
            _a: a,
            _b: b,
            source,
            receiver,
            p,
            carrier: DeviceId::new(),
        }
    }
    fn page(&self, after: Option<OriginCursor>, limit: usize) -> OriginPage {
        self.source
            .export_origin_page(
                &self.source.local_human(self.p).unwrap(),
                self.p,
                &OriginPageQuery {
                    after,
                    limit,
                    ..Default::default()
                },
            )
            .unwrap()
    }
    fn context(&self, page: &OriginPage, key: OriginProvenanceKey) -> VerifiedOriginContext {
        self.receiver
            .trusted_verified_origin_context(self.p, self.carrier, &page.origin, 9, key)
            .unwrap()
    }
    fn state(&self, page: &OriginPage) -> Option<VerifiedOriginState> {
        self.receiver
            .verified_origin_state(&self.receiver.local_human(self.p).unwrap(), &page.origin)
            .unwrap()
    }
    fn counts(&self) -> (u64, u64, u64, u64) {
        rusqlite::Connection::open(self.receiver.database_path()).unwrap().query_row(
            "SELECT (SELECT count(*) FROM events),(SELECT count(*) FROM receive_cursors),(SELECT count(*) FROM origin_position_proofs),(SELECT count(*) FROM command_receipts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
        ).unwrap()
    }
}

#[test]
fn proof_backfill_changes_inventory_without_advancing_data_or_own_origin() {
    let rig = Rig::new();
    let all = rig.page(None, 3);
    let direct = rig
        .receiver
        .trusted_replica_context(rig.p, all.origin.device_id, all.origin.restoration_epoch, 1)
        .unwrap();
    rig.receiver.import_origin_page(&direct, &all).unwrap();
    let reader = rig.receiver.local_human(rig.p).unwrap();
    let own = rig.receiver.origin_checkpoint(&reader, rig.p).unwrap();
    let before = rig.receiver.origin_inventory(&reader, rig.p, 8).unwrap();
    let first = rig.page(None, 1);
    let context = rig.context(&first, key(7));
    rig.receiver
        .import_verified_origin_page(&context, &first, &proof(&first))
        .unwrap();
    let after = rig.receiver.origin_inventory(&reader, rig.p, 8).unwrap();
    assert_ne!(
        before, after,
        "an idle metadata probe must observe proof-only progress"
    );
    assert_eq!(rig.receiver.origin_checkpoint(&reader, rig.p).unwrap(), own);
    assert_eq!(rig.receiver.replication_cursor(&direct).unwrap(), all.to);
    assert_eq!(rig.counts(), (3, 1, 1, 0));
}

#[test]
fn proof_storage_fault_rolls_back_the_facts_data_cursor_source_key_and_prefix() {
    let rig = Rig::new();
    let page = rig.page(None, 3);
    let context = rig.context(&page, key(1));
    let db = rusqlite::Connection::open(rig.receiver.database_path()).unwrap();
    db.execute_batch("CREATE TRIGGER injected_proof_failure BEFORE INSERT ON origin_position_proofs BEGIN SELECT RAISE(ABORT,'synthetic proof storage fault'); END;").unwrap();
    assert!(matches!(
        rig.receiver
            .import_verified_origin_page(&context, &page, &proof(&page)),
        Err(CoreError::Storage(_))
    ));
    assert_eq!(rig.counts(), (0, 0, 0, 0));
    assert!(rig.state(&page).is_none());
    assert_eq!(
        db.query_row::<u64, _, _>("SELECT count(*) FROM origin_provenance_keys", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER injected_proof_failure")
        .unwrap();
    let ack = rig
        .receiver
        .import_verified_origin_page(&context, &page, &proof(&page))
        .unwrap();
    assert_eq!(ack.inserted, 3);
    assert_eq!(rig.state(&page).unwrap().cursor, page.to);
    assert_eq!(rig.counts(), (3, 1, 3, 0));
}

#[test]
fn legacy_data_cursor_backfills_proofs_without_new_facts_receipts_or_false_completion() {
    let rig = Rig::new();
    let all = rig.page(None, 3);
    let old = rig
        .receiver
        .trusted_replica_context(rig.p, all.origin.device_id, all.origin.restoration_epoch, 1)
        .unwrap();
    rig.receiver.import_origin_page(&old, &all).unwrap();
    assert!(rig.state(&all).is_none());
    let first = rig.page(None, 1);
    let context = rig.context(&first, key(2));
    let ack = rig
        .receiver
        .import_verified_origin_page(&context, &first, &proof(&first))
        .unwrap();
    assert_eq!(ack.cursor, all.to); // Data ACK is ahead of the verified prefix.
    assert_eq!(ack.inserted, 0);
    assert_eq!(rig.state(&all).unwrap().cursor, first.to);
    assert!(
        rig.receiver
            .origin_page_proof(&rig.receiver.local_human(rig.p).unwrap(), &all)
            .is_err()
    );
    let rest = rig.page(Some(first.to.clone()), 3);
    rig.receiver
        .import_verified_origin_page(&context, &rest, &proof(&rest))
        .unwrap();
    assert_eq!(rig.counts(), (3, 1, 3, 0));
    assert_eq!(rig.state(&all).unwrap().cursor, all.to);
    let (stored_key, stored) = rig
        .receiver
        .origin_page_proof(&rig.receiver.local_human(rig.p).unwrap(), &all)
        .unwrap();
    assert_eq!(stored_key, key(2));
    assert_eq!(stored.entry_signatures, proof(&all).entry_signatures);
    rig.receiver
        .import_verified_origin_page(&context, &first, &proof(&first))
        .unwrap();
    assert_eq!(rig.state(&all).unwrap().cursor, all.to);
    assert_eq!(rig.counts(), (3, 1, 3, 0));
}

#[test]
fn proof_gap_key_change_and_malformed_proof_cannot_advance_even_legacy_history() {
    let rig = Rig::new();
    let first = rig.page(None, 1);
    let context = rig.context(&first, key(3));
    let mut invalid = proof(&first);
    invalid.entry_signatures.clear();
    assert!(
        rig.receiver
            .import_verified_origin_page(&context, &first, &invalid)
            .is_err()
    );
    assert_eq!(rig.counts(), (0, 0, 0, 0));
    let all = rig.page(None, 3);
    let direct = rig
        .receiver
        .trusted_replica_context(rig.p, all.origin.device_id, all.origin.restoration_epoch, 1)
        .unwrap();
    rig.receiver.import_origin_page(&direct, &all).unwrap();
    let rest = rig.page(Some(first.to.clone()), 3);
    assert!(
        rig.receiver
            .import_verified_origin_page(&context, &rest, &proof(&rest))
            .is_err()
    );
    assert!(rig.state(&all).is_none());
    rig.receiver
        .import_verified_origin_page(&context, &first, &proof(&first))
        .unwrap();
    let changed = rig.context(&first, key(4));
    assert!(
        rig.receiver
            .import_verified_origin_page(&changed, &rest, &proof(&rest))
            .is_err()
    );
    assert_eq!(rig.state(&all).unwrap().cursor, first.to);
    assert_eq!(rig.counts(), (3, 1, 1, 0));
}

#[test]
fn admission_is_lifecycle_and_profile_bound_and_proofs_survive_reopening() {
    let rig = Rig::new();
    let all = rig.page(None, 3);
    let context = rig.context(&all, key(5));
    assert_eq!(context.carrier_device(), rig.carrier);
    assert_eq!(context.member_generation(), 9);
    let before = rig
        .receiver
        .verified_origin_receive_state(&context)
        .unwrap();
    assert!(!before.proofs_present);
    assert_eq!(before.data.seq, 0);
    assert_eq!(before.verified.seq, 0);
    rig.receiver
        .import_verified_origin_page(&context, &all, &proof(&all))
        .unwrap();
    let after = rig
        .receiver
        .verified_origin_receive_state(&context)
        .unwrap();
    assert!(after.proofs_present);
    assert_eq!(after.data, all.to);
    assert_eq!(after.verified, all.to);
    let root = rig.receiver.database_path().parent().unwrap().to_path_buf();
    let q = rig.receiver.create_profile("synthetic other P").unwrap();
    assert!(matches!(
        rig.receiver
            .trusted_verified_origin_context(q, rig.carrier, &all.origin, 9, key(5)),
        Err(CoreError::ScopeMismatch)
    ));
    assert!(
        rig.receiver
            .origin_page_proof(&rig.receiver.local_human(q).unwrap(), &all)
            .is_err()
    );
    assert!(
        rig.receiver
            .trusted_verified_origin_context(
                rig.p,
                rig.receiver.device_id(),
                &all.origin,
                9,
                key(5)
            )
            .is_err()
    );
    assert!(
        rig.receiver
            .trusted_verified_origin_context(rig.p, rig.carrier, &all.origin, 0, key(5))
            .is_err()
    );
    drop(rig.receiver);
    let reopened = Core::open(&root).unwrap();
    assert!(matches!(
        reopened.import_verified_origin_page(&context, &all, &proof(&all)),
        Err(CoreError::ForeignContext)
    ));
    let reader = reopened.local_human(rig.p).unwrap();
    assert_eq!(
        reopened
            .verified_origin_state(&reader, &all.origin)
            .unwrap()
            .unwrap()
            .cursor,
        all.to
    );
    assert_eq!(
        reopened
            .origin_page_proof(&reader, &all)
            .unwrap()
            .1
            .entry_signatures,
        proof(&all).entry_signatures
    );
}
