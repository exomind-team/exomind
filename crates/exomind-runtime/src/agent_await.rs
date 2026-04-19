use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{Instant, interval_at};
use tokio_stream::wrappers::UnboundedReceiverStream;

use crate::AppState;
use crate::eventlog::{EventListFilter, EventRecord, sanitize_user_id};
use crate::proposal::{Comment, Proposal, ProposalStatus};
use crate::signal::types::SignalEvent;
use crate::task::{Task, TaskStatus};
use crate::timeblock::{ActiveBlockData, TimeBlockData};

const DEFAULT_TIMEOUT_SECS: u64 = 1800;
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_TIMEOUT_SECS: u64 = 21600;
const DEFAULT_HEARTBEAT_SECS: u64 = 15;
const MIN_HEARTBEAT_SECS: u64 = 5;
const MAX_HEARTBEAT_SECS: u64 = 60;
const EXECUTION_FAILURE_COMMENT_PREFIX: &str = "批准后执行失败：";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitRequest {
    pub condition: AwaitCondition,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub heartbeat_secs: Option<u64>,
}

impl AwaitRequest {
    pub fn normalize(self) -> NormalizedAwaitRequest {
        NormalizedAwaitRequest {
            condition: self.condition,
            timeout_secs: self
                .timeout_secs
                .unwrap_or(DEFAULT_TIMEOUT_SECS)
                .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS),
            heartbeat_secs: self
                .heartbeat_secs
                .unwrap_or(DEFAULT_HEARTBEAT_SECS)
                .clamp(MIN_HEARTBEAT_SECS, MAX_HEARTBEAT_SECS),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NormalizedAwaitRequest {
    pub condition: AwaitCondition,
    pub timeout_secs: u64,
    pub heartbeat_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AwaitTimeblockState {
    Running,
    Paused,
    Stopped,
    Ended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AwaitCondition {
    NextEvent {
        #[serde(rename = "sinceId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_id: Option<String>,
        #[serde(rename = "sinceTimestamp")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_timestamp: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tags: Option<Vec<String>>,
    },
    TaskCreated {
        #[serde(rename = "taskId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task_id: Option<String>,
    },
    TaskStatusChanged {
        #[serde(rename = "taskId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task_id: Option<String>,
        #[serde(rename = "fromStatus")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_status: Option<TaskStatus>,
        #[serde(rename = "toStatus")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_status: Option<TaskStatus>,
    },
    TaskCompleted {
        #[serde(rename = "taskId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task_id: Option<String>,
    },
    TimeblockCreated {
        #[serde(rename = "startId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_id: Option<String>,
    },
    TimeblockStateChanged {
        #[serde(rename = "startId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_id: Option<String>,
        #[serde(rename = "fromState")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_state: Option<AwaitTimeblockState>,
        #[serde(rename = "toState")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_state: Option<AwaitTimeblockState>,
    },
    TimeblockStopped {
        #[serde(rename = "startId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_id: Option<String>,
    },
    TimeblockEnded {
        #[serde(rename = "startId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_id: Option<String>,
    },
    ProposalCreated {
        #[serde(rename = "proposalId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proposal_id: Option<String>,
    },
    ProposalRevised {
        #[serde(rename = "proposalId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proposal_id: Option<String>,
    },
    ProposalStatusChanged {
        #[serde(rename = "proposalId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proposal_id: Option<String>,
        #[serde(rename = "fromStatus")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_status: Option<ProposalStatus>,
        #[serde(rename = "toStatus")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_status: Option<ProposalStatus>,
    },
    ProposalCommentAdded {
        #[serde(rename = "proposalId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proposal_id: Option<String>,
    },
    ProposalExecutionFailed {
        #[serde(rename = "proposalId")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proposal_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitReadyPayload {
    pub condition: AwaitCondition,
    pub timeout_secs: u64,
    pub heartbeat_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitHeartbeatPayload {
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitTimeoutPayload {
    pub condition: AwaitCondition,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitErrorPayload {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone)]
pub enum AwaitStreamEvent {
    Ready(AwaitReadyPayload),
    Heartbeat(AwaitHeartbeatPayload),
    Fulfilled(Value),
    Timeout(AwaitTimeoutPayload),
    Error(AwaitErrorPayload),
}

impl AwaitStreamEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            Self::Ready(_) => "ready",
            Self::Heartbeat(_) => "heartbeat",
            Self::Fulfilled(_) => "fulfilled",
            Self::Timeout(_) => "timeout",
            Self::Error(_) => "error",
        }
    }

    pub fn data_json(&self) -> String {
        match self {
            Self::Ready(payload) => serde_json::to_string(payload),
            Self::Heartbeat(payload) => serde_json::to_string(payload),
            Self::Fulfilled(payload) => serde_json::to_string(payload),
            Self::Timeout(payload) => serde_json::to_string(payload),
            Self::Error(payload) => serde_json::to_string(payload),
        }
        .unwrap_or_else(|_| {
            json!({
                "code": "internal_error",
                "message": "failed to serialize await payload",
                "retryable": true,
            })
            .to_string()
        })
    }
}

#[derive(Debug, Clone)]
pub struct AwaitSetupError {
    status: StatusCode,
    payload: AwaitErrorPayload,
}

impl AwaitSetupError {
    fn not_found(code: &str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            payload: AwaitErrorPayload {
                code: code.to_string(),
                message: message.into(),
                retryable: false,
            },
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            payload: AwaitErrorPayload {
                code: "internal_error".to_string(),
                message: message.into(),
                retryable: true,
            },
        }
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn payload(&self) -> &AwaitErrorPayload {
        &self.payload
    }
}

#[derive(Debug)]
struct AwaitRuntimeError {
    payload: AwaitErrorPayload,
}

impl AwaitRuntimeError {
    fn internal(message: impl Into<String>) -> Self {
        Self {
            payload: AwaitErrorPayload {
                code: "internal_error".to_string(),
                message: message.into(),
                retryable: true,
            },
        }
    }
}

pub fn start_await_stream(
    state: AppState,
    scope_key: Option<String>,
    request: AwaitRequest,
) -> Result<UnboundedReceiverStream<AwaitStreamEvent>, AwaitSetupError> {
    let request = request.normalize();
    let mut signal_rx = request
        .condition
        .uses_signal_subscription()
        .then(|| state.signal_pool.subscribe());
    let mut eventlog_rx = request
        .condition
        .uses_eventlog_watch()
        .then(|| state.eventlog_watch_tx.subscribe());
    let tracker = AwaitTracker::new(&state, scope_key.as_deref(), &request.condition)?;

    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        run_await_loop(
            state,
            scope_key,
            request,
            tracker,
            tx,
            signal_rx.as_mut(),
            eventlog_rx.as_mut(),
        )
        .await;
    });

    Ok(UnboundedReceiverStream::new(rx))
}

async fn run_await_loop(
    state: AppState,
    scope_key: Option<String>,
    request: NormalizedAwaitRequest,
    mut tracker: AwaitTracker,
    tx: mpsc::UnboundedSender<AwaitStreamEvent>,
    mut signal_rx: Option<&mut broadcast::Receiver<SignalEvent>>,
    mut eventlog_rx: Option<&mut broadcast::Receiver<String>>,
) {
    let _ = tx.send(AwaitStreamEvent::Ready(AwaitReadyPayload {
        condition: request.condition.clone(),
        timeout_secs: request.timeout_secs,
        heartbeat_secs: request.heartbeat_secs,
    }));

    match tracker.initial_check(&state, scope_key.as_deref()) {
        Ok(Some(payload)) => {
            let _ = tx.send(AwaitStreamEvent::Fulfilled(payload));
            return;
        }
        Ok(None) => {}
        Err(error) => {
            let _ = tx.send(AwaitStreamEvent::Error(error.payload));
            return;
        }
    }

    let mut heartbeat = interval_at(
        Instant::now() + Duration::from_secs(request.heartbeat_secs),
        Duration::from_secs(request.heartbeat_secs),
    );
    let timeout = tokio::time::sleep(Duration::from_secs(request.timeout_secs));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            _ = &mut timeout => {
                let _ = tx.send(AwaitStreamEvent::Timeout(AwaitTimeoutPayload {
                    condition: request.condition.clone(),
                    timeout_secs: request.timeout_secs,
                }));
                return;
            }
            _ = heartbeat.tick() => {
                let _ = tx.send(AwaitStreamEvent::Heartbeat(AwaitHeartbeatPayload {
                    ts: now_millis_i64(),
                }));
            }
            signal = recv_signal_or_pending(signal_rx.as_mut().map(|receiver| &mut **receiver)) => {
                let result = match signal {
                    Ok(signal) => {
                        if !tracker.is_relevant_signal(&signal, scope_key.as_deref()) {
                            continue;
                        }
                        tracker.recheck(&state, scope_key.as_deref())
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => tracker.recheck(&state, scope_key.as_deref()),
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = tx.send(AwaitStreamEvent::Error(AwaitRuntimeError::internal("signal subscription closed").payload));
                        return;
                    }
                };

                if send_recheck_result(result, &tx) {
                    return;
                }
            }
            changed_scope = recv_eventlog_scope_or_pending(eventlog_rx.as_mut().map(|receiver| &mut **receiver)) => {
                let result = match changed_scope {
                    Ok(changed_scope) => {
                        if changed_scope != sanitize_user_id(scope_key.as_deref()) {
                            continue;
                        }
                        tracker.recheck(&state, scope_key.as_deref())
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => tracker.recheck(&state, scope_key.as_deref()),
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = tx.send(AwaitStreamEvent::Error(AwaitRuntimeError::internal("eventlog watcher subscription closed").payload));
                        return;
                    }
                };

                if send_recheck_result(result, &tx) {
                    return;
                }
            }
        }
    }
}

fn send_recheck_result(
    result: Result<Option<Value>, AwaitRuntimeError>,
    tx: &mpsc::UnboundedSender<AwaitStreamEvent>,
) -> bool {
    match result {
        Ok(Some(payload)) => {
            let _ = tx.send(AwaitStreamEvent::Fulfilled(payload));
            true
        }
        Ok(None) => false,
        Err(error) => {
            let _ = tx.send(AwaitStreamEvent::Error(error.payload));
            true
        }
    }
}

async fn recv_signal_or_pending(
    receiver: Option<&mut broadcast::Receiver<SignalEvent>>,
) -> Result<SignalEvent, broadcast::error::RecvError> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => futures_util::future::pending().await,
    }
}

async fn recv_eventlog_scope_or_pending(
    receiver: Option<&mut broadcast::Receiver<String>>,
) -> Result<String, broadcast::error::RecvError> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => futures_util::future::pending().await,
    }
}

enum AwaitTracker {
    NextEvent(NextEventTracker),
    TaskCreated(TaskCreatedTracker),
    TaskStatusChanged(TaskStatusChangedTracker),
    TaskCompleted(TaskCompletedTracker),
    TimeblockCreated(TimeblockCreatedTracker),
    TimeblockStateChanged(TimeblockStateChangedTracker),
    TimeblockStopped(TimeblockTargetStateTracker),
    TimeblockEnded(TimeblockTargetStateTracker),
    ProposalCreated(ProposalCreatedTracker),
    ProposalRevised(ProposalRevisedTracker),
    ProposalStatusChanged(ProposalStatusChangedTracker),
    ProposalCommentAdded(ProposalCommentAddedTracker),
    ProposalExecutionFailed(ProposalExecutionFailedTracker),
}

impl AwaitTracker {
    fn new(
        state: &AppState,
        scope_key: Option<&str>,
        condition: &AwaitCondition,
    ) -> Result<Self, AwaitSetupError> {
        match condition {
            AwaitCondition::NextEvent {
                since_id,
                since_timestamp,
                tags,
            } => Ok(Self::NextEvent(NextEventTracker::new(
                state,
                scope_key,
                since_id.clone(),
                *since_timestamp,
                tags.clone().unwrap_or_default(),
            )?)),
            AwaitCondition::TaskCreated { task_id } => Ok(Self::TaskCreated(TaskCreatedTracker {
                task_id: task_id.clone(),
                known_ids: task_id_set(&state.task_store.list_scoped(scope_key)),
            })),
            AwaitCondition::TaskStatusChanged {
                task_id,
                from_status,
                to_status,
            } => Ok(Self::TaskStatusChanged(TaskStatusChangedTracker {
                task_id: task_id.clone(),
                from_status: *from_status,
                to_status: *to_status,
                known_statuses: task_status_map(&state.task_store.list_scoped(scope_key)),
            })),
            AwaitCondition::TaskCompleted { task_id } => {
                if let Some(task_id) = task_id {
                    if state.task_store.get_scoped(scope_key, task_id).is_none() {
                        return Err(AwaitSetupError::not_found(
                            "task_not_found",
                            format!("task not found: {task_id}"),
                        ));
                    }
                }
                Ok(Self::TaskCompleted(TaskCompletedTracker {
                    task_id: task_id.clone(),
                    known_completed_ids: completed_task_id_set(
                        &state.task_store.list_scoped(scope_key),
                    ),
                }))
            }
            AwaitCondition::TimeblockCreated { start_id } => {
                Ok(Self::TimeblockCreated(TimeblockCreatedTracker {
                    start_id: start_id.clone(),
                    known_ids: timeblock_records(state, scope_key)
                        .map_err(AwaitSetupError::internal)?
                        .keys()
                        .cloned()
                        .collect(),
                }))
            }
            AwaitCondition::TimeblockStateChanged {
                start_id,
                from_state,
                to_state,
            } => Ok(Self::TimeblockStateChanged(TimeblockStateChangedTracker {
                start_id: start_id.clone(),
                from_state: from_state.clone(),
                to_state: to_state.clone(),
                known_states: timeblock_state_map(state, scope_key)
                    .map_err(AwaitSetupError::internal)?,
            })),
            AwaitCondition::TimeblockStopped { start_id } => {
                if let Some(start_id) = start_id {
                    let records =
                        timeblock_records(state, scope_key).map_err(AwaitSetupError::internal)?;
                    if !records.contains_key(start_id) {
                        return Err(AwaitSetupError::not_found(
                            "timeblock_not_found",
                            format!("timeblock not found: {start_id}"),
                        ));
                    }
                }
                Ok(Self::TimeblockStopped(TimeblockTargetStateTracker {
                    condition_type: "timeblock_stopped",
                    start_id: start_id.clone(),
                    target_state: AwaitTimeblockState::Stopped,
                    known_states: timeblock_state_map(state, scope_key)
                        .map_err(AwaitSetupError::internal)?,
                }))
            }
            AwaitCondition::TimeblockEnded { start_id } => {
                if let Some(start_id) = start_id {
                    let records =
                        timeblock_records(state, scope_key).map_err(AwaitSetupError::internal)?;
                    if !records.contains_key(start_id) {
                        return Err(AwaitSetupError::not_found(
                            "timeblock_not_found",
                            format!("timeblock not found: {start_id}"),
                        ));
                    }
                }
                Ok(Self::TimeblockEnded(TimeblockTargetStateTracker {
                    condition_type: "timeblock_ended",
                    start_id: start_id.clone(),
                    target_state: AwaitTimeblockState::Ended,
                    known_states: timeblock_state_map(state, scope_key)
                        .map_err(AwaitSetupError::internal)?,
                }))
            }
            AwaitCondition::ProposalCreated { proposal_id } => {
                Ok(Self::ProposalCreated(ProposalCreatedTracker {
                    proposal_id: proposal_id.clone(),
                    known_ids: proposal_id_set(
                        &list_proposals(state, scope_key).map_err(AwaitSetupError::internal)?,
                    ),
                }))
            }
            AwaitCondition::ProposalRevised { proposal_id } => {
                Ok(Self::ProposalRevised(ProposalRevisedTracker {
                    proposal_id: proposal_id.clone(),
                    known_fingerprints: proposal_revision_map(
                        &list_proposals(state, scope_key).map_err(AwaitSetupError::internal)?,
                    ),
                }))
            }
            AwaitCondition::ProposalStatusChanged {
                proposal_id,
                from_status,
                to_status,
            } => Ok(Self::ProposalStatusChanged(ProposalStatusChangedTracker {
                proposal_id: proposal_id.clone(),
                from_status: *from_status,
                to_status: *to_status,
                known_statuses: proposal_status_map(
                    &list_proposals(state, scope_key).map_err(AwaitSetupError::internal)?,
                ),
            })),
            AwaitCondition::ProposalCommentAdded { proposal_id } => {
                Ok(Self::ProposalCommentAdded(ProposalCommentAddedTracker {
                    proposal_id: proposal_id.clone(),
                    known_comment_counts: proposal_comment_count_map(
                        &list_proposals(state, scope_key).map_err(AwaitSetupError::internal)?,
                    ),
                }))
            }
            AwaitCondition::ProposalExecutionFailed { proposal_id } => Ok(
                Self::ProposalExecutionFailed(ProposalExecutionFailedTracker {
                    proposal_id: proposal_id.clone(),
                    known_comment_counts: proposal_comment_count_map(
                        &list_proposals(state, scope_key).map_err(AwaitSetupError::internal)?,
                    ),
                }),
            ),
        }
    }

    fn initial_check(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        match self {
            Self::NextEvent(tracker) => tracker.recheck(state, scope_key),
            Self::TaskCompleted(tracker) => tracker.initial_check(state, scope_key),
            Self::TimeblockStopped(tracker) | Self::TimeblockEnded(tracker) => {
                tracker.initial_check(state, scope_key)
            }
            _ => Ok(None),
        }
    }

    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        match self {
            Self::NextEvent(tracker) => tracker.recheck(state, scope_key),
            Self::TaskCreated(tracker) => tracker.recheck(state, scope_key),
            Self::TaskStatusChanged(tracker) => tracker.recheck(state, scope_key),
            Self::TaskCompleted(tracker) => tracker.recheck(state, scope_key),
            Self::TimeblockCreated(tracker) => tracker.recheck(state, scope_key),
            Self::TimeblockStateChanged(tracker) => tracker.recheck(state, scope_key),
            Self::TimeblockStopped(tracker) | Self::TimeblockEnded(tracker) => {
                tracker.recheck(state, scope_key)
            }
            Self::ProposalCreated(tracker) => tracker.recheck(state, scope_key),
            Self::ProposalRevised(tracker) => tracker.recheck(state, scope_key),
            Self::ProposalStatusChanged(tracker) => tracker.recheck(state, scope_key),
            Self::ProposalCommentAdded(tracker) => tracker.recheck(state, scope_key),
            Self::ProposalExecutionFailed(tracker) => tracker.recheck(state, scope_key),
        }
    }

    fn is_relevant_signal(&self, signal: &SignalEvent, scope_key: Option<&str>) -> bool {
        let scope_matches = signal_scope_matches(signal, scope_key);
        match self {
            Self::NextEvent(_) => false,
            Self::TaskCreated(_) => matches!(
                signal.topic.as_str(),
                "task.created" | "task.replication.upserted"
            ),
            Self::TaskStatusChanged(_) | Self::TaskCompleted(_) => matches!(
                signal.topic.as_str(),
                "task.transitioned" | "task.replication.upserted"
            ),
            Self::TimeblockCreated(_)
            | Self::TimeblockStateChanged(_)
            | Self::TimeblockStopped(_)
            | Self::TimeblockEnded(_) => {
                scope_matches
                    && matches!(
                        signal.topic.as_str(),
                        "timeblock.replication.active_upserted" | "timeblock.replication.completed"
                    )
            }
            Self::ProposalCreated(_) => {
                scope_matches
                    && matches!(
                        signal.topic.as_str(),
                        "proposal.created" | "proposal.replication.upserted"
                    )
            }
            Self::ProposalRevised(_) | Self::ProposalCommentAdded(_) => {
                scope_matches && signal.topic == "proposal.replication.upserted"
            }
            Self::ProposalStatusChanged(_) => {
                scope_matches
                    && matches!(
                        signal.topic.as_str(),
                        "proposal.status_changed" | "proposal.replication.upserted"
                    )
            }
            Self::ProposalExecutionFailed(_) => {
                scope_matches
                    && matches!(
                        signal.topic.as_str(),
                        "proposal.execution_failed" | "proposal.replication.upserted"
                    )
            }
        }
    }
}

impl AwaitCondition {
    fn type_name(&self) -> &'static str {
        match self {
            Self::NextEvent { .. } => "next_event",
            Self::TaskCreated { .. } => "task_created",
            Self::TaskStatusChanged { .. } => "task_status_changed",
            Self::TaskCompleted { .. } => "task_completed",
            Self::TimeblockCreated { .. } => "timeblock_created",
            Self::TimeblockStateChanged { .. } => "timeblock_state_changed",
            Self::TimeblockStopped { .. } => "timeblock_stopped",
            Self::TimeblockEnded { .. } => "timeblock_ended",
            Self::ProposalCreated { .. } => "proposal_created",
            Self::ProposalRevised { .. } => "proposal_revised",
            Self::ProposalStatusChanged { .. } => "proposal_status_changed",
            Self::ProposalCommentAdded { .. } => "proposal_comment_added",
            Self::ProposalExecutionFailed { .. } => "proposal_execution_failed",
        }
    }

    fn uses_signal_subscription(&self) -> bool {
        !matches!(self, Self::NextEvent { .. })
    }

    fn uses_eventlog_watch(&self) -> bool {
        matches!(self, Self::NextEvent { .. })
    }
}

struct NextEventTracker {
    effective_since_id: Option<String>,
    since_timestamp: Option<i64>,
    tags: Vec<String>,
}

impl NextEventTracker {
    fn new(
        state: &AppState,
        scope_key: Option<&str>,
        since_id: Option<String>,
        since_timestamp: Option<i64>,
        tags: Vec<String>,
    ) -> Result<Self, AwaitSetupError> {
        let effective_since_id = if since_id.is_some() || since_timestamp.is_some() {
            since_id
        } else {
            latest_matching_event_id(state, scope_key, &tags).map_err(AwaitSetupError::internal)?
        };

        Ok(Self {
            effective_since_id,
            since_timestamp,
            tags,
        })
    }

    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let events = list_matching_events_after_cursor(
            state,
            scope_key,
            self.effective_since_id.as_deref(),
            self.since_timestamp,
            &self.tags,
        )
        .map_err(AwaitRuntimeError::internal)?;
        let Some(event) = events.last().cloned() else {
            return Ok(None);
        };
        self.effective_since_id = Some(event.id.clone());
        Ok(Some(fulfilled_next_event(&event)))
    }
}

struct TaskCreatedTracker {
    task_id: Option<String>,
    known_ids: HashSet<String>,
}

struct TaskStatusChangedTracker {
    task_id: Option<String>,
    from_status: Option<TaskStatus>,
    to_status: Option<TaskStatus>,
    known_statuses: HashMap<String, TaskStatus>,
}

struct TaskCompletedTracker {
    task_id: Option<String>,
    known_completed_ids: HashSet<String>,
}

struct TimeblockCreatedTracker {
    start_id: Option<String>,
    known_ids: HashSet<String>,
}

struct TimeblockStateChangedTracker {
    start_id: Option<String>,
    from_state: Option<AwaitTimeblockState>,
    to_state: Option<AwaitTimeblockState>,
    known_states: HashMap<String, AwaitTimeblockState>,
}

struct TimeblockTargetStateTracker {
    condition_type: &'static str,
    start_id: Option<String>,
    target_state: AwaitTimeblockState,
    known_states: HashMap<String, AwaitTimeblockState>,
}

struct ProposalCreatedTracker {
    proposal_id: Option<String>,
    known_ids: HashSet<String>,
}

struct ProposalRevisedTracker {
    proposal_id: Option<String>,
    known_fingerprints: HashMap<String, Vec<u8>>,
}

struct ProposalStatusChangedTracker {
    proposal_id: Option<String>,
    from_status: Option<ProposalStatus>,
    to_status: Option<ProposalStatus>,
    known_statuses: HashMap<String, ProposalStatus>,
}

struct ProposalCommentAddedTracker {
    proposal_id: Option<String>,
    known_comment_counts: HashMap<String, usize>,
}

struct ProposalExecutionFailedTracker {
    proposal_id: Option<String>,
    known_comment_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
struct TimeblockRecord {
    timeblock_id: String,
    state: AwaitTimeblockState,
    active_block: Option<ActiveBlockData>,
    completed_block: Option<TimeBlockData>,
}

impl TimeblockRecord {
    fn sort_key(&self) -> (u64, String) {
        let timestamp = self
            .completed_block
            .as_ref()
            .map(TimeBlockData::resolve_start_time)
            .or_else(|| {
                self.active_block
                    .as_ref()
                    .map(ActiveBlockData::resolve_start_time)
            })
            .unwrap_or(0);
        (timestamp, self.timeblock_id.clone())
    }
}

impl TaskCreatedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let tasks = state.task_store.list_scoped(scope_key);
        let mut candidates: Vec<Task> = tasks
            .iter()
            .filter(|task| !self.known_ids.contains(&task.id))
            .filter(|task| self.task_id.as_deref().is_none_or(|id| id == task.id))
            .cloned()
            .collect();

        if let Some(task) = earliest_new_task(&mut candidates) {
            return Ok(Some(fulfilled_task("task_created", &task, None)));
        }

        self.known_ids = task_id_set(&tasks);
        Ok(None)
    }
}

impl TaskStatusChangedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let tasks = state.task_store.list_scoped(scope_key);
        let current = task_status_map(&tasks);
        let mut candidates: Vec<(Task, TaskStatus, TaskStatus)> = Vec::new();

        for task in &tasks {
            if self.task_id.as_deref().is_some_and(|id| id != task.id) {
                continue;
            }
            let Some(previous_status) = self.known_statuses.get(&task.id).copied() else {
                continue;
            };
            if previous_status == task.status {
                continue;
            }
            if !matches_status_transition(
                Some(previous_status),
                task.status,
                self.from_status,
                self.to_status,
            ) {
                continue;
            }
            candidates.push((task.clone(), previous_status, task.status));
        }

        if let Some((task, from_status, to_status)) =
            earliest_task_status_candidate(&mut candidates)
        {
            return Ok(Some(fulfilled_task(
                "task_status_changed",
                &task,
                Some(json!({
                    "fromStatus": from_status,
                    "toStatus": to_status,
                })),
            )));
        }

        self.known_statuses = current;
        Ok(None)
    }
}

impl TaskCompletedTracker {
    fn initial_check(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        if let Some(task_id) = &self.task_id {
            let task = state
                .task_store
                .get_scoped(scope_key, task_id)
                .ok_or_else(|| AwaitRuntimeError::internal(format!("task not found: {task_id}")))?;
            if task.status == TaskStatus::Completed {
                return Ok(Some(fulfilled_task("task_completed", &task, None)));
            }
        }
        Ok(None)
    }

    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        if let Some(task_id) = &self.task_id {
            let task = state
                .task_store
                .get_scoped(scope_key, task_id)
                .ok_or_else(|| AwaitRuntimeError::internal(format!("task not found: {task_id}")))?;
            if task.status == TaskStatus::Completed {
                return Ok(Some(fulfilled_task("task_completed", &task, None)));
            }
            return Ok(None);
        }

        let tasks = state.task_store.list_scoped(scope_key);
        let mut candidates: Vec<Task> = tasks
            .iter()
            .filter(|task| {
                task.status == TaskStatus::Completed && !self.known_completed_ids.contains(&task.id)
            })
            .cloned()
            .collect();

        if let Some(task) = earliest_completed_task(&mut candidates) {
            return Ok(Some(fulfilled_task("task_completed", &task, None)));
        }

        self.known_completed_ids = completed_task_id_set(&tasks);
        Ok(None)
    }
}

impl TimeblockCreatedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let records = timeblock_records(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let mut candidates: Vec<TimeblockRecord> = records
            .values()
            .filter(|record| !self.known_ids.contains(&record.timeblock_id))
            .filter(|record| {
                self.start_id
                    .as_deref()
                    .is_none_or(|id| id == record.timeblock_id)
            })
            .cloned()
            .collect();

        if let Some(record) = earliest_timeblock_record(&mut candidates) {
            return Ok(Some(fulfilled_timeblock(
                "timeblock_created",
                &record,
                None,
            )));
        }

        self.known_ids = records.keys().cloned().collect();
        Ok(None)
    }
}

impl TimeblockStateChangedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let records = timeblock_records(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = records
            .iter()
            .map(|(id, record)| (id.clone(), record.state.clone()))
            .collect::<HashMap<_, _>>();
        let mut candidates: Vec<(TimeblockRecord, AwaitTimeblockState, AwaitTimeblockState)> =
            Vec::new();

        for record in records.values() {
            if self
                .start_id
                .as_deref()
                .is_some_and(|start_id| start_id != record.timeblock_id)
            {
                continue;
            }
            let Some(previous_state) = self.known_states.get(&record.timeblock_id).cloned() else {
                continue;
            };
            if previous_state == record.state {
                continue;
            }
            if !matches_timeblock_transition(
                Some(previous_state.clone()),
                &record.state,
                self.from_state.as_ref(),
                self.to_state.as_ref(),
            ) {
                continue;
            }
            candidates.push((record.clone(), previous_state, record.state.clone()));
        }

        if let Some((record, from_state, to_state)) =
            earliest_timeblock_transition_candidate(&mut candidates)
        {
            return Ok(Some(fulfilled_timeblock(
                "timeblock_state_changed",
                &record,
                Some(json!({
                    "fromState": from_state,
                    "toState": to_state,
                })),
            )));
        }

        self.known_states = current;
        Ok(None)
    }
}

impl TimeblockTargetStateTracker {
    fn initial_check(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let Some(start_id) = &self.start_id else {
            return Ok(None);
        };
        let records = timeblock_records(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let Some(record) = records.get(start_id) else {
            return Err(AwaitRuntimeError::internal(format!(
                "timeblock not found: {start_id}"
            )));
        };
        if self.matches_target_state(&record.state) {
            return Ok(Some(fulfilled_timeblock(self.condition_type, record, None)));
        }
        Ok(None)
    }

    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let records = timeblock_records(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = records
            .iter()
            .map(|(id, record)| (id.clone(), record.state.clone()))
            .collect::<HashMap<_, _>>();

        if let Some(start_id) = &self.start_id {
            let Some(record) = records.get(start_id) else {
                return Err(AwaitRuntimeError::internal(format!(
                    "timeblock not found: {start_id}"
                )));
            };
            if self.matches_target_state(&record.state) {
                return Ok(Some(fulfilled_timeblock(self.condition_type, record, None)));
            }
            return Ok(None);
        }

        let mut candidates: Vec<TimeblockRecord> = records
            .values()
            .filter(|record| {
                let previous_matches = self
                    .known_states
                    .get(&record.timeblock_id)
                    .is_some_and(|state| self.matches_target_state(state));
                !previous_matches && self.matches_target_state(&record.state)
            })
            .cloned()
            .collect();

        if let Some(record) = earliest_timeblock_record(&mut candidates) {
            return Ok(Some(fulfilled_timeblock(
                self.condition_type,
                &record,
                None,
            )));
        }

        self.known_states = current;
        Ok(None)
    }

    fn matches_target_state(&self, state: &AwaitTimeblockState) -> bool {
        match self.target_state {
            AwaitTimeblockState::Stopped => {
                matches!(
                    state,
                    AwaitTimeblockState::Stopped | AwaitTimeblockState::Ended
                )
            }
            _ => *state == self.target_state,
        }
    }
}

impl ProposalCreatedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let proposals = list_proposals(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let mut candidates: Vec<Proposal> = proposals
            .iter()
            .filter(|proposal| !self.known_ids.contains(&proposal.id))
            .filter(|proposal| {
                self.proposal_id
                    .as_deref()
                    .is_none_or(|id| id == proposal.id)
            })
            .cloned()
            .collect();

        if let Some(proposal) = earliest_created_proposal(&mut candidates) {
            return Ok(Some(fulfilled_proposal(
                "proposal_created",
                &proposal,
                None,
                None,
                None,
            )));
        }

        self.known_ids = proposal_id_set(&proposals);
        Ok(None)
    }
}

impl ProposalRevisedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let proposals = list_proposals(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = proposal_revision_map(&proposals);
        let mut candidates: Vec<Proposal> = Vec::new();

        for proposal in &proposals {
            if self
                .proposal_id
                .as_deref()
                .is_some_and(|proposal_id| proposal_id != proposal.id)
            {
                continue;
            }
            let Some(previous) = self.known_fingerprints.get(&proposal.id) else {
                continue;
            };
            let Some(current_fingerprint) = current.get(&proposal.id) else {
                continue;
            };
            if previous != current_fingerprint {
                candidates.push(proposal.clone());
            }
        }

        if let Some(proposal) = earliest_updated_proposal(&mut candidates) {
            return Ok(Some(fulfilled_proposal(
                "proposal_revised",
                &proposal,
                None,
                None,
                None,
            )));
        }

        self.known_fingerprints = current;
        Ok(None)
    }
}

impl ProposalStatusChangedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let proposals = list_proposals(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = proposal_status_map(&proposals);
        let mut candidates: Vec<(Proposal, ProposalStatus, ProposalStatus)> = Vec::new();

        for proposal in &proposals {
            if self
                .proposal_id
                .as_deref()
                .is_some_and(|proposal_id| proposal_id != proposal.id)
            {
                continue;
            }
            let Some(previous_status) = self.known_statuses.get(&proposal.id).copied() else {
                continue;
            };
            if previous_status == proposal.status {
                continue;
            }
            if !matches_proposal_status_transition(
                Some(previous_status),
                proposal.status,
                self.from_status,
                self.to_status,
            ) {
                continue;
            }
            candidates.push((proposal.clone(), previous_status, proposal.status));
        }

        if let Some((proposal, from_status, to_status)) =
            earliest_proposal_status_candidate(&mut candidates)
        {
            return Ok(Some(fulfilled_proposal(
                "proposal_status_changed",
                &proposal,
                Some(json!({
                    "fromStatus": from_status,
                    "toStatus": to_status,
                })),
                None,
                None,
            )));
        }

        self.known_statuses = current;
        Ok(None)
    }
}

impl ProposalCommentAddedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let proposals = list_proposals(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = proposal_comment_count_map(&proposals);
        let mut candidates: Vec<(Proposal, Comment)> = Vec::new();

        for proposal in &proposals {
            if self
                .proposal_id
                .as_deref()
                .is_some_and(|proposal_id| proposal_id != proposal.id)
            {
                continue;
            }
            let Some(previous_count) = self.known_comment_counts.get(&proposal.id).copied() else {
                continue;
            };
            if proposal.comments.len() <= previous_count {
                continue;
            }
            if let Some(comment) = proposal.comments.get(previous_count).cloned() {
                candidates.push((proposal.clone(), comment));
            }
        }

        if let Some((proposal, comment)) = earliest_comment_candidate(&mut candidates) {
            return Ok(Some(fulfilled_proposal(
                "proposal_comment_added",
                &proposal,
                None,
                Some(comment),
                None,
            )));
        }

        self.known_comment_counts = current;
        Ok(None)
    }
}

impl ProposalExecutionFailedTracker {
    fn recheck(
        &mut self,
        state: &AppState,
        scope_key: Option<&str>,
    ) -> Result<Option<Value>, AwaitRuntimeError> {
        let proposals = list_proposals(state, scope_key).map_err(AwaitRuntimeError::internal)?;
        let current = proposal_comment_count_map(&proposals);
        let mut candidates: Vec<(Proposal, Comment, String)> = Vec::new();

        for proposal in &proposals {
            if self
                .proposal_id
                .as_deref()
                .is_some_and(|proposal_id| proposal_id != proposal.id)
            {
                continue;
            }
            let Some(previous_count) = self.known_comment_counts.get(&proposal.id).copied() else {
                continue;
            };
            if proposal.comments.len() <= previous_count {
                continue;
            }

            for comment in proposal.comments.iter().skip(previous_count) {
                if let Some(failure_message) = execution_failure_message(comment) {
                    candidates.push((proposal.clone(), comment.clone(), failure_message));
                    break;
                }
            }
        }

        if let Some((proposal, comment, failure_message)) =
            earliest_failure_candidate(&mut candidates)
        {
            return Ok(Some(fulfilled_proposal(
                "proposal_execution_failed",
                &proposal,
                None,
                Some(comment),
                Some(json!({
                    "failureMessage": failure_message,
                })),
            )));
        }

        self.known_comment_counts = current;
        Ok(None)
    }
}

fn list_proposals(state: &AppState, scope_key: Option<&str>) -> Result<Vec<Proposal>, String> {
    state
        .proposal_store
        .list_scoped(scope_key, &crate::proposal::ProposalFilter::default())
        .map_err(|error| error.to_string())
}

fn timeblock_records(
    state: &AppState,
    scope_key: Option<&str>,
) -> Result<HashMap<String, TimeblockRecord>, String> {
    let mut records = HashMap::new();
    let completed = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| error.to_string())?;

    for block in completed {
        let record = records
            .entry(block.start_id.clone())
            .or_insert_with(|| TimeblockRecord {
                timeblock_id: block.start_id.clone(),
                state: AwaitTimeblockState::Ended,
                active_block: None,
                completed_block: None,
            });
        record.state = AwaitTimeblockState::Ended;
        record.completed_block = Some(block);
    }

    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| error.to_string())?
    {
        let record = records
            .entry(active.start_id.clone())
            .or_insert_with(|| TimeblockRecord {
                timeblock_id: active.start_id.clone(),
                state: derive_timeblock_state(Some(&active), None),
                active_block: None,
                completed_block: None,
            });
        record.active_block = Some(active.clone());
        if record.completed_block.is_none() {
            record.state = derive_timeblock_state(Some(&active), None);
        }
    }

    Ok(records)
}

fn timeblock_state_map(
    state: &AppState,
    scope_key: Option<&str>,
) -> Result<HashMap<String, AwaitTimeblockState>, String> {
    Ok(timeblock_records(state, scope_key)?
        .into_iter()
        .map(|(id, record)| (id, record.state))
        .collect())
}

fn derive_timeblock_state(
    active_block: Option<&ActiveBlockData>,
    completed_block: Option<&TimeBlockData>,
) -> AwaitTimeblockState {
    if completed_block.is_some() {
        return AwaitTimeblockState::Ended;
    }

    if let Some(active) = active_block {
        match active.resolve_phase() {
            Some("paused") => AwaitTimeblockState::Paused,
            Some("feedback_in_progress" | "feedback_submitted" | "action_ended") => {
                AwaitTimeblockState::Stopped
            }
            _ => AwaitTimeblockState::Running,
        }
    } else {
        AwaitTimeblockState::Ended
    }
}

fn fulfilled_next_event(event: &EventRecord) -> Value {
    json!({
        "type": "next_event",
        "matchedAt": now_millis_i64(),
        "eventId": event.id,
        "event": event,
    })
}

fn fulfilled_task(kind: &str, task: &Task, transition: Option<Value>) -> Value {
    let mut data = json!({
        "type": kind,
        "matchedAt": now_millis_i64(),
        "taskId": task.id,
        "task": task,
    });
    if let Some(transition) = transition {
        data["transition"] = transition;
    }
    data
}

fn fulfilled_timeblock(kind: &str, record: &TimeblockRecord, transition: Option<Value>) -> Value {
    let mut data = json!({
        "type": kind,
        "matchedAt": now_millis_i64(),
        "timeblockId": record.timeblock_id,
        "state": record.state,
    });
    if let Some(transition) = transition {
        data["transition"] = transition;
    }
    if let Some(active_block) = &record.active_block {
        data["activeBlock"] = serde_json::to_value(active_block).unwrap_or(Value::Null);
    }
    if let Some(completed_block) = &record.completed_block {
        data["completedBlock"] = serde_json::to_value(completed_block).unwrap_or(Value::Null);
    }
    data
}

fn fulfilled_proposal(
    kind: &str,
    proposal: &Proposal,
    transition: Option<Value>,
    comment: Option<Comment>,
    execution: Option<Value>,
) -> Value {
    let mut data = json!({
        "type": kind,
        "matchedAt": now_millis_i64(),
        "proposalId": proposal.id,
        "proposal": proposal,
    });
    if let Some(transition) = transition {
        data["transition"] = transition;
    }
    if let Some(comment) = comment {
        data["comment"] = serde_json::to_value(comment).unwrap_or(Value::Null);
    }
    if let Some(execution) = execution {
        data["execution"] = execution;
    }
    data
}

fn matches_status_transition(
    previous: Option<TaskStatus>,
    current: TaskStatus,
    from_status: Option<TaskStatus>,
    to_status: Option<TaskStatus>,
) -> bool {
    if let Some(from_status) = from_status {
        if previous != Some(from_status) {
            return false;
        }
    }
    if let Some(to_status) = to_status {
        if current != to_status {
            return false;
        }
    }
    true
}

fn matches_proposal_status_transition(
    previous: Option<ProposalStatus>,
    current: ProposalStatus,
    from_status: Option<ProposalStatus>,
    to_status: Option<ProposalStatus>,
) -> bool {
    if let Some(from_status) = from_status {
        if previous != Some(from_status) {
            return false;
        }
    }
    if let Some(to_status) = to_status {
        if current != to_status {
            return false;
        }
    }
    true
}

fn matches_timeblock_transition(
    previous: Option<AwaitTimeblockState>,
    current: &AwaitTimeblockState,
    from_state: Option<&AwaitTimeblockState>,
    to_state: Option<&AwaitTimeblockState>,
) -> bool {
    if let Some(from_state) = from_state {
        if previous.as_ref() != Some(from_state) {
            return false;
        }
    }
    if let Some(to_state) = to_state {
        if current != to_state {
            return false;
        }
    }
    true
}

fn signal_scope_matches(signal: &SignalEvent, scope_key: Option<&str>) -> bool {
    let Some(signal_scope) = signal.payload.get("scopeKey").and_then(Value::as_str) else {
        return true;
    };
    signal_scope == normalize_scope_key(scope_key)
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn latest_matching_event_id(
    state: &AppState,
    scope_key: Option<&str>,
    tags: &[String],
) -> Result<Option<String>, String> {
    let filter = EventListFilter {
        since_timestamp: None,
        until_timestamp: None,
        tags: tags.to_vec(),
    };
    state
        .eventlog_store
        .list_events_filtered(scope_key, &filter)
        .map(|events| events.first().map(|event| event.id.clone()))
}

fn list_matching_events_after_cursor(
    state: &AppState,
    scope_key: Option<&str>,
    effective_since_id: Option<&str>,
    since_timestamp: Option<i64>,
    tags: &[String],
) -> Result<Vec<EventRecord>, String> {
    let filter = EventListFilter {
        since_timestamp,
        until_timestamp: None,
        tags: tags.to_vec(),
    };
    let mut events = state
        .eventlog_store
        .list_events_filtered(scope_key, &filter)?;

    if let Some(since_id) = effective_since_id {
        if let Some(position) = events.iter().position(|event| event.id == since_id) {
            events.truncate(position);
        }
    }

    Ok(events)
}

fn task_id_set(tasks: &[Task]) -> HashSet<String> {
    tasks.iter().map(|task| task.id.clone()).collect()
}

fn task_status_map(tasks: &[Task]) -> HashMap<String, TaskStatus> {
    tasks
        .iter()
        .map(|task| (task.id.clone(), task.status))
        .collect()
}

fn completed_task_id_set(tasks: &[Task]) -> HashSet<String> {
    tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Completed)
        .map(|task| task.id.clone())
        .collect()
}

fn proposal_id_set(proposals: &[Proposal]) -> HashSet<String> {
    proposals
        .iter()
        .map(|proposal| proposal.id.clone())
        .collect()
}

fn proposal_status_map(proposals: &[Proposal]) -> HashMap<String, ProposalStatus> {
    proposals
        .iter()
        .map(|proposal| (proposal.id.clone(), proposal.status))
        .collect()
}

fn proposal_comment_count_map(proposals: &[Proposal]) -> HashMap<String, usize> {
    proposals
        .iter()
        .map(|proposal| (proposal.id.clone(), proposal.comments.len()))
        .collect()
}

fn proposal_revision_map(proposals: &[Proposal]) -> HashMap<String, Vec<u8>> {
    proposals
        .iter()
        .map(|proposal| (proposal.id.clone(), proposal_revision_fingerprint(proposal)))
        .collect()
}

fn proposal_revision_fingerprint(proposal: &Proposal) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "title": proposal.title,
        "body": proposal.body,
        "actionType": proposal.action_type,
        "actionParams": proposal.action_params,
        "references": proposal.references,
        "publisher": proposal.publisher,
        "snoozeUntil": proposal.snooze_until,
    }))
    .unwrap_or_default()
}

fn execution_failure_message(comment: &Comment) -> Option<String> {
    comment
        .content
        .strip_prefix(EXECUTION_FAILURE_COMMENT_PREFIX)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn earliest_new_task(candidates: &mut [Task]) -> Option<Task> {
    candidates.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    candidates.first().cloned()
}

fn earliest_completed_task(candidates: &mut [Task]) -> Option<Task> {
    candidates.sort_by(|left, right| {
        left.completed_at
            .unwrap_or(left.updated_at)
            .cmp(&right.completed_at.unwrap_or(right.updated_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    candidates.first().cloned()
}

fn earliest_task_status_candidate(
    candidates: &mut [(Task, TaskStatus, TaskStatus)],
) -> Option<(Task, TaskStatus, TaskStatus)> {
    candidates.sort_by(|left, right| {
        left.0
            .updated_at
            .cmp(&right.0.updated_at)
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    candidates.first().cloned()
}

fn earliest_timeblock_record(candidates: &mut [TimeblockRecord]) -> Option<TimeblockRecord> {
    candidates.sort_by_key(TimeblockRecord::sort_key);
    candidates.first().cloned()
}

fn earliest_timeblock_transition_candidate(
    candidates: &mut [(TimeblockRecord, AwaitTimeblockState, AwaitTimeblockState)],
) -> Option<(TimeblockRecord, AwaitTimeblockState, AwaitTimeblockState)> {
    candidates.sort_by(|left, right| left.0.sort_key().cmp(&right.0.sort_key()));
    candidates.first().cloned()
}

fn earliest_created_proposal(candidates: &mut [Proposal]) -> Option<Proposal> {
    candidates.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    candidates.first().cloned()
}

fn earliest_updated_proposal(candidates: &mut [Proposal]) -> Option<Proposal> {
    candidates.sort_by(|left, right| {
        left.updated_at
            .cmp(&right.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    candidates.first().cloned()
}

fn earliest_proposal_status_candidate(
    candidates: &mut [(Proposal, ProposalStatus, ProposalStatus)],
) -> Option<(Proposal, ProposalStatus, ProposalStatus)> {
    candidates.sort_by(|left, right| {
        left.0
            .updated_at
            .cmp(&right.0.updated_at)
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    candidates.first().cloned()
}

fn earliest_comment_candidate(
    candidates: &mut [(Proposal, Comment)],
) -> Option<(Proposal, Comment)> {
    candidates.sort_by(|left, right| {
        left.1
            .created_at
            .cmp(&right.1.created_at)
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    candidates.first().cloned()
}

fn earliest_failure_candidate(
    candidates: &mut [(Proposal, Comment, String)],
) -> Option<(Proposal, Comment, String)> {
    candidates.sort_by(|left, right| {
        left.1
            .created_at
            .cmp(&right.1.created_at)
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    candidates.first().cloned()
}

fn now_millis_i64() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::agent;
    use crate::config;
    use crate::energy;
    use crate::eventlog;
    use crate::mesh;
    use crate::pairing;
    use crate::proposal;
    #[cfg(not(target_os = "android"))]
    use crate::pty;
    use crate::reminder;
    use crate::session;
    use crate::signal;
    use crate::task;
    use crate::tick;
    use crate::timeblock;

    fn test_app_state(port: u16) -> AppState {
        let registry = agent::AgentRegistry::new();
        let signal_pool = Arc::new(signal::SignalPool::new(None));
        let host_id = format!("await-test-{port}");
        let energy_registry = energy::EnergyRegistry::new();
        let (eventlog_watch_tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
        let eventlog_store = Arc::new(eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!("exomind-await-test-{port}")),
        ));
        eventlog_store.set_watch_tx(eventlog_watch_tx.clone());

        AppState {
            port,
            host_id: host_id.clone(),
            device_id: format!("await-dev-{port}"),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(mesh::MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            allow_lan_without_auth: false,
            mdns: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            config_store: Arc::new(config::ConfigStore::new()),
            reminder_store: Arc::new(reminder::ReminderStore::new()),
            task_store: Arc::new(task::TaskStore::new()),
            proposal_store: Arc::new(proposal::ProposalStore::new()),
            session_store: Arc::new(session::SessionStore::new()),
            agent_api_session_store: Arc::new(agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx,
            timeblock_store: Arc::new(timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(pty::PtyManager::new(Arc::clone(&signal_pool), host_id)),
        }
    }

    async fn collect_until_terminal(
        mut stream: UnboundedReceiverStream<AwaitStreamEvent>,
    ) -> Vec<AwaitStreamEvent> {
        use tokio_stream::StreamExt;

        let mut events = Vec::new();
        while let Some(event) = stream.next().await {
            let terminal = matches!(
                event,
                AwaitStreamEvent::Fulfilled(_)
                    | AwaitStreamEvent::Timeout(_)
                    | AwaitStreamEvent::Error(_)
            );
            events.push(event);
            if terminal {
                break;
            }
        }
        events
    }

    #[tokio::test]
    async fn task_completed_fulfills_immediately_when_task_already_completed() {
        let state = test_app_state(4501);
        let task = state.task_store.create_scoped(
            Some("profile-argon"),
            task::CreateTaskInput {
                title: "done".to_string(),
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
        state
            .task_store
            .transition_scoped(
                Some("profile-argon"),
                &task.id,
                task::TaskStatus::InProgress,
            )
            .unwrap();
        let completed = state
            .task_store
            .transition_scoped(Some("profile-argon"), &task.id, task::TaskStatus::Completed)
            .unwrap();

        let stream = start_await_stream(
            state,
            Some("profile-argon".to_string()),
            AwaitRequest {
                condition: AwaitCondition::TaskCompleted {
                    task_id: Some(completed.1.id.clone()),
                },
                timeout_secs: Some(1),
                heartbeat_secs: Some(5),
            },
        )
        .unwrap();

        let events = collect_until_terminal(stream).await;
        assert!(matches!(events[0], AwaitStreamEvent::Ready(_)));
        match &events[1] {
            AwaitStreamEvent::Fulfilled(payload) => {
                assert_eq!(payload["type"], "task_completed");
                assert_eq!(payload["taskId"], completed.1.id);
                assert_eq!(payload["task"]["status"], "completed");
            }
            other => panic!("expected fulfilled event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn next_event_waits_for_future_event_only_without_cursor() {
        let state = test_app_state(4502);
        state
            .eventlog_store
            .append_event(
                Some("profile-argon"),
                EventRecord {
                    id: "evt-old".to_string(),
                    timestamp: now_millis_i64(),
                    content: "old".to_string(),
                    tags: vec!["note".to_string()],
                    refs: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        let stream = start_await_stream(
            state.clone(),
            Some("profile-argon".to_string()),
            AwaitRequest {
                condition: AwaitCondition::NextEvent {
                    since_id: None,
                    since_timestamp: None,
                    tags: None,
                },
                timeout_secs: Some(2),
                heartbeat_secs: Some(5),
            },
        )
        .unwrap();

        state
            .eventlog_store
            .append_event(
                Some("profile-argon"),
                EventRecord {
                    id: "evt-new".to_string(),
                    timestamp: now_millis_i64() + 1,
                    content: "new".to_string(),
                    tags: vec!["note".to_string()],
                    refs: vec![],
                    metadata: None,
                },
            )
            .unwrap();

        let events = collect_until_terminal(stream).await;
        match &events[1] {
            AwaitStreamEvent::Fulfilled(payload) => {
                assert_eq!(payload["type"], "next_event");
                assert_eq!(payload["eventId"], "evt-new");
            }
            other => panic!("expected fulfilled event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn timeblock_stopped_fulfills_when_block_enters_feedback_phase() {
        let state = test_app_state(4503);
        let active = ActiveBlockData {
            start_id: "tb-1".to_string(),
            name: "Focus".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(10),
            phase: Some("running".to_string()),
            version: Some(1),
            actor_id: None,
            last_transition_at: Some(10),
            last_resumed_at: Some(10),
            accumulated_run_ms: Some(0),
            start_time: 10,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![],
            task_id: None,
        };
        state
            .timeblock_store
            .put_active_scoped(Some("profile-argon"), active.clone())
            .unwrap();

        let stream = start_await_stream(
            state.clone(),
            Some("profile-argon".to_string()),
            AwaitRequest {
                condition: AwaitCondition::TimeblockStopped {
                    start_id: Some("tb-1".to_string()),
                },
                timeout_secs: Some(2),
                heartbeat_secs: Some(5),
            },
        )
        .unwrap();

        let mut stopped = active;
        stopped.phase = Some("feedback_in_progress".to_string());
        stopped.feedback_started_at = Some(20);
        state
            .timeblock_store
            .put_active_scoped(Some("profile-argon"), stopped)
            .unwrap();
        state.signal_pool.publish(SignalEvent {
            schema_version: 1,
            id: "sig-1".to_string(),
            topic: "timeblock.replication.active_upserted".to_string(),
            ts: 20,
            source: "test".to_string(),
            origin_host_id: "host".to_string(),
            hop: 0,
            trace_id: None,
            payload: json!({ "scopeKey": "profile-argon" }),
        });

        let events = collect_until_terminal(stream).await;
        match &events[1] {
            AwaitStreamEvent::Fulfilled(payload) => {
                assert_eq!(payload["type"], "timeblock_stopped");
                assert_eq!(payload["timeblockId"], "tb-1");
                assert_eq!(payload["state"], "stopped");
            }
            other => panic!("expected fulfilled event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn proposal_comment_added_waits_for_comment_delta() {
        let state = test_app_state(4504);
        let proposal = state
            .proposal_store
            .create_scoped(
                Some("profile-argon"),
                proposal::CreateProposalInput {
                    title: "P".to_string(),
                    body: String::new(),
                    action_type: proposal::ActionType::CreateTask,
                    action_params: json!({"title": "task"}),
                    references: vec![],
                    publisher: proposal::Publisher {
                        publisher_type: proposal::PublisherType::Agent,
                        id: "agent".to_string(),
                        name: "Agent".to_string(),
                    },
                },
            )
            .unwrap();

        let stream = start_await_stream(
            state.clone(),
            Some("profile-argon".to_string()),
            AwaitRequest {
                condition: AwaitCondition::ProposalCommentAdded {
                    proposal_id: Some(proposal.id.clone()),
                },
                timeout_secs: Some(2),
                heartbeat_secs: Some(5),
            },
        )
        .unwrap();

        state
            .proposal_store
            .add_comment_scoped(
                Some("profile-argon"),
                &proposal.id,
                proposal::Comment {
                    author: proposal::Publisher {
                        publisher_type: proposal::PublisherType::Human,
                        id: "u1".to_string(),
                        name: "User".to_string(),
                    },
                    content: "hello".to_string(),
                    created_at: chrono::Utc::now(),
                },
            )
            .unwrap();
        state.signal_pool.publish(SignalEvent {
            schema_version: 1,
            id: "sig-2".to_string(),
            topic: "proposal.replication.upserted".to_string(),
            ts: 1,
            source: "test".to_string(),
            origin_host_id: "host".to_string(),
            hop: 0,
            trace_id: None,
            payload: json!({ "scopeKey": "profile-argon" }),
        });

        let events = collect_until_terminal(stream).await;
        match &events[1] {
            AwaitStreamEvent::Fulfilled(payload) => {
                assert_eq!(payload["type"], "proposal_comment_added");
                assert_eq!(payload["proposalId"], proposal.id);
                assert_eq!(payload["comment"]["content"], "hello");
            }
            other => panic!("expected fulfilled event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn timeout_emits_timeout_event() {
        let state = test_app_state(4505);
        let stream = start_await_stream(
            state,
            Some("profile-argon".to_string()),
            AwaitRequest {
                condition: AwaitCondition::TaskCreated { task_id: None },
                timeout_secs: Some(1),
                heartbeat_secs: Some(5),
            },
        )
        .unwrap();

        let events = collect_until_terminal(stream).await;
        match events.last().unwrap() {
            AwaitStreamEvent::Timeout(payload) => {
                assert_eq!(payload.timeout_secs, 1);
                assert_eq!(payload.condition.type_name(), "task_created");
            }
            other => panic!("expected timeout event, got {other:?}"),
        }
    }
}
