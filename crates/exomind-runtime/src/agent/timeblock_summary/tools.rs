use crate::agent::tools::{ToolDef, ToolError, ToolFn};
use crate::eventlog::EventLogStore;
use crate::timeblock::TimeBlockData;
use serde_json::{Value, json};
use std::sync::Arc;

use super::SummaryKind;

pub const SUBMIT_TIMEBLOCK_SUMMARY_TOOL: &str = "submit_timeblock_summary";

/// Build the submit_timeblock_summary tool definition and handler.
///
/// This is the ONLY tool the LLM sees. All read-only context is pre-filled in the prompt.
pub fn submit_timeblock_summary_tool(
    block: TimeBlockData,
    kind: SummaryKind,
    eventlog_store: Arc<EventLogStore>,
) -> (ToolDef, ToolFn) {
    let def = ToolDef {
        name: SUBMIT_TIMEBLOCK_SUMMARY_TOOL.to_string(),
        description: "提交时间块总结的结构化字段。Runtime 会校验入参并生成最终 agent_feedback 事件。".to_string(),
        input_schema: json!({
            "type": "object",
            "required": ["blockId", "summaryKind", "narrative"],
            "properties": {
                "blockId": {
                    "type": "string",
                    "description": "时间块 ID，必须与当前处理的块一致"
                },
                "summaryKind": {
                    "type": "string",
                    "enum": ["start", "end"],
                    "description": "总结类型：start=开始提示，end=结束总结"
                },
                "narrative": {
                    "type": "string",
                    "description": "2-3 句话，串联时间块内事件（若为时间块开始，则总结先前gap块内事件），不列精确统计"
                },
                "quotedNotes": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "引用 1-2 条原始 note，可为空数组但需说明原因"
                },
                "outcomes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["item", "status"],
                        "properties": {
                            "item": { "type": "string" },
                            "status": { "type": "string", "enum": ["done", "ongoing", "not_done", "unknown"] },
                            "note": { "type": "string" }
                        }
                    },
                    "description": "本次时间块成果列表"
                },
                "relations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["item", "status"],
                        "properties": {
                            "item": { "type": "string" },
                            "status": { "type": "string", "enum": ["done", "none", "unknown"] },
                            "note": { "type": "string" }
                        }
                    },
                    "description": "仓库侧/任务侧关联事项"
                },
                "suggestions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["kind", "text"],
                        "properties": {
                            "kind": { "type": "string" },
                            "text": { "type": "string" }
                        }
                    },
                    "description": "1-3 条下一步建议"
                },
                "confidence": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "description": "对本次总结质量的信心评估"
                }
            }
        }),
    };

    let expected_block_id = block.start_id.clone();
    let expected_kind = kind.clone();

    let tool_fn: ToolFn = Box::new(move |input: Value| {
        let block_id_expected = expected_block_id.clone();
        let kind_expected = expected_kind.clone();
        let store = Arc::clone(&eventlog_store);
        Box::pin(async move {
            // Validate blockId
            let block_id = input
                .get("blockId")
                .and_then(Value::as_str)
                .ok_or_else(|| ToolError::InvalidInput("missing blockId".to_string()))?;
            if block_id != block_id_expected {
                return Err(ToolError::InvalidInput(format!(
                    "blockId mismatch: expected {}, got {}",
                    block_id_expected, block_id
                )));
            }

            // Validate summaryKind
            let summary_kind = input
                .get("summaryKind")
                .and_then(Value::as_str)
                .ok_or_else(|| ToolError::InvalidInput("missing summaryKind".to_string()))?;
            let expected_kind_str = match kind_expected {
                SummaryKind::Start => "start",
                SummaryKind::End => "end",
            };
            if summary_kind != expected_kind_str {
                return Err(ToolError::InvalidInput(format!(
                    "summaryKind mismatch: expected {}, got {}",
                    expected_kind_str, summary_kind
                )));
            }

            // Validate narrative
            let narrative = input
                .get("narrative")
                .and_then(Value::as_str)
                .ok_or_else(|| ToolError::InvalidInput("missing narrative".to_string()))?;
            if narrative.trim().is_empty() {
                return Err(ToolError::InvalidInput(
                    "narrative must not be empty".to_string(),
                ));
            }

            // Build the final Markdown content
            let quoted_notes = input
                .get("quotedNotes")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join("\n- ")
                })
                .unwrap_or_default();

            let outcomes = input
                .get("outcomes")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let item_name = item.get("item")?.as_str()?;
                            let status = item.get("status")?.as_str()?;
                            let note = item.get("note").and_then(Value::as_str).unwrap_or("");
                            let icon = match status {
                                "done" => "✅",
                                "ongoing" => "🔄",
                                "not_done" => "❌",
                                _ => "❓",
                            };
                            Some(format!("| {} {} | {} |", icon, item_name, note))
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            let relations = input
                .get("relations")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let item_name = item.get("item")?.as_str()?;
                            let status = item.get("status")?.as_str()?;
                            let note = item.get("note").and_then(Value::as_str).unwrap_or("");
                            Some(format!("| {} | {} |", item_name, note))
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            let suggestions = input
                .get("suggestions")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.get("text")?.as_str())
                        .enumerate()
                        .map(|(i, text)| format!("{}. {}", i + 1, text))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            let title = match summary_kind {
                "start" => format!("## 时间块开始\n\n**{}** 已启动。", block_id),
                "end" => format!("## 时间块结束总结\n\n**{}** 已结束。", block_id),
                _ => unreachable!(),
            };

            let mut content = format!("{}\n\n{}", title, narrative);

            if !quoted_notes.is_empty() {
                content.push_str(&format!("\n\n### 引用\n- {}", quoted_notes));
            }
            if !outcomes.is_empty() {
                content.push_str(&format!(
                    "\n\n### 成果\n| 事项 | 说明 |\n|------|------|\n{}",
                    outcomes
                ));
            }
            if !relations.is_empty() {
                content.push_str(&format!(
                    "\n\n### 关联事项\n| 事项 | 说明 |\n|------|------|\n{}",
                    relations
                ));
            }
            if !suggestions.is_empty() {
                content.push_str(&format!("\n\n### 下一步建议\n{}", suggestions));
            }

            // Write to eventlog
            let event = crate::eventlog::EventRecord {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                content,
                tags: vec!["agent_feedback".to_string()],
                refs: vec![],
                metadata: Some(json!({
                    "agent": "timeblock_summary",
                    "block_id": block_id,
                    "summary_kind": summary_kind,
                })),
            };

            match store.append_event(None, event.clone()) {
                Ok(_) => Ok(format!(
                    "已写入 agent_feedback 事件，event_id={}",
                    event.id
                )),
                Err(e) => Err(ToolError::ExecutionFailed(format!(
                    "failed to write eventlog: {e}"
                ))),
            }
        })
    });

    (def, tool_fn)
}
