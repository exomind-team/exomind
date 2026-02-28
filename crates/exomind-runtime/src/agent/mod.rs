use futures_util::stream::BoxStream;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub mod claude;
pub mod echo;

/// Agent summary info (Agent 列表摘要信息).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AgentSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
}

/// Streaming chat chunk (流式聊天分片).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChatChunk {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl ChatChunk {
    pub fn content_only(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            session_id: None,
        }
    }
}

/// Chat request payload (聊天请求载荷).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatRequest {
    pub message: String,
    pub session_id: Option<String>,
}

/// Session metadata（会话元信息）.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SessionInfo {
    pub session_id: String,
    pub status: String,
    pub created_at: String,
    pub last_active: String,
    pub message_count: u64,
    pub uptime_secs: u64,
}

/// Agent behavior contract (Agent 行为契约).
pub trait Agent: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;

    fn status(&self) -> &'static str {
        "available"
    }

    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk>;

    fn list_sessions(&self) -> Vec<SessionInfo> {
        Vec::new()
    }

    fn get_session(&self, _session_id: &str) -> Option<SessionInfo> {
        None
    }

    fn close_session(&self, _session_id: &str) -> bool {
        false
    }
}

#[derive(Clone, Default)]
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, Arc<dyn Agent>>>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn read_agents(&self) -> RwLockReadGuard<'_, HashMap<String, Arc<dyn Agent>>> {
        match self.agents.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn write_agents(&self) -> RwLockWriteGuard<'_, HashMap<String, Arc<dyn Agent>>> {
        match self.agents.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Register an agent at runtime (运行时注册 Agent).
    pub fn register(&self, agent: Arc<dyn Agent>) -> Option<Arc<dyn Agent>> {
        let id = agent.id().to_string();
        self.write_agents().insert(id, agent)
    }

    /// Unregister by id at runtime (运行时注销 Agent).
    pub fn unregister(&self, id: &str) -> Option<Arc<dyn Agent>> {
        self.write_agents().remove(id)
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Agent>> {
        self.read_agents().get(id).cloned()
    }

    pub fn list(&self) -> Vec<AgentSummary> {
        let mut summaries = self
            .read_agents()
            .values()
            .map(|agent| AgentSummary {
                id: agent.id().to_string(),
                name: agent.name().to_string(),
                description: agent.description().to_string(),
                status: agent.status().to_string(),
            })
            .collect::<Vec<_>>();

        summaries.sort_by(|left, right| left.id.cmp(&right.id));
        summaries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream::{self, StreamExt};
    use std::panic::{self, AssertUnwindSafe};

    struct TempAgent;

    impl Agent for TempAgent {
        fn id(&self) -> &'static str {
            "temp"
        }

        fn name(&self) -> &'static str {
            "Temp Agent"
        }

        fn description(&self) -> &'static str {
            "Temporary testing agent"
        }

        fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::iter(vec![ChatChunk::content_only(request.message)]).boxed()
        }
    }

    #[test]
    fn registry_supports_runtime_register_and_unregister() {
        let registry = AgentRegistry::new();
        assert!(registry.list().is_empty());

        let previous = registry.register(Arc::new(TempAgent));
        assert!(previous.is_none());

        assert_eq!(
            registry.list(),
            vec![AgentSummary {
                id: "temp".to_string(),
                name: "Temp Agent".to_string(),
                description: "Temporary testing agent".to_string(),
                status: "available".to_string(),
            }]
        );

        let removed = registry.unregister("temp");
        assert!(removed.is_some());
        assert!(registry.list().is_empty());
    }

    #[test]
    fn registry_recovers_after_lock_poisoning() {
        let registry = AgentRegistry::new();
        registry.register(Arc::new(TempAgent));

        let inner = registry.agents.clone();
        let _ = panic::catch_unwind(AssertUnwindSafe(move || {
            let _guard = inner.write().unwrap();
            panic!("poison lock for test");
        }));

        let summaries = registry.list();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "temp");

        let removed = registry.unregister("temp");
        assert!(removed.is_some());
        assert!(registry.list().is_empty());
    }
}
