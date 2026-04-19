use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize a JSON field into `Option<Option<T>>`:
/// - absent → `None` (don't change)
/// - `null` → `Some(None)` (clear)
/// - value → `Some(Some(value))` (set)
fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

/// 5-state machine matching front-end TaskStatus.
/// pending → in_progress ⇌ suspended → completed / cancelled
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskStatus {
    #[serde(rename = "pending", alias = "not_started")]
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    #[serde(rename = "suspended")]
    Suspended,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "cancelled", alias = "abandoned")]
    Cancelled,
}

impl TaskStatus {
    /// Valid transitions from this status.
    pub fn valid_transitions(&self) -> &[TaskStatus] {
        match self {
            TaskStatus::Pending => &[TaskStatus::InProgress],
            TaskStatus::InProgress => &[
                TaskStatus::Suspended,
                TaskStatus::Completed,
                TaskStatus::Cancelled,
            ],
            TaskStatus::Suspended => &[
                TaskStatus::InProgress,
                TaskStatus::Completed,
                TaskStatus::Cancelled,
            ],
            TaskStatus::Completed => &[],
            TaskStatus::Cancelled => &[],
        }
    }

    pub fn can_transition_to(&self, target: &TaskStatus) -> bool {
        self.valid_transitions().contains(target)
    }

    pub fn path_to(&self, target: &TaskStatus) -> Option<Vec<TaskStatus>> {
        if self == target {
            return Some(vec![]);
        }
        if self.can_transition_to(target) {
            return Some(vec![]);
        }

        use std::collections::{HashSet, VecDeque};

        let mut visited = HashSet::from([*self]);
        let mut queue = VecDeque::new();

        for &next in self.valid_transitions() {
            if visited.insert(next) {
                queue.push_back((next, vec![next]));
            }
        }

        while let Some((current, path)) = queue.pop_front() {
            if current == *target {
                return Some(path);
            }

            for &next in current.valid_transitions() {
                if visited.insert(next) {
                    let mut next_path = path.clone();
                    next_path.push(next);
                    queue.push_back((next, next_path));
                }
            }
        }

        None
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStatus::Completed | TaskStatus::Cancelled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskTransitionReason {
    #[serde(rename = "task.create")]
    TaskCreate,
    #[serde(rename = "task.transition")]
    TaskTransition,
    #[serde(rename = "timeblock.pause")]
    TimeblockPause,
    #[serde(rename = "timeblock.resume")]
    TimeblockResume,
    #[serde(rename = "timeblock.end")]
    TimeblockEnd,
}

impl TaskTransitionReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskTransitionReason::TaskCreate => "task.create",
            TaskTransitionReason::TaskTransition => "task.transition",
            TaskTransitionReason::TimeblockPause => "timeblock.pause",
            TaskTransitionReason::TimeblockResume => "timeblock.resume",
            TaskTransitionReason::TimeblockEnd => "timeblock.end",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskStatusTransition {
    pub id: String,
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_status: Option<TaskStatus>,
    pub to_status: TaskStatus,
    pub reason: TaskTransitionReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_host_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_time_block_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_time_block_transition_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_generated: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskTransitionContext {
    pub at: Option<u64>,
    pub reason: Option<TaskTransitionReason>,
    pub actor_id: Option<String>,
    pub source_host_id: Option<String>,
    pub operation_id: Option<String>,
    pub related_time_block_id: Option<String>,
    pub related_time_block_transition_ref: Option<String>,
    pub auto_generated: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskDependencyType {
    Soft,
    Hard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskDependency {
    pub task_id: String,
    #[serde(rename = "type")]
    pub relation_type: TaskDependencyType,
}

/// A task in the ExoMind runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_condition: Option<String>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<TaskDependency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<u32>,
    #[serde(default)]
    pub time_block_ids: Vec<String>,
    #[serde(default)]
    pub status_transitions: Vec<TaskStatusTransition>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

/// Input for creating a new task.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub done_condition: Option<String>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<TaskDependency>,
    #[serde(default)]
    pub due_at: Option<u64>,
    #[serde(default)]
    pub estimated_minutes: Option<u32>,
    #[serde(default)]
    pub time_block_ids: Vec<String>,
}

/// Input for updating an existing task.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTaskInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub done_condition: Option<Option<String>>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub depends_on: Option<Vec<TaskDependency>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub due_at: Option<Option<u64>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub estimated_minutes: Option<Option<u32>>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub time_block_ids: Option<Vec<String>>,
}

/// Input for transitioning task status.
#[derive(Debug, Clone, Deserialize)]
pub struct TransitionInput {
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchTransitionInput {
    pub tasks: Vec<BatchTransitionItem>,
    #[serde(default)]
    pub shortcut: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchTransitionItem {
    pub id: String,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchTransitionResult {
    pub id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchTransitionResponse {
    pub results: Vec<BatchTransitionResult>,
    pub succeeded: usize,
    pub failed: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_can_only_go_to_in_progress() {
        let s = TaskStatus::Pending;
        assert!(s.can_transition_to(&TaskStatus::InProgress));
        assert!(!s.can_transition_to(&TaskStatus::Completed));
        assert!(!s.can_transition_to(&TaskStatus::Cancelled));
        assert!(!s.can_transition_to(&TaskStatus::Suspended));
    }

    #[test]
    fn in_progress_transitions() {
        let s = TaskStatus::InProgress;
        assert!(s.can_transition_to(&TaskStatus::Suspended));
        assert!(s.can_transition_to(&TaskStatus::Completed));
        assert!(s.can_transition_to(&TaskStatus::Cancelled));
        assert!(!s.can_transition_to(&TaskStatus::Pending));
    }

    #[test]
    fn suspended_transitions() {
        let s = TaskStatus::Suspended;
        assert!(s.can_transition_to(&TaskStatus::InProgress));
        assert!(s.can_transition_to(&TaskStatus::Completed));
        assert!(s.can_transition_to(&TaskStatus::Cancelled));
        assert!(!s.can_transition_to(&TaskStatus::Pending));
    }

    #[test]
    fn terminal_states_have_no_transitions() {
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Cancelled.is_terminal());
        assert!(TaskStatus::Completed.valid_transitions().is_empty());
        assert!(TaskStatus::Cancelled.valid_transitions().is_empty());
    }

    #[test]
    fn path_to_finds_shortcut() {
        assert_eq!(
            TaskStatus::Pending.path_to(&TaskStatus::Completed),
            Some(vec![TaskStatus::InProgress, TaskStatus::Completed])
        );
        assert_eq!(
            TaskStatus::Pending.path_to(&TaskStatus::Cancelled),
            Some(vec![TaskStatus::InProgress, TaskStatus::Cancelled])
        );
        assert_eq!(
            TaskStatus::Pending.path_to(&TaskStatus::InProgress),
            Some(vec![])
        );
        assert_eq!(TaskStatus::Completed.path_to(&TaskStatus::Pending), None);
    }

    #[test]
    fn serde_roundtrip() {
        let task = Task {
            id: "t-1".to_string(),
            title: "Test".to_string(),
            description: None,
            done_condition: Some("Definition of done".to_string()),
            status: TaskStatus::Pending,
            priority: TaskPriority::High,
            tags: vec!["dev".to_string()],
            source: Some("mcp".to_string()),
            parent_id: None,
            depends_on: vec![TaskDependency {
                task_id: "dep-1".to_string(),
                relation_type: TaskDependencyType::Hard,
            }],
            due_at: None,
            estimated_minutes: Some(30),
            time_block_ids: vec!["block-1".to_string()],
            status_transitions: vec![TaskStatusTransition {
                id: "t-1:init".to_string(),
                at: 1000,
                from_status: None,
                to_status: TaskStatus::Pending,
                reason: TaskTransitionReason::TaskCreate,
                actor_id: None,
                source_host_id: None,
                operation_id: None,
                related_time_block_id: None,
                related_time_block_transition_ref: None,
                auto_generated: None,
            }],
            created_at: 1000,
            updated_at: 1000,
            completed_at: None,
        };
        let json = serde_json::to_string(&task).unwrap();
        assert!(json.contains("\"pending\""));
        assert!(json.contains("\"high\""));
        assert!(json.contains("\"done_condition\":\"Definition of done\""));
        assert!(json.contains("\"depends_on\""));
        let back: Task = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, TaskStatus::Pending);
        assert_eq!(back.priority, TaskPriority::High);
        assert_eq!(back.done_condition.as_deref(), Some("Definition of done"));
        assert_eq!(back.depends_on.len(), 1);
        assert_eq!(back.time_block_ids, vec!["block-1".to_string()]);
        assert_eq!(back.status_transitions.len(), 1);
    }

    #[test]
    fn serde_accepts_legacy_status_aliases() {
        let pending: TaskStatus = serde_json::from_str(r#""not_started""#).unwrap();
        let cancelled: TaskStatus = serde_json::from_str(r#""abandoned""#).unwrap();

        assert_eq!(pending, TaskStatus::Pending);
        assert_eq!(cancelled, TaskStatus::Cancelled);
    }
}
