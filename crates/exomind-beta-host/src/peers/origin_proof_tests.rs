use super::*;
use crate::{BetaHost, Session};
use exomind_core::{CaptureCommand, CommandId, EventId, OriginCursor, OriginPageQuery, ProfileId};
use std::sync::Arc;
use tempfile::{TempDir, tempdir};

struct Source {
    root: TempDir,
    host: BetaHost,
    owner: Session,
    profile: ProfileId,
    identity: Arc<Identity>,
}
impl Source {
    fn new() -> Self {
        let root = tempdir().unwrap();
        let host = BetaHost::open(root.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "origin proof fixture")
            .unwrap();
        let identity = host.transport_identity(&owner).unwrap();
        {
            let state = host.active_state().unwrap();
            let core = &crate::resources(&state).unwrap().core;
            let human = core.local_human(profile).unwrap();
            for i in 0..3 {
                core.submit(
                    &human,
                    &CaptureCommand {
                        command_id: CommandId::new(),
                        event_id: EventId::new(),
                        profile_id: profile,
                        occurred_at_ms: 1000 + i,
                        text: format!("origin fact {i}"),
                        tags: vec![],
                        originals: vec![],
                    },
                )
                .unwrap();
            }
        }
        Self {
            root,
            host,
            owner,
            profile,
            identity,
        }
    }
    fn page(&self, limit: usize) -> SignedOriginPage {
        self.host
            .signed_origin_page(
                &self.owner,
                self.profile,
                &OriginPageQuery {
                    limit,
                    ..Default::default()
                },
            )
            .unwrap()
    }
}

#[test]
fn each_partial_page_position_is_authenticated_before_a_prefix_can_be_committed() {
    let source = Source::new();
    let signed = source.page(1);
    assert!(signed.page.has_more);
    signed
        .verify_positions(&signed.page.origin, &source.identity.info)
        .unwrap();
    let mut forged = signed.clone();
    // A signed final head alone does not prove this earlier committed prefix.
    // The final head and its signature remain unchanged in this counterexample.
    forged.page.entries[0].chain_hash = "f".repeat(64);
    forged.page.to.hash = forged.page.entries[0].chain_hash.clone();
    assert!(
        forged
            .verify_positions(&signed.page.origin, &source.identity.info)
            .is_err()
    );
}

#[test]
fn a_position_signature_cannot_be_replayed_at_another_sequence() {
    let source = Source::new();
    let first = source.page(1);
    let mut signed = source
        .host
        .signed_origin_page(
            &source.owner,
            source.profile,
            &OriginPageQuery {
                after: Some(first.page.to.clone()),
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();

    // Keep the page structurally valid while reusing the genuine sequence-2
    // hash/signature at sequence 1. The frozen head remains unchanged.
    let sequence_one = first.page.from.seq + 1;
    let wrong_hash = signed.page.entries[0].chain_hash.clone();
    signed.page.from = first.page.from.clone();
    signed.page.entries[0].origin_seq = sequence_one;
    signed.page.to = OriginCursor {
        seq: sequence_one,
        hash: wrong_hash,
    };
    signed.page.has_more = signed.page.to.seq < signed.page.through.seq;

    assert!(valid_positions(&signed.page));
    assert!(
        signed
            .verify_positions(&signed.page.origin, &source.identity.info)
            .is_err()
    );
}

#[test]
fn a_position_proof_cannot_be_reused_under_another_profile_epoch_or_signer() {
    let source = Source::new();
    let other = Source::new();
    let signed = source.page(3);
    let mut wrong_profile = signed.page.origin.clone();
    wrong_profile.profile_id = ProfileId::new();
    assert!(
        signed
            .verify_positions(&wrong_profile, &source.identity.info)
            .is_err()
    );
    let mut wrong_epoch = signed.page.origin.clone();
    wrong_epoch.restoration_epoch = uuid::Uuid::new_v4();
    assert!(
        signed
            .verify_positions(&wrong_epoch, &source.identity.info)
            .is_err()
    );
    assert!(
        signed
            .verify_positions(&signed.page.origin, &other.identity.info)
            .is_err()
    );
}

#[test]
fn signatures_are_complete_and_the_frozen_head_is_independently_authenticated() {
    let source = Source::new();
    let signed = source.page(1);
    for kind in ["missing", "extra", "head", "entry"] {
        let mut bad = signed.clone();
        match kind {
            "missing" => {
                bad.entry_signatures.clear();
            }
            "extra" => bad.entry_signatures.push(vec![0; 64]),
            "head" => bad.through_signature[0] ^= 1,
            "entry" => bad.entry_signatures[0][0] ^= 1,
            _ => unreachable!(),
        }
        assert!(
            bad.verify_positions(&signed.page.origin, &source.identity.info)
                .is_err(),
            "{kind}"
        );
    }
}

#[test]
fn a_local_key_cannot_sign_an_imported_devices_origin() {
    let source = Source::new();
    let other = Source::new();
    assert!(sign_local_page(&other.identity, source.page(3).page).is_err());
}

#[test]
fn signing_requires_this_hosts_owner_and_a_valid_page_budget() {
    let source = Source::new();
    let other = Source::new();
    assert!(
        source
            .host
            .signed_origin_page(&other.owner, source.profile, &OriginPageQuery::default())
            .is_err()
    );
    for query in [
        OriginPageQuery {
            limit: 0,
            ..Default::default()
        },
        OriginPageQuery {
            limit: 101,
            ..Default::default()
        },
        OriginPageQuery {
            max_bytes: 0,
            ..Default::default()
        },
        OriginPageQuery {
            max_bytes: exomind_core::MAX_ORIGIN_PAGE_BYTES + 1,
            ..Default::default()
        },
    ] {
        assert!(
            source
                .host
                .signed_origin_page(&source.owner, source.profile, &query)
                .is_err()
        );
    }
}

#[test]
fn the_signature_envelope_has_a_bounded_allowance_inside_existing_framing() {
    let source = Source::new();
    let mut signed = source.page(1);
    // Deliberately maximize serialized byte values and entry count. This is
    // solely the envelope-size bound, not a semantically admissible page.
    signed.page.entries = vec![signed.page.entries[0].clone(); MAX_PAGE_FACTS];
    signed.entry_signatures = vec![vec![255; 64]; MAX_PAGE_FACTS];
    signed.through_signature = vec![255; 64];
    signed.signer.spki_der = vec![255; 44];
    let overhead = serde_json::to_vec(&signed).unwrap().len()
        - serde_json::to_vec(&signed.page).unwrap().len();
    assert!(overhead + RPC_WRAPPER_RESERVE < ENVELOPE_RESERVE);
}

#[test]
fn durable_device_key_reopens_with_identical_proofs_without_receipt_or_fact_writes() {
    let source = Source::new();
    let signed = source.page(3);
    let root = source.root.path().to_path_buf();
    let device = source.host.device_id;
    source.host.stop().unwrap();
    let reopened = BetaHost::open(&root).unwrap();
    let owner = reopened.owner_session().unwrap();
    assert_eq!(reopened.device_id, device);
    let identity = reopened.transport_identity(&owner).unwrap();
    let state = reopened.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let raw = core
        .export_origin_page(
            &core.local_human(source.profile).unwrap(),
            source.profile,
            &OriginPageQuery::default(),
        )
        .unwrap();
    let again = sign_local_page(&identity, raw).unwrap();
    assert_eq!(signed.through_signature, again.through_signature);
    assert_eq!(signed.entry_signatures, again.entry_signatures);
    let db = rusqlite::Connection::open(core.database_path()).unwrap();
    let count: i64 = db
        .query_row("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 3);
}
