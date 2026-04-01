use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::task::TaskPriority;

pub mod executor;
pub mod store;

pub use executor::{ExecutionError, ProposalExecutor};
pub use store::{CreateProposalInput, ProposalFilter, ProposalStore, ProposalStoreError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Proposal {
    pub id: u64,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    CreateTask,
    AppendEvent,
    StartTimeblock,
    ApproveAgentAccess,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CreateTaskParams {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct AppendEventParams {
    pub content: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
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
