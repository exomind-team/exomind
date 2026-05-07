use super::{ToolDef, ToolError, ToolFn};
use crate::eventlog::{EventListFilter, EventLogStore};
use serde_json::{Value, json};
use std::sync::Arc;

pub fn get_recent_events_tool(
    eventlog_store: Arc<EventLogStore>,
    user_id: Option<String>,
) -> (ToolDef, ToolFn) {
    let def = ToolDef {
        name: super::GET_RECENT_EVENTS_TOOL.to_string(),
        description: "获取事件日志中最近 N 条事件，按时间倒序返回".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "返回条数，默认 10，最大 100",
                    "minimum": 1,
                    "maximum": 100
                }
            }
        }),
    };

    let tool_fn: ToolFn = Box::new(move |input: Value| {
        let store = Arc::clone(&eventlog_store);
        let bound_user_id = user_id.clone();
        Box::pin(async move {
            let limit = input
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .clamp(1, 100) as usize;

            let events = store
                .list_events_filtered(
                    bound_user_id.as_deref(),
                    &EventListFilter {
                        limit: Some(limit),
                        ..Default::default()
                    },
                )
                .map_err(ToolError::ExecutionFailed)?;
            if events.is_empty() {
                return Ok("（暂无事件记录）".to_string());
            }

            Ok(events
                .iter()
                .map(|event| {
                    let tags = if event.tags.is_empty() {
                        "-".to_string()
                    } else {
                        event.tags.join(", ")
                    };
                    format!("[{}] {} (tags: {})", event.timestamp, event.content, tags)
                })
                .collect::<Vec<_>>()
                .join("\n"))
        })
    });

    (def, tool_fn)
}
