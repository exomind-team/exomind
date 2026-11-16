use super::{facts, model::*};
use crate::{CoreError, DeviceId, EventId, ProfileId};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
pub(super) struct Ownership {
    pub device: DeviceId,
    pub generation: u64,
    pub token: EventId,
    pub run: SummaryRunId,
    pub run_generation: u64,
    pub selection: SummarySelection,
    pub supersedes: Option<EventId>,
    pub cancelled: bool,
    pub conflicts: Vec<EventId>,
}
pub(super) struct Task {
    pub view: SummaryTaskView,
    pub owner: Ownership,
    pub artifact_kind: SummaryArtifactKind,
    pub full_heads: Vec<EventId>,
    pub max_attempts: u32,
    pub role_config_digest: Option<String>,
}
pub(super) fn load_jobs(
    c: &Connection,
    p: ProfileId,
    task: SummaryTaskId,
) -> Result<Vec<SummaryJobRecord>, CoreError> {
    let mut q=c.prepare("SELECT e.body,e.local_seq FROM summary_nodes s JOIN events e ON e.event_id=s.event_id WHERE s.profile_id=?1 AND s.task_id=?2 AND s.kind='summary_job/1' ORDER BY e.local_seq LIMIT 513")?;
    let rows = q.query_map(params![p.to_string(), task.to_string()], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?))
    })?;
    let mut jobs = vec![];
    for row in rows {
        let (body, seq) = row?;
        let mut value: SummaryJobRecord = serde_json::from_str(&body)?;
        if value.profile_id != p || value.task_id != task {
            return Err(CoreError::RecoveryRequired);
        }
        value.validate()?;
        value.local_seq = seq;
        jobs.push(value);
    }
    if jobs.len() > 512 {
        return Err(CoreError::SummaryBlocked("history_limit"));
    }
    Ok(jobs)
}
pub(super) fn artifact(
    c: &Connection,
    p: ProfileId,
    id: EventId,
) -> Result<Option<SummaryArtifactRecord>, CoreError> {
    let row:Option<(String,u64)>=c.query_row("SELECT body,local_seq FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='summary/1'",params![p.to_string(),id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    row.map(|(body, seq)| {
        let mut value: SummaryArtifactRecord = serde_json::from_str(&body)?;
        if value.profile_id != p || value.event_id != id {
            return Err(CoreError::RecoveryRequired);
        }
        value.validate()?;
        value.local_seq = seq;
        Ok(value)
    })
    .transpose()
}
fn key(node: &SummaryJobRecord) -> (String, String) {
    (node.device_id.to_string(), node.event_id.to_string())
}
fn graph(
    jobs: &[SummaryJobRecord],
) -> (Vec<usize>, HashMap<EventId, HashSet<EventId>>, Vec<EventId>) {
    let known = jobs.iter().map(|n| n.event_id).collect::<HashSet<_>>();
    let mut missing = jobs
        .iter()
        .flat_map(|n| n.parents.iter().copied())
        .filter(|id| !known.contains(id))
        .collect::<Vec<_>>();
    missing.sort_by_key(ToString::to_string);
    missing.dedup();
    let mut remaining = (0..jobs.len()).collect::<Vec<_>>();
    let mut ordered = vec![];
    let mut past = HashMap::<EventId, HashSet<EventId>>::new();
    while !remaining.is_empty() {
        let next = remaining
            .iter()
            .copied()
            .filter(|i| jobs[*i].parents.iter().all(|id| past.contains_key(id)))
            .min_by_key(|i| key(&jobs[*i]));
        let Some(i) = next else {
            missing.extend(remaining.iter().map(|i| jobs[*i].event_id));
            break;
        };
        remaining.retain(|j| *j != i);
        let mut ancestors = HashSet::new();
        for parent in &jobs[i].parents {
            ancestors.insert(*parent);
            ancestors.extend(past[parent].iter().copied());
        }
        past.insert(jobs[i].event_id, ancestors);
        ordered.push(i);
    }
    (ordered, past, missing)
}
fn maximal_controls<'a>(
    jobs: &'a [SummaryJobRecord],
    past: &HashMap<EventId, HashSet<EventId>>,
    set: &HashSet<EventId>,
) -> Vec<&'a SummaryJobRecord> {
    let controls = jobs
        .iter()
        .filter(|n| {
            set.contains(&n.event_id) && matches!(n.payload, SummaryJobPayload::Controlled { .. })
        })
        .collect::<Vec<_>>();
    let mut heads = controls
        .iter()
        .copied()
        .filter(|node| {
            !controls.iter().any(|other| {
                other.event_id != node.event_id
                    && past
                        .get(&other.event_id)
                        .is_some_and(|p| p.contains(&node.event_id))
            })
        })
        .collect::<Vec<_>>();
    heads.sort_by_key(|node| key(node));
    heads
}
fn ownership(
    jobs: &[SummaryJobRecord],
    past: &HashMap<EventId, HashSet<EventId>>,
    set: &HashSet<EventId>,
    initial: &Ownership,
    depth: usize,
) -> Ownership {
    if depth > 512 {
        let mut out = initial.clone();
        out.conflicts = set.iter().copied().collect();
        return out;
    }
    let heads = maximal_controls(jobs, past, set);
    if heads.is_empty() {
        return initial.clone();
    }
    if heads.len() > 1 {
        let mut values = heads
            .iter()
            .map(|head| {
                let mut subset = past.get(&head.event_id).cloned().unwrap_or_default();
                subset.insert(head.event_id);
                ownership(jobs, past, &subset, initial, depth + 1)
            })
            .collect::<Vec<_>>();
        values.sort_by_key(|value| (value.generation, value.token.to_string()));
        let mut out = values.last().unwrap().clone();
        out.cancelled = values.iter().any(|v| v.cancelled);
        out.conflicts = heads.iter().map(|n| n.event_id).collect();
        return out;
    }
    let node = heads[0];
    let empty = HashSet::new();
    let ancestors = past.get(&node.event_id).unwrap_or(&empty);
    let mut out = ownership(jobs, past, ancestors, initial, depth + 1);
    let SummaryJobPayload::Controlled {
        expected_owner_generation,
        expected_owner_control_event_id,
        action,
    } = &node.payload
    else {
        unreachable!()
    };
    if *expected_owner_generation != out.generation
        || *expected_owner_control_event_id != out.token
        || (!out.conflicts.is_empty()
            && !matches!(action, SummaryControlAction::ResolveOwner { .. }))
    {
        out.conflicts.push(node.event_id);
        out.conflicts.sort_by_key(ToString::to_string);
        out.conflicts.dedup();
        return out;
    }
    let previous_cancelled = out.cancelled;
    match action {
        SummaryControlAction::Cancel => out.cancelled = true,
        SummaryControlAction::TakeOverForSelf {
            run_id,
            resume_cancelled,
        } => {
            if previous_cancelled && !*resume_cancelled {
                out.conflicts.push(node.event_id);
                return out;
            }
            out.device = node.device_id;
            out.run = *run_id;
            out.run_generation = out.run_generation.saturating_add(1);
            out.cancelled = false;
        }
        SummaryControlAction::ResolveOwner {
            run_id,
            owner_device_id,
            resume_cancelled,
        } => {
            if previous_cancelled && !*resume_cancelled {
                out.conflicts.push(node.event_id);
                return out;
            }
            out.device = *owner_device_id;
            out.run = *run_id;
            out.run_generation = out.run_generation.saturating_add(1);
            out.cancelled = false;
            out.conflicts.clear();
        }
        SummaryControlAction::QueueUpdate {
            run_id,
            selection,
            supersedes_artifact_id,
        } => {
            if previous_cancelled {
                out.conflicts.push(node.event_id);
                return out;
            }
            out.run = *run_id;
            out.run_generation = out.run_generation.saturating_add(1);
            out.selection = selection.clone();
            out.supersedes = *supersedes_artifact_id;
        }
    }
    out.generation = out.generation.saturating_add(1);
    out.token = node.event_id;
    out
}
pub(super) fn load(c: &Connection, p: ProfileId, id: SummaryTaskId) -> Result<Task, CoreError> {
    let jobs = load_jobs(c, p, id)?;
    let request = jobs
        .iter()
        .filter(|n| matches!(n.payload, SummaryJobPayload::Requested { .. }))
        .min_by_key(|n| key(n))
        .ok_or(CoreError::UnknownSummaryTask)?;
    let SummaryJobPayload::Requested {
        trigger_key,
        creator_event_id,
        default_owner_device_id,
        selection,
        purpose,
        artifact_kind,
        initial_run_id,
    } = &request.payload
    else {
        unreachable!()
    };
    let mut conflicts = vec![];
    for node in &jobs {
        if let SummaryJobPayload::Requested {
            trigger_key: other,
            creator_event_id: creator,
            default_owner_device_id: owner,
            purpose: other_purpose,
            initial_run_id: run,
            artifact_kind: kind,
            ..
        } = &node.payload
        {
            if other != trigger_key
                || creator != creator_event_id
                || owner != default_owner_device_id
                || other_purpose != purpose
                || run != initial_run_id
                || kind != artifact_kind
            {
                conflicts.push(node.event_id);
            }
        }
    }
    let initial = Ownership {
        device: *default_owner_device_id,
        generation: 1,
        token: *creator_event_id,
        run: *initial_run_id,
        run_generation: 1,
        selection: selection.clone(),
        supersedes: None,
        cancelled: false,
        conflicts: vec![],
    };
    let (ordered, past, missing) = graph(&jobs);
    let all = jobs.iter().map(|n| n.event_id).collect::<HashSet<_>>();
    let mut owner = ownership(&jobs, &past, &all, &initial, 0);
    owner.conflicts.extend(conflicts);
    owner.conflicts.sort_by_key(ToString::to_string);
    owner.conflicts.dedup();
    let control_heads = maximal_controls(&jobs, &past, &all)
        .iter()
        .map(|n| n.event_id)
        .collect::<Vec<_>>();
    let referenced = jobs
        .iter()
        .flat_map(|n| n.parents.iter().copied())
        .collect::<HashSet<_>>();
    let mut full_heads = jobs
        .iter()
        .filter(|n| !referenced.contains(&n.event_id))
        .map(|n| n.event_id)
        .collect::<Vec<_>>();
    full_heads.sort_by_key(ToString::to_string);
    let mut state = SummaryState::Queued;
    let mut reason = None;
    let mut run = SummaryRunView {
        run_id: owner.run,
        run_generation: owner.run_generation,
        owner_generation: owner.generation,
        snapshot: None,
        attempt: None,
    };
    let mut latest = None;
    let mut max_attempts = MAX_SUMMARY_ATTEMPTS;
    let mut role_config_digest = None;
    let execution_nodes=jobs.iter().filter(|node|node.device_id==owner.device&&matches!(&node.payload,SummaryJobPayload::Execution{run_id,owner_generation,owner_control_event_id,..}if *run_id==owner.run&&*owner_generation==owner.generation&&*owner_control_event_id==owner.token)).collect::<Vec<_>>();
    for (i, left) in execution_nodes.iter().enumerate() {
        for right in execution_nodes.iter().skip(i + 1) {
            if !past
                .get(&left.event_id)
                .is_some_and(|set| set.contains(&right.event_id))
                && !past
                    .get(&right.event_id)
                    .is_some_and(|set| set.contains(&left.event_id))
            {
                owner.conflicts.push(left.event_id);
                owner.conflicts.push(right.event_id);
            }
        }
    }
    for i in ordered {
        let node = &jobs[i];
        match &node.payload {
            SummaryJobPayload::Execution {
                run_id,
                owner_generation,
                owner_control_event_id,
                state: status,
                reason: why,
                attempt_id,
                attempt_number,
                retry_at_ms,
                snapshot,
                role_config_digest: config,
                max_attempts: budget,
            } if *run_id == owner.run
                && *owner_generation == owner.generation
                && *owner_control_event_id == owner.token
                && node.device_id == owner.device =>
            {
                let qualified = ownership(
                    &jobs,
                    &past,
                    past.get(&node.event_id).unwrap_or(&HashSet::new()),
                    &initial,
                    0,
                );
                if qualified.device != node.device_id
                    || qualified.token != *owner_control_event_id
                    || qualified.generation != *owner_generation
                    || qualified.run != *run_id
                    || qualified.cancelled
                    || !qualified.conflicts.is_empty()
                {
                    owner.conflicts.push(node.event_id);
                    continue;
                }
                if let (Some(previous), Some(next)) = (&run.snapshot, snapshot) {
                    if previous.digest != next.digest {
                        owner.conflicts.push(node.event_id);
                        continue;
                    }
                }
                state = *status;
                reason = why.clone();
                if let Some(snapshot) = snapshot {
                    run.snapshot = Some(snapshot.clone());
                }
                if let Some(attempt_id) = attempt_id {
                    run.attempt = Some(SummaryAttemptView {
                        attempt_id: *attempt_id,
                        number: *attempt_number,
                        state: *status,
                        reason: why.clone(),
                        retry_at_ms: *retry_at_ms,
                    });
                }
                max_attempts = *budget;
                role_config_digest = config.clone();
            }
            SummaryJobPayload::Published {
                run_id,
                attempt_id,
                owner_generation,
                owner_control_event_id,
                artifact_event_id,
            } => {
                let before = ownership(
                    &jobs,
                    &past,
                    past.get(&node.event_id).unwrap_or(&HashSet::new()),
                    &initial,
                    0,
                );
                if before.device != node.device_id
                    || before.generation != *owner_generation
                    || before.token != *owner_control_event_id
                    || before.run != *run_id
                    || before.cancelled
                    || !before.conflicts.is_empty()
                {
                    continue;
                }
                let Some(artifact) = artifact(c, p, *artifact_event_id)? else {
                    continue;
                };
                if artifact.task_id != id
                    || artifact.artifact_kind != *artifact_kind
                    || artifact.run_id != *run_id
                    || artifact.attempt_id != *attempt_id
                    || artifact.owner_generation != *owner_generation
                    || artifact.owner_control_event_id != *owner_control_event_id
                    || artifact.device_id != node.device_id
                {
                    continue;
                }
                let qualified_start=jobs.iter().any(|start|past.get(&node.event_id).is_some_and(|set|set.contains(&start.event_id))&&start.device_id==node.device_id&&matches!(&start.payload,SummaryJobPayload::Execution{run_id:run,owner_generation:claimed_owner_generation,owner_control_event_id:control,state:SummaryState::Running,attempt_id:Some(attempt),snapshot:Some(source),role_config_digest:Some(config),..}if run==run_id&&claimed_owner_generation==owner_generation&&control==owner_control_event_id&&attempt==attempt_id&&source.digest==artifact.snapshot.digest&&config==&artifact.output.model.role_config_digest));
                let failed_before=jobs.iter().any(|failure|past.get(&node.event_id).is_some_and(|set|set.contains(&failure.event_id))&&matches!(&failure.payload,SummaryJobPayload::Execution{attempt_id:Some(attempt),state:SummaryState::Failed|SummaryState::RetryWait,..}if attempt==attempt_id));
                if !qualified_start || failed_before {
                    continue;
                }
                let concurrent = jobs
                    .iter()
                    .filter(|n| matches!(n.payload, SummaryJobPayload::Controlled { .. }))
                    .any(|control| {
                        !past
                            .get(&node.event_id)
                            .is_some_and(|p| p.contains(&control.event_id))
                            && !past
                                .get(&control.event_id)
                                .is_some_and(|p| p.contains(&node.event_id))
                    });
                if !concurrent {
                    latest = Some(*artifact_event_id);
                }
                if *run_id == owner.run
                    && *owner_generation == owner.generation
                    && *owner_control_event_id == owner.token
                {
                    state = SummaryState::Succeeded;
                    reason = None;
                    run.snapshot = Some(artifact.snapshot);
                    if let Some(attempt) = &mut run.attempt {
                        attempt.state = state;
                    }
                }
            }
            _ => {}
        }
    }
    if owner.cancelled {
        state = SummaryState::Cancelled;
        reason = Some("cancelled".into());
    }
    if !owner.conflicts.is_empty() {
        owner.conflicts.sort_by_key(ToString::to_string);
        owner.conflicts.dedup();
        state = if owner.cancelled {
            SummaryState::Cancelled
        } else {
            SummaryState::Failed
        };
        reason = Some("owner_conflict".into());
    }
    if !missing.is_empty() {
        state = SummaryState::Failed;
        reason = Some("missing_parents".into());
        owner.conflicts.extend(missing);
    }
    // The immutable creator, not the last end/feedback sender, owns first work.
    if *purpose == SummaryPurpose::FirstReviewV1 {
        let anchor = crate::timeblocks::summary_anchor(c, p, selection.block_ids[0]);
        if !matches!(anchor,Ok(ref a)if a.creator_event_id==*creator_event_id&&a.creator_device_id==*default_owner_device_id&&a.eligible&&super::first_id(p,selection.block_ids[0])==id)
        {
            state = SummaryState::Failed;
            reason = Some("trigger_incomplete".into());
        }
    }
    if owner.generation > MAX_SUMMARY_SAFE_COUNTER
        || owner.run_generation > MAX_SUMMARY_SAFE_COUNTER
    {
        return Err(facts::invalid("safe owner counter"));
    }
    let view = SummaryTaskView {
        task_id: id,
        profile_id: p,
        purpose: *purpose,
        artifact_kind: *artifact_kind,
        selection: owner.selection.clone(),
        created_at_ms: request.occurred_at_ms,
        trigger_key: trigger_key.clone(),
        creator_event_id: *creator_event_id,
        owner_device_id: owner.device,
        owner_generation: owner.generation,
        owner_control_event_id: owner.token,
        current_run: Some(run),
        state,
        reason,
        control_heads,
        conflicts: owner.conflicts.clone(),
        latest_artifact_id: latest,
        coverage_changed: false,
    };
    Ok(Task {
        view,
        owner,
        artifact_kind: *artifact_kind,
        full_heads,
        max_attempts,
        role_config_digest,
    })
}
