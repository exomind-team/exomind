//! Inspect and clean only the exact system-open cache entry owned by an original.
//! Cache outcomes are separate from Core receipts; edited or unsafe copies remain.
use super::export::suggested_name;
use exomind_core::{OriginalRef, ProfileId};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenCachePresence {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenCacheCleanupOutcome {
    Complete,
    Partial,
    Incomplete,
    Modified,
    Unsupported,
    UnsafePath,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(windows)]
pub(super) enum OpenCacheVerificationOutcome {
    Matches,
    Modified,
    Incomplete,
}

// A synthetic 64 MiB Windows debug run needed 874 ms; 250 ms could never finish
// on that machine. This is a conservative foreground budget, not a guarantee
// for every file size or storage device. Incomplete checks preserve the file.
pub(super) const DEFAULT_OPEN_CACHE_VERIFY_BUDGET: Duration = Duration::from_secs(5);
#[cfg(windows)]
const OPEN_CACHE_VERIFY_CHUNK_BYTES: usize = 64 * 1024;

// This is a cooperative deadline. A single blocking filesystem call cannot be
// preempted, so every call is bracketed by checks instead of claiming hard RT.
struct CacheCheck<F> {
    started: Instant,
    budget: Duration,
    should_stop: F,
}

impl<F: FnMut() -> bool> CacheCheck<F> {
    fn new(budget: Duration, should_stop: F) -> Self {
        Self {
            started: Instant::now(),
            budget,
            should_stop,
        }
    }

    fn interrupted(&mut self) -> bool {
        (self.should_stop)() || self.started.elapsed() >= self.budget
    }
}

pub(super) fn beta_open_cache_path(
    cache_root: &Path,
    profile_id: ProfileId,
    original: &OriginalRef,
) -> PathBuf {
    cache_root
        .join("beta-open")
        .join(profile_id.to_string())
        .join(original.original_id.to_string())
        .join(suggested_name(&original.file_name))
}

enum OpenCacheProbe {
    Entry(PathBuf),
    Absent,
    Incomplete,
    Unknown,
    Unsafe,
}

fn probe_beta_open_cache(
    cache_root: &Path,
    profile_id: ProfileId,
    original: &OriginalRef,
    mut interrupted: impl FnMut() -> bool,
) -> OpenCacheProbe {
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }
    let root_result = cache_root.canonicalize();
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }
    let root = match root_result {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return OpenCacheProbe::Absent;
        }
        Err(_) => return OpenCacheProbe::Unknown,
    };
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }
    if !root.is_dir() {
        return OpenCacheProbe::Unsafe;
    }
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }

    let components = [
        "beta-open".to_owned(),
        profile_id.to_string(),
        original.original_id.to_string(),
    ];
    let mut directory = root.clone();
    for component in components {
        directory.push(component);
        if interrupted() {
            return OpenCacheProbe::Incomplete;
        }
        let metadata_result = std::fs::symlink_metadata(&directory);
        if interrupted() {
            return OpenCacheProbe::Incomplete;
        }
        let metadata = match metadata_result {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return OpenCacheProbe::Absent;
            }
            Err(_) => return OpenCacheProbe::Unknown,
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return OpenCacheProbe::Unsafe;
        }
        if interrupted() {
            return OpenCacheProbe::Incomplete;
        }
        let canonical_result = directory.canonicalize();
        if interrupted() {
            return OpenCacheProbe::Incomplete;
        }
        directory = match canonical_result {
            Ok(path) if path.starts_with(&root) => path,
            Ok(_) => return OpenCacheProbe::Unsafe,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return OpenCacheProbe::Absent;
            }
            Err(_) => return OpenCacheProbe::Unknown,
        };
    }

    let path = directory.join(suggested_name(&original.file_name));
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }
    let metadata_result = std::fs::symlink_metadata(&path);
    if interrupted() {
        return OpenCacheProbe::Incomplete;
    }
    match metadata_result {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => OpenCacheProbe::Absent,
        Err(_) => OpenCacheProbe::Unknown,
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.file_type().is_file() => {
            OpenCacheProbe::Unsafe
        }
        Ok(_) => OpenCacheProbe::Entry(path),
    }
}

pub(super) fn beta_open_cache_presence(
    cache_root: Option<&Path>,
    profile_id: ProfileId,
    original: &OriginalRef,
) -> OpenCachePresence {
    let Some(cache_root) = cache_root else {
        return OpenCachePresence::Unknown;
    };
    match probe_beta_open_cache(cache_root, profile_id, original, || false) {
        OpenCacheProbe::Entry(_) => OpenCachePresence::Present,
        OpenCacheProbe::Absent => OpenCachePresence::Absent,
        OpenCacheProbe::Incomplete | OpenCacheProbe::Unknown | OpenCacheProbe::Unsafe => {
            OpenCachePresence::Unknown
        }
    }
}

pub(super) fn cleanup_beta_open_cache(
    cache_root: Option<&Path>,
    profile_id: ProfileId,
    original: &OriginalRef,
) -> OpenCacheCleanupOutcome {
    cleanup_beta_open_cache_with_control(
        cache_root,
        profile_id,
        original,
        DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
        || false,
    )
}

pub(super) fn cleanup_beta_open_cache_with_control<F>(
    cache_root: Option<&Path>,
    profile_id: ProfileId,
    original: &OriginalRef,
    budget: Duration,
    should_stop: F,
) -> OpenCacheCleanupOutcome
where
    F: FnMut() -> bool,
{
    let Some(cache_root) = cache_root else {
        return OpenCacheCleanupOutcome::Unavailable;
    };
    let mut check = CacheCheck::new(budget, should_stop);
    if check.interrupted() {
        return OpenCacheCleanupOutcome::Incomplete;
    }
    let path = match probe_beta_open_cache(cache_root, profile_id, original, || check.interrupted())
    {
        OpenCacheProbe::Entry(path) => path,
        OpenCacheProbe::Absent => return OpenCacheCleanupOutcome::Complete,
        OpenCacheProbe::Incomplete => return OpenCacheCleanupOutcome::Incomplete,
        OpenCacheProbe::Unknown => return OpenCacheCleanupOutcome::Unavailable,
        OpenCacheProbe::Unsafe => return OpenCacheCleanupOutcome::UnsafePath,
    };
    if check.interrupted() {
        return OpenCacheCleanupOutcome::Incomplete;
    }

    #[cfg(windows)]
    {
        windows_cleanup_open_cache(&path, original, &mut check)
    }
    #[cfg(unix)]
    {
        unix_inspect_open_cache(&path, original, &mut check)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (path, original);
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        OpenCacheCleanupOutcome::Unsupported
    }
}

#[cfg(windows)]
pub(super) fn cache_file_matches_with_control<F>(
    file: &mut File,
    original: &OriginalRef,
    budget: Duration,
    should_stop: F,
) -> Result<OpenCacheVerificationOutcome, ()>
where
    F: FnMut() -> bool,
{
    let mut check = CacheCheck::new(budget, should_stop);
    cache_file_matches(file, original, &mut check)
}

#[cfg(windows)]
fn cache_file_matches<F: FnMut() -> bool>(
    file: &mut File,
    original: &OriginalRef,
    check: &mut CacheCheck<F>,
) -> Result<OpenCacheVerificationOutcome, ()> {
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    let metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => {
            if check.interrupted() {
                return Ok(OpenCacheVerificationOutcome::Incomplete);
            }
            return Err(());
        }
    };
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    if !metadata.is_file() || metadata.len() != original.byte_length {
        return Ok(OpenCacheVerificationOutcome::Modified);
    }
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    if file.seek(SeekFrom::Start(0)).is_err() {
        if check.interrupted() {
            return Ok(OpenCacheVerificationOutcome::Incomplete);
        }
        return Err(());
    }
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut buffer = vec![0u8; OPEN_CACHE_VERIFY_CHUNK_BYTES];
    loop {
        if check.interrupted() {
            return Ok(OpenCacheVerificationOutcome::Incomplete);
        }
        let length = match file.read(&mut buffer) {
            Ok(length) => length,
            Err(_) => {
                if check.interrupted() {
                    return Ok(OpenCacheVerificationOutcome::Incomplete);
                }
                return Err(());
            }
        };
        if check.interrupted() {
            return Ok(OpenCacheVerificationOutcome::Incomplete);
        }
        if length == 0 {
            break;
        }
        count = count.checked_add(length as u64).ok_or(())?;
        if count > original.byte_length {
            return Ok(OpenCacheVerificationOutcome::Modified);
        }
        hash.update(&buffer[..length]);
        if check.interrupted() {
            return Ok(OpenCacheVerificationOutcome::Incomplete);
        }
    }
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    let digest = format!("{:x}", hash.finalize());
    if check.interrupted() {
        return Ok(OpenCacheVerificationOutcome::Incomplete);
    }
    Ok(
        if count == original.byte_length && digest == original.sha256 {
            OpenCacheVerificationOutcome::Matches
        } else {
            OpenCacheVerificationOutcome::Modified
        },
    )
}

#[cfg(unix)]
fn unix_inspect_open_cache<F: FnMut() -> bool>(
    path: &Path,
    original: &OriginalRef,
    check: &mut CacheCheck<F>,
) -> OpenCacheCleanupOutcome {
    if check.interrupted() {
        return OpenCacheCleanupOutcome::Incomplete;
    }
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if check.interrupted() {
                return OpenCacheCleanupOutcome::Incomplete;
            }
            return OpenCacheCleanupOutcome::Complete;
        }
        Err(_) => {
            if check.interrupted() {
                return OpenCacheCleanupOutcome::Incomplete;
            }
            return OpenCacheCleanupOutcome::Partial;
        }
    };
    if check.interrupted() {
        return OpenCacheCleanupOutcome::Incomplete;
    }
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return OpenCacheCleanupOutcome::UnsafePath;
    }
    if metadata.len() != original.byte_length {
        return OpenCacheCleanupOutcome::Modified;
    }
    // Unix cannot bind a later unlink to the inspected inode while excluding a
    // concurrent writer, so matching length remains unsupported without hashing.
    OpenCacheCleanupOutcome::Unsupported
}

#[cfg(windows)]
mod windows_open_cache_cleanup {
    use super::{
        cache_file_matches, CacheCheck, OpenCacheCleanupOutcome, OpenCacheVerificationOutcome,
    };
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};

    const DELETE_ACCESS: u32 = 0x0001_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const GENERIC_READ: u32 = 0x8000_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_DISPOSITION_INFO_CLASS: u32 = 4;

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileDispositionInformation {
        delete_file: i32,
    }

    #[link(name = "Kernel32")]
    extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            file: *mut std::ffi::c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;
        #[link_name = "SetFileInformationByHandle"]
        fn set_file_information_by_handle(
            file: *mut std::ffi::c_void,
            information_class: u32,
            information: *const std::ffi::c_void,
            information_size: u32,
        ) -> i32;
    }

    pub(super) fn cleanup<F: FnMut() -> bool>(
        path: &std::path::Path,
        original: &exomind_core::OriginalRef,
        check: &mut CacheCheck<F>,
    ) -> OpenCacheCleanupOutcome {
        let mut options = std::fs::OpenOptions::new();
        options
            .read(true)
            .access_mode(GENERIC_READ | DELETE_ACCESS)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        let opened = options.open(path);
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        let mut file = match opened {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return OpenCacheCleanupOutcome::Complete;
            }
            // A viewer/editor may hold a handle whose sharing rules deny delete
            // or our read/delete access. Leave the entry for an explicit retry.
            Err(_) => return OpenCacheCleanupOutcome::Partial,
        };
        let handle = file.as_raw_handle();
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        let mut information = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
        // SAFETY: `handle` is the live File handle and `information` points to
        // a correctly sized, writable Win32 BY_HANDLE_FILE_INFORMATION buffer.
        let information_result =
            unsafe { get_file_information_by_handle(handle, information.as_mut_ptr()) };
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        if information_result == 0 {
            return OpenCacheCleanupOutcome::Partial;
        }
        // SAFETY: Win32 initialized the full structure after returning nonzero.
        let information = unsafe { information.assume_init() };
        if information.number_of_links != 1
            || information.file_attributes
                & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
                != 0
        {
            return OpenCacheCleanupOutcome::UnsafePath;
        }
        match cache_file_matches(&mut file, original, check) {
            Ok(OpenCacheVerificationOutcome::Modified) => {
                return OpenCacheCleanupOutcome::Modified;
            }
            Ok(OpenCacheVerificationOutcome::Incomplete) => {
                return OpenCacheCleanupOutcome::Incomplete;
            }
            Err(()) => return OpenCacheCleanupOutcome::Partial,
            Ok(OpenCacheVerificationOutcome::Matches) => {}
        }

        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        let disposition = FileDispositionInformation { delete_file: 1 };
        // SAFETY: `handle` is the verified file handle opened with DELETE
        // access; the record matches Win32 FileDispositionInfo's layout.
        let deleted = unsafe {
            set_file_information_by_handle(
                handle,
                FILE_DISPOSITION_INFO_CLASS,
                &disposition as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<FileDispositionInformation>() as u32,
            )
        };
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        if deleted == 0 {
            return OpenCacheCleanupOutcome::Partial;
        }
        drop(file);
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        let metadata = std::fs::symlink_metadata(path);
        if check.interrupted() {
            return OpenCacheCleanupOutcome::Incomplete;
        }
        match metadata {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                OpenCacheCleanupOutcome::Complete
            }
            _ => OpenCacheCleanupOutcome::Partial,
        }
    }
}

#[cfg(windows)]
fn windows_cleanup_open_cache<F: FnMut() -> bool>(
    path: &Path,
    original: &OriginalRef,
    check: &mut CacheCheck<F>,
) -> OpenCacheCleanupOutcome {
    windows_open_cache_cleanup::cleanup(path, original, check)
}
