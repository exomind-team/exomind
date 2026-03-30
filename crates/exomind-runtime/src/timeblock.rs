use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::timeblock_sqlite::SqliteTimeBlockStore;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeBlockData {
    pub id: String,
    pub name: String,
    pub start_id: String,
    pub end_id: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub start_time: u64,
    pub end_time: u64,
    #[serde(default)]
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub task_status_outcomes: Option<HashMap<String, String>>,
    #[serde(default)]
    pub task_association_log: Vec<BlockTaskAssociationEvent>,
    #[serde(default)]
    pub source_planned_block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlannedTimeBlockType {
    Work,
    Rest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedTimeBlockData {
    pub id: String,
    pub date: String,
    #[serde(rename = "type")]
    pub block_type: PlannedTimeBlockType,
    pub title: String,
    pub planned_start_at: u64,
    pub planned_duration_minutes: u64,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub linked_task_ids: Vec<String>,
    pub order: i64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RhythmPresetData {
    pub key: String,
    pub label: String,
    pub work_minutes: u64,
    pub short_break_minutes: u64,
    pub long_break_minutes: u64,
    pub long_break_after_work_segments: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlannedSegmentKind {
    Work,
    Break,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BreakWindowKind {
    Short,
    Long,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSegmentData {
    pub id: String,
    pub window_id: String,
    pub kind: PlannedSegmentKind,
    #[serde(default)]
    pub break_kind: Option<BreakWindowKind>,
    pub title: String,
    pub planned_start_at: u64,
    pub planned_end_at: u64,
    #[serde(default)]
    pub linked_task_ids: Vec<String>,
    pub order: i64,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulingWindowData {
    pub id: String,
    pub date: String,
    #[serde(default)]
    pub title: Option<String>,
    pub planned_start_at: u64,
    pub planned_end_at: u64,
    pub rhythm_preset: RhythmPresetData,
    #[serde(default)]
    pub segments: Vec<PlannedSegmentData>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockTaskAssociationEvent {
    pub block_id: String,
    pub task_id: String,
    pub action: String,
    pub timestamp: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBlockData {
    pub start_id: String,
    pub name: String,
    pub mode: String,
    pub target_minutes: Option<u64>,
    pub elapsed: u64,
    pub updated_at: Option<u64>,
    pub phase: Option<String>,
    pub version: Option<u64>,
    pub actor_id: Option<String>,
    pub last_transition_at: Option<u64>,
    pub last_resumed_at: Option<u64>,
    pub accumulated_run_ms: Option<u64>,
    pub start_time: u64,
    pub action_ended_at: Option<u64>,
    pub feedback_started_at: Option<u64>,
    pub feedback_submitted_at: Option<u64>,
    pub pause_accumulated_ms: Option<u64>,
    pub paused: bool,
    pub paused_at: Option<u64>,
    #[serde(default)]
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub task_association_log: Vec<BlockTaskAssociationEvent>,
    #[serde(default)]
    pub source_planned_block_id: Option<String>,
    /// Deprecated: legacy single-task field. Read for compat, never written.
    #[serde(default, skip_serializing)]
    pub task_id: Option<String>,
}

impl ActiveBlockData {
    pub fn normalize_task_ids(mut self) -> Self {
        if self.task_ids.is_empty() {
            let task_ids_from_log = current_task_ids_from_log(&self.task_association_log);
            if !task_ids_from_log.is_empty() {
                self.task_ids = task_ids_from_log;
                return self;
            }
            if let Some(task_id) = self
                .task_id
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                self.task_ids = vec![task_id];
            }
        }
        self
    }
}

fn current_task_ids_from_log(task_association_log: &[BlockTaskAssociationEvent]) -> Vec<String> {
    let mut ordered_task_ids: Vec<String> = Vec::new();
    let mut active_task_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for event in task_association_log {
        let task_id = event.task_id.trim();
        if task_id.is_empty() {
            continue;
        }

        if event.action == "associated" {
            if active_task_ids.insert(task_id.to_string()) {
                ordered_task_ids.push(task_id.to_string());
            }
            continue;
        }

        active_task_ids.remove(task_id);
    }

    ordered_task_ids
        .into_iter()
        .filter(|task_id| active_task_ids.contains(task_id))
        .collect()
}

#[derive(Debug, Error)]
pub enum TimeBlockStoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeBlockStoreBackendKind {
    Memory,
    Sqlite,
}

#[derive(Default)]
struct TimeBlockScopeState {
    completed: Vec<TimeBlockData>,
    active: Option<ActiveBlockData>,
    planned: Vec<PlannedTimeBlockData>,
    windows: Vec<SchedulingWindowData>,
}

enum TimeBlockStoreBackend {
    Memory(RwLock<HashMap<String, TimeBlockScopeState>>),
    Sqlite(SqliteTimeBlockStore),
}

pub struct TimeBlockStore {
    backend: TimeBlockStoreBackend,
}

const DEFAULT_SCOPE_KEY: &str = "anonymous";

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

impl TimeBlockStore {
    pub fn new() -> Self {
        Self {
            backend: TimeBlockStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, TimeBlockStoreError> {
        Ok(Self {
            backend: TimeBlockStoreBackend::Sqlite(SqliteTimeBlockStore::open(path)?),
        })
    }

    pub fn list_completed(&self) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        self.list_completed_scoped(None)
    }

    pub fn list_planned(&self) -> Result<Vec<PlannedTimeBlockData>, TimeBlockStoreError> {
        self.list_planned_scoped(None)
    }

    pub fn list_planned_scoped(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Vec<PlannedTimeBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(sorted_planned_blocks(
                state
                    .read()
                    .unwrap()
                    .get(normalize_scope_key(scope_key))
                    .map(|scope| scope.planned.clone())
                    .unwrap_or_default(),
            )),
            TimeBlockStoreBackend::Sqlite(store) => {
                store.list_planned_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn list_planned_for_date_scoped(
        &self,
        scope_key: Option<&str>,
        date: &str,
    ) -> Result<Vec<PlannedTimeBlockData>, TimeBlockStoreError> {
        let normalized_date = date.trim();
        Ok(self
            .list_planned_scoped(scope_key)?
            .into_iter()
            .filter(|block| block.date == normalized_date)
            .collect())
    }

    pub fn get_planned_scoped(
        &self,
        scope_key: Option<&str>,
        block_id: &str,
    ) -> Result<Option<PlannedTimeBlockData>, TimeBlockStoreError> {
        let normalized_block_id = block_id.trim();
        if normalized_block_id.is_empty() {
            return Ok(None);
        }

        Ok(self
            .list_planned_scoped(scope_key)?
            .into_iter()
            .find(|block| block.id == normalized_block_id))
    }

    pub fn replace_planned_scoped(
        &self,
        scope_key: Option<&str>,
        blocks: &[PlannedTimeBlockData],
    ) -> Result<(), TimeBlockStoreError> {
        let sorted = sorted_planned_blocks(blocks.to_vec());
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .planned = sorted;
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.replace_planned_scoped(normalize_scope_key(scope_key), &sorted)
            }
        }
    }

    pub fn put_planned_scoped(
        &self,
        scope_key: Option<&str>,
        block: PlannedTimeBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                let mut guard = state.write().unwrap();
                let scope = guard
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default();
                if let Some(index) = scope.planned.iter().position(|item| item.id == block.id) {
                    scope.planned[index] = block;
                } else {
                    scope.planned.push(block);
                }
                scope.planned = sorted_planned_blocks(scope.planned.clone());
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.put_planned_scoped(normalize_scope_key(scope_key), &block)
            }
        }
    }

    pub fn delete_planned_scoped(
        &self,
        scope_key: Option<&str>,
        block_id: &str,
    ) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                if let Some(scope) = state
                    .write()
                    .unwrap()
                    .get_mut(normalize_scope_key(scope_key))
                {
                    scope.planned.retain(|block| block.id != block_id);
                }
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.delete_planned_scoped(normalize_scope_key(scope_key), block_id)
            }
        }
    }

    pub fn list_windows(&self) -> Result<Vec<SchedulingWindowData>, TimeBlockStoreError> {
        self.list_windows_scoped(None)
    }

    pub fn list_windows_scoped(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Vec<SchedulingWindowData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(sorted_windows(
                state
                    .read()
                    .unwrap()
                    .get(normalize_scope_key(scope_key))
                    .map(|scope| scope.windows.clone())
                    .unwrap_or_default(),
            )),
            TimeBlockStoreBackend::Sqlite(store) => {
                store.list_windows_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn list_windows_for_date_scoped(
        &self,
        scope_key: Option<&str>,
        date: &str,
    ) -> Result<Vec<SchedulingWindowData>, TimeBlockStoreError> {
        let normalized_date = date.trim();
        Ok(self
            .list_windows_scoped(scope_key)?
            .into_iter()
            .filter(|window| window.date == normalized_date)
            .collect())
    }

    pub fn get_window_scoped(
        &self,
        scope_key: Option<&str>,
        window_id: &str,
    ) -> Result<Option<SchedulingWindowData>, TimeBlockStoreError> {
        let normalized_window_id = window_id.trim();
        if normalized_window_id.is_empty() {
            return Ok(None);
        }

        Ok(self
            .list_windows_scoped(scope_key)?
            .into_iter()
            .find(|window| window.id == normalized_window_id))
    }

    pub fn replace_windows_scoped(
        &self,
        scope_key: Option<&str>,
        windows: &[SchedulingWindowData],
    ) -> Result<(), TimeBlockStoreError> {
        let sorted = sorted_windows(windows.to_vec());
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .windows = sorted;
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.replace_windows_scoped(normalize_scope_key(scope_key), &sorted)
            }
        }
    }

    pub fn put_window_scoped(
        &self,
        scope_key: Option<&str>,
        window: SchedulingWindowData,
    ) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                let mut guard = state.write().unwrap();
                let scope = guard
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default();
                if let Some(index) = scope.windows.iter().position(|item| item.id == window.id) {
                    scope.windows[index] = normalize_window(window);
                } else {
                    scope.windows.push(normalize_window(window));
                }
                scope.windows = sorted_windows(scope.windows.clone());
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.put_window_scoped(normalize_scope_key(scope_key), &normalize_window(window))
            }
        }
    }

    pub fn delete_window_scoped(
        &self,
        scope_key: Option<&str>,
        window_id: &str,
    ) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                if let Some(scope) = state
                    .write()
                    .unwrap()
                    .get_mut(normalize_scope_key(scope_key))
                {
                    scope.windows.retain(|window| window.id != window_id);
                }
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.delete_window_scoped(normalize_scope_key(scope_key), window_id)
            }
        }
    }

    pub fn get_segment_scoped(
        &self,
        scope_key: Option<&str>,
        segment_id: &str,
    ) -> Result<Option<PlannedSegmentData>, TimeBlockStoreError> {
        let normalized_segment_id = segment_id.trim();
        if normalized_segment_id.is_empty() {
            return Ok(None);
        }

        Ok(self
            .list_windows_scoped(scope_key)?
            .into_iter()
            .flat_map(|window| window.segments.into_iter())
            .find(|segment| segment.id == normalized_segment_id))
    }

    pub fn get_window_by_segment_scoped(
        &self,
        scope_key: Option<&str>,
        segment_id: &str,
    ) -> Result<Option<SchedulingWindowData>, TimeBlockStoreError> {
        let normalized_segment_id = segment_id.trim();
        if normalized_segment_id.is_empty() {
            return Ok(None);
        }

        Ok(self
            .list_windows_scoped(scope_key)?
            .into_iter()
            .find(|window| window.segments.iter().any(|segment| segment.id == normalized_segment_id)))
    }

    pub fn list_completed_scoped(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .map(|scope| scope.completed.clone())
                .unwrap_or_default()),
            TimeBlockStoreBackend::Sqlite(store) => {
                store.list_completed_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn list_completed_in_scope(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        self.list_completed_scoped(scope_key)
    }

    pub fn replace_completed(&self, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        self.replace_completed_scoped(None, blocks)
    }

    pub fn replace_completed_scoped(
        &self,
        scope_key: Option<&str>,
        blocks: &[TimeBlockData],
    ) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .completed = blocks.to_vec();
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.replace_completed_scoped(normalize_scope_key(scope_key), blocks)
            }
        }
    }

    pub fn replace_completed_in_scope(
        &self,
        scope_key: Option<&str>,
        blocks: &[TimeBlockData],
    ) -> Result<(), TimeBlockStoreError> {
        self.replace_completed_scoped(scope_key, blocks)
    }

    pub fn get_active(&self) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        self.get_active_scoped(None)
    }

    pub fn get_active_scoped(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .and_then(|scope| {
                    scope
                        .active
                        .clone()
                        .map(ActiveBlockData::normalize_task_ids)
                })),
            TimeBlockStoreBackend::Sqlite(store) => {
                store.get_active_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn get_active_in_scope(
        &self,
        scope_key: Option<&str>,
    ) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        self.get_active_scoped(scope_key)
    }

    pub fn put_active(&self, block: ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        self.put_active_scoped(None, block)
    }

    pub fn put_active_scoped(
        &self,
        scope_key: Option<&str>,
        block: ActiveBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        let normalized_block = block.normalize_task_ids();
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .active = Some(normalized_block.clone());
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.put_active_scoped(normalize_scope_key(scope_key), &normalized_block)
            }
        }
    }

    pub fn put_active_in_scope(
        &self,
        scope_key: Option<&str>,
        block: ActiveBlockData,
    ) -> Result<(), TimeBlockStoreError> {
        self.put_active_scoped(scope_key, block)
    }

    pub fn delete_active(&self) -> Result<(), TimeBlockStoreError> {
        self.delete_active_scoped(None)
    }

    pub fn delete_active_scoped(&self, scope_key: Option<&str>) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                if let Some(scope) = state
                    .write()
                    .unwrap()
                    .get_mut(normalize_scope_key(scope_key))
                {
                    scope.active = None;
                }
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => {
                store.delete_active_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn delete_active_in_scope(
        &self,
        scope_key: Option<&str>,
    ) -> Result<(), TimeBlockStoreError> {
        self.delete_active_scoped(scope_key)
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(None)
    }

    pub fn len_completed_scoped(
        &self,
        scope_key: Option<&str>,
    ) -> Result<usize, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .map(|scope| scope.completed.len())
                .unwrap_or(0)),
            TimeBlockStoreBackend::Sqlite(store) => {
                store.len_completed_scoped(normalize_scope_key(scope_key))
            }
        }
    }

    pub fn len_completed_in_scope(
        &self,
        scope_key: Option<&str>,
    ) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(scope_key)
    }

    pub fn sqlite_snapshot_bytes(&self) -> Result<Option<Vec<u8>>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(_) => Ok(None),
            TimeBlockStoreBackend::Sqlite(store) => store.snapshot_bytes().map(Some),
        }
    }

    pub fn backend_kind(&self) -> TimeBlockStoreBackendKind {
        match &self.backend {
            TimeBlockStoreBackend::Memory(_) => TimeBlockStoreBackendKind::Memory,
            TimeBlockStoreBackend::Sqlite(_) => TimeBlockStoreBackendKind::Sqlite,
        }
    }
}

fn sorted_planned_blocks(mut blocks: Vec<PlannedTimeBlockData>) -> Vec<PlannedTimeBlockData> {
    blocks.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.order.cmp(&right.order))
            .then_with(|| left.planned_start_at.cmp(&right.planned_start_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    blocks
}

fn normalize_segment(mut segment: PlannedSegmentData) -> PlannedSegmentData {
    segment.linked_task_ids.retain(|task_id| !task_id.trim().is_empty());
    segment
}

fn sorted_segments(mut segments: Vec<PlannedSegmentData>) -> Vec<PlannedSegmentData> {
    segments = segments.into_iter().map(normalize_segment).collect();
    segments.sort_by(|left, right| {
        left.order
            .cmp(&right.order)
            .then_with(|| left.planned_start_at.cmp(&right.planned_start_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    segments
}

fn normalize_window(mut window: SchedulingWindowData) -> SchedulingWindowData {
    window.segments = sorted_segments(window.segments);
    window
}

fn sorted_windows(mut windows: Vec<SchedulingWindowData>) -> Vec<SchedulingWindowData> {
    windows = windows.into_iter().map(normalize_window).collect();
    windows.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.planned_start_at.cmp(&right.planned_start_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    windows
}

impl Default for TimeBlockStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn sample_planned_block(
        id: &str,
        date: &str,
        block_type: PlannedTimeBlockType,
        order: i64,
    ) -> PlannedTimeBlockData {
        PlannedTimeBlockData {
            id: id.to_string(),
            date: date.to_string(),
            block_type,
            title: format!("planned-{id}"),
            planned_start_at: 1_700_000_000_000 + (order as u64 * 60_000),
            planned_duration_minutes: 25,
            note: Some("sample note".to_string()),
            linked_task_ids: vec![format!("task-{id}")],
            order,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }
    }

    fn sample_window(
        id: &str,
        date: &str,
        start_at: u64,
        end_at: u64,
    ) -> SchedulingWindowData {
        SchedulingWindowData {
            id: id.to_string(),
            date: date.to_string(),
            title: Some(format!("window-{id}")),
            planned_start_at: start_at,
            planned_end_at: end_at,
            rhythm_preset: RhythmPresetData {
                key: "pomodoro_25_5".to_string(),
                label: "25 / 5".to_string(),
                work_minutes: 25,
                short_break_minutes: 5,
                long_break_minutes: 20,
                long_break_after_work_segments: 4,
            },
            segments: vec![
                PlannedSegmentData {
                    id: format!("{id}-work-1"),
                    window_id: id.to_string(),
                    kind: PlannedSegmentKind::Work,
                    break_kind: None,
                    title: "Work 1".to_string(),
                    planned_start_at: start_at,
                    planned_end_at: start_at + 25 * 60_000,
                    linked_task_ids: vec!["task-a".to_string()],
                    order: 0,
                    created_at: start_at,
                    updated_at: start_at,
                },
                PlannedSegmentData {
                    id: format!("{id}-break-1"),
                    window_id: id.to_string(),
                    kind: PlannedSegmentKind::Break,
                    break_kind: Some(BreakWindowKind::Short),
                    title: "Short Break".to_string(),
                    planned_start_at: start_at + 25 * 60_000,
                    planned_end_at: start_at + 30 * 60_000,
                    linked_task_ids: vec![],
                    order: 1,
                    created_at: start_at,
                    updated_at: start_at,
                },
            ],
            created_at: start_at,
            updated_at: start_at,
        }
    }

    #[test]
    fn sqlite_store_isolates_timeblocks_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks.sqlite");
        let store = TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap();

        store
            .replace_completed_scoped(
                Some("profile-a"),
                &[TimeBlockData {
                    id: "tb-a".to_string(),
                    name: "A".to_string(),
                    start_id: "start-a".to_string(),
                    end_id: "end-a".to_string(),
                    note: None,
                    tags: vec!["block_feedback".to_string()],
                    start_time: 1,
                    end_time: 2,
                    task_ids: vec!["task-a".to_string()],
                    task_status_outcomes: Some(HashMap::from([(
                        "task-a".to_string(),
                        "continue".to_string(),
                    )])),
                    task_association_log: vec![BlockTaskAssociationEvent {
                        block_id: "tb-a".to_string(),
                        task_id: "task-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 1,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                }],
            )
            .unwrap();
        store
            .replace_completed_scoped(
                Some("profile-b"),
                &[TimeBlockData {
                    id: "tb-b".to_string(),
                    name: "B".to_string(),
                    start_id: "start-b".to_string(),
                    end_id: "end-b".to_string(),
                    note: None,
                    tags: vec!["block_feedback".to_string()],
                    start_time: 3,
                    end_time: 4,
                    task_ids: vec![],
                    task_status_outcomes: None,
                    task_association_log: vec![],
                    source_planned_block_id: None,
                }],
            )
            .unwrap();

        store
            .put_active_scoped(
                Some("profile-a"),
                ActiveBlockData {
                    start_id: "active-a".to_string(),
                    name: "Active A".to_string(),
                    mode: "countup".to_string(),
                    target_minutes: None,
                    elapsed: 100,
                    updated_at: None,
                    phase: Some("running".to_string()),
                    version: Some(1),
                    actor_id: None,
                    last_transition_at: None,
                    last_resumed_at: None,
                    accumulated_run_ms: None,
                    start_time: 10,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: None,
                    paused: false,
                    paused_at: None,
                    task_ids: vec!["task-a".to_string()],
                    task_association_log: vec![BlockTaskAssociationEvent {
                        block_id: "active-a".to_string(),
                        task_id: "task-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 10,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                    task_id: None,
                },
            )
            .unwrap();

        let completed_a = store.list_completed_scoped(Some("profile-a")).unwrap();
        let completed_b = store.list_completed_scoped(Some("profile-b")).unwrap();
        let active_a = store.get_active_scoped(Some("profile-a")).unwrap();
        let active_b = store.get_active_scoped(Some("profile-b")).unwrap();

        assert_eq!(completed_a.len(), 1);
        assert_eq!(completed_a[0].id, "tb-a");
        assert_eq!(completed_a[0].task_ids, vec!["task-a".to_string()]);
        assert_eq!(completed_b.len(), 1);
        assert_eq!(completed_b[0].id, "tb-b");
        assert_eq!(
            active_a.as_ref().map(|block| block.start_id.as_str()),
            Some("active-a")
        );
        assert_eq!(
            active_a.as_ref().map(|block| block.task_ids.clone()),
            Some(vec!["task-a".to_string()])
        );
        assert!(active_b.is_none());
    }

    #[test]
    fn active_block_promotes_legacy_task_id_to_task_ids() {
        let block: ActiveBlockData = serde_json::from_value(json!({
            "startId": "legacy-active",
            "name": "Legacy active",
            "mode": "countup",
            "elapsed": 10,
            "paused": false,
            "startTime": 123,
            "taskId": "legacy-task",
        }))
        .unwrap();

        let normalized = block.normalize_task_ids();
        let serialized = serde_json::to_value(&normalized).unwrap();

        assert_eq!(normalized.task_ids, vec!["legacy-task".to_string()]);
        assert_eq!(serialized["taskIds"], json!(["legacy-task"]));
        assert!(serialized.get("taskId").is_none());
    }

    #[test]
    fn active_block_recovers_task_ids_from_association_log() {
        let block: ActiveBlockData = serde_json::from_value(json!({
            "startId": "log-active",
            "name": "Log active",
            "mode": "countup",
            "elapsed": 10,
            "paused": false,
            "startTime": 123,
            "taskAssociationLog": [
                {
                    "blockId": "log-active",
                    "taskId": "task-1",
                    "action": "associated",
                    "timestamp": 1,
                    "source": "block_start"
                },
                {
                    "blockId": "log-active",
                    "taskId": "task-2",
                    "action": "associated",
                    "timestamp": 2,
                    "source": "manual"
                },
                {
                    "blockId": "log-active",
                    "taskId": "task-1",
                    "action": "disassociated",
                    "timestamp": 3,
                    "source": "manual"
                }
            ]
        }))
        .unwrap();

        let normalized = block.normalize_task_ids();
        let serialized = serde_json::to_value(&normalized).unwrap();

        assert_eq!(normalized.task_ids, vec!["task-2".to_string()]);
        assert_eq!(serialized["taskIds"], json!(["task-2"]));
        assert!(serialized.get("taskId").is_none());
    }

    #[test]
    fn sqlite_store_isolates_planned_timeblocks_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("planned-timeblocks.sqlite");
        let store = TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap();

        store
            .replace_planned_scoped(
                Some("profile-a"),
                &[
                    sample_planned_block("plan-a-1", "2026-03-26", PlannedTimeBlockType::Work, 1),
                    sample_planned_block("plan-a-2", "2026-03-27", PlannedTimeBlockType::Rest, 2),
                ],
            )
            .unwrap();
        store
            .replace_planned_scoped(
                Some("profile-b"),
                &[sample_planned_block(
                    "plan-b-1",
                    "2026-03-26",
                    PlannedTimeBlockType::Rest,
                    1,
                )],
            )
            .unwrap();

        let scoped_a_today = store
            .list_planned_for_date_scoped(Some("profile-a"), "2026-03-26")
            .unwrap();
        let scoped_a_other_day = store
            .list_planned_for_date_scoped(Some("profile-a"), "2026-03-27")
            .unwrap();
        let scoped_b_today = store
            .list_planned_for_date_scoped(Some("profile-b"), "2026-03-26")
            .unwrap();
        let anonymous_today = store
            .list_planned_for_date_scoped(None, "2026-03-26")
            .unwrap();

        assert_eq!(scoped_a_today.len(), 1);
        assert_eq!(scoped_a_today[0].id, "plan-a-1");
        assert_eq!(scoped_a_today[0].block_type, PlannedTimeBlockType::Work);
        assert_eq!(scoped_a_other_day.len(), 1);
        assert_eq!(scoped_a_other_day[0].id, "plan-a-2");
        assert_eq!(scoped_b_today.len(), 1);
        assert_eq!(scoped_b_today[0].id, "plan-b-1");
        assert!(anonymous_today.is_empty());
    }

    #[test]
    fn planned_block_provenance_round_trips_through_json() {
        let active_block: ActiveBlockData = serde_json::from_value(json!({
            "startId": "active-1",
            "name": "Deep Work",
            "mode": "countdown",
            "targetMinutes": 50,
            "elapsed": 120000,
            "paused": false,
            "startTime": 1_700_000_000_000u64,
            "taskIds": ["task-a"],
            "taskAssociationLog": [],
            "sourcePlannedBlockId": "plan-1"
        }))
        .unwrap();
        let completed_block: TimeBlockData = serde_json::from_value(json!({
            "id": "tb-1",
            "name": "Deep Work",
            "startId": "active-1",
            "endId": "end-1",
            "tags": ["block_feedback"],
            "startTime": 1_700_000_000_000u64,
            "endTime": 1_700_000_300_000u64,
            "taskIds": ["task-a"],
            "taskAssociationLog": [],
            "sourcePlannedBlockId": "plan-1"
        }))
        .unwrap();

        let active_json = serde_json::to_value(active_block).unwrap();
        let completed_json = serde_json::to_value(completed_block).unwrap();

        assert_eq!(active_json["sourcePlannedBlockId"], json!("plan-1"));
        assert_eq!(completed_json["sourcePlannedBlockId"], json!("plan-1"));
    }

    #[test]
    fn sqlite_store_isolates_planner_windows_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("planner-windows.sqlite");
        let store = TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap();

        store
            .replace_windows_scoped(
                Some("profile-a"),
                &[sample_window(
                    "window-a",
                    "2026-03-27",
                    1_774_570_800_000,
                    1_774_579_800_000,
                )],
            )
            .unwrap();
        store
            .replace_windows_scoped(
                Some("profile-b"),
                &[sample_window(
                    "window-b",
                    "2026-03-27",
                    1_774_581_600_000,
                    1_774_586_100_000,
                )],
            )
            .unwrap();

        let scoped_a = store
            .list_windows_for_date_scoped(Some("profile-a"), "2026-03-27")
            .unwrap();
        let scoped_b = store
            .list_windows_for_date_scoped(Some("profile-b"), "2026-03-27")
            .unwrap();
        let anonymous = store
            .list_windows_for_date_scoped(None, "2026-03-27")
            .unwrap();

        assert_eq!(scoped_a.len(), 1);
        assert_eq!(scoped_a[0].id, "window-a");
        assert_eq!(scoped_a[0].segments.len(), 2);
        assert_eq!(scoped_a[0].segments[0].kind, PlannedSegmentKind::Work);
        assert_eq!(
            scoped_a[0].segments[1].break_kind,
            Some(BreakWindowKind::Short)
        );
        assert_eq!(scoped_b.len(), 1);
        assert_eq!(scoped_b[0].id, "window-b");
        assert!(anonymous.is_empty());
    }
}
