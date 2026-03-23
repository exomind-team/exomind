use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalEvent {
    pub schema_version: u8,
    pub id: String,
    pub topic: String,
    pub ts: u64,
    pub source: String,
    pub origin_host_id: String,
    pub hop: u8,
    pub trace_id: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalRoute {
    pub id: String,
    pub enabled: bool,
    pub topic: String,
    pub target_type: TargetType,
    pub target_ref: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TargetType {
    Actor,
    Agent,
    Frontend,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryRecord {
    pub event_id: String,
    pub route_id: String,
    pub target_ref: String,
    pub status: DeliveryStatus,
    pub reason: Option<String>,
    pub started_at: String,
    pub finished_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryStatus {
    Sent,
    Failed,
    Skipped,
}
