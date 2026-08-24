use crate::eventlog::{EventListFilter, EventLogStore, EventRecord};
use crate::timeblock::TimeBlockData;
use std::sync::Arc;

/// Format a Unix millisecond timestamp to a human-readable local time string.
/// Returns "N/A" for zero timestamps (e.g., active block without end_time).
fn format_timestamp(millis: u64) -> String {
    if millis == 0 {
        return "N/A".to_string();
    }
    let secs = millis / 1000;
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|| "invalid".to_string())
}

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
    pub energy_current: u64,
    pub energy_max: u64,
    pub user_id: String,
}

impl CollectedContext {
    /// Format the context as structured text for prompt injection.
    pub fn to_prompt_section(&self) -> String {
        let mut sections = Vec::new();

        // Block info — blockId is critical for submit_timeblock_summary tool
        sections.push(format!(
            "### 时间块信息\n- **blockId（必须使用此值）：{}**\n- 名称：{}\n- 开始时间：{}\n- 结束时间：{}\n- 类型：{}\n- 关联任务：{}\n- **当前档案（user_id）：{}**",
            self.block.start_id,
            self.block.name,
            format_timestamp(self.block.start_time),
            format_timestamp(self.block.end_time),
            self.block.block_type.as_deref().unwrap_or("active"),
            if self.block.task_ids.is_empty() {
                "无".to_string()
            } else {
                self.block.task_ids.join(", ")
            },
            self.user_id,
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
                        format!(" tags=\"{}\"", e.tags.join(","))
                    };
                    format!(
                        // 📌【2026-06-06 07:07: 45】人写：用HTML标签来区分，兼容多行换行的事件
                        "<event timestamp=\"{}\"{tags}>\n{}\n</event>",
                        format_timestamp(e.timestamp as u64),
                        e.content
                    )
                })
                .collect();
            sections.push(format!("### 该时间块内的事件\n{}", event_lines.join("\n")));
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

        // Energy status
        sections.push(format!(
            "### 作为Agent，你的自我状态\n- Agent当前能量：{}/{}\n- 当Agent自己的能量耗尽时，你将无法继续行动",
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
    user_id: &str,
) -> CollectedContext {
    // 1. Events in this timeblock range
    let uid = if user_id.is_empty() {
        None
    } else {
        Some(user_id)
    };
    let events = eventlog_store
        .list_events_filtered(
            uid,
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
            uid,
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
            uid,
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
        .list_events_filtered(uid, &feedback_filter)
        .unwrap_or_default();

    CollectedContext {
        block: block.clone(),
        events,
        block_feedback,
        recent_completed,
        energy_current,
        energy_max,
        user_id: user_id.to_string(),
    }
}
