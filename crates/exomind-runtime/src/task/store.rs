use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::RwLock;

use thiserror::Error;

use super::sqlite_store::SqliteTaskStore;
use super::types::*;

#[derive(Debug, Error)]
pub enum TaskStoreError {
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    #[error("task is in terminal state: {0:?}")]
    TerminalState(TaskStatus),
    #[error("field `{field}` is immutable once task is terminal: {status:?}")]
    TerminalFieldImmutable {
        status: TaskStatus,
        field: &'static str,
    },
    #[error("dependency update would create a cycle for task `{task_id}` via `{dependency_id}`")]
    DependencyCycle {
        task_id: String,
        dependency_id: String,
    },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid stored task status: {0}")]
    InvalidStoredStatus(String),
    #[error("invalid stored task priority: {0}")]
    InvalidStoredPriority(String),
    #[error("missing task status history: {task_id}")]
    MissingStatusHistory { task_id: String },
    #[error("invalid task status history for `{task_id}`: {reason}")]
    InvalidStatusHistory { task_id: String, reason: String },
}

enum TaskStoreBackend {
    Memory(RwLock<HashMap<String, HashMap<String, Task>>>),
    Sqlite(SqliteTaskStore),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStoreBackendKind {
    Memory,
    Sqlite,
}

pub struct TaskStore {
    backend: TaskStoreBackend,
}

impl Default for TaskStore {
    fn default() -> Self {
        Self::new()
    }
}

const DEFAULT_SCOPE_KEY: &str = "anonymous";
pub(crate) const TASK_FIELD_TITLE: &str = "title";
pub(crate) const TASK_FIELD_DESCRIPTION: &str = "description";
pub(crate) const TASK_FIELD_DEPENDS_ON: &str = "depends_on";
pub(crate) const TASK_FIELD_ESTIMATED_MINUTES: &str = "estimated_minutes";

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

fn task_status_storage_key(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Suspended => "suspended",
        TaskStatus::Completed => "completed",
        TaskStatus::Cancelled => "cancelled",
    }
}

fn build_task_status_transition_id(
    task_id: &str,
    to_status: TaskStatus,
    reason: TaskTransitionReason,
    at: u64,
    operation_id: Option<&str>,
) -> String {
    let status_key = task_status_storage_key(to_status);
    match operation_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(operation_id) => format!("{task_id}:{operation_id}:{status_key}"),
        None => format!(
            "{task_id}:{}:{at}:{status_key}",
            reason.as_str().replace('.', "_")
        ),
    }
}

pub(crate) fn build_initial_task_status_transition(
    task_id: &str,
    created_at: u64,
) -> TaskStatusTransition {
    TaskStatusTransition {
        id: build_task_status_transition_id(
            task_id,
            TaskStatus::Pending,
            TaskTransitionReason::TaskCreate,
            created_at,
            None,
        ),
        at: created_at,
        from_status: None,
        to_status: TaskStatus::Pending,
        reason: TaskTransitionReason::TaskCreate,
        actor_id: None,
        source_host_id: None,
        operation_id: None,
        related_time_block_id: None,
        related_time_block_transition_ref: None,
        auto_generated: Some(false),
    }
}

fn sort_task_status_transitions(transitions: &mut [TaskStatusTransition]) {
    transitions.sort_by(|left, right| left.at.cmp(&right.at));
}

fn task_dependency_type_sort_key(relation_type: &TaskDependencyType) -> &'static str {
    match relation_type {
        TaskDependencyType::Soft => "soft",
        TaskDependencyType::Hard => "hard",
    }
}

pub(crate) fn task_replication_revision_projection(task: &Task) -> serde_json::Value {
    let mut tags = task.tags.clone();
    tags.sort();

    let mut depends_on = task.depends_on.clone();
    depends_on.sort_by(|left, right| {
        left.task_id.cmp(&right.task_id).then_with(|| {
            task_dependency_type_sort_key(&left.relation_type)
                .cmp(task_dependency_type_sort_key(&right.relation_type))
        })
    });

    let mut time_block_ids = task.time_block_ids.clone();
    time_block_ids.sort();

    let mut status_transitions = task.status_transitions.clone();
    sort_task_status_transitions(&mut status_transitions);

    serde_json::json!({
        "id": task.id,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "status": task.status,
        "completed_at": task.completed_at,
        "title": task.title,
        "description": task.description,
        "done_condition": task.done_condition,
        "priority": task.priority,
        "tags": tags,
        "source": task.source,
        "parent_id": task.parent_id,
        "depends_on": depends_on,
        "due_at": task.due_at,
        "estimated_minutes": task.estimated_minutes,
        "time_block_ids": time_block_ids,
        "status_transitions": status_transitions,
    })
}

fn task_replication_preference_key(task: &Task) -> Vec<u8> {
    serde_json::to_vec(&task_replication_revision_projection(task)).unwrap_or_default()
}

fn validate_task_history_head(task: &Task) -> Result<&TaskStatusTransition, TaskStoreError> {
    let Some(first_transition) = task.status_transitions.first() else {
        return Err(TaskStoreError::MissingStatusHistory {
            task_id: task.id.clone(),
        });
    };

    if first_transition.from_status.is_some() {
        return Err(TaskStoreError::InvalidStatusHistory {
            task_id: task.id.clone(),
            reason: "first transition must start from null".to_string(),
        });
    }

    if first_transition.to_status != TaskStatus::Pending {
        return Err(TaskStoreError::InvalidStatusHistory {
            task_id: task.id.clone(),
            reason: "first transition must enter pending".to_string(),
        });
    }

    if first_transition.reason != TaskTransitionReason::TaskCreate {
        return Err(TaskStoreError::InvalidStatusHistory {
            task_id: task.id.clone(),
            reason: "first transition must use task.create".to_string(),
        });
    }

    Ok(first_transition)
}

pub(crate) fn normalize_task_status_history(task: &mut Task) {
    if task.status_transitions.is_empty() {
        return;
    }

    sort_task_status_transitions(&mut task.status_transitions);

    if let Some(current_transition) = task.status_transitions.last() {
        task.status = current_transition.to_status;
        task.completed_at = current_transition
            .to_status
            .is_terminal()
            .then_some(current_transition.at);
        if task.updated_at < current_transition.at {
            task.updated_at = current_transition.at;
        }
    }
}

pub(crate) fn validate_task_status_history(task: &Task) -> Result<(), TaskStoreError> {
    let first_transition = validate_task_history_head(task)?;

    let mut seen_transition_ids = HashSet::new();
    if !seen_transition_ids.insert(first_transition.id.clone()) {
        return Err(TaskStoreError::InvalidStatusHistory {
            task_id: task.id.clone(),
            reason: "duplicate transition id in history".to_string(),
        });
    }

    let mut previous_transition = first_transition;
    for transition in task.status_transitions.iter().skip(1) {
        if !seen_transition_ids.insert(transition.id.clone()) {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: "duplicate transition id in history".to_string(),
            });
        }

        if transition.at <= previous_transition.at {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: "transition timestamps must be strictly increasing".to_string(),
            });
        }

        if transition.from_status != Some(previous_transition.to_status) {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: format!(
                    "transition chain is broken between {:?} and {:?}",
                    previous_transition.to_status, transition.to_status
                ),
            });
        }

        if !previous_transition
            .to_status
            .can_transition_to(&transition.to_status)
        {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: format!(
                    "invalid transition from {:?} to {:?}",
                    previous_transition.to_status, transition.to_status
                ),
            });
        }

        previous_transition = transition;
    }

    Ok(())
}

pub(crate) fn validate_partial_task_status_history(task: &Task) -> Result<(), TaskStoreError> {
    let first_transition = validate_task_history_head(task)?;

    let mut seen_transition_ids = HashSet::new();
    if !seen_transition_ids.insert(first_transition.id.clone()) {
        return Err(TaskStoreError::InvalidStatusHistory {
            task_id: task.id.clone(),
            reason: "duplicate transition id in history".to_string(),
        });
    }

    let mut previous_transition = first_transition;
    for transition in task.status_transitions.iter().skip(1) {
        if !seen_transition_ids.insert(transition.id.clone()) {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: "duplicate transition id in history".to_string(),
            });
        }

        if transition.at <= previous_transition.at {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: "transition timestamps must be strictly increasing".to_string(),
            });
        }

        let Some(from_status) = transition.from_status else {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: "non-initial transition must include from_status".to_string(),
            });
        };

        if !from_status.can_transition_to(&transition.to_status) {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: format!(
                    "invalid transition from {:?} to {:?}",
                    from_status, transition.to_status
                ),
            });
        }

        if previous_transition.to_status.path_to(&from_status).is_none() {
            return Err(TaskStoreError::InvalidStatusHistory {
                task_id: task.id.clone(),
                reason: format!(
                    "transition fragment is unreachable from {:?} to {:?}",
                    previous_transition.to_status, from_status
                ),
            });
        }

        previous_transition = transition;
    }

    Ok(())
}

pub(crate) fn prepare_task_for_storage(task: &mut Task) -> Result<(), TaskStoreError> {
    sort_task_status_transitions(&mut task.status_transitions);
    validate_task_status_history(task)?;
    if let Some(first_transition) = task.status_transitions.first() {
        task.created_at = first_transition.at;
    }
    normalize_task_status_history(task);
    Ok(())
}

pub(crate) fn compare_task_replication_preference(existing: &Task, incoming: &Task) -> Ordering {
    if let Some(ordering) = compare_task_status_history(existing, incoming) {
        match ordering {
            Ordering::Equal => {}
            other => return other,
        }
    }

    match incoming.updated_at.cmp(&existing.updated_at) {
        Ordering::Equal => {}
        other => return other,
    }

    match incoming
        .status
        .is_terminal()
        .cmp(&existing.status.is_terminal())
    {
        Ordering::Equal => {}
        other => return other,
    }

    match incoming
        .completed_at
        .unwrap_or(0)
        .cmp(&existing.completed_at.unwrap_or(0))
    {
        Ordering::Equal => {}
        other => return other,
    }

    task_replication_preference_key(incoming).cmp(&task_replication_preference_key(existing))
}

pub(crate) fn compare_task_status_history(existing: &Task, incoming: &Task) -> Option<Ordering> {
    let mut existing_transitions = existing.status_transitions.clone();
    let mut incoming_transitions = incoming.status_transitions.clone();

    sort_task_status_transitions(&mut existing_transitions);
    sort_task_status_transitions(&mut incoming_transitions);

    match (existing_transitions.last(), incoming_transitions.last()) {
        (None, None) => Some(Ordering::Equal),
        (None, Some(_)) => None,
        (Some(_), None) => Some(Ordering::Less),
        (Some(existing_last), Some(incoming_last)) => {
            match incoming_last.at.cmp(&existing_last.at) {
                Ordering::Greater => return Some(Ordering::Greater),
                Ordering::Less => return Some(Ordering::Less),
                Ordering::Equal => {}
            }

            if incoming_transitions == existing_transitions {
                return Some(Ordering::Equal);
            }

            let shorter_len = existing_transitions.len().min(incoming_transitions.len());
            if existing_transitions[..shorter_len] == incoming_transitions[..shorter_len] {
                return Some(incoming_transitions.len().cmp(&existing_transitions.len()));
            }

            None
        }
    }
}

fn transition_fits_between(
    previous: Option<&TaskStatusTransition>,
    candidate: &TaskStatusTransition,
    next: Option<&TaskStatusTransition>,
) -> bool {
    match previous {
        Some(previous) if candidate.from_status != Some(previous.to_status) => return false,
        None if candidate.from_status.is_some() => return false,
        _ => {}
    }

    match next {
        Some(next) => match next.from_status {
            Some(next_from_status) => next_from_status == candidate.to_status,
            None => false,
        },
        None => true,
    }
}

fn merge_task_status_history_with_preference(
    existing: &Task,
    incoming: &Task,
    prefer_incoming: bool,
) -> Vec<TaskStatusTransition> {
    let (preferred, secondary) = if prefer_incoming {
        (incoming, existing)
    } else {
        (existing, incoming)
    };
    let mut merged = preferred.status_transitions.clone();
    sort_task_status_transitions(&mut merged);
    let mut seen = merged
        .iter()
        .map(|transition| transition.id.clone())
        .collect::<HashSet<_>>();

    let mut secondary_transitions = secondary.status_transitions.clone();
    sort_task_status_transitions(&mut secondary_transitions);

    if merged.is_empty() {
        for transition in secondary_transitions {
            if seen.insert(transition.id.clone()) {
                merged.push(transition);
            }
        }
        return merged;
    }

    for transition in secondary_transitions {
        if !seen.insert(transition.id.clone()) {
            continue;
        }

        let insert_at = merged.partition_point(|current| {
            current.at < transition.at
                || (current.at == transition.at && current.id < transition.id)
        });
        let previous = insert_at.checked_sub(1).and_then(|index| merged.get(index));
        let next = merged.get(insert_at);
        if transition_fits_between(previous, &transition, next) {
            merged.insert(insert_at, transition);
        }
    }

    merged
}

pub(crate) fn merge_task_status_history(
    existing: &Task,
    incoming: &Task,
) -> Vec<TaskStatusTransition> {
    merge_task_status_history_with_preference(existing, incoming, false)
}

pub(crate) fn merge_task_snapshot(existing: &Task, incoming: &Task, prefer_incoming: bool) -> Task {
    let mut merged = if prefer_incoming {
        incoming.clone()
    } else {
        existing.clone()
    };
    let existing_revision = task_replication_revision_projection(existing);
    merged.status_transitions =
        merge_task_status_history_with_preference(existing, incoming, prefer_incoming);
    if let Some(first_transition) = merged.status_transitions.first() {
        merged.created_at = merged.created_at.min(first_transition.at);
    }
    normalize_task_status_history(&mut merged);
    if task_replication_revision_projection(&merged) != existing_revision
        && merged.updated_at <= existing.updated_at
    {
        merged.updated_at = existing.updated_at.saturating_add(1);
    }
    merged
}

pub(crate) fn append_task_status_transition(
    task: &mut Task,
    old_status: TaskStatus,
    new_status: TaskStatus,
    context: &TaskTransitionContext,
) -> u64 {
    normalize_task_status_history(task);

    let requested_at = context
        .at
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() as u64);
    let at = task
        .status_transitions
        .last()
        .map(|transition| requested_at.max(transition.at.saturating_add(1)))
        .unwrap_or(requested_at.max(task.created_at));
    let reason = context
        .reason
        .unwrap_or(TaskTransitionReason::TaskTransition);

    task.status_transitions.push(TaskStatusTransition {
        id: build_task_status_transition_id(
            &task.id,
            new_status,
            reason,
            at,
            context.operation_id.as_deref(),
        ),
        at,
        from_status: Some(old_status),
        to_status: new_status,
        reason,
        actor_id: context.actor_id.clone(),
        source_host_id: context.source_host_id.clone(),
        operation_id: context.operation_id.clone(),
        related_time_block_id: context.related_time_block_id.clone(),
        related_time_block_transition_ref: context.related_time_block_transition_ref.clone(),
        auto_generated: context.auto_generated,
    });

    at
}

pub(crate) fn validate_terminal_task_update(
    status: TaskStatus,
    input: &UpdateTaskInput,
) -> Result<(), TaskStoreError> {
    if !status.is_terminal() {
        return Ok(());
    }

    if input.title.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_TITLE,
        });
    }

    if input.description.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_DESCRIPTION,
        });
    }

    if input.depends_on.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_DEPENDS_ON,
        });
    }

    if input.estimated_minutes.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_ESTIMATED_MINUTES,
        });
    }

    Ok(())
}

pub(crate) fn validate_dependency_update<'a>(
    task_id: &str,
    depends_on: &[TaskDependency],
    tasks: impl IntoIterator<Item = &'a Task>,
) -> Result<(), TaskStoreError> {
    let adjacency = tasks
        .into_iter()
        .map(|task| {
            (
                task.id.clone(),
                task.depends_on
                    .iter()
                    .map(|dependency| dependency.task_id.clone())
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<HashMap<_, _>>();

    for dependency in depends_on {
        if dependency.task_id == task_id
            || dependency_reaches_task(&adjacency, &dependency.task_id, task_id)
        {
            return Err(TaskStoreError::DependencyCycle {
                task_id: task_id.to_string(),
                dependency_id: dependency.task_id.clone(),
            });
        }
    }

    Ok(())
}

fn dependency_reaches_task(
    adjacency: &HashMap<String, Vec<String>>,
    start_id: &str,
    target_id: &str,
) -> bool {
    let mut stack = vec![start_id.to_string()];
    let mut visited = HashSet::new();

    while let Some(current) = stack.pop() {
        if current == target_id {
            return true;
        }
        if !visited.insert(current.clone()) {
            continue;
        }
        if let Some(next) = adjacency.get(&current) {
            stack.extend(next.iter().cloned());
        }
    }

    false
}

impl TaskStore {
    pub fn new() -> Self {
        Self {
            backend: TaskStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, TaskStoreError> {
        Ok(Self {
            backend: TaskStoreBackend::Sqlite(SqliteTaskStore::open(path)?),
        })
    }

    pub fn create(&self, input: CreateTaskInput) -> Task {
        self.create_scoped(None, input)
    }

    pub fn create_scoped(&self, scope_key: Option<&str>, input: CreateTaskInput) -> Task {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store
                .create_scoped(normalize_scope_key(scope_key), input)
                .expect("sqlite task creation should succeed");
        }

        let now = chrono::Utc::now().timestamp_millis() as u64;
        let task_id = uuid::Uuid::new_v4().to_string();
        let task = Task {
            id: task_id.clone(),
            title: input.title,
            description: input.description,
            done_condition: input.done_condition,
            status: TaskStatus::Pending,
            priority: input.priority.unwrap_or_default(),
            tags: input.tags,
            source: input.source,
            parent_id: input.parent_id,
            depends_on: input.depends_on,
            due_at: input.due_at,
            estimated_minutes: input.estimated_minutes,
            time_block_ids: input.time_block_ids,
            status_transitions: vec![build_initial_task_status_transition(&task_id, now)],
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        let mut task = task;
        prepare_task_for_storage(&mut task).expect("new task history should be valid");

        let result = task.clone();
        self.with_memory_scope_mut(scope_key, |tasks| {
            tasks.insert(task.id.clone(), task);
        });
        result
    }

    pub fn create_in_scope(&self, scope_key: Option<&str>, input: CreateTaskInput) -> Task {
        self.create_scoped(scope_key, input)
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.get_scoped(None, id)
    }

    pub fn get_scoped(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self.memory_scope(scope_key).get(id).cloned(),
            TaskStoreBackend::Sqlite(store) => store
                .get_scoped(normalize_scope_key(scope_key), id)
                .expect("sqlite task lookup should succeed"),
        }
    }

    pub fn get_in_scope(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        self.get_scoped(scope_key, id)
    }

    pub fn list(&self) -> Vec<Task> {
        self.list_scoped(None)
    }

    pub fn list_scoped(&self, scope_key: Option<&str>) -> Vec<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                let mut list: Vec<Task> = self.memory_scope(scope_key).values().cloned().collect();
                list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                list
            }
            TaskStoreBackend::Sqlite(store) => store
                .list_scoped(normalize_scope_key(scope_key))
                .expect("sqlite task list should succeed"),
        }
    }

    pub fn list_in_scope(&self, scope_key: Option<&str>) -> Vec<Task> {
        self.list_scoped(scope_key)
    }

    pub fn list_by_status(&self, status: &TaskStatus) -> Vec<Task> {
        self.list_by_status_scoped(None, status)
    }

    pub fn list_by_status_scoped(&self, scope_key: Option<&str>, status: &TaskStatus) -> Vec<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self
                .list_scoped(scope_key)
                .into_iter()
                .filter(|t| &t.status == status)
                .collect(),
            TaskStoreBackend::Sqlite(store) => store
                .list_by_status_scoped(normalize_scope_key(scope_key), status)
                .expect("sqlite status filter should succeed"),
        }
    }

    pub fn update(&self, id: &str, input: UpdateTaskInput) -> Result<Task, TaskStoreError> {
        self.update_scoped(None, id, input)
    }

    pub fn update_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        input: UpdateTaskInput,
    ) -> Result<Task, TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.update_scoped(normalize_scope_key(scope_key), id, input);
        }

        self.with_memory_scope_mut(scope_key, |tasks| {
            let current = tasks
                .get(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            validate_terminal_task_update(current.status, &input)?;
            if let Some(depends_on) = input.depends_on.as_ref() {
                validate_dependency_update(id, depends_on, tasks.values())?;
            }

            let task = tasks
                .get_mut(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            if let Some(title) = input.title {
                task.title = title;
            }
            if let Some(description) = input.description {
                task.description = Some(description);
            }
            if let Some(done_condition) = input.done_condition {
                task.done_condition = Some(done_condition);
            }
            if let Some(priority) = input.priority {
                task.priority = priority;
            }
            if let Some(tags) = input.tags {
                task.tags = tags;
            }
            if let Some(depends_on) = input.depends_on {
                task.depends_on = depends_on;
            }
            if let Some(due_at) = input.due_at {
                task.due_at = Some(due_at);
            }
            if let Some(estimated_minutes) = input.estimated_minutes {
                task.estimated_minutes = estimated_minutes;
            }
            if let Some(parent_id) = input.parent_id {
                task.parent_id = Some(parent_id);
            }
            if let Some(time_block_ids) = input.time_block_ids {
                task.time_block_ids = time_block_ids;
            }

            task.updated_at = chrono::Utc::now().timestamp_millis() as u64;
            Ok(task.clone())
        })
    }

    /// Transition task to a new status. Returns (old_status, updated_task).
    pub fn transition(
        &self,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        self.transition_scoped_with_context(None, id, new_status, TaskTransitionContext::default())
    }

    pub fn transition_with_shortcut(
        &self,
        id: &str,
        target_status: TaskStatus,
    ) -> Result<Vec<(TaskStatus, Task)>, TaskStoreError> {
        self.transition_with_shortcut_scoped_with_context(
            None,
            id,
            target_status,
            TaskTransitionContext::default(),
        )
    }

    pub fn transition_with_shortcut_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        target_status: TaskStatus,
    ) -> Result<Vec<(TaskStatus, Task)>, TaskStoreError> {
        self.transition_with_shortcut_scoped_with_context(
            scope_key,
            id,
            target_status,
            TaskTransitionContext::default(),
        )
    }

    pub fn transition_with_shortcut_scoped_with_context(
        &self,
        scope_key: Option<&str>,
        id: &str,
        target_status: TaskStatus,
        context: TaskTransitionContext,
    ) -> Result<Vec<(TaskStatus, Task)>, TaskStoreError> {
        let task = self
            .get_scoped(scope_key, id)
            .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

        if task.status == target_status {
            return Ok(vec![]);
        }

        let path =
            task.status
                .path_to(&target_status)
                .ok_or(TaskStoreError::InvalidTransition {
                    from: task.status,
                    to: target_status,
                })?;

        let steps = if path.is_empty() {
            vec![target_status]
        } else {
            path
        };

        let mut results = Vec::with_capacity(steps.len());
        for (index, step) in steps.into_iter().enumerate() {
            let mut step_context = context.clone();
            if let Some(operation_id) = context.operation_id.as_deref() {
                step_context.operation_id = Some(format!("{operation_id}:step:{index:04}"));
            }
            if let Some(at) = context.at {
                step_context.at = Some(at.saturating_add(index as u64));
            }
            results.push(self.transition_scoped_with_context(scope_key, id, step, step_context)?);
        }

        Ok(results)
    }

    pub fn transition_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        self.transition_scoped_with_context(
            scope_key,
            id,
            new_status,
            TaskTransitionContext::default(),
        )
    }

    pub fn transition_scoped_with_context(
        &self,
        scope_key: Option<&str>,
        id: &str,
        new_status: TaskStatus,
        context: TaskTransitionContext,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.transition_scoped_with_context(
                normalize_scope_key(scope_key),
                id,
                new_status,
                context,
            );
        }

        self.with_memory_scope_mut(scope_key, |tasks| {
            let task = tasks
                .get_mut(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            prepare_task_for_storage(task)?;
            if !task.status.can_transition_to(&new_status) {
                return Err(TaskStoreError::InvalidTransition {
                    from: task.status,
                    to: new_status,
                });
            }

            let old_status = task.status;
            let now = append_task_status_transition(task, old_status, new_status, &context);
            task.status = new_status;
            task.updated_at = now;
            task.completed_at = new_status.is_terminal().then_some(now);

            Ok((old_status, task.clone()))
        })
    }

    /// Cancel a task (set status to Cancelled). Used by the HTTP cancel endpoint.
    pub fn cancel(&self, id: &str) -> Result<Task, TaskStoreError> {
        self.cancel_scoped_with_context(None, id, TaskTransitionContext::default())
    }

    pub fn cancel_scoped(&self, scope_key: Option<&str>, id: &str) -> Result<Task, TaskStoreError> {
        self.cancel_scoped_with_context(scope_key, id, TaskTransitionContext::default())
    }

    pub fn cancel_scoped_with_context(
        &self,
        scope_key: Option<&str>,
        id: &str,
        context: TaskTransitionContext,
    ) -> Result<Task, TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.cancel_scoped_with_context(normalize_scope_key(scope_key), id, context);
        }
        self.with_memory_scope_mut(scope_key, |tasks| {
            let task = tasks
                .get_mut(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            prepare_task_for_storage(task)?;
            if task.status.is_terminal() {
                return Err(TaskStoreError::InvalidTransition {
                    from: task.status,
                    to: TaskStatus::Cancelled,
                });
            }

            let old_status = task.status;
            let now =
                append_task_status_transition(task, old_status, TaskStatus::Cancelled, &context);
            task.status = TaskStatus::Cancelled;
            task.updated_at = now;
            task.completed_at = Some(now);

            Ok(task.clone())
        })
    }

    /// Hard remove from store. Returns the removed task if it existed.
    pub fn remove(&self, id: &str) -> Option<Task> {
        self.remove_scoped(None, id)
    }

    pub fn remove_scoped(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |tasks| tasks.remove(id))
            }
            TaskStoreBackend::Sqlite(store) => store
                .remove_scoped(normalize_scope_key(scope_key), id)
                .expect("sqlite task removal should succeed"),
        }
    }

    pub fn len(&self) -> usize {
        self.len_scoped(None)
    }

    pub fn is_empty(&self) -> bool {
        self.is_empty_scoped(None)
    }

    pub fn len_scoped(&self, scope_key: Option<&str>) -> usize {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self.memory_scope(scope_key).len(),
            TaskStoreBackend::Sqlite(store) => store
                .len_scoped(normalize_scope_key(scope_key))
                .expect("sqlite task len should succeed"),
        }
    }

    pub fn is_empty_scoped(&self, scope_key: Option<&str>) -> bool {
        self.len_scoped(scope_key) == 0
    }

    pub fn upsert(&self, task: Task) -> Result<Task, TaskStoreError> {
        self.upsert_scoped(None, task)
    }

    pub fn upsert_scoped(
        &self,
        scope_key: Option<&str>,
        mut task: Task,
    ) -> Result<Task, TaskStoreError> {
        prepare_task_for_storage(&mut task)?;
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |tasks| {
                    tasks.insert(task.id.clone(), task.clone());
                });
                Ok(task)
            }
            TaskStoreBackend::Sqlite(store) => {
                store.upsert_scoped(normalize_scope_key(scope_key), &task)?;
                Ok(task)
            }
        }
    }

    pub fn replace_all(&self, tasks: &[Task]) -> Result<(), TaskStoreError> {
        self.replace_all_scoped(None, tasks)
    }

    pub fn replace_all_scoped(
        &self,
        scope_key: Option<&str>,
        tasks: &[Task],
    ) -> Result<(), TaskStoreError> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |guard| -> Result<(), TaskStoreError> {
                    guard.clear();
                    for task in tasks {
                        let mut normalized = task.clone();
                        prepare_task_for_storage(&mut normalized)?;
                        guard.insert(normalized.id.clone(), normalized);
                    }
                    Ok(())
                })?;
                Ok(())
            }
            TaskStoreBackend::Sqlite(store) => {
                store.replace_all_scoped(normalize_scope_key(scope_key), tasks)
            }
        }
    }

    pub fn sqlite_snapshot_bytes(&self) -> Result<Option<Vec<u8>>, TaskStoreError> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => Ok(None),
            TaskStoreBackend::Sqlite(store) => store.snapshot_bytes().map(Some),
        }
    }

    pub fn backend_kind(&self) -> TaskStoreBackendKind {
        match &self.backend {
            TaskStoreBackend::Memory(_) => TaskStoreBackendKind::Memory,
            TaskStoreBackend::Sqlite(_) => TaskStoreBackendKind::Sqlite,
        }
    }

    fn memory_scope(&self, scope_key: Option<&str>) -> HashMap<String, Task> {
        let normalized_scope = normalize_scope_key(scope_key);
        match &self.backend {
            TaskStoreBackend::Memory(tasks) => tasks
                .read()
                .unwrap()
                .get(normalized_scope)
                .cloned()
                .unwrap_or_default(),
            TaskStoreBackend::Sqlite(_) => {
                unreachable!("memory-only helper used on sqlite backend")
            }
        }
    }

    fn with_memory_scope_mut<R>(
        &self,
        scope_key: Option<&str>,
        f: impl FnOnce(&mut HashMap<String, Task>) -> R,
    ) -> R {
        let normalized_scope = normalize_scope_key(scope_key).to_string();
        match &self.backend {
            TaskStoreBackend::Memory(tasks) => {
                let mut guard = tasks.write().unwrap();
                let scope_tasks = guard.entry(normalized_scope).or_default();
                f(scope_tasks)
            }
            TaskStoreBackend::Sqlite(_) => {
                unreachable!("memory-only helper used on sqlite backend")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn make_store() -> TaskStore {
        TaskStore::new()
    }

    fn create_input(title: &str) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_string(),
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
        }
    }

    #[test]
    fn sqlite_store_persists_tasks_across_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(create_input("Persist me"));
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .expect("task should persist in sqlite");
        assert_eq!(loaded.title, "Persist me");
        assert_eq!(reopened.len(), 1);
    }

    #[test]
    fn sqlite_store_migrates_legacy_status_values_on_open() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let legacy_pending = store.create(create_input("Legacy pending"));
        let legacy_cancelled = store.create(create_input("Legacy cancelled"));
        store
            .transition(&legacy_cancelled.id, TaskStatus::InProgress)
            .unwrap();
        store.cancel(&legacy_cancelled.id).unwrap();
        drop(store);

        {
            let conn = Connection::open(&sqlite_path).unwrap();
            conn.execute(
                "UPDATE tasks SET status = 'not_started' WHERE id = ?1",
                [&legacy_pending.id],
            )
            .unwrap();
            conn.execute(
                "UPDATE tasks SET status = 'abandoned' WHERE id = ?1",
                [&legacy_cancelled.id],
            )
            .unwrap();
        }

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        assert_eq!(
            reopened.get(&legacy_pending.id).unwrap().status,
            TaskStatus::Pending
        );
        assert_eq!(
            reopened.get(&legacy_cancelled.id).unwrap().status,
            TaskStatus::Cancelled
        );

        let conn = Connection::open(&sqlite_path).unwrap();
        let pending_status: String = conn
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                [&legacy_pending.id],
                |row| row.get(0),
            )
            .unwrap();
        let cancelled_status: String = conn
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                [&legacy_cancelled.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending_status, "pending");
        assert_eq!(cancelled_status, "cancelled");
    }

    #[test]
    fn sqlite_store_isolates_tasks_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let anonymous = store.create(create_input("Task anonymous"));
        let profile_a = store.create_scoped(Some("profile-a"), create_input("Task A"));
        let profile_b = store.create_scoped(Some("profile-b"), create_input("Task B"));

        let tasks_anonymous = store.list();
        let tasks_a = store.list_scoped(Some("profile-a"));
        let tasks_b = store.list_scoped(Some("profile-b"));

        assert_eq!(tasks_anonymous.len(), 1);
        assert_eq!(tasks_anonymous[0].id, anonymous.id);
        assert_eq!(tasks_a.len(), 1);
        assert_eq!(tasks_a[0].id, profile_a.id);
        assert_eq!(tasks_b.len(), 1);
        assert_eq!(tasks_b[0].id, profile_b.id);
        assert!(store.get_scoped(Some("profile-a"), &profile_b.id).is_none());
        assert!(store.get_scoped(Some("profile-b"), &profile_a.id).is_none());
        assert!(store.get_scoped(Some("profile-a"), &anonymous.id).is_none());
    }

    #[test]
    fn sqlite_store_roundtrips_extended_task_fields() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(CreateTaskInput {
            title: "Extended".to_string(),
            description: Some("Task body".to_string()),
            priority: Some(TaskPriority::High),
            tags: vec!["rt".to_string(), "sqlite".to_string()],
            source: Some("frontend:test".to_string()),
            parent_id: Some("parent-1".to_string()),
            due_at: Some(1_700_000_000_000),
            estimated_minutes: Some(45),
            done_condition: Some("all checks green".to_string()),
            depends_on: vec![],
            time_block_ids: vec![],
        });
        let updated = store
            .update(
                &created.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    priority: None,
                    tags: None,
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    done_condition: Some("ship RT sqlite".to_string()),
                    depends_on: Some(vec![TaskDependency {
                        task_id: "dep-1".to_string(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    time_block_ids: Some(vec!["block-1".to_string(), "block-2".to_string()]),
                },
            )
            .unwrap();
        assert_eq!(updated.done_condition.as_deref(), Some("ship RT sqlite"));
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .expect("extended task should persist");
        assert_eq!(loaded.done_condition.as_deref(), Some("ship RT sqlite"));
        assert_eq!(loaded.depends_on.len(), 1);
        assert_eq!(loaded.depends_on[0].task_id, "dep-1");
        assert_eq!(loaded.depends_on[0].relation_type, TaskDependencyType::Hard);
        assert_eq!(
            loaded.time_block_ids,
            vec!["block-1".to_string(), "block-2".to_string()]
        );
    }

    #[test]
    fn create_and_get() {
        let store = make_store();
        let task = store.create(create_input("Buy milk"));
        assert_eq!(task.title, "Buy milk");
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.priority, TaskPriority::Medium);
        assert_eq!(task.status_transitions.len(), 1);
        assert_eq!(task.status_transitions[0].from_status, None);
        assert_eq!(task.status_transitions[0].to_status, TaskStatus::Pending);
        assert_eq!(
            task.status_transitions[0].reason,
            TaskTransitionReason::TaskCreate
        );

        let fetched = store.get(&task.id).unwrap();
        assert_eq!(fetched.id, task.id);
        assert_eq!(fetched.status_transitions.len(), 1);
    }

    #[test]
    fn sqlite_replace_all_roundtrips_status_transition_history() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(create_input("Replace me"));
        let transitioned = store
            .transition(&created.id, TaskStatus::InProgress)
            .unwrap()
            .1;

        store.replace_all(&[transitioned.clone()]).unwrap();
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened.get(&created.id).expect("task should persist");
        assert_eq!(loaded.status, TaskStatus::InProgress);
        assert_eq!(loaded.status_transitions, transitioned.status_transitions);
    }

    #[test]
    fn sqlite_init_preserves_empty_status_history_from_legacy_schema() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-tasks.sqlite");
        let connection = rusqlite::Connection::open(&sqlite_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NULL,
                    done_condition TEXT NULL,
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    source TEXT NULL,
                    parent_id TEXT NULL,
                    depends_on_json TEXT NOT NULL,
                    due_at INTEGER NULL,
                    estimated_minutes INTEGER NULL,
                    time_block_ids_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    completed_at INTEGER NULL
                );
                INSERT INTO tasks (
                    id, title, description, done_condition, status, priority, tags_json, source,
                    parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                    created_at, updated_at, completed_at
                ) VALUES (
                    'legacy-task',
                    'Legacy task',
                    null,
                    null,
                    'completed',
                    'medium',
                    '[]',
                    null,
                    null,
                    '[]',
                    null,
                    null,
                    '[]',
                    1000,
                    5000,
                    5000
                );",
            )
            .unwrap();
        drop(connection);

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let task = store
            .get("legacy-task")
            .expect("legacy task should remain readable");
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.completed_at, Some(5000));
        assert!(task.status_transitions.is_empty());
    }

    #[test]
    fn sqlite_init_preserves_empty_in_progress_history_from_legacy_schema() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-tasks-in-progress.sqlite");
        let connection = rusqlite::Connection::open(&sqlite_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NULL,
                    done_condition TEXT NULL,
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    source TEXT NULL,
                    parent_id TEXT NULL,
                    depends_on_json TEXT NOT NULL,
                    due_at INTEGER NULL,
                    estimated_minutes INTEGER NULL,
                    time_block_ids_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    completed_at INTEGER NULL
                );
                INSERT INTO tasks (
                    id, title, description, done_condition, status, priority, tags_json, source,
                    parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                    created_at, updated_at, completed_at
                ) VALUES (
                    'legacy-task-active',
                    'Legacy active task',
                    null,
                    null,
                    'in_progress',
                    'medium',
                    '[]',
                    null,
                    null,
                    '[]',
                    null,
                    null,
                    '[]',
                    1000,
                    5000,
                    null
                );",
            )
            .unwrap();
        drop(connection);

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let task = store
            .get("legacy-task-active")
            .expect("legacy active task should remain readable");
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.completed_at, None);
        assert!(task.status_transitions.is_empty());
    }

    #[test]
    fn upsert_rejects_empty_status_history_snapshot() {
        let store = make_store();
        let created = store.create(create_input("Missing history"));
        let invalid = Task {
            status_transitions: vec![],
            ..created
        };

        assert!(matches!(
            store.upsert(invalid),
            Err(TaskStoreError::MissingStatusHistory { .. })
        ));
    }

    #[test]
    fn upsert_rejects_malformed_status_history_snapshot() {
        let store = make_store();
        let created = store.create(create_input("Malformed history"));
        let invalid = Task {
            status: TaskStatus::Completed,
            updated_at: created.updated_at.saturating_add(10),
            completed_at: Some(created.updated_at.saturating_add(10)),
            status_transitions: vec![
                build_initial_task_status_transition(&created.id, created.created_at),
                TaskStatusTransition {
                    id: format!("{}:broken-terminal", created.id),
                    at: created.updated_at.saturating_add(10),
                    from_status: Some(TaskStatus::Suspended),
                    to_status: TaskStatus::Completed,
                    reason: TaskTransitionReason::TaskTransition,
                    actor_id: None,
                    source_host_id: None,
                    operation_id: Some("broken-terminal".to_string()),
                    related_time_block_id: None,
                    related_time_block_transition_ref: None,
                    auto_generated: Some(false),
                },
            ],
            ..created
        };

        assert!(matches!(
            store.upsert(invalid),
            Err(TaskStoreError::InvalidStatusHistory { .. })
        ));
    }

    #[test]
    fn list_returns_newest_first() {
        let store = make_store();
        let t1 = store.create(create_input("First"));
        let t2 = store.create(create_input("Second"));

        let list = store.list();
        assert_eq!(list.len(), 2);
        // Newest first (t2 created after t1, but timestamps might be same ms)
        // Just verify both are present
        let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&t1.id.as_str()));
        assert!(ids.contains(&t2.id.as_str()));
    }

    #[test]
    fn list_by_status() {
        let store = make_store();
        let t1 = store.create(create_input("Task 1"));
        store.create(create_input("Task 2"));
        store.transition(&t1.id, TaskStatus::InProgress).unwrap();

        let in_progress = store.list_by_status(&TaskStatus::InProgress);
        assert_eq!(in_progress.len(), 1);
        assert_eq!(in_progress[0].id, t1.id);

        let pending = store.list_by_status(&TaskStatus::Pending);
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn update_fields() {
        let store = make_store();
        let task = store.create(create_input("Original"));

        let updated = store
            .update(
                &task.id,
                UpdateTaskInput {
                    title: Some("Updated".to_string()),
                    description: Some("A description".to_string()),
                    done_condition: None,
                    priority: Some(TaskPriority::High),
                    tags: Some(vec!["urgent".to_string()]),
                    depends_on: None,
                    due_at: None,
                    estimated_minutes: Some(Some(60)),
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        assert_eq!(updated.title, "Updated");
        assert_eq!(updated.description.as_deref(), Some("A description"));
        assert_eq!(updated.priority, TaskPriority::High);
        assert_eq!(updated.tags, vec!["urgent"]);
        assert_eq!(updated.estimated_minutes, Some(60));
        assert!(updated.updated_at >= task.updated_at);
    }

    #[test]
    fn update_not_found() {
        let store = make_store();
        let result = store.update(
            "nonexistent",
            UpdateTaskInput {
                title: Some("X".to_string()),
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(result, Err(TaskStoreError::NotFound(_))));
    }

    #[test]
    fn update_terminal_task_rejects_description_changes() {
        let store = make_store();
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: Some("Still editable".to_string()),
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );

        assert!(matches!(
            result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_DESCRIPTION,
                ..
            })
        ));
    }

    #[test]
    fn update_terminal_task_rejects_title_changes() {
        let store = make_store();
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: Some("Retitled".to_string()),
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );

        assert!(matches!(
            result,
            Err(TaskStoreError::TerminalFieldImmutable { field: "title", .. })
        ));
    }

    #[test]
    fn update_terminal_task_rejects_dependency_changes() {
        let store = make_store();
        let upstream = store.create(create_input("Upstream"));
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: Some(vec![TaskDependency {
                    task_id: upstream.id,
                    relation_type: TaskDependencyType::Hard,
                }]),
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(
            result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_DEPENDS_ON,
                ..
            })
        ));
    }

    #[test]
    fn update_terminal_task_rejects_estimated_minutes_changes() {
        let store = make_store();
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: Some(Some(25)),
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(
            result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_ESTIMATED_MINUTES,
                ..
            })
        ));
    }

    #[test]
    fn active_task_can_depend_on_terminal_upstream() {
        let store = make_store();
        let upstream = store.create(create_input("Finished upstream"));
        let downstream = store.create(create_input("Still active"));
        store
            .transition(&upstream.id, TaskStatus::InProgress)
            .unwrap();
        store
            .transition(&upstream.id, TaskStatus::Completed)
            .unwrap();

        let updated = store
            .update(
                &downstream.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![TaskDependency {
                        task_id: upstream.id.clone(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        assert_eq!(updated.depends_on.len(), 1);
        assert_eq!(updated.depends_on[0].task_id, upstream.id);
    }

    #[test]
    fn update_rejects_direct_self_dependency_cycle() {
        let store = make_store();
        let task = store.create(create_input("Self"));

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: Some(vec![TaskDependency {
                    task_id: task.id.clone(),
                    relation_type: TaskDependencyType::Hard,
                }]),
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );

        assert!(matches!(
            result,
            Err(TaskStoreError::DependencyCycle { .. })
        ));
    }

    #[test]
    fn update_rejects_indirect_dependency_cycle() {
        let store = make_store();
        let task_a = store.create(create_input("A"));
        let task_b = store.create(create_input("B"));
        let task_c = store.create(create_input("C"));

        store
            .update(
                &task_a.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![TaskDependency {
                        task_id: task_b.id.clone(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();
        store
            .update(
                &task_b.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![TaskDependency {
                        task_id: task_c.id.clone(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        let result = store.update(
            &task_c.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: Some(vec![TaskDependency {
                    task_id: task_a.id.clone(),
                    relation_type: TaskDependencyType::Hard,
                }]),
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );

        assert!(matches!(
            result,
            Err(TaskStoreError::DependencyCycle {
                task_id,
                dependency_id,
            }) if task_id == task_c.id && dependency_id == task_a.id
        ));
    }

    #[test]
    fn sqlite_terminal_task_update_closure_matches_memory() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");
        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let upstream = store.create(create_input("Upstream"));
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let description_result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: Some("Still editable".to_string()),
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(
            description_result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_DESCRIPTION,
                ..
            })
        ));

        let dependency_result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: Some(vec![TaskDependency {
                    task_id: upstream.id,
                    relation_type: TaskDependencyType::Hard,
                }]),
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(
            dependency_result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_DEPENDS_ON,
                ..
            })
        ));

        let estimate_result = store.update(
            &task.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: Some(Some(25)),
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(
            estimate_result,
            Err(TaskStoreError::TerminalFieldImmutable {
                field: TASK_FIELD_ESTIMATED_MINUTES,
                ..
            })
        ));
    }

    #[test]
    fn sqlite_update_rejects_indirect_dependency_cycle() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");
        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let task_a = store.create(create_input("A"));
        let task_b = store.create(create_input("B"));
        let task_c = store.create(create_input("C"));

        store
            .update(
                &task_a.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![TaskDependency {
                        task_id: task_b.id.clone(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();
        store
            .update(
                &task_b.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![TaskDependency {
                        task_id: task_c.id.clone(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        let result = store.update(
            &task_c.id,
            UpdateTaskInput {
                title: None,
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: Some(vec![TaskDependency {
                    task_id: task_a.id.clone(),
                    relation_type: TaskDependencyType::Hard,
                }]),
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );

        assert!(matches!(
            result,
            Err(TaskStoreError::DependencyCycle {
                task_id,
                dependency_id,
            }) if task_id == task_c.id && dependency_id == task_a.id
        ));
    }

    #[test]
    fn transition_happy_path() {
        let store = make_store();
        let task = store.create(create_input("My task"));

        let (old, updated) = store.transition(&task.id, TaskStatus::InProgress).unwrap();
        assert_eq!(old, TaskStatus::Pending);
        assert_eq!(updated.status, TaskStatus::InProgress);
        assert!(updated.completed_at.is_none());

        let (old, updated) = store.transition(&task.id, TaskStatus::Completed).unwrap();
        assert_eq!(old, TaskStatus::InProgress);
        assert_eq!(updated.status, TaskStatus::Completed);
        assert!(updated.completed_at.is_some());
    }

    #[test]
    fn transition_invalid() {
        let store = make_store();
        let task = store.create(create_input("Task"));

        let result = store.transition(&task.id, TaskStatus::Completed);
        assert!(matches!(
            result,
            Err(TaskStoreError::InvalidTransition { .. })
        ));
    }

    #[test]
    fn transition_with_shortcut_walks_intermediates() {
        let store = make_store();
        let task = store.create(create_input("Shortcut task"));

        let steps = store
            .transition_with_shortcut(&task.id, TaskStatus::Completed)
            .unwrap();

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].0, TaskStatus::Pending);
        assert_eq!(steps[0].1.status, TaskStatus::InProgress);
        assert_eq!(steps[1].0, TaskStatus::InProgress);
        assert_eq!(steps[1].1.status, TaskStatus::Completed);

        let final_task = store.get(&task.id).unwrap();
        assert_eq!(final_task.status, TaskStatus::Completed);
    }

    #[test]
    fn transition_with_shortcut_sqlite_keeps_final_status_with_shared_operation_id() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("shortcut.sqlite");
        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let task = store.create(create_input("Shortcut sqlite task"));
        let base_at = task.created_at.saturating_add(1_000);

        let steps = store
            .transition_with_shortcut_scoped_with_context(
                None,
                &task.id,
                TaskStatus::Completed,
                TaskTransitionContext {
                    at: Some(base_at),
                    reason: Some(TaskTransitionReason::TaskTransition),
                    operation_id: Some("shortcut-op".to_string()),
                    ..TaskTransitionContext::default()
                },
            )
            .unwrap();

        assert_eq!(steps.len(), 2);
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let final_task = reopened.get(&task.id).unwrap();
        assert_eq!(final_task.status, TaskStatus::Completed);
        assert_eq!(
            final_task
                .status_transitions
                .last()
                .map(|transition| transition.to_status),
            Some(TaskStatus::Completed)
        );
        assert_eq!(
            final_task.status_transitions[1].operation_id.as_deref(),
            Some("shortcut-op:step:0000")
        );
        assert_eq!(
            final_task.status_transitions[2].operation_id.as_deref(),
            Some("shortcut-op:step:0001")
        );
    }

    #[test]
    fn merge_task_snapshot_prefers_winning_terminal_branch() {
        let store = make_store();
        let task = store.create(create_input("Conflict task"));
        let in_progress = store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap()
            .1;
        let completed = store.transition(&task.id, TaskStatus::Completed).unwrap().1;

        let cancelled_at = completed.updated_at.saturating_add(10);
        let mut cancelled = in_progress.clone();
        cancelled.status = TaskStatus::Cancelled;
        cancelled.updated_at = cancelled_at;
        cancelled.completed_at = Some(cancelled_at);
        cancelled.status_transitions.push(TaskStatusTransition {
            id: format!("{}:remote-cancelled", task.id),
            at: cancelled_at,
            from_status: Some(TaskStatus::InProgress),
            to_status: TaskStatus::Cancelled,
            reason: TaskTransitionReason::TaskTransition,
            actor_id: Some("remote".to_string()),
            source_host_id: Some("remote-host".to_string()),
            operation_id: Some("remote-cancelled".to_string()),
            related_time_block_id: None,
            related_time_block_transition_ref: None,
            auto_generated: Some(false),
        });

        let merged = merge_task_snapshot(&completed, &cancelled, true);
        assert_eq!(merged.status, TaskStatus::Cancelled);
        assert_eq!(merged.completed_at, Some(cancelled_at));
        assert_eq!(
            merged
                .status_transitions
                .iter()
                .filter(|transition| transition.to_status == TaskStatus::Completed)
                .count(),
            0
        );
        assert_eq!(
            merged
                .status_transitions
                .last()
                .map(|transition| transition.to_status),
            Some(TaskStatus::Cancelled)
        );
    }

    #[test]
    fn compare_task_replication_preference_uses_deterministic_snapshot_order() {
        let store = make_store();
        let task = store.create(create_input("Conflict task"));
        let mut alpha = task.clone();
        alpha.title = "Alpha".to_string();
        let mut beta = task.clone();
        beta.title = "Beta".to_string();

        assert_eq!(
            compare_task_replication_preference(&alpha, &beta),
            Ordering::Greater
        );
        assert_eq!(
            compare_task_replication_preference(&beta, &alpha),
            Ordering::Less
        );
    }

    #[test]
    fn merge_task_snapshot_bumps_updated_at_when_revision_changes_at_same_watermark() {
        let store = make_store();
        let task = store.create(create_input("Watermark task"));
        let mut existing = store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap()
            .1;
        existing.updated_at = existing.updated_at.saturating_add(10);

        let completion_at = existing.updated_at;
        let mut incoming = existing.clone();
        incoming.status = TaskStatus::Completed;
        incoming.completed_at = Some(completion_at);
        incoming.status_transitions.push(TaskStatusTransition {
            id: format!("{}:remote-completed", task.id),
            at: completion_at,
            from_status: Some(TaskStatus::InProgress),
            to_status: TaskStatus::Completed,
            reason: TaskTransitionReason::TaskTransition,
            actor_id: Some("remote".to_string()),
            source_host_id: Some("remote-host".to_string()),
            operation_id: Some("remote-completed".to_string()),
            related_time_block_id: None,
            related_time_block_transition_ref: None,
            auto_generated: Some(false),
        });

        let merged = merge_task_snapshot(&existing, &incoming, true);
        assert_eq!(merged.status, TaskStatus::Completed);
        assert_eq!(merged.completed_at, Some(completion_at));
        assert_eq!(merged.updated_at, existing.updated_at.saturating_add(1));
    }

    #[test]
    fn transition_with_context_clamps_at_after_last_history_in_memory_store() {
        let store = make_store();
        let task = store.create(create_input("Clamp memory"));
        let in_progress = store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap()
            .1;

        let (_, suspended) = store
            .transition_scoped_with_context(
                None,
                &task.id,
                TaskStatus::Suspended,
                TaskTransitionContext {
                    at: Some(task.created_at),
                    ..TaskTransitionContext::default()
                },
            )
            .unwrap();

        assert_eq!(suspended.status, TaskStatus::Suspended);
        assert_eq!(
            suspended
                .status_transitions
                .last()
                .map(|transition| transition.to_status),
            Some(TaskStatus::Suspended)
        );
        assert!(suspended.updated_at > in_progress.updated_at);
    }

    #[test]
    fn transition_with_context_clamps_at_after_last_history_in_sqlite_store() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("clamp-context.sqlite");
        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let task = store.create(create_input("Clamp sqlite"));
        let in_progress = store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap()
            .1;

        let (_, suspended) = store
            .transition_scoped_with_context(
                None,
                &task.id,
                TaskStatus::Suspended,
                TaskTransitionContext {
                    at: Some(task.created_at),
                    ..TaskTransitionContext::default()
                },
            )
            .unwrap();

        assert_eq!(suspended.status, TaskStatus::Suspended);
        assert_eq!(
            suspended
                .status_transitions
                .last()
                .map(|transition| transition.to_status),
            Some(TaskStatus::Suspended)
        );
        assert!(suspended.updated_at > in_progress.updated_at);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let persisted = reopened.get(&task.id).expect("sqlite task should persist");
        assert_eq!(persisted.status, TaskStatus::Suspended);
        assert_eq!(
            persisted
                .status_transitions
                .last()
                .map(|transition| transition.to_status),
            Some(TaskStatus::Suspended)
        );
        assert_eq!(persisted.updated_at, suspended.updated_at);
    }

    #[test]
    fn cancel() {
        let store = make_store();
        let task = store.create(create_input("Task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();

        let cancelled = store.cancel(&task.id).unwrap();
        assert_eq!(cancelled.status, TaskStatus::Cancelled);
        assert!(cancelled.completed_at.is_some());
    }

    #[test]
    fn cancel_pending_task() {
        let store = make_store();
        let task = store.create(create_input("Pending task"));

        let cancelled = store.cancel(&task.id).unwrap();
        assert_eq!(cancelled.status, TaskStatus::Cancelled);
        assert!(cancelled.completed_at.is_some());
    }

    #[test]
    fn remove() {
        let store = make_store();
        let task = store.create(create_input("To remove"));
        assert_eq!(store.len(), 1);

        let removed = store.remove(&task.id).unwrap();
        assert_eq!(removed.id, task.id);
        assert_eq!(store.len(), 0);
        assert!(store.get(&task.id).is_none());
    }
}
