use super::{DIAGNOSTICS_SCHEMA_VERSION, DiagnosticReason};
use serde::Serialize;
use std::{
    collections::VecDeque,
    error::Error,
    fmt,
    fs::{self, DirEntry, ReadDir},
    io,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const DEFAULT_MAX_ENTRIES: u64 = 4_096;
const DEFAULT_MAX_FILES: u64 = 4_096;
const DEFAULT_MAX_DIRECTORIES: u64 = 256;
const DEFAULT_MAX_LOGICAL_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ELAPSED_MS: u64 = 250;
const HARD_MAX_ENTRIES: u64 = 100_000;
const HARD_MAX_FILES: u64 = 100_000;
const HARD_MAX_DIRECTORIES: u64 = 20_000;
const HARD_MAX_LOGICAL_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const HARD_MAX_ELAPSED_MS: u64 = 2_000;

/// Caller-controlled but hard-capped metadata and logical-byte scan budgets.
/// The elapsed limit is cooperative: checks happen between filesystem calls,
/// so one slow operating-system call may run past the configured duration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageScanLimits {
    max_entries: u64,
    max_files: u64,
    max_directories: u64,
    max_logical_bytes: u64,
    max_elapsed_ms: u64,
}

impl StorageScanLimits {
    /// Creates a bounded budget. `max_directories` includes the supplied root.
    pub fn new(
        max_entries: u64,
        max_files: u64,
        max_directories: u64,
        max_logical_bytes: u64,
        max_elapsed_ms: u64,
    ) -> Result<Self, StorageBudgetError> {
        if max_directories == 0 {
            return Err(StorageBudgetError::DirectoryBudgetMustIncludeRoot);
        }
        if max_entries > HARD_MAX_ENTRIES
            || max_files > HARD_MAX_FILES
            || max_directories > HARD_MAX_DIRECTORIES
            || max_logical_bytes > HARD_MAX_LOGICAL_BYTES
            || max_elapsed_ms > HARD_MAX_ELAPSED_MS
        {
            return Err(StorageBudgetError::ExceedsHardMaximum);
        }
        Ok(Self {
            max_entries,
            max_files,
            max_directories,
            max_logical_bytes,
            max_elapsed_ms,
        })
    }

    fn applied(self) -> AppliedStorageScanBudget {
        AppliedStorageScanBudget {
            max_entries: self.max_entries,
            max_files: self.max_files,
            max_directories: self.max_directories,
            max_logical_bytes: self.max_logical_bytes,
            max_elapsed_ms: self.max_elapsed_ms,
        }
    }
}

impl Default for StorageScanLimits {
    fn default() -> Self {
        Self {
            max_entries: DEFAULT_MAX_ENTRIES,
            max_files: DEFAULT_MAX_FILES,
            max_directories: DEFAULT_MAX_DIRECTORIES,
            max_logical_bytes: DEFAULT_MAX_LOGICAL_BYTES,
            max_elapsed_ms: DEFAULT_MAX_ELAPSED_MS,
        }
    }
}

/// Invalid scan-budget configuration. No filesystem details are included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageBudgetError {
    DirectoryBudgetMustIncludeRoot,
    ExceedsHardMaximum,
}

impl fmt::Display for StorageBudgetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DirectoryBudgetMustIncludeRoot => {
                formatter.write_str("directory budget must include the scan root")
            }
            Self::ExceedsHardMaximum => formatter.write_str("scan budget exceeds hard maximum"),
        }
    }
}

impl Error for StorageBudgetError {}

/// A shareable cancellation flag for one explicit metadata scan.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    /// Creates an uncancelled token for one scan operation.
    pub fn new() -> Self {
        Self::default()
    }

    /// Requests that the diagnostic scan stop at its next bounded checkpoint.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

/// Storage scope label. The path itself is intentionally not part of the DTO.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageScope {
    NativeProvidedHostRoot,
}

/// Whether the report covers the complete permitted tree or only a prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageScanStatus {
    Complete,
    Partial,
}

/// Structural categories from the current Host root layout, never file names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageArea {
    HostRoot,
    CoreStore,
    NativePrivateUi,
    LocalSourceStore,
    PeerIdentity,
    Unclassified,
}

impl StorageArea {
    const ALL: [Self; 6] = [
        Self::HostRoot,
        Self::CoreStore,
        Self::NativePrivateUi,
        Self::LocalSourceStore,
        Self::PeerIdentity,
        Self::Unclassified,
    ];

    fn index(self) -> usize {
        match self {
            Self::HostRoot => 0,
            Self::CoreStore => 1,
            Self::NativePrivateUi => 2,
            Self::LocalSourceStore => 3,
            Self::PeerIdentity => 4,
            Self::Unclassified => 5,
        }
    }
}

/// Counts for one structural Host storage area. Bytes are logical file lengths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAreaTotals {
    pub area: StorageArea,
    pub file_count: u64,
    pub directory_count: u64,
    pub logical_bytes_counted: u64,
}

impl StorageAreaTotals {
    fn new(area: StorageArea) -> Self {
        Self {
            area,
            file_count: 0,
            directory_count: 0,
            logical_bytes_counted: 0,
        }
    }
}

/// The exact budget applied to a storage scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedStorageScanBudget {
    pub max_entries: u64,
    pub max_files: u64,
    pub max_directories: u64,
    pub max_logical_bytes: u64,
    pub max_elapsed_ms: u64,
}

/// Result of one explicit scan. Partial counters and bytes are lower bounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScanReport {
    pub schema_version: u16,
    pub scope: StorageScope,
    /// The walk descends through ordinary directories and skips every link.
    pub recursive_without_links: bool,
    pub status: StorageScanStatus,
    pub partial_reasons: Vec<DiagnosticReason>,
    pub started_at_unix_ms: Option<u64>,
    pub finished_at_unix_ms: Option<u64>,
    #[serde(serialize_with = "super::serialize_nanoseconds")]
    pub elapsed_ns: u64,
    pub applied_budget: AppliedStorageScanBudget,
    /// Number of child entries for which the scan attempted metadata lookup.
    pub entries_examined: u64,
    /// Includes the supplied root when that root is a readable directory.
    pub directories_examined: u64,
    pub files_examined: u64,
    pub skipped_link_entries: u64,
    pub skipped_special_entries: u64,
    /// Sum of `metadata.len()` for files included before completion or a limit.
    /// This is logical size, not allocated disk space or reclaimable storage.
    pub logical_bytes_counted: u64,
    pub areas: Vec<StorageAreaTotals>,
}

/// Scans metadata under a trusted Host root supplied by Native composition.
/// This is synchronously and cooperatively bounded, read-only, and does not
/// enter a Core gate. Native callers should run it on a blocking worker.
/// Cancellation is checked between metadata calls and cannot preempt one
/// operating-system call in flight.
/// It never returns paths, file names, contents, or operating-system error text.
pub fn scan_host_storage(
    native_host_root: &Path,
    limits: StorageScanLimits,
    cancellation: &CancellationToken,
) -> StorageScanReport {
    scan_host_storage_with(native_host_root, &limits, cancellation, &StdMetadataReader)
}

fn scan_host_storage_with(
    root: &Path,
    limits: &StorageScanLimits,
    cancellation: &CancellationToken,
    reader: &impl MetadataReader,
) -> StorageScanReport {
    let started = Instant::now();
    let mut report = StorageScanReport {
        schema_version: DIAGNOSTICS_SCHEMA_VERSION,
        scope: StorageScope::NativeProvidedHostRoot,
        recursive_without_links: true,
        status: StorageScanStatus::Complete,
        partial_reasons: Vec::new(),
        started_at_unix_ms: unix_ms(),
        finished_at_unix_ms: None,
        elapsed_ns: 0,
        applied_budget: limits.applied(),
        entries_examined: 0,
        directories_examined: 0,
        files_examined: 0,
        skipped_link_entries: 0,
        skipped_special_entries: 0,
        logical_bytes_counted: 0,
        areas: StorageArea::ALL
            .into_iter()
            .map(StorageAreaTotals::new)
            .collect(),
    };

    if cancellation.is_cancelled() {
        report.add_partial_reason(DiagnosticReason::Cancelled);
        return report.finish(started);
    }
    if !root.is_absolute() {
        report.add_partial_reason(DiagnosticReason::InvalidRoot);
        return report.finish(started);
    }

    let root_metadata = match reader.metadata(root) {
        Ok(metadata) => metadata,
        Err(error) => {
            report.add_partial_reason(io_reason(&error));
            return report.finish(started);
        }
    };
    if root_metadata.is_symlink_or_reparse_point || !root_metadata.is_directory {
        report.add_partial_reason(DiagnosticReason::InvalidRoot);
        return report.finish(started);
    }

    report.directories_examined = 1;
    report.area_mut(StorageArea::HostRoot).directory_count = 1;
    let mut pending_directories = VecDeque::new();
    pending_directories.push_back(root.to_path_buf());
    'walk: while let Some(directory) = pending_directories.pop_front() {
        if cancellation.is_cancelled() {
            report.add_partial_reason(DiagnosticReason::Cancelled);
            break;
        }
        if elapsed_budget_exhausted(started, limits) {
            report.add_partial_reason(DiagnosticReason::BudgetExceeded);
            break;
        }

        let mut entries = match reader.entries(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                report.add_partial_reason(io_reason(&error));
                continue;
            }
        };
        loop {
            if cancellation.is_cancelled() {
                report.add_partial_reason(DiagnosticReason::Cancelled);
                break 'walk;
            }
            if elapsed_budget_exhausted(started, limits) {
                report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                break 'walk;
            }
            let Some(entry) = entries.next() else {
                break;
            };
            if report.entries_examined >= limits.max_entries {
                report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                break 'walk;
            }
            report.entries_examined += 1;
            if report.entries_examined % 64 == 0 {
                std::thread::yield_now();
            }
            let path = match entry {
                Ok(path) => path,
                Err(error) => {
                    report.add_partial_reason(io_reason(&error));
                    continue;
                }
            };
            let metadata = match reader.metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    report.add_partial_reason(io_reason(&error));
                    continue;
                }
            };
            if metadata.is_symlink_or_reparse_point {
                report.skipped_link_entries += 1;
                continue;
            }

            let area = area_for_path(root, &path);
            if metadata.is_directory {
                if report.directories_examined >= limits.max_directories {
                    report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                    break 'walk;
                }
                report.directories_examined += 1;
                report.area_mut(area).directory_count += 1;
                pending_directories.push_back(path);
            } else if metadata.is_file {
                if report.files_examined >= limits.max_files {
                    report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                    break 'walk;
                }
                report.files_examined += 1;
                report.area_mut(area).file_count += 1;
                let Some(total) = report
                    .logical_bytes_counted
                    .checked_add(metadata.logical_bytes)
                else {
                    report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                    break 'walk;
                };
                if total > limits.max_logical_bytes {
                    report.add_partial_reason(DiagnosticReason::BudgetExceeded);
                    break 'walk;
                }
                report.logical_bytes_counted = total;
                report.area_mut(area).logical_bytes_counted += metadata.logical_bytes;
            } else {
                report.skipped_special_entries += 1;
            }
        }
    }

    report.finish(started)
}

impl StorageScanReport {
    fn add_partial_reason(&mut self, reason: DiagnosticReason) {
        self.status = StorageScanStatus::Partial;
        if !self.partial_reasons.contains(&reason) {
            self.partial_reasons.push(reason);
        }
    }

    fn area_mut(&mut self, area: StorageArea) -> &mut StorageAreaTotals {
        &mut self.areas[area.index()]
    }

    fn finish(mut self, started: Instant) -> Self {
        self.finished_at_unix_ms = unix_ms();
        self.elapsed_ns = started.elapsed().as_nanos().min(u64::MAX as u128) as u64;
        self
    }
}

fn elapsed_budget_exhausted(started: Instant, limits: &StorageScanLimits) -> bool {
    started.elapsed() >= Duration::from_millis(limits.max_elapsed_ms)
}

fn unix_ms() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
}

fn area_for_path(root: &Path, path: &Path) -> StorageArea {
    let Ok(relative) = path.strip_prefix(root) else {
        return StorageArea::Unclassified;
    };
    let mut components = relative.components();
    let Some(Component::Normal(first)) = components.next() else {
        return StorageArea::HostRoot;
    };
    let has_descendants = components.next().is_some();
    match first.to_str() {
        Some("core") => StorageArea::CoreStore,
        Some("private-ui") => StorageArea::NativePrivateUi,
        Some("private-sources") => StorageArea::LocalSourceStore,
        Some("private-peer-identity") => StorageArea::PeerIdentity,
        _ if !has_descendants => StorageArea::HostRoot,
        _ => StorageArea::Unclassified,
    }
}

fn io_reason(error: &io::Error) -> DiagnosticReason {
    if error.kind() == io::ErrorKind::PermissionDenied {
        DiagnosticReason::PermissionDenied
    } else {
        DiagnosticReason::EntryUnavailable
    }
}

#[derive(Debug, Clone, Copy)]
struct EntryMetadata {
    is_file: bool,
    is_directory: bool,
    is_symlink_or_reparse_point: bool,
    logical_bytes: u64,
}

trait MetadataReader {
    type Entries: Iterator<Item = io::Result<PathBuf>>;

    fn entries(&self, path: &Path) -> io::Result<Self::Entries>;
    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata>;
}

struct StdMetadataReader;

type StdDirectoryEntries = std::iter::Map<ReadDir, fn(io::Result<DirEntry>) -> io::Result<PathBuf>>;

impl MetadataReader for StdMetadataReader {
    type Entries = StdDirectoryEntries;

    fn entries(&self, path: &Path) -> io::Result<Self::Entries> {
        Ok(fs::read_dir(path)?.map(entry_path))
    }

    fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
        let metadata = fs::symlink_metadata(path)?;
        #[cfg(windows)]
        let is_reparse_point = {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
            metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        };
        #[cfg(not(windows))]
        let is_reparse_point = false;
        Ok(EntryMetadata {
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
            is_symlink_or_reparse_point: metadata.file_type().is_symlink() || is_reparse_point,
            logical_bytes: metadata.len(),
        })
    }
}

fn entry_path(entry: io::Result<DirEntry>) -> io::Result<PathBuf> {
    entry.map(|entry| entry.path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
        io,
        path::PathBuf,
    };

    #[derive(Default)]
    struct FakeMetadataReader {
        children: HashMap<PathBuf, Vec<PathBuf>>,
        metadata: HashMap<PathBuf, EntryMetadata>,
        metadata_errors: HashMap<PathBuf, io::ErrorKind>,
        read_errors: HashMap<PathBuf, io::ErrorKind>,
        cancel_on_entries: Option<CancellationToken>,
        metadata_calls: Cell<usize>,
        directory_calls: RefCell<Vec<PathBuf>>,
    }

    impl MetadataReader for FakeMetadataReader {
        type Entries = std::vec::IntoIter<io::Result<PathBuf>>;

        fn entries(&self, path: &Path) -> io::Result<Self::Entries> {
            self.directory_calls.borrow_mut().push(path.to_path_buf());
            if let Some(cancellation) = &self.cancel_on_entries {
                cancellation.cancel();
            }
            if let Some(kind) = self.read_errors.get(path) {
                return Err(io::Error::new(*kind, "synthetic directory failure"));
            }
            Ok(self
                .children
                .get(path)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(Ok)
                .collect::<Vec<_>>()
                .into_iter())
        }

        fn metadata(&self, path: &Path) -> io::Result<EntryMetadata> {
            self.metadata_calls.set(self.metadata_calls.get() + 1);
            if let Some(kind) = self.metadata_errors.get(path) {
                return Err(io::Error::new(*kind, "synthetic metadata failure"));
            }
            self.metadata
                .get(path)
                .copied()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "synthetic missing path"))
        }
    }

    fn root() -> PathBuf {
        std::env::temp_dir().join("exomind-diagnostic-host-root-fixture")
    }

    #[cfg(windows)]
    struct JunctionCleanup(PathBuf);

    #[cfg(windows)]
    impl Drop for JunctionCleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    fn directory() -> EntryMetadata {
        EntryMetadata {
            is_file: false,
            is_directory: true,
            is_symlink_or_reparse_point: false,
            logical_bytes: 0,
        }
    }

    fn file(logical_bytes: u64) -> EntryMetadata {
        EntryMetadata {
            is_file: true,
            is_directory: false,
            is_symlink_or_reparse_point: false,
            logical_bytes,
        }
    }

    fn limits(
        max_entries: u64,
        max_files: u64,
        max_directories: u64,
        max_logical_bytes: u64,
        max_elapsed_ms: u64,
    ) -> StorageScanLimits {
        StorageScanLimits::new(
            max_entries,
            max_files,
            max_directories,
            max_logical_bytes,
            max_elapsed_ms,
        )
        .unwrap()
    }

    #[test]
    fn scan_limits_reject_unbounded_values() {
        assert_eq!(
            StorageScanLimits::new(0, 0, 0, 0, 0),
            Err(StorageBudgetError::DirectoryBudgetMustIncludeRoot)
        );
        assert_eq!(
            StorageScanLimits::new(HARD_MAX_ENTRIES + 1, 1, 1, 1, 1),
            Err(StorageBudgetError::ExceedsHardMaximum)
        );
    }

    fn two_file_tree(first_size: u64, second_size: u64) -> FakeMetadataReader {
        let root = root();
        let first = root.join("first.bin");
        let second = root.join("second.bin");
        FakeMetadataReader {
            children: HashMap::from([(root.clone(), vec![first.clone(), second.clone()])]),
            metadata: HashMap::from([
                (root, directory()),
                (first, file(first_size)),
                (second, file(second_size)),
            ]),
            ..FakeMetadataReader::default()
        }
    }

    #[test]
    fn entry_budget_stops_metadata_walk_and_marks_partial() {
        let root = root();
        let reader = two_file_tree(3, 5);
        let report = scan_host_storage_with(
            &root,
            &limits(1, 10, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(report.entries_examined <= 1);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::BudgetExceeded)
        );
    }

    #[test]
    fn file_budget_stops_after_the_permitted_file_count() {
        let root = root();
        let reader = two_file_tree(3, 5);
        let report = scan_host_storage_with(
            &root,
            &limits(10, 1, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.files_examined, 1);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::BudgetExceeded)
        );
    }

    #[test]
    fn directory_budget_does_not_open_directories_beyond_the_limit() {
        let root = root();
        let core = root.join("core");
        let reader = FakeMetadataReader {
            children: HashMap::from([(root.clone(), vec![core.clone()])]),
            metadata: HashMap::from([(root.clone(), directory()), (core.clone(), directory())]),
            ..FakeMetadataReader::default()
        };

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 1, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.directories_examined, 1);
        assert_eq!(reader.directory_calls.borrow().as_slice(), &[root]);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::BudgetExceeded)
        );
    }

    #[test]
    fn logical_byte_budget_reports_only_bytes_accounted_before_exhaustion() {
        let root = root();
        let reader = two_file_tree(4, 8);
        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 5, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.logical_bytes_counted, 4);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::BudgetExceeded)
        );
    }

    #[test]
    fn elapsed_budget_is_bounded_and_marks_partial() {
        let root = root();
        let reader = two_file_tree(4, 8);
        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 0),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::BudgetExceeded)
        );
    }

    #[test]
    fn cancellation_returns_partial_without_removing_or_reading_entries() {
        let root = root();
        let reader = two_file_tree(4, 8);
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &cancellation,
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.entries_examined, 0);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
    }

    #[test]
    fn cancellation_during_directory_walk_stops_before_child_metadata() {
        let root = root();
        let child = root.join("child.bin");
        let cancellation = CancellationToken::new();
        let reader = FakeMetadataReader {
            children: HashMap::from([(root.clone(), vec![child.clone()])]),
            metadata: HashMap::from([(root.clone(), directory()), (child, file(9))]),
            cancel_on_entries: Some(cancellation.clone()),
            ..FakeMetadataReader::default()
        };

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &cancellation,
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.entries_examined, 0);
        assert_eq!(reader.metadata_calls.get(), 1);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
    }

    #[test]
    fn permission_failure_preserves_other_metadata_as_partial_results() {
        let root = root();
        let accessible = root.join("accessible.bin");
        let private_ui = root.join("private-ui");
        let reader = FakeMetadataReader {
            children: HashMap::from([(root.clone(), vec![accessible.clone(), private_ui.clone()])]),
            metadata: HashMap::from([
                (root.clone(), directory()),
                (accessible, file(12)),
                (private_ui.clone(), directory()),
            ]),
            read_errors: HashMap::from([(private_ui, io::ErrorKind::PermissionDenied)]),
            ..FakeMetadataReader::default()
        };

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert_eq!(report.logical_bytes_counted, 12);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::PermissionDenied)
        );
    }

    #[test]
    fn reparse_points_are_counted_as_skipped_and_never_traversed() {
        let root = root();
        let junction = root.join("private-sources");
        let reader = FakeMetadataReader {
            children: HashMap::from([(root.clone(), vec![junction.clone()])]),
            metadata: HashMap::from([
                (root.clone(), directory()),
                (
                    junction.clone(),
                    EntryMetadata {
                        is_file: false,
                        is_directory: true,
                        is_symlink_or_reparse_point: true,
                        logical_bytes: 0,
                    },
                ),
            ]),
            ..FakeMetadataReader::default()
        };

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.skipped_link_entries, 1);
        assert!(!reader.directory_calls.borrow().contains(&junction));
    }

    #[test]
    fn scanner_uses_only_directory_and_metadata_capabilities() {
        let root = root();
        let reader = two_file_tree(4, 8);

        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );

        assert_eq!(report.logical_bytes_counted, 12);
        assert_eq!(reader.metadata_calls.get(), 3);
        assert_eq!(reader.directory_calls.borrow().as_slice(), &[root]);
    }

    #[test]
    fn known_areas_follow_the_current_host_directory_layout() {
        let root = root();

        assert_eq!(
            area_for_path(&root, &root.join("core")),
            StorageArea::CoreStore
        );
        assert_eq!(
            area_for_path(&root, &root.join("core/beta-core.sqlite3")),
            StorageArea::CoreStore
        );
        assert_eq!(
            area_for_path(&root, &root.join("private-ui/intent.sqlite3")),
            StorageArea::NativePrivateUi
        );
        assert_eq!(
            area_for_path(&root, &root.join("private-sources/objects")),
            StorageArea::LocalSourceStore
        );
        assert_eq!(
            area_for_path(&root, &root.join("private-peer-identity/identity.sqlite3")),
            StorageArea::PeerIdentity
        );
        assert_eq!(
            area_for_path(&root, &root.join("host-auth.sqlite3")),
            StorageArea::HostRoot
        );
        assert_eq!(
            area_for_path(&root, &root.join("future-layout/data")),
            StorageArea::Unclassified
        );
    }

    #[test]
    fn storage_report_does_not_serialize_root_or_entry_paths() {
        let root = root();
        let reader = two_file_tree(4, 8);
        let report = scan_host_storage_with(
            &root,
            &limits(10, 10, 10, 100, 1000),
            &CancellationToken::new(),
            &reader,
        );
        let encoded = serde_json::to_string(&report).unwrap();

        assert!(!encoded.contains("host-root"));
        assert!(!encoded.contains("first.bin"));
        assert!(!encoded.contains("second.bin"));
    }

    #[cfg(unix)]
    #[test]
    fn unix_symlink_target_is_not_counted_or_modified() {
        use std::os::unix::fs::symlink;

        let inside = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("sentinel.bin");
        std::fs::write(&outside_file, b"synthetic outside bytes").unwrap();
        symlink(outside.path(), inside.path().join("private-sources")).unwrap();

        let report = scan_host_storage(
            inside.path(),
            StorageScanLimits::default(),
            &CancellationToken::new(),
        );

        assert_eq!(report.skipped_link_entries, 1);
        assert_eq!(report.logical_bytes_counted, 0);
        assert_eq!(
            std::fs::read(outside_file).unwrap(),
            b"synthetic outside bytes"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_junction_target_is_not_counted_or_modified() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let inside = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("sentinel.bin");
        std::fs::write(&outside_file, b"synthetic outside bytes").unwrap();
        let junction = inside.path().join("private-sources");
        let command = format!(
            "mklink /J \"{}\" \"{}\"",
            junction.display(),
            outside.path().display()
        );
        let created = Command::new("cmd.exe")
            .args(["/D", "/C"])
            .raw_arg(&command)
            .output()
            .unwrap();
        assert!(
            created.status.success(),
            "create synthetic junction fixture"
        );
        let _junction_cleanup = JunctionCleanup(junction.clone());

        let report = scan_host_storage(
            inside.path(),
            StorageScanLimits::default(),
            &CancellationToken::new(),
        );

        assert_eq!(report.skipped_link_entries, 1);
        assert_eq!(report.logical_bytes_counted, 0);
        assert_eq!(
            std::fs::read(outside_file).unwrap(),
            b"synthetic outside bytes"
        );
    }
}
