use std::sync::Arc;

use chrono::Utc;
use thiserror::Error;

use crate::eventlog::{EventLogStore, EventRecord};
use crate::proposal::{
    ActionType, AppendEventParams, CreateTaskParams, Proposal, StartTimeblockParams,
};
use crate::routes::timeblocks::{NewBlockRequest, do_new_block};
use crate::task::{CreateTaskInput, TaskStore};
use crate::timeblock::TimeBlockStore;

#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("invalid action params: {0}")]
    InvalidParams(#[from] serde_json::Error),
    #[error("eventlog write failed: {0}")]
    EventLog(String),
    #[error("timeblock execution failed: {0}")]
    Timeblock(String),
    #[error("proposal action is not implemented yet: {0}")]
    NotYetImplemented(&'static str),
}

pub struct ProposalExecutor {
    task_store: Arc<TaskStore>,
    eventlog_store: Arc<EventLogStore>,
    timeblock_store: Arc<TimeBlockStore>,
}

impl ProposalExecutor {
    pub fn new(
        task_store: Arc<TaskStore>,
        eventlog_store: Arc<EventLogStore>,
        timeblock_store: Arc<TimeBlockStore>,
    ) -> Self {
        Self {
            task_store,
            eventlog_store,
            timeblock_store,
        }
    }

    pub fn execute_scoped(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<(), ExecutionError> {
        match proposal.action_type {
            ActionType::CreateTask => self.execute_create_task(scope_key, proposal),
            ActionType::AppendEvent => self.execute_append_event(scope_key, proposal),
            ActionType::StartTimeblock => self.execute_start_timeblock(scope_key, proposal),
            ActionType::ApproveAgentAccess => {
                Err(ExecutionError::NotYetImplemented("approve_agent_access"))
            }
        }
    }

    fn execute_create_task(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<(), ExecutionError> {
        let params: CreateTaskParams = serde_json::from_value(proposal.action_params.clone())?;
        let task = self.task_store.create_scoped(
            scope_key,
            CreateTaskInput {
                title: params.title.clone(),
                description: params.description.clone(),
                done_condition: None,
                priority: params.priority,
                tags: params.tags.unwrap_or_default(),
                source: Some(format!("proposal:{}", proposal.id)),
                parent_id: None,
                depends_on: vec![],
                due_at: None,
                estimated_minutes: None,
                time_block_ids: vec![],
            },
        );

        self.eventlog_store
            .append_event(
                scope_key,
                EventRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: Utc::now().timestamp_millis(),
                    content: format!("提案 #{} 已批准并创建任务：{}", proposal.id, task.title),
                    tags: vec![
                        "agent-action".to_string(),
                        "proposal-approved".to_string(),
                        "create_task".to_string(),
                    ],
                    refs: vec![],
                    metadata: Some(serde_json::json!({
                        "proposal_id": proposal.id,
                        "action_type": "create_task",
                        "task_id": task.id,
                        "publisher": proposal.publisher.clone(),
                    })),
                },
            )
            .map_err(ExecutionError::EventLog)?;
        Ok(())
    }

    fn execute_append_event(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<(), ExecutionError> {
        let params: AppendEventParams = serde_json::from_value(proposal.action_params.clone())?;
        let mut tags = params.tags.unwrap_or_default();
        push_unique_tag(&mut tags, "agent-action");
        push_unique_tag(&mut tags, "proposal-approved");

        self.eventlog_store
            .append_event(
                scope_key,
                EventRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: Utc::now().timestamp_millis(),
                    content: params.content,
                    tags,
                    refs: vec![],
                    metadata: Some(serde_json::json!({
                        "proposal_id": proposal.id,
                        "action_type": "append_event",
                        "publisher": proposal.publisher.clone(),
                    })),
                },
            )
            .map_err(ExecutionError::EventLog)?;
        Ok(())
    }

    fn execute_start_timeblock(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<(), ExecutionError> {
        let params: StartTimeblockParams = serde_json::from_value(proposal.action_params.clone())?;
        let result = do_new_block(
            &self.timeblock_store,
            scope_key,
            &NewBlockRequest {
                block_type: "active".to_string(),
                name: Some(params.name.clone()),
                mode: Some(params.mode.unwrap_or_else(|| "countup".to_string())),
                target_minutes: params.target_minutes,
                task_ids: Some(params.task_ids.clone().unwrap_or_default()),
                source_planned_block_id: params.source_planned_block_id.clone(),
                feedback: None,
                task_status_outcomes: None,
            },
        )
        .map_err(|(status, payload)| {
            ExecutionError::Timeblock(format!(
                "status={} error={}",
                status.as_u16(),
                payload.0.error
            ))
        })?;

        let mut tags = params.tags.unwrap_or_default();
        push_unique_tag(&mut tags, "block_start");
        push_unique_tag(&mut tags, "agent-action");
        push_unique_tag(&mut tags, "proposal-approved");

        self.eventlog_store
            .append_event(
                scope_key,
                EventRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: Utc::now().timestamp_millis(),
                    content: format!("时间块开始: {}", result.active.name),
                    tags,
                    refs: vec![],
                    metadata: Some(serde_json::json!({
                        "proposal_id": proposal.id,
                        "action_type": "start_timeblock",
                        "start_id": result.active.start_id,
                        "task_ids": result.active.task_ids,
                        "description": params.description,
                        "publisher": proposal.publisher.clone(),
                    })),
                },
            )
            .map_err(ExecutionError::EventLog)?;
        Ok(())
    }
}

fn push_unique_tag(tags: &mut Vec<String>, value: &str) {
    if !tags.iter().any(|tag| tag == value) {
        tags.push(value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::eventlog::EventLogStore;
    use crate::proposal::{ActionType, Proposal, ProposalStatus, Publisher, PublisherType};
    use crate::task::TaskStore;
    use crate::timeblock::TimeBlockStore;

    use super::ProposalExecutor;

    fn sample_proposal(action_type: ActionType, action_params: serde_json::Value) -> Proposal {
        let now = chrono::Utc::now();
        Proposal {
            id: "proposal-7".to_string(),
            title: "Sample".to_string(),
            body: "Because".to_string(),
            action_type,
            action_params,
            references: vec![],
            status: ProposalStatus::Approved,
            publisher: Publisher {
                publisher_type: PublisherType::Agent,
                id: "agent-a".to_string(),
                name: "Agent A".to_string(),
            },
            comments: vec![],
            snooze_until: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn execute_create_task_creates_task_and_eventlog() {
        let task_store = Arc::new(TaskStore::new());
        let eventlog_store = Arc::new(EventLogStore::new(
            std::env::temp_dir().join(format!("exomind-proposal-exec-{}", uuid::Uuid::new_v4())),
        ));
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let executor =
            ProposalExecutor::new(task_store.clone(), eventlog_store.clone(), timeblock_store);

        executor
            .execute_scoped(
                None,
                &sample_proposal(
                    ActionType::CreateTask,
                    serde_json::json!({ "title": "Ship proposal runtime", "tags": ["rt"] }),
                ),
            )
            .unwrap();

        let tasks = task_store.list();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Ship proposal runtime");
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].tags.iter().any(|tag| tag == "agent-action"));
    }
}
