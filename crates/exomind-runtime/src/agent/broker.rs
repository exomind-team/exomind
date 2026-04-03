use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::agent::api::{
    ApiProviderProfile, ProviderCompletion, ProviderConversationTurn, complete_turn_with_tools,
};
use crate::agent::tools::{ToolDef as ProviderToolDef, ToolResult, ToolUse};

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

    fn normalized_history(&self) -> Vec<TurnItem> {
        let mut history = self.history.clone();
        if let Some(message) = self
            .new_user_message
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            history.push(TurnItem::User {
                content: message.to_string(),
            });
        }
        history
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

#[derive(Debug, Default, Clone, Copy)]
pub struct AgentTurnBroker;

impl AgentTurnBroker {
    pub async fn run(&self, request: AgentTurnRequest) -> Result<AgentTurnResult, BrokerError> {
        request.validate()?;

        let history = request.normalized_history();
        if history.is_empty() {
            return Err(BrokerError::InvalidRequest(
                "agent turn requires history or new_user_message".to_string(),
            ));
        }

        let provider_history = history
            .iter()
            .map(turn_item_to_provider_turn)
            .collect::<Vec<_>>();
        let provider_tools = request
            .tools
            .iter()
            .map(tool_def_to_provider_tool_def)
            .collect::<Vec<_>>();

        let client = reqwest::Client::new();
        let completion = complete_turn_with_tools(
            &client,
            &request.provider,
            request.system_prompt.as_deref(),
            &provider_history,
            &provider_tools,
        )
        .await
        .map_err(BrokerError::ProviderRequest)?;

        Ok(completion_to_result(completion))
    }
}

#[derive(Debug, Error)]
pub enum BrokerError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("provider request failed: {0}")]
    ProviderRequest(String),
}

fn turn_item_to_provider_turn(turn: &TurnItem) -> ProviderConversationTurn {
    match turn {
        TurnItem::User { content } => ProviderConversationTurn::User {
            text: content.clone(),
        },
        TurnItem::Assistant {
            content,
            tool_calls,
        } => ProviderConversationTurn::Assistant {
            text: Some(content.clone()),
            tool_uses: tool_calls.iter().map(tool_call_to_tool_use).collect(),
        },
        TurnItem::ToolResult {
            tool_call_id,
            content,
            ..
        } => ProviderConversationTurn::ToolResults {
            results: vec![ToolResult {
                tool_use_id: tool_call_id.clone(),
                content: content.clone(),
            }],
        },
    }
}

fn tool_call_to_tool_use(tool_call: &ToolCall) -> ToolUse {
    ToolUse {
        id: tool_call.id.clone(),
        name: tool_call.name.clone(),
        input: tool_call.input.clone(),
    }
}

fn tool_use_to_tool_call(tool_use: &ToolUse) -> ToolCall {
    ToolCall {
        id: tool_use.id.clone(),
        name: tool_use.name.clone(),
        input: tool_use.input.clone(),
    }
}

fn tool_def_to_provider_tool_def(tool: &ToolDef) -> ProviderToolDef {
    ProviderToolDef {
        name: tool.name.clone(),
        description: tool.description.clone(),
        input_schema: tool.input_schema.clone(),
    }
}

fn completion_to_result(completion: ProviderCompletion) -> AgentTurnResult {
    let assistant_turn = AssistantTurn {
        content: completion.text,
        tool_calls: completion
            .tool_uses
            .iter()
            .map(tool_use_to_tool_call)
            .collect(),
    };

    if assistant_turn.tool_calls.is_empty() {
        AgentTurnResult::Final { assistant_turn }
    } else {
        AgentTurnResult::NeedsToolCalls {
            tool_calls: assistant_turn.tool_calls.clone(),
            assistant_turn,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::json;
    use std::net::SocketAddr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

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

    async fn fake_openai_final_handler(Json(_payload): Json<Value>) -> Json<Value> {
        Json(json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": "今天适合继续推进 broker 改造。"
                }
            }]
        }))
    }

    async fn fake_openai_tool_call_once_handler(
        State(call_count): State<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        let messages = payload["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");

        Json(json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"date\":\"today\"}"
                        }
                    }]
                }
            }]
        }))
    }

    async fn fake_anthropic_continue_handler(
        State(call_count): State<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        let messages = payload["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][0]["type"], "tool_use");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");

        Json(json!({
            "content": [
                { "type": "text", "text": "今天是阴天，气温21.45度。" }
            ],
            "stop_reason": "end_turn"
        }))
    }

    async fn spawn_openai_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new().route("/chat/completions", post(fake_openai_final_handler));
        spawn_server(app).await
    }

    async fn spawn_openai_tool_call_server() -> (String, Arc<AtomicUsize>, oneshot::Sender<()>) {
        let call_count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/chat/completions", post(fake_openai_tool_call_once_handler))
            .with_state(Arc::clone(&call_count));
        let (url, shutdown) = spawn_server(app).await;
        (url, call_count, shutdown)
    }

    async fn spawn_anthropic_server() -> (String, Arc<AtomicUsize>, oneshot::Sender<()>) {
        let call_count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/messages", post(fake_anthropic_continue_handler))
            .with_state(Arc::clone(&call_count));
        let (url, shutdown) = spawn_server(app).await;
        (url, call_count, shutdown)
    }

    async fn spawn_server(app: Router) -> (String, oneshot::Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        (format!("http://{}", addr), shutdown_tx)
    }

    #[tokio::test]
    async fn broker_returns_final_when_provider_answers_without_tools() {
        let (base_url, shutdown_tx) = spawn_openai_server().await;
        let broker = AgentTurnBroker;
        let request = AgentTurnRequest {
            provider: ApiProviderProfile {
                base_url: Some(base_url),
                ..test_provider()
            },
            system_prompt: Some("你是测试助手".to_string()),
            tools: Vec::new(),
            history: Vec::new(),
            new_user_message: Some("今天适合做什么".to_string()),
        };

        let result = broker.run(request).await.unwrap();
        match result {
            AgentTurnResult::Final { assistant_turn } => {
                assert_eq!(assistant_turn.content, "今天适合继续推进 broker 改造。");
                assert!(assistant_turn.tool_calls.is_empty());
            }
            AgentTurnResult::NeedsToolCalls { .. } => panic!("expected Final"),
        }

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn broker_returns_needs_tool_calls_without_dispatching_tools() {
        let (base_url, call_count, shutdown_tx) = spawn_openai_tool_call_server().await;
        let broker = AgentTurnBroker;
        let request = AgentTurnRequest {
            provider: ApiProviderProfile {
                base_url: Some(base_url),
                ..test_provider()
            },
            system_prompt: None,
            tools: vec![ToolDef {
                name: "get_weather".to_string(),
                description: "获取天气".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "date": { "type": "string" }
                    }
                }),
            }],
            history: Vec::new(),
            new_user_message: Some("今天是什么天气".to_string()),
        };

        let result = broker.run(request).await.unwrap();
        match result {
            AgentTurnResult::NeedsToolCalls {
                assistant_turn,
                tool_calls,
            } => {
                assert_eq!(assistant_turn.tool_calls.len(), 1);
                assert_eq!(tool_calls.len(), 1);
                assert_eq!(tool_calls[0].name, "get_weather");
                assert_eq!(tool_calls[0].input["date"], "today");
            }
            AgentTurnResult::Final { .. } => panic!("expected NeedsToolCalls"),
        }

        assert_eq!(call_count.load(Ordering::SeqCst), 1);
        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn broker_continues_with_history_and_tool_result() {
        let (base_url, call_count, shutdown_tx) = spawn_anthropic_server().await;
        let broker = AgentTurnBroker;
        let request = AgentTurnRequest {
            provider: ApiProviderProfile {
                provider: "anthropic".to_string(),
                base_url: Some(base_url),
                ..test_provider()
            },
            system_prompt: Some("你是测试助手".to_string()),
            tools: vec![ToolDef {
                name: "get_weather".to_string(),
                description: "获取天气".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "date": { "type": "string" }
                    }
                }),
            }],
            history: vec![
                TurnItem::User {
                    content: "今天是什么天气".to_string(),
                },
                TurnItem::Assistant {
                    content: String::new(),
                    tool_calls: vec![ToolCall {
                        id: "call_1".to_string(),
                        name: "get_weather".to_string(),
                        input: json!({ "date": "today" }),
                    }],
                },
                TurnItem::ToolResult {
                    tool_call_id: "call_1".to_string(),
                    tool_name: "get_weather".to_string(),
                    content: "今天是阴天，气温21.45度".to_string(),
                },
            ],
            new_user_message: None,
        };

        let result = broker.run(request).await.unwrap();
        match result {
            AgentTurnResult::Final { assistant_turn } => {
                assert_eq!(assistant_turn.content, "今天是阴天，气温21.45度。");
                assert!(assistant_turn.tool_calls.is_empty());
            }
            AgentTurnResult::NeedsToolCalls { .. } => panic!("expected Final"),
        }

        assert_eq!(call_count.load(Ordering::SeqCst), 1);
        let _ = shutdown_tx.send(());
    }
}
