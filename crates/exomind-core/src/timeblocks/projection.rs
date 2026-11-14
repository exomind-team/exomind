use super::model::*;
use crate::{CoreError, EventId, ProfileId, TimeblockId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

pub(super) const MAX_NOTE_BYTES: usize = 128 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Point {
    pub wall_ms: i64,
    pub clock: NodeClock,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Block {
    pub spec: StartBlockSpec,
    pub phase: TimeblockPhase,
    pub work_ms: u64,
    pub run_anchor: Option<Point>,
    pub last_clock: Point,
    pub deadline_reached: bool,
    pub generation: u64,
    pub pending_feedback: bool,
}
impl Block {
    pub fn work_at(&self, point: &Point) -> u64 {
        self.work_ms.saturating_add(
            self.run_anchor
                .as_ref()
                .map(|anchor| {
                    if anchor.clock.epoch_id == point.clock.epoch_id {
                        point
                            .clock
                            .elapsed_ms
                            .saturating_sub(anchor.clock.elapsed_ms)
                    } else {
                        point.wall_ms.saturating_sub(anchor.wall_ms).max(0) as u64
                    }
                })
                .unwrap_or(0),
        )
    }
    fn freeze(&mut self, point: &Point) {
        self.work_ms = self.work_at(point);
        self.run_anchor = None;
        self.last_clock = point.clone();
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct State {
    pub heads: Vec<EventId>,
    pub active: Option<TimeblockId>,
    pub blocks: BTreeMap<String, Block>,
    pub last_boundary: i64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            heads: vec![],
            active: None,
            blocks: BTreeMap::new(),
            last_boundary: 0,
        }
    }
}
pub(super) fn revision(heads: &[EventId]) -> TimeblockRevision {
    let mut names: Vec<_> = heads.iter().map(ToString::to_string).collect();
    names.sort();
    TimeblockRevision(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&names).expect("strings serialize"))
    ))
}
pub(super) fn validate_spec(spec: &StartBlockSpec) -> Result<(), CoreError> {
    if spec.name.trim().is_empty() || spec.name.len() > 1024 || spec.note.len() > MAX_NOTE_BYTES {
        return Err(CoreError::InvalidTimeblock("name or note outside bounds"));
    }
    if let TimerSpec::CountDown { duration_ms, .. } = spec.timer {
        if duration_ms == 0 || duration_ms > 365 * 24 * 60 * 60 * 1000u64 {
            return Err(CoreError::InvalidTimeblock("duration outside bounds"));
        }
    }
    Ok(())
}
impl State {
    pub fn revision(&self) -> TimeblockRevision {
        revision(&self.heads)
    }
    pub fn validate(&self, action: &TimeblockAction) -> Result<(), CoreError> {
        match action {
            TimeblockAction::Start {
                block_id,
                name,
                note,
                timer,
            } => {
                validate_spec(&StartBlockSpec {
                    block_id: *block_id,
                    name: name.clone(),
                    note: note.clone(),
                    timer: timer.clone(),
                })?;
                if self.active.is_some() || self.blocks.contains_key(&block_id.to_string()) {
                    return Err(CoreError::TimeblockConflict);
                }
            }
            TimeblockAction::Rotate {
                from_block_id,
                next,
            } => {
                validate_spec(next)?;
                if self.active != Some(*from_block_id)
                    || self.blocks.contains_key(&next.block_id.to_string())
                {
                    return Err(CoreError::TimeblockConflict);
                }
            }
            TimeblockAction::Pause { block_id }
            | TimeblockAction::Resume { block_id }
            | TimeblockAction::EndAction { block_id } => {
                if self.active != Some(*block_id) {
                    return Err(CoreError::TimeblockConflict);
                }
                let block = self
                    .blocks
                    .get(&block_id.to_string())
                    .ok_or(CoreError::TimeblockConflict)?;
                let allowed = match action {
                    TimeblockAction::Pause { .. } => block.phase == TimeblockPhase::Running,
                    TimeblockAction::Resume { .. } => block.phase == TimeblockPhase::Paused,
                    _ => matches!(
                        block.phase,
                        TimeblockPhase::Running | TimeblockPhase::Paused
                    ),
                };
                if !allowed {
                    return Err(CoreError::TimeblockConflict);
                }
            }
            TimeblockAction::SubmitFeedback { block_id, feedback } => {
                if !self
                    .blocks
                    .get(&block_id.to_string())
                    .is_some_and(|block| block.pending_feedback)
                {
                    return Err(CoreError::TimeblockConflict);
                }
                if let FeedbackInput::Text { text } = feedback {
                    validate_feedback(text)?;
                }
            }
            TimeblockAction::AppendFeedback { block_id, text } => {
                if !self.blocks.contains_key(&block_id.to_string()) {
                    return Err(CoreError::TimeblockConflict);
                }
                validate_feedback(text)?;
            }
        }
        Ok(())
    }
    fn begin(&mut self, spec: StartBlockSpec, point: &Point) {
        self.active = Some(spec.block_id);
        self.blocks.insert(
            spec.block_id.to_string(),
            Block {
                spec,
                phase: TimeblockPhase::Running,
                work_ms: 0,
                run_anchor: Some(point.clone()),
                last_clock: point.clone(),
                deadline_reached: false,
                generation: 1,
                pending_feedback: false,
            },
        );
    }
    fn end(&mut self, id: TimeblockId, point: &Point) -> Result<(), CoreError> {
        let block = self
            .blocks
            .get_mut(&id.to_string())
            .ok_or(CoreError::InvalidTimeblockHistory)?;
        block.freeze(point);
        block.phase = TimeblockPhase::FeedbackPending;
        block.pending_feedback = true;
        block.generation = block.generation.saturating_add(1);
        Ok(())
    }
    pub fn apply(
        &mut self,
        node: &TimeblockNodeRecord,
        conflicts: &mut Vec<String>,
    ) -> Result<Option<TimeblockInterval>, CoreError> {
        let boundary = node.effective_at_ms.max(self.last_boundary);
        if node.effective_at_ms < self.last_boundary {
            conflicts.push(format!("effective boundary clamped for {}", node.event_id));
        }
        self.last_boundary = boundary;
        let point = Point {
            wall_ms: node.occurred_at_ms,
            clock: node.clock.clone(),
        };
        let mut lane = None;
        match &node.payload {
            TimeblockPayload::Action { action } => {
                if node.source.kind != TimeblockSourceKind::Human {
                    return Err(CoreError::InvalidTimeblockHistory);
                }
                match action {
                    TimeblockAction::Start {
                        block_id,
                        name,
                        note,
                        timer,
                    } => {
                        let spec = StartBlockSpec {
                            block_id: *block_id,
                            name: name.clone(),
                            note: note.clone(),
                            timer: timer.clone(),
                        };
                        validate_spec(&spec)?;
                        if self.active.is_some() {
                            conflicts.push(format!("concurrent start retained: {}", node.event_id));
                        }
                        self.begin(spec, &point);
                        lane = Some((IntervalKind::Running, Some(*block_id)));
                    }
                    TimeblockAction::Rotate {
                        from_block_id,
                        next,
                    } => {
                        validate_spec(next)?;
                        self.end(*from_block_id, &point)?;
                        self.begin(next.clone(), &point);
                        lane = Some((IntervalKind::Running, Some(next.block_id)));
                    }
                    TimeblockAction::Pause { block_id } => {
                        let block = self
                            .blocks
                            .get_mut(&block_id.to_string())
                            .ok_or(CoreError::InvalidTimeblockHistory)?;
                        block.freeze(&point);
                        block.phase = TimeblockPhase::Paused;
                        block.generation = block.generation.saturating_add(1);
                        if self.active == Some(*block_id) {
                            lane = Some((IntervalKind::Paused, Some(*block_id)));
                        }
                    }
                    TimeblockAction::Resume { block_id } => {
                        let block = self
                            .blocks
                            .get_mut(&block_id.to_string())
                            .ok_or(CoreError::InvalidTimeblockHistory)?;
                        block.freeze(&point);
                        block.run_anchor = Some(point.clone());
                        block.phase = TimeblockPhase::Running;
                        block.generation = block.generation.saturating_add(1);
                        if self.active == Some(*block_id) {
                            lane = Some((IntervalKind::Running, Some(*block_id)));
                        }
                    }
                    TimeblockAction::EndAction { block_id } => {
                        self.end(*block_id, &point)?;
                        if self.active == Some(*block_id) {
                            lane = Some((IntervalKind::Feedback, Some(*block_id)));
                        }
                    }
                    TimeblockAction::SubmitFeedback { block_id, feedback } => {
                        if let FeedbackInput::Text { text } = feedback {
                            validate_feedback(text)?;
                        }
                        let block = self
                            .blocks
                            .get_mut(&block_id.to_string())
                            .ok_or(CoreError::InvalidTimeblockHistory)?;
                        block.freeze(&point);
                        block.phase = TimeblockPhase::Completed;
                        block.pending_feedback = false;
                        block.generation = block.generation.saturating_add(1);
                        if self.active == Some(*block_id) {
                            self.active = None;
                            lane = Some((IntervalKind::Gap, None));
                        }
                    }
                    TimeblockAction::AppendFeedback { block_id, text } => {
                        validate_feedback(text)?;
                        if !self.blocks.contains_key(&block_id.to_string()) {
                            return Err(CoreError::InvalidTimeblockHistory);
                        }
                    }
                }
            }
            TimeblockPayload::DeadlineReached {
                block_id,
                generation,
                end_mode,
                due_wall_ms,
                due_elapsed_ms,
                clock_epoch,
                ..
            } => {
                if node.source.kind != TimeblockSourceKind::Scheduler {
                    return Err(CoreError::InvalidTimeblockHistory);
                }
                let block = self
                    .blocks
                    .get_mut(&block_id.to_string())
                    .ok_or(CoreError::InvalidTimeblockHistory)?;
                if block.generation != *generation || block.phase != TimeblockPhase::Running {
                    conflicts.push(format!("superseded deadline retained: {}", node.event_id));
                } else {
                    block.deadline_reached = true;
                    if *end_mode == CountdownEndMode::Hard {
                        let due = Point {
                            wall_ms: *due_wall_ms,
                            clock: NodeClock {
                                epoch_id: *clock_epoch,
                                elapsed_ms: *due_elapsed_ms,
                            },
                        };
                        block.freeze(&due);
                        block.phase = TimeblockPhase::FeedbackPending;
                        block.pending_feedback = true;
                        block.generation = block.generation.saturating_add(1);
                        if self.active == Some(*block_id) {
                            lane = Some((IntervalKind::Feedback, Some(*block_id)));
                        }
                    }
                }
            }
        }
        self.heads.retain(|id| !node.parents.contains(id));
        self.heads.push(node.event_id);
        self.heads.sort_by_key(ToString::to_string);
        self.heads.dedup();
        Ok(lane.map(|(kind, block_id)| TimeblockInterval {
            from_ms: boundary,
            to_ms: boundary,
            kind,
            block_id,
            source_event_ids: vec![node.event_id],
        }))
    }
}
fn validate_feedback(text: &str) -> Result<(), CoreError> {
    if text.trim().is_empty() || text.len() > MAX_NOTE_BYTES {
        Err(CoreError::InvalidTimeblock("feedback outside bounds"))
    } else {
        Ok(())
    }
}
pub(super) fn ordered(
    nodes: &[TimeblockNodeRecord],
    profile: ProfileId,
) -> Result<Vec<TimeblockNodeRecord>, CoreError> {
    let mut remaining = BTreeMap::new();
    let mut identifiers = HashSet::new();
    for node in nodes {
        if node.profile_id != profile || node.parents.contains(&node.event_id) {
            return Err(CoreError::InvalidTimeblockHistory);
        }
        if super::store::node_digest(node)? != node.digest {
            return Err(CoreError::InvalidTimeblockHistory);
        }
        if !identifiers.insert(node.event_id) {
            return Err(CoreError::InvalidTimeblockHistory);
        }
        remaining.insert(
            (node.device_id.to_string(), node.event_id.to_string()),
            node.clone(),
        );
    }
    if nodes
        .iter()
        .any(|node| node.parents.iter().any(|id| !identifiers.contains(id)))
    {
        return Err(CoreError::InvalidTimeblockHistory);
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    while !remaining.is_empty() {
        let key = remaining
            .iter()
            .find(|(_, node)| node.parents.iter().all(|id| seen.contains(id)))
            .map(|(key, _)| key.clone())
            .ok_or(CoreError::InvalidTimeblockHistory)?;
        let node = remaining.remove(&key).expect("selected key exists");
        seen.insert(node.event_id);
        result.push(node);
    }
    Ok(result)
}
pub fn project_timeblocks(
    profile: ProfileId,
    nodes: &[TimeblockNodeRecord],
    query: &ProjectionQuery,
) -> Result<TimeblockProjection, CoreError> {
    if query.from_ms < 0 || query.to_ms <= query.from_ms {
        return Err(CoreError::InvalidQuery("interval window"));
    }
    let mut state = State::default();
    let mut conflicts = vec![];
    let mut retained = vec![];
    let mut changes = vec![];
    for node in ordered(nodes, profile)? {
        retained.push(node.event_id);
        if let Some(lane) = state.apply(&node, &mut conflicts)? {
            changes.push(lane);
        }
    }
    let mut intervals = vec![];
    let mut cursor = query.from_ms;
    let mut kind = IntervalKind::Gap;
    let mut block = None;
    let mut sources = vec![];
    for lane in changes {
        if lane.from_ms <= query.from_ms {
            kind = lane.kind;
            block = lane.block_id;
            sources = lane.source_event_ids;
            continue;
        }
        if lane.from_ms >= query.to_ms {
            break;
        }
        if lane.from_ms > cursor {
            intervals.push(TimeblockInterval {
                from_ms: cursor,
                to_ms: lane.from_ms,
                kind,
                block_id: block,
                source_event_ids: sources,
            });
        }
        cursor = lane.from_ms;
        kind = lane.kind;
        block = lane.block_id;
        sources = lane.source_event_ids;
    }
    if cursor < query.to_ms {
        intervals.push(TimeblockInterval {
            from_ms: cursor,
            to_ms: query.to_ms,
            kind,
            block_id: block,
            source_event_ids: sources,
        });
    }
    Ok(TimeblockProjection {
        active_block_id: state.active,
        heads: state.heads,
        retained_event_ids: retained,
        conflicts,
        intervals,
    })
}
