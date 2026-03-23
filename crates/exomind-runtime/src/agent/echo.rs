use super::{Agent, ChatChunk, ChatRequest};
use futures_util::stream::{self, BoxStream, StreamExt};

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

    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        stream::iter(vec![ChatChunk::content_only(format!(
            "Echo: {}",
            request.message
        ))])
        .boxed()
    }
}

/// Runtime-managed echo agent（运行时动态管理的 Echo Agent）.
///
/// NOTE（说明）:
/// The `Agent` trait currently requires `&'static str` metadata. To support
/// runtime-created agent IDs/names, we intentionally leak the boxed strings.
/// This is acceptable for a bounded number of manually created agents.
#[derive(Debug)]
pub struct ManagedEchoAgent {
    id: &'static str,
    name: &'static str,
    description: &'static str,
}

impl ManagedEchoAgent {
    pub fn new(id: impl Into<String>, name: Option<String>, description: Option<String>) -> Self {
        fn leak_owned(value: String) -> &'static str {
            Box::leak(value.into_boxed_str())
        }

        let id = leak_owned(id.into());
        let default_name = format!("Echo Agent ({id})");
        let default_description = format!("回显输入内容（{id}）");
        let name = leak_owned(name.unwrap_or(default_name));
        let description = leak_owned(description.unwrap_or(default_description));
        Self {
            id,
            name,
            description,
        }
    }
}

impl Agent for ManagedEchoAgent {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        stream::iter(vec![ChatChunk::content_only(format!(
            "Echo: {}",
            request.message
        ))])
        .boxed()
    }
}
