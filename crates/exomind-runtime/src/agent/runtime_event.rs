use serde::Serialize;

/// Runtime agent stream event（运行时 Agent 流事件）.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RuntimeAgentEvent {
    #[serde(rename = "session.started")]
    SessionStarted {
        session_id: String,
    },
    #[serde(rename = "output.delta")]
    OutputDelta {
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "thinking.delta")]
    ThinkingDelta {
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "done")]
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        finish_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
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

    pub fn thinking_delta(content: impl Into<String>) -> Self {
        Self::ThinkingDelta {
            content: content.into(),
            session_id: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
            code: None,
            session_id: None,
        }
    }

    pub fn done(finish_reason: Option<&str>) -> Self {
        Self::Done {
            finish_reason: finish_reason.map(ToString::to_string),
            session_id: None,
        }
    }
}
