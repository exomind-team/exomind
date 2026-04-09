use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::warn;

use crate::eventlog::{EventLogStore, EventRecord};
use crate::proposal::{Proposal, ProposalStore};
use crate::signal::{SignalEvent, SignalPool};
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
                            if let Err(error) =
                                apply_task_replication(&task_store, &local_host_id, &event)
                            {
                                warn!(event_id = %event.id, error = %error, "replication_actor: task apply failed");
                            }
                        }
                        TIMEBLOCK_ACTIVE_REPLICATION_TOPIC => {
                            if let Err(error) = apply_timeblock_active_replication(
                                &timeblock_store,
                                &local_host_id,
                                &event,
                            ) {
                                warn!(event_id = %event.id, error = %error, "replication_actor: active timeblock apply failed");
                            }
                        }
                        TIMEBLOCK_COMPLETED_REPLICATION_TOPIC => {
                            if let Err(error) =
                                apply_timeblock_completed_replication(&timeblock_store, &event)
                            {
                                warn!(event_id = %event.id, error = %error, "replication_actor: completed timeblock apply failed");
                            }
                        }
                        PROPOSAL_REPLICATION_TOPIC => {
                            if let Err(error) =
                                apply_proposal_replication(&proposal_store, &local_host_id, &event)
                            {
                                warn!(event_id = %event.id, error = %error, "replication_actor: proposal apply failed");
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
        metadata: record.metadata,
    })
}

fn apply_task_replication(
    store: &TaskStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<(), String> {
    let payload: TaskReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();

    match store.get_scoped(scope_key, &payload.task.id) {
        Some(existing)
            if !should_accept_replicated_task(
                &existing,
                &payload.task,
                Some(event.origin_host_id.as_str()),
                local_host_id,
            ) =>
        {
            Ok(())
        }
        _ => store
            .upsert_scoped(scope_key, payload.task)
            .map(|_| ())
            .map_err(|error| error.to_string()),
    }
}

fn apply_timeblock_active_replication(
    store: &TimeBlockStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<(), String> {
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
        return Ok(());
    }

    store
        .put_active_scoped(scope_key, incoming)
        .map_err(|error| error.to_string())
}

fn apply_timeblock_completed_replication(
    store: &TimeBlockStore,
    event: &SignalEvent,
) -> Result<(), String> {
    let payload: TimeblockCompletedReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();
    let mut completed = store
        .list_completed_scoped(scope_key)
        .map_err(|error| error.to_string())?;

    if completed
        .iter()
        .any(|existing| existing.start_id == payload.block.start_id)
    {
        return Ok(());
    }

    completed.push(payload.block);
    store
        .replace_completed_scoped(scope_key, &completed)
        .map_err(|error| error.to_string())
}

fn apply_proposal_replication(
    store: &ProposalStore,
    local_host_id: &str,
    event: &SignalEvent,
) -> Result<(), String> {
    let payload: ProposalReplicationPayload =
        serde_json::from_value(event.payload.clone()).map_err(|error| error.to_string())?;
    let scope_key = payload.scope_key.as_deref();

    let should_apply = match store
        .get_scoped(scope_key, payload.proposal.id)
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
        return Ok(());
    }

    store
        .save_replica_scoped(scope_key, payload.proposal)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn parse_rfc3339_to_timestamp(input: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(input)
        .ok()
        .map(|value| value.with_timezone(&Utc).timestamp_millis())
}

fn should_accept_replicated_task(
    existing: &Task,
    incoming: &Task,
    source_host_id: Option<&str>,
    local_host_id: &str,
) -> bool {
    if incoming.updated_at > existing.updated_at {
        return true;
    }
    if incoming.updated_at < existing.updated_at {
        return false;
    }

    if incoming.status.is_terminal() != existing.status.is_terminal() {
        return incoming.status.is_terminal();
    }

    if incoming.completed_at.unwrap_or(0) > existing.completed_at.unwrap_or(0) {
        return true;
    }

    if incoming.completed_at.unwrap_or(0) == existing.completed_at.unwrap_or(0) {
        if let Some(source_host_id) = source_host_id {
            return source_host_id > local_host_id;
        }
    }

    false
}

fn should_accept_replicated_active(
    existing: &ActiveBlockData,
    incoming: &ActiveBlockData,
    source_host_id: &str,
    local_host_id: &str,
) -> bool {
    let incoming_version = incoming.version.unwrap_or(0);
    let existing_version = existing.version.unwrap_or(0);
    if incoming_version > existing_version {
        return true;
    }
    if incoming_version < existing_version {
        return false;
    }

    let incoming_updated = incoming.updated_at.unwrap_or(incoming.start_time);
    let existing_updated = existing.updated_at.unwrap_or(existing.start_time);
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
                    "id": "tb-1",
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

        yield_for_actor().await;

        let active = timeblock_store
            .get_active_scoped(Some("profile-sync"))
            .expect("active query")
            .expect("active block");
        assert_eq!(active.start_id, "tb-start-1");

        let completed = timeblock_store
            .list_completed_scoped(Some("profile-sync"))
            .expect("completed query");
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
                    "id": 42,
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
            .get_scoped(Some("profile-sync"), 42)
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
                    "id": 7,
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
                .get_scoped(Some("profile-sync"), 7)
                .expect("proposal query")
                .is_none()
        );
    }
}
