#![allow(unexpected_cfgs)]

use exomind_core::{OriginalId, ProfileId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    io::{self, Write},
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use uuid::Uuid;

#[path = "beta_native_user_export_journal.rs"]
mod journal;

const MAX_REQUEST_IDS: usize = 4096;
const MAX_FINISHED_RESULTS: usize = 32;
const MAX_EXPORT_SECONDS: Duration = Duration::from_secs(60 * 60);

#[cfg(test)]
mod completion_tests {
    use super::*;

    #[test]
    fn terminal_status_is_published_with_its_result_under_the_manager_lock() {
        let manager = Arc::new(UserRangeExportManager::default());
        let request = Uuid::new_v4();
        let profile = ProfileId::new();
        let lease = manager.begin(request, profile).unwrap();
        let job = lease.0.job.clone();
        // A status reader has the lock before the completion writer enters.
        let snapshot_guard = manager.state.lock().unwrap();
        let writer = manager.clone();
        let writer_job = job.clone();
        let worker = std::thread::spawn(move || {
            writer.complete(&writer_job, UserRangeExportResult::saved(request, profile, true, 4096, "a".repeat(64), 0, 0));
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while !job.finished.load(Ordering::Acquire) && Instant::now() < deadline {
            std::thread::yield_now();
        }
        let entered = job.finished.load(Ordering::Acquire);
        let observation_deadline = Instant::now() + Duration::from_millis(100);
        while !UserRangeExportPhase::from_u8(job.phase.load(Ordering::Acquire)).terminal()
            && Instant::now() < observation_deadline
        {
            std::thread::yield_now();
        }
        let phase_while_snapshot_locked = UserRangeExportPhase::from_u8(job.phase.load(Ordering::Acquire));
        drop(snapshot_guard);
        worker.join().unwrap();
        assert!(entered, "completion writer entered before the snapshot observation");
        assert!(!phase_while_snapshot_locked.terminal(), "a reader must not see terminal phase before the matching result is published");
        let completed = manager.status(request).unwrap().expect("completed task remains queryable");
        assert_eq!(completed.phase, UserRangeExportPhase::Saved);
        assert!(completed.result.is_some());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum UserRangeExportPhase {
    Preparing = 0,
    AwaitingDestination = 1,
    Writing = 2,
    Verifying = 3,
    Cancelling = 4,
    Publishing = 5,
    Saved = 6,
    Cancelled = 7,
    Failed = 8,
    Interrupted = 9,
}

impl UserRangeExportPhase {
    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Preparing,
            1 => Self::AwaitingDestination,
            2 => Self::Writing,
            3 => Self::Verifying,
            4 => Self::Cancelling,
            5 => Self::Publishing,
            6 => Self::Saved,
            7 => Self::Cancelled,
            8 => Self::Failed,
            _ => Self::Interrupted,
        }
    }

    fn terminal(self) -> bool {
        matches!(
            self,
            Self::Saved | Self::Cancelled | Self::Failed | Self::Interrupted
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserRangeExportResult {
    pub request_id: Uuid,
    pub profile_id: ProfileId,
    pub phase: UserRangeExportPhase,
    pub content_complete: bool,
    pub partial_output: bool,
    pub included_originals: u32,
    pub omitted_originals: u32,
    pub archive_byte_length: Option<u64>,
    pub archive_sha256: Option<String>,
    pub failure_code: Option<String>,
}

impl UserRangeExportResult {
    pub fn saved(
        request_id: Uuid,
        profile_id: ProfileId,
        content_complete: bool,
        byte_length: u64,
        sha256: String,
        included_originals: u32,
        omitted_originals: u32,
    ) -> Self {
        Self {
            request_id,
            profile_id,
            phase: UserRangeExportPhase::Saved,
            content_complete,
            partial_output: false,
            included_originals,
            omitted_originals,
            archive_byte_length: Some(byte_length),
            archive_sha256: Some(sha256),
            failure_code: None,
        }
    }

    pub fn cancelled(
        request_id: Uuid,
        profile_id: ProfileId,
        partial_output: bool,
        included_originals: u32,
        omitted_originals: u32,
    ) -> Self {
        Self {
            request_id,
            profile_id,
            phase: UserRangeExportPhase::Cancelled,
            content_complete: false,
            partial_output,
            included_originals,
            omitted_originals,
            archive_byte_length: None,
            archive_sha256: None,
            failure_code: Some("cancelled".into()),
        }
    }

    pub fn failed(
        request_id: Uuid,
        profile_id: ProfileId,
        failure_code: &str,
        partial_output: bool,
        included_originals: u32,
        omitted_originals: u32,
    ) -> Self {
        Self {
            request_id,
            profile_id,
            phase: UserRangeExportPhase::Failed,
            content_complete: false,
            partial_output,
            included_originals,
            omitted_originals,
            archive_byte_length: None,
            archive_sha256: None,
            failure_code: Some(failure_code.to_owned()),
        }
    }

    fn interrupted(request_id: Uuid, profile_id: ProfileId, partial_output: bool) -> Self {
        Self {
            request_id,
            profile_id,
            phase: UserRangeExportPhase::Interrupted,
            content_complete: false,
            partial_output,
            included_originals: 0,
            omitted_originals: 0,
            archive_byte_length: None,
            archive_sha256: None,
            failure_code: Some("interrupted".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UserRangeCancelResult {
    pub request_id: Uuid,
    pub accepted: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UserRangeExportStatus {
    pub request_id: Uuid,
    pub profile_id: ProfileId,
    pub phase: UserRangeExportPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<UserRangeExportResult>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRangeExportCapabilities {
    pub schema: u8,
    pub supported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserExportTarMember {
    pub original_id: OriginalId,
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserExportTarReceipt {
    pub archive_byte_length: u64,
    pub archive_sha256: String,
}

#[derive(Debug, thiserror::Error)]
pub enum UserExportTarError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("tar member name or size is invalid")]
    InvalidMember,
    #[error("the same OriginalId was listed more than once")]
    DuplicateOriginal,
    #[error("permit-backed original read failed")]
    OriginalRead,
    #[error("original read was cancelled")]
    Cancelled,
    #[error("permit-backed original length changed")]
    OriginalLengthMismatch,
    #[error("permit-backed original hash changed")]
    OriginalHashMismatch,
}

/// Writes one uncompressed POSIX USTAR stream. Original bytes are supplied
/// directly into a length- and hash-checking writer, so this never buffers them.
pub fn write_user_range_tar<W, F>(
    output: &mut W,
    records_markdown: &[u8],
    manifest_json: &[u8],
    originals: &[UserExportTarMember],
    mut copy_original: F,
) -> Result<UserExportTarReceipt, UserExportTarError>
where
    W: Write,
    F: FnMut(&UserExportTarMember, &mut dyn Write) -> Result<(), UserExportTarError>,
{
    let mut writer = HashingWriter::new(output);
    write_member_bytes(&mut writer, "records.md", records_markdown)?;
    write_member_bytes(&mut writer, "manifest.json", manifest_json)?;

    let mut ordered: Vec<&UserExportTarMember> = originals.iter().collect();
    ordered.sort_by_key(|member| member.original_id.to_string());
    let mut seen = HashSet::with_capacity(ordered.len());
    for member in ordered {
        if !seen.insert(member.original_id) {
            return Err(UserExportTarError::DuplicateOriginal);
        }
        validate_hash(&member.sha256)?;
        if member.byte_length > 0o777_777_777_777 {
            return Err(UserExportTarError::InvalidMember);
        }
        let name = format!("originals/{}.bin", member.original_id);
        write_header(&mut writer, &name, member.byte_length)?;
        let mut entry = ExactEntryWriter::new(&mut writer, member.byte_length);
        copy_original(member, &mut entry)?;
        if entry.written != member.byte_length {
            return Err(UserExportTarError::OriginalLengthMismatch);
        }
        let actual = format!(
            "{:x}",
            std::mem::replace(&mut entry.hasher, Sha256::new()).finalize()
        );
        if !actual.eq_ignore_ascii_case(&member.sha256) {
            return Err(UserExportTarError::OriginalHashMismatch);
        }
        drop(entry);
        write_padding(&mut writer, member.byte_length)?;
    }

    writer.write_all(&[0u8; 1024])?;
    writer.flush()?;
    Ok(writer.finish())
}

fn validate_hash(value: &str) -> Result<(), UserExportTarError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(UserExportTarError::InvalidMember);
    }
    Ok(())
}

fn write_member_bytes<W: Write>(
    writer: &mut HashingWriter<'_, W>,
    name: &str,
    bytes: &[u8],
) -> Result<(), UserExportTarError> {
    write_header(writer, name, bytes.len() as u64)?;
    writer.write_all(bytes)?;
    write_padding(writer, bytes.len() as u64)
}

fn write_header<W: Write>(
    writer: &mut HashingWriter<'_, W>,
    name: &str,
    byte_length: u64,
) -> Result<(), UserExportTarError> {
    let name = name.as_bytes();
    if name.is_empty() || name.len() > 100 || name.contains(&0) {
        return Err(UserExportTarError::InvalidMember);
    }
    let mut header = [0u8; 512];
    header[..name.len()].copy_from_slice(name);
    write_octal(&mut header[100..108], 0o600)?;
    write_octal(&mut header[108..116], 0)?;
    write_octal(&mut header[116..124], 0)?;
    write_octal(&mut header[124..136], byte_length)?;
    write_octal(&mut header[136..148], 0)?;
    header[148..156].fill(b' ');
    header[156] = b'0';
    header[257..263].copy_from_slice(b"ustar\0");
    header[263..265].copy_from_slice(b"00");
    let checksum: u64 = header.iter().map(|byte| u64::from(*byte)).sum();
    let checksum = format!("{checksum:06o}\0 ");
    if checksum.len() != 8 {
        return Err(UserExportTarError::InvalidMember);
    }
    header[148..156].copy_from_slice(checksum.as_bytes());
    writer.write_all(&header)?;
    Ok(())
}

fn write_octal(field: &mut [u8], value: u64) -> Result<(), UserExportTarError> {
    let width = field.len().saturating_sub(1);
    let encoded = format!("{value:0width$o}");
    if encoded.len() > width {
        return Err(UserExportTarError::InvalidMember);
    }
    field.fill(0);
    field[..encoded.len()].copy_from_slice(encoded.as_bytes());
    Ok(())
}

fn write_padding<W: Write>(
    writer: &mut HashingWriter<'_, W>,
    byte_length: u64,
) -> Result<(), UserExportTarError> {
    let remainder = (byte_length % 512) as usize;
    if remainder != 0 {
        writer.write_all(&[0u8; 512][..512 - remainder])?;
    }
    Ok(())
}

struct HashingWriter<'a, W: Write> {
    inner: &'a mut W,
    hasher: Sha256,
    byte_length: u64,
}

impl<'a, W: Write> HashingWriter<'a, W> {
    fn new(inner: &'a mut W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            byte_length: 0,
        }
    }

    fn finish(self) -> UserExportTarReceipt {
        UserExportTarReceipt {
            archive_byte_length: self.byte_length,
            archive_sha256: format!("{:x}", self.hasher.finalize()),
        }
    }
}

impl<W: Write> Write for HashingWriter<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.byte_length = self.byte_length.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

struct ExactEntryWriter<'a, 'b, W: Write> {
    parent: &'a mut HashingWriter<'b, W>,
    expected: u64,
    written: u64,
    hasher: Sha256,
}

impl<'a, 'b, W: Write> ExactEntryWriter<'a, 'b, W> {
    fn new(parent: &'a mut HashingWriter<'b, W>, expected: u64) -> Self {
        Self {
            parent,
            expected,
            written: 0,
            hasher: Sha256::new(),
        }
    }
}

impl<W: Write> Write for ExactEntryWriter<'_, '_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        let remaining = self.expected.saturating_sub(self.written);
        if remaining == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "original member exceeded its declared length",
            ));
        }
        let limit = usize::try_from(remaining.min(bytes.len() as u64)).unwrap_or(bytes.len());
        let written = self.parent.write(&bytes[..limit])?;
        self.hasher.update(&bytes[..written]);
        self.written = self.written.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.parent.flush()
    }
}
#[derive(Default)]
struct ManagerState {
    active: Option<Arc<ExportJob>>,
    used: HashSet<Uuid>,
    finished: VecDeque<UserRangeExportResult>,
    journal: Option<journal::UserRangeExportJournal>,
    journal_unavailable: bool,
}

struct ExportJob {
    request_id: Uuid,
    profile_id: ProfileId,
    phase: AtomicU8,
    cancelled: AtomicBool,
    finished: AtomicBool,
    changed: Notify,
    started: Instant,
}

pub(super) struct UserRangeExportManager {
    stopping: AtomicBool,
    state: Mutex<ManagerState>,
    idle: Condvar,
}

#[cfg(test)]
impl Default for UserRangeExportManager {
    fn default() -> Self {
        Self {
            stopping: AtomicBool::new(false),
            state: Mutex::new(ManagerState::default()),
            idle: Condvar::new(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum StopReason {
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy)]
enum AdmissionError {
    InvalidRequest,
    Busy,
    RequestReused,
    Stopping,
    Capacity,
    JournalUnavailable,
}

pub(super) struct UserRangeExportLease(Arc<LeaseInner>);

struct LeaseInner {
    manager: Arc<UserRangeExportManager>,
    job: Arc<ExportJob>,
}

impl Clone for UserRangeExportLease {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl UserRangeExportManager {
    pub(super) fn open(host_root: &std::path::Path) -> Self {
        let mut state = ManagerState::default();
        match journal::UserRangeExportJournal::open(host_root) {
            Ok(journal) => {
                for status in journal.all() {
                    state.used.insert(status.request_id);
                    if let Some(result) = status.result {
                        state.finished.push_back(result);
                    }
                }
                state.journal = Some(journal);
            }
            Err(_error) => {
                #[cfg(exomind_beta_gui)]
                log::warn!("Native user range export receipts unavailable: {_error}");
                state.journal_unavailable = true;
            }
        }
        Self {
            stopping: AtomicBool::new(false),
            state: Mutex::new(state),
            idle: Condvar::new(),
        }
    }

    fn begin(
        self: &Arc<Self>,
        request_id: Uuid,
        profile_id: ProfileId,
    ) -> Result<UserRangeExportLease, AdmissionError> {
        if request_id.is_nil() {
            return Err(AdmissionError::InvalidRequest);
        }
        let mut state = self.state.lock().map_err(|_| AdmissionError::Busy)?;
        if self.stopping.load(Ordering::Acquire) {
            return Err(AdmissionError::Stopping);
        }
        if state.active.is_some() {
            return Err(AdmissionError::Busy);
        }
        if state.used.contains(&request_id) {
            return Err(AdmissionError::RequestReused);
        }
        if state.used.len() >= MAX_REQUEST_IDS {
            return Err(AdmissionError::Capacity);
        }
        if state.journal_unavailable {
            return Err(AdmissionError::JournalUnavailable);
        }
        let begin_result = state.journal.as_mut().map(|journal| journal.begin(request_id, profile_id));
        match begin_result {
            Some(Ok(())) => {}
            Some(Err(journal::JournalError::DuplicateRequest)) => return Err(AdmissionError::RequestReused),
            Some(Err(journal::JournalError::Busy)) => return Err(AdmissionError::Busy),
            Some(Err(journal::JournalError::HistoryFull)) => return Err(AdmissionError::Capacity),
            Some(Err(_)) => {
                state.journal_unavailable = true;
                return Err(AdmissionError::JournalUnavailable);
            }
            None if cfg!(test) => {}
            None => {
                state.journal_unavailable = true;
                return Err(AdmissionError::JournalUnavailable);
            }
        }
        let job = Arc::new(ExportJob {
            request_id,
            profile_id,
            phase: AtomicU8::new(UserRangeExportPhase::Preparing as u8),
            cancelled: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            changed: Notify::new(),
            started: Instant::now(),
        });
        state.used.insert(request_id);
        state.active = Some(job.clone());
        drop(state);
        Ok(UserRangeExportLease(Arc::new(LeaseInner {
            manager: self.clone(),
            job,
        })))
    }

    fn cancel(&self, request_id: Uuid, profile_id: ProfileId) -> bool {
        let Ok(state) = self.state.lock() else {
            return false;
        };
        let Some(job) = state
            .active
            .as_ref()
            .filter(|job| job.request_id == request_id && job.profile_id == profile_id)
        else {
            return false;
        };
        let phase = UserRangeExportPhase::from_u8(job.phase.load(Ordering::Acquire));
        if phase == UserRangeExportPhase::Publishing || phase.terminal() {
            return false;
        }
        job.cancelled.store(true, Ordering::Release);
        job.changed.notify_waiters();
        true
    }

    fn profile(&self, request_id: Uuid) -> Result<Option<ProfileId>, journal::JournalError> {
        let state = self.state.lock().map_err(|_| journal::JournalError::Unavailable)?;
        if state.journal.is_none() && !cfg!(test) {
            return Err(journal::JournalError::Unavailable);
        }
        Ok(state
            .active
            .as_ref()
            .filter(|job| job.request_id == request_id)
            .map(|job| job.profile_id)
            .or_else(|| {
                state
                    .finished
                    .iter()
                    .rev()
                    .find(|result| result.request_id == request_id)
                    .map(|result| result.profile_id)
            }))
    }

    fn status(&self, request_id: Uuid) -> Result<Option<UserRangeExportStatus>, journal::JournalError> {
        let state = self.state.lock().map_err(|_| journal::JournalError::Unavailable)?;
        if state.journal.is_none() && !cfg!(test) {
            return Err(journal::JournalError::Unavailable);
        }
        if let Some(job) = state
            .active
            .as_ref()
            .filter(|job| job.request_id == request_id)
        {
            let current = UserRangeExportPhase::from_u8(job.phase.load(Ordering::Acquire));
            let phase = if job.cancelled.load(Ordering::Acquire)
                && current != UserRangeExportPhase::Publishing
            {
                UserRangeExportPhase::Cancelling
            } else {
                current
            };
            return Ok(Some(UserRangeExportStatus {
                request_id,
                profile_id: job.profile_id,
                phase,
                result: None,
            }));
        }
        Ok(state
            .finished
            .iter()
            .rev()
            .find(|result| result.request_id == request_id)
            .cloned()
            .map(|result| UserRangeExportStatus {
                request_id: result.request_id,
                profile_id: result.profile_id,
                phase: result.phase,
                result: Some(result),
            }))
    }

    fn private_stage_root(&self) -> Result<std::path::PathBuf, journal::JournalError> {
        let state = self.state.lock().map_err(|_| journal::JournalError::Unavailable)?;
        if state.journal_unavailable {
            return Err(journal::JournalError::Unavailable);
        }
        state.journal.as_ref()
            .ok_or(journal::JournalError::Unavailable)?
            .private_stage_root()
    }

    fn set_phase(&self, job: &Arc<ExportJob>, phase: UserRangeExportPhase) -> Result<(), journal::JournalError> {
        let mut state = self.state.lock().map_err(|_| journal::JournalError::Unavailable)?;
        Self::set_phase_locked(&mut state, job, phase)
    }

    fn set_phase_locked(
        state: &mut ManagerState,
        job: &Arc<ExportJob>,
        phase: UserRangeExportPhase,
    ) -> Result<(), journal::JournalError> {
        if state.journal_unavailable {
            return Err(journal::JournalError::Unavailable);
        }
        let persisted = state.journal.as_mut().map(|journal| journal.transition(job.request_id, phase));
        match persisted {
            Some(Ok(())) => {}
            Some(Err(error)) => {
                state.journal_unavailable = true;
                return Err(error);
            }
            None if cfg!(test) => {}
            None => {
                state.journal_unavailable = true;
                return Err(journal::JournalError::Unavailable);
            }
        }
        job.phase.store(phase as u8, Ordering::Release);
        Ok(())
    }
    pub(super) fn request_stop(&self) {
        self.stopping.store(true, Ordering::Release);
        let Ok(state) = self.state.lock() else {
            return;
        };
        if let Some(job) = &state.active {
            let phase = UserRangeExportPhase::from_u8(job.phase.load(Ordering::Acquire));
            if phase != UserRangeExportPhase::Publishing && !phase.terminal() {
                job.cancelled.store(true, Ordering::Release);
                job.changed.notify_waiters();
            }
        }
    }

    pub(super) fn wait_empty(&self, timeout: Duration) -> Result<(), exomind_beta_host::HostError> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .state
            .lock()
            .map_err(|_| exomind_beta_host::HostError::StatePoisoned)?;
        while state.active.is_some() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(exomind_beta_host::HostError::Shutdown);
            }
            state = self
                .idle
                .wait_timeout(state, remaining)
                .map_err(|_| exomind_beta_host::HostError::StatePoisoned)?
                .0;
        }
        Ok(())
    }

    fn complete(&self, job: &Arc<ExportJob>, result: UserRangeExportResult) -> bool {
        if job.finished.swap(true, Ordering::AcqRel) {
            return false;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.journal_unavailable {
            return false;
        }
        let persisted = state.journal.as_mut().map(|journal| journal.finish(result.clone()));
        match persisted {
            Some(Ok(())) => {}
            Some(Err(_)) => {
                state.journal_unavailable = true;
                return false;
            }
            None if cfg!(test) => {}
            None => {
                state.journal_unavailable = true;
                return false;
            }
        }
        // Keep the terminal phase and matching result behind the same lock and commit.
        job.phase.store(result.phase as u8, Ordering::Release);
        if state
            .active
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, job))
        {
            state.active = None;
        }
        state.finished.push_back(result);
        while state.finished.len() > MAX_FINISHED_RESULTS {
            state.finished.pop_front();
        }
        self.idle.notify_all();
        true
    }
}

impl UserRangeExportLease {
    fn set_phase(&self, phase: UserRangeExportPhase) -> Result<(), journal::JournalError> {
        self.0.manager.set_phase(&self.0.job, phase)
    }

    fn request_id(&self) -> Uuid {
        self.0.job.request_id
    }

    fn stop_reason(&self) -> Option<StopReason> {
        let phase = UserRangeExportPhase::from_u8(self.0.job.phase.load(Ordering::Acquire));
        if phase == UserRangeExportPhase::Publishing {
            return None;
        }
        if self.0.job.cancelled.load(Ordering::Acquire) {
            Some(StopReason::Cancelled)
        } else if self.0.manager.stopping.load(Ordering::Acquire)
            || self.0.job.started.elapsed() >= MAX_EXPORT_SECONDS
        {
            Some(StopReason::Interrupted)
        } else {
            None
        }
    }

    fn admit_publish(&self) -> Result<bool, journal::JournalError> {
        let mut state = self.0.manager.state.lock().map_err(|_| journal::JournalError::Unavailable)?;
        if self.0.job.cancelled.load(Ordering::Acquire)
            || self.0.manager.stopping.load(Ordering::Acquire)
        {
            return Ok(false);
        }
        UserRangeExportManager::set_phase_locked(
            &mut state,
            &self.0.job,
            UserRangeExportPhase::Publishing,
        )?;
        Ok(true)
    }

    async fn cancellation(&self) {
        loop {
            let notified = self.0.job.changed.notified();
            if self.stop_reason().is_some() {
                return;
            }
            notified.await;
        }
    }

    fn finish(&self, result: UserRangeExportResult) -> bool {
        self.0.manager.complete(&self.0.job, result)
    }
}

impl Drop for LeaseInner {
    fn drop(&mut self) {
        if self.job.finished.load(Ordering::Acquire) {
            return;
        }
        let phase = UserRangeExportPhase::from_u8(self.job.phase.load(Ordering::Acquire));
        let partial_output = matches!(
            phase,
            UserRangeExportPhase::AwaitingDestination
                | UserRangeExportPhase::Writing
                | UserRangeExportPhase::Verifying
                | UserRangeExportPhase::Publishing
        );
        let result = if self.job.cancelled.load(Ordering::Acquire) {
            UserRangeExportResult::cancelled(
                self.job.request_id,
                self.job.profile_id,
                partial_output,
                0,
                0,
            )
        } else {
            UserRangeExportResult::interrupted(
                self.job.request_id,
                self.job.profile_id,
                partial_output,
            )
        };
        self.manager.complete(&self.job, result);
    }
}
#[cfg(any(feature = "alpha-legacy-runtime", feature = "beta-native-only"))]
use super::{trusted_window, Failure, NativeState};

#[cfg(any(feature = "alpha-legacy-runtime", feature = "beta-native-only"))]
fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}

#[cfg(any(feature = "alpha-legacy-runtime", feature = "beta-native-only"))]
#[path = "beta_native_original_source.rs"]
mod source;

#[cfg(any(feature = "alpha-legacy-runtime", feature = "beta-native-only"))]
pub(super) mod command {
    use super::{
        failure, source, trusted_window, write_user_range_tar, Failure, NativeState, StopReason,
        UserExportTarError, UserExportTarMember, UserRangeCancelResult, UserRangeExportLease,
        UserRangeExportPhase, UserRangeExportResult, UserRangeExportStatus, UserRangeExportCapabilities,
    };
    use exomind_beta_host::user_export_source::{
        UserExportOriginalDisposition, UserExportSourceError, UserExportSourceLimits,
        UserExportSourceRequest,
    };
    use exomind_beta_host::user_export::Selection;
    use exomind_core::{ProfileId, MAX_ORIGINAL_CHUNK_BYTES};
    use sha2::{Digest, Sha256};
    use serde::Deserialize;
    use std::{
        fs::{self, File, OpenOptions},
        io::{Read, Seek, SeekFrom, Write},
        path::{Path, PathBuf},
        sync::{Arc, atomic::Ordering},
    };
    use tauri::{AppHandle, Manager, State, WebviewWindow};
    use tauri_plugin_dialog::{DialogExt, FilePath};
    use uuid::Uuid;

    #[derive(Debug, Clone, Deserialize)]
    #[serde(deny_unknown_fields)]
    pub(crate) struct UserRangeExportRequest {
        request_id: Uuid,
        profile_id: ProfileId,
        selections: Vec<UserRangeSelection>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
    enum UserRangeSelection {
        Event { event_id: exomind_core::EventId },
        Timeblock { block_id: exomind_core::TimeblockId },
    }

    struct PreparedArchive {
        archive: TemporaryArchive,
        receipt: super::UserExportTarReceipt,
        content_complete: bool,
        included_originals: u32,
        omitted_originals: u32,
    }

    struct ExportFailure {
        code: &'static str,
        partial_output: bool,
        content_complete: bool,
        included_originals: u32,
        omitted_originals: u32,
    }

    impl ExportFailure {
        fn new(
            code: &'static str,
            partial_output: bool,
            content_complete: bool,
            included_originals: u32,
            omitted_originals: u32,
        ) -> Self {
            Self {
                code,
                partial_output,
                content_complete,
                included_originals,
                omitted_originals,
            }
        }

        fn from_stop(
            reason: StopReason,
            partial_output: bool,
            content_complete: bool,
            included_originals: u32,
            omitted_originals: u32,
        ) -> Self {
            let code = match reason {
                StopReason::Cancelled => "cancelled",
                StopReason::Interrupted => "interrupted",
            };
            Self::new(
                code,
                partial_output,
                content_complete,
                included_originals,
                omitted_originals,
            )
        }
    }

    struct TemporaryArchive {
        path: PathBuf,
        file: File,
    }

    impl TemporaryArchive {
        fn create(directory: &Path, request_id: Uuid) -> Result<Self, ExportFailure> {
            fs::create_dir_all(directory)
                .map_err(|_| ExportFailure::new("export_io", false, false, 0, 0))?;
            let path = directory.join(super::journal::private_stage_file_name(request_id));
            let mut options = OpenOptions::new();
            options.write(true).read(true).create_new(true);
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let file = options.open(&path)
                .map_err(|_| ExportFailure::new("export_io", false, false, 0, 0))?;
            Ok(Self { path, file })
        }

        fn file_mut(&mut self) -> &mut File {
            &mut self.file
        }
    }

    impl Drop for TemporaryArchive {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn failure_result(
        request_id: Uuid,
        profile_id: ProfileId,
        failure: ExportFailure,
    ) -> UserRangeExportResult {
        match failure.code {
            "cancelled" => UserRangeExportResult::cancelled(
                request_id,
                profile_id,
                failure.partial_output,
                failure.included_originals,
                failure.omitted_originals,
            ),
            "interrupted" => {
                UserRangeExportResult::interrupted(request_id, profile_id, failure.partial_output)
            }
            code => {
                let mut result = UserRangeExportResult::failed(
                    request_id,
                    profile_id,
                    code,
                    failure.partial_output,
                    failure.included_originals,
                    failure.omitted_originals,
                );
                result.content_complete = failure.content_complete;
                result
            }
        }
    }

    fn source_failure_code(error: &UserExportSourceError) -> &'static str {
        match error {
            UserExportSourceError::InvalidSelection | UserExportSourceError::InvalidLimits => {
                "invalid_request"
            }
            UserExportSourceError::Formatter(_) => "invalid_export",
            _ => "storage_error",
        }
    }

    fn tar_failure_code(error: &UserExportTarError) -> &'static str {
        match error {
            UserExportTarError::Cancelled => "cancelled",
            UserExportTarError::OriginalRead
            | UserExportTarError::OriginalLengthMismatch
            | UserExportTarError::OriginalHashMismatch => "original_integrity",
            UserExportTarError::InvalidMember | UserExportTarError::DuplicateOriginal => {
                "invalid_export"
            }
            UserExportTarError::Io(_) => "export_io",
        }
    }

    fn prepare_archive(
        native: Arc<NativeState>,
        profile_id: ProfileId,
        selections: Vec<Selection>,
        cache: PathBuf,
        lease: UserRangeExportLease,
    ) -> Result<PreparedArchive, ExportFailure> {
        if let Some(reason) = lease.stop_reason() {
            return Err(ExportFailure::from_stop(reason, false, false, 0, 0));
        }
        let session = native
            .human(profile_id)
            .map_err(|_| ExportFailure::new("profile_forbidden", false, false, 0, 0))?;
        let request = UserExportSourceRequest {
            profile_id,
            selections,
            limits: UserExportSourceLimits::default(),
        };
        let plan = native
            .host
            .collect_user_export_source(&session, &request)
            .map_err(|error| ExportFailure::new(source_failure_code(&error), false, false, 0, 0))?;
        let content_complete = plan.package.manifest["complete"].as_bool().unwrap_or(false);
        let included_originals = u32::try_from(
            plan.original_members
                .iter()
                .filter(|member| member.disposition == UserExportOriginalDisposition::Included)
                .count(),
        )
        .unwrap_or(u32::MAX);
        let omitted_originals = u32::try_from(plan.original_members.len())
            .unwrap_or(u32::MAX)
            .saturating_sub(included_originals);
        let members: Vec<UserExportTarMember> = plan
            .original_members
            .iter()
            .filter(|member| member.disposition == UserExportOriginalDisposition::Included)
            .map(|member| UserExportTarMember {
                original_id: member.original.original_id,
                byte_length: member.original.byte_length,
                sha256: member.original.sha256.clone(),
            })
            .collect();

        let manifest = serde_json::to_vec(&plan.package.manifest).map_err(|_| {
            ExportFailure::new(
                "invalid_export",
                false,
                content_complete,
                included_originals,
                omitted_originals,
            )
        })?;
        let mut archive = TemporaryArchive::create(&cache, lease.request_id()).map_err(|mut failure| {
            failure.content_complete = content_complete;
            failure.included_originals = included_originals;
            failure.omitted_originals = omitted_originals;
            failure
        })?;
        lease.set_phase(UserRangeExportPhase::Writing).map_err(|_| {
            ExportFailure::new("export_receipt_unavailable", false, content_complete, included_originals, omitted_originals)
        })?;
        let host = native.host.clone();
        let tar_result = write_user_range_tar(
            archive.file_mut(),
            plan.package.markdown.as_bytes(),
            &manifest,
            &members,
            |member, destination| {
                if let Some(reason) = lease.stop_reason() {
                    return Err(match reason {
                        StopReason::Cancelled => UserExportTarError::Cancelled,
                        StopReason::Interrupted => UserExportTarError::Cancelled,
                    });
                }
                let session = native
                    .human(profile_id)
                    .map_err(|_| UserExportTarError::OriginalRead)?;
                let source =
                    source::Source::begin(host.clone(), session, profile_id, member.original_id)
                        .map_err(|_| UserExportTarError::OriginalRead)?;
                if source.original.byte_length != member.byte_length
                    || !source.original.sha256.eq_ignore_ascii_case(&member.sha256)
                {
                    return Err(UserExportTarError::OriginalRead);
                }
                let mut offset = 0u64;
                while offset < member.byte_length {
                    if let Some(reason) = lease.stop_reason() {
                        return Err(match reason {
                            StopReason::Cancelled => UserExportTarError::Cancelled,
                            StopReason::Interrupted => UserExportTarError::Cancelled,
                        });
                    }
                    let length =
                        (member.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
                    let bytes = source
                        .read(offset, length)
                        .map_err(|_| UserExportTarError::OriginalRead)?;
                    if bytes.len() != length {
                        return Err(UserExportTarError::OriginalLengthMismatch);
                    }
                    destination.write_all(&bytes)?;
                    offset += length as u64;
                }
                source
                    .finish()
                    .map_err(|_| UserExportTarError::OriginalRead)?;
                Ok(())
            },
        );
        let receipt = tar_result.map_err(|error| {
            let code = tar_failure_code(&error);
            if let Some(reason) = lease.stop_reason() {
                ExportFailure::from_stop(
                    reason,
                    false,
                    content_complete,
                    included_originals,
                    omitted_originals,
                )
            } else {
                ExportFailure::new(
                    code,
                    false,
                    content_complete,
                    included_originals,
                    omitted_originals,
                )
            }
        })?;
        archive.file_mut().sync_all().map_err(|_| {
            ExportFailure::new(
                "export_io",
                false,
                content_complete,
                included_originals,
                omitted_originals,
            )
        })?;
        verify_archive_file(&archive.path, &receipt, &lease).map_err(|code| {
            ExportFailure::new(
                code,
                false,
                content_complete,
                included_originals,
                omitted_originals,
            )
        })?;
        Ok(PreparedArchive {
            archive,
            receipt,
            content_complete,
            included_originals,
            omitted_originals,
        })
    }
    fn verify_archive_file(
        path: &Path,
        expected: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
    ) -> Result<(), &'static str> {
        let mut file = File::open(path).map_err(|_| "export_io")?;
        let (length, hash) = hash_reader(&mut file, lease)?;
        if length != expected.archive_byte_length
            || !hash.eq_ignore_ascii_case(&expected.archive_sha256)
        {
            return Err("archive_integrity");
        }
        Ok(())
    }

    fn hash_reader(
        reader: &mut impl Read,
        lease: &UserRangeExportLease,
    ) -> Result<(u64, String), &'static str> {
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
        let mut length = 0u64;
        loop {
            if let Some(reason) = lease.stop_reason() {
                return Err(stop_code(reason));
            }
            let count = reader.read(&mut buffer).map_err(|_| "export_io")?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            length = length.saturating_add(count as u64);
        }
        Ok((length, format!("{:x}", hasher.finalize())))
    }

    async fn choose_destination(
        app: &AppHandle,
        window: &WebviewWindow,
        lease: &UserRangeExportLease,
    ) -> Result<Option<FilePath>, &'static str> {
        lease.set_phase(UserRangeExportPhase::AwaitingDestination)
            .map_err(|_| "export_receipt_unavailable")?;
        let (send, receive) = tokio::sync::oneshot::channel();
        let dialog = app
            .dialog()
            .file()
            .set_file_name("ExoMind-selected-records.tar");
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        let dialog = dialog.set_parent(window);
        #[cfg(any(target_os = "android", target_os = "ios"))]
        let _ = window;
        dialog.save_file(move |path| {
            let _ = send.send(path);
        });
        tokio::select! {
            biased;
            _ = lease.cancellation() => Ok(None),
            result = receive => result.map_err(|_| "export_dialog_unavailable"),
        }
    }

    struct SaveFailure {
        code: &'static str,
        partial_output: bool,
    }

    fn save_destination(
        app: &AppHandle,
        destination: FilePath,
        archive: &TemporaryArchive,
        receipt: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
    ) -> Result<(), SaveFailure> {
        #[cfg(target_os = "android")]
        {
            save_android(app, destination, archive, receipt, lease)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = app;
            save_desktop(destination, archive, receipt, lease)
        }
    }

    #[cfg(not(target_os = "android"))]
    fn save_desktop(
        destination: FilePath,
        archive: &TemporaryArchive,
        receipt: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
    ) -> Result<(), SaveFailure> {
        let FilePath::Path(destination) = destination else {
            return Err(SaveFailure {
                code: "export_io",
                partial_output: false,
            });
        };
        if !destination.is_absolute() {
            return Err(SaveFailure {
                code: "export_io",
                partial_output: false,
            });
        }
        let name = destination.file_name().ok_or(SaveFailure {
            code: "export_io",
            partial_output: false,
        })?;
        let parent = destination
            .parent()
            .ok_or(SaveFailure {
                code: "export_io",
                partial_output: false,
            })?
            .canonicalize()
            .map_err(|_| SaveFailure {
                code: "export_io",
                partial_output: false,
            })?;
        let target = parent.join(name);
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                return Err(SaveFailure {
                    code: "export_exists",
                    partial_output: false,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(SaveFailure {
                    code: "export_io",
                    partial_output: false,
                });
            }
        }

        let mut temporary = TemporaryArchive::create(&parent, lease.request_id()).map_err(|failure| SaveFailure {
            code: failure.code,
            partial_output: false,
        })?;
        copy_and_verify(archive, &mut temporary, receipt, lease)?;
        if !lease.admit_publish().map_err(|_| SaveFailure {
            code: "export_receipt_unavailable",
            partial_output: true,
        })? {
            return Err(SaveFailure {
                code: lease.stop_reason().map_or("export_cancelled", stop_code),
                partial_output: false,
            });
        }
        std::fs::hard_link(&temporary.path, &target).map_err(|error| SaveFailure {
            code: if error.kind() == std::io::ErrorKind::AlreadyExists {
                "export_exists"
            } else {
                "export_io"
            },
            partial_output: false,
        })?;
        let mut published = File::open(&target).map_err(|_| SaveFailure {
            code: "export_integrity",
            partial_output: true,
        })?;
        verify_reader(&mut published, receipt, lease, true)?;
        Ok(())
    }

    #[cfg(target_os = "android")]
    fn save_android(
        app: &AppHandle,
        destination: FilePath,
        archive: &TemporaryArchive,
        receipt: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
    ) -> Result<(), SaveFailure> {
        use tauri_plugin_fs::FsExt;
        let FilePath::Url(uri) = destination else {
            return Err(SaveFailure {
                code: "export_io",
                partial_output: false,
            });
        };
        if uri.scheme() != "content" {
            return Err(SaveFailure {
                code: "export_io",
                partial_output: false,
            });
        }
        let destination = FilePath::Url(uri);
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true).write(true);
        let mut output = app
            .fs()
            .open(destination.clone(), options)
            .map_err(|_| SaveFailure {
                code: "export_io",
                partial_output: true,
            })?;
        let mut existing = [0u8; 1];
        if output
            .metadata()
            .map_err(|_| SaveFailure {
                code: "export_io",
                partial_output: false,
            })?
            .len()
            != 0
            || output.read(&mut existing).map_err(|_| SaveFailure {
                code: "export_io",
                partial_output: false,
            })? != 0
        {
            return Err(SaveFailure {
                code: "export_exists",
                partial_output: false,
            });
        }
        let mut source = File::open(&archive.path).map_err(|_| SaveFailure {
            code: "export_io",
            partial_output: true,
        })?;
        copy_reader(&mut source, &mut output, lease, true)?;
        output.flush().map_err(|_| SaveFailure {
            code: "export_io",
            partial_output: true,
        })?;
        output.sync_all().map_err(|_| SaveFailure {
            code: "export_io",
            partial_output: true,
        })?;
        drop(output);

        lease.set_phase(UserRangeExportPhase::Verifying).map_err(|_| SaveFailure {
            code: "export_receipt_unavailable",
            partial_output: true,
        })?;
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true);
        let mut check = app
            .fs()
            .open(destination, options)
            .map_err(|_| SaveFailure {
                code: "export_integrity",
                partial_output: true,
            })?;
        verify_reader(&mut check, receipt, lease, true)?;
        if !lease.admit_publish().map_err(|_| SaveFailure {
            code: "export_receipt_unavailable",
            partial_output: true,
        })? {
            return Err(SaveFailure {
                code: lease.stop_reason().map_or("export_cancelled", stop_code),
                partial_output: true,
            });
        }
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    fn copy_and_verify(
        archive: &TemporaryArchive,
        destination: &mut TemporaryArchive,
        receipt: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
    ) -> Result<(), SaveFailure> {
        let mut source = File::open(&archive.path).map_err(|_| SaveFailure {
            code: "export_io",
            partial_output: false,
        })?;
        copy_reader(&mut source, destination.file_mut(), lease, false)?;
        destination.file_mut().sync_all().map_err(|_| SaveFailure {
            code: "export_io",
            partial_output: false,
        })?;
        destination
            .file_mut()
            .seek(SeekFrom::Start(0))
            .map_err(|_| SaveFailure {
                code: "export_io",
                partial_output: false,
            })?;
        verify_reader(destination.file_mut(), receipt, lease, false)?;
        Ok(())
    }

    fn copy_reader(
        source: &mut impl Read,
        destination: &mut impl Write,
        lease: &UserRangeExportLease,
        partial_output: bool,
    ) -> Result<(), SaveFailure> {
        let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
        loop {
            if let Some(reason) = lease.stop_reason() {
                return Err(SaveFailure {
                    code: stop_code(reason),
                    partial_output,
                });
            }
            let count = source.read(&mut buffer).map_err(|_| SaveFailure {
                code: "export_io",
                partial_output,
            })?;
            if count == 0 {
                break;
            }
            destination
                .write_all(&buffer[..count])
                .map_err(|_| SaveFailure {
                    code: "export_io",
                    partial_output,
                })?;
        }
        Ok(())
    }

    fn verify_reader(
        reader: &mut impl Read,
        receipt: &super::UserExportTarReceipt,
        lease: &UserRangeExportLease,
        partial_output: bool,
    ) -> Result<(), SaveFailure> {
        let mut hasher = Sha256::new();
        let mut length = 0u64;
        let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
        loop {
            if let Some(reason) = lease.stop_reason() {
                return Err(SaveFailure {
                    code: stop_code(reason),
                    partial_output,
                });
            }
            let count = reader.read(&mut buffer).map_err(|_| SaveFailure {
                code: "export_integrity",
                partial_output,
            })?;
            if count == 0 {
                break;
            }
            length = length.saturating_add(count as u64);
            hasher.update(&buffer[..count]);
        }
        let actual = format!("{:x}", hasher.finalize());
        if length != receipt.archive_byte_length
            || !actual.eq_ignore_ascii_case(&receipt.archive_sha256)
        {
            return Err(SaveFailure {
                code: "export_integrity",
                partial_output,
            });
        }
        Ok(())
    }

    fn stop_code(reason: StopReason) -> &'static str {
        match reason {
            StopReason::Cancelled => "cancelled",
            StopReason::Interrupted => "interrupted",
        }
    }
    async fn execute(
        app: AppHandle,
        window: WebviewWindow,
        native: Arc<NativeState>,
        request: UserRangeExportRequest,
        lease: UserRangeExportLease,
    ) -> UserRangeExportResult {
        let request_id = request.request_id;
        let profile_id = request.profile_id;
        if let Some(reason) = lease.stop_reason() {
            return failure_result(
                request_id,
                profile_id,
                ExportFailure::from_stop(reason, false, false, 0, 0),
            );
        }
        let selections = request
            .selections
            .into_iter()
            .map(|selection| match selection {
                UserRangeSelection::Event { event_id } => Selection::Event(event_id),
                UserRangeSelection::Timeblock { block_id } => Selection::Timeblock(block_id),
            })
            .collect::<Vec<_>>();
        let cache = match native.user_range_exports.private_stage_root() {
            Ok(path) => path,
            Err(_) => {
                return UserRangeExportResult::failed(
                    request_id,
                    profile_id,
                    "export_receipt_unavailable",
                    false,
                    0,
                    0,
                );
            }
        };
        let prepare_lease = lease.clone();
        let prepare = tauri::async_runtime::spawn_blocking(move || {
            prepare_archive(native, profile_id, selections, cache, prepare_lease)
        })
        .await;
        let prepared = match prepare {
            Ok(Ok(prepared)) => prepared,
            Ok(Err(failure)) => {
                return failure_result(request_id, profile_id, failure);
            }
            Err(_) => {
                return UserRangeExportResult::failed(
                    request_id,
                    profile_id,
                    "export_worker",
                    false,
                    0,
                    0,
                );
            }
        };

        let destination = match choose_destination(&app, &window, &lease).await {
            Ok(Some(destination)) => destination,
            Ok(None) => {
                if let Some(reason) = lease.stop_reason() {
                    return failure_result(
                        request_id,
                        profile_id,
                        ExportFailure::from_stop(
                            reason,
                            false,
                            prepared.content_complete,
                            prepared.included_originals,
                            prepared.omitted_originals,
                        ),
                    );
                }
                return UserRangeExportResult::cancelled(
                    request_id,
                    profile_id,
                    false,
                    prepared.included_originals,
                    prepared.omitted_originals,
                );
            }
            Err(code) => {
                return UserRangeExportResult::failed(
                    request_id,
                    profile_id,
                    code,
                    false,
                    prepared.included_originals,
                    prepared.omitted_originals,
                );
            }
        };

        if lease.set_phase(UserRangeExportPhase::Writing).is_err() {
            return UserRangeExportResult::failed(
                request_id,
                profile_id,
                "export_receipt_unavailable",
                true,
                prepared.included_originals,
                prepared.omitted_originals,
            );
        }
        let save_lease = lease.clone();
        let save_app = app.clone();
        let save_stats = (
            prepared.content_complete,
            prepared.included_originals,
            prepared.omitted_originals,
        );
        let save = tauri::async_runtime::spawn_blocking(move || {
            let result = save_destination(
                &save_app,
                destination,
                &prepared.archive,
                &prepared.receipt,
                &save_lease,
            );
            (result, prepared)
        })
        .await;
        let (saved, prepared) = match save {
            Ok(result) => result,
            Err(_) => {
                return UserRangeExportResult::failed(
                    request_id,
                    profile_id,
                    "export_worker",
                    true,
                    save_stats.1,
                    save_stats.2,
                );
            }
        };
        if let Err(error) = saved {
            let mut failure = ExportFailure::new(
                error.code,
                error.partial_output,
                prepared.content_complete,
                prepared.included_originals,
                prepared.omitted_originals,
            );
            if let Some(reason) = lease.stop_reason() {
                failure = ExportFailure::from_stop(
                    reason,
                    error.partial_output,
                    prepared.content_complete,
                    prepared.included_originals,
                    prepared.omitted_originals,
                );
            }
            return failure_result(request_id, profile_id, failure);
        }

        UserRangeExportResult::saved(
            request_id,
            profile_id,
            prepared.content_complete,
            prepared.receipt.archive_byte_length,
            prepared.receipt.archive_sha256,
            prepared.included_originals,
            prepared.omitted_originals,
        )
    }

    #[tauri::command]
    pub(crate) async fn beta_export_user_range(
        app: AppHandle,
        window: WebviewWindow,
        state: State<'_, Arc<NativeState>>,
        request: UserRangeExportRequest,
    ) -> Result<UserRangeExportResult, Failure> {
        trusted_window(&window, state.inner())?;
        if state.closing.load(Ordering::Acquire) {
            return Err(Failure::from(exomind_beta_host::HostError::Stopped));
        }
        let request_id = request.request_id;
        let profile_id = request.profile_id;
        let lease = state
            .user_range_exports
            .begin(request_id, profile_id)
            .map_err(|error| {
                let (code, message) = match error {
                    super::AdmissionError::InvalidRequest => {
                        ("invalid_request", "导出请求身份无效")
                    }
                    super::AdmissionError::Busy => ("export_busy", "已有选定范围导出正在运行"),
                    super::AdmissionError::RequestReused => {
                        ("export_request_reused", "此导出请求已使用，请重新发起")
                    }
                    super::AdmissionError::Stopping => ("stopped", "本机服务正在停止"),
                    super::AdmissionError::Capacity => ("export_busy", "导出请求过多，请稍后重试"),
                    super::AdmissionError::JournalUnavailable => ("export_receipt_unavailable", "本机导出回执不可用，未打开系统选择器"),
                };
                failure(code, message)
            })?;

        // The owned Native task survives a hidden or unmounted Renderer view.
        let (send, receive) = tokio::sync::oneshot::channel::<Result<UserRangeExportResult, Failure>>();
        let worker_app = app.clone();
        let worker_window = window.clone();
        let worker_native = state.inner().clone();
        let worker_request = request.clone();
        let worker_lease = lease.clone();
        let _worker = tauri::async_runtime::spawn(async move {
            let result = execute(
                worker_app,
                worker_window,
                worker_native,
                worker_request,
                worker_lease.clone(),
            )
            .await;
            let response = if worker_lease.finish(result.clone()) {
                Ok(result)
            } else {
                Err(failure("export_receipt_unconfirmed", "导出结果未确认；请查询本机任务状态并核对所选位置，不要重复提交"))
            };
            let _ = send.send(response);
        });
        receive.await.map_err(|_| {
            failure(
                "export_interrupted",
                "导出结果未确认，请查询本机任务状态并检查所选位置",
            )
        })?
    }

    #[tauri::command]
    pub(crate) fn beta_user_range_export_capabilities(
        window: WebviewWindow,
        state: State<'_, Arc<NativeState>>,
    ) -> Result<UserRangeExportCapabilities, Failure> {
        trusted_window(&window, state.inner())?;
        if state.closing.load(Ordering::Acquire) {
            return Err(Failure::from(exomind_beta_host::HostError::Stopped));
        }
        Ok(UserRangeExportCapabilities {
            schema: 1,
            supported: true,
        })
    }

    #[tauri::command]
    pub(crate) fn beta_cancel_user_range_export(
        window: WebviewWindow,
        state: State<'_, Arc<NativeState>>,
        request_id: Uuid,
    ) -> Result<UserRangeCancelResult, Failure> {
        trusted_window(&window, state.inner())?;
        let profile = state.user_range_exports.profile(request_id)
            .map_err(|_| failure("export_receipt_unavailable", "本机导出回执不可读，取消结果未确认"))?;
        let accepted = if let Some(profile_id) = profile {
            state.inner().human(profile_id).map_err(Failure::from)?;
            state.user_range_exports.cancel(request_id, profile_id)
        } else {
            false
        };
        Ok(UserRangeCancelResult {
            request_id,
            accepted,
        })
    }

    #[tauri::command]
    pub(crate) fn beta_user_range_export_status(
        window: WebviewWindow,
        state: State<'_, Arc<NativeState>>,
        request_id: Uuid,
    ) -> Result<Option<UserRangeExportStatus>, Failure> {
        trusted_window(&window, state.inner())?;
        let result = state.user_range_exports.status(request_id)
            .map_err(|_| failure("export_receipt_unavailable", "本机导出回执不可读，不能确认任务状态"))?;
        if let Some(result) = &result {
            state
                .inner()
                .human(result.profile_id)
                .map_err(Failure::from)?;
        }
        Ok(result)
    }
}
#[cfg(test)]
#[path = "beta_native_user_export_journal_tests.rs"]
mod journal_recovery_tests;
