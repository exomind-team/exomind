use serde::{Deserialize, Serialize};

use crate::signal::SignalEvent;

use super::dto::EnsPeerIdentity;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnsSignalEventFrame {
    pub frame_id: String,
    pub from_peer: EnsPeerIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_hint: Option<String>,
    pub event: SignalEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum EnsDataFrame {
    SignalEvent(EnsSignalEventFrame),
}
