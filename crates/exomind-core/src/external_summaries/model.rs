use crate::{
    AgentId, CommandId, DeviceId, EventId, OriginalId, OriginalRef, ProfileId,
    SummaryRemoteVisibility, SummarySourceRef, WriterContext,
};
use serde::{Deserialize, Serialize};

pub const EXTERNAL_SUMMARY_FACT_TYPE: &str = "agent_summary/1";
/// An independent producer authority, not a model executor/ticket or wire DTO.
/// A runtime restart invalidates its private Core scope.
/// ```compile_fail
/// let _: exomind_core::ExternalSummaryProducerContext = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug)]
pub struct ExternalSummaryProducerContext {
    pub(super) scope: WriterContext,
    pub(super) agent_id: AgentId,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalSummaryAppendCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub occurred_at_ms: i64,
    pub observed_through: u64,
    pub sources: Vec<SummarySourceRef>,
    pub narrative: String,
    pub evidence: Vec<EventId>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSummaryScope {
    ExplicitSources,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSummarySourceDelivery {
    NotAttested,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalSummaryCoverage {
    pub scope: ExternalSummaryScope,
    pub source_delivery: ExternalSummarySourceDelivery,
    pub remote_visibility: SummaryRemoteVisibility,
    pub unread_original_ids: Vec<OriginalId>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalSummarySnapshot {
    /// Producer-local observation boundary, never a receiver's local_seq.
    pub observed_through: u64,
    pub sources: Vec<SummarySourceRef>,
    pub input_encoded_bytes: u64,
    pub materials: Vec<OriginalRef>,
    pub coverage: ExternalSummaryCoverage,
    pub digest: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalSummaryRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub producer_agent_id: AgentId,
    pub occurred_at_ms: i64,
    pub snapshot: ExternalSummarySnapshot,
    pub narrative: String,
    pub evidence: Vec<EventId>,
    pub digest: String,
    pub local_seq: u64,
}
