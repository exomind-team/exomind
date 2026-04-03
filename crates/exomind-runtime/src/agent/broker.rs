use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::agent::api::ApiProviderProfile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnRequest {
    pub provider: ApiProviderProfile,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub tools: Vec<ToolDef>,
    #[serde(default)]
    pub history: Vec<TurnItem>,
    #[serde(default)]
    pub new_user_message: Option<String>,
}

impl AgentTurnRequest {
    pub fn validate(&self) -> Result<(), BrokerError> {
        if self.new_user_message.is_some()
            && matches!(self.history.last(), Some(TurnItem::User { .. }))
        {
            return Err(BrokerError::InvalidRequest(
                "new_user_message cannot be combined with a trailing user turn in history"
                    .to_string(),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum TurnItem {
    User {
        content: String,
    },
    Assistant {
        content: String,
        #[serde(default)]
        tool_calls: Vec<ToolCall>,
    },
    #[serde(rename = "tool")]
    ToolResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTurn {
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentTurnResult {
    Final {
        assistant_turn: AssistantTurn,
    },
    NeedsToolCalls {
        assistant_turn: AssistantTurn,
        tool_calls: Vec<ToolCall>,
    },
}

#[derive(Debug, Error)]
pub enum BrokerError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_provider() -> ApiProviderProfile {
        ApiProviderProfile {
            provider: "openai".to_string(),
            model: "gpt-test".to_string(),
            base_url: Some("http://127.0.0.1:12345".to_string()),
            api_key: "sk-test".to_string(),
        }
    }

    #[test]
    fn request_rejects_duplicate_last_user_turn_and_new_user_message() {
        let request = AgentTurnRequest {
            provider: test_provider(),
            system_prompt: None,
            tools: Vec::new(),
            history: vec![TurnItem::User {
                content: "之前的问题".to_string(),
            }],
            new_user_message: Some("新的问题".to_string()),
        };

        let error = request.validate().unwrap_err();
        assert!(error.to_string().contains("new_user_message"));
    }

    #[test]
    fn assistant_turn_exposes_tool_calls_for_continuation() {
        let assistant_turn = AssistantTurn {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "call_1".to_string(),
                name: "get_weather".to_string(),
                input: json!({ "date": "today" }),
            }],
        };

        assert_eq!(assistant_turn.tool_calls.len(), 1);
        assert_eq!(assistant_turn.tool_calls[0].name, "get_weather");
    }

    #[test]
    fn needs_tool_calls_result_keeps_assistant_turn_and_flat_tool_calls() {
        let tool_call = ToolCall {
            id: "call_1".to_string(),
            name: "get_weather".to_string(),
            input: json!({ "date": "today" }),
        };
        let assistant_turn = AssistantTurn {
            content: String::new(),
            tool_calls: vec![tool_call.clone()],
        };

        let result = AgentTurnResult::NeedsToolCalls {
            assistant_turn: assistant_turn.clone(),
            tool_calls: vec![tool_call.clone()],
        };

        match result {
            AgentTurnResult::NeedsToolCalls {
                assistant_turn,
                tool_calls,
            } => {
                assert_eq!(assistant_turn.tool_calls, vec![tool_call.clone()]);
                assert_eq!(tool_calls, vec![tool_call]);
            }
            AgentTurnResult::Final { .. } => panic!("expected NeedsToolCalls"),
        }
    }

    #[test]
    fn tool_result_serializes_with_tool_role_and_camel_case_fields() {
        let item = TurnItem::ToolResult {
            tool_call_id: "call_1".to_string(),
            tool_name: "get_weather".to_string(),
            content: "今天是阴天，气温21.45度".to_string(),
        };

        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["role"], "tool");
        assert_eq!(value["toolCallId"], "call_1");
        assert_eq!(value["toolName"], "get_weather");
    }
}
