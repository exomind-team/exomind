use chrono::{DateTime, Utc};
use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::task::{TaskDependencyType, TaskPriority};

pub mod executor;
pub mod store;

pub use executor::{ExecutionError, ExecutionOutcome, ProposalExecutor};
pub use store::{CreateProposalInput, ProposalFilter, ProposalStore, ProposalStoreError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Proposal {
    pub id: String,
    pub title: String,
    pub body: String,
    pub action_type: ActionType,
    pub action_params: serde_json::Value,
    pub references: Vec<ProposalRef>,
    pub status: ProposalStatus,
    pub publisher: Publisher,
    pub comments: Vec<Comment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snooze_until: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionType {
    CreateTask,
    UpdateTask,
    AppendEvent,
    StartTimeblock,
    ApproveAgentAccess,
}

impl ActionType {
    pub fn canonical_name(self) -> &'static str {
        match self {
            Self::CreateTask => "task.create",
            Self::UpdateTask => "task.update",
            Self::AppendEvent => "append_event",
            Self::StartTimeblock => "start_timeblock",
            Self::ApproveAgentAccess => "approve_agent_access",
        }
    }

    pub fn parse_compatible(value: &str) -> Option<Self> {
        match value {
            "task.create" | "create_task" => Some(Self::CreateTask),
            "task.update" | "edit_task" => Some(Self::UpdateTask),
            "append_event" => Some(Self::AppendEvent),
            "start_timeblock" => Some(Self::StartTimeblock),
            "approve_agent_access" => Some(Self::ApproveAgentAccess),
            _ => None,
        }
    }
}

impl Serialize for ActionType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.canonical_name())
    }
}

impl<'de> Deserialize<'de> for ActionType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse_compatible(&value)
            .ok_or_else(|| D::Error::custom(format!("invalid proposal action type: {value}")))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalTaskDependency {
    pub task_id: String,
    #[serde(rename = "type")]
    pub relation_type: TaskDependencyType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskProposalFields {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<ProposalTaskDependency>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTaskParams {
    pub fields: TaskProposalFields,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyCreateTaskParams {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub done_condition: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub estimated_minutes: Option<u32>,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub depends_on: Option<Vec<ProposalTaskDependency>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub description: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub done_condition: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub estimated_minutes: Option<Option<u32>>,
    #[serde(
        default,
        deserialize_with = "deserialize_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_at: Option<Option<DateTime<Utc>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<ProposalTaskDependency>>,
}

impl UpdateTaskPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.done_condition.is_none()
            && self.priority.is_none()
            && self.tags.is_none()
            && self.estimated_minutes.is_none()
            && self.due_at.is_none()
            && self.depends_on.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTaskParams {
    pub task_id: String,
    pub patch: UpdateTaskPatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppendEventParams {
    pub content: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StartTimeblockParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub target_minutes: Option<u64>,
    #[serde(default)]
    pub task_ids: Option<Vec<String>>,
    #[serde(default)]
    pub source_planned_block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApproveAgentAccessParams {
    pub agent_id: String,
    pub agent_name: String,
    pub profile_id: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalRef {
    pub ref_type: RefType,
    pub id: String,
    pub display_text: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefType {
    Event,
    Timeblock,
    Task,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    InReview,
    Approved,
    Rejected,
    Snoozed,
}

impl ProposalStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Approved | Self::Rejected)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Publisher {
    pub publisher_type: PublisherType,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublisherType {
    Agent,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Comment {
    pub author: Publisher,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
