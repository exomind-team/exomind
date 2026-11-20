use exomind_core::{
    CorrectionRecord, EventId, EventRecord, OriginalId, OriginalRef, ProfileId, TimeblockAction,
    TimeblockId, TimeblockNodeRecord, TimeblockPayload, TimelineItem,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::{self, Write},
};
use thiserror::Error;

const DEFAULT_MAX_SCANNED_FACTS: usize = 4096;
const DEFAULT_MAX_OUTPUT_FACTS: usize = 512;
const DEFAULT_MAX_MARKDOWN_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const CORRECTION_SCOPE: &str =
    "selected_capture_same_profile_target_event_id_and_digest_local_seq_lte_highwater";
const TIMEBLOCK_SCOPE: &str = "only_timeblock_facts_whose_payload_references_selected_block_ids";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    Event(EventId),
    Timeblock(TimeblockId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalOriginalState {
    Available,
    Missing,
    Conflict,
    Incomplete,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginalAvailability {
    pub profile_id: ProfileId,
    pub original_id: OriginalId,
    pub sha256: String,
    pub byte_length: u64,
    pub state: LocalOriginalState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanCoverage {
    pub scanned_facts: usize,
    pub complete: bool,
    pub next_before: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CorrectionTargetScan {
    pub profile_id: ProfileId,
    pub target_event_id: EventId,
    pub highwater: u64,
    pub coverage: ScanCoverage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserExportLimits {
    pub max_scanned_facts: usize,
    pub max_output_facts: usize,
    pub max_markdown_bytes: usize,
    pub max_manifest_bytes: usize,
}

impl Default for UserExportLimits {
    fn default() -> Self {
        Self {
            max_scanned_facts: DEFAULT_MAX_SCANNED_FACTS,
            max_output_facts: DEFAULT_MAX_OUTPUT_FACTS,
            max_markdown_bytes: DEFAULT_MAX_MARKDOWN_BYTES,
            max_manifest_bytes: DEFAULT_MAX_MANIFEST_BYTES,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserExportInput {
    pub profile_id: ProfileId,
    pub highwater: u64,
    pub selections: Vec<Selection>,
    pub scan: ScanCoverage,
    pub items: Vec<TimelineItem>,
    pub originals: Vec<OriginalAvailability>,
    pub limits: UserExportLimits,
}

/// Correction rows must come from the existing profile-scoped
/// corrections_page_for_target query, using the export's frozen through value.
#[derive(Debug, Clone, Copy)]
pub enum CorrectionRead<'a> {
    /// No correction query ran. With the default include switch, the package is
    /// explicitly incomplete until the caller supplies a bounded read result.
    NotPerformed,
    Scanned {
        records: &'a [CorrectionRecord],
        targets: &'a [CorrectionTargetScan],
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserExportOptions {
    /// Engineering default: append matching correction facts to selected captures.
    pub include_corrections: bool,
}

impl Default for UserExportOptions {
    fn default() -> Self {
        Self {
            include_corrections: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserExportPackage {
    pub markdown: String,
    pub manifest: Value,
}

#[derive(Debug, Error)]
pub enum UserExportError {
    #[error("user export selection is empty")]
    EmptySelection,
    #[error("a read fact belongs to a different profile")]
    ProfileMismatch,
    #[error("the same fact ID was supplied more than once")]
    DuplicateFact,
    #[error("scan coverage exceeds the configured scan budget")]
    ScanBudgetExceeded,
    #[error("a scan reports fewer rows than were supplied")]
    ScanCoverageMismatch,
    #[error("correction page does not match the frozen profile highwater")]
    SnapshotMismatch,
    #[error("correction rows are missing a target-scoped scan result")]
    CorrectionScopeMismatch,
    #[error("export limits must be positive")]
    InvalidLimits,
    #[error("Markdown exceeds the configured encoding budget")]
    MarkdownBudgetExceeded,
    #[error("manifest exceeds the configured encoding budget")]
    ManifestBudgetExceeded,
    #[error("correction rows were read while include_corrections is disabled")]
    CorrectionsReadWhileDisabled,
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy)]
enum Candidate<'a> {
    Capture(&'a EventRecord),
    Timeblock(&'a TimeblockNodeRecord),
    Correction(&'a CorrectionRecord),
}

impl<'a> Candidate<'a> {
    fn event_id(self) -> String {
        match self {
            Self::Capture(record) => record.event_id.to_string(),
            Self::Timeblock(record) => record.event_id.to_string(),
            Self::Correction(record) => record.event_id.to_string(),
        }
    }

    fn local_seq(self) -> u64 {
        match self {
            Self::Capture(record) => record.local_seq,
            Self::Timeblock(record) => record.local_seq,
            Self::Correction(record) => record.local_seq,
        }
    }

    fn occurred_at_ms(self) -> i64 {
        match self {
            Self::Capture(record) => record.occurred_at_ms,
            Self::Timeblock(record) => record.occurred_at_ms,
            Self::Correction(record) => record.occurred_at_ms,
        }
    }

    fn kind(self) -> &'static str {
        match self {
            Self::Capture(_) => "capture",
            Self::Timeblock(_) => "timeblock/1",
            Self::Correction(_) => "correction/1",
        }
    }

    fn profile_id(self) -> ProfileId {
        match self {
            Self::Capture(record) => record.profile_id,
            Self::Timeblock(record) => record.profile_id,
            Self::Correction(record) => record.profile_id,
        }
    }

    fn digest(self) -> &'a str {
        match self {
            Self::Capture(record) => &record.digest,
            Self::Timeblock(record) => &record.digest,
            Self::Correction(record) => &record.digest,
        }
    }
}

#[derive(Debug)]
struct SelectionResult {
    kind: &'static str,
    id: String,
    status: &'static str,
    fact_ids: Vec<String>,
}

#[derive(Debug)]
struct CorrectionRelation<'a> {
    record: &'a CorrectionRecord,
    status: &'static str,
}

/// Formats an input without a correction read. Since the engineering default
/// includes corrections, its manifest marks correction scope as not scanned.
pub fn build_user_export(input: &UserExportInput) -> Result<UserExportPackage, UserExportError> {
    build_user_export_with_options(
        input,
        CorrectionRead::NotPerformed,
        UserExportOptions::default(),
    )
}

pub fn build_user_export_with_options(
    input: &UserExportInput,
    correction_read: CorrectionRead<'_>,
    options: UserExportOptions,
) -> Result<UserExportPackage, UserExportError> {
    validate_limits(input.limits)?;
    if input.selections.is_empty() {
        return Err(UserExportError::EmptySelection);
    }
    if input.items.len() > input.scan.scanned_facts {
        return Err(UserExportError::ScanCoverageMismatch);
    }
    if input.scan.complete && input.scan.next_before.is_some() {
        return Err(UserExportError::ScanCoverageMismatch);
    }
    for original in &input.originals {
        if original.profile_id != input.profile_id {
            return Err(UserExportError::ProfileMismatch);
        }
    }

    let correction_scan = match correction_read {
        CorrectionRead::NotPerformed => None,
        CorrectionRead::Scanned { records, targets } => {
            if !options.include_corrections {
                return Err(UserExportError::CorrectionsReadWhileDisabled);
            }
            let mut scanned_facts = 0usize;
            for target in targets {
                if target.profile_id != input.profile_id {
                    return Err(UserExportError::ProfileMismatch);
                }
                if target.highwater != input.highwater {
                    return Err(UserExportError::SnapshotMismatch);
                }
                if target.coverage.complete && target.coverage.next_before.is_some() {
                    return Err(UserExportError::ScanCoverageMismatch);
                }
                scanned_facts = scanned_facts
                    .checked_add(target.coverage.scanned_facts)
                    .ok_or(UserExportError::ScanBudgetExceeded)?;
            }
            if records.len() > scanned_facts {
                return Err(UserExportError::ScanCoverageMismatch);
            }
            Some((records, targets, scanned_facts))
        }
    };
    let correction_scanned = match correction_scan {
        Some((_, _, scanned)) => scanned,
        None => 0,
    };
    let total_scanned = input
        .scan
        .scanned_facts
        .checked_add(correction_scanned)
        .ok_or(UserExportError::ScanBudgetExceeded)?;
    if total_scanned > input.limits.max_scanned_facts {
        return Err(UserExportError::ScanBudgetExceeded);
    }

    let mut by_event_id = HashMap::<String, &TimelineItem>::new();
    for item in &input.items {
        let (profile_id, event_id, _) = item_identity(item);
        if profile_id != input.profile_id {
            return Err(UserExportError::ProfileMismatch);
        }
        if by_event_id.insert(event_id.to_string(), item).is_some() {
            return Err(UserExportError::DuplicateFact);
        }
    }

    let mut candidates = Vec::<Candidate<'_>>::new();
    let mut candidate_ids = HashSet::<String>::new();
    let mut selected_event_ids = HashSet::<String>::new();
    let mut selected_captures = HashMap::<String, &EventRecord>::new();
    let mut selections = Vec::<SelectionResult>::new();
    let mut has_selection_problem = false;

    for selection in &input.selections {
        match selection {
            Selection::Event(event_id) => {
                let id = event_id.to_string();
                selected_event_ids.insert(id.clone());
                let (status, fact_ids) = match by_event_id.get(&id).copied() {
                    Some(TimelineItem::Capture(record)) if record.local_seq <= input.highwater => {
                        selected_captures.insert(id.clone(), record);
                        add_candidate(
                            &mut candidates,
                            &mut candidate_ids,
                            Candidate::Capture(record),
                        )?;
                        ("included", vec![id.clone()])
                    }
                    Some(TimelineItem::Capture(record)) if record.local_seq > input.highwater => {
                        ("after_highwater", Vec::new())
                    }
                    Some(_) => ("unsupported_kind", Vec::new()),
                    None if input.scan.complete => ("missing", Vec::new()),
                    None => ("incomplete", Vec::new()),
                };
                has_selection_problem |= status != "included";
                selections.push(SelectionResult {
                    kind: "event",
                    id,
                    status,
                    fact_ids,
                });
            }
            Selection::Timeblock(block_id) => {
                let id = block_id.to_string();
                let mut fact_ids = Vec::new();
                let mut after_highwater = false;
                for item in &input.items {
                    let TimelineItem::Timeblock(record) = item else {
                        continue;
                    };
                    if !references_block(record, *block_id) {
                        continue;
                    }
                    if record.local_seq > input.highwater {
                        after_highwater = true;
                        continue;
                    }
                    let event_id = record.event_id.to_string();
                    add_candidate(
                        &mut candidates,
                        &mut candidate_ids,
                        Candidate::Timeblock(record),
                    )?;
                    fact_ids.push(event_id);
                }
                let status = if !input.scan.complete {
                    "incomplete"
                } else if fact_ids.is_empty() && after_highwater {
                    "after_highwater"
                } else if fact_ids.is_empty() {
                    "missing"
                } else {
                    "included"
                };
                has_selection_problem |= status != "included";
                selections.push(SelectionResult {
                    kind: "timeblock",
                    id,
                    status,
                    fact_ids,
                });
            }
        }
    }

    let mut correction_relations = Vec::<CorrectionRelation<'_>>::new();
    let mut correction_conflict = false;
    let mut correction_targets_manifest = Vec::<Value>::new();
    let mut correction_missing_targets = Vec::<String>::new();
    let mut correction_scan_complete = false;
    let correction_scan_state = if !options.include_corrections {
        correction_scan_complete = true;
        "disabled"
    } else {
        match correction_scan {
            None => {
                if selected_event_ids.is_empty() {
                    correction_scan_complete = true;
                    "not_required"
                } else {
                    correction_conflict = true;
                    "not_scanned"
                }
            }
            Some((records, targets, _)) => {
                let mut scanned_targets = HashSet::<String>::new();
                for target in targets {
                    let target_id = target.target_event_id.to_string();
                    if !selected_event_ids.contains(&target_id)
                        || !scanned_targets.insert(target_id.clone())
                    {
                        return Err(UserExportError::CorrectionScopeMismatch);
                    }
                    correction_targets_manifest.push(json!({
                        "profile_id": target.profile_id.to_string(),
                        "target_event_id": target_id,
                        "highwater": target.highwater,
                        "scanned_facts": target.coverage.scanned_facts,
                        "complete": target.coverage.complete,
                        "next_before": target.coverage.next_before,
                    }));
                }
                correction_missing_targets = selected_event_ids
                    .iter()
                    .filter(|target_id| !scanned_targets.contains(*target_id))
                    .cloned()
                    .collect();
                correction_missing_targets.sort();
                correction_targets_manifest.sort_by(|left, right| {
                    left["target_event_id"]
                        .as_str()
                        .cmp(&right["target_event_id"].as_str())
                });
                correction_scan_complete = correction_missing_targets.is_empty()
                    && targets.iter().all(|target| target.coverage.complete);
                if !correction_scan_complete {
                    correction_conflict = true;
                }
                let mut seen_corrections = HashSet::<String>::new();
                for record in records {
                    if record.profile_id != input.profile_id {
                        return Err(UserExportError::ProfileMismatch);
                    }
                    let correction_id = record.event_id.to_string();
                    if !seen_corrections.insert(correction_id.clone()) {
                        return Err(UserExportError::DuplicateFact);
                    }
                    if record.local_seq > input.highwater
                        || !selected_event_ids.contains(&record.target_event_id.to_string())
                    {
                        continue;
                    }
                    if !scanned_targets.contains(&record.target_event_id.to_string()) {
                        correction_conflict = true;
                        correction_relations.push(CorrectionRelation {
                            record,
                            status: "target_scan_missing",
                        });
                        continue;
                    }
                    let target = selected_captures
                        .get(&record.target_event_id.to_string())
                        .copied();
                    let status = match target {
                        None => {
                            correction_conflict = true;
                            "unresolved_target"
                        }
                        Some(capture) if record.target_digest != capture.digest => {
                            correction_conflict = true;
                            "target_digest_conflict"
                        }
                        Some(_) => {
                            if candidate_ids.contains(&correction_id) {
                                return Err(UserExportError::DuplicateFact);
                            }
                            add_candidate(
                                &mut candidates,
                                &mut candidate_ids,
                                Candidate::Correction(record),
                            )?;
                            "pending_output"
                        }
                    };
                    correction_relations.push(CorrectionRelation { record, status });
                }
                if correction_scan_complete {
                    "complete"
                } else {
                    "incomplete"
                }
            }
        }
    };

    candidates.sort_by(|left, right| {
        left.local_seq()
            .cmp(&right.local_seq())
            .then_with(|| left.event_id().cmp(&right.event_id()))
    });
    let candidate_count = candidates.len();
    let omitted_facts = candidate_count.saturating_sub(input.limits.max_output_facts);
    let emitted = candidates
        .iter()
        .take(input.limits.max_output_facts)
        .copied()
        .collect::<Vec<_>>();
    let emitted_ids = emitted
        .iter()
        .map(|candidate| candidate.event_id())
        .collect::<HashSet<_>>();
    let result_limit_reached = omitted_facts > 0;
    for relation in &mut correction_relations {
        if relation.status == "pending_output" {
            relation.status = if emitted_ids.contains(&relation.record.event_id.to_string()) {
                "included"
            } else {
                "omitted_output_limit"
            };
        }
    }
    correction_relations.sort_by(|left, right| {
        left.record
            .local_seq
            .cmp(&right.record.local_seq)
            .then_with(|| {
                left.record
                    .event_id
                    .to_string()
                    .cmp(&right.record.event_id.to_string())
            })
    });
    for selection in &mut selections {
        if selection.status == "included"
            && selection
                .fact_ids
                .iter()
                .any(|fact_id| !emitted_ids.contains(fact_id))
        {
            selection.status = "incomplete";
            has_selection_problem = true;
        }
    }

    let original_states = original_availability_map(input)?;
    let mut markdown = String::new();
    append(
        &mut markdown,
        "# ExoMind user range export\n\n",
        input.limits.max_markdown_bytes,
    )?;
    append(
        &mut markdown,
        &format!(
            "Profile: {}\nHighwater: {}\n\n",
            input.profile_id, input.highwater
        ),
        input.limits.max_markdown_bytes,
    )?;
    append(
        &mut markdown,
        "Timeblock selections include only timeblock facts whose payload references selected block IDs; related Capture records are not implicit.\n\n",
        input.limits.max_markdown_bytes,
    )?;
    if !input.scan.complete {
        append(
            &mut markdown,
            "INCOMPLETE: primary fact scan did not reach its end.\n",
            input.limits.max_markdown_bytes,
        )?;
    }
    if options.include_corrections {
        match correction_scan_state {
            "not_scanned" => append(
                &mut markdown,
                "INCOMPLETE: correction history was not scanned; original capture text alone is not a complete corrected view.\n",
                input.limits.max_markdown_bytes,
            )?,
            "incomplete" => append(
                &mut markdown,
                "INCOMPLETE: correction history scan stopped before its end.\n",
                input.limits.max_markdown_bytes,
            )?,
            _ => {}
        }
    } else {
        append(
            &mut markdown,
            "Correction inclusion was explicitly disabled with include_corrections=false.\n",
            input.limits.max_markdown_bytes,
        )?;
    }
    if omitted_facts > 0 {
        append(
            &mut markdown,
            &format!("INCOMPLETE: output fact limit omitted {omitted_facts} selected facts.\n"),
            input.limits.max_markdown_bytes,
        )?;
    }
    for relation in &correction_relations {
        if relation.status == "omitted_output_limit" {
            append(
                &mut markdown,
                &format!(
                    "INCOMPLETE: appended correction {} for capture {} was omitted by the output fact limit.\n",
                    relation.record.event_id, relation.record.target_event_id
                ),
                input.limits.max_markdown_bytes,
            )?;
        } else if relation.status == "target_digest_conflict"
            || relation.status == "unresolved_target"
            || relation.status == "target_scan_missing"
        {
            append(
                &mut markdown,
                &format!(
                    "Correction conflict metadata only: {} ({})\n",
                    relation.record.event_id, relation.status
                ),
                input.limits.max_markdown_bytes,
            )?;
        }
    }
    for candidate in &emitted {
        render_candidate(
            &mut markdown,
            *candidate,
            &original_states,
            input.limits.max_markdown_bytes,
        )?;
    }

    let fact_values = emitted
        .iter()
        .map(|candidate| candidate_manifest(*candidate))
        .collect::<Result<Vec<_>, _>>()?;
    let original_values = originals_manifest(&emitted, &original_states);
    let selection_values = selections
        .iter()
        .map(|selection| {
            json!({
                "kind": selection.kind,
                "id": selection.id,
                "status": selection.status,
                "fact_ids": selection.fact_ids,
            })
        })
        .collect::<Vec<_>>();
    let correction_values = correction_relations
        .iter()
        .map(|relation| {
            Ok(json!({
                "event_id": relation.record.event_id.to_string(),
                "profile_id": relation.record.profile_id.to_string(),
                "occurred_at_ms": relation.record.occurred_at_ms,
                "target_event_id": relation.record.target_event_id.to_string(),
                "target_digest": relation.record.target_digest,
                "digest": relation.record.digest,
                "local_seq": relation.record.local_seq,
                "source": {
                    "device_id": relation.record.device_id.to_string(),
                    "author_id": relation.record.author_id.to_string(),
                    "author_kind": serde_json::to_value(&relation.record.author_kind)?,
                },
                "status": relation.status,
            }))
        })
        .collect::<Result<Vec<Value>, serde_json::Error>>()?;
    let correction_was_scanned = correction_scan.is_some();
    let corrections_complete = !options.include_corrections || correction_scan_complete;
    let complete = input.scan.complete
        && corrections_complete
        && !correction_conflict
        && !has_selection_problem
        && !result_limit_reached;
    let correction_read_complete = !options.include_corrections || correction_scan_complete;

    let manifest = json!({
        "format": "exomind-user-range-export/1",
        "profile_id": input.profile_id.to_string(),
        "highwater": input.highwater,
        "complete": complete,
        "scan": {
            "scanned_facts": input.scan.scanned_facts,
            "total_scanned_facts": total_scanned,
            "complete": input.scan.complete,
            "next_before": input.scan.next_before,
        },
        "derived_selection": {
            "include_corrections": options.include_corrections,
            "correction_scope": CORRECTION_SCOPE,
            "correction_scan": if correction_was_scanned {
                json!({
                    "status": correction_scan_state,
                    "scanned_facts": correction_scanned,
                    "complete": correction_scan_complete,
                    "missing_targets": correction_missing_targets,
                    "targets": correction_targets_manifest,
                })
            } else {
                json!({
                    "status": correction_scan_state,
                    "scanned_facts": 0,
                    "complete": correction_read_complete,
                    "missing_targets": if options.include_corrections {
                        selected_event_ids.iter().cloned().collect::<Vec<_>>()
                    } else {
                        Vec::<String>::new()
                    },
                    "targets": [],
                })
            },
            "corrections": correction_values,
            "timeblock_scope": TIMEBLOCK_SCOPE,
        },
        "selections": selection_values,
        "facts": fact_values,
        "originals": original_values,
        "result_limit_reached": result_limit_reached,
        "omitted_facts": omitted_facts,
    });
    ensure_manifest_budget(&manifest, input.limits.max_manifest_bytes)?;

    Ok(UserExportPackage { markdown, manifest })
}

fn validate_limits(limits: UserExportLimits) -> Result<(), UserExportError> {
    if limits.max_scanned_facts == 0
        || limits.max_output_facts == 0
        || limits.max_markdown_bytes == 0
        || limits.max_manifest_bytes == 0
    {
        return Err(UserExportError::InvalidLimits);
    }
    Ok(())
}

fn item_identity(item: &TimelineItem) -> (ProfileId, EventId, u64) {
    match item {
        TimelineItem::Capture(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::Timeblock(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::Summary(record) => (record.profile_id, record.event_id, record.local_seq),
        TimelineItem::AgentSummary(record) => {
            (record.profile_id, record.event_id, record.local_seq)
        }
    }
}

fn add_candidate<'a>(
    candidates: &mut Vec<Candidate<'a>>,
    seen: &mut HashSet<String>,
    candidate: Candidate<'a>,
) -> Result<(), UserExportError> {
    if seen.insert(candidate.event_id()) {
        candidates.push(candidate);
    }
    Ok(())
}

fn references_block(record: &TimeblockNodeRecord, selected: TimeblockId) -> bool {
    match &record.payload {
        TimeblockPayload::Action { action } => match action {
            TimeblockAction::Start { block_id, .. }
            | TimeblockAction::Pause { block_id }
            | TimeblockAction::Resume { block_id }
            | TimeblockAction::EndAction { block_id }
            | TimeblockAction::SubmitFeedback { block_id, .. }
            | TimeblockAction::AppendFeedback { block_id, .. } => *block_id == selected,
            TimeblockAction::Rotate {
                from_block_id,
                next,
            } => *from_block_id == selected || next.block_id == selected,
        },
        TimeblockPayload::DeadlineReached { block_id, .. }
        | TimeblockPayload::RunDeadlineReached { block_id, .. } => *block_id == selected,
    }
}

fn candidate_manifest(candidate: Candidate<'_>) -> Result<Value, UserExportError> {
    let source = match candidate {
        Candidate::Capture(record) => json!({
            "device_id": record.device_id.to_string(),
            "author_id": record.author_id.to_string(),
            "author_kind": serde_json::to_value(&record.author_kind)?,
        }),
        Candidate::Timeblock(record) => json!({
            "device_id": record.device_id.to_string(),
            "author_id": record.source.author_id.to_string(),
            "author_kind": serde_json::to_value(record.source.kind)?,
        }),
        Candidate::Correction(record) => json!({
            "device_id": record.device_id.to_string(),
            "author_id": record.author_id.to_string(),
            "author_kind": serde_json::to_value(&record.author_kind)?,
        }),
    };
    let mut value = json!({
        "kind": candidate.kind(),
        "event_id": candidate.event_id(),
        "profile_id": candidate.profile_id().to_string(),
        "digest": candidate.digest(),
        "local_seq": candidate.local_seq(),
        "occurred_at_ms": candidate.occurred_at_ms(),
        "source": source,
    });
    if let Candidate::Correction(record) = candidate {
        value["target_event_id"] = json!(record.target_event_id.to_string());
        value["target_digest"] = json!(record.target_digest);
    }
    Ok(value)
}

fn original_availability_map(
    input: &UserExportInput,
) -> Result<HashMap<String, Vec<&OriginalAvailability>>, UserExportError> {
    let mut values = HashMap::<String, Vec<&OriginalAvailability>>::new();
    for item in &input.originals {
        if item.profile_id != input.profile_id {
            return Err(UserExportError::ProfileMismatch);
        }
        values
            .entry(item.original_id.to_string())
            .or_default()
            .push(item);
    }
    Ok(values)
}

fn original_state(
    original: &OriginalRef,
    states: &HashMap<String, Vec<&OriginalAvailability>>,
) -> (&'static str, &'static str) {
    let Some(matches) = states.get(&original.original_id.to_string()) else {
        return ("missing", "not_present_locally");
    };
    if matches.len() != 1 {
        return ("conflict", "duplicate_local_status");
    }
    let local = matches[0];
    if local.sha256 != original.sha256 || local.byte_length != original.byte_length {
        return ("conflict", "local_metadata_mismatch");
    }
    match local.state {
        LocalOriginalState::Available => ("available", "verified_local_metadata"),
        LocalOriginalState::Missing => ("missing", "not_present_locally"),
        LocalOriginalState::Conflict => ("conflict", "local_copy_conflict"),
        LocalOriginalState::Incomplete => ("incomplete", "local_read_incomplete"),
        LocalOriginalState::Unknown => ("unknown", "local_state_unknown"),
    }
}

fn originals_manifest(
    emitted: &[Candidate<'_>],
    states: &HashMap<String, Vec<&OriginalAvailability>>,
) -> Vec<Value> {
    let mut values = Vec::new();
    for candidate in emitted {
        let Candidate::Capture(record) = candidate else {
            continue;
        };
        for original in &record.originals {
            let (availability, reason) = original_state(original, states);
            values.push(json!({
                "event_id": record.event_id.to_string(),
                "original_id": original.original_id.to_string(),
                "sha256": original.sha256,
                "byte_length": original.byte_length,
                "file_name": original.file_name,
                "media_type": original.media_type,
                "availability": availability,
                "reason": reason,
            }));
        }
    }
    values
}

fn render_candidate(
    markdown: &mut String,
    candidate: Candidate<'_>,
    states: &HashMap<String, Vec<&OriginalAvailability>>,
    max_bytes: usize,
) -> Result<(), UserExportError> {
    let payload = match candidate {
        Candidate::Capture(record) => {
            let originals = record
                .originals
                .iter()
                .map(|original| {
                    let (availability, reason) = original_state(original, states);
                    json!({
                        "original_id": original.original_id.to_string(),
                        "sha256": original.sha256,
                        "byte_length": original.byte_length,
                        "file_name": original.file_name,
                        "media_type": original.media_type,
                        "availability": availability,
                        "reason": reason,
                    })
                })
                .collect::<Vec<_>>();
            json!({"kind": candidate.kind(), "fact": record, "originals": originals})
        }
        Candidate::Timeblock(record) => json!({"kind": candidate.kind(), "fact": record}),
        Candidate::Correction(record) => json!({"kind": candidate.kind(), "fact": record}),
    };
    append(
        markdown,
        &format!(
            "\n## {} {}\n\n~~~json\n",
            candidate.kind(),
            candidate.event_id()
        ),
        max_bytes,
    )?;
    let remaining = max_bytes.saturating_sub(markdown.len());
    let bytes = bounded_json_bytes(&payload, remaining, false)?;
    let rendered = String::from_utf8(bytes).map_err(|_| UserExportError::MarkdownBudgetExceeded)?;
    append(markdown, &rendered, max_bytes)?;
    append(markdown, "\n~~~\n", max_bytes)
}

fn append(output: &mut String, text: &str, max_bytes: usize) -> Result<(), UserExportError> {
    if output.len().saturating_add(text.len()) > max_bytes {
        return Err(UserExportError::MarkdownBudgetExceeded);
    }
    output.push_str(text);
    Ok(())
}

fn ensure_manifest_budget(value: &Value, max_bytes: usize) -> Result<(), UserExportError> {
    let _ = bounded_json_bytes(value, max_bytes, true)?;
    Ok(())
}

fn bounded_json_bytes<T: Serialize>(
    value: &T,
    max_bytes: usize,
    manifest: bool,
) -> Result<Vec<u8>, UserExportError> {
    let mut writer = BoundedWriter {
        bytes: Vec::new(),
        limit: max_bytes,
        overflow: false,
    };
    match serde_json::to_writer_pretty(&mut writer, value) {
        Ok(()) => Ok(writer.bytes),
        Err(_) if writer.overflow => {
            if manifest {
                Err(UserExportError::ManifestBudgetExceeded)
            } else {
                Err(UserExportError::MarkdownBudgetExceeded)
            }
        }
        Err(error) => Err(UserExportError::Serialization(error)),
    }
}

struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
    overflow: bool,
}

impl Write for BoundedWriter {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        if self.bytes.len().saturating_add(input.len()) > self.limit {
            self.overflow = true;
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "encoded output budget exceeded",
            ));
        }
        self.bytes.extend_from_slice(input);
        Ok(input.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
