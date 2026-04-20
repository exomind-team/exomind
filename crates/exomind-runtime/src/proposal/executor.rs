use std::sync::Arc;

use chrono::Utc;
use thiserror::Error;

use crate::eventlog::{EventLogStore, EventRecord};
use crate::proposal::{
    ActionType, AppendEventParams, CreateTaskParams, Proposal, ProposalTaskDependency,
    StartTimeblockParams, UpdateTaskParams,
};
use crate::routes::timeblocks::{NewBlockRequest, NewBlockResponse, do_new_block};
use crate::task::{CreateTaskInput, Task, TaskDependency, TaskStore, UpdateTaskInput};
use crate::timeblock::TimeBlockStore;

#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("invalid action params: {0}")]
    InvalidParams(#[from] serde_json::Error),
    #[error("eventlog write failed: {0}")]
    EventLog(String),
    #[error("task execution failed: {0}")]
    Task(String),
    #[error("timeblock execution failed: {0}")]
    Timeblock(String),
    #[error("proposal action is not implemented yet: {0}")]
    NotYetImplemented(&'static str),
}

pub enum ExecutionOutcome {
    TaskCreated {
        task: Task,
        event: EventRecord,
    },
    TaskUpdated {
        task: Task,
        event: EventRecord,
    },
    EventAppended {
        event: EventRecord,
    },
    TimeblockStarted {
        result: NewBlockResponse,
        event: EventRecord,
    },
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
    ) -> Result<ExecutionOutcome, ExecutionError> {
        match proposal.action_type {
            ActionType::CreateTask => self.execute_create_task(scope_key, proposal),
            ActionType::UpdateTask => self.execute_update_task(scope_key, proposal),
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
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let params: CreateTaskParams = serde_json::from_value(proposal.action_params.clone())?;
        let fields = params.fields;
        let depends_on = map_dependencies(fields.depends_on.unwrap_or_default());
        ensure_dependencies_exist(&self.task_store, scope_key, &depends_on)?;
        let task = self.task_store.create_scoped(
            scope_key,
            CreateTaskInput {
                title: fields.title.clone(),
                description: fields.description.clone(),
                done_condition: fields.done_condition.clone(),
                priority: fields.priority,
                tags: fields.tags.unwrap_or_default(),
                source: Some(format!("proposal:{}", proposal.id)),
                parent_id: None,
                depends_on,
                due_at: fields.due_at.map(|value| value.timestamp_millis() as u64),
                estimated_minutes: fields.estimated_minutes,
                time_block_ids: vec![],
            },
        );

        let event = EventRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now().timestamp_millis(),
            content: format!("提案 #{} 已批准并创建任务：{}", proposal.id, task.title),
            tags: vec![
                "agent-action".to_string(),
                "proposal-approved".to_string(),
                "task.create".to_string(),
            ],
            refs: vec![],
            metadata: Some(serde_json::json!({
                "proposal_id": proposal.id,
                "action_type": "task.create",
                "task_id": task.id,
                "publisher": proposal.publisher.clone(),
            })),
        };
        self.eventlog_store
            .append_event(scope_key, event.clone())
            .map_err(ExecutionError::EventLog)?;
        Ok(ExecutionOutcome::TaskCreated { task, event })
    }

    fn execute_update_task(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let params: UpdateTaskParams = serde_json::from_value(proposal.action_params.clone())?;
        let task_id = params.task_id.clone();
        if self.task_store.get_scoped(scope_key, &task_id).is_none() {
            return Err(ExecutionError::Task(format!(
                "status=404 error=task not found: {task_id}"
            )));
        }

        let depends_on = params.patch.depends_on.clone().map(map_dependencies);
        if let Some(dependencies) = depends_on.as_ref() {
            ensure_dependencies_exist(&self.task_store, scope_key, dependencies)?;
        }

        let task = self
            .task_store
            .update_scoped(
                scope_key,
                &task_id,
                UpdateTaskInput {
                    title: params.patch.title.clone(),
                    description: params.patch.description.clone(),
                    done_condition: params.patch.done_condition.clone(),
                    priority: params.patch.priority,
                    tags: params.patch.tags.clone(),
                    depends_on,
                    due_at: params
                        .patch
                        .due_at
                        .clone()
                        .map(|value| value.map(|item| item.timestamp_millis() as u64)),
                    estimated_minutes: params.patch.estimated_minutes,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .map_err(|error| ExecutionError::Task(format!("status=409 error={error}")))?;

        let event = EventRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now().timestamp_millis(),
            content: format!("提案 #{} 已批准并更新任务：{}", proposal.id, task.title),
            tags: vec![
                "agent-action".to_string(),
                "proposal-approved".to_string(),
                "task.update".to_string(),
            ],
            refs: vec![],
            metadata: Some(serde_json::json!({
                "proposal_id": proposal.id,
                "action_type": "task.update",
                "task_id": task.id,
                "publisher": proposal.publisher.clone(),
            })),
        };
        self.eventlog_store
            .append_event(scope_key, event.clone())
            .map_err(ExecutionError::EventLog)?;
        Ok(ExecutionOutcome::TaskUpdated { task, event })
    }

    fn execute_append_event(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<ExecutionOutcome, ExecutionError> {
        let params: AppendEventParams = serde_json::from_value(proposal.action_params.clone())?;
        let mut tags = params.tags.unwrap_or_default();
        push_unique_tag(&mut tags, "agent-action");
        push_unique_tag(&mut tags, "proposal-approved");

        let event = EventRecord {
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
        };
        self.eventlog_store
            .append_event(scope_key, event.clone())
            .map_err(ExecutionError::EventLog)?;
        Ok(ExecutionOutcome::EventAppended { event })
    }

    fn execute_start_timeblock(
        &self,
        scope_key: Option<&str>,
        proposal: &Proposal,
    ) -> Result<ExecutionOutcome, ExecutionError> {
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

        let event = EventRecord {
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
        };
        self.eventlog_store
            .append_event(scope_key, event.clone())
            .map_err(ExecutionError::EventLog)?;
        Ok(ExecutionOutcome::TimeblockStarted { result, event })
    }
}

fn push_unique_tag(tags: &mut Vec<String>, value: &str) {
    if !tags.iter().any(|tag| tag == value) {
        tags.push(value.to_string());
    }
}

fn map_dependencies(dependencies: Vec<ProposalTaskDependency>) -> Vec<TaskDependency> {
    dependencies
        .into_iter()
        .map(|dependency| TaskDependency {
            task_id: dependency.task_id,
            relation_type: dependency.relation_type,
        })
        .collect()
}

fn ensure_dependencies_exist(
    store: &TaskStore,
    scope_key: Option<&str>,
    dependencies: &[TaskDependency],
) -> Result<(), ExecutionError> {
    let missing = dependencies
        .iter()
        .filter(|dependency| store.get_scoped(scope_key, &dependency.task_id).is_none())
        .map(|dependency| dependency.task_id.clone())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(ExecutionError::Task(format!(
            "status=404 error=dependency task not found: {}",
            missing.join(", ")
        )))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::eventlog::EventLogStore;
    use crate::proposal::{ActionType, Proposal, ProposalStatus, Publisher, PublisherType};
    use crate::task::TaskStore;
    use crate::timeblock::TimeBlockStore;

    use super::{ExecutionOutcome, ProposalExecutor};

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

        let outcome = executor
            .execute_scoped(
                None,
                &sample_proposal(
                    ActionType::CreateTask,
                    serde_json::json!({
                        "fields": {
                            "title": "Ship proposal runtime",
                            "tags": ["rt"]
                        }
                    }),
                ),
            )
            .unwrap();

        let tasks = task_store.list();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Ship proposal runtime");
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].tags.iter().any(|tag| tag == "agent-action"));
        match outcome {
            ExecutionOutcome::TaskCreated { task, event } => {
                assert_eq!(task.id, tasks[0].id);
                assert_eq!(event.id, events[0].id);
            }
            _ => panic!("expected task-created outcome"),
        }
    }

    #[test]
    fn execute_update_task_updates_existing_task_and_eventlog() {
        let task_store = Arc::new(TaskStore::new());
        let existing = task_store.create(crate::task::CreateTaskInput {
            title: "Existing task".to_string(),
            description: Some("draft".to_string()),
            done_condition: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        let eventlog_store = Arc::new(EventLogStore::new(
            std::env::temp_dir().join(format!("exomind-proposal-exec-{}", uuid::Uuid::new_v4())),
        ));
        let timeblock_store = Arc::new(TimeBlockStore::new());
        let executor =
            ProposalExecutor::new(task_store.clone(), eventlog_store.clone(), timeblock_store);

        let outcome = executor
            .execute_scoped(
                None,
                &sample_proposal(
                    ActionType::UpdateTask,
                    serde_json::json!({
                        "taskId": existing.id,
                        "patch": {
                            "description": "confirmed",
                            "estimatedMinutes": 45
                        }
                    }),
                ),
            )
            .unwrap();

        let tasks = task_store.list();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].description.as_deref(), Some("confirmed"));
        assert_eq!(tasks[0].estimated_minutes, Some(45));
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].tags.iter().any(|tag| tag == "task.update"));
        match outcome {
            ExecutionOutcome::TaskUpdated { task, event } => {
                assert_eq!(task.id, tasks[0].id);
                assert_eq!(event.id, events[0].id);
            }
            _ => panic!("expected task-updated outcome"),
        }
    }
}
