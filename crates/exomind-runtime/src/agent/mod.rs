use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

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
}

/// Agent behavior contract (Agent 行为契约).
pub trait Agent: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;

    fn status(&self) -> &'static str {
        "available"
    }

    fn chat_chunks(&self, message: String) -> Vec<ChatChunk>;
}

#[derive(Clone, Default)]
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, Arc<dyn Agent>>>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register an agent at runtime (运行时注册 Agent).
    pub fn register(&self, agent: Arc<dyn Agent>) -> Option<Arc<dyn Agent>> {
        let id = agent.id().to_string();
        self.agents.write().ok()?.insert(id, agent)
    }

    /// Unregister by id at runtime (运行时注销 Agent).
    pub fn unregister(&self, id: &str) -> Option<Arc<dyn Agent>> {
        self.agents.write().ok()?.remove(id)
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Agent>> {
        self.agents.read().ok()?.get(id).cloned()
    }

    pub fn list(&self) -> Vec<AgentSummary> {
        let mut summaries = self
            .agents
            .read()
            .map(|agents| {
                agents
                    .values()
                    .map(|agent| AgentSummary {
                        id: agent.id().to_string(),
                        name: agent.name().to_string(),
                        description: agent.description().to_string(),
                        status: agent.status().to_string(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        summaries.sort_by(|left, right| left.id.cmp(&right.id));
        summaries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

        fn chat_chunks(&self, message: String) -> Vec<ChatChunk> {
            vec![ChatChunk { content: message }]
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
}
