use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::signal::types::SignalEvent;

// ---------------------------------------------------------------------------
// CognitionContext — input to the cognition engine
// ---------------------------------------------------------------------------

/// Everything the cognition engine can perceive about its body and environment.
#[derive(Debug, Clone)]
pub struct CognitionContext {
    /// Current energy snapshot (ratio, phase, etc.)
    pub energy_ratio: f64,
    pub energy_phase: String,
    pub energy_current: u64,
    pub energy_max: u64,

    /// Signals received since last tick
    pub signals: Vec<SignalEvent>,

    /// Summary / index of long-term knowledge files
    pub knowledge_summary: String,

    /// Self-perception of the body
    pub body_status: BodyStatus,
}

// ---------------------------------------------------------------------------
// CognitionOutput — decisions from the cognition engine
// ---------------------------------------------------------------------------

/// The result of one think() cycle.
#[derive(Debug, Clone, Default)]
pub struct CognitionOutput {
    /// Signals to emit into the SignalPool.
    pub signals_to_emit: Vec<SignalEvent>,

    /// Knowledge read/write/delete operations.
    pub knowledge_ops: Vec<KnowledgeOp>,

    /// Human-readable description of what the engine decided to do.
    pub action_description: String,
}

// ---------------------------------------------------------------------------
// KnowledgeOp — operations on the agent's long-term memory
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KnowledgeOp {
    Write { path: String, content: String },
    Delete { path: String },
}

// ---------------------------------------------------------------------------
// BodyStatus — self-awareness of the agent's physical state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BodyStatus {
    pub knowledge_usage_ratio: f32,
    pub total_actions: u64,
    pub uptime_ticks: u64,
    pub current_strategy: String,
}

// ---------------------------------------------------------------------------
// CognitionState — serializable snapshot for save/restore
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitionState {
    pub engine_type: String,
    pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// CognitionEngine trait — pluggable cognition
// ---------------------------------------------------------------------------

/// A pluggable cognition engine that drives an agent's decision-making.
///
/// Phase 1 ships a rule-based implementation (`LlmCognition`).
/// Future phases will replace this with real LLM calls.
pub trait CognitionEngine: Send + Sync {
    /// Perceive context → think → produce decisions.
    fn think(&self, ctx: CognitionContext) -> BoxFuture<'_, anyhow::Result<CognitionOutput>>;

    /// Save internal state for graceful shutdown / restart.
    fn save_state(&self) -> BoxFuture<'_, anyhow::Result<CognitionState>>;

    /// Restore internal state after restart.
    fn restore_state(&self, state: CognitionState) -> BoxFuture<'_, anyhow::Result<()>>;

    /// Engine type identifier (used to match state on restore).
    fn engine_type(&self) -> &str;
}
