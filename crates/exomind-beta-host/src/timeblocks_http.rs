use crate::{
    BetaHost, HostError,
    http::{bearer, work},
};
use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::HeaderMap,
    routing::{get, post},
};
use exomind_core::{
    CommandId, CoreError, CountdownEndMode, EventId, EventQuery, FeedbackInput, IntervalKind,
    IntervalPage, IntervalQuery, ProfileId, Receipt, TimeblockAction, TimeblockCommand,
    TimeblockInterval, TimeblockNodePage, TimeblockNodeRecord, TimeblockPayload, TimeblockPhase,
    TimeblockRevision, TimeblockSnapshot, TimelinePage, TimelinePeriodQuery, TimerSpec,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandBody {
    command_id: CommandId,
    event_id: EventId,
    expected_revision: TimeblockRevision,
    action: TimeblockAction,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadQuery {
    before: Option<u64>,
    through: Option<u64>,
    limit: Option<usize>,
    q: Option<String>,
}
impl ReadQuery {
    fn query(self) -> EventQuery {
        EventQuery {
            before: self.before,
            through: self.through,
            limit: self.limit.unwrap_or(100),
            search: self.q,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PeriodReadQuery {
    from_ms: i64,
    to_ms: i64,
    before: Option<u64>,
    through: Option<u64>,
    limit: Option<usize>,
    q: Option<String>,
    tag: Option<String>,
}
impl PeriodReadQuery {
    fn query(self) -> TimelinePeriodQuery {
        TimelinePeriodQuery {
            from_ms: self.from_ms,
            to_ms: self.to_ms,
            before: self.before,
            through: self.through,
            limit: self.limit.unwrap_or(100),
            search: self.q,
            tag: self.tag,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Intervals {
    from_ms: i64,
    to_ms: i64,
    through: Option<TimeblockRevision>,
    limit: Option<usize>,
}

const DEFAULT_RECENT_BLOCK_LIMIT: usize = 5;
const MAX_RECENT_BLOCK_LIMIT: usize = 20;
const DEFAULT_RECENT_NODE_LIMIT: usize = 200;
const MAX_RECENT_NODE_LIMIT: usize = 500;
const MAX_RECENT_INTERVAL_LIMIT: usize = 100;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentQuery {
    limit: Option<usize>,
    node_limit: Option<usize>,
    interval_limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct RecentCoverage {
    complete: bool,
    nodes_complete: bool,
    parent_graph_complete: bool,
    intervals_complete: bool,
    revision_stable: bool,
    node_highwater_stable: bool,
    causal_order_complete: bool,
    clock_uncertain: bool,
    block_limit: usize,
    nodes_scanned: usize,
    node_limit: usize,
    intervals_scanned: usize,
    interval_limit: usize,
    more_available: bool,
    next_before: Option<u64>,
    interval_from_ms: Option<i64>,
    interval_to_ms: Option<i64>,
    next_interval_from_ms: Option<i64>,
    reasons: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct RecentFeedback {
    event_id: String,
    kind: &'static str,
    text_preview: Option<String>,
    byte_length: Option<usize>,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct RecentDeadline {
    event_id: String,
    end_mode: &'static str,
    outcome: &'static str,
    generation: u64,
    due_wall_ms: i64,
    due_elapsed_ms: u64,
    clock_epoch: String,
    run_event_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct RecentBlockSummary {
    block_id: String,
    name: Option<String>,
    note: Option<String>,
    timer: Option<TimerSpec>,
    phase: &'static str,
    start_event_id: Option<String>,
    started_at_ms: Option<i64>,
    end_reason: Option<&'static str>,
    end_event_ids: Vec<String>,
    ended_at_ms: Option<i64>,
    deadline_events: Vec<RecentDeadline>,
    feedback: Vec<RecentFeedback>,
    source_event_ids: Vec<String>,
    work_ms: Option<u64>,
    intervals: Vec<TimeblockInterval>,
    complete: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct RecentResponse {
    profile_id: ProfileId,
    revision: Option<TimeblockRevision>,
    highwater: Option<u64>,
    as_of_ms: Option<i64>,
    state: &'static str,
    active: Option<RecentBlockSummary>,
    recent: Vec<RecentBlockSummary>,
    intervals: Vec<TimeblockInterval>,
    coverage: RecentCoverage,
}

struct NodeScan {
    items: Vec<TimeblockNodeRecord>,
    highwater: Option<u64>,
    next_before: Option<u64>,
    complete: bool,
    stable_highwater: bool,
}

#[derive(Default)]
struct BlockSummaryBuilder {
    block_id: String,
    creator_event_id: Option<String>,
    name: Option<String>,
    note: Option<String>,
    timer: Option<TimerSpec>,
    started_at_ms: Option<i64>,
    creator_order: usize,
    phase: Option<&'static str>,
    generation: Option<u64>,
    run_device_id: Option<String>,
    run_event_id: Option<String>,
    end_reason: Option<&'static str>,
    end_event_ids: Vec<String>,
    ended_at_ms: Option<i64>,
    deadline_events: Vec<RecentDeadline>,
    feedback: Vec<RecentFeedback>,
    source_event_ids: Vec<String>,
    complete: bool,
    creator_count: usize,
    terminal_count: usize,
}

fn recent_query_limits(query: &RecentQuery) -> Result<(usize, usize, usize), HostError> {
    let block_limit = query.limit.unwrap_or(DEFAULT_RECENT_BLOCK_LIMIT);
    let node_limit = query.node_limit.unwrap_or(DEFAULT_RECENT_NODE_LIMIT);
    let interval_limit = query.interval_limit.unwrap_or(MAX_RECENT_INTERVAL_LIMIT);
    if !(1..=MAX_RECENT_BLOCK_LIMIT).contains(&block_limit)
        || !(1..=MAX_RECENT_NODE_LIMIT).contains(&node_limit)
        || !(1..=MAX_RECENT_INTERVAL_LIMIT).contains(&interval_limit)
    {
        return Err(HostError::InvalidRequest);
    }
    Ok((block_limit, node_limit, interval_limit))
}

fn incomplete_reason(error: &HostError) -> Option<&'static str> {
    match error {
        HostError::Core(CoreError::InvalidTimeblockHistory) => Some("invalid_parent_history"),
        HostError::Core(CoreError::RecoveryRequired) => Some("core_history_requires_recovery"),
        HostError::Core(CoreError::InvalidQuery("unknown timeblock snapshot")) => {
            Some("timeblock_revision_unavailable")
        }
        _ => None,
    }
}

fn incomplete_response(
    profile: ProfileId,
    revision: Option<TimeblockRevision>,
    highwater: Option<u64>,
    as_of_ms: Option<i64>,
    block_limit: usize,
    node_limit: usize,
    interval_limit: usize,
    reason: &'static str,
) -> RecentResponse {
    RecentResponse {
        profile_id: profile,
        revision,
        highwater,
        as_of_ms,
        state: "incomplete",
        active: None,
        recent: vec![],
        intervals: vec![],
        coverage: RecentCoverage {
            complete: false,
            nodes_complete: false,
            parent_graph_complete: false,
            intervals_complete: false,
            revision_stable: false,
            node_highwater_stable: false,
            causal_order_complete: false,
            clock_uncertain: false,
            block_limit,
            nodes_scanned: 0,
            node_limit,
            intervals_scanned: 0,
            interval_limit,
            more_available: false,
            next_before: None,
            interval_from_ms: None,
            interval_to_ms: None,
            next_interval_from_ms: None,
            reasons: vec![reason],
        },
    }
}

fn push_reason(coverage: &mut RecentCoverage, reason: &'static str) {
    if !coverage.reasons.contains(&reason) {
        coverage.reasons.push(reason);
    }
}

fn apply_revision_fence(
    coverage: &mut RecentCoverage,
    expected: &TimeblockRevision,
    observed: Option<&TimeblockRevision>,
) {
    coverage.revision_stable = observed == Some(expected);
    if !coverage.revision_stable {
        push_reason(coverage, "revision_changed_during_read");
    }
}

fn evidence_complete(coverage: &RecentCoverage) -> bool {
    coverage.nodes_complete
        && coverage.parent_graph_complete
        && coverage.intervals_complete
        && coverage.revision_stable
        && coverage.node_highwater_stable
        && coverage.causal_order_complete
        && !coverage.clock_uncertain
}

fn scan_nodes(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    node_limit: usize,
) -> Result<NodeScan, HostError> {
    let mut items = Vec::with_capacity(node_limit);
    let mut before = None;
    let mut through = None;
    let mut highwater = None;
    let mut next_before = None;
    let mut complete = false;
    let mut stable_highwater = true;

    loop {
        let remaining = node_limit.saturating_sub(items.len());
        if remaining == 0 {
            break;
        }
        let page = host.timeblock_nodes(
            session,
            profile,
            &EventQuery {
                before,
                through,
                limit: remaining.min(100),
                search: None,
            },
        )?;
        if let Some(expected) = highwater {
            if page.highwater != expected {
                stable_highwater = false;
                break;
            }
        } else {
            highwater = Some(page.highwater);
            through = Some(page.highwater);
        }
        items.extend(page.items);
        next_before = page.next_before;
        if next_before.is_none() {
            complete = true;
            break;
        }
        if items.len() >= node_limit || next_before == before {
            break;
        }
        before = next_before;
    }

    Ok(NodeScan {
        items,
        highwater,
        next_before,
        complete,
        stable_highwater,
    })
}

fn causal_order(nodes: &[TimeblockNodeRecord]) -> Result<(Vec<usize>, bool), &'static str> {
    let mut indexes = HashMap::with_capacity(nodes.len());
    for (index, node) in nodes.iter().enumerate() {
        if indexes.insert(node.event_id.to_string(), index).is_some() {
            return Err("duplicate_event_id");
        }
    }
    for node in nodes {
        if node
            .parents
            .iter()
            .any(|parent| !indexes.contains_key(&parent.to_string()))
        {
            return Err("missing_parent");
        }
    }

    let mut remaining: HashSet<usize> = (0..nodes.len()).collect();
    let mut seen = HashSet::<String>::with_capacity(nodes.len());
    let mut ordered = Vec::with_capacity(nodes.len());
    let mut concurrent = false;
    while !remaining.is_empty() {
        let mut ready = remaining
            .iter()
            .copied()
            .filter(|index| {
                nodes[*index]
                    .parents
                    .iter()
                    .all(|parent| seen.contains(&parent.to_string()))
            })
            .collect::<Vec<_>>();
        if ready.is_empty() {
            return Err("parent_cycle");
        }
        if ready.len() > 1 {
            concurrent = true;
        }
        ready.sort_by_key(|index| {
            (
                nodes[*index].device_id.to_string(),
                nodes[*index].event_id.to_string(),
            )
        });
        let index = ready[0];
        remaining.remove(&index);
        seen.insert(nodes[index].event_id.to_string());
        ordered.push(index);
    }
    Ok((ordered, concurrent))
}

fn bounded_feedback(text: &str, maximum_bytes: usize) -> (String, usize, bool) {
    let byte_length = text.len();
    if byte_length <= maximum_bytes {
        return (text.to_owned(), byte_length, false);
    }
    let mut end = maximum_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), byte_length, true)
}

fn new_block_builder(block_id: &str, order: usize) -> BlockSummaryBuilder {
    BlockSummaryBuilder {
        block_id: block_id.to_owned(),
        creator_order: order,
        complete: true,
        ..BlockSummaryBuilder::default()
    }
}

fn block_builder<'a>(
    builders: &'a mut HashMap<String, BlockSummaryBuilder>,
    block_id: &str,
    order: usize,
) -> &'a mut BlockSummaryBuilder {
    builders
        .entry(block_id.to_owned())
        .or_insert_with(|| new_block_builder(block_id, order))
}

fn add_source(builder: &mut BlockSummaryBuilder, event_id: &EventId) {
    let event = event_id.to_string();
    if !builder.source_event_ids.contains(&event) {
        builder.source_event_ids.push(event);
    }
}

fn set_creator(
    builder: &mut BlockSummaryBuilder,
    node: &TimeblockNodeRecord,
    order: usize,
    name: &str,
    note: &str,
    timer: &TimerSpec,
) {
    builder.creator_count += 1;
    add_source(builder, &node.event_id);
    if builder.creator_count != 1 {
        builder.complete = false;
        return;
    }
    builder.creator_event_id = Some(node.event_id.to_string());
    builder.name = Some(name.to_owned());
    builder.note = Some(note.to_owned());
    builder.timer = Some(timer.clone());
    builder.started_at_ms = Some(node.effective_at_ms);
    builder.creator_order = order;
    builder.phase = Some("running");
    builder.generation = Some(1);
    builder.run_device_id = Some(node.device_id.to_string());
    builder.run_event_id = Some(node.event_id.to_string());
}

fn add_terminal(
    builder: &mut BlockSummaryBuilder,
    node: &TimeblockNodeRecord,
    end_reason: &'static str,
) {
    add_source(builder, &node.event_id);
    builder.terminal_count += 1;
    if builder.terminal_count == 1 {
        builder.end_reason = Some(end_reason);
        builder.end_event_ids.push(node.event_id.to_string());
        builder.ended_at_ms = Some(node.effective_at_ms);
    } else {
        builder.complete = false;
        builder.end_reason = Some("unknown");
        if !builder.end_event_ids.contains(&node.event_id.to_string()) {
            builder.end_event_ids.push(node.event_id.to_string());
        }
    }
    builder.phase = Some("feedback_pending");
    builder.generation = builder.generation.map(|value| value.saturating_add(1));
}

fn feedback_text(event_id: &EventId, kind: &'static str, text: &str) -> RecentFeedback {
    let (text_preview, byte_length, truncated) = bounded_feedback(text, 1024);
    RecentFeedback {
        event_id: event_id.to_string(),
        kind,
        text_preview: Some(text_preview),
        byte_length: Some(byte_length),
        truncated,
    }
}

fn deadline_evidence(
    node: &TimeblockNodeRecord,
    end_mode: CountdownEndMode,
    outcome: &'static str,
    generation: u64,
    due_wall_ms: i64,
    due_elapsed_ms: u64,
    clock_epoch: &uuid::Uuid,
    run_event_id: Option<&EventId>,
) -> RecentDeadline {
    RecentDeadline {
        event_id: node.event_id.to_string(),
        end_mode: match end_mode {
            CountdownEndMode::Hard => "hard",
            CountdownEndMode::Soft => "soft",
        },
        outcome,
        generation,
        due_wall_ms,
        due_elapsed_ms,
        clock_epoch: clock_epoch.to_string(),
        run_event_id: run_event_id.map(ToString::to_string),
    }
}

fn deadline_outcome(
    builder: &BlockSummaryBuilder,
    node: &TimeblockNodeRecord,
    generation: u64,
    end_mode: CountdownEndMode,
    run_event_id: Option<&EventId>,
    causal_order_complete: bool,
) -> &'static str {
    if !causal_order_complete
        || builder.creator_count != 1
        || builder.generation.is_none()
        || builder.phase.is_none()
        || builder.run_device_id.is_none()
        || builder.run_event_id.is_none()
    {
        return "unknown";
    }

    let same_run = match run_event_id {
        Some(event_id) => builder.run_event_id.as_deref() == Some(event_id.to_string().as_str()),
        None => builder.generation == Some(generation),
    };
    let same_device = builder.run_device_id.as_deref() == Some(node.device_id.to_string().as_str());
    if !same_run || !same_device || builder.phase != Some("running") {
        return "superseded";
    }

    match end_mode {
        CountdownEndMode::Hard => "applied_hard",
        CountdownEndMode::Soft => "applied_soft",
    }
}

fn build_block_builders(
    nodes: &[TimeblockNodeRecord],
    order: &[usize],
    causal_order_complete: bool,
) -> HashMap<String, BlockSummaryBuilder> {
    let mut builders = HashMap::<String, BlockSummaryBuilder>::new();
    for (position, index) in order.iter().copied().enumerate() {
        let node = &nodes[index];
        match &node.payload {
            TimeblockPayload::Action { action } => match action {
                TimeblockAction::Start {
                    block_id,
                    name,
                    note,
                    timer,
                } => {
                    let key = block_id.to_string();
                    let builder = block_builder(&mut builders, &key, position);
                    set_creator(builder, node, position, name, note, timer);
                }
                TimeblockAction::Rotate {
                    from_block_id,
                    next,
                } => {
                    let from = from_block_id.to_string();
                    add_terminal(
                        block_builder(&mut builders, &from, position),
                        node,
                        "rotation",
                    );
                    let next_id = next.block_id.to_string();
                    let builder = block_builder(&mut builders, &next_id, position);
                    set_creator(builder, node, position, &next.name, &next.note, &next.timer);
                }
                TimeblockAction::Pause { block_id } => {
                    let builder = block_builder(&mut builders, &block_id.to_string(), position);
                    add_source(builder, &node.event_id);
                    builder.phase = Some("paused");
                    builder.generation = builder.generation.map(|value| value.saturating_add(1));
                }
                TimeblockAction::Resume { block_id } => {
                    let builder = block_builder(&mut builders, &block_id.to_string(), position);
                    add_source(builder, &node.event_id);
                    builder.phase = Some("running");
                    builder.generation = builder.generation.map(|value| value.saturating_add(1));
                    builder.run_device_id = Some(node.device_id.to_string());
                    builder.run_event_id = Some(node.event_id.to_string());
                }
                TimeblockAction::EndAction { block_id } => {
                    add_terminal(
                        block_builder(&mut builders, &block_id.to_string(), position),
                        node,
                        "manual_end",
                    );
                }
                TimeblockAction::SubmitFeedback { block_id, feedback } => {
                    let builder = block_builder(&mut builders, &block_id.to_string(), position);
                    add_source(builder, &node.event_id);
                    match feedback {
                        FeedbackInput::Text { text } => {
                            builder
                                .feedback
                                .push(feedback_text(&node.event_id, "text", text));
                        }
                        FeedbackInput::Skipped => builder.feedback.push(RecentFeedback {
                            event_id: node.event_id.to_string(),
                            kind: "skipped",
                            text_preview: None,
                            byte_length: None,
                            truncated: false,
                        }),
                    }
                    if builder.terminal_count == 0 {
                        builder.complete = false;
                        builder.end_reason = Some("unknown");
                    }
                    builder.phase = Some("completed");
                    builder.generation = builder.generation.map(|value| value.saturating_add(1));
                }
                TimeblockAction::AppendFeedback { block_id, text } => {
                    let builder = block_builder(&mut builders, &block_id.to_string(), position);
                    add_source(builder, &node.event_id);
                    builder
                        .feedback
                        .push(feedback_text(&node.event_id, "append", text));
                }
            },
            TimeblockPayload::DeadlineReached {
                block_id,
                end_mode,
                generation,
                due_wall_ms,
                due_elapsed_ms,
                clock_epoch,
                ..
            } => {
                let builder = block_builder(&mut builders, &block_id.to_string(), position);
                add_source(builder, &node.event_id);
                let outcome = deadline_outcome(
                    builder,
                    node,
                    *generation,
                    *end_mode,
                    None,
                    causal_order_complete,
                );
                builder.deadline_events.push(deadline_evidence(
                    node,
                    *end_mode,
                    outcome,
                    *generation,
                    *due_wall_ms,
                    *due_elapsed_ms,
                    clock_epoch,
                    None,
                ));
                if outcome == "applied_hard" {
                    add_terminal(builder, node, "hard_deadline");
                }
            }
            TimeblockPayload::RunDeadlineReached {
                block_id,
                end_mode,
                generation,
                due_wall_ms,
                due_elapsed_ms,
                clock_epoch,
                run_event_id,
                ..
            } => {
                let builder = block_builder(&mut builders, &block_id.to_string(), position);
                add_source(builder, &node.event_id);
                let outcome = deadline_outcome(
                    builder,
                    node,
                    *generation,
                    *end_mode,
                    Some(run_event_id),
                    causal_order_complete,
                );
                builder.deadline_events.push(deadline_evidence(
                    node,
                    *end_mode,
                    outcome,
                    *generation,
                    *due_wall_ms,
                    *due_elapsed_ms,
                    clock_epoch,
                    Some(run_event_id),
                ));
                if outcome == "applied_hard" {
                    add_terminal(builder, node, "hard_deadline");
                }
            }
        }
    }
    for builder in builders.values_mut() {
        if builder.creator_count != 1 || builder.creator_event_id.is_none() {
            builder.complete = false;
        }
    }
    builders
}

fn phase_name(phase: TimeblockPhase) -> &'static str {
    match phase {
        TimeblockPhase::Running => "running",
        TimeblockPhase::Paused => "paused",
        TimeblockPhase::FeedbackPending => "feedback_pending",
        TimeblockPhase::Completed => "completed",
    }
}

fn running_work_ms(block_id: &str, intervals: &[TimeblockInterval]) -> Option<u64> {
    intervals
        .iter()
        .filter(|interval| {
            interval.kind == IntervalKind::Running
                && interval
                    .block_id
                    .as_ref()
                    .is_some_and(|id| id.to_string() == block_id)
        })
        .try_fold(0_u64, |total, interval| {
            let duration = interval.to_ms.checked_sub(interval.from_ms)?;
            total.checked_add(u64::try_from(duration).ok()?)
        })
}

fn summarize_block(
    builder: &BlockSummaryBuilder,
    active: Option<&exomind_core::ActiveTimeblock>,
    intervals: &[TimeblockInterval],
    evidence_complete: bool,
) -> RecentBlockSummary {
    let is_active = active.is_some_and(|value| value.block_id.to_string() == builder.block_id);
    let mut source_event_ids = builder.source_event_ids.clone();
    source_event_ids.sort();
    source_event_ids.dedup();
    let block_intervals = intervals
        .iter()
        .filter(|interval| {
            interval
                .block_id
                .as_ref()
                .is_some_and(|id| id.to_string() == builder.block_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    let phase = active
        .filter(|_| is_active)
        .map(|value| phase_name(value.phase))
        .or(builder.phase)
        .unwrap_or("unknown");
    let complete = builder.complete
        && builder.creator_count == 1
        && evidence_complete
        && phase != "unknown"
        && (phase != "completed" || builder.terminal_count > 0);

    RecentBlockSummary {
        block_id: builder.block_id.clone(),
        name: active
            .filter(|_| is_active)
            .map(|value| value.name.clone())
            .or_else(|| builder.name.clone()),
        note: active
            .filter(|_| is_active)
            .map(|value| value.note.clone())
            .or_else(|| builder.note.clone()),
        timer: active
            .filter(|_| is_active)
            .map(|value| value.timer.clone())
            .or_else(|| builder.timer.clone()),
        phase,
        start_event_id: builder.creator_event_id.clone(),
        started_at_ms: builder.started_at_ms,
        end_reason: builder.end_reason,
        end_event_ids: builder.end_event_ids.clone(),
        ended_at_ms: builder.ended_at_ms,
        deadline_events: builder.deadline_events.clone(),
        feedback: builder.feedback.clone(),
        source_event_ids,
        work_ms: evidence_complete
            .then(|| running_work_ms(&builder.block_id, intervals))
            .flatten(),
        intervals: block_intervals,
        complete,
    }
}

fn read_intervals(
    host: &BetaHost,
    session: &crate::Session,
    profile: ProfileId,
    snapshot: &TimeblockSnapshot,
    nodes: &[TimeblockNodeRecord],
    interval_limit: usize,
) -> Result<
    (
        Vec<TimeblockInterval>,
        bool,
        Option<i64>,
        Option<i64>,
        Option<i64>,
    ),
    HostError,
> {
    let from_ms = nodes
        .iter()
        .filter(|node| {
            matches!(
                &node.payload,
                TimeblockPayload::Action {
                    action: TimeblockAction::Start { .. } | TimeblockAction::Rotate { .. }
                }
            )
        })
        .map(|node| node.effective_at_ms)
        .min();
    let Some(from_ms) = from_ms else {
        return Ok((vec![], false, None, None, None));
    };
    if from_ms < 0 {
        return Ok((vec![], false, None, None, None));
    }
    let to_ms = nodes
        .iter()
        .map(|node| node.effective_at_ms)
        .max()
        .unwrap_or(snapshot.clock.server_now_ms)
        .max(snapshot.clock.server_now_ms);
    if to_ms < from_ms {
        return Ok((vec![], false, None, None, None));
    }
    // A zero-length window is a valid zero-work sample at millisecond
    // clock resolution. Do not invent a future boundary.
    if to_ms == from_ms {
        return Ok((vec![], true, Some(from_ms), Some(to_ms), None));
    }
    let page = host.timeblock_intervals(
        session,
        profile,
        &IntervalQuery {
            from_ms,
            to_ms,
            through: Some(snapshot.revision.clone()),
            limit: interval_limit,
        },
    )?;
    let revision_matches = page.revision == snapshot.revision;
    Ok((
        page.items,
        page.complete && revision_matches,
        Some(from_ms),
        Some(to_ms),
        page.next_from_ms,
    ))
}

fn read_recent_timeblocks(
    host: &BetaHost,
    token: &str,
    profile: ProfileId,
    block_limit: usize,
    node_limit: usize,
    interval_limit: usize,
) -> Result<RecentResponse, HostError> {
    let session = host.authenticate(token)?;
    let snapshot = match host.timeblock_snapshot(&session, profile) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            if let Some(reason) = incomplete_reason(&error) {
                return Ok(incomplete_response(
                    profile,
                    None,
                    None,
                    None,
                    block_limit,
                    node_limit,
                    interval_limit,
                    reason,
                ));
            }
            return Err(error);
        }
    };
    let scan = match scan_nodes(host, &session, profile, node_limit) {
        Ok(scan) => scan,
        Err(error) => {
            if let Some(reason) = incomplete_reason(&error) {
                return Ok(incomplete_response(
                    profile,
                    Some(snapshot.revision),
                    None,
                    Some(snapshot.clock.server_now_ms),
                    block_limit,
                    node_limit,
                    interval_limit,
                    reason,
                ));
            }
            return Err(error);
        }
    };
    let mut coverage = RecentCoverage {
        complete: false,
        nodes_complete: scan.complete,
        parent_graph_complete: false,
        intervals_complete: false,
        revision_stable: false,
        node_highwater_stable: scan.stable_highwater,
        causal_order_complete: false,
        clock_uncertain: snapshot.clock.epoch_changed || snapshot.clock.wall_clock_moved_back,
        block_limit,
        nodes_scanned: scan.items.len(),
        node_limit,
        intervals_scanned: 0,
        interval_limit,
        more_available: false,
        next_before: scan.next_before,
        interval_from_ms: None,
        interval_to_ms: None,
        next_interval_from_ms: None,
        reasons: vec![],
    };
    if !scan.complete {
        push_reason(&mut coverage, "node_scan_limit");
    }
    if !coverage.node_highwater_stable {
        push_reason(&mut coverage, "node_highwater_changed");
    }
    if coverage.clock_uncertain {
        push_reason(&mut coverage, "clock_epoch_or_wall_time_changed");
    }
    let order = match causal_order(&scan.items) {
        Ok((order, concurrent)) => {
            coverage.parent_graph_complete = true;
            coverage.causal_order_complete = !concurrent;
            if concurrent {
                push_reason(&mut coverage, "concurrent_parent_branches");
            }
            order
        }
        Err(reason) => {
            push_reason(&mut coverage, reason);
            vec![]
        }
    };
    if !scan.complete {
        coverage.parent_graph_complete = false;
        coverage.causal_order_complete = false;
    }
    let mut builders = if coverage.parent_graph_complete {
        build_block_builders(&scan.items, &order, coverage.causal_order_complete)
    } else {
        HashMap::new()
    };
    if let Some(active) = &snapshot.active {
        let key = active.block_id.to_string();
        if !builders.contains_key(&key) {
            let mut unknown = new_block_builder(&key, 0);
            unknown.complete = false;
            builders.insert(key, unknown);
        }
    }

    let (intervals, intervals_complete, interval_from_ms, interval_to_ms, next_interval_from_ms) =
        if coverage.parent_graph_complete && !scan.items.is_empty() {
            match read_intervals(
                host,
                &session,
                profile,
                &snapshot,
                &scan.items,
                interval_limit,
            ) {
                Ok(result) => result,
                Err(error) => {
                    if let Some(reason) = incomplete_reason(&error) {
                        push_reason(&mut coverage, reason);
                        (vec![], false, None, None, None)
                    } else {
                        return Err(error);
                    }
                }
            }
        } else if scan.items.is_empty() {
            (vec![], true, None, None, None)
        } else {
            (vec![], false, None, None, None)
        };
    coverage.intervals_scanned = intervals.len();
    coverage.intervals_complete = intervals_complete;
    coverage.interval_from_ms = interval_from_ms;
    coverage.interval_to_ms = interval_to_ms;
    coverage.next_interval_from_ms = next_interval_from_ms;
    if !intervals_complete && !scan.items.is_empty() {
        push_reason(&mut coverage, "interval_projection_incomplete");
    }

    let after = match host.timeblock_snapshot(&session, profile) {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            if let Some(reason) = incomplete_reason(&error) {
                push_reason(&mut coverage, reason);
                None
            } else {
                return Err(error);
            }
        }
    };
    apply_revision_fence(
        &mut coverage,
        &snapshot.revision,
        after.as_ref().map(|value| &value.revision),
    );
    coverage.clock_uncertain |= after
        .as_ref()
        .is_some_and(|value| value.clock.epoch_changed || value.clock.wall_clock_moved_back);
    if coverage.clock_uncertain
        && !coverage
            .reasons
            .contains(&"clock_epoch_or_wall_time_changed")
    {
        push_reason(&mut coverage, "clock_epoch_or_wall_time_changed");
    }

    let active_id = snapshot
        .active
        .as_ref()
        .map(|active| active.block_id.to_string());
    if let Some(active) = &snapshot.active {
        let key = active.block_id.to_string();
        let builder = builders
            .entry(key.clone())
            .or_insert_with(|| BlockSummaryBuilder {
                block_id: key,
                complete: false,
                ..BlockSummaryBuilder::default()
            });
        builder.name = Some(active.name.clone());
        builder.note = Some(active.note.clone());
        builder.timer = Some(active.timer.clone());
        builder.phase = Some(phase_name(active.phase));
    }
    let evidence_complete = evidence_complete(&coverage);
    let active = active_id
        .as_ref()
        .and_then(|id| builders.get(id))
        .map(|builder| {
            summarize_block(
                builder,
                snapshot.active.as_ref(),
                &intervals,
                evidence_complete,
            )
        });

    let mut candidates = builders
        .values()
        .filter(|builder| {
            builder.creator_event_id.is_some()
                && active_id.as_deref() != Some(builder.block_id.as_str())
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.creator_order.cmp(&left.creator_order));
    coverage.more_available = candidates.len() > block_limit;
    let recent = candidates
        .into_iter()
        .take(block_limit)
        .map(|builder| summarize_block(builder, None, &intervals, evidence_complete))
        .collect::<Vec<_>>();
    let empty = scan.items.is_empty() && snapshot.active.is_none();
    coverage.complete = evidence_complete
        && active.as_ref().is_none_or(|summary| summary.complete)
        && recent.iter().all(|summary| summary.complete);
    if !coverage.complete && coverage.reasons.is_empty() {
        push_reason(&mut coverage, "summary_fields_unresolved");
    }
    let state = if !coverage.complete {
        "incomplete"
    } else if empty {
        "empty"
    } else if active.is_some() {
        "active"
    } else {
        "complete"
    };
    Ok(RecentResponse {
        profile_id: profile,
        revision: Some(snapshot.revision),
        highwater: scan.highwater,
        as_of_ms: Some(snapshot.clock.server_now_ms),
        state,
        active,
        recent,
        intervals,
        coverage,
    })
}

type ProfilePath = Result<Path<ProfileId>, PathRejection>;
async fn command(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    body: Result<Json<CommandBody>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    let command = TimeblockCommand {
        command_id: body.command_id,
        event_id: body.event_id,
        profile_id: profile,
        expected_revision: body.expected_revision,
        action: body.action,
    };
    Ok(Json(
        work(host, move |host| {
            host.apply_timeblock(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}
async fn current(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
) -> Result<Json<TimeblockSnapshot>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeblock_snapshot(&host.authenticate(&token)?, profile)
        })
        .await?,
    ))
}
async fn nodes(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<ReadQuery>, QueryRejection>,
) -> Result<Json<TimeblockNodePage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeblock_nodes(&host.authenticate(&token)?, profile, &query.query())
        })
        .await?,
    ))
}
async fn timeline(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<ReadQuery>, QueryRejection>,
) -> Result<Json<TimelinePage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeline_page(&host.authenticate(&token)?, profile, &query.query())
        })
        .await?,
    ))
}
async fn timeline_period(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<PeriodReadQuery>, QueryRejection>,
) -> Result<Json<TimelinePage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    let query = query.query();
    Ok(Json(
        work(host, move |host| {
            host.timeline_period_page(&host.authenticate(&token)?, profile, &query)
        })
        .await?,
    ))
}
async fn intervals(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<Intervals>, QueryRejection>,
) -> Result<Json<IntervalPage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    let query = IntervalQuery {
        from_ms: query.from_ms,
        to_ms: query.to_ms,
        through: query.through,
        limit: query.limit.unwrap_or(100),
    };
    Ok(Json(
        work(host, move |host| {
            host.timeblock_intervals(&host.authenticate(&token)?, profile, &query)
        })
        .await?,
    ))
}
async fn recent_summary(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<RecentQuery>, QueryRejection>,
) -> Result<Json<RecentResponse>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    let (block_limit, node_limit, interval_limit) = recent_query_limits(&query)?;
    Ok(Json(
        work(host, move |host| {
            read_recent_timeblocks(
                host,
                &token,
                profile,
                block_limit,
                node_limit,
                interval_limit,
            )
        })
        .await?,
    ))
}
pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new()
        .route(
            "/beta/v1/profiles/:profile/timeblocks/current",
            get(current),
        )
        .route(
            "/beta/v1/profiles/:profile/timeblocks/commands",
            post(command),
        )
        .route("/beta/v1/profiles/:profile/timeblocks/nodes", get(nodes))
        .route(
            "/beta/v1/profiles/:profile/timeblocks/intervals",
            get(intervals),
        )
        .route(
            "/beta/v1/profiles/:profile/timeblocks/recent",
            get(recent_summary),
        )
        .route("/beta/v1/profiles/:profile/timeline", get(timeline))
        .route(
            "/beta/v1/profiles/:profile/timeline/period",
            get(timeline_period),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn revision(fill: char) -> TimeblockRevision {
        serde_json::from_value(serde_json::json!(fill.to_string().repeat(64))).unwrap()
    }

    fn complete_coverage() -> RecentCoverage {
        RecentCoverage {
            complete: true,
            nodes_complete: true,
            parent_graph_complete: true,
            intervals_complete: true,
            revision_stable: true,
            node_highwater_stable: true,
            causal_order_complete: true,
            clock_uncertain: false,
            block_limit: 5,
            nodes_scanned: 2,
            node_limit: 200,
            intervals_scanned: 2,
            interval_limit: 100,
            more_available: false,
            next_before: None,
            interval_from_ms: Some(100),
            interval_to_ms: Some(200),
            next_interval_from_ms: None,
            reasons: vec![],
        }
    }

    fn start_node(event_id: Uuid, parents: &[Uuid], local_seq: u64) -> TimeblockNodeRecord {
        serde_json::from_value(serde_json::json!({
            "event_id": event_id,
            "profile_id": Uuid::new_v4(),
            "device_id": Uuid::new_v4(),
            "source": {
                "kind": "human",
                "author_id": Uuid::new_v4(),
                "owner_generation": null
            },
            "parents": parents,
            "occurred_at_ms": 100,
            "effective_at_ms": 100,
            "clock": {
                "epoch_id": Uuid::new_v4(),
                "elapsed_ms": 100
            },
            "payload": {
                "kind": "action",
                "action": {
                    "kind": "start",
                    "block_id": Uuid::new_v4(),
                    "name": "test",
                    "note": "",
                    "timer": { "mode": "count_up" }
                }
            },
            "digest": "0".repeat(64),
            "local_seq": local_seq
        }))
        .unwrap()
    }

    fn deadline_node(
        start: &TimeblockNodeRecord,
        generation: u64,
        end_mode: &str,
    ) -> TimeblockNodeRecord {
        let block_id = match &start.payload {
            TimeblockPayload::Action {
                action: TimeblockAction::Start { block_id, .. },
            } => *block_id,
            _ => unreachable!(),
        };
        serde_json::from_value(serde_json::json!({
            "event_id": Uuid::new_v4(),
            "profile_id": start.profile_id,
            "device_id": start.device_id,
            "source": {
                "kind": "scheduler",
                "author_id": Uuid::new_v4(),
                "owner_generation": 1
            },
            "parents": [start.event_id],
            "occurred_at_ms": 200,
            "effective_at_ms": 200,
            "clock": start.clock.clone(),
            "payload": {
                "kind": "deadline_reached",
                "block_id": block_id,
                "deadline_id": Uuid::new_v4(),
                "generation": generation,
                "end_mode": end_mode,
                "due_wall_ms": 200,
                "due_elapsed_ms": 200,
                "clock_epoch": start.clock.epoch_id
            },
            "digest": "0".repeat(64),
            "local_seq": start.local_seq + 1
        }))
        .unwrap()
    }

    #[test]
    fn projection_revision_drift_prevents_complete_evidence() {
        let before = revision('a');
        let after = revision('b');
        let mut coverage = complete_coverage();

        apply_revision_fence(&mut coverage, &before, Some(&after));

        assert!(!coverage.revision_stable);
        assert!(!evidence_complete(&coverage));
        assert!(coverage.reasons.contains(&"revision_changed_during_read"));
    }

    #[test]
    fn local_node_highwater_is_a_separate_completeness_axis() {
        let same_revision = revision('a');
        let mut coverage = complete_coverage();
        coverage.node_highwater_stable = false;

        apply_revision_fence(&mut coverage, &same_revision, Some(&same_revision));

        assert!(coverage.revision_stable);
        assert!(!coverage.node_highwater_stable);
        assert!(!evidence_complete(&coverage));
    }

    #[test]
    fn causal_order_rejects_missing_parents_and_flags_concurrent_roots() {
        let missing_parent = Uuid::new_v4();
        let orphan = start_node(Uuid::new_v4(), &[missing_parent], 1);
        assert_eq!(causal_order(&[orphan]), Err("missing_parent"));

        let left = start_node(Uuid::new_v4(), &[], 1);
        let right = start_node(Uuid::new_v4(), &[], 2);
        let (_, concurrent) = causal_order(&[left, right]).unwrap();
        assert!(concurrent);
    }

    #[test]
    fn deadline_summary_requires_a_matching_running_generation() {
        let start = start_node(Uuid::new_v4(), &[], 1);
        let stale_hard = deadline_node(&start, 99, "hard");
        let mut nodes = vec![start.clone(), stale_hard];
        let (order, concurrent) = causal_order(&nodes).unwrap();
        assert!(!concurrent);
        let builders = build_block_builders(&nodes, &order, !concurrent);
        let block_id = match &start.payload {
            TimeblockPayload::Action {
                action: TimeblockAction::Start { block_id, .. },
            } => block_id.to_string(),
            _ => unreachable!(),
        };
        let stale = builders.get(&block_id).unwrap();
        assert_eq!(stale.end_reason, None);
        assert_eq!(stale.deadline_events[0].outcome, "superseded");

        nodes[1] = deadline_node(&start, 1, "hard");
        let (order, concurrent) = causal_order(&nodes).unwrap();
        let builders = build_block_builders(&nodes, &order, !concurrent);
        let applied = builders.get(&block_id).unwrap();
        assert_eq!(applied.end_reason, Some("hard_deadline"));
        assert_eq!(applied.phase, Some("feedback_pending"));
        assert_eq!(applied.deadline_events[0].outcome, "applied_hard");

        let builders = build_block_builders(&nodes, &order, false);
        assert_eq!(builders.get(&block_id).unwrap().end_reason, None);
        assert_eq!(
            builders.get(&block_id).unwrap().deadline_events[0].outcome,
            "unknown"
        );

        nodes[1] = deadline_node(&start, 1, "soft");
        let (order, concurrent) = causal_order(&nodes).unwrap();
        let builders = build_block_builders(&nodes, &order, !concurrent);
        let soft = builders.get(&block_id).unwrap();
        assert_eq!(soft.end_reason, None);
        assert_eq!(soft.phase, Some("running"));
        assert_eq!(soft.deadline_events[0].outcome, "applied_soft");
    }
}
