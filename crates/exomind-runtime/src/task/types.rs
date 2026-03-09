use serde::{Deserialize, Serialize};

/// 5-state machine matching front-end TaskStatus.
/// not_started → in_progress ⇌ suspended → completed / abandoned
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    NotStarted,
    InProgress,
    Suspended,
    Completed,
    Abandoned,
}

impl TaskStatus {
    /// Valid transitions from this status.
    pub fn valid_transitions(&self) -> &[TaskStatus] {
        match self {
            TaskStatus::NotStarted => &[TaskStatus::InProgress],
            TaskStatus::InProgress => &[TaskStatus::Suspended, TaskStatus::Completed, TaskStatus::Abandoned],
            TaskStatus::Suspended => &[TaskStatus::InProgress, TaskStatus::Completed, TaskStatus::Abandoned],
            TaskStatus::Completed => &[],
            TaskStatus::Abandoned => &[],
        }
    }

    pub fn can_transition_to(&self, target: &TaskStatus) -> bool {
        self.valid_transitions().contains(target)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStatus::Completed | TaskStatus::Abandoned)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    Medium,
    High,
}

impl Default for TaskPriority {
    fn default() -> Self {
        TaskPriority::Medium
    }
}

/// A task in the ExoMind runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<u32>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

/// Input for creating a new task.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub due_at: Option<u64>,
    #[serde(default)]
    pub estimated_minutes: Option<u32>,
}

/// Input for updating an existing task.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTaskInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub due_at: Option<u64>,
    #[serde(default)]
    pub estimated_minutes: Option<u32>,
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// Input for transitioning task status.
#[derive(Debug, Clone, Deserialize)]
pub struct TransitionInput {
    pub status: TaskStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_started_can_only_go_to_in_progress() {
        let s = TaskStatus::NotStarted;
        assert!(s.can_transition_to(&TaskStatus::InProgress));
        assert!(!s.can_transition_to(&TaskStatus::Completed));
        assert!(!s.can_transition_to(&TaskStatus::Abandoned));
        assert!(!s.can_transition_to(&TaskStatus::Suspended));
    }

    #[test]
    fn in_progress_transitions() {
        let s = TaskStatus::InProgress;
        assert!(s.can_transition_to(&TaskStatus::Suspended));
        assert!(s.can_transition_to(&TaskStatus::Completed));
        assert!(s.can_transition_to(&TaskStatus::Abandoned));
        assert!(!s.can_transition_to(&TaskStatus::NotStarted));
    }

    #[test]
    fn suspended_transitions() {
        let s = TaskStatus::Suspended;
        assert!(s.can_transition_to(&TaskStatus::InProgress));
        assert!(s.can_transition_to(&TaskStatus::Completed));
        assert!(s.can_transition_to(&TaskStatus::Abandoned));
        assert!(!s.can_transition_to(&TaskStatus::NotStarted));
    }

    #[test]
    fn terminal_states_have_no_transitions() {
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Abandoned.is_terminal());
        assert!(TaskStatus::Completed.valid_transitions().is_empty());
        assert!(TaskStatus::Abandoned.valid_transitions().is_empty());
    }

    #[test]
    fn serde_roundtrip() {
        let task = Task {
            id: "t-1".to_string(),
            title: "Test".to_string(),
            description: None,
            status: TaskStatus::NotStarted,
            priority: TaskPriority::High,
            tags: vec!["dev".to_string()],
            source: Some("mcp".to_string()),
            parent_id: None,
            due_at: None,
            estimated_minutes: Some(30),
            created_at: 1000,
            updated_at: 1000,
            completed_at: None,
        };
        let json = serde_json::to_string(&task).unwrap();
        assert!(json.contains("\"not_started\""));
        assert!(json.contains("\"high\""));
        let back: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, TaskStatus::NotStarted);
        assert_eq!(back.priority, TaskPriority::High);
    }
}
