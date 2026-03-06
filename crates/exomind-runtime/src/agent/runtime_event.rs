use serde::Serialize;
use serde_json::Value;

use super::ChatChunk;

/// Shared runtime stream event（跨层共享的运行时流事件）.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum RuntimeAgentEvent {
    #[serde(rename = "session.started")]
    SessionStarted {
        #[serde(rename = "session_id")]
        session_id: String,
    },
    #[serde(rename = "output.delta")]
    OutputDelta {
        content: String,
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "thinking.delta")]
    ThinkingDelta {
        content: String,
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "tool.call")]
    ToolCall {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "tool.result")]
    ToolResult {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "done")]
    Done {
        #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
}

impl RuntimeAgentEvent {
    pub fn session_started(session_id: impl Into<String>) -> Self {
        Self::SessionStarted {
            session_id: session_id.into(),
        }
    }

    pub fn output_delta(content: impl Into<String>) -> Self {
        Self::OutputDelta {
            content: content.into(),
            session_id: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
            session_id: None,
        }
    }

    pub fn from_chat_chunk(chunk: &ChatChunk) -> Vec<Self> {
        let mut events = Vec::new();

        if let Some(session_id) = chunk.session_id.as_ref()
            && !session_id.is_empty()
        {
            events.push(Self::session_started(session_id.clone()));
        }

        if !chunk.content.is_empty() {
            events.push(Self::output_delta(chunk.content.clone()));
        }

        events
    }

    pub fn done() -> Self {
        Self::Done { session_id: None }
    }
}
