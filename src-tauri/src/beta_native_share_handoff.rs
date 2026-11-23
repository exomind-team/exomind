//! Private Android system-share staging exposed through bounded Native commands.

use super::{attachments, trusted_window, Failure, NativeState};
use base64::Engine;
use exomind_android_share_handoff::AndroidShareHandoffExt;
use exomind_beta_host::{
    LocalSourceBegin, LocalSourceInfo, LocalSourceState, MAX_LOCAL_SOURCE_CHUNK_BYTES,
};
use exomind_core::{ProfileId, MAX_CAPTURE_ORIGINALS};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    str::FromStr,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use uuid::Uuid;

pub(super) const DIRECTORY_NAME: &str = "beta-share-handoffs";
const MAX_RECORD_BYTES: u64 = 1024 * 1024;
const MAX_ITEMS: usize = MAX_CAPTURE_ORIGINALS;
const MAX_ITEM_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 65_536;
const MAX_READ_CHUNK_BYTES: usize = MAX_LOCAL_SOURCE_CHUNK_BYTES;
const MAX_ACTIVE_HANDOFF_WATCHERS: usize = 8;
const MAX_ACKED_TOMBSTONES: usize = 128;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HandoffState {
    Receiving,
    Ready,
    Interrupted,
    Cancelled,
    Acknowledged,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemState {
    Receiving,
    Ready,
    Interrupted,
    Cancelled,
    Acknowledged,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextState {
    None,
    Receiving,
    Ready,
    Interrupted,
    Cancelled,
    Acknowledged,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HandoffErrorCode {
    Interrupted,
    ContentUnavailable,
    PermissionUnavailable,
    StorageUnavailable,
    SizeMismatch,
    QuotaExceeded,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredItem {
    item_id: String,
    name: String,
    media_type: String,
    byte_length: u64,
    sha256: Option<String>,
    state: ItemState,
    error_code: Option<HandoffErrorCode>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    handoff_id: String,
    received_at_ms: u64,
    state: HandoffState,
    identity: String,
    #[serde(default)]
    bound_profile_id: Option<ProfileId>,
    error_code: Option<HandoffErrorCode>,
    text: Option<String>,
    text_state: TextState,
    items: Vec<StoredItem>,
    #[serde(default)]
    cleanup_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HandoffListItem {
    pub item_id: String,
    pub name: String,
    pub media_type: String,
    pub byte_length: u64,
    pub state: ItemState,
    pub error_code: Option<HandoffErrorCode>,
    pub recovery_instruction: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HandoffListEntry {
    pub handoff_id: String,
    pub received_at_ms: u64,
    pub state: HandoffState,
    pub bound_profile_id: Option<ProfileId>,
    pub profile_match: bool,
    pub error_code: Option<HandoffErrorCode>,
    pub recovery_instruction: Option<&'static str>,
    pub text_state: TextState,
    pub text_preview: Option<String>,
    pub items: Vec<HandoffListItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HandoffItem {
    pub item_id: String,
    pub name: String,
    pub media_type: String,
    pub byte_length: u64,
    pub sha256: Option<String>,
    pub state: ItemState,
    pub error_code: Option<HandoffErrorCode>,
    pub recovery_instruction: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HandoffDetails {
    pub handoff_id: String,
    pub received_at_ms: u64,
    pub state: HandoffState,
    pub bound_profile_id: Option<ProfileId>,
    pub error_code: Option<HandoffErrorCode>,
    pub recovery_instruction: Option<&'static str>,
    pub text: Option<String>,
    pub text_state: TextState,
    pub items: Vec<HandoffItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadChunk {
    pub offset: u64,
    pub bytes_base64: String,
    pub eof: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AckResult {
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProfileBindResult {
    pub bound_profile_id: ProfileId,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscardResult {
    pub discarded: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CancelResult {
    pub cancel_requested: bool,
    pub status: HandoffState,
}

#[derive(Debug, Clone, Serialize)]
pub struct Available {
    pub handoff_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress<'a> {
    pub request_id: &'a str,
    pub handoff_id: &'a str,
    pub item_id: &'a str,
    pub phase: &'a str,
    pub completed: Option<u64>,
    pub total: u64,
}

#[derive(Clone)]
pub struct Store {
    root: PathBuf,
    active_watchers: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    mutation_lock: std::sync::Arc<std::sync::Mutex<()>>,
    #[cfg(test)]
    fail_next_record_write: std::sync::Arc<std::sync::atomic::AtomicBool>,
    #[cfg(test)]
    skip_next_ack_cleanup: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            active_watchers: Default::default(),
            mutation_lock: Default::default(),
            #[cfg(test)]
            fail_next_record_write: Default::default(),
            #[cfg(test)]
            skip_next_ack_cleanup: Default::default(),
        }
    }

    #[cfg(test)]
    fn open(root: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&root)?;
        #[cfg(unix)]
        fs::set_permissions(&root, std::os::unix::fs::PermissionsExt::from_mode(0o700))?;
        Ok(Self::new(root))
    }

    fn record_path(&self, id: &str) -> Result<PathBuf, Failure> {
        Ok(self.root.join(format!("{}.json", canonical_uuid(id)?)))
    }

    fn read_record(&self, id: &str) -> Result<Option<Record>, Failure> {
        let path = self.record_path(id)?;
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(unavailable()),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_RECORD_BYTES
        {
            return Err(invalid());
        }
        let record: Record = serde_json::from_slice(&fs::read(path).map_err(|_| unavailable())?)
            .map_err(|_| invalid())?;
        validate_record(&record)?;
        Ok(Some(record))
    }

    fn write_record(&self, record: &Record) -> Result<(), Failure> {
        #[cfg(test)]
        if self
            .fail_next_record_write
            .swap(false, std::sync::atomic::Ordering::AcqRel)
        {
            return Err(unavailable());
        }
        validate_record(record)?;
        fs::create_dir_all(&self.root).map_err(|_| unavailable())?;
        #[cfg(unix)]
        fs::set_permissions(
            &self.root,
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )
        .map_err(|_| unavailable())?;
        let bytes = serde_json::to_vec(record).map_err(|_| unavailable())?;
        let temp = self
            .root
            .join(format!("{}.{}.tmp", record.handoff_id, Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| unavailable())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| unavailable())?;
        fs::rename(temp, self.record_path(&record.handoff_id)?).map_err(|_| unavailable())?;
        Ok(())
    }

    pub fn recover(&self, mut is_active: impl FnMut(&str) -> bool) -> Result<(), Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        fs::create_dir_all(&self.root).map_err(|_| unavailable())?;
        for entry in fs::read_dir(&self.root).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let kind = entry.file_type().map_err(|_| unavailable())?;
            if kind.is_symlink()
                || !kind.is_file()
                || entry.path().extension().and_then(|s| s.to_str()) != Some("json")
            {
                continue;
            }
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if canonical_uuid(id).is_err() {
                continue;
            }
            let Some(mut record) = self.read_record(id)? else {
                continue;
            };
            let receiving_is_active =
                record.state == HandoffState::Receiving && is_active(&record.handoff_id);
            if receiving_is_active {
                continue;
            }
            let mut changed = false;
            if record.state == HandoffState::Receiving {
                record.state = HandoffState::Interrupted;
                record.error_code = Some(HandoffErrorCode::Interrupted);
                if record.text_state == TextState::Receiving {
                    record.text_state = TextState::Interrupted;
                }
                changed = true;
            }
            for item in &mut record.items {
                if matches!(
                    item.state,
                    ItemState::Receiving | ItemState::Interrupted | ItemState::Cancelled
                ) {
                    remove_unverified_file(&self.root.join(format!("{}.part", item.item_id)))?;
                    remove_unverified_file(&self.root.join(format!("{}.bin", item.item_id)))?;
                } else if item.state == ItemState::Acknowledged {
                    let _ = remove_owned_file(&self.root.join(format!("{}.bin", item.item_id)));
                    let _ =
                        remove_unverified_file(&self.root.join(format!("{}.part", item.item_id)));
                }
                if item.state == ItemState::Receiving {
                    item.state = ItemState::Interrupted;
                    item.error_code = Some(HandoffErrorCode::Interrupted);
                    changed = true;
                }
            }
            let mut remaining_cleanup = Vec::new();
            for item_id in &record.cleanup_item_ids {
                if canonical_uuid(item_id).is_err()
                    || remove_owned_file(&self.root.join(format!("{item_id}.bin"))).is_err()
                {
                    remaining_cleanup.push(item_id.clone());
                }
            }
            if remaining_cleanup != record.cleanup_item_ids {
                record.cleanup_item_ids = remaining_cleanup;
                changed = true;
            }
            if changed {
                self.write_record(&record)?;
            }
        }
        self.compact_acknowledged()?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<HandoffListEntry>, Failure> {
        self.list_for_profile(None)
    }

    pub fn list_for_profile(
        &self,
        profile_id: Option<ProfileId>,
    ) -> Result<Vec<HandoffListEntry>, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        fs::create_dir_all(&self.root).map_err(|_| unavailable())?;
        let mut result = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let kind = entry.file_type().map_err(|_| unavailable())?;
            if kind.is_symlink()
                || !kind.is_file()
                || entry.path().extension().and_then(|s| s.to_str()) != Some("json")
            {
                continue;
            }
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if canonical_uuid(id).is_err() {
                continue;
            }
            let Some(record) = self.read_record(id)? else {
                continue;
            };
            result.push(list_entry(record, profile_id));
        }
        result.sort_by_key(|entry| entry.received_at_ms);
        Ok(result)
    }

    pub fn get(&self, id: &str) -> Result<Option<HandoffDetails>, Failure> {
        self.read_record(id).map(|record| record.map(details))
    }

    pub fn get_for_profile(
        &self,
        id: &str,
        profile_id: Option<ProfileId>,
    ) -> Result<Option<HandoffDetails>, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        let Some(record) = self.read_record(id)? else {
            return Ok(None);
        };
        ensure_profile_match(record.bound_profile_id, profile_id)?;
        Ok(Some(details(record)))
    }

    pub fn bind_profile(
        &self,
        handoff_id: &str,
        profile_id: ProfileId,
    ) -> Result<ProfileBindResult, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        let mut record = self.read_record(handoff_id)?.ok_or_else(not_found)?;
        if record.state == HandoffState::Receiving {
            return Err(Failure {
                code: "share_handoff_receiving",
                message: "分享仍在接收，完成接收后再添加到档案",
            });
        }
        if !has_payload(&record) {
            return Err(invalid());
        }
        if let Some(bound) = record.bound_profile_id {
            if bound != profile_id {
                return Err(profile_conflict());
            }
        } else {
            record.bound_profile_id = Some(profile_id);
            self.write_record(&record)?;
        }
        Ok(ProfileBindResult {
            bound_profile_id: profile_id,
        })
    }

    #[cfg(test)]
    fn fail_next_record_commit(&self) {
        self.fail_next_record_write
            .store(true, std::sync::atomic::Ordering::Release);
    }

    #[cfg(test)]
    fn skip_next_ack_file_cleanup(&self) {
        self.skip_next_ack_cleanup
            .store(true, std::sync::atomic::Ordering::Release);
    }

    fn claim_watcher(&self, id: &str) -> bool {
        let Ok(mut active) = self.active_watchers.lock() else {
            return false;
        };
        if active.len() >= MAX_ACTIVE_HANDOFF_WATCHERS {
            return false;
        }
        active.insert(id.to_owned())
    }

    fn watch_receiving(&self, app: AppHandle, handoff_id: String) {
        if !self.claim_watcher(&handoff_id) {
            return;
        }
        let store = self.clone();
        let watched_id = handoff_id.clone();
        let guard = WatchGuard {
            active: self.active_watchers.clone(),
            handoff_id,
        };
        tauri::async_runtime::spawn(async move {
            let _guard = guard;
            let mut read_errors = 0;
            loop {
                tokio::time::sleep(Duration::from_millis(350)).await;
                let activity = app.clone();
                let active_id = watched_id.clone();
                let resolver_active = tauri::async_runtime::spawn_blocking(move || {
                    activity
                        .android_share_handoff()
                        .is_receiving(&active_id)
                        .unwrap_or(true)
                })
                .await
                .unwrap_or(true);
                if !resolver_active {
                    let inactive_id = watched_id.clone();
                    let _ = store.recover(|candidate| candidate != inactive_id.as_str());
                }
                match store.get(&watched_id) {
                    Ok(Some(record)) if record.state == HandoffState::Receiving => {
                        read_errors = 0;
                    }
                    Ok(Some(record)) => {
                        if should_announce(record.state) {
                            let _ = app.emit(
                                "beta-share-handoff-available",
                                Available {
                                    handoff_id: watched_id.clone(),
                                },
                            );
                        }
                        break;
                    }
                    Ok(None) => break,
                    Err(_) => {
                        read_errors += 1;
                        if read_errors >= 8 {
                            break;
                        }
                    }
                }
            }
        });
    }

    pub fn watch_receiving_records(&self, app: &AppHandle, records: &[HandoffListEntry]) {
        for record in records {
            if record.state == HandoffState::Receiving {
                self.watch_receiving(app.clone(), record.handoff_id.clone());
            }
        }
    }

    pub fn announce_pending(&self, app: &AppHandle) -> Result<(), Failure> {
        let records = self.list()?;
        for record in &records {
            if should_announce(record.state) {
                let _ = app.emit(
                    "beta-share-handoff-available",
                    Available {
                        handoff_id: record.handoff_id.clone(),
                    },
                );
            }
        }
        self.watch_receiving_records(app, &records);
        Ok(())
    }

    pub fn ready_ids(&self) -> Result<Vec<String>, Failure> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|item| item.state == HandoffState::Ready)
            .map(|item| item.handoff_id)
            .collect())
    }

    pub fn read_chunk(
        &self,
        handoff_id: &str,
        item_id: &str,
        profile_id: ProfileId,
        offset: u64,
        length: usize,
    ) -> Result<ReadChunk, Failure> {
        if !(1..=MAX_READ_CHUNK_BYTES).contains(&length) {
            return Err(too_large());
        }
        let record = self.read_record(handoff_id)?.ok_or_else(not_found)?;
        ensure_bound_profile(record.bound_profile_id, profile_id)?;
        if !matches!(
            record.state,
            HandoffState::Ready | HandoffState::Interrupted | HandoffState::Cancelled
        ) {
            return Err(interrupted());
        }
        let item_id = canonical_uuid(item_id)?;
        let item = record
            .items
            .iter()
            .find(|item| item.item_id == item_id)
            .ok_or_else(not_found)?;
        if item.state != ItemState::Ready {
            return Err(interrupted());
        }
        if offset > item.byte_length {
            return Err(invalid());
        }
        let path = self.root.join(format!("{item_id}.bin"));
        let metadata = fs::symlink_metadata(&path).map_err(|_| unavailable())?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() != item.byte_length
        {
            return Err(invalid());
        }
        let actual_len = (item.byte_length - offset).min(length as u64) as usize;
        let mut file = File::open(path).map_err(|_| unavailable())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| unavailable())?;
        let mut bytes = vec![0; actual_len];
        file.read_exact(&mut bytes).map_err(|_| unavailable())?;
        Ok(ReadChunk {
            offset,
            bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            eof: offset + actual_len as u64 == item.byte_length,
        })
    }

    pub fn acknowledge_item(
        &self,
        handoff_id: &str,
        item_id: &str,
        profile_id: ProfileId,
    ) -> Result<AckResult, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        let Some(mut record) = self.read_record(handoff_id)? else {
            return Ok(AckResult { acknowledged: true });
        };
        ensure_bound_profile(record.bound_profile_id, profile_id)?;
        if record.state == HandoffState::Receiving {
            return Err(interrupted());
        }
        let item_id = canonical_uuid(item_id)?;
        let Some(item_index) = record.items.iter().position(|item| item.item_id == item_id) else {
            return Ok(AckResult { acknowledged: true });
        };
        if record.items[item_index].state == ItemState::Acknowledged {
            if record.cleanup_item_ids.contains(&item_id) {
                self.finish_ack_cleanup(&mut record);
                self.compact_acknowledged()?;
            }
            return Ok(AckResult { acknowledged: true });
        }
        if record.items[item_index].state != ItemState::Ready {
            return Err(interrupted());
        }
        record.items[item_index].state = ItemState::Acknowledged;
        record.items[item_index].error_code = None;
        if !record.cleanup_item_ids.contains(&item_id) {
            record.cleanup_item_ids.push(item_id.clone());
        }
        let complete = record
            .items
            .iter()
            .all(|item| item.state == ItemState::Acknowledged)
            && matches!(record.text_state, TextState::None | TextState::Acknowledged);
        if complete {
            self.make_acknowledged(&mut record);
        }
        // Commit the receipt before unlinking bytes; recovery owns the cleanup queue.
        self.write_record(&record)?;
        self.finish_ack_cleanup(&mut record);
        if complete {
            self.compact_acknowledged()?;
        }
        Ok(AckResult { acknowledged: true })
    }

    pub fn acknowledge_text(
        &self,
        handoff_id: &str,
        profile_id: ProfileId,
    ) -> Result<AckResult, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        let Some(mut record) = self.read_record(handoff_id)? else {
            return Ok(AckResult { acknowledged: true });
        };
        ensure_bound_profile(record.bound_profile_id, profile_id)?;
        if record.text_state == TextState::Acknowledged {
            return Ok(AckResult { acknowledged: true });
        }
        if record.state == HandoffState::Receiving
            || record.text_state != TextState::Ready
            || record.text.is_none()
        {
            return Err(Failure {
                code: "share_handoff_text_unavailable",
                message: "此分享没有可确认的文本内容，请检查分享状态后重试",
            });
        }
        record.text = None;
        record.text_state = TextState::Acknowledged;
        let complete = record
            .items
            .iter()
            .all(|item| item.state == ItemState::Acknowledged);
        if complete {
            self.make_acknowledged(&mut record);
        }
        self.write_record(&record)?;
        self.finish_ack_cleanup(&mut record);
        if complete {
            self.compact_acknowledged()?;
        }
        Ok(AckResult { acknowledged: true })
    }

    fn make_acknowledged(&self, record: &mut Record) {
        for item in &record.items {
            if !record.cleanup_item_ids.contains(&item.item_id) {
                record.cleanup_item_ids.push(item.item_id.clone());
            }
        }
        record.state = HandoffState::Acknowledged;
        record.error_code = None;
        record.text = None;
        if record.text_state != TextState::None {
            record.text_state = TextState::Acknowledged;
        }
        record.items.clear();
    }

    fn finish_ack_cleanup(&self, record: &mut Record) {
        if record.cleanup_item_ids.is_empty() {
            return;
        }
        #[cfg(test)]
        if self
            .skip_next_ack_cleanup
            .swap(false, std::sync::atomic::Ordering::AcqRel)
        {
            return;
        }
        let mut remaining = Vec::new();
        for item_id in &record.cleanup_item_ids {
            if canonical_uuid(item_id).is_err()
                || remove_owned_file(&self.root.join(format!("{item_id}.bin"))).is_err()
            {
                remaining.push(item_id.clone());
            } else {
                let _ = remove_unverified_file(&self.root.join(format!("{item_id}.part")));
            }
        }
        if remaining != record.cleanup_item_ids {
            record.cleanup_item_ids = remaining;
            let _ = self.write_record(record);
        }
    }

    fn compact_acknowledged(&self) -> Result<(), Failure> {
        let mut completed = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let kind = entry.file_type().map_err(|_| unavailable())?;
            if kind.is_symlink()
                || !kind.is_file()
                || entry.path().extension().and_then(|s| s.to_str()) != Some("json")
            {
                continue;
            }
            let path = entry.path();
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if canonical_uuid(id).is_err() {
                continue;
            }
            let Some(record) = self.read_record(id)? else {
                continue;
            };
            if record.state == HandoffState::Acknowledged && record.cleanup_item_ids.is_empty() {
                completed.push(record);
            }
        }
        completed.sort_by_key(|record| record.received_at_ms);
        let remove_count = completed.len().saturating_sub(MAX_ACKED_TOMBSTONES);
        for record in completed.into_iter().take(remove_count) {
            remove_owned_file(&self.record_path(&record.handoff_id)?)?;
            remove_owned_file(&self.root.join(format!("dedupe-{}.json", record.identity)))?;
        }
        Ok(())
    }

    pub fn discard(
        &self,
        handoff_id: &str,
        profile_id: Option<ProfileId>,
    ) -> Result<DiscardResult, Failure> {
        let _guard = self.mutation_lock.lock().map_err(|_| unavailable())?;
        let Some(record) = self.read_record(handoff_id)? else {
            return Ok(DiscardResult { discarded: true });
        };
        ensure_profile_match(record.bound_profile_id, profile_id)?;
        if record.state == HandoffState::Receiving {
            return Err(Failure {
                code: "share_handoff_receiving",
                message: "分享仍在接收，请先取消接收",
            });
        }
        for item in &record.items {
            remove_owned_file(&self.root.join(format!("{}.bin", item.item_id)))?;
        }
        for item in &record.items {
            remove_owned_file(&self.root.join(format!("{}.part", item.item_id)))?;
        }
        for item_id in &record.cleanup_item_ids {
            remove_owned_file(&self.root.join(format!("{item_id}.bin")))?;
            remove_unverified_file(&self.root.join(format!("{item_id}.part")))?;
        }
        remove_owned_file(&self.record_path(handoff_id)?)?;
        remove_owned_file(&self.root.join(format!("dedupe-{}.json", record.identity)))?;
        Ok(DiscardResult { discarded: true })
    }

    fn item_path(
        &self,
        handoff_id: &str,
        item_id: &str,
        profile_id: ProfileId,
        expected_size: u64,
    ) -> Result<(StoredItem, PathBuf), Failure> {
        let record = self.read_record(handoff_id)?.ok_or_else(not_found)?;
        ensure_bound_profile(record.bound_profile_id, profile_id)?;
        if !matches!(
            record.state,
            HandoffState::Ready | HandoffState::Interrupted | HandoffState::Cancelled
        ) {
            return Err(interrupted());
        }
        let item_id = canonical_uuid(item_id)?;
        let item = record
            .items
            .iter()
            .find(|item| item.item_id == item_id)
            .cloned()
            .ok_or_else(not_found)?;
        if item.state != ItemState::Ready || item.byte_length != expected_size {
            return Err(invalid());
        }
        let path = self.root.join(format!("{item_id}.bin"));
        let metadata = fs::symlink_metadata(&path).map_err(|_| unavailable())?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() != item.byte_length
        {
            return Err(invalid());
        }
        Ok((item, path))
    }
}

fn should_announce(state: HandoffState) -> bool {
    matches!(
        state,
        HandoffState::Ready | HandoffState::Interrupted | HandoffState::Cancelled
    )
}

struct WatchGuard {
    active: std::sync::Arc<std::sync::Mutex<HashSet<String>>>,
    handoff_id: String,
}

impl Drop for WatchGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.handoff_id);
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_list(
    window: WebviewWindow,
    app: AppHandle,
    profile_id: Option<ProfileId>,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<Vec<HandoffListEntry>, Failure> {
    trusted_window(&window, state.inner())?;
    let records = store.list_for_profile(profile_id)?;
    store.watch_receiving_records(&app, &records);
    Ok(records)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_get(
    window: WebviewWindow,
    handoff_id: String,
    profile_id: Option<ProfileId>,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<Option<HandoffDetails>, Failure> {
    trusted_window(&window, state.inner())?;
    store.get_for_profile(&handoff_id, profile_id)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_bind_profile(
    window: WebviewWindow,
    handoff_id: String,
    profile_id: ProfileId,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<ProfileBindResult, Failure> {
    trusted_window(&window, state.inner())?;
    store.bind_profile(&handoff_id, profile_id)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_read_chunk(
    window: WebviewWindow,
    handoff_id: String,
    item_id: String,
    profile_id: ProfileId,
    offset: u64,
    length: usize,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<ReadChunk, Failure> {
    trusted_window(&window, state.inner())?;
    store.read_chunk(&handoff_id, &item_id, profile_id, offset, length)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_ack_text(
    window: WebviewWindow,
    handoff_id: String,
    profile_id: ProfileId,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<AckResult, Failure> {
    trusted_window(&window, state.inner())?;
    store.acknowledge_text(&handoff_id, profile_id)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_ack_item(
    window: WebviewWindow,
    handoff_id: String,
    item_id: String,
    profile_id: ProfileId,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<AckResult, Failure> {
    trusted_window(&window, state.inner())?;
    store.acknowledge_item(&handoff_id, &item_id, profile_id)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) fn beta_share_handoff_discard(
    window: WebviewWindow,
    handoff_id: String,
    profile_id: Option<ProfileId>,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<DiscardResult, Failure> {
    trusted_window(&window, state.inner())?;
    store.discard(&handoff_id, profile_id)
}

#[tauri::command(rename_all = "snake_case")]
pub(super) async fn beta_share_handoff_cancel(
    window: WebviewWindow,
    handoff_id: String,
    app: AppHandle,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<CancelResult, Failure> {
    trusted_window(&window, state.inner())?;
    canonical_uuid(&handoff_id)?;
    let before = store.get(&handoff_id)?.ok_or_else(not_found)?;
    if before.state != HandoffState::Receiving {
        return Ok(CancelResult {
            cancel_requested: false,
            status: before.state,
        });
    }
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        app.android_share_handoff()
            .cancel_receiving(&handoff_id)
            .map_err(|_| unavailable())
    })
    .await
    .map_err(|_| unavailable())??;
    let wait_store = store.inner().clone();
    let id = before.handoff_id;
    let status: HandoffState = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(current) = wait_store.get(&id)? {
                if current.state != HandoffState::Receiving {
                    return Ok::<HandoffState, Failure>(current.state);
                }
            }
            if Instant::now() >= deadline {
                return Ok::<HandoffState, Failure>(HandoffState::Receiving);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    })
    .await
    .map_err(|_| unavailable())??;
    Ok(CancelResult {
        cancel_requested: accepted,
        status,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub(super) async fn beta_import_share_handoff_item(
    window: WebviewWindow,
    handoff_id: String,
    item_id: String,
    profile_id: ProfileId,
    source_key: String,
    expected_size: u64,
    request_id: String,
    app: AppHandle,
    store: State<'_, Store>,
    state: State<'_, std::sync::Arc<NativeState>>,
) -> Result<LocalSourceInfo, Failure> {
    trusted_window(&window, state.inner())?;
    canonical_uuid(&request_id)?;
    let request_uuid = Uuid::parse_str(&request_id).map_err(|_| invalid())?;
    let lease = state.attachment_jobs.begin(request_uuid, &source_key)?;
    let state = state.inner().clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_item(
            &app,
            &state,
            &store,
            handoff_id,
            item_id,
            profile_id,
            source_key,
            expected_size,
            request_id,
            lease,
        )
    })
    .await
    .map_err(|_| unavailable())?
}

fn import_item(
    app: &AppHandle,
    state: &NativeState,
    store: &Store,
    handoff_id: String,
    item_id: String,
    profile_id: ProfileId,
    source_key: String,
    expected_size: u64,
    request_id: String,
    lease: attachments::Lease,
) -> Result<LocalSourceInfo, Failure> {
    let (_, path) = store.item_path(&handoff_id, &item_id, profile_id, expected_size)?;
    let mut source = File::open(&path).map_err(|_| unavailable())?;
    import_item_reader(
        state,
        store,
        &handoff_id,
        &item_id,
        profile_id,
        &source_key,
        expected_size,
        &mut source,
        &lease,
        |phase, completed, total| {
            emit_progress(
                app,
                &request_id,
                &handoff_id,
                &item_id,
                phase,
                completed,
                total,
            )
        },
    )
}

fn import_item_reader<R, P>(
    state: &NativeState,
    store: &Store,
    handoff_id: &str,
    item_id: &str,
    profile_id: ProfileId,
    source_key: &str,
    expected_size: u64,
    source: &mut R,
    lease: &attachments::Lease,
    mut report: P,
) -> Result<LocalSourceInfo, Failure>
where
    R: Read + Seek,
    P: FnMut(&str, Option<u64>, u64),
{
    lease.check(state)?;
    let (item, _) = store.item_path(handoff_id, item_id, profile_id, expected_size)?;
    validate_source_binding(source_key, profile_id)?;
    report("verifying", Some(0), item.byte_length);
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = vec![0; MAX_LOCAL_SOURCE_CHUNK_BYTES];
    loop {
        lease.check(state)?;
        let read = source.read(&mut buffer).map_err(|_| unavailable())?;
        lease.check(state)?;
        if read == 0 {
            break;
        }
        copied = copied.checked_add(read as u64).ok_or_else(too_large)?;
        if copied > MAX_ITEM_BYTES {
            return Err(too_large());
        }
        hasher.update(&buffer[..read]);
        report("verifying", Some(copied), item.byte_length);
    }
    let sha256 = format!("{:x}", hasher.finalize());
    if copied != expected_size || item.sha256.as_deref() != Some(sha256.as_str()) {
        return Err(invalid());
    }
    let begin = LocalSourceBegin {
        key: source_key.to_owned(),
        byte_length: copied,
        sha256: sha256.clone(),
    };
    lease.check(state)?;
    let mut info = state
        .host
        .begin_local_source(&state.owner, &begin)
        .map_err(Failure::from)?;
    if info.state == LocalSourceState::Ready {
        info = state
            .host
            .finish_local_source(&state.owner, source_key)
            .map_err(Failure::from)?;
    } else if info.state == LocalSourceState::Frozen {
        info = state
            .host
            .finish_local_source(&state.owner, source_key)
            .map_err(Failure::from)?;
    } else if info.state == LocalSourceState::Copying {
        lease.check(state)?;
        source
            .seek(SeekFrom::Start(info.next_offset))
            .map_err(|_| unavailable())?;
        report("copying", Some(info.next_offset), copied);
        while info.next_offset < info.byte_length {
            lease.check(state)?;
            let size = (info.byte_length - info.next_offset)
                .min(MAX_LOCAL_SOURCE_CHUNK_BYTES as u64) as usize;
            let mut chunk = vec![0; size];
            source.read_exact(&mut chunk).map_err(|_| unavailable())?;
            lease.check(state)?;
            info = state
                .host
                .write_local_source_chunk(&state.owner, source_key, info.next_offset, &chunk)
                .map_err(Failure::from)?;
            report("copying", Some(info.next_offset), copied);
        }
        lease.check(state)?;
        info = state
            .host
            .finish_local_source(&state.owner, source_key)
            .map_err(Failure::from)?;
    } else {
        return Err(invalid());
    }
    lease.check(state)?;
    if info.state != LocalSourceState::Ready || info.byte_length != copied || info.sha256 != sha256
    {
        return Err(invalid());
    }
    report("ready", Some(info.byte_length), info.byte_length);
    Ok(info)
}

fn emit_progress(
    app: &AppHandle,
    request_id: &str,
    handoff_id: &str,
    item_id: &str,
    phase: &str,
    completed: Option<u64>,
    total: u64,
) {
    let _ = app.emit(
        "beta-share-handoff-import-progress",
        ImportProgress {
            request_id,
            handoff_id,
            item_id,
            phase,
            completed,
            total,
        },
    );
}

fn list_entry(record: Record, profile_id: Option<ProfileId>) -> HandoffListEntry {
    let profile_match = record.bound_profile_id.is_none() || record.bound_profile_id == profile_id;
    let text_state = if profile_match {
        record.text_state
    } else {
        TextState::None
    };
    let text_preview = if profile_match {
        record.text.as_deref().map(text_preview)
    } else {
        None
    };
    HandoffListEntry {
        handoff_id: record.handoff_id,
        received_at_ms: record.received_at_ms,
        state: record.state,
        bound_profile_id: record.bound_profile_id,
        profile_match,
        error_code: record.error_code,
        recovery_instruction: recovery_instruction(record.error_code),
        text_state,
        text_preview,
        items: if profile_match {
            record
                .items
                .into_iter()
                .map(|item| HandoffListItem {
                    item_id: item.item_id,
                    name: item.name,
                    media_type: item.media_type,
                    byte_length: item.byte_length,
                    state: item.state,
                    recovery_instruction: recovery_instruction(item.error_code),
                    error_code: item.error_code,
                })
                .collect()
        } else {
            Vec::new()
        },
    }
}

fn details(record: Record) -> HandoffDetails {
    HandoffDetails {
        handoff_id: record.handoff_id,
        received_at_ms: record.received_at_ms,
        state: record.state,
        bound_profile_id: record.bound_profile_id,
        error_code: record.error_code,
        recovery_instruction: recovery_instruction(record.error_code),
        text: record.text,
        text_state: record.text_state,
        items: record
            .items
            .into_iter()
            .map(|item| HandoffItem {
                item_id: item.item_id,
                name: item.name,
                media_type: item.media_type,
                byte_length: item.byte_length,
                sha256: item.sha256,
                state: item.state,
                recovery_instruction: recovery_instruction(item.error_code),
                error_code: item.error_code,
            })
            .collect(),
    }
}

fn validate_record(record: &Record) -> Result<(), Failure> {
    canonical_uuid(&record.handoff_id)?;
    if record.received_at_ms == 0
        || record.identity.len() != 64
        || !is_sha256(&record.identity)
        || record.items.len() > MAX_ITEMS
        || record
            .text
            .as_ref()
            .is_some_and(|text| !sanitize_text(text))
        || record.error_code.is_some_and(|_| {
            !matches!(
                record.state,
                HandoffState::Interrupted | HandoffState::Cancelled
            )
        })
        || (record.state == HandoffState::Ready && record.text_state == TextState::Receiving)
        || (record.state == HandoffState::Acknowledged
            && (!record.items.is_empty()
                || record.text.is_some()
                || record.error_code.is_some()
                || !matches!(record.text_state, TextState::None | TextState::Acknowledged)))
        || record.cleanup_item_ids.len() > MAX_ITEMS
    {
        return Err(invalid());
    }
    let mut cleanup_ids = std::collections::HashSet::new();
    for item_id in &record.cleanup_item_ids {
        canonical_uuid(item_id)?;
        if !cleanup_ids.insert(item_id) {
            return Err(invalid());
        }
    }
    let mut ids = std::collections::HashSet::new();
    let mut total = record.text.as_ref().map_or(0, |text| text.len() as u64);
    for item in &record.items {
        canonical_uuid(&item.item_id)?;
        if item.byte_length > MAX_ITEM_BYTES {
            return Err(too_large());
        }
        if !ids.insert(&item.item_id)
            || !sanitize_name(&item.name)
            || !sanitize_mime(&item.media_type)
            || item.sha256.as_ref().is_some_and(|sha| !is_sha256(sha))
            || !matches!(
                item.state,
                ItemState::Receiving
                    | ItemState::Ready
                    | ItemState::Interrupted
                    | ItemState::Cancelled
                    | ItemState::Acknowledged
            )
            || (item.state == ItemState::Ready && item.sha256.is_none())
            || (record.state == HandoffState::Ready
                && !matches!(item.state, ItemState::Ready | ItemState::Acknowledged))
        {
            return Err(invalid());
        }
        total = total.checked_add(item.byte_length).ok_or_else(too_large)?;
    }
    if total > MAX_TOTAL_BYTES {
        return Err(too_large());
    }
    if record
        .text
        .as_ref()
        .is_some_and(|text| record.text_state != TextState::Ready || text.len() > MAX_TEXT_BYTES)
    {
        return Err(invalid());
    }
    if record.text_state == TextState::Ready && record.text.is_none() {
        return Err(invalid());
    }
    Ok(())
}

fn canonical_uuid(value: &str) -> Result<String, Failure> {
    let id = Uuid::parse_str(value).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != value {
        return Err(invalid());
    }
    Ok(value.to_owned())
}

fn profile_conflict() -> Failure {
    Failure {
        code: "profile_conflict",
        message:
            "此分享已绑定到另一个档案，请切换到原档案；如需用于其他档案，请放弃此分享后重新分享",
    }
}

fn ensure_profile_match(
    bound_profile_id: Option<ProfileId>,
    requested_profile_id: Option<ProfileId>,
) -> Result<(), Failure> {
    if bound_profile_id.is_some() && bound_profile_id != requested_profile_id {
        return Err(profile_conflict());
    }
    Ok(())
}

fn ensure_bound_profile(
    bound_profile_id: Option<ProfileId>,
    requested_profile_id: ProfileId,
) -> Result<(), Failure> {
    match bound_profile_id {
        None => Err(Failure {
            code: "share_handoff_profile_unbound",
            message: "请先将此分享关联到目标档案，再继续添加内容",
        }),
        Some(bound) if bound != requested_profile_id => Err(profile_conflict()),
        Some(_) => Ok(()),
    }
}

fn has_payload(record: &Record) -> bool {
    (record.text_state == TextState::Ready && record.text.is_some())
        || record
            .items
            .iter()
            .any(|item| item.state == ItemState::Ready)
}

fn validate_source_binding(source_key: &str, profile_id: ProfileId) -> Result<(), Failure> {
    if source_key.len() > 256 {
        return Err(invalid());
    }
    let parts: [String; 3] = serde_json::from_str(source_key).map_err(|_| invalid())?;
    if serde_json::to_string(&parts).map_err(|_| invalid())? != source_key
        || parts[1] != profile_id.to_string()
    {
        return Err(invalid());
    }
    let parsed = ProfileId::from_str(&parts[1]).map_err(|_| invalid())?;
    if parsed.to_string() != parts[1] {
        return Err(invalid());
    }
    Uuid::parse_str(&parts[2]).map_err(|_| invalid())?;
    Ok(())
}
fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn sanitize_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 720
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
}
fn sanitize_mime(value: &str) -> bool {
    value.len() <= 127
        && value.split_once('/').is_some_and(|(a, b)| {
            !a.is_empty()
                && !b.is_empty()
                && value.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || b"!#$&^_.+-/*".contains(&byte)
                })
        })
}
fn sanitize_text(value: &str) -> bool {
    value.len() <= MAX_TEXT_BYTES
        && !value
            .chars()
            .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
}
fn text_preview(value: &str) -> String {
    value.chars().take(240).collect()
}
fn recovery_instruction(code: Option<HandoffErrorCode>) -> Option<&'static str> {
    match code {
        Some(HandoffErrorCode::PermissionUnavailable | HandoffErrorCode::ContentUnavailable) => {
            Some("无法继续读取分享内容，请重新分享原文件")
        }
        Some(HandoffErrorCode::StorageUnavailable) => {
            Some("本机暂存空间不足，请先释放本机存储空间后重新分享")
        }
        Some(HandoffErrorCode::Interrupted) => Some("系统分享接收已中断，请重新分享原内容"),
        Some(HandoffErrorCode::SizeMismatch) => {
            Some("分享内容超出本机暂存上限，请重新分享较小内容")
        }
        Some(HandoffErrorCode::QuotaExceeded) => Some("分享暂存已满，请先处理现有分享后重新分享"),
        _ => None,
    }
}
fn remove_owned_file(path: &PathBuf) -> Result<(), Failure> {
    if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(invalid());
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(unavailable()),
    }
}

fn remove_unverified_file(path: &PathBuf) -> Result<(), Failure> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(unavailable()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|_| unavailable())
}

fn invalid() -> Failure {
    Failure {
        code: "share_handoff_invalid",
        message: "系统分享暂存内容无法识别，未提交记录",
    }
}
fn unavailable() -> Failure {
    Failure {
        code: "share_handoff_unavailable",
        message: "系统分享暂存暂不可用，请保留原内容后重试",
    }
}
fn too_large() -> Failure {
    Failure {
        code: "share_handoff_too_large",
        message: "系统分享内容超出本机暂存上限",
    }
}
fn not_found() -> Failure {
    Failure {
        code: "not_found",
        message: "系统分享暂存已不存在",
    }
}
fn interrupted() -> Failure {
    Failure {
        code: "share_handoff_interrupted",
        message: "系统分享暂存尚未完成，请重新分享原内容",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn record(state: HandoffState, item_state: ItemState) -> Record {
        Record {
            handoff_id: Uuid::new_v4().to_string(),
            received_at_ms: 1,
            state,
            identity: "a".repeat(64),
            bound_profile_id: None,
            error_code: None,
            text: None,
            text_state: TextState::None,
            cleanup_item_ids: vec![],
            items: vec![StoredItem {
                item_id: Uuid::new_v4().to_string(),
                name: "photo.png".into(),
                media_type: "image/png".into(),
                byte_length: 3,
                sha256: Some(format!("{:x}", Sha256::digest(b"abc"))),
                state: item_state,
                error_code: None,
            }],
        }
    }

    #[test]
    fn storage_unavailable_has_a_distinct_persisted_code_and_recovery_instruction() {
        let code = HandoffErrorCode::StorageUnavailable;
        assert_eq!(serde_json::to_string(&code).unwrap(), "\"storage_unavailable\"");
        assert_eq!(
            serde_json::from_str::<HandoffErrorCode>("\"storage_unavailable\"").unwrap(),
            code
        );
        assert_eq!(
            recovery_instruction(Some(code)),
            Some("本机暂存空间不足，请先释放本机存储空间后重新分享")
        );
        assert_ne!(
            recovery_instruction(Some(code)),
            recovery_instruction(Some(HandoffErrorCode::PermissionUnavailable))
        );
    }

    #[test]
    fn routing_and_dedupe_digest_support_send_actions_without_retaining_uri_tokens() {
        fn accepts(action: &str) -> bool {
            matches!(
                action,
                "android.intent.action.SEND" | "android.intent.action.SEND_MULTIPLE"
            )
        }
        assert!(accepts("android.intent.action.SEND"));
        assert!(accepts("android.intent.action.SEND_MULTIPLE"));
        assert!(!accepts("android.intent.action.VIEW"));
        let uri = "content://provider/private-grant-token";
        let identity = format!("{:x}", Sha256::digest(uri.as_bytes()));
        assert_eq!(identity.len(), 64);
        assert!(!identity.contains("private"));
    }

    #[test]
    fn metadata_path_and_size_bounds_reject_traversal_and_oversized_files() {
        let mut value = record(HandoffState::Ready, ItemState::Ready);
        validate_record(&value).unwrap();
        value.items[0].name = "../secret.txt".into();
        assert_eq!(
            validate_record(&value).unwrap_err().code,
            "share_handoff_invalid"
        );
        value.items[0].name = "safe.txt".into();
        value.items[0].byte_length = MAX_ITEM_BYTES + 1;
        assert_eq!(
            validate_record(&value).unwrap_err().code,
            "share_handoff_too_large"
        );
        assert!(canonical_uuid("../../bad").is_err());
        assert!(!sanitize_mime("text/plain\r\n/private"));

        let mut full_batch = record(HandoffState::Ready, ItemState::Ready);
        full_batch.items = (0..MAX_CAPTURE_ORIGINALS)
            .map(|_| StoredItem {
                item_id: Uuid::new_v4().to_string(),
                name: "photo.jpg".into(),
                media_type: "image/jpeg".into(),
                byte_length: 0,
                sha256: Some("0".repeat(64)),
                state: ItemState::Ready,
                error_code: None,
            })
            .collect();
        validate_record(&full_batch).unwrap();
        let mut extra = full_batch.items[0].clone();
        extra.item_id = Uuid::new_v4().to_string();
        full_batch.items.push(extra);
        assert_eq!(
            validate_record(&full_batch).unwrap_err().code,
            "share_handoff_invalid"
        );
    }

    #[test]
    fn restart_recovers_receiving_as_interrupted_and_keeps_ready_handoffs() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().to_path_buf()).unwrap();
        let receiving = record(HandoffState::Receiving, ItemState::Receiving);
        let receiving_id = receiving.handoff_id.clone();
        store.write_record(&receiving).unwrap();
        let ready = record(HandoffState::Ready, ItemState::Ready);
        let ready_id = ready.handoff_id.clone();
        File::create(store.root.join(format!("{}.bin", ready.items[0].item_id)))
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        store.write_record(&ready).unwrap();
        store.recover(|_| false).unwrap();
        assert_eq!(
            store.get(&receiving_id).unwrap().unwrap().state,
            HandoffState::Interrupted
        );
        assert_eq!(
            store.get(&ready_id).unwrap().unwrap().state,
            HandoffState::Ready
        );
        assert!(store.ready_ids().unwrap().contains(&ready_id));
    }

    #[test]
    fn recovery_removes_only_parts_named_by_incomplete_item_records() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().to_path_buf()).unwrap();
        let incomplete = record(HandoffState::Receiving, ItemState::Receiving);
        let incomplete_id = incomplete.handoff_id.clone();
        let incomplete_part = store
            .root
            .join(format!("{}.part", incomplete.items[0].item_id));
        File::create(&incomplete_part)
            .unwrap()
            .write_all(b"partial")
            .unwrap();
        store.write_record(&incomplete).unwrap();

        let ready = record(HandoffState::Ready, ItemState::Ready);
        let ready_part = store.root.join(format!("{}.part", ready.items[0].item_id));
        File::create(&ready_part)
            .unwrap()
            .write_all(b"not owned as incomplete")
            .unwrap();
        store.write_record(&ready).unwrap();
        let unrelated = store.root.join("unreferenced.part");
        File::create(&unrelated)
            .unwrap()
            .write_all(b"keep")
            .unwrap();

        store.recover(|_| false).unwrap();
        assert!(!incomplete_part.exists());
        assert!(ready_part.exists());
        assert!(unrelated.exists());
        assert_eq!(
            store.get(&incomplete_id).unwrap().unwrap().state,
            HandoffState::Interrupted
        );
    }

    #[test]
    fn text_ack_and_item_ack_are_idempotent_and_discard_is_repeatable() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().to_path_buf()).unwrap();
        let value = record(HandoffState::Ready, ItemState::Ready);
        let handoff_id = value.handoff_id.clone();
        let item_id = value.items[0].item_id.clone();
        let profile_id = ProfileId::new();
        let item_path = store.root.join(format!("{item_id}.bin"));
        File::create(&item_path).unwrap().write_all(b"abc").unwrap();
        store.write_record(&value).unwrap();
        store.bind_profile(&handoff_id, profile_id).unwrap();
        assert!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_id)
                .unwrap()
                .acknowledged
        );
        assert!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_id)
                .unwrap()
                .acknowledged
        );
        let receipt = store.get(&handoff_id).unwrap().unwrap();
        assert_eq!(receipt.state, HandoffState::Acknowledged);
        assert!(receipt.items.is_empty());
        assert!(!item_path.exists());
        assert!(
            store
                .discard(&handoff_id, Some(profile_id))
                .unwrap()
                .discarded
        );
        assert!(
            store
                .discard(&handoff_id, Some(profile_id))
                .unwrap()
                .discarded
        );
    }

    #[test]
    fn source_key_must_bind_the_requested_profile() {
        let profile = ProfileId::new();
        let source_key = serde_json::to_string(&[
            String::from("device"),
            profile.to_string(),
            Uuid::new_v4().to_string(),
        ])
        .unwrap();
        assert!(validate_source_binding(&source_key, profile).is_ok());
        assert!(validate_source_binding(&source_key, ProfileId::new()).is_err());
    }

    #[test]
    fn bound_handoff_rejects_cross_profile_text_ack_and_file_import() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        let mut value = record(HandoffState::Ready, ItemState::Ready);
        value.text = Some("shared caption".into());
        value.text_state = TextState::Ready;
        let handoff_id = value.handoff_id.clone();
        let item_id = value.items[0].item_id.clone();
        let file = store.root.join(format!("{item_id}.bin"));
        File::create(&file).unwrap().write_all(b"abc").unwrap();
        store.write_record(&value).unwrap();

        let profile_a = ProfileId::new();
        let profile_b = ProfileId::new();
        assert_eq!(
            store
                .bind_profile(&handoff_id, profile_a)
                .unwrap()
                .bound_profile_id,
            profile_a
        );
        assert_eq!(
            store
                .bind_profile(&handoff_id, profile_a)
                .unwrap()
                .bound_profile_id,
            profile_a
        );
        assert_eq!(
            store.bind_profile(&handoff_id, profile_b).unwrap_err().code,
            "profile_conflict"
        );

        let owner_profile_list = store.list_for_profile(Some(profile_a)).unwrap();
        let visible = owner_profile_list
            .iter()
            .find(|row| row.handoff_id == handoff_id)
            .unwrap();
        assert!(visible.profile_match);
        assert_eq!(visible.bound_profile_id, Some(profile_a));
        assert_eq!(visible.text_preview.as_deref(), Some("shared caption"));
        assert_eq!(visible.items.len(), 1);

        let other_profile_list = store.list_for_profile(Some(profile_b)).unwrap();
        let hidden = other_profile_list
            .iter()
            .find(|row| row.handoff_id == handoff_id)
            .unwrap();
        assert!(!hidden.profile_match);
        assert_eq!(hidden.bound_profile_id, Some(profile_a));
        assert!(hidden.text_preview.is_none());
        assert!(hidden.items.is_empty());
        assert_eq!(
            store
                .get_for_profile(&handoff_id, Some(profile_b))
                .unwrap_err()
                .code,
            "profile_conflict"
        );
        assert_eq!(
            store
                .acknowledge_text(&handoff_id, profile_b)
                .unwrap_err()
                .code,
            "profile_conflict"
        );
        assert_eq!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_b)
                .unwrap_err()
                .code,
            "profile_conflict"
        );
        assert_eq!(
            store
                .item_path(&handoff_id, &item_id, profile_b, 3)
                .unwrap_err()
                .code,
            "profile_conflict"
        );
        assert_eq!(
            store
                .read_chunk(&handoff_id, &item_id, profile_b, 0, 3)
                .unwrap_err()
                .code,
            "profile_conflict"
        );
        assert_eq!(
            store
                .discard(&handoff_id, Some(profile_b))
                .unwrap_err()
                .code,
            "profile_conflict"
        );

        assert!(
            store
                .acknowledge_text(&handoff_id, profile_a)
                .unwrap()
                .acknowledged
        );
        assert!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_a)
                .unwrap()
                .acknowledged
        );
        assert_eq!(
            store.get(&handoff_id).unwrap().unwrap().state,
            HandoffState::Acknowledged
        );
        assert!(!file.exists());
    }

    #[test]
    fn concurrent_first_profile_bind_has_one_winner_and_never_rebinds() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        let record = record(HandoffState::Ready, ItemState::Ready);
        let handoff_id = record.handoff_id.clone();
        File::create(store.root.join(format!("{}.bin", record.items[0].item_id)))
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        store.write_record(&record).unwrap();
        let first_profile = ProfileId::new();
        let second_profile = ProfileId::new();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let first_store = store.clone();
        let first_barrier = barrier.clone();
        let first_id = handoff_id.clone();
        let first = std::thread::spawn(move || {
            first_barrier.wait();
            first_store.bind_profile(&first_id, first_profile)
        });
        let second_store = store.clone();
        let second_barrier = barrier.clone();
        let second_id = handoff_id.clone();
        let second = std::thread::spawn(move || {
            second_barrier.wait();
            second_store.bind_profile(&second_id, second_profile)
        });
        barrier.wait();
        let first_result = first.join().unwrap();
        let second_result = second.join().unwrap();
        assert_ne!(first_result.is_ok(), second_result.is_ok());
        let bound = store
            .get(&handoff_id)
            .unwrap()
            .unwrap()
            .bound_profile_id
            .unwrap();
        assert!(bound == first_profile || bound == second_profile);
        let other = if bound == first_profile {
            second_profile
        } else {
            first_profile
        };
        assert_eq!(
            store.bind_profile(&handoff_id, other).unwrap_err().code,
            "profile_conflict"
        );
    }

    #[test]
    fn watcher_registry_is_bounded_and_releases_terminal_handoff_ids() {
        let store = Store::new(PathBuf::from("watcher-test"));
        let ids: Vec<_> = (0..MAX_ACTIVE_HANDOFF_WATCHERS)
            .map(|_| Uuid::new_v4().to_string())
            .collect();
        for id in &ids {
            assert!(store.claim_watcher(id));
        }
        assert!(!store.claim_watcher(&Uuid::new_v4().to_string()));
        let released = ids[0].clone();
        let guard = WatchGuard {
            active: store.active_watchers.clone(),
            handoff_id: released.clone(),
        };
        drop(guard);
        assert!(store.claim_watcher(&released));
        assert_eq!(
            store.active_watchers.lock().unwrap().len(),
            MAX_ACTIVE_HANDOFF_WATCHERS
        );
    }

    #[test]
    fn cancellation_during_long_import_preserves_prefix_and_original_handoff() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("host");
        let archive_root = temp.path().join("archives");
        let state = NativeState::open(&root, &archive_root, None).unwrap();
        let profile = ProfileId::new();
        state
            .host
            .provision_profile(&state.owner, profile, "share cancellation regression")
            .unwrap();

        let bytes = vec![0x5a; MAX_LOCAL_SOURCE_CHUNK_BYTES * 2 + 17];
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let mut handoff = record(HandoffState::Ready, ItemState::Ready);
        handoff.items[0].byte_length = bytes.len() as u64;
        handoff.items[0].sha256 = Some(sha256.clone());
        let handoff_id = handoff.handoff_id.clone();
        let item_id = handoff.items[0].item_id.clone();
        let store = Store::open(temp.path().join("shares")).unwrap();
        File::create(store.root.join(format!("{item_id}.bin")))
            .unwrap()
            .write_all(&bytes)
            .unwrap();
        store.write_record(&handoff).unwrap();
        store.bind_profile(&handoff_id, profile).unwrap();

        let source_key = serde_json::to_string(&[
            state.host.status().unwrap().device_id.to_string(),
            profile.to_string(),
            Uuid::new_v4().to_string(),
        ])
        .unwrap();
        let request_id = Uuid::new_v4();
        let lease = state
            .attachment_jobs
            .begin(request_id, &source_key)
            .unwrap();
        let jobs = state.attachment_jobs.clone();
        let mut reader = Cursor::new(bytes);
        let mut cancel_sent = false;
        let result = import_item_reader(
            &state,
            &store,
            &handoff_id,
            &item_id,
            profile,
            &source_key,
            handoff.items[0].byte_length,
            &mut reader,
            &lease,
            |phase, completed, _| {
                if phase == "copying"
                    && completed == Some(MAX_LOCAL_SOURCE_CHUNK_BYTES as u64)
                    && !cancel_sent
                {
                    cancel_sent = true;
                    assert!(jobs.cancel(request_id).unwrap());
                }
            },
        );
        assert_eq!(result.unwrap_err().code, "attachment_cancelled");
        drop(lease);

        let source = state
            .host
            .local_source_status(&state.owner, &source_key)
            .unwrap()
            .unwrap();
        assert_eq!(source.state, LocalSourceState::Copying);
        assert_eq!(source.next_offset, MAX_LOCAL_SOURCE_CHUNK_BYTES as u64);
        let retained = store.get(&handoff_id).unwrap().unwrap();
        assert_eq!(retained.state, HandoffState::Ready);
        assert_eq!(retained.items[0].state, ItemState::Ready);
        assert!(store.root.join(format!("{item_id}.bin")).is_file());
        let human = state.human(profile).unwrap();
        assert!(state
            .host
            .events_page(&human, profile, &exomind_core::EventQuery::default())
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn item_ack_commit_failure_keeps_ready_metadata_and_original_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        let value = record(HandoffState::Ready, ItemState::Ready);
        let handoff_id = value.handoff_id.clone();
        let item_id = value.items[0].item_id.clone();
        let profile_id = ProfileId::new();
        let bytes_path = store.root.join(format!("{item_id}.bin"));
        File::create(&bytes_path)
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        store.write_record(&value).unwrap();
        store.bind_profile(&handoff_id, profile_id).unwrap();

        store.fail_next_record_commit();
        assert_eq!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_id)
                .unwrap_err()
                .code,
            "share_handoff_unavailable"
        );
        let retained = store.get(&handoff_id).unwrap().unwrap();
        assert_eq!(retained.items[0].state, ItemState::Ready);
        assert!(bytes_path.is_file());

        assert!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_id)
                .unwrap()
                .acknowledged
        );
        assert_eq!(
            store.get(&handoff_id).unwrap().unwrap().state,
            HandoffState::Acknowledged
        );
        assert!(!bytes_path.exists());
    }

    #[test]
    fn committed_ack_cleanup_is_recovered_after_interruption() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        let value = record(HandoffState::Ready, ItemState::Ready);
        let handoff_id = value.handoff_id.clone();
        let item_id = value.items[0].item_id.clone();
        let profile_id = ProfileId::new();
        let bytes_path = store.root.join(format!("{item_id}.bin"));
        File::create(&bytes_path)
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        store.write_record(&value).unwrap();
        store.bind_profile(&handoff_id, profile_id).unwrap();

        store.skip_next_ack_file_cleanup();
        assert!(
            store
                .acknowledge_item(&handoff_id, &item_id, profile_id)
                .unwrap()
                .acknowledged
        );
        assert_eq!(
            store.get(&handoff_id).unwrap().unwrap().state,
            HandoffState::Acknowledged
        );
        assert!(bytes_path.is_file());

        store.recover(|_| false).unwrap();
        assert!(!bytes_path.exists());
        assert_eq!(
            store.get(&handoff_id).unwrap().unwrap().state,
            HandoffState::Acknowledged
        );
    }

    #[test]
    fn text_ack_is_idempotent_but_rejects_absent_or_interrupted_text() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        let absent = record(HandoffState::Ready, ItemState::Ready);
        let absent_id = absent.handoff_id.clone();
        store.write_record(&absent).unwrap();
        let profile_id = ProfileId::new();
        store.bind_profile(&absent_id, profile_id).unwrap();
        assert_eq!(
            store
                .acknowledge_text(&absent_id, profile_id)
                .unwrap_err()
                .code,
            "share_handoff_text_unavailable"
        );
        assert_eq!(
            store.get(&absent_id).unwrap().unwrap().text_state,
            TextState::None
        );

        let mut interrupted_text = record(HandoffState::Interrupted, ItemState::Interrupted);
        interrupted_text.error_code = Some(HandoffErrorCode::Interrupted);
        interrupted_text.text_state = TextState::Interrupted;
        interrupted_text.bound_profile_id = Some(profile_id);
        let interrupted_id = interrupted_text.handoff_id.clone();
        store.write_record(&interrupted_text).unwrap();
        assert_eq!(
            store
                .acknowledge_text(&interrupted_id, profile_id)
                .unwrap_err()
                .code,
            "share_handoff_text_unavailable"
        );

        let mut ready_text = record(HandoffState::Ready, ItemState::Ready);
        ready_text.items.clear();
        ready_text.text = Some("saved note".into());
        ready_text.text_state = TextState::Ready;
        let ready_id = ready_text.handoff_id.clone();
        store.write_record(&ready_text).unwrap();
        store.bind_profile(&ready_id, profile_id).unwrap();
        assert!(
            store
                .acknowledge_text(&ready_id, profile_id)
                .unwrap()
                .acknowledged
        );
        assert!(
            store
                .acknowledge_text(&ready_id, profile_id)
                .unwrap()
                .acknowledged
        );
        let tombstone = store.get(&ready_id).unwrap().unwrap();
        assert_eq!(tombstone.state, HandoffState::Acknowledged);
        assert_eq!(tombstone.text_state, TextState::Acknowledged);
        assert!(tombstone.text.is_none());
    }

    #[test]
    fn compaction_bounds_acknowledged_receipts_and_preserves_ready_handoffs() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("shares")).unwrap();
        for sequence in 0..(MAX_ACKED_TOMBSTONES + 5) {
            let mut receipt = record(HandoffState::Acknowledged, ItemState::Acknowledged);
            receipt.received_at_ms = sequence as u64 + 1;
            receipt.items.clear();
            receipt.text_state = TextState::Acknowledged;
            store.write_record(&receipt).unwrap();
        }
        let ready = record(HandoffState::Ready, ItemState::Ready);
        let ready_id = ready.handoff_id.clone();
        let item_id = ready.items[0].item_id.clone();
        let ready_path = store.root.join(format!("{item_id}.bin"));
        File::create(&ready_path)
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        store.write_record(&ready).unwrap();

        store.compact_acknowledged().unwrap();
        let rows = store.list().unwrap();
        assert_eq!(
            rows.iter()
                .filter(|row| row.state == HandoffState::Acknowledged)
                .count(),
            MAX_ACKED_TOMBSTONES
        );
        assert!(rows
            .iter()
            .any(|row| row.handoff_id == ready_id && row.state == HandoffState::Ready));
        assert!(ready_path.is_file());
    }
}
