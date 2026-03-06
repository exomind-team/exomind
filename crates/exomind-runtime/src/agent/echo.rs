use super::provider::AgentProvider;
use super::{Agent, ChatRequest, RuntimeAgentEvent};
use futures_util::stream::{self, BoxStream, StreamExt};

/// Built-in echo agent (内置回显 Agent).
#[derive(Debug, Default)]
pub struct EchoAgent;

impl EchoAgent {
    pub fn new() -> Self {
        Self
    }
}

impl AgentProvider for EchoAgent {
    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, RuntimeAgentEvent> {
        stream::iter(vec![
            RuntimeAgentEvent::output_delta(format!("Echo: {}", request.message)),
            RuntimeAgentEvent::done(),
        ])
        .boxed()
    }
}

impl Agent for EchoAgent {
    fn id(&self) -> &str {
        "echo"
    }

    fn name(&self) -> &str {
        "Echo Agent"
    }

    fn description(&self) -> &str {
        "回显输入内容"
    }
}

#[derive(Debug)]
pub struct ManagedEchoAgent {
    id: String,
    name: String,
    description: String,
}

impl ManagedEchoAgent {
    pub fn new(
        id: impl Into<String>,
        name: Option<String>,
        description: Option<String>,
    ) -> Self {
        let id = id.into();
        let default_name = format!("Echo Agent ({id})");
        let default_description = format!("回显输入内容（{id}）");
        let name = name.unwrap_or(default_name);
        let description = description.unwrap_or(default_description);
        Self {
            id,
            name,
            description,
        }
    }
}

impl AgentProvider for ManagedEchoAgent {
    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, RuntimeAgentEvent> {
        stream::iter(vec![
            RuntimeAgentEvent::output_delta(format!("Echo: {}", request.message)),
            RuntimeAgentEvent::done(),
        ])
        .boxed()
    }
}

impl Agent for ManagedEchoAgent {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }
}
