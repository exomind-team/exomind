//! Native command seam for original lifecycle status and local cache cleanup.
//! Core/Host remain the owners of lifecycle facts; this module only validates
//! the selected Native profile, coordinates Native export/open, and reports the
//! exact system-open cache result.
use super::{export, open_cache as cache, trusted_window, Failure, NativeState};
use exomind_beta_host::{
    BetaHost, HostError, OriginalAutoSuppression, OriginalAutoSuppressionCommand,
    OriginalLifecycleHostStatus, PeerNetwork, Session,
};

use exomind_core::{
    OriginalBytesState, OriginalId, OriginalLifecycleAction, OriginalLifecycleCommand, ProfileId,
    Receipt,
};
use serde::Serialize;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CachePresence {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CacheCleanupStatus {
    Complete,
    Partial,
    RecoveryRequired,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CacheCleanupReason {
    FilesystemRejected,
    Modified,
    Unsupported,
    UnsafePath,
    Unavailable,
    VerificationIncomplete,
}

#[derive(Serialize)]
pub(super) struct NativeOriginalLifecycleStatus {
    pub(super) lifecycle: OriginalLifecycleHostStatus,
    pub(super) cache_presence: CachePresence,
}

#[derive(Serialize)]
pub(super) struct NativeCacheCleanupResult {
    pub(super) status: CacheCleanupStatus,
    pub(super) retryable: bool,
    pub(super) reason: Option<CacheCleanupReason>,
    pub(super) cache_presence: CachePresence,
}

#[derive(Serialize)]
pub(super) struct NativeOriginalLifecycleApplyResult {
    pub(super) receipt: Receipt,
    pub(super) status: Option<NativeOriginalLifecycleStatus>,
    pub(super) cache_cleanup: NativeCacheCleanupResult,
}

#[derive(Clone, Copy)]
pub(super) struct NativeHumanProfile {
    pub(super) profile_id: ProfileId,
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}

pub(super) fn validate_native_profile(
    profile_id: ProfileId,
    validate: impl FnOnce(ProfileId) -> Result<Session, HostError>,
) -> Result<NativeHumanProfile, Failure> {
    validate(profile_id).map_err(Failure::from)?;
    Ok(NativeHumanProfile { profile_id })
}

fn verify_scope(
    profile: NativeHumanProfile,
    status: &OriginalLifecycleHostStatus,
    original_id: OriginalId,
) -> Result<(), Failure> {
    if status.local.profile_id != profile.profile_id
        || status.local.original.original_id != original_id
    {
        return Err(failure(
            "original_lifecycle_scope_mismatch",
            "原件生命周期响应与当前档案或原件不一致",
        ));
    }
    Ok(())
}

pub(super) fn native_lifecycle_status(
    host: &BetaHost,
    owner: &Session,
    profile: NativeHumanProfile,
    original_id: OriginalId,
    cache_root: Option<&Path>,
) -> Result<NativeOriginalLifecycleStatus, Failure> {
    // NativeWorkspace human validation is intentionally separate from the
    // Host owner authority required by lifecycle status/apply.
    let lifecycle = host
        .original_lifecycle_status(owner, profile.profile_id, original_id)
        .map_err(Failure::from)?;
    verify_scope(profile, &lifecycle, original_id)?;
    let cache_presence = cache_presence(cache_root, profile.profile_id, &lifecycle.local.original);
    Ok(NativeOriginalLifecycleStatus {
        lifecycle,
        cache_presence,
    })
}

fn cache_presence(
    cache_root: Option<&Path>,
    profile_id: ProfileId,
    original: &exomind_core::OriginalRef,
) -> CachePresence {
    match cache::beta_open_cache_presence(cache_root, profile_id, original) {
        cache::OpenCachePresence::Present => CachePresence::Present,
        cache::OpenCachePresence::Absent => CachePresence::Absent,
        cache::OpenCachePresence::Unknown => CachePresence::Unknown,
    }
}

fn cleanup_result(
    cache_root: Option<&Path>,
    profile_id: ProfileId,
    original: &exomind_core::OriginalRef,
    budget: Duration,
    should_stop: impl FnMut() -> bool,
) -> NativeCacheCleanupResult {
    let outcome = cache::cleanup_beta_open_cache_with_control(
        cache_root,
        profile_id,
        original,
        budget,
        should_stop,
    );
    let (status, retryable, reason, presence) = match outcome {
        cache::OpenCacheCleanupOutcome::Complete => (
            CacheCleanupStatus::Complete,
            false,
            None,
            CachePresence::Absent,
        ),
        cache::OpenCacheCleanupOutcome::Partial => (
            CacheCleanupStatus::Partial,
            true,
            Some(CacheCleanupReason::FilesystemRejected),
            CachePresence::Unknown,
        ),
        cache::OpenCacheCleanupOutcome::Modified => (
            CacheCleanupStatus::RecoveryRequired,
            false,
            Some(CacheCleanupReason::Modified),
            CachePresence::Present,
        ),
        cache::OpenCacheCleanupOutcome::Unsupported => (
            CacheCleanupStatus::RecoveryRequired,
            false,
            Some(CacheCleanupReason::Unsupported),
            CachePresence::Present,
        ),
        cache::OpenCacheCleanupOutcome::UnsafePath => (
            CacheCleanupStatus::RecoveryRequired,
            false,
            Some(CacheCleanupReason::UnsafePath),
            CachePresence::Unknown,
        ),
        cache::OpenCacheCleanupOutcome::Unavailable => (
            CacheCleanupStatus::Partial,
            true,
            Some(CacheCleanupReason::Unavailable),
            CachePresence::Unknown,
        ),
        cache::OpenCacheCleanupOutcome::Incomplete => (
            CacheCleanupStatus::Partial,
            true,
            Some(CacheCleanupReason::VerificationIncomplete),
            CachePresence::Unknown,
        ),
    };
    NativeCacheCleanupResult {
        status,
        retryable,
        reason,
        cache_presence: presence,
    }
}

fn not_applicable(presence: CachePresence) -> NativeCacheCleanupResult {
    NativeCacheCleanupResult {
        status: CacheCleanupStatus::NotApplicable,
        retryable: false,
        reason: None,
        cache_presence: presence,
    }
}

fn partial_unavailable() -> NativeCacheCleanupResult {
    NativeCacheCleanupResult {
        status: CacheCleanupStatus::Partial,
        retryable: true,
        reason: Some(CacheCleanupReason::Unavailable),
        cache_presence: CachePresence::Unknown,
    }
}

pub(super) fn apply_original_lifecycle(
    host: &BetaHost,
    owner: &Session,
    exports: &Arc<export::ExportManager>,
    closing: &AtomicBool,
    cache_root: Option<&Path>,
    profile: NativeHumanProfile,
    command: OriginalLifecycleCommand,
    budget: Duration,
    mut should_stop: impl FnMut() -> bool,
) -> Result<NativeOriginalLifecycleApplyResult, Failure> {
    if command.profile_id != profile.profile_id {
        return Err(failure(
            "original_lifecycle_scope_mismatch",
            "操作档案与已验证的本机档案不一致",
        ));
    }

    let releases_bytes = matches!(
        command.action,
        OriginalLifecycleAction::ReleaseLocal | OriginalLifecycleAction::PurgeReclaimed
    );
    // Reclaim expiry only qualifies a later explicit purge command; this route has no timer.
    // Reuse ExportManager's profile/original key. Same-key open/export returns
    // original_busy before Host writes a Core fact; unrelated keys coexist.
    let _reservation = if releases_bytes {
        Some(exports.reserve_release(profile.profile_id, command.original_id)?)
    } else {
        None
    };

    // The command and its IDs are caller-stable so an unknown result can replay
    // through Host/Core with the same payload. Never synthesize a retry command.
    let receipt = host
        .apply_original_lifecycle(owner, &command)
        .map_err(Failure::from)?;
    let status =
        native_lifecycle_status(host, owner, profile, command.original_id, cache_root).ok();
    let cache_cleanup = match (&status, releases_bytes) {
        (Some(status), true)
            if matches!(
                status.lifecycle.local.bytes_state,
                OriginalBytesState::Released | OriginalBytesState::Purged
            ) =>
        {
            cleanup_result(
                cache_root,
                profile.profile_id,
                &status.lifecycle.local.original,
                budget,
                || should_stop() || closing.load(Ordering::Acquire) || exports.is_stopping(),
            )
        }
        (None, true) => partial_unavailable(),
        (Some(status), true) => not_applicable(status.cache_presence),
        (_, false) => not_applicable(
            status
                .as_ref()
                .map_or(CachePresence::Unknown, |status| status.cache_presence),
        ),
    };
    Ok(NativeOriginalLifecycleApplyResult {
        receipt,
        status,
        cache_cleanup,
    })
}

/// Resets only a hash-failed stage through Host, preserving its Core request and command IDs.
/// A cancelled partial stage keeps its durable offset and only clears its explicit suppression.
pub(super) fn retry_original_restore(
    host: &BetaHost,
    owner: &Session,
    peers: &PeerNetwork,
    profile: NativeHumanProfile,
    original_id: OriginalId,
) -> Result<Option<exomind_core::OriginalRestoreRetry>, Failure> {
    let lifecycle = host
        .original_lifecycle_status(owner, profile.profile_id, original_id)
        .map_err(Failure::from)?
        .local;
    if lifecycle.bytes_state != OriginalBytesState::RestorePending {
        return Err(failure(
            "original_restore_not_pending",
            "当前原件没有待续接的恢复请求",
        ));
    }

    let transfer = peers
        .original_status(profile.profile_id, original_id)
        .map_err(Failure::from)?;
    let retry = if transfer.availability == "hash_mismatch" {
        Some(
            host.retry_failed_original_restore(owner, profile.profile_id, original_id)
                .map_err(Failure::from)?,
        )
    } else {
        None
    };

    let intent = host
        .original_local_intent(owner, profile.profile_id, original_id)
        .map_err(Failure::from)?;
    if intent.suppression == Some(OriginalAutoSuppression::UserCancelled) {
        host.configure_original_auto_suppression(
            owner,
            profile.profile_id,
            original_id,
            &OriginalAutoSuppressionCommand {
                command_id: uuid::Uuid::new_v4(),
                expected_intent_revision: intent.intent_revision,
                suppression: None,
            },
        )
        .map_err(Failure::from)?;
    }
    peers.wake_original_restore_scan();
    Ok(retry)
}
pub(super) fn retry_original_cache_cleanup(
    host: &BetaHost,
    owner: &Session,
    exports: &Arc<export::ExportManager>,
    closing: &AtomicBool,
    cache_root: Option<&Path>,
    profile: NativeHumanProfile,
    original_id: OriginalId,
    budget: Duration,
    mut should_stop: impl FnMut() -> bool,
) -> Result<NativeCacheCleanupResult, Failure> {
    let _reservation = exports.reserve_release(profile.profile_id, original_id)?;
    let status = native_lifecycle_status(host, owner, profile, original_id, cache_root)?;
    if !matches!(
        status.lifecycle.local.bytes_state,
        OriginalBytesState::Released | OriginalBytesState::Purged
    ) {
        return Err(failure(
            "original_cache_cleanup_not_ready",
            "本机原件仍未释放或清除，不能重试打开缓存清理",
        ));
    }
    Ok(cleanup_result(
        cache_root,
        profile.profile_id,
        &status.lifecycle.local.original,
        budget,
        || should_stop() || closing.load(Ordering::Acquire) || exports.is_stopping(),
    ))
}

pub(super) fn reveal_original_cache(
    host: &BetaHost,
    owner: &Session,
    exports: &Arc<export::ExportManager>,
    cache_root: Option<&Path>,
    profile: NativeHumanProfile,
    original_id: OriginalId,
    reveal: impl FnOnce(&Path) -> Result<(), Failure>,
) -> Result<(), Failure> {
    let _reservation = exports.reserve_release(profile.profile_id, original_id)?;
    let status = native_lifecycle_status(host, owner, profile, original_id, cache_root)?;
    let root = cache_root.ok_or_else(|| {
        failure(
            "original_cache_unavailable",
            "本机打开缓存位置暂不可用，请保留现有资料后重试",
        )
    })?;
    match status.cache_presence {
        CachePresence::Present => {}
        CachePresence::Absent => {
            return Err(failure(
                "original_cache_not_found",
                "此原件当前没有可定位的本机打开缓存",
            ));
        }
        CachePresence::Unknown => {
            return Err(failure(
                "original_cache_unavailable",
                "无法安全确认本机打开缓存位置，请保留现有资料后重试",
            ));
        }
    }
    let path =
        cache::beta_open_cache_path(root, profile.profile_id, &status.lifecycle.local.original);
    reveal(&path)
}

async fn run_native<T: Send + 'static>(
    state: Arc<NativeState>,
    action: impl FnOnce(&NativeState) -> Result<T, Failure> + Send + 'static,
) -> Result<T, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        if state.closing.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::from(HostError::Stopped));
        }
        action(&state)
    })
    .await
    .map_err(|_| failure("host_error", "本机生命周期操作意外中断，请保留现有资料"))?
}

fn app_cache_root(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_cache_dir().ok()
}

fn invalidate_original_views(app: &AppHandle, profile_id: ProfileId, original_id: OriginalId) {
    // An invalidation asks equal data clients to reread; it is not a new
    // business event or a claim that bytes have arrived. A failed notification
    // cannot roll back the durable Core receipt.
    let _ = app.emit("beta-original-availability-changed", serde_json::json!({
        "profile_id": profile_id,
        "original_id": original_id,
    }));
}

#[derive(Serialize)]
pub(super) struct NativeOriginalLifecycleCapabilities {
    schema_version: u8,
    core_schema: i64,
    operations: [&'static str; 4],
    cache_policy: &'static str,
    supports_reveal: bool,
    supports_restore_retry: bool,
}

pub(super) fn capabilities_descriptor() -> NativeOriginalLifecycleCapabilities {
    NativeOriginalLifecycleCapabilities {
        schema_version: 1,
        core_schema: exomind_core::CORE_SCHEMA_VERSION,
        operations: ["reclaim", "restore", "release_local", "purge_reclaimed"],
        cache_policy: if cfg!(windows) {
            "verified_same_handle"
        } else {
            "retained"
        },
        supports_reveal: cfg!(any(
            windows,
            target_os = "macos",
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        )),
        supports_restore_retry: true,
    }
}

#[tauri::command]
pub(super) async fn beta_original_lifecycle_capabilities(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<NativeOriginalLifecycleCapabilities, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) || !state.host.status()?.running {
        return Err(Failure::from(HostError::Stopped));
    }
    Ok(capabilities_descriptor())
}

#[tauri::command]
pub(super) async fn beta_original_lifecycle_status(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
) -> Result<NativeOriginalLifecycleStatus, Failure> {
    trusted_window(&window, state.inner())?;
    let cache_root = app_cache_root(&app);
    run_native(state.inner().clone(), move |native| {
        let profile = validate_native_profile(profile_id, |profile| native.human(profile))?;
        native_lifecycle_status(
            &native.host,
            &native.owner,
            profile,
            original_id,
            cache_root.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_apply_original_lifecycle(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: OriginalLifecycleCommand,
) -> Result<NativeOriginalLifecycleApplyResult, Failure> {
    trusted_window(&window, state.inner())?;
    let cache_root = app_cache_root(&app);
    let wake_restore = command.action == OriginalLifecycleAction::Restore;
    let profile_id = command.profile_id;
    let original_id = command.original_id;
    let peers = state.inner().peers.clone();
    let result = run_native(state.inner().clone(), move |native| {
        let profile = validate_native_profile(command.profile_id, |profile| native.human(profile))?;
        apply_original_lifecycle(
            &native.host,
            &native.owner,
            &native.exports,
            &native.closing,
            cache_root.as_deref(),
            profile,
            command,
            cache::DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
            || false,
        )
    })
    .await?;
    if wake_restore {
        peers.wake_original_restore_scan();
    }
    invalidate_original_views(&app, profile_id, original_id);
    Ok(result)
}

#[tauri::command]
pub(super) async fn beta_retry_original_restore(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
) -> Result<Option<exomind_core::OriginalRestoreRetry>, Failure> {
    trusted_window(&window, state.inner())?;
    let result = run_native(state.inner().clone(), move |native| {
        let profile = validate_native_profile(profile_id, |profile| native.human(profile))?;
        retry_original_restore(&native.host, &native.owner, &native.peers, profile, original_id)
    })
    .await?;
    invalidate_original_views(&app, profile_id, original_id);
    Ok(result)
}
#[tauri::command]
pub(super) async fn beta_retry_original_cache_cleanup(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
) -> Result<NativeCacheCleanupResult, Failure> {
    trusted_window(&window, state.inner())?;
    let cache_root = app_cache_root(&app);
    run_native(state.inner().clone(), move |native| {
        let profile = validate_native_profile(profile_id, |profile| native.human(profile))?;
        retry_original_cache_cleanup(
            &native.host,
            &native.owner,
            &native.exports,
            &native.closing,
            cache_root.as_deref(),
            profile,
            original_id,
            cache::DEFAULT_OPEN_CACHE_VERIFY_BUDGET,
            || false,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_reveal_original_cache(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    let cache_root = app_cache_root(&app);
    run_native(state.inner().clone(), move |native| {
        let profile = validate_native_profile(profile_id, |profile| native.human(profile))?;
        reveal_original_cache(
            &native.host,
            &native.owner,
            &native.exports,
            cache_root.as_deref(),
            profile,
            original_id,
            |path| {
                tauri_plugin_opener::reveal_item_in_dir(path).map_err(|_| {
                    failure(
                        "original_cache_reveal_failed",
                        "无法在文件管理器中定位保留的原件副本",
                    )
                })
            },
        )
    })
    .await
}
