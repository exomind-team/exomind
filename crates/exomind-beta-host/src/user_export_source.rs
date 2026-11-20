use crate::user_export::{
    build_user_export_with_options, CorrectionRead, CorrectionTargetScan, LocalOriginalState,
    OriginalAvailability as ExportOriginalAvailability, ScanCoverage, Selection, UserExportError,
    UserExportInput, UserExportLimits, UserExportOptions, UserExportPackage,
};
use crate::{context, resources, BetaHost, HostError};
use exomind_core::{
    CoreError, EventId, EventQuery, OriginalAvailability, OriginalId, OriginalRef, ProfileId,
    StageState, TimelineItem, MAX_EVENT_PAGE_SIZE,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;

const PAGE_SIZE: usize = if MAX_EVENT_PAGE_SIZE < 16 {
    MAX_EVENT_PAGE_SIZE
} else {
    16
};
const MAX_SELECTIONS: usize = 512;
const MAX_SCANNED_FACTS: usize = 4096;
const MAX_OUTPUT_FACTS: usize = 512;
const MAX_MARKDOWN_BYTES: usize = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_USER_EXPORT_ORIGINAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct UserExportSourceRequest {
    pub profile_id: ProfileId,
    pub selections: Vec<Selection>,
    pub limits: UserExportSourceLimits,
}

#[derive(Debug, Clone, Copy)]
pub struct UserExportSourceLimits {
    pub format: UserExportLimits,
    pub max_original_bytes: u64,
}

impl Default for UserExportSourceLimits {
    fn default() -> Self {
        Self {
            format: UserExportLimits::default(),
            max_original_bytes: MAX_USER_EXPORT_ORIGINAL_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserExportOriginalDisposition {
    Included,
    Missing,
    Conflict,
    Incomplete,
    Unknown,
    BudgetExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserExportOriginalMember {
    pub original: OriginalRef,
    pub disposition: UserExportOriginalDisposition,
    pub member_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UserExportSourcePackage {
    pub package: UserExportPackage,
    /// One row per unique OriginalId. This plan contains metadata, never bytes.
    pub original_members: Vec<UserExportOriginalMember>,
}

#[derive(Debug, Error)]
pub enum UserExportSourceError {
    #[error(transparent)]
    Host(#[from] HostError),
    #[error(transparent)]
    Formatter(#[from] UserExportError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error("user export selection is empty, duplicated, or too large")]
    InvalidSelection,
    #[error("user export limits exceed the bounded Native source contract")]
    InvalidLimits,
    #[error("timeline page does not match the frozen highwater or cursor")]
    SnapshotMismatch,
    #[error("manifest exceeds the configured encoding budget after source metadata")]
    ManifestBudgetExceeded,
}

struct TimelineScan {
    items: Vec<TimelineItem>,
    highwater: u64,
    coverage: ScanCoverage,
    page_trace: Vec<Value>,
    highwater_probe_rows: usize,
    selection_lookups: Vec<Value>,
}

struct CorrectionScan {
    records: Vec<exomind_core::CorrectionRecord>,
    targets: Vec<CorrectionTargetScan>,
}

impl BetaHost {
    /// Resolves explicit events by ID and blocks from the typed timeblock stream.
    /// Unrelated captures never consume a selected event or block scan budget.
    pub fn collect_user_export_source(
        &self,
        session: &crate::Session,
        request: &UserExportSourceRequest,
    ) -> Result<UserExportSourcePackage, UserExportSourceError> {
        validate_request(request)?;
        let has_block = request
            .selections
            .iter()
            .any(|selection| matches!(selection, Selection::Timeblock(_)));
        let mut timeline = if has_block {
            scan_timeblock_nodes(
                self,
                session,
                request.profile_id,
                request.limits.format.max_scanned_facts,
            )?
        } else {
            probe_highwater(self, session, request.profile_id)?
        };
        resolve_selected_events(
            self,
            session,
            request.profile_id,
            &request.selections,
            request.limits.format.max_scanned_facts,
            &mut timeline,
        )?;

        let selected_captures =
            selected_capture_ids(&request.selections, &timeline.items, timeline.highwater);
        let corrections = scan_corrections(
            self,
            session,
            request.profile_id,
            timeline.highwater,
            &selected_captures,
            request
                .limits
                .format
                .max_scanned_facts
                .saturating_sub(timeline.coverage.scanned_facts),
        )?;
        let mut input = UserExportInput {
            profile_id: request.profile_id,
            highwater: timeline.highwater,
            selections: request.selections.clone(),
            scan: timeline.coverage,
            items: timeline.items,
            originals: vec![],
            limits: request.limits.format,
        };
        let options = UserExportOptions::default();
        let preliminary = build_user_export_with_options(
            &input,
            CorrectionRead::Scanned {
                records: &corrections.records,
                targets: &corrections.targets,
            },
            options,
        )?;
        let emitted = emitted_capture_ids(&preliminary.manifest);
        let (availability, original_members) = plan_originals(
            self,
            session,
            request.profile_id,
            &input.items,
            &emitted,
            request.limits.max_original_bytes,
        )?;
        input.originals = availability;
        let mut package = build_user_export_with_options(
            &input,
            CorrectionRead::Scanned {
                records: &corrections.records,
                targets: &corrections.targets,
            },
            options,
        )?;
        add_source_manifest(
            &mut package,
            timeline.highwater,
            &timeline.page_trace,
            timeline.highwater_probe_rows,
            &timeline.selection_lookups,
            &original_members,
            request.limits.format.max_manifest_bytes,
        )?;
        Ok(UserExportSourcePackage {
            package,
            original_members,
        })
    }
}
fn validate_request(request: &UserExportSourceRequest) -> Result<(), UserExportSourceError> {
    if request.selections.is_empty() || request.selections.len() > MAX_SELECTIONS {
        return Err(UserExportSourceError::InvalidSelection);
    }
    let mut seen = HashSet::with_capacity(request.selections.len());
    for selection in &request.selections {
        let key = match selection {
            Selection::Event(id) => format!("event:{id}"),
            Selection::Timeblock(id) => format!("timeblock:{id}"),
        };
        if !seen.insert(key) {
            return Err(UserExportSourceError::InvalidSelection);
        }
    }

    let limits = request.limits.format;
    if limits.max_scanned_facts == 0
        || limits.max_scanned_facts > MAX_SCANNED_FACTS
        || limits.max_output_facts == 0
        || limits.max_output_facts > MAX_OUTPUT_FACTS
        || limits.max_markdown_bytes == 0
        || limits.max_markdown_bytes > MAX_MARKDOWN_BYTES
        || limits.max_manifest_bytes == 0
        || limits.max_manifest_bytes > MAX_MANIFEST_BYTES
        || request.limits.max_original_bytes > MAX_USER_EXPORT_ORIGINAL_BYTES
    {
        return Err(UserExportSourceError::InvalidLimits);
    }
    Ok(())
}

fn timeline_identity(item: &TimelineItem) -> (ProfileId, EventId, u64) {
    match item {
        TimelineItem::Capture(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::Timeblock(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::Summary(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::AgentSummary(record) => {
            (record.profile_id, record.event_id, record.local_seq)
        }
    }
}

fn probe_highwater(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
) -> Result<TimelineScan, UserExportSourceError> {
    let page = host.timeline_page(
        session,
        profile,
        &EventQuery {
            before: None,
            through: None,
            limit: 1,
            search: None,
        },
    )?;
    if page.items.len() > 1 {
        return Err(UserExportSourceError::SnapshotMismatch);
    }
    Ok(TimelineScan {
        items: vec![],
        highwater: page.highwater,
        coverage: ScanCoverage {
            scanned_facts: 0,
            complete: true,
            next_before: None,
        },
        page_trace: vec![json!({
            "scope": "highwater_probe",
            "through": page.highwater,
            "before": null,
            "next_before": page.next_before,
            "returned_rows": page.items.len(),
        })],
        highwater_probe_rows: page.items.len(),
        selection_lookups: vec![],
    })
}

fn scan_timeblock_nodes(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    max_scanned: usize,
) -> Result<TimelineScan, UserExportSourceError> {
    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut page_trace = Vec::new();
    let mut highwater = None;
    let mut before = None;
    let mut previous_sequence = None;
    let mut scanned = 0usize;
    let mut complete = false;
    let mut next_before = None;

    loop {
        let remaining = max_scanned.saturating_sub(scanned);
        if remaining == 0 {
            complete = false;
            break;
        }
        let limit = PAGE_SIZE.min(remaining);
        let page = host.timeblock_nodes(
            session,
            profile,
            &EventQuery {
                before,
                through: highwater,
                limit,
                search: None,
            },
        )?;
        let frozen = *highwater.get_or_insert(page.highwater);
        if page.highwater != frozen || page.items.len() > limit {
            return Err(UserExportSourceError::SnapshotMismatch);
        }

        let mut page_previous = before;
        for node in &page.items {
            if node.profile_id != profile
                || node.local_seq == 0
                || node.local_seq > frozen
                || page_previous.is_some_and(|cursor| node.local_seq >= cursor)
                || previous_sequence.is_some_and(|previous| node.local_seq >= previous)
                || !seen_ids.insert(node.event_id)
            {
                return Err(UserExportSourceError::SnapshotMismatch);
            }
            page_previous = Some(node.local_seq);
            previous_sequence = Some(node.local_seq);
        }

        let page_rows = page.items.len();
        scanned = scanned
            .checked_add(page_rows)
            .ok_or(UserExportSourceError::SnapshotMismatch)?;
        let page_cursor = page.next_before;
        if let Some(cursor) = page_cursor {
            if page.items.is_empty()
                || page.items.len() != limit
                || Some(cursor) != page.items.last().map(|node| node.local_seq)
                || before.is_some_and(|previous| cursor >= previous)
                || cursor == 0
            {
                return Err(UserExportSourceError::SnapshotMismatch);
            }
        }
        page_trace.push(json!({
            "scope": "typed_timeblock_nodes",
            "through": frozen,
            "before": before,
            "next_before": page_cursor,
            "scanned_facts": page_rows,
        }));
        items.extend(page.items.into_iter().map(TimelineItem::Timeblock));

        match page_cursor {
            None => {
                complete = true;
                next_before = None;
                break;
            }
            Some(cursor) if scanned >= max_scanned => {
                complete = false;
                next_before = Some(cursor);
                break;
            }
            Some(cursor) => before = Some(cursor),
        }
    }

    Ok(TimelineScan {
        items,
        highwater: highwater.unwrap_or(0),
        coverage: ScanCoverage {
            scanned_facts: scanned,
            complete,
            next_before,
        },
        page_trace,
        highwater_probe_rows: 0,
        selection_lookups: vec![],
    })
}

fn resolve_selected_events(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    selections: &[Selection],
    max_scanned: usize,
    scan: &mut TimelineScan,
) -> Result<(), UserExportSourceError> {
    let mut known_ids: HashSet<EventId> = scan
        .items
        .iter()
        .map(|item| timeline_identity(item).1)
        .collect();
    let mut remaining = max_scanned.saturating_sub(scan.coverage.scanned_facts);
    let mut lookup_complete = true;

    for selection in selections {
        let Selection::Event(event_id) = selection else {
            continue;
        };
        if known_ids.contains(event_id) {
            scan.selection_lookups.push(json!({
                "event_id": event_id.to_string(),
                "status": "resolved_from_typed_page",
                "scanned_facts": 0,
            }));
            continue;
        }
        if remaining == 0 {
            lookup_complete = false;
            scan.selection_lookups.push(json!({
                "event_id": event_id.to_string(),
                "status": "budget_exhausted",
                "scanned_facts": 0,
            }));
            continue;
        }
        remaining -= 1;
        scan.coverage.scanned_facts += 1;
        match host.timeline_event(session, profile, *event_id)? {
            Some(item) => {
                let (item_profile, actual_id, sequence) = timeline_identity(&item);
                if item_profile != profile || actual_id != *event_id || sequence == 0 {
                    return Err(UserExportSourceError::SnapshotMismatch);
                }
                let status = if sequence > scan.highwater {
                    "after_highwater"
                } else {
                    "resolved"
                };
                scan.selection_lookups.push(json!({
                    "event_id": event_id.to_string(),
                    "status": status,
                    "local_seq": sequence,
                    "scanned_facts": 1,
                }));
                known_ids.insert(actual_id);
                scan.items.push(item);
            }
            None => scan.selection_lookups.push(json!({
                "event_id": event_id.to_string(),
                "status": "missing",
                "scanned_facts": 1,
            })),
        }
    }
    scan.coverage.complete &= lookup_complete;
    Ok(())
}
fn selected_capture_ids(
    selections: &[Selection],
    items: &[TimelineItem],
    highwater: u64,
) -> Vec<EventId> {
    selections
        .iter()
        .filter_map(|selection| {
            let Selection::Event(event_id) = selection else {
                return None;
            };
            items
                .iter()
                .any(|item| {
                    matches!(item, TimelineItem::Capture(record)
                    if record.event_id == *event_id && record.local_seq <= highwater)
                })
                .then_some(*event_id)
        })
        .collect()
}

fn scan_corrections(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    highwater: u64,
    targets: &[EventId],
    mut remaining_budget: usize,
) -> Result<CorrectionScan, UserExportSourceError> {
    let mut records = Vec::new();
    let mut target_scans = Vec::with_capacity(targets.len());
    let mut seen_correction_ids = HashSet::new();

    for target_event_id in targets {
        let mut before = None;
        let mut scanned = 0usize;
        let mut complete = false;
        let mut next_before = None;
        loop {
            if remaining_budget == 0 {
                complete = false;
                break;
            }
            let limit = PAGE_SIZE.min(remaining_budget);
            let page = host.corrections_page_for_target(
                session,
                profile,
                &EventQuery {
                    before,
                    through: Some(highwater),
                    limit,
                    search: None,
                },
                *target_event_id,
            )?;
            if page.highwater != highwater || page.items.len() > limit {
                return Err(UserExportSourceError::SnapshotMismatch);
            }

            let mut page_previous = before;
            for entry in &page.items {
                let record = &entry.record;
                if record.profile_id != profile
                    || record.target_event_id != *target_event_id
                    || record.local_seq == 0
                    || record.local_seq > highwater
                    || page_previous.is_some_and(|cursor| record.local_seq >= cursor)
                    || !seen_correction_ids.insert(record.event_id)
                {
                    return Err(UserExportSourceError::SnapshotMismatch);
                }
                page_previous = Some(record.local_seq);
            }

            let page_rows = page.items.len();
            scanned = scanned
                .checked_add(page_rows)
                .ok_or(UserExportSourceError::SnapshotMismatch)?;
            remaining_budget = remaining_budget.saturating_sub(page_rows);
            let page_cursor = page.next_before;
            if let Some(cursor) = page_cursor {
                if page.items.is_empty()
                    || page.items.len() != limit
                    || Some(cursor) != page.items.last().map(|entry| entry.record.local_seq)
                    || before.is_some_and(|previous| cursor >= previous)
                    || cursor == 0
                {
                    return Err(UserExportSourceError::SnapshotMismatch);
                }
            }
            records.extend(page.items.into_iter().map(|entry| entry.record));

            match page_cursor {
                None => {
                    complete = true;
                    next_before = None;
                    break;
                }
                Some(cursor) if remaining_budget == 0 => {
                    complete = false;
                    next_before = Some(cursor);
                    break;
                }
                Some(cursor) => before = Some(cursor),
            }
        }
        target_scans.push(CorrectionTargetScan {
            profile_id: profile,
            target_event_id: *target_event_id,
            highwater,
            coverage: ScanCoverage {
                scanned_facts: scanned,
                complete,
                next_before,
            },
        });
    }

    Ok(CorrectionScan {
        records,
        targets: target_scans,
    })
}

fn emitted_capture_ids(manifest: &Value) -> HashSet<EventId> {
    manifest["facts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|fact| fact["kind"] == "capture")
        .filter_map(|fact| fact["event_id"].as_str()?.parse().ok())
        .collect()
}

#[derive(Clone)]
struct OriginalReference {
    original: OriginalRef,
    conflicting_metadata: bool,
}

fn plan_originals(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    items: &[TimelineItem],
    emitted_capture_ids: &HashSet<EventId>,
    max_original_bytes: u64,
) -> Result<
    (
        Vec<ExportOriginalAvailability>,
        Vec<UserExportOriginalMember>,
    ),
    UserExportSourceError,
> {
    let mut references = BTreeMap::<String, OriginalReference>::new();
    for item in items {
        let TimelineItem::Capture(record) = item else {
            continue;
        };
        if !emitted_capture_ids.contains(&record.event_id) {
            continue;
        }
        for original in &record.originals {
            match references.entry(original.original_id.to_string()) {
                std::collections::btree_map::Entry::Vacant(entry) => {
                    entry.insert(OriginalReference {
                        original: original.clone(),
                        conflicting_metadata: false,
                    });
                }
                std::collections::btree_map::Entry::Occupied(mut entry) => {
                    if entry.get().original != *original {
                        entry.get_mut().conflicting_metadata = true;
                    }
                }
            }
        }
    }

    let mut remaining = max_original_bytes;
    let mut availability = Vec::with_capacity(references.len());
    let mut members = Vec::with_capacity(references.len());
    for reference in references.into_values() {
        let local_state = if reference.conflicting_metadata {
            LocalOriginalState::Conflict
        } else {
            read_local_original_state(host, session, profile, &reference.original)?
        };
        let (disposition, member_name) = match local_state {
            LocalOriginalState::Available if reference.original.byte_length <= remaining => {
                remaining -= reference.original.byte_length;
                (
                    UserExportOriginalDisposition::Included,
                    Some(format!("originals/{}.bin", reference.original.original_id)),
                )
            }
            LocalOriginalState::Available => (UserExportOriginalDisposition::BudgetExceeded, None),
            LocalOriginalState::Missing => (UserExportOriginalDisposition::Missing, None),
            LocalOriginalState::Conflict => (UserExportOriginalDisposition::Conflict, None),
            LocalOriginalState::Incomplete => (UserExportOriginalDisposition::Incomplete, None),
            LocalOriginalState::Unknown => (UserExportOriginalDisposition::Unknown, None),
        };
        availability.push(ExportOriginalAvailability {
            profile_id: profile,
            original_id: reference.original.original_id,
            sha256: reference.original.sha256.clone(),
            byte_length: reference.original.byte_length,
            state: local_state,
        });
        members.push(UserExportOriginalMember {
            original: reference.original,
            disposition,
            member_name,
        });
    }
    Ok((availability, members))
}

fn read_local_original_state(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    expected: &OriginalRef,
) -> Result<LocalOriginalState, UserExportSourceError> {
    let state = host.active_state()?;
    let resources = resources(&state)?;
    let authority = host.profile_authority(resources, session, profile, false)?;
    let context = context(&resources.core, &authority)?;
    match resources
        .core
        .original_availability(&context, profile, expected.original_id)
    {
        Ok(OriginalAvailability::Local { stage }) => {
            if stage.profile_id != profile || stage.original != *expected {
                Ok(LocalOriginalState::Conflict)
            } else if stage.state == StageState::Verified
                && stage.next_offset == stage.original.byte_length
            {
                Ok(LocalOriginalState::Available)
            } else {
                Ok(LocalOriginalState::Incomplete)
            }
        }
        Ok(OriginalAvailability::Missing { original }) => {
            if original == *expected {
                Ok(LocalOriginalState::Missing)
            } else {
                Ok(LocalOriginalState::Conflict)
            }
        }
        Err(CoreError::UnknownOriginal | CoreError::OriginalNotReady) => {
            Ok(LocalOriginalState::Missing)
        }
        Err(
            CoreError::OriginalConflict
            | CoreError::OriginalAccessDenied
            | CoreError::ScopeMismatch,
        ) => Ok(LocalOriginalState::Conflict),
        Err(error) => Err(UserExportSourceError::Host(HostError::Core(error))),
    }
}

fn add_source_manifest(
    package: &mut UserExportPackage,
    highwater: u64,
    page_trace: &[Value],
    highwater_probe_rows: usize,
    selection_lookups: &[Value],
    original_members: &[UserExportOriginalMember],
    max_manifest_bytes: usize,
) -> Result<(), UserExportSourceError> {
    package.manifest["scan"]["scope"] = json!("selected_sources");
    package.manifest["scan"]["highwater"] = json!(highwater);
    package.manifest["scan"]["highwater_probe_rows"] = json!(highwater_probe_rows);
    package.manifest["scan"]["selection_lookups"] = json!(selection_lookups);
    package.manifest["scan"]["pages"] = json!(page_trace);
    let by_id: HashMap<String, &UserExportOriginalMember> = original_members
        .iter()
        .map(|member| (member.original.original_id.to_string(), member))
        .collect();
    if let Some(originals) = package.manifest["originals"].as_array_mut() {
        for item in originals {
            let Some(id) = item["original_id"].as_str() else {
                continue;
            };
            let Some(member) = by_id.get(id).copied() else {
                item["archive_member"] = Value::Null;
                item["inclusion_status"] = json!("unknown");
                continue;
            };
            item["archive_member"] = member
                .member_name
                .as_ref()
                .map_or(Value::Null, |name| json!(name));
            item["inclusion_status"] = json!(disposition_label(member.disposition));
        }
    }
    let complete = package.manifest["complete"].as_bool().unwrap_or(false)
        && original_members
            .iter()
            .all(|member| member.disposition == UserExportOriginalDisposition::Included);
    package.manifest["complete"] = json!(complete);
    if serde_json::to_vec(&package.manifest)?.len() > max_manifest_bytes {
        return Err(UserExportSourceError::ManifestBudgetExceeded);
    }
    Ok(())
}

fn disposition_label(disposition: UserExportOriginalDisposition) -> &'static str {
    match disposition {
        UserExportOriginalDisposition::Included => "included",
        UserExportOriginalDisposition::Missing => "missing",
        UserExportOriginalDisposition::Conflict => "conflict",
        UserExportOriginalDisposition::Incomplete => "incomplete",
        UserExportOriginalDisposition::Unknown => "unknown",
        UserExportOriginalDisposition::BudgetExceeded => "budget_exceeded",
    }
}
