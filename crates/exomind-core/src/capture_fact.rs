//! The existing capture/1 and capture/2 wire bytes, shared by local commits and
//! later authenticated replication. Hashing grants no write/read authority and
//! does not replace content, membership or referenced-byte validation.
use crate::{
    AuthorKind, CaptureCommand, CoreError, DeviceId, EventId, EventRecord, OriginalRef, ProfileId,
    WriterContext,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Serialize)]
pub(crate) struct CaptureFact<'a> {
    kind: &'static str,
    profile: ProfileId,
    event: EventId,
    device: DeviceId,
    author: Uuid,
    author_kind: AuthorKind,
    occurred_at_ms: i64,
    text: &'a str,
    tags: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    originals: Option<&'a [OriginalRef]>,
}

impl<'a> CaptureFact<'a> {
    pub(crate) fn local(
        context: &WriterContext,
        input: &'a CaptureCommand,
        normalized_tags: &'a [String],
    ) -> Self {
        Self {
            kind: if input.originals.is_empty() {
                "capture/1"
            } else {
                "capture/2"
            },
            profile: input.profile_id,
            event: input.event_id,
            device: context.device_id,
            author: context.author_id,
            author_kind: context.author_kind,
            occurred_at_ms: input.occurred_at_ms,
            text: &input.text,
            tags: normalized_tags,
            originals: (!input.originals.is_empty()).then_some(input.originals.as_slice()),
        }
    }

    fn record(record: &'a EventRecord) -> Self {
        Self {
            kind: if record.originals.is_empty() {
                "capture/1"
            } else {
                "capture/2"
            },
            profile: record.profile_id,
            event: record.event_id,
            device: record.device_id,
            author: record.author_id,
            author_kind: record.author_kind,
            occurred_at_ms: record.occurred_at_ms,
            text: &record.text,
            tags: &record.tags,
            originals: (!record.originals.is_empty()).then_some(record.originals.as_slice()),
        }
    }

    fn bytes(&self) -> Result<Vec<u8>, CoreError> {
        Ok(serde_json::to_vec(self)?)
    }

    pub(crate) fn digest(&self) -> Result<String, CoreError> {
        Ok(format!("{:x}", Sha256::digest(self.bytes()?)))
    }
}

impl EventRecord {
    /// Portable fact bytes preserve the recorded origin and author. Receiver
    /// local_seq, cached digest and command receipts are deliberately excluded.
    /// Tags are used as recorded; this method does not normalize untrusted data.
    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        CaptureFact::record(self).bytes()
    }

    /// Recompute, rather than trust the stored digest. This is not permission to
    /// import a fact, nor evidence that any referenced original bytes are local.
    pub fn computed_digest(&self) -> Result<String, CoreError> {
        CaptureFact::record(self).digest()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(with_original: bool) -> EventRecord {
        EventRecord {
            profile_id: "11111111-1111-4111-8111-111111111111".parse().unwrap(),
            event_id: "22222222-2222-4222-8222-222222222222".parse().unwrap(),
            device_id: "33333333-3333-4333-8333-333333333333".parse().unwrap(),
            author_id: "44444444-4444-4444-8444-444444444444".parse().unwrap(),
            author_kind: AuthorKind::Human,
            occurred_at_ms: 1794000000000,
            text: "原文\n00/ff".into(),
            tags: vec!["beta".into(), "中文".into()],
            originals: if with_original {
                vec![OriginalRef {
                    original_id: "55555555-5555-4555-8555-555555555555".parse().unwrap(),
                    sha256: "a".repeat(64),
                    byte_length: 42,
                    file_name: "opaque.bin".into(),
                    media_type: "application/octet-stream".into(),
                }]
            } else {
                vec![]
            },
            digest: "cached digest must not be signed".into(),
            local_seq: 99,
        }
    }

    #[test]
    fn existing_capture_wire_versions_keep_independent_golden_hashes() {
        // Fixed UTF-8 JSON vectors also computed independently with Node crypto.
        for (original, expected) in [
            (
                false,
                "e381662d464b481e72c6ad455e41dc12802af64d26c2d96b8e455905c38a91cb",
            ),
            (
                true,
                "303ae1bb22f3f9541351c26b6794a36f48857542e36b5b6a254cd7df9acc2177",
            ),
        ] {
            let event = record(original);
            assert_eq!(event.computed_digest().unwrap(), expected);
            let body: serde_json::Value =
                serde_json::from_slice(&event.canonical_fact_bytes().unwrap()).unwrap();
            assert_eq!(
                body["kind"],
                if original { "capture/2" } else { "capture/1" }
            );
            assert_eq!(body.get("originals").is_some(), original);
            assert!(body.get("digest").is_none() && body.get("local_seq").is_none());
        }
    }

    #[test]
    fn reception_position_is_local_but_origin_and_attachment_order_are_signed_content() {
        let event = record(true);
        let expected = event.computed_digest().unwrap();
        let mut received = event.clone();
        received.local_seq = 1;
        received.digest.clear();
        assert_eq!(received.computed_digest().unwrap(), expected);
        received.device_id = DeviceId::new();
        assert_ne!(received.computed_digest().unwrap(), expected);
        let mut changed = event.clone();
        changed.originals[0].file_name = "other.bin".into();
        assert_ne!(changed.computed_digest().unwrap(), expected);
        let mut group = event.clone();
        let mut second = group.originals[0].clone();
        second.original_id = crate::OriginalId::new();
        group.originals.push(second);
        let ordered_digest = group.computed_digest().unwrap();
        group.originals.swap(0, 1);
        assert_ne!(group.computed_digest().unwrap(), ordered_digest);
    }
}
