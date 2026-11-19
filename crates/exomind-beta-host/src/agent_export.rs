//! Bounded read-only Agent bundles over the existing Beta typed timeline.
//!
//! This is a protocol bundle for an explicitly selected profile. It is not a
//! product export, a directory walk, or a full Core backup.

use crate::{BetaHost, HostError, Session, context, resources};
use exomind_core::{
    Core, CoreError, EventId, EventQuery, MAX_ORIGINAL_CHUNK_BYTES, OriginalBytesState, OriginalId,
    OriginalLifecycleStatus, OriginalReadPermit, OriginalRef, ProfileId, TimelineItem,
    WriterContext,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

const MAX_BUNDLE_PAGES: usize = 8;
const MAX_BUNDLE_BYTES: usize = 1024 * 1024;
const MIN_BUNDLE_BYTES: usize = 4096;
const BUNDLE_ENVELOPE_RESERVE: usize = 256;
const MAX_BUNDLE_ORIGINALS: usize = 256;
const MAX_INCLUDED_ORIGINALS: usize = 16;

const SUPPORTED_FACT_TYPES: &[&str] = &[
    "capture/1",
    "capture/2",
    "timeblock/1",
    "summary/1",
    "agent_summary/1",
];
const KNOWN_EXCLUDED_FACT_TYPES: &[&str] = &["correction/1", "orig_lifecycle/1"];

#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct AgentExportRequest {
    pub after_local_seq: u64,
    pub through: Option<u64>,
    pub before: Option<u64>,
    pub max_pages: usize,
    pub max_bytes: usize,
    pub include_original_ids: Vec<OriginalId>,
}

impl Default for AgentExportRequest {
    fn default() -> Self {
        Self {
            after_local_seq: 0,
            through: None,
            before: None,
            max_pages: 4,
            max_bytes: 512 * 1024,
            include_original_ids: Vec::new(),
        }
    }
}

impl AgentExportRequest {
    fn validate(&self) -> Result<(), HostError> {
        if !(1..=MAX_BUNDLE_PAGES).contains(&self.max_pages)
            || !(MIN_BUNDLE_BYTES..=MAX_BUNDLE_BYTES).contains(&self.max_bytes)
            || self.include_original_ids.len() > MAX_INCLUDED_ORIGINALS
        {
            return Err(HostError::InvalidRequest);
        }
        let mut selected = HashSet::with_capacity(self.include_original_ids.len());
        if self
            .include_original_ids
            .iter()
            .any(|original| !selected.insert(original.to_string()))
        {
            return Err(HostError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentExportBundle {
    pub protocol: &'static str,
    pub profile_id: ProfileId,
    pub coverage: AgentExportCoverage,
    pub facts: Vec<AgentExportFact>,
    pub originals: Vec<AgentExportOriginal>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentExportCoverage {
    pub scope: &'static str,
    pub after_local_seq: u64,
    pub through: u64,
    pub request_before: Option<u64>,
    pub next_before: Option<u64>,
    pub complete: bool,
    pub stop_reason: Option<&'static str>,
    pub included_facts: usize,
    pub supported_fact_types: &'static [&'static str],
    pub all_core_fact_kinds_included: bool,
    pub known_excluded_fact_types: &'static [&'static str],
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentExportFact {
    pub fact_id: EventId,
    pub kind: &'static str,
    pub local_seq: u64,
    pub digest: String,
    pub fact: TimelineItem,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentExportOriginal {
    pub original_id: OriginalId,
    pub sha256: String,
    pub byte_length: u64,
    pub file_name: String,
    pub media_type: String,
    pub local_availability: &'static str,
    pub included: bool,
    pub bytes_hex: Option<String>,
    pub reason: Option<&'static str>,
}

struct CandidateFact {
    output: AgentExportFact,
    originals: Vec<OriginalRef>,
}

fn candidate_fact(item: TimelineItem) -> CandidateFact {
    match item {
        TimelineItem::Capture(record) => {
            let originals = record.originals.clone();
            let fact_id = record.event_id;
            let local_seq = record.local_seq;
            let digest = record.digest.clone();
            let kind = if originals.is_empty() {
                "capture/1"
            } else {
                "capture/2"
            };
            CandidateFact {
                output: AgentExportFact {
                    fact_id,
                    kind,
                    local_seq,
                    digest,
                    fact: TimelineItem::Capture(record),
                },
                originals,
            }
        }
        TimelineItem::Timeblock(record) => CandidateFact {
            output: AgentExportFact {
                fact_id: record.event_id,
                kind: "timeblock/1",
                local_seq: record.local_seq,
                digest: record.digest.clone(),
                fact: TimelineItem::Timeblock(record),
            },
            originals: Vec::new(),
        },
        TimelineItem::Summary(record) => {
            let originals = record
                .snapshot
                .materials
                .iter()
                .map(|material| material.original.clone())
                .collect();
            CandidateFact {
                output: AgentExportFact {
                    fact_id: record.event_id,
                    kind: "summary/1",
                    local_seq: record.local_seq,
                    digest: record.digest.clone(),
                    fact: TimelineItem::Summary(record),
                },
                originals,
            }
        }
        TimelineItem::AgentSummary(record) => {
            let originals = record.snapshot.materials.clone();
            CandidateFact {
                output: AgentExportFact {
                    fact_id: record.event_id,
                    kind: "agent_summary/1",
                    local_seq: record.local_seq,
                    digest: record.digest.clone(),
                    fact: TimelineItem::AgentSummary(record),
                },
                originals,
            }
        }
    }
}

fn original_metadata(
    core: &Core,
    context: &WriterContext,
    profile: ProfileId,
    original: &OriginalRef,
) -> Result<AgentExportOriginal, HostError> {
    let (local_availability, reason) =
        match core.original_lifecycle_status(context, profile, original.original_id) {
            Ok(status) => {
                if status.profile_id != profile || status.original != *original {
                    return Err(HostError::Core(CoreError::RecoveryRequired));
                }
                availability(&status)
            }
            Err(CoreError::UnknownOriginal | CoreError::OriginalAccessDenied) => {
                ("unknown", Some("manifest_unavailable"))
            }
            Err(error) => return Err(error.into()),
        };
    Ok(AgentExportOriginal {
        original_id: original.original_id,
        sha256: original.sha256.clone(),
        byte_length: original.byte_length,
        file_name: original.file_name.clone(),
        media_type: original.media_type.clone(),
        local_availability,
        included: false,
        bytes_hex: None,
        reason,
    })
}

fn availability(status: &OriginalLifecycleStatus) -> (&'static str, Option<&'static str>) {
    match status.bytes_state {
        OriginalBytesState::Available => ("available", None),
        OriginalBytesState::Reclaimed => ("reclaimed", None),
        OriginalBytesState::Released => ("released", Some("locally_released")),
        OriginalBytesState::Purged => ("purged", Some("locally_purged")),
        OriginalBytesState::RestorePending => ("restore_pending", Some("restore_pending")),
        OriginalBytesState::Missing => ("missing", Some("bytes_missing")),
    }
}

fn item_seq(item: &TimelineItem) -> u64 {
    match item {
        TimelineItem::Capture(record) => record.local_seq,
        TimelineItem::Timeblock(record) => record.local_seq,
        TimelineItem::Summary(record) => record.local_seq,
        TimelineItem::AgentSummary(record) => record.local_seq,
    }
}

fn bundle_size(bundle: &AgentExportBundle) -> Result<usize, HostError> {
    serde_json::to_vec(bundle)
        .map(|bytes| bytes.len())
        .map_err(|_| HostError::AgentBundleSerialization)
}

fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len().saturating_mul(2));
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn read_failure(error: CoreError) -> Result<&'static str, HostError> {
    match error {
        CoreError::UnknownOriginal | CoreError::OriginalNotReady => Ok("bytes_not_available"),
        CoreError::OriginalHashMismatch | CoreError::OriginalIntegrityMismatch => {
            Ok("hash_or_integrity_mismatch")
        }
        CoreError::StaleOriginalRead => Ok("availability_changed_during_read"),
        other => Err(HostError::Core(other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_integrity_errors_are_reported_as_partial_without_claiming_bytes() {
        assert_eq!(
            read_failure(CoreError::OriginalIntegrityMismatch).unwrap(),
            "hash_or_integrity_mismatch"
        );
        assert_eq!(
            read_failure(CoreError::OriginalHashMismatch).unwrap(),
            "hash_or_integrity_mismatch"
        );
        assert_eq!(
            read_failure(CoreError::StaleOriginalRead).unwrap(),
            "availability_changed_during_read"
        );
    }
}

fn read_original_bytes(
    core: &Core,
    context: &WriterContext,
    profile: ProfileId,
    original: &OriginalRef,
) -> Result<Result<Vec<u8>, &'static str>, HostError> {
    let permit: OriginalReadPermit =
        match core.begin_original_read(context, profile, original.original_id) {
            Ok(permit) => permit,
            Err(error) => return Ok(Err(read_failure(error)?)),
        };
    let capacity = usize::try_from(original.byte_length).map_err(|_| HostError::InvalidRequest)?;
    let mut bytes = Vec::with_capacity(capacity);
    let mut hasher = Sha256::new();
    let mut offset = 0_u64;
    if original.byte_length == 0 {
        let chunk = match core.read_original_range_with_permit(context, &permit, 0, 1) {
            Ok(chunk) => chunk,
            Err(error) => return Ok(Err(read_failure(error)?)),
        };
        if chunk.offset != 0 || !chunk.bytes.is_empty() || chunk.original != *original {
            return Ok(Err("partial_read"));
        }
    }
    while offset < original.byte_length {
        let length =
            usize::try_from((original.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64))
                .map_err(|_| HostError::InvalidRequest)?;
        let chunk = match core.read_original_range_with_permit(context, &permit, offset, length) {
            Ok(chunk) => chunk,
            Err(error) => return Ok(Err(read_failure(error)?)),
        };
        if chunk.offset != offset || chunk.original != *original || chunk.bytes.len() != length {
            return Ok(Err("partial_read"));
        }
        hasher.update(&chunk.bytes);
        bytes.extend_from_slice(&chunk.bytes);
        offset = offset.saturating_add(length as u64);
    }
    if let Err(error) = core.finish_original_read(context, &permit) {
        return Ok(Err(read_failure(error)?));
    }
    let digest = format!("{:x}", hasher.finalize());
    if !digest.eq_ignore_ascii_case(&original.sha256) {
        return Ok(Err("hash_or_integrity_mismatch"));
    }
    Ok(Ok(bytes))
}

impl BetaHost {
    pub(crate) fn agent_export_bundle(
        &self,
        session: &Session,
        profile: ProfileId,
        request: &AgentExportRequest,
    ) -> Result<AgentExportBundle, HostError> {
        request.validate()?;
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let context = context(&resources.core, &authority)?;
        let first_page = resources.core.timeline_page(
            &context,
            profile,
            &EventQuery {
                before: request.before,
                through: request.through,
                limit: 1,
                search: None,
            },
        )?;
        let highwater = first_page.highwater;
        if request.after_local_seq > highwater
            || request
                .before
                .is_some_and(|before| before <= request.after_local_seq)
        {
            return Err(HostError::InvalidRequest);
        }

        let mut bundle = AgentExportBundle {
            protocol: crate::PROTOCOL,
            profile_id: profile,
            coverage: AgentExportCoverage {
                scope: "typed_timeline_supported_subset",
                after_local_seq: request.after_local_seq,
                through: highwater,
                request_before: request.before,
                next_before: None,
                complete: false,
                stop_reason: None,
                included_facts: 0,
                supported_fact_types: SUPPORTED_FACT_TYPES,
                all_core_fact_kinds_included: false,
                known_excluded_fact_types: KNOWN_EXCLUDED_FACT_TYPES,
            },
            facts: Vec::new(),
            originals: Vec::new(),
        };
        if bundle_size(&bundle)? > request.max_bytes {
            return Err(HostError::InvalidRequest);
        }

        let mut before = request.before;
        let mut page = Some(first_page);
        let mut reference_by_id = BTreeMap::<String, OriginalRef>::new();
        let mut pages_read = 0_usize;
        loop {
            if pages_read >= request.max_pages {
                bundle.coverage.complete = false;
                bundle.coverage.stop_reason = Some("page_limit");
                bundle.coverage.next_before = bundle.facts.last().map(|fact| fact.local_seq);
                break;
            }
            let current_page = match page.take() {
                Some(page) => page,
                None => resources.core.timeline_page(
                    &context,
                    profile,
                    &EventQuery {
                        before,
                        through: Some(highwater),
                        limit: 1,
                        search: None,
                    },
                )?,
            };
            pages_read += 1;
            let Some(item) = current_page.items.into_iter().next() else {
                bundle.coverage.complete = true;
                bundle.coverage.next_before = None;
                break;
            };
            let local_seq = item_seq(&item);
            if local_seq <= request.after_local_seq {
                bundle.coverage.complete = true;
                bundle.coverage.next_before = None;
                break;
            }
            let older_exists = current_page.next_before.is_some();
            let candidate = candidate_fact(item);
            let mut candidate_bundle = bundle.clone();
            candidate_bundle.facts.push(candidate.output);
            let mut candidate_references = reference_by_id.clone();
            for original in candidate.originals {
                let key = original.original_id.to_string();
                candidate_references.entry(key).or_insert(original);
            }
            if candidate_references.len() > MAX_BUNDLE_ORIGINALS {
                bundle.coverage.complete = false;
                bundle.coverage.stop_reason = Some("original_manifest_limit");
                bundle.coverage.next_before = bundle
                    .facts
                    .last()
                    .map(|fact| fact.local_seq)
                    .or_else(|| before.or_else(|| local_seq.checked_add(1)));
                break;
            }
            candidate_bundle.originals = candidate_references
                .values()
                .map(|original| original_metadata(&resources.core, &context, profile, original))
                .collect::<Result<Vec<_>, _>>()?;
            candidate_bundle.coverage.included_facts = candidate_bundle.facts.len();
            candidate_bundle.coverage.complete = !older_exists;
            candidate_bundle.coverage.next_before = older_exists.then_some(local_seq);
            if bundle_size(&candidate_bundle)?
                > request.max_bytes.saturating_sub(BUNDLE_ENVELOPE_RESERVE)
            {
                bundle.coverage.complete = false;
                bundle.coverage.stop_reason = Some("byte_budget");
                bundle.coverage.next_before = bundle
                    .facts
                    .last()
                    .map(|fact| fact.local_seq)
                    .or_else(|| before.or_else(|| local_seq.checked_add(1)));
                break;
            }
            bundle = candidate_bundle;
            reference_by_id = candidate_references;
            if !older_exists {
                bundle.coverage.complete = true;
                bundle.coverage.next_before = None;
                break;
            }
            before = Some(local_seq);
            if pages_read >= request.max_pages {
                bundle.coverage.complete = false;
                bundle.coverage.stop_reason = Some("page_limit");
                bundle.coverage.next_before = Some(local_seq);
                break;
            }
        }

        let selected = request
            .include_original_ids
            .iter()
            .map(ToString::to_string)
            .collect::<HashSet<_>>();
        if selected
            .iter()
            .any(|original_id| !reference_by_id.contains_key(original_id))
        {
            return Err(HostError::Forbidden);
        }
        for original_id in selected {
            let reference = reference_by_id
                .get(&original_id)
                .ok_or(HostError::Forbidden)?;
            let index = bundle
                .originals
                .iter()
                .position(|entry| entry.original_id == reference.original_id)
                .ok_or(HostError::Forbidden)?;
            let current = bundle.originals[index].clone();
            if !matches!(current.local_availability, "available" | "reclaimed") {
                continue;
            }
            let current_size = bundle_size(&bundle)?;
            let hex_budget = reference.byte_length.saturating_mul(2);
            let available = request
                .max_bytes
                .saturating_sub(current_size)
                .saturating_sub(BUNDLE_ENVELOPE_RESERVE);
            if hex_budget > available as u64 {
                bundle.originals[index].reason = Some("byte_budget");
                continue;
            }
            match read_original_bytes(&resources.core, &context, profile, reference)? {
                Ok(bytes) => {
                    let mut candidate_bundle = bundle.clone();
                    candidate_bundle.originals[index].included = true;
                    candidate_bundle.originals[index].bytes_hex = Some(hex(&bytes));
                    candidate_bundle.originals[index].reason = None;
                    if bundle_size(&candidate_bundle)?
                        <= request.max_bytes.saturating_sub(BUNDLE_ENVELOPE_RESERVE)
                    {
                        bundle = candidate_bundle;
                    } else {
                        bundle.originals[index].reason = Some("byte_budget");
                    }
                }
                Err(reason) => bundle.originals[index].reason = Some(reason),
            }
        }
        while bundle_size(&bundle)? > request.max_bytes {
            let Some(index) = bundle
                .originals
                .iter()
                .rposition(|original| original.included)
            else {
                return Err(HostError::AgentBundleSerialization);
            };
            bundle.originals[index].included = false;
            bundle.originals[index].bytes_hex = None;
            bundle.originals[index].reason = Some("byte_budget");
        }
        Ok(bundle)
    }
}
