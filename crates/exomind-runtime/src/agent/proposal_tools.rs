use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use thiserror::Error;

use super::broker::{ToolCall, ToolDef};
use crate::proposal::{
    ActionType, CreateProposalInput, ProposalStore, ProposalStoreError, Publisher,
};
use crate::task::TaskPriority;

pub const ADD_TASK_PROPOSAL_TOOL: &str = "add_task_proposal";
pub const ADD_TIMEBLOCK_PROPOSAL_TOOL: &str = "add_timeblock_proposal";
pub const ADD_EVENT_PROPOSAL_TOOL: &str = "add_event_proposal";

pub fn is_proposal_tool_name(name: &str) -> bool {
    matches!(
        name,
        ADD_TASK_PROPOSAL_TOOL | ADD_TIMEBLOCK_PROPOSAL_TOOL | ADD_EVENT_PROPOSAL_TOOL
    )
}

#[derive(Debug, Error)]
pub enum ProposalToolError {
    #[error("unsupported proposal tool: {0}")]
    UnsupportedTool(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("proposal store error: {0}")]
    Store(#[from] ProposalStoreError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddTaskProposalInput {
    title: String,
    body: String,
    task_title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    priority: Option<TaskPriority>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddTimeblockProposalInput {
    title: String,
    body: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    target_minutes: Option<u64>,
    #[serde(default)]
    task_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddEventProposalInput {
    title: String,
    body: String,
    content: String,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

pub fn proposal_tool_defs() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: ADD_TASK_PROPOSAL_TOOL.to_string(),
            description: "添加一个任务提案草案。适用于从事件日志中提取后续待办或验收事项。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "taskTitle": { "type": "string" },
                    "description": { "type": "string" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high"]
                    }
                },
                "required": ["title", "body", "taskTitle"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: ADD_TIMEBLOCK_PROPOSAL_TOOL.to_string(),
            description: "添加一个计划时间块提案草案。适用于需要预留聚焦工作时间的事项。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "mode": { "type": "string" },
                    "targetMinutes": {
                        "type": "integer",
                        "minimum": 1
                    },
                    "taskIds": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["title", "body", "name"],
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: ADD_EVENT_PROPOSAL_TOOL.to_string(),
            description: "添加一条事件提案草案。适用于补记总结、里程碑或回顾事件。".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "content": { "type": "string" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["title", "body", "content"],
                "additionalProperties": false
            }),
        },
    ]
}

pub async fn execute_proposal_tool_call(
    store: Arc<ProposalStore>,
    scope_key: Option<String>,
    publisher: Publisher,
    tool_call: &ToolCall,
) -> Result<String, ProposalToolError> {
    let input = create_input_from_tool_call(tool_call, publisher)?;
    let action_type = input.action_type;
    let title = input.title.clone();
    let proposal = store.create_scoped(scope_key.as_deref(), input)?;

    Ok(serde_json::to_string(&json!({
        "proposalId": proposal.id,
        "status": "pending",
        "actionType": action_type_name(action_type),
        "title": title,
        "scopeKey": scope_key,
    }))?)
}

fn create_input_from_tool_call(
    tool_call: &ToolCall,
    publisher: Publisher,
) -> Result<CreateProposalInput, ProposalToolError> {
    match tool_call.name.as_str() {
        ADD_TASK_PROPOSAL_TOOL => {
            let input: AddTaskProposalInput = serde_json::from_value(tool_call.input.clone())?;
            let title = required_text("title", input.title)?;
            let body = required_text("body", input.body)?;
            let task_title = required_text("taskTitle", input.task_title)?;
            let description = optional_text(input.description);
            let tags = normalize_string_list(input.tags);
            Ok(CreateProposalInput {
                title,
                body,
                action_type: ActionType::CreateTask,
                action_params: json!({
                    "title": task_title,
                    "description": description,
                    "tags": tags,
                    "priority": input.priority,
                }),
                references: vec![],
                publisher,
            })
        }
        ADD_TIMEBLOCK_PROPOSAL_TOOL => {
            let input: AddTimeblockProposalInput = serde_json::from_value(tool_call.input.clone())?;
            let title = required_text("title", input.title)?;
            let body = required_text("body", input.body)?;
            let name = required_text("name", input.name)?;
            if matches!(input.target_minutes, Some(0)) {
                return Err(ProposalToolError::InvalidInput(
                    "targetMinutes must be greater than 0".to_string(),
                ));
            }
            Ok(CreateProposalInput {
                title,
                body,
                action_type: ActionType::StartTimeblock,
                action_params: json!({
                    "name": name,
                    "description": optional_text(input.description),
                    "tags": normalize_string_list(input.tags),
                    "mode": optional_text(input.mode),
                    "target_minutes": input.target_minutes,
                    "task_ids": normalize_string_list(input.task_ids),
                }),
                references: vec![],
                publisher,
            })
        }
        ADD_EVENT_PROPOSAL_TOOL => {
            let input: AddEventProposalInput = serde_json::from_value(tool_call.input.clone())?;
            Ok(CreateProposalInput {
                title: required_text("title", input.title)?,
                body: required_text("body", input.body)?,
                action_type: ActionType::AppendEvent,
                action_params: json!({
                    "content": required_text("content", input.content)?,
                    "tags": normalize_string_list(input.tags),
                }),
                references: vec![],
                publisher,
            })
        }
        other => Err(ProposalToolError::UnsupportedTool(other.to_string())),
    }
}

fn action_type_name(action_type: ActionType) -> &'static str {
    match action_type {
        ActionType::CreateTask => "create_task",
        ActionType::AppendEvent => "append_event",
        ActionType::StartTimeblock => "start_timeblock",
        ActionType::ApproveAgentAccess => "approve_agent_access",
    }
}

fn required_text(field: &str, value: String) -> Result<String, ProposalToolError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ProposalToolError::InvalidInput(format!(
            "{field} must not be empty"
        )));
    }
    Ok(trimmed.to_string())
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_string_list(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let normalized = values
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::agent::broker::ToolCall;
    use crate::proposal::{ProposalFilter, ProposalStatus, Publisher, PublisherType};
    use serde_json::{Value, json};

    use super::{
        ADD_EVENT_PROPOSAL_TOOL, ADD_TASK_PROPOSAL_TOOL, ADD_TIMEBLOCK_PROPOSAL_TOOL,
        execute_proposal_tool_call, proposal_tool_defs,
    };

    fn test_publisher() -> Publisher {
        Publisher {
            publisher_type: PublisherType::Agent,
            id: "api-agent".to_string(),
            name: "API Agent".to_string(),
        }
    }

    #[tokio::test]
    async fn executes_task_proposal_tool_and_persists_pending_proposal() {
        let store = Arc::new(crate::proposal::ProposalStore::new());
        let output = execute_proposal_tool_call(
            Arc::clone(&store),
            Some("profile-alpha".to_string()),
            test_publisher(),
            &ToolCall {
                id: "call-1".to_string(),
                name: ADD_TASK_PROPOSAL_TOOL.to_string(),
                input: json!({
                    "title": "创建任务提案",
                    "body": "事件日志中提到了明天验收",
                    "taskTitle": "验收任务依赖图新布局",
                    "description": "验证 task-dag 新布局",
                    "tags": ["task-dag", "acceptance"],
                    "priority": "high"
                }),
            },
        )
        .await
        .unwrap();

        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(parsed["actionType"], "create_task");

        let proposals = store
            .list_scoped(Some("profile-alpha"), &ProposalFilter::default())
            .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(
            proposals[0].action_type,
            crate::proposal::ActionType::CreateTask
        );
        assert_eq!(proposals[0].status, ProposalStatus::Pending);
    }

    #[tokio::test]
    async fn executes_timeblock_and_event_tools_with_expected_action_types() {
        let store = Arc::new(crate::proposal::ProposalStore::new());

        let timeblock_output = execute_proposal_tool_call(
            Arc::clone(&store),
            Some("profile-alpha".to_string()),
            test_publisher(),
            &ToolCall {
                id: "call-2".to_string(),
                name: ADD_TIMEBLOCK_PROPOSAL_TOOL.to_string(),
                input: json!({
                    "title": "创建时间块提案",
                    "body": "需要安排验收时间",
                    "name": "任务依赖图验收",
                    "targetMinutes": 45
                }),
            },
        )
        .await
        .unwrap();
        let event_output = execute_proposal_tool_call(
            Arc::clone(&store),
            Some("profile-alpha".to_string()),
            test_publisher(),
            &ToolCall {
                id: "call-3".to_string(),
                name: ADD_EVENT_PROPOSAL_TOOL.to_string(),
                input: json!({
                    "title": "创建事件提案",
                    "body": "需要补总结事件",
                    "content": "Agent 总结：准备开始回填 issue"
                }),
            },
        )
        .await
        .unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&timeblock_output).unwrap()["actionType"],
            "start_timeblock"
        );
        assert_eq!(
            serde_json::from_str::<Value>(&event_output).unwrap()["actionType"],
            "append_event"
        );
    }

    #[test]
    fn proposal_tool_defs_expose_all_three_tools() {
        let names = proposal_tool_defs()
            .into_iter()
            .map(|tool| tool.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&ADD_TASK_PROPOSAL_TOOL.to_string()));
        assert!(names.contains(&ADD_TIMEBLOCK_PROPOSAL_TOOL.to_string()));
        assert!(names.contains(&ADD_EVENT_PROPOSAL_TOOL.to_string()));
    }

    #[tokio::test]
    async fn rejects_invalid_tool_input() {
        let store = Arc::new(crate::proposal::ProposalStore::new());
        let error = execute_proposal_tool_call(
            store,
            Some("profile-alpha".to_string()),
            test_publisher(),
            &ToolCall {
                id: "call-4".to_string(),
                name: ADD_TASK_PROPOSAL_TOOL.to_string(),
                input: json!({
                    "title": "  ",
                    "body": "reason",
                    "taskTitle": "task"
                }),
            },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("title must not be empty"));
    }
}
