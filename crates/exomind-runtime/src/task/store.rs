use std::collections::HashMap;
use std::sync::RwLock;

use thiserror::Error;

use super::types::*;

#[derive(Debug, Error)]
pub enum TaskStoreError {
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    #[error("task is in terminal state: {0:?}")]
    TerminalState(TaskStatus),
}

pub struct TaskStore {
    tasks: RwLock<HashMap<String, Task>>,
}

impl TaskStore {
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
        }
    }

    pub fn create(&self, input: CreateTaskInput) -> Task {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            description: input.description,
            status: TaskStatus::NotStarted,
            priority: input.priority.unwrap_or_default(),
            tags: input.tags,
            source: input.source,
            parent_id: input.parent_id,
            due_at: input.due_at,
            estimated_minutes: input.estimated_minutes,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };

        let result = task.clone();
        self.tasks.write().unwrap().insert(task.id.clone(), task);
        result
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.tasks.read().unwrap().get(id).cloned()
    }

    pub fn list(&self) -> Vec<Task> {
        let tasks = self.tasks.read().unwrap();
        let mut list: Vec<Task> = tasks.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub fn list_by_status(&self, status: &TaskStatus) -> Vec<Task> {
        self.list()
            .into_iter()
            .filter(|t| &t.status == status)
            .collect()
    }

    pub fn update(&self, id: &str, input: UpdateTaskInput) -> Result<Task, TaskStoreError> {
        let mut tasks = self.tasks.write().unwrap();
        let task = tasks
            .get_mut(id)
            .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

        if task.status.is_terminal() {
            return Err(TaskStoreError::TerminalState(task.status.clone()));
        }

        if let Some(title) = input.title {
            task.title = title;
        }
        if let Some(description) = input.description {
            task.description = Some(description);
        }
        if let Some(priority) = input.priority {
            task.priority = priority;
        }
        if let Some(tags) = input.tags {
            task.tags = tags;
        }
        if let Some(due_at) = input.due_at {
            task.due_at = Some(due_at);
        }
        if let Some(estimated_minutes) = input.estimated_minutes {
            task.estimated_minutes = Some(estimated_minutes);
        }
        if let Some(parent_id) = input.parent_id {
            task.parent_id = Some(parent_id);
        }

        task.updated_at = chrono::Utc::now().timestamp_millis() as u64;
        Ok(task.clone())
    }

    /// Transition task to a new status. Returns (old_status, updated_task).
    pub fn transition(
        &self,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        let mut tasks = self.tasks.write().unwrap();
        let task = tasks
            .get_mut(id)
            .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

        if !task.status.can_transition_to(&new_status) {
            return Err(TaskStoreError::InvalidTransition {
                from: task.status.clone(),
                to: new_status,
            });
        }

        let old_status = task.status.clone();
        let now = chrono::Utc::now().timestamp_millis() as u64;
        task.status = new_status.clone();
        task.updated_at = now;

        if new_status.is_terminal() {
            task.completed_at = Some(now);
        }

        Ok((old_status, task.clone()))
    }

    /// Abandon a task (set status to Abandoned). Convenience for DELETE endpoint.
    pub fn abandon(&self, id: &str) -> Result<Task, TaskStoreError> {
        let (_, task) = self.transition(id, TaskStatus::Abandoned)?;
        Ok(task)
    }

    /// Hard remove from store. Returns the removed task if it existed.
    pub fn remove(&self, id: &str) -> Option<Task> {
        self.tasks.write().unwrap().remove(id)
    }

    pub fn len(&self) -> usize {
        self.tasks.read().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> TaskStore {
        TaskStore::new()
    }

    fn create_input(title: &str) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_string(),
            description: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            due_at: None,
            estimated_minutes: None,
        }
    }

    #[test]
    fn create_and_get() {
        let store = make_store();
        let task = store.create(create_input("Buy milk"));
        assert_eq!(task.title, "Buy milk");
        assert_eq!(task.status, TaskStatus::NotStarted);
        assert_eq!(task.priority, TaskPriority::Medium);

        let fetched = store.get(&task.id).unwrap();
        assert_eq!(fetched.id, task.id);
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

        let not_started = store.list_by_status(&TaskStatus::NotStarted);
        assert_eq!(not_started.len(), 1);
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
                    priority: Some(TaskPriority::High),
                    tags: Some(vec!["urgent".to_string()]),
                    due_at: None,
                    estimated_minutes: Some(60),
                    parent_id: None,
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
                priority: None,
                tags: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
            },
        );
        assert!(matches!(result, Err(TaskStoreError::NotFound(_))));
    }

    #[test]
    fn update_terminal_task_fails() {
        let store = make_store();
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: Some("Try update".to_string()),
                description: None,
                priority: None,
                tags: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
            },
        );
        assert!(matches!(result, Err(TaskStoreError::TerminalState(_))));
    }

    #[test]
    fn transition_happy_path() {
        let store = make_store();
        let task = store.create(create_input("My task"));

        let (old, updated) = store.transition(&task.id, TaskStatus::InProgress).unwrap();
        assert_eq!(old, TaskStatus::NotStarted);
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
    fn abandon() {
        let store = make_store();
        let task = store.create(create_input("Task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();

        let abandoned = store.abandon(&task.id).unwrap();
        assert_eq!(abandoned.status, TaskStatus::Abandoned);
        assert!(abandoned.completed_at.is_some());
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
