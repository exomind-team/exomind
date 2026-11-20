//! Bounded offline profile archives. The on-disk format is a versioned,
//! uncompressed frame stream; it has no extraction paths or decompression layer.
use crate::{Authority, BetaHost, GrantKind, HostError, Resources, Session, resources};
use exomind_core::{
    BeginStageCommand, CoreError, MAX_ORIGINAL_CHUNK_BYTES, OriginCursor, OriginIdentity,
    OriginPage, OriginPageProof, OriginPageQuery, OriginProvenanceKey, OriginalAvailability,
    OriginalBytesState, OriginalId, OriginalRef, ProfileArchiveFactMatch,
    ProfileArchiveImportContext, ProfileArchiveOriginalState, ProfileId, ReplicatedFact, StageId,
    StageState,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{self, Read, Seek, SeekFrom, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use uuid::Uuid;

const MAGIC: &[u8; 16] = b"EXOMIND-PROFILE\0";
const FORMAT_VERSION: u16 = 1;
const HEADER_MAX_BYTES: usize = 4096;
const FRAME_PAGE: u8 = 1;
const FRAME_ORIGINAL: u8 = 2;
const FRAME_MANIFEST: u8 = 255;
const MANIFEST_ID: &str = "manifest";
const FRAME_ID_MAX_BYTES: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum ProfileArchiveError {
    #[error(transparent)]
    Host(#[from] HostError),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("profile archive format or entry framing is invalid")]
    InvalidFormat,
    #[error("profile archive version is not supported")]
    UnsupportedVersion,
    #[error("profile archive budget is invalid or exhausted")]
    BudgetExceeded,
    #[error("profile archive preview no longer matches these bytes")]
    PreviewChanged,
    #[error("profile archive contains a fact, source key, or original ID conflict")]
    Conflict,
    #[error("profile archive source identity collides with this local device")]
    LocalIdentityCollision,
    #[error("profile archive operation was cancelled; inspect its partial progress")]
    Cancelled,
    #[error("this profile archive budget is already in use")]
    Busy,
    #[error("archive progress state is unavailable")]
    ProgressUnavailable,
    #[error("source original bytes failed their declared digest")]
    OriginalIntegrityMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveLimits {
    pub max_total_bytes: u64,
    pub max_manifest_bytes: usize,
    pub max_entries: usize,
    pub max_origins: usize,
    pub max_facts: u64,
    pub max_originals: usize,
    pub max_single_original_bytes: u64,
    pub max_page_bytes: usize,
}
impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_total_bytes: 64 * 1024 * 1024 * 1024,
            max_manifest_bytes: 8 * 1024 * 1024,
            max_entries: 100_000,
            max_origins: 4096,
            max_facts: 1_000_000,
            max_originals: 100_000,
            max_single_original_bytes: 64 * 1024 * 1024 * 1024,
            max_page_bytes: exomind_core::MAX_ORIGIN_PAGE_BYTES + 64 * 1024,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileArchivePhase {
    Idle,
    Exporting,
    Previewing,
    Importing,
    Complete,
    Partial,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileArchiveProgress {
    pub phase: ProfileArchivePhase,
    pub bytes_processed: u64,
    pub facts_processed: u64,
    pub original_bytes_processed: u64,
    pub last_origin: Option<OriginIdentity>,
    pub last_cursor: Option<OriginCursor>,
    pub last_original_id: Option<OriginalId>,
    pub last_original_offset: Option<u64>,
}
impl Default for ProfileArchiveProgress {
    fn default() -> Self {
        Self {
            phase: ProfileArchivePhase::Idle,
            bytes_processed: 0,
            facts_processed: 0,
            original_bytes_processed: 0,
            last_origin: None,
            last_cursor: None,
            last_original_id: None,
            last_original_offset: None,
        }
    }
}
struct ArchiveProgressGuard<'a> {
    budget: &'a ArchiveBudget,
    finished: bool,
}
impl<'a> ArchiveProgressGuard<'a> {
    fn new(budget: &'a ArchiveBudget) -> Result<Self, ProfileArchiveError> {
        budget
            .shared
            .active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ProfileArchiveError::Busy)?;
        Ok(Self {
            budget,
            finished: false,
        })
    }
    fn finish(&mut self, phase: ProfileArchivePhase) -> Result<(), ProfileArchiveError> {
        self.budget.phase(phase)?;
        self.finished = true;
        Ok(())
    }
}
impl Drop for ArchiveProgressGuard<'_> {
    fn drop(&mut self) {
        if !self.finished {
            if let Ok(mut progress) = self.budget.shared.progress.lock() {
                progress.phase = ProfileArchivePhase::Partial;
            }
        }
        self.budget.shared.active.store(false, Ordering::Release);
    }
}
struct BudgetShared {
    cancelled: AtomicBool,
    active: AtomicBool,
    progress: Mutex<ProfileArchiveProgress>,
}
/// A single operation's limits and shared cancellation/progress handle.
/// Clones may observe or cancel the operation; concurrent reuse is rejected.
#[derive(Clone)]
pub struct ArchiveBudget {
    limits: ArchiveLimits,
    shared: Arc<BudgetShared>,
}
#[derive(Clone)]
pub struct ArchiveCancelHandle(Arc<BudgetShared>);
impl ArchiveCancelHandle {
    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::Release);
    }
}
impl ArchiveBudget {
    pub fn with_limits(limits: ArchiveLimits) -> Result<Self, ProfileArchiveError> {
        if limits.max_total_bytes == 0
            || limits.max_total_bytes > 64 * 1024 * 1024 * 1024
            || limits.max_manifest_bytes == 0
            || limits.max_manifest_bytes > 8 * 1024 * 1024
            || limits.max_entries == 0
            || limits.max_entries > 100_000
            || limits.max_origins == 0
            || limits.max_origins > 4096
            || limits.max_facts == 0
            || limits.max_facts > 1_000_000
            || limits.max_originals == 0
            || limits.max_originals > 100_000
            || limits.max_single_original_bytes == 0
            || limits.max_single_original_bytes > limits.max_total_bytes
            || limits.max_page_bytes == 0
            || limits.max_page_bytes > exomind_core::MAX_ORIGIN_PAGE_BYTES + 64 * 1024
        {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        Ok(Self {
            limits,
            shared: Arc::new(BudgetShared {
                cancelled: AtomicBool::new(false),
                active: AtomicBool::new(false),
                progress: Mutex::new(ProfileArchiveProgress::default()),
            }),
        })
    }
    pub fn limits(&self) -> &ArchiveLimits {
        &self.limits
    }
    pub fn cancel_handle(&self) -> ArchiveCancelHandle {
        ArchiveCancelHandle(self.shared.clone())
    }
    pub fn progress(&self) -> Result<ProfileArchiveProgress, ProfileArchiveError> {
        self.shared
            .progress
            .lock()
            .map(|value| value.clone())
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)
    }
    fn phase(&self, phase: ProfileArchivePhase) -> Result<(), ProfileArchiveError> {
        self.shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?
            .phase = phase;
        Ok(())
    }
    fn check_cancelled(&self) -> Result<(), ProfileArchiveError> {
        if self.shared.cancelled.load(Ordering::Acquire) {
            self.phase(ProfileArchivePhase::Partial)?;
            return Err(ProfileArchiveError::Cancelled);
        }
        Ok(())
    }
    fn consume(&self, bytes: u64) -> Result<(), ProfileArchiveError> {
        self.check_cancelled()?;
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        let next = progress
            .bytes_processed
            .checked_add(bytes)
            .ok_or(ProfileArchiveError::BudgetExceeded)?;
        if next > self.limits.max_total_bytes {
            progress.phase = ProfileArchivePhase::Partial;
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        progress.bytes_processed = next;
        Ok(())
    }
    fn fact(&self, count: u64) -> Result<(), ProfileArchiveError> {
        self.check_cancelled()?;
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        progress.facts_processed = progress
            .facts_processed
            .checked_add(count)
            .filter(|value| *value <= self.limits.max_facts)
            .ok_or(ProfileArchiveError::BudgetExceeded)?;
        Ok(())
    }
    fn original_bytes(&self, count: u64) -> Result<(), ProfileArchiveError> {
        self.check_cancelled()?;
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        progress.original_bytes_processed = progress
            .original_bytes_processed
            .checked_add(count)
            .filter(|value| *value <= self.limits.max_total_bytes)
            .ok_or(ProfileArchiveError::BudgetExceeded)?;
        Ok(())
    }
    fn original_position(&self, id: OriginalId, offset: u64) -> Result<(), ProfileArchiveError> {
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        progress.last_original_id = Some(id);
        progress.last_original_offset = Some(offset);
        Ok(())
    }
    fn cursor(
        &self,
        origin: OriginIdentity,
        cursor: OriginCursor,
    ) -> Result<(), ProfileArchiveError> {
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        progress.last_origin = Some(origin);
        progress.last_cursor = Some(cursor);
        Ok(())
    }
    fn reset_pass(&self, phase: ProfileArchivePhase) -> Result<(), ProfileArchiveError> {
        let mut progress = self
            .shared
            .progress
            .lock()
            .map_err(|_| ProfileArchiveError::ProgressUnavailable)?;
        progress.phase = phase;
        progress.bytes_processed = 0;
        progress.facts_processed = 0;
        progress.original_bytes_processed = 0;
        progress.last_origin = None;
        progress.last_cursor = None;
        progress.last_original_id = None;
        progress.last_original_offset = None;
        Ok(())
    }
}
impl Default for ArchiveBudget {
    fn default() -> Self {
        Self {
            limits: ArchiveLimits::default(),
            shared: Arc::new(BudgetShared {
                cancelled: AtomicBool::new(false),
                active: AtomicBool::new(false),
                progress: Mutex::new(ProfileArchiveProgress::default()),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchiveConflict {
    pub entry_id: String,
    pub reason: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchiveOriginPreview {
    pub origin: OriginIdentity,
    pub head: OriginCursor,
    pub verified_head: Option<OriginCursor>,
    pub key_fingerprint: Option<String>,
    pub proof_complete: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchiveUnverifiedOrigin {
    pub origin: OriginIdentity,
    pub materialized_head: OriginCursor,
    pub verified_head: Option<OriginCursor>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ArchivePreviewId {
    profile_id: ProfileId,
    request_id: Uuid,
    package_sha256: [u8; 32],
    origin_fingerprint: [u8; 32],
    target_fingerprint: [u8; 32],
    can_import: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchivePreview {
    pub preview_id: ArchivePreviewId,
    pub request_id: Uuid,
    pub package_sha256: String,
    pub origins: Vec<ProfileArchiveOriginPreview>,
    pub profile_id: ProfileId,
    /// Display metadata from the verified container, not a device/author identity claim.
    pub source_display_name: Option<String>,
    pub fact_count: u64,
    pub original_count: usize,
    pub conflicts: Vec<ProfileArchiveConflict>,
    pub missing_originals: Vec<OriginalRef>,
    pub unverified_origins: Vec<ProfileArchiveUnverifiedOrigin>,
    pub facts_complete: bool,
    pub proofs_complete: bool,
    pub bytes_complete: bool,
    pub target_bytes_complete: bool,
    pub can_import: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchiveExportReceipt {
    pub profile_id: ProfileId,
    pub unverified_origins: Vec<ProfileArchiveUnverifiedOrigin>,
    pub request_id: Uuid,
    pub archive_sha256: String,
    pub fact_count: u64,
    pub original_count: usize,
    pub facts_complete: bool,
    pub proofs_complete: bool,
    pub bytes_complete: bool,
    pub missing_originals: Vec<OriginalRef>,
    pub complete: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct ProfileArchiveImportReceipt {
    pub profile_id: ProfileId,
    pub request_id: Uuid,
    pub inserted_facts: u64,
    pub duplicate_facts: u64,
    pub imported_originals: usize,
    pub missing_originals: Vec<OriginalRef>,
    pub facts_complete: bool,
    pub proofs_complete: bool,
    pub bytes_complete: bool,
    pub target_bytes_complete: bool,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveHeader {
    version: u16,
    profile_id: ProfileId,
    request_id: Uuid,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum EntryKind {
    OriginPage,
    Original,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EntryDescriptor {
    kind: EntryKind,
    id: String,
    byte_length: u64,
    sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveOrigin {
    origin: OriginIdentity,
    head: OriginCursor,
    key_fingerprint: Option<String>,
    verified_head: Option<OriginCursor>,
    proof_complete: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveOriginal {
    original: OriginalRef,
    readable_reference: bool,
    bytes_present: bool,
    source_state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveCompleteness {
    facts: bool,
    proofs: bool,
    originals: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveManifest {
    version: u16,
    profile_id: ProfileId,
    request_id: Uuid,
    display_name: String,
    origins: Vec<ArchiveOrigin>,
    originals: Vec<ArchiveOriginal>,
    entries: Vec<EntryDescriptor>,
    fact_count: u64,
    completeness: ArchiveCompleteness,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchivePage {
    page: OriginPage,
    key: Option<OriginProvenanceKey>,
    proof: Option<OriginPageProof>,
}
struct ArchiveOutput<'a, W: Write> {
    sink: &'a mut W,
    budget: &'a ArchiveBudget,
    hasher: Sha256,
}
impl<'a, W: Write> ArchiveOutput<'a, W> {
    fn new(sink: &'a mut W, budget: &'a ArchiveBudget) -> Self {
        Self {
            sink,
            budget,
            hasher: Sha256::new(),
        }
    }
    fn bytes(&mut self, mut bytes: &[u8]) -> Result<(), ProfileArchiveError> {
        while !bytes.is_empty() {
            self.budget.check_cancelled()?;
            let count = self.sink.write(bytes)?;
            if count == 0 {
                return Err(io::Error::from(io::ErrorKind::WriteZero).into());
            }
            self.hasher.update(&bytes[..count]);
            self.budget.consume(count as u64)?;
            bytes = &bytes[count..];
        }
        Ok(())
    }
    fn u8(&mut self, value: u8) -> Result<(), ProfileArchiveError> {
        self.bytes(&[value])
    }
    fn u16(&mut self, value: u16) -> Result<(), ProfileArchiveError> {
        self.bytes(&value.to_le_bytes())
    }
    fn u32(&mut self, value: u32) -> Result<(), ProfileArchiveError> {
        self.bytes(&value.to_le_bytes())
    }
    fn u64(&mut self, value: u64) -> Result<(), ProfileArchiveError> {
        self.bytes(&value.to_le_bytes())
    }
    fn frame_header(&mut self, tag: u8, id: &str, length: u64) -> Result<(), ProfileArchiveError> {
        let id_bytes = id.as_bytes();
        if id_bytes.len() > FRAME_ID_MAX_BYTES {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        self.u8(tag)?;
        self.u16(u16::try_from(id_bytes.len()).map_err(|_| ProfileArchiveError::BudgetExceeded)?)?;
        self.bytes(id_bytes)?;
        self.u64(length)
    }
    fn archive_sha256(&self) -> String {
        format!("{:x}", self.hasher.clone().finalize())
    }
}

struct ArchiveInput<'a, R: Read> {
    source: &'a mut R,
    budget: &'a ArchiveBudget,
    hasher: Sha256,
}
impl<'a, R: Read> ArchiveInput<'a, R> {
    fn new(source: &'a mut R, budget: &'a ArchiveBudget) -> Self {
        Self {
            source,
            budget,
            hasher: Sha256::new(),
        }
    }
    fn exact(&mut self, mut output: &mut [u8]) -> Result<(), ProfileArchiveError> {
        while !output.is_empty() {
            self.budget.check_cancelled()?;
            let count = self.source.read(output)?;
            if count == 0 {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            self.hasher.update(&output[..count]);
            self.budget.consume(count as u64)?;
            output = &mut output[count..];
        }
        Ok(())
    }
    fn u8(&mut self) -> Result<u8, ProfileArchiveError> {
        let mut bytes = [0; 1];
        self.exact(&mut bytes)?;
        Ok(bytes[0])
    }
    fn u16(&mut self) -> Result<u16, ProfileArchiveError> {
        let mut bytes = [0; 2];
        self.exact(&mut bytes)?;
        Ok(u16::from_le_bytes(bytes))
    }
    fn u32(&mut self) -> Result<u32, ProfileArchiveError> {
        let mut bytes = [0; 4];
        self.exact(&mut bytes)?;
        Ok(u32::from_le_bytes(bytes))
    }
    fn u64(&mut self) -> Result<u64, ProfileArchiveError> {
        let mut bytes = [0; 8];
        self.exact(&mut bytes)?;
        Ok(u64::from_le_bytes(bytes))
    }
    fn digest32(&mut self) -> Result<[u8; 32], ProfileArchiveError> {
        let mut bytes = [0; 32];
        self.exact(&mut bytes)?;
        Ok(bytes)
    }
    fn small_vec(&mut self, length: u64, maximum: usize) -> Result<Vec<u8>, ProfileArchiveError> {
        let length = usize::try_from(length).map_err(|_| ProfileArchiveError::BudgetExceeded)?;
        if length > maximum {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        let mut bytes = vec![0; length];
        self.exact(&mut bytes)?;
        Ok(bytes)
    }
    fn archive_sha256(&self) -> String {
        format!("{:x}", self.hasher.clone().finalize())
    }
}

fn digest_bytes(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}
fn hex_bytes(value: &str) -> Result<[u8; 32], ProfileArchiveError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    let mut digest = [0; 32];
    for (index, output) in digest.iter_mut().enumerate() {
        *output = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| ProfileArchiveError::InvalidFormat)?;
    }
    Ok(digest)
}
fn fact_originals(fact: &ReplicatedFact) -> Vec<OriginalRef> {
    match fact {
        ReplicatedFact::Capture(record) => record.originals.clone(),
        ReplicatedFact::SummaryJob(record) => match &record.payload {
            exomind_core::SummaryJobPayload::Execution {
                snapshot: Some(snapshot),
                ..
            } => snapshot
                .materials
                .iter()
                .map(|material| material.original.clone())
                .collect(),
            _ => Vec::new(),
        },
        ReplicatedFact::Summary(record) => record
            .snapshot
            .materials
            .iter()
            .map(|material| material.original.clone())
            .collect(),
        ReplicatedFact::AgentSummary(record) => record.snapshot.materials.clone(),
        ReplicatedFact::Timeblock(_)
        | ReplicatedFact::Correction(_)
        | ReplicatedFact::OriginalLifecycle(_) => Vec::new(),
    }
}
fn origin_key(origin: &OriginIdentity) -> String {
    format!(
        "{}/{}/{}",
        origin.profile_id, origin.device_id, origin.restoration_epoch
    )
}
fn page_entry_id(page: &OriginPage) -> String {
    let first = if page.entries.is_empty() {
        0
    } else {
        page.from.seq.saturating_add(1)
    };
    format!(
        "origins/{}/{}/pages/{}-{}",
        page.origin.device_id, page.origin.restoration_epoch, first, page.to.seq
    )
}
fn original_entry_id(original: OriginalId) -> String {
    format!("originals/{original}.bin")
}
fn parse_original_entry_id(id: &str) -> Result<OriginalId, ProfileArchiveError> {
    id.strip_prefix("originals/")
        .and_then(|value| value.strip_suffix(".bin"))
        .ok_or(ProfileArchiveError::InvalidFormat)?
        .parse()
        .map_err(|_| ProfileArchiveError::InvalidFormat)
}

trait ArchiveVisitor {
    fn header(&mut self, header: &ArchiveHeader) -> Result<(), ProfileArchiveError>;
    fn page(&mut self, entry_id: &str, page: &ArchivePage) -> Result<(), ProfileArchiveError>;
    fn original_begin(
        &mut self,
        entry_id: &str,
        original: &OriginalRef,
        length: u64,
    ) -> Result<(), ProfileArchiveError>;
    fn original_chunk(
        &mut self,
        entry_id: &str,
        original: &OriginalRef,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), ProfileArchiveError>;
    fn original_end(
        &mut self,
        entry_id: &str,
        original: &OriginalRef,
        digest: &str,
    ) -> Result<(), ProfileArchiveError>;
}

#[derive(Default)]
struct OriginScanState {
    last: Option<OriginCursor>,
    proof_last: Option<OriginCursor>,
    saw_unverified: bool,
    key_fingerprint: Option<String>,
}
struct ScanResult {
    header: ArchiveHeader,
    manifest: ArchiveManifest,
    package_sha256: String,
}

fn scan_archive<R, V>(
    source: &mut R,
    budget: &ArchiveBudget,
    visitor: &mut V,
) -> Result<ScanResult, ProfileArchiveError>
where
    R: Read,
    V: ArchiveVisitor,
{
    let mut input = ArchiveInput::new(source, budget);
    let mut magic = [0; 16];
    input.exact(&mut magic)?;
    if &magic != MAGIC {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    let version = input.u16()?;
    if version != FORMAT_VERSION {
        return Err(ProfileArchiveError::UnsupportedVersion);
    }
    let header_length = input.u32()? as usize;
    if header_length == 0 || header_length > HEADER_MAX_BYTES {
        return Err(ProfileArchiveError::BudgetExceeded);
    }
    let header: ArchiveHeader =
        serde_json::from_slice(&input.small_vec(header_length as u64, HEADER_MAX_BYTES)?)?;
    if header.version != FORMAT_VERSION || header.request_id.is_nil() {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    visitor.header(&header)?;

    let mut entries = Vec::<EntryDescriptor>::new();
    let mut entry_ids = HashSet::<String>::new();
    let mut references = BTreeMap::<String, OriginalRef>::new();
    let mut readable_references = HashSet::<OriginalId>::new();
    let mut present_originals = HashSet::<OriginalId>::new();
    let mut origin_pages = HashMap::<String, OriginScanState>::new();
    let mut facts = 0u64;
    let mut originals_started = false;
    let manifest = loop {
        budget.check_cancelled()?;
        let tag = input.u8()?;
        let id_length = input.u16()? as usize;
        if id_length > FRAME_ID_MAX_BYTES {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        let id = String::from_utf8(input.small_vec(id_length as u64, FRAME_ID_MAX_BYTES)?)
            .map_err(|_| ProfileArchiveError::InvalidFormat)?;
        let length = input.u64()?;
        if tag == FRAME_MANIFEST {
            if id != MANIFEST_ID || length == 0 || length > budget.limits.max_manifest_bytes as u64
            {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            let payload = input.small_vec(length, budget.limits.max_manifest_bytes)?;
            let received = input.digest32()?;
            if digest_bytes(&payload) != received {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            let manifest: ArchiveManifest = serde_json::from_slice(&payload)?;
            let mut trailing = [0; 1];
            if input.source.read(&mut trailing)? != 0 {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            break manifest;
        }
        if entries.len() >= budget.limits.max_entries || !entry_ids.insert(id.clone()) {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        match tag {
            FRAME_PAGE => {
                if originals_started || length > budget.limits.max_page_bytes as u64 {
                    return Err(ProfileArchiveError::InvalidFormat);
                }
                let payload = input.small_vec(length, budget.limits.max_page_bytes)?;
                let received = input.digest32()?;
                if digest_bytes(&payload) != received {
                    return Err(ProfileArchiveError::InvalidFormat);
                }
                let page: ArchivePage = serde_json::from_slice(&payload)?;
                if page.page.origin.profile_id != header.profile_id
                    || page.key.is_some() != page.proof.is_some()
                    || page_entry_id(&page.page) != id
                {
                    return Err(ProfileArchiveError::InvalidFormat);
                }
                for entry in &page.page.entries {
                    facts = facts
                        .checked_add(1)
                        .filter(|value| *value <= budget.limits.max_facts)
                        .ok_or(ProfileArchiveError::BudgetExceeded)?;
                    budget.fact(1)?;
                    for original in fact_originals(&entry.fact) {
                        match references.get(&original.original_id.to_string()) {
                            Some(existing) if existing != &original => {
                                return Err(ProfileArchiveError::Conflict);
                            }
                            Some(_) => {}
                            None => {
                                if references.len() >= budget.limits.max_originals {
                                    return Err(ProfileArchiveError::BudgetExceeded);
                                }
                                references
                                    .insert(original.original_id.to_string(), original.clone());
                            }
                        }
                        readable_references.insert(original.original_id);
                    }
                }
                let key = origin_key(&page.page.origin);
                if !origin_pages.contains_key(&key)
                    && origin_pages.len() >= budget.limits.max_origins
                {
                    return Err(ProfileArchiveError::BudgetExceeded);
                }
                let state = origin_pages.entry(key).or_default();
                match &state.last {
                    None if page.page.from.seq != 0 => {
                        return Err(ProfileArchiveError::InvalidFormat);
                    }
                    Some(last) if *last != page.page.from => {
                        return Err(ProfileArchiveError::InvalidFormat);
                    }
                    _ => {}
                }
                if page.proof.is_some() {
                    if state.saw_unverified {
                        return Err(ProfileArchiveError::InvalidFormat);
                    }
                    match &state.proof_last {
                        None if page.page.from.seq != 0 => {
                            return Err(ProfileArchiveError::InvalidFormat);
                        }
                        Some(last) if *last != page.page.from => {
                            return Err(ProfileArchiveError::InvalidFormat);
                        }
                        _ => {}
                    }
                    let fingerprint = page.key.as_ref().map(|key| key.fingerprint_sha256.clone());
                    if state
                        .key_fingerprint
                        .as_ref()
                        .is_some_and(|old| Some(old) != fingerprint.as_ref())
                    {
                        return Err(ProfileArchiveError::InvalidFormat);
                    }
                    state.proof_last = Some(page.page.to.clone());
                    state.key_fingerprint = fingerprint;
                } else {
                    state.saw_unverified = true;
                }
                state.last = Some(page.page.to.clone());
                visitor.page(&id, &page)?;
                entries.push(EntryDescriptor {
                    kind: EntryKind::OriginPage,
                    id,
                    byte_length: length,
                    sha256: encode_hex(&received),
                });
            }
            FRAME_ORIGINAL => {
                originals_started = true;
                if length > budget.limits.max_single_original_bytes {
                    return Err(ProfileArchiveError::BudgetExceeded);
                }
                let original_id = parse_original_entry_id(&id)?;
                let original = references
                    .get(&original_id.to_string())
                    .ok_or(ProfileArchiveError::InvalidFormat)?
                    .clone();
                if !readable_references.contains(&original_id) {
                    return Err(ProfileArchiveError::InvalidFormat);
                }
                if original.byte_length != length || !present_originals.insert(original_id) {
                    return Err(ProfileArchiveError::InvalidFormat);
                }
                budget.original_position(original_id, 0)?;
                visitor.original_begin(&id, &original, length)?;
                let mut hasher = Sha256::new();
                let mut offset = 0u64;
                let mut buffer = vec![0u8; MAX_ORIGINAL_CHUNK_BYTES];
                while offset < length {
                    let count = usize::try_from((length - offset).min(buffer.len() as u64))
                        .map_err(|_| ProfileArchiveError::BudgetExceeded)?;
                    input.exact(&mut buffer[..count])?;
                    hasher.update(&buffer[..count]);
                    visitor.original_chunk(&id, &original, offset, &buffer[..count])?;
                    budget.original_bytes(count as u64)?;
                    offset += count as u64;
                    budget.original_position(original_id, offset)?;
                }
                let received = input.digest32()?;
                let actual: [u8; 32] = hasher.finalize().into();
                let actual_hex = encode_hex(&actual);
                if actual != received || actual_hex != original.sha256 {
                    return Err(ProfileArchiveError::OriginalIntegrityMismatch);
                }
                visitor.original_end(&id, &original, &actual_hex)?;
                budget.original_position(original_id, length)?;
                entries.push(EntryDescriptor {
                    kind: EntryKind::Original,
                    id,
                    byte_length: length,
                    sha256: actual_hex,
                });
            }
            _ => return Err(ProfileArchiveError::InvalidFormat),
        }
    };

    if manifest.version != FORMAT_VERSION
        || manifest.profile_id != header.profile_id
        || manifest.request_id != header.request_id
        || manifest.entries != entries
        || manifest.fact_count != facts
        || manifest.entries.len() > budget.limits.max_entries
        || manifest.origins.len() > budget.limits.max_origins
        || manifest.originals.len() != references.len()
    {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    let mut manifest_origins = HashSet::new();
    let mut proofs_complete = true;
    for origin in &manifest.origins {
        let key = origin_key(&origin.origin);
        if !manifest_origins.insert(key.clone()) {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        let state = origin_pages
            .get(&key)
            .ok_or(ProfileArchiveError::InvalidFormat)?;
        if origin.origin.restoration_epoch.is_nil()
            || origin.head.seq > i64::MAX as u64
            || origin.head.hash.len() != 64
            || !origin
                .head
                .hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        if state.last.as_ref() != Some(&origin.head) {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        let verified = state.proof_last.clone();
        let fingerprint = state.key_fingerprint.clone();
        if verified != origin.verified_head
            || fingerprint != origin.key_fingerprint
            || origin.proof_complete
                != (origin.head.seq == 0 || origin.verified_head.as_ref() == Some(&origin.head))
        {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        proofs_complete &= origin.proof_complete;
    }
    if origin_pages
        .keys()
        .any(|key| !manifest_origins.contains(key))
    {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    let mut manifest_originals = HashSet::new();
    let mut source_bytes_complete = true;
    for item in &manifest.originals {
        let id = item.original.original_id;
        if !manifest_originals.insert(id) || references.get(&id.to_string()) != Some(&item.original)
        {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        if item.readable_reference != readable_references.contains(&id)
            || !matches!(
                item.source_state.as_str(),
                "available"
                    | "reclaimed"
                    | "released"
                    | "purged"
                    | "restorepending"
                    | "missing"
                    | "metadata_only"
            )
            || item.bytes_present
                && (!item.readable_reference
                    || !matches!(item.source_state.as_str(), "available" | "reclaimed"))
        {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        if item.bytes_present != present_originals.contains(&id) {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        if item.bytes_present && !item.readable_reference {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        source_bytes_complete &= item.bytes_present && item.readable_reference;
    }
    if manifest_originals.len() != references.len()
        || !manifest.completeness.facts
        || manifest.completeness.proofs != proofs_complete
        || manifest.completeness.originals != source_bytes_complete
    {
        return Err(ProfileArchiveError::InvalidFormat);
    }
    Ok(ScanResult {
        header,
        manifest,
        package_sha256: input.archive_sha256(),
    })
}

impl BetaHost {
    fn with_archive_read<T>(
        &self,
        session: &Session,
        profile: ProfileId,
        action: impl FnOnce(&Resources, &exomind_core::WriterContext) -> Result<T, ProfileArchiveError>,
    ) -> Result<T, ProfileArchiveError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        match session.authority {
            Authority::Owner => self.owner(session)?,
            Authority::Grant(_) => {
                self.profile_authority(resources, session, profile, false)?;
            }
        }
        let human = resources.core.local_human(profile)?;
        action(resources, &human)
    }

    fn authorize_archive_import_role(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<(), ProfileArchiveError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        match session.authority {
            Authority::Owner => self.owner(session)?,
            Authority::Grant(_) => {
                let authority = self.profile_authority(resources, session, profile, true)?;
                if authority.kind != GrantKind::Human {
                    return Err(HostError::Forbidden.into());
                }
            }
        }
        Ok(())
    }

    fn with_archive_preview<T>(
        &self,
        session: &Session,
        profile: ProfileId,
        action: impl FnOnce(
            &Resources,
            Option<&exomind_core::WriterContext>,
        ) -> Result<T, ProfileArchiveError>,
    ) -> Result<T, ProfileArchiveError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        match session.authority {
            Authority::Owner => self.owner(session)?,
            Authority::Grant(_) => {
                let authority = self.profile_authority(resources, session, profile, true)?;
                if authority.kind != GrantKind::Human {
                    return Err(HostError::Forbidden.into());
                }
            }
        }
        let exists = resources
            .core
            .profiles()?
            .iter()
            .any(|item| item.profile_id == profile);
        let human = if exists {
            Some(resources.core.local_human(profile)?)
        } else {
            None
        };
        action(resources, human.as_ref())
    }
    fn preauthorize_archive_import(
        &self,
        session: &Session,
    ) -> Result<Option<ProfileId>, ProfileArchiveError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        if session.runtime_id != self.runtime_id {
            return Err(HostError::Unauthorized.into());
        }
        match session.authority {
            Authority::Owner => {
                self.owner(session)?;
                Ok(None)
            }
            Authority::Grant(id) => {
                let row: Option<(String, String)> = resources
                    .persistence
                    .auth
                    .query_row(
                        "SELECT profile_id,kind FROM grants WHERE id=?1 AND revoked=0",
                        [id.to_string()],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                let (profile, kind) = row.ok_or(HostError::Unauthorized)?;
                if kind != "human" {
                    return Err(HostError::Forbidden.into());
                }
                Ok(Some(
                    profile
                        .parse()
                        .map_err(|_| HostError::CredentialsUnavailable)?,
                ))
            }
        }
    }

    fn with_archive_import<T>(
        &self,
        session: &Session,
        profile: ProfileId,
        action: impl FnOnce(
            &Resources,
            &exomind_core::WriterContext,
            &ProfileArchiveImportContext,
        ) -> Result<T, ProfileArchiveError>,
    ) -> Result<T, ProfileArchiveError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        match session.authority {
            Authority::Owner => self.owner(session)?,
            Authority::Grant(_) => {
                let authority = self.profile_authority(resources, session, profile, true)?;
                if authority.kind != GrantKind::Human {
                    return Err(HostError::Forbidden.into());
                }
            }
        }
        let human = resources.core.local_human(profile)?;
        let context = resources
            .core
            .profile_archive_import_context(&human, profile)?;
        action(resources, &human, &context)
    }

    fn read_archive_page(
        &self,
        session: &Session,
        profile: ProfileId,
        origin: &OriginIdentity,
        query: &OriginPageQuery,
    ) -> Result<ArchivePage, ProfileArchiveError> {
        self.with_archive_read(session, profile, |resources, reader| {
            let page = resources
                .core
                .export_known_origin_page(reader, origin, query)?;
            let (key, proof) = if page.origin.device_id == resources.core.device_id() {
                match resources.peer_identity.as_deref() {
                    Some(identity) => {
                        let (signed_page, key, proof) = crate::peers::sign_archive_origin_page(
                            identity,
                            &resources.core,
                            profile,
                            query,
                        )?;
                        if serde_json::to_vec(&signed_page)? != serde_json::to_vec(&page)? {
                            return Err(ProfileArchiveError::InvalidFormat);
                        }
                        (Some(key), Some(proof))
                    }
                    None => (None, None),
                }
            } else {
                match resources.core.origin_page_proof(reader, &page) {
                    Ok((key, proof)) => (Some(key), Some(proof)),
                    Err(CoreError::InvalidReplication(
                        "source proofs unavailable" | "source proofs incomplete",
                    )) => (None, None),
                    Err(error) => return Err(error.into()),
                }
            };
            Ok(ArchivePage { page, key, proof })
        })
    }

    /// Stream a complete one-profile fact snapshot and its currently readable
    /// verified originals. The caller owns the output file and must publish it
    /// only when this method returns a complete receipt.
    pub fn export_profile_archive<W: Write>(
        &self,
        session: &Session,
        profile: ProfileId,
        output: &mut W,
        budget: ArchiveBudget,
    ) -> Result<ProfileArchiveExportReceipt, ProfileArchiveError> {
        let mut progress_guard = ArchiveProgressGuard::new(&budget)?;
        ArchiveBudget::with_limits(budget.limits.clone())?;
        budget.reset_pass(ProfileArchivePhase::Exporting)?;
        let (display_name, device, inventory) =
            self.with_archive_read(session, profile, |resources, reader| {
                let info = resources
                    .core
                    .profiles()?
                    .into_iter()
                    .find(|item| item.profile_id == profile)
                    .ok_or(CoreError::UnknownProfile)?;
                let inventory =
                    resources
                        .core
                        .origin_inventory(reader, profile, budget.limits.max_origins)?;
                Ok((info.display_name, resources.core.device_id(), inventory))
            })?;
        if inventory.len() > budget.limits.max_origins {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        let request_id = Uuid::new_v4();
        let header = ArchiveHeader {
            version: FORMAT_VERSION,
            profile_id: profile,
            request_id,
        };
        let header_bytes = serde_json::to_vec(&header)?;
        if header_bytes.len() > HEADER_MAX_BYTES {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        let mut output = ArchiveOutput::new(output, &budget);
        output.bytes(MAGIC)?;
        output.u16(FORMAT_VERSION)?;
        output.u32(
            u32::try_from(header_bytes.len()).map_err(|_| ProfileArchiveError::BudgetExceeded)?,
        )?;
        output.bytes(&header_bytes)?;

        let mut entries = Vec::new();
        let mut origins = Vec::with_capacity(inventory.len());
        let mut references = BTreeMap::<String, OriginalRef>::new();
        let mut readable_references = HashSet::<OriginalId>::new();
        let mut fact_count = 0u64;
        let mut proofs_complete = true;
        for snapshot in &inventory {
            let local_signing_available = if snapshot.origin.device_id == device {
                self.with_archive_read(session, profile, |resources, _| {
                    Ok(resources.peer_identity.is_some())
                })?
            } else {
                false
            };
            let proof_limit = if snapshot.origin.device_id == device {
                local_signing_available.then(|| snapshot.head.clone())
            } else {
                snapshot.verified_head.clone()
            };
            let mut origin_manifest = ArchiveOrigin {
                origin: snapshot.origin.clone(),
                head: snapshot.head.clone(),
                key_fingerprint: None,
                verified_head: None,
                proof_complete: false,
            };
            let mut after = None;
            let mut emitted = false;
            loop {
                budget.check_cancelled()?;
                let after_seq = after.as_ref().map_or(0, |cursor: &OriginCursor| cursor.seq);
                let through = match &proof_limit {
                    Some(cursor) if cursor.seq > after_seq => cursor.clone(),
                    _ => snapshot.head.clone(),
                };
                if emitted && after_seq == snapshot.head.seq {
                    break;
                }
                if emitted && through.seq == after_seq && after_seq == snapshot.head.seq {
                    break;
                }
                let query = OriginPageQuery {
                    after: after.clone(),
                    through: Some(through.clone()),
                    limit: 100,
                    max_bytes: exomind_core::MAX_ORIGIN_PAGE_BYTES,
                };
                let record = self.read_archive_page(session, profile, &snapshot.origin, &query)?;
                let id = page_entry_id(&record.page);
                let payload = serde_json::to_vec(&record)?;
                if payload.len() > budget.limits.max_page_bytes {
                    return Err(ProfileArchiveError::BudgetExceeded);
                }
                let digest = digest_bytes(&payload);
                output.frame_header(FRAME_PAGE, &id, payload.len() as u64)?;
                output.bytes(&payload)?;
                output.bytes(&digest)?;
                entries.push(EntryDescriptor {
                    kind: EntryKind::OriginPage,
                    id,
                    byte_length: payload.len() as u64,
                    sha256: encode_hex(&digest),
                });
                if entries.len() > budget.limits.max_entries {
                    return Err(ProfileArchiveError::BudgetExceeded);
                }
                for item in &record.page.entries {
                    fact_count = fact_count
                        .checked_add(1)
                        .filter(|n| *n <= budget.limits.max_facts)
                        .ok_or(ProfileArchiveError::BudgetExceeded)?;
                    budget.fact(1)?;
                    let readable = matches!(&item.fact, ReplicatedFact::Capture(_));
                    for original in fact_originals(&item.fact) {
                        match references.get(&original.original_id.to_string()) {
                            Some(existing) if existing != &original => {
                                return Err(ProfileArchiveError::Conflict);
                            }
                            Some(_) => {}
                            None => {
                                if references.len() >= budget.limits.max_originals {
                                    return Err(ProfileArchiveError::BudgetExceeded);
                                }
                                references
                                    .insert(original.original_id.to_string(), original.clone());
                            }
                        }
                        if readable {
                            readable_references.insert(original.original_id);
                        }
                    }
                }
                if let Some(key) = &record.key {
                    if origin_manifest
                        .key_fingerprint
                        .as_ref()
                        .is_some_and(|old| old != &key.fingerprint_sha256)
                    {
                        return Err(ProfileArchiveError::Conflict);
                    }
                    origin_manifest.key_fingerprint = Some(key.fingerprint_sha256.clone());
                    origin_manifest.verified_head = Some(record.page.to.clone());
                } else {
                    if !record.page.entries.is_empty() || record.page.to.seq > 0 {
                        proofs_complete = false;
                    }
                }
                budget.cursor(record.page.origin.clone(), record.page.to.clone())?;
                let reached = record.page.to == record.page.through;
                let reached_head = record.page.to == snapshot.head;
                after = Some(record.page.to.clone());
                emitted = true;
                if reached_head {
                    break;
                }
                if !record.page.has_more && reached {
                    // A signed prefix can end before the materialized head.
                    continue;
                }
                if !record.page.has_more && record.page.to != snapshot.head {
                    continue;
                }
                if record.page.entries.is_empty() && record.page.to == record.page.through {
                    if record.page.to == snapshot.head {
                        break;
                    }
                    continue;
                }
            }
            origin_manifest.proof_complete = origin_manifest.head.seq == 0
                || origin_manifest.verified_head.as_ref() == Some(&origin_manifest.head);
            proofs_complete &= origin_manifest.proof_complete;
            origins.push(origin_manifest);
        }

        let mut originals = Vec::with_capacity(references.len());
        let mut missing_originals = Vec::new();
        let mut bytes_complete = true;
        for original in references.values() {
            budget.check_cancelled()?;
            let readable = readable_references.contains(&original.original_id);
            let state = self.with_archive_read(session, profile, |resources, reader| {
                resources
                    .core
                    .profile_archive_original_state(reader, profile, original.original_id)
                    .map_err(Into::into)
            })?;
            if state
                .manifest
                .as_ref()
                .is_some_and(|stored| stored != original)
            {
                return Err(ProfileArchiveError::Conflict);
            }
            if readable && (state.manifest.as_ref() != Some(original) || state.private_stage) {
                return Err(ProfileArchiveError::Conflict);
            }
            let source_state = if !readable {
                "metadata_only".to_owned()
            } else {
                state
                    .bytes_state
                    .map(|value| format!("{value:?}").to_ascii_lowercase())
                    .unwrap_or_else(|| "missing".into())
            };
            let present = readable
                && matches!(
                    state.bytes_state,
                    Some(OriginalBytesState::Available | OriginalBytesState::Reclaimed)
                );
            if present {
                let permit = self.begin_original_read(session, profile, original.original_id)?;
                output.frame_header(
                    FRAME_ORIGINAL,
                    &original_entry_id(original.original_id),
                    original.byte_length,
                )?;
                let mut offset = 0u64;
                let mut hasher = Sha256::new();
                budget.original_position(original.original_id, offset)?;
                while offset < original.byte_length {
                    budget.check_cancelled()?;
                    let length = usize::try_from(
                        (original.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64),
                    )
                    .map_err(|_| ProfileArchiveError::BudgetExceeded)?;
                    let chunk =
                        self.read_original_range_with_permit(session, &permit, offset, length)?;
                    if chunk.offset != offset
                        || chunk.original != *original
                        || chunk.bytes.len() != length
                    {
                        return Err(ProfileArchiveError::OriginalIntegrityMismatch);
                    }
                    hasher.update(&chunk.bytes);
                    output.bytes(&chunk.bytes)?;
                    budget.original_bytes(length as u64)?;
                    offset += length as u64;
                    budget.original_position(original.original_id, offset)?;
                }
                let digest: [u8; 32] = hasher.finalize().into();
                let actual = encode_hex(&digest);
                if actual != original.sha256 {
                    return Err(ProfileArchiveError::OriginalIntegrityMismatch);
                }
                output.bytes(&digest)?;
                self.finish_original_read(session, &permit)?;
                entries.push(EntryDescriptor {
                    kind: EntryKind::Original,
                    id: original_entry_id(original.original_id),
                    byte_length: original.byte_length,
                    sha256: actual,
                });
            } else {
                bytes_complete = false;
                missing_originals.push(original.clone());
            }
            originals.push(ArchiveOriginal {
                original: original.clone(),
                readable_reference: readable,
                bytes_present: present,
                source_state,
            });
            if entries.len() > budget.limits.max_entries {
                return Err(ProfileArchiveError::BudgetExceeded);
            }
        }
        let manifest = ArchiveManifest {
            version: FORMAT_VERSION,
            profile_id: profile,
            request_id,
            display_name,
            origins,
            originals,
            entries,
            fact_count,
            completeness: ArchiveCompleteness {
                facts: true,
                proofs: proofs_complete,
                originals: bytes_complete,
            },
        };
        let manifest_bytes = serde_json::to_vec(&manifest)?;
        if manifest_bytes.len() > budget.limits.max_manifest_bytes {
            return Err(ProfileArchiveError::BudgetExceeded);
        }
        let manifest_sha = digest_bytes(&manifest_bytes);
        output.frame_header(FRAME_MANIFEST, MANIFEST_ID, manifest_bytes.len() as u64)?;
        output.bytes(&manifest_bytes)?;
        output.bytes(&manifest_sha)?;
        output.sink.flush()?;
        let receipt = ProfileArchiveExportReceipt {
            profile_id: profile,
            request_id,
            archive_sha256: output.archive_sha256(),
            unverified_origins: manifest
                .origins
                .iter()
                .filter(|origin| !origin.proof_complete)
                .map(|origin| ProfileArchiveUnverifiedOrigin {
                    origin: origin.origin.clone(),
                    materialized_head: origin.head.clone(),
                    verified_head: origin.verified_head.clone(),
                })
                .collect(),
            fact_count,
            original_count: references.len(),
            facts_complete: true,
            proofs_complete,
            bytes_complete,
            missing_originals,
            complete: proofs_complete && bytes_complete,
        };
        progress_guard.finish(if receipt.complete {
            ProfileArchivePhase::Complete
        } else {
            ProfileArchivePhase::Partial
        })?;
        Ok(receipt)
    }
}
struct PreviewVisitor<'a> {
    host: &'a BetaHost,
    session: &'a Session,
    budget: &'a ArchiveBudget,
    profile: Option<ProfileId>,
    conflicts: Vec<ProfileArchiveConflict>,
    duplicate_facts: u64,
    new_facts: u64,
}
impl ArchiveVisitor for PreviewVisitor<'_> {
    fn header(&mut self, header: &ArchiveHeader) -> Result<(), ProfileArchiveError> {
        self.host
            .authorize_archive_import_role(self.session, header.profile_id)?;
        self.profile = Some(header.profile_id);
        Ok(())
    }
    fn page(
        &mut self,
        entry_id: &str,
        archive_page: &ArchivePage,
    ) -> Result<(), ProfileArchiveError> {
        let profile = self.profile.ok_or(ProfileArchiveError::InvalidFormat)?;
        let page = &archive_page.page;
        let (conflicts, new_facts, duplicate_facts) =
            self.host
                .with_archive_preview(self.session, profile, |resources, reader| {
                    resources
                        .core
                        .validate_profile_archive_page(profile, page)?;
                    let mut found = Vec::new();
                    let mut new_facts = 0u64;
                    let mut duplicate_facts = 0u64;
                    if page.origin.device_id == resources.core.device_id()
                        && !resources.core.profile_archive_local_page_duplicate(page)?
                    {
                        found.push(ProfileArchiveConflict {
                            entry_id: entry_id.to_owned(),
                            reason: "local_device_identity",
                        });
                    }
                    if let (Some(key), Some(proof)) = (&archive_page.key, &archive_page.proof) {
                        crate::peers::verify_archive_origin_page(page, key, proof)?;
                        if let Some(stored) = reader
                            .map(|reader| {
                                resources.core.origin_provenance_key(
                                    reader,
                                    profile,
                                    page.origin.device_id,
                                )
                            })
                            .transpose()?
                            .flatten()
                        {
                            if stored != *key {
                                found.push(ProfileArchiveConflict {
                                    entry_id: entry_id.to_owned(),
                                    reason: "source_key_conflict",
                                });
                            }
                        }
                    } else if reader
                        .map(|reader| {
                            resources.core.origin_provenance_key(
                                reader,
                                profile,
                                page.origin.device_id,
                            )
                        })
                        .transpose()?
                        .flatten()
                        .is_some()
                    {
                        for entry in &page.entries {
                            if resources.core.profile_archive_fact_match(
                                reader.ok_or(ProfileArchiveError::InvalidFormat)?,
                                profile,
                                &entry.fact,
                            )? != ProfileArchiveFactMatch::Identical
                            {
                                found.push(ProfileArchiveConflict {
                                    entry_id: entry.fact.event_id().to_string(),
                                    reason: "proof_required_for_pinned_origin",
                                });
                            }
                        }
                    }
                    for entry in &page.entries {
                        let matched = match reader {
                            Some(reader) => resources.core.profile_archive_fact_match(
                                reader,
                                profile,
                                &entry.fact,
                            )?,
                            None => ProfileArchiveFactMatch::New,
                        };
                        match matched {
                            ProfileArchiveFactMatch::New => new_facts = new_facts.saturating_add(1),
                            ProfileArchiveFactMatch::Identical => {
                                duplicate_facts = duplicate_facts.saturating_add(1)
                            }
                            ProfileArchiveFactMatch::Conflict => {
                                found.push(ProfileArchiveConflict {
                                    entry_id: entry.fact.event_id().to_string(),
                                    reason: "event_id_content_conflict",
                                })
                            }
                        }
                    }
                    Ok((found, new_facts, duplicate_facts))
                })?;
        self.new_facts = self.new_facts.saturating_add(new_facts);
        self.duplicate_facts = self.duplicate_facts.saturating_add(duplicate_facts);
        self.conflicts.extend(
            conflicts
                .into_iter()
                .take(1024usize.saturating_sub(self.conflicts.len())),
        );
        self.budget.cursor(page.origin.clone(), page.to.clone())?;
        Ok(())
    }
    fn original_begin(
        &mut self,
        _entry_id: &str,
        _original: &OriginalRef,
        _length: u64,
    ) -> Result<(), ProfileArchiveError> {
        Ok(())
    }
    fn original_chunk(
        &mut self,
        _entry_id: &str,
        _original: &OriginalRef,
        _offset: u64,
        _bytes: &[u8],
    ) -> Result<(), ProfileArchiveError> {
        Ok(())
    }
    fn original_end(
        &mut self,
        _entry_id: &str,
        _original: &OriginalRef,
        _digest: &str,
    ) -> Result<(), ProfileArchiveError> {
        Ok(())
    }
}

impl BetaHost {
    fn preview_from_scan(
        &self,
        session: &Session,
        scan: &ScanResult,
        visitor: PreviewVisitor<'_>,
    ) -> Result<ProfileArchivePreview, ProfileArchiveError> {
        let profile = scan.header.profile_id;
        self.authorize_archive_import_role(session, profile)?;
        let mut conflicts = visitor.conflicts;
        let mut missing_originals = Vec::new();
        let mut target_bytes_complete = true;
        for item in &scan.manifest.originals {
            self.authorize_archive_import_role(session, profile)?;
            let local =
                self.with_archive_preview(session, profile, |resources, reader| match reader {
                    Some(reader) => resources
                        .core
                        .profile_archive_original_state(reader, profile, item.original.original_id)
                        .map_err(Into::into),
                    None => Ok(ProfileArchiveOriginalState::default()),
                });
            let local = match local {
                Ok(value) => value,
                Err(ProfileArchiveError::Core(CoreError::OriginalConflict)) => {
                    conflicts.push(ProfileArchiveConflict {
                        entry_id: item.original.original_id.to_string(),
                        reason: "original_id_profile_conflict",
                    });
                    target_bytes_complete = false;
                    continue;
                }
                Err(error) => return Err(error),
            };
            if local.private_stage {
                conflicts.push(ProfileArchiveConflict {
                    entry_id: item.original.original_id.to_string(),
                    reason: "private_stage_conflict",
                });
            }
            if let Some(manifest) = &local.manifest {
                if manifest != &item.original {
                    conflicts.push(ProfileArchiveConflict {
                        entry_id: item.original.original_id.to_string(),
                        reason: "original_id_content_conflict",
                    });
                }
            }
            let local_ready = matches!(
                local.bytes_state,
                Some(OriginalBytesState::Available | OriginalBytesState::Reclaimed)
            );
            let locally_released = matches!(
                local.bytes_state,
                Some(OriginalBytesState::Released | OriginalBytesState::Purged)
            );
            let can_materialize = item.bytes_present
                && !locally_released
                && !local.private_stage
                && (local.manifest.is_none() || local.manifest.as_ref() == Some(&item.original));
            if !local_ready && !can_materialize {
                missing_originals.push(item.original.clone());
                target_bytes_complete = false;
            }
        }
        let can_import = conflicts.is_empty();
        let target_device = self.device_id;
        let target_state = serde_json::to_vec(&(
            self.runtime_id,
            target_device,
            visitor.new_facts,
            visitor.duplicate_facts,
            &conflicts,
            &missing_originals,
        ))?;
        let target_fingerprint = digest_bytes(&target_state);
        let package_sha256_bytes = hex_bytes(&scan.package_sha256)?;
        let origin_fingerprint = digest_bytes(&serde_json::to_vec(&scan.manifest.origins)?);
        let package_sha256 = scan.package_sha256.clone();
        let origins = scan
            .manifest
            .origins
            .iter()
            .map(|origin| ProfileArchiveOriginPreview {
                origin: origin.origin.clone(),
                head: origin.head.clone(),
                verified_head: origin.verified_head.clone(),
                key_fingerprint: origin.key_fingerprint.clone(),
                proof_complete: origin.proof_complete,
            })
            .collect::<Vec<_>>();
        let preview_id = ArchivePreviewId {
            profile_id: profile,
            request_id: scan.header.request_id,
            package_sha256: package_sha256_bytes,
            origin_fingerprint,
            target_fingerprint,
            can_import,
        };
        let unverified_origins = scan
            .manifest
            .origins
            .iter()
            .filter(|origin| !origin.proof_complete)
            .map(|origin| ProfileArchiveUnverifiedOrigin {
                origin: origin.origin.clone(),
                materialized_head: origin.head.clone(),
                verified_head: origin.verified_head.clone(),
            })
            .collect::<Vec<_>>();
        Ok(ProfileArchivePreview {
            preview_id,
            request_id: scan.header.request_id,
            package_sha256,
            origins,
            profile_id: profile,
            source_display_name: (!scan.manifest.display_name.trim().is_empty()
                && scan.manifest.display_name.len() <= 4096)
                .then(|| scan.manifest.display_name.clone()),
            fact_count: scan.manifest.fact_count,
            original_count: scan.manifest.originals.len(),
            conflicts,
            missing_originals,
            unverified_origins,
            facts_complete: scan.manifest.completeness.facts,
            proofs_complete: scan.manifest.completeness.proofs,
            bytes_complete: scan.manifest.completeness.originals,
            target_bytes_complete,
            can_import,
        })
    }

    pub fn preview_profile_archive_import<R: Read + Seek>(
        &self,
        session: &Session,
        input: &mut R,
        budget: ArchiveBudget,
    ) -> Result<ProfileArchivePreview, ProfileArchiveError> {
        let mut progress_guard = ArchiveProgressGuard::new(&budget)?;
        ArchiveBudget::with_limits(budget.limits.clone())?;
        self.preauthorize_archive_import(session)?;
        budget.reset_pass(ProfileArchivePhase::Previewing)?;
        input.seek(SeekFrom::Start(0))?;
        let mut visitor = PreviewVisitor {
            host: self,
            session,
            budget: &budget,
            profile: None,
            conflicts: Vec::new(),
            duplicate_facts: 0,
            new_facts: 0,
        };
        let scan = scan_archive(input, &budget, &mut visitor)?;
        if let Some(scoped) = self.preauthorize_archive_import(session)? {
            if scoped != scan.header.profile_id {
                return Err(HostError::Forbidden.into());
            }
        }
        let visitor = visitor;
        let preview = self.preview_from_scan(session, &scan, visitor)?;
        progress_guard.finish(if preview.can_import {
            ProfileArchivePhase::Complete
        } else {
            ProfileArchivePhase::Partial
        })?;
        Ok(preview)
    }
}
struct ActiveStage {
    stage_id: StageId,
    next_offset: u64,
    byte_length: u64,
    skip: bool,
    satisfied: bool,
}
struct ImportVisitor<'a> {
    host: &'a BetaHost,
    session: &'a Session,
    budget: &'a ArchiveBudget,
    profile: Option<ProfileId>,
    references: BTreeMap<String, OriginalRef>,
    active_stage: Option<ActiveStage>,
    inserted_facts: u64,
    duplicate_facts: u64,
    imported_originals: usize,
    proofs_complete: bool,
}
impl<'a> ImportVisitor<'a> {
    fn new(host: &'a BetaHost, session: &'a Session, budget: &'a ArchiveBudget) -> Self {
        Self {
            host,
            session,
            budget,
            profile: None,
            references: BTreeMap::new(),
            active_stage: None,
            inserted_facts: 0,
            duplicate_facts: 0,
            imported_originals: 0,
            proofs_complete: true,
        }
    }
    fn stage_state(
        &self,
        profile: ProfileId,
        original: &OriginalRef,
    ) -> Result<ActiveStage, ProfileArchiveError> {
        let status =
            self.host
                .with_archive_import(
                    self.session,
                    profile,
                    |resources, human, _| match resources.core.original_availability(
                        human,
                        profile,
                        original.original_id,
                    )? {
                        OriginalAvailability::Local { stage } => {
                            if stage.original != *original {
                                return Err(ProfileArchiveError::Conflict);
                            }
                            if stage.state == StageState::HashMismatch {
                                return Err(ProfileArchiveError::OriginalIntegrityMismatch);
                            }
                            Ok(stage)
                        }
                        OriginalAvailability::Missing { original: missing } => {
                            if missing != *original {
                                return Err(ProfileArchiveError::Conflict);
                            }
                            let command = BeginStageCommand {
                                stage_id: StageId::new(),
                                original_id: original.original_id,
                                profile_id: profile,
                                expected_sha256: original.sha256.clone(),
                                byte_length: original.byte_length,
                                file_name: original.file_name.clone(),
                                media_type: original.media_type.clone(),
                            };
                            Ok(resources.core.begin_stage(human, &command)?)
                        }
                    },
                )?;
        let satisfied = status.state == StageState::Verified
            && status.next_offset == status.original.byte_length;
        Ok(ActiveStage {
            stage_id: status.stage_id,
            next_offset: status.next_offset,
            byte_length: status.original.byte_length,
            skip: satisfied,
            satisfied,
        })
    }
    fn finish_stage(
        &self,
        profile: ProfileId,
        stage_id: StageId,
    ) -> Result<(), ProfileArchiveError> {
        self.budget.check_cancelled()?;
        let ticket =
            self.host
                .with_archive_import(self.session, profile, |resources, human, _| {
                    let status = resources.core.stage_status(human, stage_id)?;
                    if status.state == StageState::HashMismatch
                        || status.next_offset != status.original.byte_length
                    {
                        return Err(ProfileArchiveError::OriginalIntegrityMismatch);
                    }
                    if status.state == StageState::Verified {
                        return Err(ProfileArchiveError::Conflict);
                    }
                    Ok(resources.core.freeze_stage(human, stage_id)?)
                })?;
        self.budget.check_cancelled()?;
        let proof = ticket.verify(|| self.budget.shared.cancelled.load(Ordering::Acquire))?;
        self.budget.check_cancelled()?;
        self.host
            .with_archive_import(self.session, profile, |resources, human, _| {
                resources.core.finish_stage(human, &proof)?;
                Ok(())
            })
    }
}
impl ArchiveVisitor for ImportVisitor<'_> {
    fn header(&mut self, header: &ArchiveHeader) -> Result<(), ProfileArchiveError> {
        self.host
            .authorize_archive_import_role(self.session, header.profile_id)?;
        self.profile = Some(header.profile_id);
        Ok(())
    }
    fn page(
        &mut self,
        _entry_id: &str,
        archive_page: &ArchivePage,
    ) -> Result<(), ProfileArchiveError> {
        self.budget.check_cancelled()?;
        self.budget.check_cancelled()?;
        let profile = self.profile.ok_or(ProfileArchiveError::InvalidFormat)?;
        let page = &archive_page.page;
        if let (Some(key), Some(proof)) = (&archive_page.key, &archive_page.proof) {
            crate::peers::verify_archive_origin_page(page, key, proof)?;
        } else {
            if !page.entries.is_empty() || page.to.seq > 0 {
                self.proofs_complete = false;
            }
        }
        for entry in &page.entries {
            for original in fact_originals(&entry.fact) {
                match self.references.get(&original.original_id.to_string()) {
                    Some(old) if old != &original => return Err(ProfileArchiveError::Conflict),
                    Some(_) => {}
                    None => {
                        self.references
                            .insert(original.original_id.to_string(), original);
                    }
                }
            }
        }
        let ack = self
            .host
            .with_archive_import(self.session, profile, |resources, _human, context| {
                resources
                    .core
                    .import_profile_archive_page(
                        context,
                        page,
                        archive_page.key.as_ref(),
                        archive_page.proof.as_ref(),
                    )
                    .map_err(Into::into)
            })
            .map_err(|error| {
                let _ = self.budget.phase(ProfileArchivePhase::Partial);
                error
            })?;
        self.inserted_facts = self.inserted_facts.saturating_add(ack.inserted);
        self.duplicate_facts = self.duplicate_facts.saturating_add(ack.duplicates);
        self.budget.cursor(ack.origin, ack.cursor)?;
        Ok(())
    }
    fn original_begin(
        &mut self,
        entry_id: &str,
        original: &OriginalRef,
        length: u64,
    ) -> Result<(), ProfileArchiveError> {
        self.budget.check_cancelled()?;
        self.budget.check_cancelled()?;
        let profile = self.profile.ok_or(ProfileArchiveError::InvalidFormat)?;
        if original.byte_length != length
            || self.references.get(&original.original_id.to_string()) != Some(original)
        {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        let local =
            self.host
                .with_archive_import(self.session, profile, |resources, human, _| {
                    resources
                        .core
                        .profile_archive_original_state(human, profile, original.original_id)
                        .map_err(Into::into)
                })?;
        if local.private_stage
            || local
                .manifest
                .as_ref()
                .is_some_and(|stored| stored != original)
        {
            return Err(ProfileArchiveError::Conflict);
        }
        if matches!(
            local.bytes_state,
            Some(OriginalBytesState::Released | OriginalBytesState::Purged)
        ) {
            self.active_stage = Some(ActiveStage {
                stage_id: StageId::new(),
                next_offset: length,
                byte_length: length,
                skip: true,
                satisfied: false,
            });
            return Ok(());
        }
        if matches!(
            local.bytes_state,
            Some(OriginalBytesState::Available | OriginalBytesState::Reclaimed)
        ) {
            self.active_stage = Some(ActiveStage {
                stage_id: StageId::new(),
                next_offset: length,
                byte_length: length,
                skip: true,
                satisfied: true,
            });
            return Ok(());
        }
        self.active_stage = Some(self.stage_state(profile, original)?);
        let _ = entry_id;
        Ok(())
    }
    fn original_chunk(
        &mut self,
        _entry_id: &str,
        original: &OriginalRef,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), ProfileArchiveError> {
        self.budget.check_cancelled()?;
        self.budget.check_cancelled()?;
        let profile = self.profile.ok_or(ProfileArchiveError::InvalidFormat)?;
        let (stage_id, next_offset, byte_length, skip) = self
            .active_stage
            .as_ref()
            .map(|active| {
                (
                    active.stage_id,
                    active.next_offset,
                    active.byte_length,
                    active.skip,
                )
            })
            .ok_or(ProfileArchiveError::InvalidFormat)?;
        if byte_length != original.byte_length || skip {
            return Ok(());
        }
        if offset > next_offset {
            return Err(ProfileArchiveError::InvalidFormat);
        }
        let mut write_at = 0usize;
        if offset < next_offset {
            let prefix_length = usize::try_from((next_offset - offset).min(bytes.len() as u64))
                .map_err(|_| ProfileArchiveError::BudgetExceeded)?;
            let stored =
                self.host
                    .with_archive_import(self.session, profile, |resources, human, _| {
                        Ok(resources
                            .core
                            .read_stage_range(human, stage_id, offset, prefix_length)?
                            .bytes)
                    })?;
            if stored != bytes[..prefix_length] {
                return Err(ProfileArchiveError::Conflict);
            }
            write_at = prefix_length;
        }
        if write_at < bytes.len() {
            let write_offset = offset + write_at as u64;
            if write_offset != next_offset {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            let status =
                self.host
                    .with_archive_import(self.session, profile, |resources, human, _| {
                        Ok(resources.core.write_stage_chunk(
                            human,
                            stage_id,
                            write_offset,
                            &bytes[write_at..],
                        )?)
                    })?;
            if let Some(active) = self.active_stage.as_mut() {
                active.next_offset = status.next_offset;
            }
        }
        Ok(())
    }
    fn original_end(
        &mut self,
        _entry_id: &str,
        original: &OriginalRef,
        digest: &str,
    ) -> Result<(), ProfileArchiveError> {
        self.budget.check_cancelled()?;
        self.budget.check_cancelled()?;
        let profile = self.profile.ok_or(ProfileArchiveError::InvalidFormat)?;
        let active = self
            .active_stage
            .take()
            .ok_or(ProfileArchiveError::InvalidFormat)?;
        if digest != original.sha256 || active.byte_length != original.byte_length {
            return Err(ProfileArchiveError::OriginalIntegrityMismatch);
        }
        if !active.skip {
            if active.next_offset != active.byte_length {
                return Err(ProfileArchiveError::InvalidFormat);
            }
            self.finish_stage(profile, active.stage_id)?;
            self.imported_originals = self.imported_originals.saturating_add(1);
        } else if active.satisfied {
            self.imported_originals = self.imported_originals.saturating_add(1);
        }
        Ok(())
    }
}

impl BetaHost {
    pub fn import_profile_archive<R: Read + Seek>(
        &self,
        session: &Session,
        preview_id: ArchivePreviewId,
        input: &mut R,
        budget: ArchiveBudget,
    ) -> Result<ProfileArchiveImportReceipt, ProfileArchiveError> {
        let mut progress_guard = ArchiveProgressGuard::new(&budget)?;
        ArchiveBudget::with_limits(budget.limits.clone())?;
        self.preauthorize_archive_import(session)?;
        budget.reset_pass(ProfileArchivePhase::Previewing)?;
        input.seek(SeekFrom::Start(0))?;
        let mut preview_visitor = PreviewVisitor {
            host: self,
            session,
            budget: &budget,
            profile: None,
            conflicts: Vec::new(),
            duplicate_facts: 0,
            new_facts: 0,
        };
        let validated = scan_archive(input, &budget, &mut preview_visitor)?;
        let preview = self.preview_from_scan(session, &validated, preview_visitor)?;
        if preview.preview_id != preview_id {
            return Err(ProfileArchiveError::PreviewChanged);
        }
        if !preview.can_import {
            return Err(ProfileArchiveError::Conflict);
        }
        let profile = validated.header.profile_id;
        let profile_exists = self.with_archive_preview(session, profile, |resources, _| {
            Ok(resources
                .core
                .profiles()?
                .iter()
                .any(|item| item.profile_id == profile))
        });
        let profile_exists = match profile_exists {
            Ok(value) => value,
            Err(ProfileArchiveError::Core(CoreError::UnknownProfile)) => false,
            Err(error) => return Err(error),
        };
        if !profile_exists {
            if !matches!(session.authority, Authority::Owner) {
                return Err(HostError::Forbidden.into());
            }
            let state = self.active_state()?;
            self.owner(session)?;
            resources(&state)?
                .core
                .provision_profile(profile, &validated.manifest.display_name)?;
        }
        budget.reset_pass(ProfileArchivePhase::Importing)?;
        input.seek(SeekFrom::Start(0))?;
        let mut visitor = ImportVisitor::new(self, session, &budget);
        let committed = match scan_archive(input, &budget, &mut visitor) {
            Ok(value) => value,
            Err(error) => {
                let _ = budget.phase(ProfileArchivePhase::Partial);
                return Err(error);
            }
        };
        if hex_bytes(&committed.package_sha256)? != preview_id.package_sha256
            || committed.header.profile_id != preview_id.profile_id
            || committed.header.request_id != preview_id.request_id
            || digest_bytes(&serde_json::to_vec(&committed.manifest.origins)?)
                != preview_id.origin_fingerprint
        {
            let _ = budget.phase(ProfileArchivePhase::Partial);
            return Err(ProfileArchiveError::PreviewChanged);
        }
        let mut missing_originals = Vec::new();
        let mut bytes_complete = true;
        for item in &committed.manifest.originals {
            let local = self.with_archive_import(session, profile, |resources, human, _| {
                resources
                    .core
                    .profile_archive_original_state(human, profile, item.original.original_id)
                    .map_err(Into::into)
            })?;
            if local.private_stage
                || local
                    .manifest
                    .as_ref()
                    .is_some_and(|stored| stored != &item.original)
            {
                return Err(ProfileArchiveError::Conflict);
            }
            let local_ready = matches!(
                local.bytes_state,
                Some(OriginalBytesState::Available | OriginalBytesState::Reclaimed)
            );
            let can_materialize = item.bytes_present
                && !matches!(
                    local.bytes_state,
                    Some(OriginalBytesState::Released | OriginalBytesState::Purged)
                );
            if !local_ready && !can_materialize {
                missing_originals.push(item.original.clone());
                bytes_complete = false;
            }
        }
        let facts_complete = committed.manifest.completeness.facts;
        let proofs_complete = committed.manifest.completeness.proofs && visitor.proofs_complete;
        let target_bytes_complete = bytes_complete;
        let bytes_complete = committed.manifest.completeness.originals;
        let complete = facts_complete && proofs_complete && bytes_complete && target_bytes_complete;
        let receipt = ProfileArchiveImportReceipt {
            profile_id: profile,
            request_id: committed.header.request_id,
            inserted_facts: visitor.inserted_facts,
            duplicate_facts: visitor.duplicate_facts,
            imported_originals: visitor.imported_originals,
            missing_originals,
            facts_complete,
            proofs_complete,
            bytes_complete,
            target_bytes_complete,
            complete,
        };
        progress_guard.finish(if complete {
            ProfileArchivePhase::Complete
        } else {
            ProfileArchivePhase::Partial
        })?;
        Ok(receipt)
    }
}
