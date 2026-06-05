use crate::eventlog::{EventListFilter, EventLogStore, EventRecord};
use crate::timeblock::TimeBlockData;
use std::sync::Arc;

/// Collected context for a timeblock summary run.
///
/// All read-only data is pre-fetched by Runtime code before the LLM is called.
/// The LLM only sees this context embedded in the prompt — no read-only tools needed.
#[derive(Debug, Clone)]
pub struct CollectedContext {
    pub block: TimeBlockData,
    pub events: Vec<EventRecord>,
    pub block_feedback: Option<EventRecord>,
    pub recent_completed: Option<EventRecord>,
    pub already_has_start: bool,
    pub already_has_end: bool,
    pub energy_current: u64,
    pub energy_max: u64,
}

impl CollectedContext {
    /// Format the context as structured text for prompt injection.
    pub fn to_prompt_section(&self) -> String {
        let mut sections = Vec::new();

        // Block info — blockId is critical for submit_timeblock_summary tool
        sections.push(format!(
            "### 时间块信息\n- **blockId（必须使用此值）：{}**\n- 名称：{}\n- 开始时间：{}\n- 结束时间：{}\n- 类型：{}\n- 关联任务：{}",
            self.block.start_id,
            self.block.name,
            self.block.start_time,
            self.block.end_time,
            self.block.block_type.as_deref().unwrap_or("active"),
            if self.block.task_ids.is_empty() {
                "无".to_string()
            } else {
                self.block.task_ids.join(", ")
            },
        ));

        // Events in this timeblock
        if self.events.is_empty() {
            sections.push("### 该时间块内的事件\n（无事件记录）".to_string());
        } else {
            let event_lines: Vec<String> = self
                .events
                .iter()
                .map(|e| {
                    let tags = if e.tags.is_empty() {
                        String::new()
                    } else {
                        format!(" (tags: {})", e.tags.join(", "))
                    };
                    format!("[{}] {}{}", e.timestamp, e.content, tags)
                })
                .collect();
            sections.push(format!(
                "### 该时间块内的事件\n{}",
                event_lines.join("\n")
            ));
        }

        // block_feedback
        match &self.block_feedback {
            Some(bf) => {
                sections.push(format!("### block_feedback\n{}", bf.content));
            }
            None => {
                sections.push("### block_feedback\n（尚未生成）".to_string());
            }
        }

        // Recent completed block
        match &self.recent_completed {
            Some(rc) => {
                sections.push(format!("### 近期已完成时间块\n{}", rc.content));
            }
            None => {
                sections.push("### 近期已完成时间块\n（无）".to_string());
            }
        }

        // Already-processed status
        let mut status_lines = Vec::new();
        if self.already_has_start {
            status_lines.push("已有开始提示");
        }
        if self.already_has_end {
            status_lines.push("已有结束总结");
        }
        if status_lines.is_empty() {
            sections.push("### 已处理状态\n（首次处理）".to_string());
        } else {
            sections.push(format!(
                "### 已处理状态\n{}",
                status_lines.join("、")
            ));
        }

        // Energy status
        sections.push(format!(
            "### 系统状态\n- 当前能量：{}/{}\n- 能量耗尽时将自动停止",
            self.energy_current, self.energy_max
        ));

        sections.join("\n\n")
    }
}

/// Automatically collect all read-only context for a timeblock summary run.
///
/// This is called by Runtime code, NOT by the LLM via tools.
pub async fn collect_context(
    eventlog_store: &EventLogStore,
    block: &TimeBlockData,
    energy_current: u64,
    energy_max: u64,
) -> CollectedContext {
    // 1. Events in this timeblock range
    let events = eventlog_store
        .list_events_filtered(
            None,
            &EventListFilter {
                since_timestamp: Some(block.start_time as i64),
                until_timestamp: Some(block.end_time as i64),
                limit: Some(100),
                ..Default::default()
            },
        )
        .unwrap_or_default();

    // 2. block_feedback (if any)
    let block_feedback = eventlog_store
        .list_events_filtered(
            None,
            &EventListFilter {
                tags: vec!["block_feedback".to_string()],
                since_timestamp: Some(block.start_time as i64),
                until_timestamp: Some(block.end_time as i64),
                limit: Some(1),
                ..Default::default()
            },
        )
        .ok()
        .and_then(|mut v| v.pop());

    // 3. Recent completed block (before this one)
    let recent_completed = eventlog_store
        .list_events_filtered(
            None,
            &EventListFilter {
                tags: vec!["block_feedback".to_string()],
                until_timestamp: Some(block.start_time as i64 - 1),
                limit: Some(1),
                ..Default::default()
            },
        )
        .ok()
        .and_then(|mut v| v.pop());

    // 4. Already-processed status: query eventlog for existing agent_feedback
    let end_time = if block.end_time > 0 {
        block.end_time as i64
    } else {
        chrono::Utc::now().timestamp_millis()
    };
    let feedback_filter = EventListFilter {
        since_timestamp: Some(block.start_time as i64),
        until_timestamp: Some(end_time),
        tags: vec!["agent_feedback".to_string()],
        limit: Some(10),
        ..Default::default()
    };
    let feedback_events = eventlog_store
        .list_events_filtered(None, &feedback_filter)
        .unwrap_or_default();
    let already_has_start = feedback_events.iter().any(|e| {
        e.metadata
            .as_ref()
            .and_then(|m| m.get("summaryKind"))
            .and_then(|v| v.as_str())
            == Some("start")
    });
    let already_has_end = feedback_events.iter().any(|e| {
        e.metadata
            .as_ref()
            .and_then(|m| m.get("summaryKind"))
            .and_then(|v| v.as_str())
            == Some("end")
    });

    CollectedContext {
        block: block.clone(),
        events,
        block_feedback,
        recent_completed,
        already_has_start,
        already_has_end,
        energy_current,
        energy_max,
    }
}
