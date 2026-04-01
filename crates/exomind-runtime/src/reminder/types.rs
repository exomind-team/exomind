use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Pending,
    Triggered,
    Completed,
}

impl ReminderStatus {
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Pending, Self::Triggered)
                | (Self::Pending, Self::Completed)
                | (Self::Triggered, Self::Completed)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub content: String,
    pub due_at: u64,
    pub status: ReminderStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateReminderInput {
    pub title: String,
    pub content: String,
    pub due_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateReminderInput {
    pub title: Option<String>,
    pub content: Option<String>,
    pub due_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReminderTransitionInput {
    pub status: ReminderStatus,
    pub at: Option<u64>,
}
