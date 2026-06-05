use std::collections::HashMap;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use futures_util::future::BoxFuture;
use futures_util::stream::BoxStream;
use serde::Serialize;
use serde_json::Value;

use crate::energy::AgentEnergySnapshot;
use crate::signal::types::SignalEvent;

pub mod api;
pub mod broker;
pub mod claude;
pub mod codex;
pub mod cognition;
pub mod echo;
pub mod heartbeat;
pub mod life;
pub mod llm_cognition;
pub mod proposal_tools;
pub mod runtime_event;
pub mod session;
pub mod timeblock_summary;
pub mod tools;
pub mod workspace;

pub use runtime_event::RuntimeAgentEvent;

/// Agent summary info (Agent 列表摘要信息).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AgentSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    /// 订阅的信号 topic 列表.
    pub subscriptions: Vec<String>,
    /// 可发布的信号 topic 列表.
    pub publications: Vec<String>,
    /// 定时 tick 间隔（秒），0 = 无定时.
    pub tick_interval_secs: u64,
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
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionInfo {
    pub session_id: String,
    pub status: String,
    pub created_at: String,
    pub last_active: String,
    pub message_count: u64,
    pub uptime_secs: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<session::ToolCallRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<api::ContentBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_log: Option<Vec<session::ActionLogEntry>>,
}

impl Default for SessionInfo {
    fn default() -> Self {
        Self {
            session_id: String::new(),
            status: String::new(),
            created_at: String::new(),
            last_active: String::new(),
            message_count: 0,
            uptime_secs: 0,
            content: None,
            trigger_source: None,
            prompt: None,
            provider: None,
            model: None,
            tool_calls: None,
            content_blocks: None,
            action_log: None,
        }
    }
}

/// Agent behavior contract (Agent 行为契约).
///
/// 两层能力：
/// - 对话能力（chat_stream）— 人和 Agent 交互
/// - 信号网络能力（subscriptions / publications / on_signal / tick）— Agent 接入信号池
///
/// 现成 Agent（echo/claude/codex）只需实现对话能力，信号网络声明为空（默认值）。
/// 自定义 Agent（Governor/Growth Coach）同时实现两层。
pub trait Agent: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;

    fn status(&self) -> &'static str {
        "available"
    }

    // ── 对话能力 ──

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

    /// Return the agent's "soul" — its identity, system prompt, or persona description.
    fn soul(&self) -> String {
        self.description().to_string()
    }

    fn stats(&self, _session_id: Option<String>) -> BoxFuture<'_, Option<Value>> {
        Box::pin(async { None })
    }

    // ── 信号网络能力 ──

    /// 订阅的信号 topic 列表（输入）.
    /// 返回空表示不订阅任何信号（纯对话 Agent）.
    fn subscriptions(&self) -> Vec<String> {
        Vec::new()
    }

    /// 可发布的信号 topic 列表（输出）.
    /// 用于拓扑可视化和连接验证，不强制限制发布.
    fn publications(&self) -> Vec<String> {
        Vec::new()
    }

    /// 定时 tick 间隔（秒）. 0 = 无定时触发（纯事件驱动）.
    /// 自定义 Agent 设为 300（5min），现成 Agent 保持 0.
    fn tick_interval_secs(&self) -> u64 {
        0
    }

    /// 收到匹配信号时的处理函数.
    /// 返回要发布的信号列表（可以为空 = 决定不行动）.
    /// 默认实现：忽略所有信号.
    fn on_signal(&self, _event: SignalEvent) -> BoxFuture<'_, Vec<SignalEvent>> {
        Box::pin(async { Vec::new() })
    }

    /// 定时 tick 触发时的处理函数.
    /// tick 调度器传入当前能量快照，Agent 可据此决策.
    /// 返回要发布的信号列表（可以为空 = 决定不行动）.
    /// 默认实现：不做任何事.
    fn on_tick(&self, _energy: &AgentEnergySnapshot) -> BoxFuture<'_, Vec<SignalEvent>> {
        Box::pin(async { Vec::new() })
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
                subscriptions: agent.subscriptions(),
                publications: agent.publications(),
                tick_interval_secs: agent.tick_interval_secs(),
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
        fn id(&self) -> &str {
            "temp"
        }

        fn name(&self) -> &str {
            "Temp Agent"
        }

        fn description(&self) -> &str {
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
                subscriptions: vec![],
                publications: vec![],
                tick_interval_secs: 0,
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
