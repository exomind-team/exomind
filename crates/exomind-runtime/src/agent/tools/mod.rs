use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

pub mod eventlog;

pub const GET_RECENT_EVENTS_TOOL: &str = "get_recent_events";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
}

pub type ToolFuture = Pin<Box<dyn Future<Output = Result<String, ToolError>> + Send>>;
pub type ToolFn = Box<dyn Fn(Value) -> ToolFuture + Send + Sync>;

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
}

#[derive(Default)]
pub struct ToolRegistry {
    defs: Vec<ToolDef>,
    fns: HashMap<String, ToolFn>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, def: ToolDef, f: ToolFn) {
        self.fns.insert(def.name.clone(), f);
        self.defs.push(def);
    }

    pub fn list_defs(&self) -> &[ToolDef] {
        &self.defs
    }

    pub fn is_empty(&self) -> bool {
        self.defs.is_empty()
    }

    pub async fn dispatch(&self, tool_use: &ToolUse) -> ToolResult {
        match self.fns.get(&tool_use.name) {
            None => ToolResult {
                tool_use_id: tool_use.id.clone(),
                content: format!("Unknown tool: {}", tool_use.name),
            },
            Some(f) => {
                let content = match f(tool_use.input.clone()).await {
                    Ok(value) => value,
                    Err(error) => format!("Tool error: {error}"),
                };
                ToolResult {
                    tool_use_id: tool_use.id.clone(),
                    content,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eventlog::{EventLogStore, EventRecord};
    use std::sync::Arc;
    use tempfile::tempdir;

    fn build_test_registry() -> ToolRegistry {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        store
            .append_event(
                Some("profile-alpha"),
                EventRecord {
                    id: "evt-1".to_string(),
                    timestamp: 10,
                    content: "复盘 Agent API 设计".to_string(),
                    tags: vec!["work".to_string(), "agent".to_string()],
                    refs: Vec::new(),
                    metadata: None,
                },
            )
            .unwrap();
        store
            .append_event(
                Some("profile-alpha"),
                EventRecord {
                    id: "evt-2".to_string(),
                    timestamp: 20,
                    content: "整理 runtime 路由".to_string(),
                    tags: vec!["code".to_string()],
                    refs: Vec::new(),
                    metadata: None,
                },
            )
            .unwrap();

        let mut registry = ToolRegistry::new();
        let (def, tool_fn) =
            eventlog::get_recent_events_tool(Arc::clone(&store), Some("profile-alpha".to_string()));
        registry.register(def, tool_fn);
        registry
    }

    #[tokio::test]
    async fn get_recent_events_tool_formats_event_lines() {
        let registry = build_test_registry();
        let result = registry
            .dispatch(&ToolUse {
                id: "call_1".to_string(),
                name: GET_RECENT_EVENTS_TOOL.to_string(),
                input: serde_json::json!({ "limit": 2 }),
            })
            .await;

        assert_eq!(result.tool_use_id, "call_1");
        assert!(result.content.contains("整理 runtime 路由"));
        assert!(result.content.contains("复盘 Agent API 设计"));
    }

    #[tokio::test]
    async fn get_recent_events_tool_uses_default_limit_of_ten() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        for index in 0..12 {
            store
                .append_event(
                    Some("profile-alpha"),
                    EventRecord {
                        id: format!("evt-{index}"),
                        timestamp: index as i64,
                        content: format!("event-{index}"),
                        tags: Vec::new(),
                        refs: Vec::new(),
                        metadata: None,
                    },
                )
                .unwrap();
        }

        let mut registry = ToolRegistry::new();
        let (def, tool_fn) =
            eventlog::get_recent_events_tool(Arc::clone(&store), Some("profile-alpha".to_string()));
        registry.register(def, tool_fn);

        let result = registry
            .dispatch(&ToolUse {
                id: "call-default".to_string(),
                name: GET_RECENT_EVENTS_TOOL.to_string(),
                input: serde_json::json!({}),
            })
            .await;

        let lines = result.content.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 10);
        assert!(lines.iter().any(|line| line.contains("event-11")));
        assert!(!lines.iter().any(|line| line.contains("event-0")));
        assert!(!lines.iter().any(|line| line.contains("event-1 (")));
    }
}
