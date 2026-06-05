use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::warn;

use crate::eventlog::{EventLogStore, EventRecord};
use crate::proposal::{Proposal, ProposalStore};
use crate::signal::{SignalEvent, SignalPool};
use crate::timeblock::BlockPhase;
use crate::task::store::{
    compare_task_replication_preference, merge_task_snapshot, merge_task_status_history,
    normalize_task_status_history, validate_partial_task_status_history,
};
use crate::task::{Task, TaskStore};
use crate::timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStore};

const EVENTLOG_REPLICATION_TOPIC: &str = "eventlog.replication.appended";
const TASK_REPLICATION_TOPIC: &str = "task.replication.upserted";
const TIMEBLOCK_ACTIVE_REPLICATION_TOPIC: &str = "timeblock.replication.active_upserted";
const TIMEBLOCK_COMPLETED_REPLICATION_TOPIC: &str = "timeblock.replication.completed";
const PROPOSAL_REPLICATION_TOPIC: &str = "proposal.replication.upserted";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventlogReplicationPayload {
    #[serde(default)]
    scope_key: Option<String>,
    #[serde(default)]
    record: Option<EventRecord>,
    #[serde(default)]
    event: Option<EventlogLegacyRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventlogLegacyRecord {
    id: String,
    content: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskReplicationPayload {
    #[serde(default)]
    scope_key: Option<String>,
    task: Task,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeblockActiveReplicationPayload {
    #[serde(default)]
    scope_key: Option<String>,
    active: ActiveBlockData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeblockCompletedReplicationPayload {
    #[serde(default)]
    scope_key: Option<String>,
    block: TimeBlockData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposalReplicationPayload {
    #[serde(default)]
    scope_key: Option<String>,
    proposal: Proposal,
}

pub fn spawn_replication_actor(
    pool: Arc<SignalPool>,
    local_host_id: String,
    eventlog_store: Arc<EventLogStore>,
    task_store: Arc<TaskStore>,
    timeblock_store: Arc<TimeBlockStore>,
    proposal_store: Arc<ProposalStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.origin_host_id == local_host_id {
                        continue;
                    }

                    match event.topic.as_str() {
                        EVENTLOG_REPLICATION_TOPIC => {
                            if let Err(error) = apply_eventlog_replication(&eventlog_store, &event)
                            {
                                warn!(event_id = %event.id, error = %error, "replication_actor: eventlog apply failed");
                            }
                        }
                        TASK_REPLICATION_TOPIC => {
                            match apply_task_replication(&task_store, &local_host_id, &event) {
                                Ok(Some(payload)) => {
                                    publish_local_replication_apply_signal(
                                        &pool,
                                        &local_host_id,
                                        &event,
                                        payload,
                                    );
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    warn!(event_id = %event.id, error = %error, "replication_actor: task apply failed");
                                }
                            }
                        }
                        TIMEBLOCK_ACTIVE_REPLICATION_TOPIC => {
                            match apply_timeblock_active_replication(
                                &timeblock_store,
                                &local_host_id,
                                &event,
                            ) {
                                Ok(Some(payload)) => {
                                    publish_local_replication_apply_signal(
                                        &pool,
                                        &local_host_id,
                                        &event,
                                        payload,
                                    );
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    warn!(event_id = %event.id, error = %error, "replication_actor: active timeblock apply failed");
                                }
                            }
                        }
                        TIMEBLOCK_COMPLETED_REPLICATION_TOPIC => {
                            match apply_timeblock_completed_replication(
                                &timeblock_store,
                                &local_host_id,
                                &event,
                            ) {
                                Ok(Some(payload)) => {
                                    publish_local_replication_apply_signal(
                                        &pool,
                                        &local_host_id,
                                        &event,
                                        payload,
                                    );
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    warn!(event_id = %event.id, error = %error, "replication_actor: completed timeblock apply failed");
                                }
                            }
                        }
                        PROPOSAL_REPLICATION_TOPIC => {
                            match apply_proposal_replication(
                                &proposal_store,
                                &local_host_id,
                                &event,
                            ) {
                                Ok(Some(payload)) => {
                                    publish_local_replication_apply_signal(
                                        &pool,
                                        &local_host_id,
                                        &event,
                                        payload,
                                    );
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    warn!(event_id = %event.id, error = %error, "replication_actor: proposal apply failed");
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "replication_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("replication_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn apply_eventlog_replication(store: &EventLogStore, event: &SignalEvent) -> Result<(), String> {
    let payload: EventlogReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    let record = payload
        .record
        .or_else(|| payload.event.and_then(legacy_event_to_record))
        .ok_or_else(|| "missing eventlog record payload".to_string())?;
    store.append_event(scope_key, record)
}

fn publish_local_replication_apply_signal(
    pool: &SignalPool,
    local_host_id: &str,
    event: &SignalEvent,
    payload: serde_json::Value,
) {
    pool.publish(SignalEvent {
        schema_version: event.schema_version,
        id: uuid::Uuid::new_v4().to_string(),
        topic: event.topic.clone(),
        ts: Utc::now().timestamp_millis() as u64,
        source: "actor:replication_actor".to_string(),
        origin_host_id: local_host_id.to_string(),
        hop: event.hop.saturating_add(1),
        trace_id: event.trace_id.clone(),
        payload,
    });
}

fn legacy_event_to_record(record: EventlogLegacyRecord) -> Option<EventRecord> {
    let timestamp = record
        .created_at
        .as_deref()
        .and_then(parse_rfc3339_to_timestamp)
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    let tag = record.r#type.unwrap_or_else(|| "note".to_string());

    Some(EventRecord {
        id: record.id,
        timestamp,
        content: record.content,
        tags: vec![tag],
        refs: vec![],
        metadata: record.metadata,
    })
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn build_task_replication_payload(
    local_host_id: &str,
    scope_key: Option<&str>,
    task: &Task,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "task_snapshot",
            "taskId": task.id,
            "updatedAt": task.updated_at,
            "originHostId": local_host_id,
        },
        "task": task,
    })
}

fn build_active_timeblock_replication_payload(
    local_host_id: &str,
    scope_key: Option<&str>,
    active: &ActiveBlockData,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "timeblock_active",
            "startId": active.start_id,
            "updatedAt": active
                .resolve_last_transition_at()
                .unwrap_or(active.updated_at.unwrap_or(active.resolve_start_time())),
            "originHostId": local_host_id,
        },
        "active": active,
    })
}

fn build_completed_timeblock_replication_payload(
    local_host_id: &str,
    scope_key: Option<&str>,
    block: &TimeBlockData,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "timeblock_completed",
            "blockId": block.start_id,
            "completedAt": block.end_time,
            "originHostId": local_host_id,
        },
        "block": block,
    })
}

fn build_proposal_replication_payload(
    local_host_id: &str,
    scope_key: Option<&str>,
    proposal: &Proposal,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "proposal_snapshot",
            "proposalId": proposal.id,
            "updatedAt": proposal.updated_at,
            "originHostId": local_host_id,
        },
        "proposal": proposal,
    })
}

fn apply_task_replication(
    store: &TaskStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<Option<serde_json::Value>, String> {
    let payload: TaskReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    let mut incoming = payload.task;
    let incoming_id = incoming.id.clone();
    incoming
        .status_transitions
        .sort_by(|left, right| left.at.cmp(&right.at));
    validate_partial_task_status_history(&incoming).map_err(|error| error.to_string())?;
    if let Some(first_transition) = incoming.status_transitions.first() {
        incoming.created_at = first_transition.at;
    }
    normalize_task_status_history(&mut incoming);

    match store.get_scoped(scope_key, &incoming.id) {
        Some(existing) => {
            let should_accept = should_accept_replicated_task(&existing, &incoming);
            let history_changed =
                merge_task_status_history(&existing, &incoming) != existing.status_transitions;

            if should_accept {
                store
                    .upsert_scoped(scope_key, merge_task_snapshot(&existing, &incoming, true))
                    .map_err(|error| error.to_string())?;
            } else if history_changed {
                store
                    .upsert_scoped(scope_key, merge_task_snapshot(&existing, &incoming, false))
                    .map_err(|error| error.to_string())?;
            } else {
                return Ok(None);
            }
        }
        None => {
            store
                .upsert_scoped(scope_key, incoming)
                .map_err(|error| error.to_string())?;
        }
    }

    let stored = store
        .get_scoped(scope_key, &incoming_id)
        .ok_or_else(|| "replicated task was applied but is unreadable".to_string())?;
    Ok(Some(build_task_replication_payload(
        local_host_id,
        scope_key,
        &stored,
    )))
}

fn apply_timeblock_active_replication(
    store: &TimeBlockStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<Option<serde_json::Value>, String> {
    let payload: TimeblockActiveReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    let incoming = payload.active.normalize_task_ids();

    let should_apply = match store.get_active_scoped(scope_key) {
        Ok(Some(existing)) => should_accept_replicated_active(
            &existing,
            &incoming,
            event.origin_host_id.as_str(),
            local_host_id,
        ),
        Ok(None) => true,
        Err(error) => return Err(error.to_string()),
    };

    if !should_apply {
        return Ok(None);
    }

    store
        .put_active_scoped(scope_key, incoming)
        .map_err(|error| error.to_string())?;

    let stored = store
        .get_active_scoped(scope_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "replicated active timeblock was applied but is unreadable".to_string())?;
    Ok(Some(build_active_timeblock_replication_payload(
        local_host_id,
        scope_key,
        &stored,
    )))
}

fn apply_timeblock_completed_replication(
    store: &TimeBlockStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<Option<serde_json::Value>, String> {
    let payload: TimeblockCompletedReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    if store
        .get_completed_by_start_id_scoped(scope_key, &payload.block.start_id)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(None);
    }

    let block = payload.block;
    let completed_write_started_at = Instant::now();
    store
        .put_completed_scoped(scope_key, block.clone())
        .map_err(|error| error.to_string())?;
    let completed_write_ms = completed_write_started_at.elapsed().as_millis();
    tracing::info!(
        scope_key = %scope_key.unwrap_or("anonymous"),
        block_id = %block.id,
        start_id = %block.start_id,
        "[PERF] ({}ms) runtime.replication_actor.timeblock_completed_upsert",
        completed_write_ms
    );
    Ok(Some(build_completed_timeblock_replication_payload(
        local_host_id,
        scope_key,
        &block,
    )))
}

fn apply_proposal_replication(
    store: &ProposalStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<Option<serde_json::Value>, String> {
    let payload: ProposalReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    let proposal_id = payload.proposal.id.clone();

    let should_apply = match store
        .get_scoped(scope_key, &payload.proposal.id)
        .map_err(|error| error.to_string())?
    {
        Some(existing) => should_accept_replicated_proposal(
            &existing,
            &payload.proposal,
            event.origin_host_id.as_str(),
            local_host_id,
        ),
        None => true,
    };

    if !should_apply {
        return Ok(None);
    }

    store
        .save_replica_scoped(scope_key, payload.proposal)
        .map_err(|error| error.to_string())?;

    let stored = store
        .get_scoped(scope_key, &proposal_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "replicated proposal was applied but is unreadable".to_string())?;
    Ok(Some(build_proposal_replication_payload(
        local_host_id,
        scope_key,
        &stored,
    )))
}

fn parse_rfc3339_to_timestamp(input: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(input)
        .ok()
        .map(|value| value.with_timezone(&Utc).timestamp_millis())
}

fn should_accept_replicated_task(existing: &Task, incoming: &Task) -> bool {
    compare_task_replication_preference(existing, incoming) == std::cmp::Ordering::Greater
}

fn should_accept_replicated_active(
    existing: &ActiveBlockData,
    incoming: &ActiveBlockData,
    source_host_id: &str,
    local_host_id: &str,
) -> bool {
    if existing.start_id != incoming.start_id {
        let incoming_start = incoming.resolve_start_time();
        let existing_start = existing.resolve_start_time();
        if incoming_start > existing_start {
            return true;
        }
        if incoming_start < existing_start {
            return false;
        }

        let incoming_order = incoming
            .resolve_last_transition_at()
            .unwrap_or(incoming.updated_at.unwrap_or(incoming.resolve_start_time()));
        let existing_order = existing
            .resolve_last_transition_at()
            .unwrap_or(existing.updated_at.unwrap_or(existing.resolve_start_time()));
        if incoming_order > existing_order {
            return true;
        }
        if incoming_order < existing_order {
            return false;
        }

        return source_host_id > local_host_id;
    }

    let incoming_phase = match incoming.resolve_phase() {
        Some("feedback_submitted") => 2,
        Some("feedback_in_progress") => 1,
        _ => 0,
    };
    let existing_phase = match existing.resolve_phase() {
        Some("feedback_submitted") => 2,
        Some("feedback_in_progress") => 1,
        _ => 0,
    };
    if incoming_phase > existing_phase {
        return true;
    }
    if incoming_phase < existing_phase {
        return false;
    }

    let incoming_version = incoming.version.unwrap_or(0);
    let existing_version = existing.version.unwrap_or(0);
    if incoming_version > existing_version {
        return true;
    }
    if incoming_version < existing_version {
        return false;
    }

    let incoming_updated = incoming
        .resolve_last_transition_at()
        .unwrap_or(incoming.updated_at.unwrap_or(incoming.resolve_start_time()));
    let existing_updated = existing
        .resolve_last_transition_at()
        .unwrap_or(existing.updated_at.unwrap_or(existing.resolve_start_time()));
    if incoming_updated > existing_updated {
        return true;
    }
    if incoming_updated < existing_updated {
        return false;
    }

    source_host_id > local_host_id
}

fn should_accept_replicated_proposal(
    existing: &Proposal,
    incoming: &Proposal,
    source_host_id: &str,
    local_host_id: &str,
) -> bool {
    if incoming.updated_at > existing.updated_at {
        return true;
    }
    if incoming.updated_at < existing.updated_at {
        return false;
    }

    source_host_id > local_host_id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proposal::{ActionType, ProposalStatus};
    use crate::signal::SignalPool;
    use crate::task::{TaskPriority, TaskStatus};

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    fn make_remote_event(topic: &str, payload: serde_json::Value) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: Utc::now().timestamp_millis() as u64,
            source: "test:remote".to_string(),
            origin_host_id: "host-remote".to_string(),
            hop: 1,
            trace_id: None,
            payload,
        }
    }

    fn spawn_actor(
        pool: &Arc<SignalPool>,
        eventlog_store: &Arc<EventLogStore>,
        task_store: &Arc<TaskStore>,
        timeblock_store: &Arc<TimeBlockStore>,
        proposal_store: &Arc<ProposalStore>,
    ) {
        let _handle = spawn_replication_actor(
            Arc::clone(pool),
            "host-local".to_string(),
            Arc::clone(eventlog_store),
            Arc::clone(task_store),
            Arc::clone(timeblock_store),
            Arc::clone(proposal_store),
        );
    }

    fn sample_active_block(start_id: &str) -> ActiveBlockData {
        ActiveBlockData {
            start_id: start_id.to_string(),
            name: "focus".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(1_710_000_000_000),
            phase: Some(BlockPhase::Running),
            version: Some(1),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(1_710_000_000_000),
            last_resumed_at: Some(1_710_000_000_000),
            accumulated_run_ms: Some(0),
            start_time: 1_710_000_000_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![crate::timeblock::BlockTransition {
                transition_type: crate::timeblock::BlockTransitionType::Start,
                at: 1_710_000_000_000,
                actor_id: Some("actor-a".to_string()),
            }],
            task_id: None,
        }
    }

    #[test]
    fn replicated_active_prefers_higher_transition_derived_phase_before_updated_at() {
        let existing = sample_active_block("active-1");
        let mut incoming = sample_active_block("active-1");
        incoming.updated_at = Some(1_709_999_999_000);
        incoming.last_transition_at = Some(1_710_000_005_000);
        incoming
            .transitions
            .push(crate::timeblock::BlockTransition {
                transition_type: crate::timeblock::BlockTransitionType::FeedbackStart,
                at: 1_710_000_005_000,
                actor_id: Some("actor-b".to_string()),
            });

        assert!(should_accept_replicated_active(
            &existing,
            &incoming,
            "host-remote",
            "host-local",
        ));
    }

    #[test]
    fn replicated_active_prefers_newer_start_for_different_blocks() {
        let existing = sample_active_block("active-old");
        let mut incoming = sample_active_block("active-new");
        incoming.start_time = 1_710_000_010_000;
        incoming.updated_at = Some(1_709_999_999_000);
        incoming.last_transition_at = Some(1_710_000_010_000);
        incoming.transitions = vec![crate::timeblock::BlockTransition {
            transition_type: crate::timeblock::BlockTransitionType::Start,
            at: 1_710_000_010_000,
            actor_id: Some("actor-b".to_string()),
        }];

        assert!(should_accept_replicated_active(
            &existing,
            &incoming,
            "host-remote",
            "host-local",
        ));
    }

    #[tokio::test]
    async fn remote_eventlog_replication_is_applied_to_store() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;

        pool.publish(make_remote_event(
            EVENTLOG_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "record": {
                    "id": "event-1",
                    "timestamp": 1710000000000i64,
                    "content": "replicated event",
                    "tags": ["note", "replicated"],
                    "metadata": { "source": "remote" }
                }
            }),
        ));

        yield_for_actor().await;

        let events = eventlog_store
            .list_events(Some("profile-sync"))
            .expect("list events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "event-1");
        assert_eq!(events[0].tags, vec!["note", "replicated"]);
    }

    #[tokio::test]
    async fn remote_task_replication_is_applied_to_store() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-task-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;
        let mut rx = pool.subscribe();

        pool.publish(make_remote_event(
            TASK_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "task": {
                    "id": "task-1",
                    "title": "replicated task",
                    "description": "from remote",
                    "done_condition": null,
                    "status": "pending",
                    "priority": "medium",
                    "tags": ["replicated"],
                    "source": "remote",
                    "parent_id": null,
                    "depends_on": [],
                    "due_at": null,
                    "estimated_minutes": 25,
                    "time_block_ids": [],
                    "status_transitions": [{
                        "id": "task-1:task.create:1710000000000",
                        "at": 1710000000000u64,
                        "to_status": "pending",
                        "reason": "task.create"
                    }],
                    "created_at": 1710000000000u64,
                    "updated_at": 1710000001000u64,
                    "completed_at": null
                }
            }),
        ));

        yield_for_actor().await;

        let task = task_store
            .get_scoped(Some("profile-sync"), "task-1")
            .expect("replicated task");
        assert_eq!(task.title, "replicated task");
        assert_eq!(task.priority, TaskPriority::Medium);
        assert_eq!(task.status, TaskStatus::Pending);

        let mut saw_local_apply = false;
        for _ in 0..3 {
            let event = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
                .await
                .expect("replication wake should be published")
                .expect("signal should be readable");
            if event.topic == TASK_REPLICATION_TOPIC
                && event.origin_host_id == "host-local"
                && event.source == "actor:replication_actor"
            {
                saw_local_apply = true;
                break;
            }
        }
        assert!(
            saw_local_apply,
            "replication actor should publish a local apply wake after storing the remote snapshot"
        );
    }

    #[tokio::test]
    async fn remote_task_replication_ignores_newer_snapshot_without_status_history() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-task-history-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        let existing = task_store.create_scoped(
            Some("profile-sync"),
            crate::task::CreateTaskInput {
                title: "rich history".to_string(),
                description: None,
                done_condition: None,
                priority: None,
                tags: vec![],
                source: None,
                parent_id: None,
                depends_on: vec![],
                due_at: None,
                estimated_minutes: None,
                time_block_ids: vec![],
            },
        );
        task_store
            .transition_scoped(Some("profile-sync"), &existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = task_store
            .get_scoped(Some("profile-sync"), &existing.id)
            .expect("task should exist");
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;

        pool.publish(make_remote_event(
            TASK_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "task": {
                    "id": existing.id,
                    "title": "history lost remote snapshot",
                    "description": null,
                    "done_condition": null,
                    "status": "completed",
                    "priority": "medium",
                    "tags": [],
                    "source": null,
                    "parent_id": null,
                    "depends_on": [],
                    "due_at": null,
                    "estimated_minutes": null,
                    "time_block_ids": [],
                    "created_at": 1710000000000u64,
                    "updated_at": existing.updated_at + 5_000,
                    "completed_at": existing.updated_at + 5_000,
                }
            }),
        ));

        yield_for_actor().await;

        let task = task_store
            .get_scoped(Some("profile-sync"), &existing.id)
            .expect("rich history task should remain");
        assert_eq!(task.title, "rich history");
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.status_transitions.len(), 2);
    }

    #[tokio::test]
    async fn remote_task_replication_merges_sparse_newer_remote_history() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-task-history-merge-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        let existing = task_store.create_scoped(
            Some("profile-sync"),
            crate::task::CreateTaskInput {
                title: "rich history".to_string(),
                description: Some("local".to_string()),
                done_condition: None,
                priority: None,
                tags: vec![],
                source: None,
                parent_id: None,
                depends_on: vec![],
                due_at: None,
                estimated_minutes: None,
                time_block_ids: vec![],
            },
        );
        task_store
            .transition_scoped(Some("profile-sync"), &existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = task_store
            .get_scoped(Some("profile-sync"), &existing.id)
            .expect("task should exist");
        let completion_transition = crate::task::TaskStatusTransition {
            id: format!("{}:remote-completed", existing.id),
            at: existing.updated_at + 5_000,
            from_status: Some(TaskStatus::InProgress),
            to_status: TaskStatus::Completed,
            reason: crate::task::TaskTransitionReason::TaskTransition,
            actor_id: Some("remote".to_string()),
            source_host_id: Some("mobile-host".to_string()),
            operation_id: Some("remote-completed".to_string()),
            related_time_block_id: None,
            related_time_block_transition_ref: None,
            auto_generated: Some(false),
        };
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;
        let mut rx = pool.subscribe();

        pool.publish(make_remote_event(
            TASK_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "task": {
                    "id": existing.id,
                    "title": "sparse remote completion",
                    "description": "remote wins fields",
                    "done_condition": null,
                    "status": "completed",
                    "priority": "medium",
                    "tags": [],
                    "source": null,
                    "parent_id": null,
                    "depends_on": [],
                    "due_at": null,
                    "estimated_minutes": null,
                    "time_block_ids": [],
                    "status_transitions": [
                        existing.status_transitions[0].clone(),
                        completion_transition.clone()
                    ],
                    "created_at": existing.created_at,
                    "updated_at": completion_transition.at,
                    "completed_at": completion_transition.at,
                }
            }),
        ));

        yield_for_actor().await;

        let task = task_store
            .get_scoped(Some("profile-sync"), &existing.id)
            .expect("rich history task should remain");
        assert_eq!(task.title, "sparse remote completion");
        assert_eq!(task.description.as_deref(), Some("remote wins fields"));
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.completed_at, Some(completion_transition.at));
        assert_eq!(task.status_transitions.len(), 3);
        assert!(
            task.status_transitions
                .iter()
                .any(|transition| transition.to_status == TaskStatus::InProgress),
            "merged history should retain local intermediate transition"
        );
        assert!(
            task.status_transitions
                .iter()
                .any(|transition| transition.id == completion_transition.id),
            "merged history should include remote completion transition"
        );

        let mut saw_local_apply = false;
        for _ in 0..3 {
            let event = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
                .await
                .expect("local merge wake should be published")
                .expect("signal should be readable");
            if event.topic == TASK_REPLICATION_TOPIC
                && event.origin_host_id == "host-local"
                && event.source == "actor:replication_actor"
            {
                assert_eq!(event.payload["cursor"]["originHostId"], "host-local");
                assert_eq!(
                    event.payload["task"]["status_transitions"]
                        .as_array()
                        .map(Vec::len),
                    Some(3)
                );
                saw_local_apply = true;
                break;
            }
        }
        assert!(
            saw_local_apply,
            "replication actor should republish merged stored truth after applying task history"
        );
    }

    #[tokio::test]
    async fn remote_timeblock_replication_is_applied_to_store() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-timeblock-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;

        pool.publish(make_remote_event(
            TIMEBLOCK_ACTIVE_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "active": {
                    "startId": "tb-start-1",
                    "name": "deep work",
                    "mode": "countup",
                    "targetMinutes": null,
                    "blockType": "active",
                    "elapsed": 1000,
                    "updatedAt": 1710000002000u64,
                    "phase": "running",
                    "version": 2,
                    "actorId": null,
                    "lastTransitionAt": 1710000002000u64,
                    "lastResumedAt": 1710000001000u64,
                    "accumulatedRunMs": 1000u64,
                    "startTime": 1710000001000u64,
                    "actionEndedAt": null,
                    "feedbackStartedAt": null,
                    "feedbackSubmittedAt": null,
                    "pauseAccumulatedMs": 0u64,
                    "paused": false,
                    "pausedAt": null,
                    "taskIds": [],
                    "taskAssociationLog": [],
                    "sourcePlannedBlockId": null,
                    "transitions": [],
                    "task_id": null
                }
            }),
        ));
        pool.publish(make_remote_event(
            TIMEBLOCK_COMPLETED_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "block": {
                    "id": "tb-start-1",
                    "name": "deep work",
                    "startId": "tb-start-1",
                    "endId": "tb-end-1",
                    "note": "done",
                    "tags": ["focus"],
                    "startTime": 1710000001000u64,
                    "endTime": 1710003601000u64,
                    "blockType": "active",
                    "taskIds": [],
                    "taskStatusOutcomes": null,
                    "taskAssociationLog": [],
                    "sourcePlannedBlockId": null,
                    "transitions": []
                }
            }),
        ));
        pool.publish(make_remote_event(
            TIMEBLOCK_ACTIVE_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "active": {
                    "startId": "gap-start-1",
                    "name": "",
                    "mode": "countup",
                    "targetMinutes": null,
                    "blockType": "gap",
                    "elapsed": 0,
                    "updatedAt": 1710003601000u64,
                    "phase": null,
                    "version": 1,
                    "actorId": "rt:newblock",
                    "lastTransitionAt": 1710003601000u64,
                    "lastResumedAt": null,
                    "accumulatedRunMs": null,
                    "startTime": 1710003601000u64,
                    "actionEndedAt": null,
                    "feedbackStartedAt": null,
                    "feedbackSubmittedAt": null,
                    "pauseAccumulatedMs": null,
                    "paused": false,
                    "pausedAt": null,
                    "taskIds": [],
                    "taskAssociationLog": [],
                    "sourcePlannedBlockId": null,
                    "transitions": [
                        {
                            "type": "start",
                            "at": 1710003601000u64,
                            "actorId": "rt:newblock"
                        }
                    ],
                    "task_id": null
                }
            }),
        ));

        yield_for_actor().await;

        let mut active = None;
        let mut completed = Vec::new();
        for _ in 0..5 {
            active = timeblock_store
                .get_active_scoped(Some("profile-sync"))
                .expect("active query");
            completed = timeblock_store
                .list_completed_scoped(Some("profile-sync"))
                .expect("completed query");
            if active.is_some() && !completed.is_empty() {
                break;
            }
            yield_for_actor().await;
        }

        let active = active.expect("active block");
        assert_eq!(active.start_id, "gap-start-1");
        assert_eq!(active.block_type.as_deref(), Some("gap"));
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].start_id, "tb-start-1");
    }

    #[tokio::test]
    async fn remote_proposal_replication_is_applied_to_store() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-proposal-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;

        pool.publish(make_remote_event(
            PROPOSAL_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "proposal": {
                    "id": "proposal-42",
                    "title": "replicated proposal",
                    "body": "from remote",
                    "action_type": "append_event",
                    "action_params": { "content": "hello", "tags": ["proposal"] },
                    "references": [],
                    "status": "pending",
                    "publisher": {
                        "publisher_type": "human",
                        "id": "remote-user",
                        "name": "Remote User"
                    },
                    "comments": [],
                    "snooze_until": null,
                    "created_at": "2026-04-06T00:00:00Z",
                    "updated_at": "2026-04-06T00:00:10Z"
                }
            }),
        ));

        yield_for_actor().await;

        let proposal = proposal_store
            .get_scoped(Some("profile-sync"), "proposal-42")
            .expect("proposal query")
            .expect("proposal");
        assert_eq!(proposal.title, "replicated proposal");
        assert_eq!(proposal.status, ProposalStatus::Pending);
        assert_eq!(proposal.action_type, ActionType::AppendEvent);
    }

    #[tokio::test]
    async fn local_origin_replication_events_are_ignored() {
        let pool = Arc::new(SignalPool::new(None));
        let eventlog_store = Arc::new(EventLogStore::new(std::env::temp_dir().join(format!(
            "replication-actor-ignore-eventlog-{}",
            uuid::Uuid::new_v4()
        ))));
        let task_store = Arc::new(TaskStore::new());
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let proposal_store = Arc::new(ProposalStore::new());
        spawn_actor(
            &pool,
            &eventlog_store,
            &task_store,
            &timeblock_store,
            &proposal_store,
        );
        yield_for_actor().await;

        let mut event = make_remote_event(
            PROPOSAL_REPLICATION_TOPIC,
            serde_json::json!({
                "scopeKey": "profile-sync",
                "proposal": {
                    "id": "proposal-7",
                    "title": "should be ignored",
                    "body": "",
                    "action_type": "append_event",
                    "action_params": { "content": "hello" },
                    "references": [],
                    "status": "pending",
                    "publisher": {
                        "publisher_type": "agent",
                        "id": "local-agent",
                        "name": "Local Agent"
                    },
                    "comments": [],
                    "snooze_until": null,
                    "created_at": "2026-04-06T00:00:00Z",
                    "updated_at": "2026-04-06T00:00:00Z"
                }
            }),
        );
        event.origin_host_id = "host-local".to_string();
        pool.publish(event);

        yield_for_actor().await;

        assert!(
            proposal_store
                .get_scoped(Some("profile-sync"), "proposal-7")
                .expect("proposal query")
                .is_none()
        );
    }
}
