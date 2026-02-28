use super::{Agent, ChatChunk};

/// Built-in echo agent (内置回显 Agent).
#[derive(Debug, Default)]
pub struct EchoAgent;

impl EchoAgent {
    pub fn new() -> Self {
        Self
    }
}

impl Agent for EchoAgent {
    fn id(&self) -> &'static str {
        "echo"
    }

    fn name(&self) -> &'static str {
        "Echo Agent"
    }

    fn description(&self) -> &'static str {
        "回显输入内容"
    }

    fn chat_chunks(&self, message: String) -> Vec<ChatChunk> {
        vec![ChatChunk {
            content: format!("Echo: {message}"),
        }]
    }
}
