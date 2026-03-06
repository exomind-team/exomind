use futures_util::future::BoxFuture;
use futures_util::stream::BoxStream;
use serde_json::Value;

use super::{ChatRequest, RuntimeAgentEvent, SessionInfo};

/// Agent provider contract（底层 provider 流契约）.
pub trait AgentProvider: Send + Sync {
    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, RuntimeAgentEvent>;

    fn list_sessions(&self) -> Vec<SessionInfo> {
        Vec::new()
    }

    fn get_session(&self, _session_id: &str) -> Option<SessionInfo> {
        None
    }

    fn close_session(&self, _session_id: &str) -> bool {
        false
    }

    fn stats(&self, _session_id: Option<String>) -> BoxFuture<'_, Option<Value>> {
        Box::pin(async { None })
    }
}
