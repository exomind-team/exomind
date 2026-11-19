//! Trusted, explicit Native entry points for local Beta diagnostics.
//!
//! Sampling and directory traversal are request-driven only. The scanner is
//! confined to Native's Host data root and runs on a blocking worker without a
//! Host/Core gate held during the filesystem walk.

use super::{trusted_window, Failure, NativeState};
use exomind_beta_host::diagnostics::{
    process::{ProcessDiagnosticsCollector, ProcessResourceSample},
    scans::{ScanStartError, StorageScanCoordinator},
    storage::{scan_host_storage, StorageScanLimits, StorageScanReport},
    DIAGNOSTICS_SCHEMA_VERSION,
};
use serde::Serialize;
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

/// Native-owned diagnostic state. Construct once with `NativeState` and stop
/// with it; the collector starts no timer and the coordinator starts no worker.
pub(super) struct DiagnosticsState {
    process: Mutex<ProcessDiagnosticsCollector>,
    scans: StorageScanCoordinator,
}

impl DiagnosticsState {
    pub(super) fn new() -> Self {
        Self {
            process: Mutex::new(ProcessDiagnosticsCollector::new()),
            scans: StorageScanCoordinator::default(),
        }
    }

    /// Stops accepting scans and cooperatively cancels the active diagnostic
    /// walk. It does not stop Host timers, peers, uploads, or drafts.
    pub(super) fn request_stop(&self) {
        self.scans.request_stop();
    }

    fn sample_process(&self) -> Result<ProcessResourceSample, Failure> {
        let mut collector = self.process.lock().map_err(|_| Failure {
            code: "diagnostics_unavailable",
            message: "本机资源样本暂时不可用",
        })?;
        Ok(collector.sample())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticsSampleEnvelope {
    schema_version: u16,
    device_id: String,
    runtime_id: String,
    process: ProcessResourceSample,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticsStorageEnvelope {
    schema_version: u16,
    device_id: String,
    runtime_id: String,
    scan_id: Uuid,
    storage: StorageScanReport,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticsCancellation {
    scan_id: Uuid,
    cancellation_requested: bool,
}

#[tauri::command]
pub(super) async fn beta_diagnostics_sample(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<DiagnosticsSampleEnvelope, Failure> {
    trusted_window(&window, state.inner())?;
    let native = Arc::clone(state.inner());
    if native.closing.load(Ordering::Acquire) {
        return Err(stopped());
    }

    tauri::async_runtime::spawn_blocking(move || {
        if native.closing.load(Ordering::Acquire) {
            return Err(stopped());
        }
        let status = native.host.status().map_err(|_| unavailable())?;
        if !status.running || native.closing.load(Ordering::Acquire) {
            return Err(stopped());
        }

        // `status` owns the identity values; its Host gate guard has been
        // released before the process adapter performs any operating-system reads.
        let process = native.diagnostics.sample_process()?;
        Ok(DiagnosticsSampleEnvelope {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            device_id: status.device_id.to_string(),
            runtime_id: status.runtime_id.to_string(),
            process,
        })
    })
    .await
    .map_err(|_| unavailable())?
}

#[tauri::command]
pub(super) async fn beta_diagnostics_storage(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    scan_id: Uuid,
) -> Result<DiagnosticsStorageEnvelope, Failure> {
    trusted_window(&window, state.inner())?;
    let native = Arc::clone(state.inner());
    if native.closing.load(Ordering::Acquire) {
        return Err(stopped());
    }

    let lease = native
        .diagnostics
        .scans
        .begin(scan_id)
        .map_err(scan_start_failure)?;
    let native_root = native.data_directory.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // The lease is owned by the worker closure, so every return path and
        // unwind releases this generation through `Drop`.
        if native.closing.load(Ordering::Acquire) {
            return Err(stopped());
        }
        let status = native.host.status().map_err(|_| unavailable())?;
        if !status.running || native.closing.load(Ordering::Acquire) {
            return Err(stopped());
        }

        // Host status has returned and released its gate before the bounded,
        // read-only OS walk begins. No UI-supplied path is accepted here.
        let storage = scan_host_storage(
            &native_root,
            StorageScanLimits::default(),
            lease.cancellation(),
        );
        let response = DiagnosticsStorageEnvelope {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            device_id: status.device_id.to_string(),
            runtime_id: status.runtime_id.to_string(),
            scan_id: lease.scan_id(),
            storage,
        };
        lease.finish();
        Ok(response)
    })
    .await
    .map_err(|_| unavailable())?
}

#[tauri::command]
pub(super) fn beta_diagnostics_storage_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    scan_id: Uuid,
) -> Result<DiagnosticsCancellation, Failure> {
    trusted_window(&window, state.inner())?;
    let native = Arc::clone(state.inner());
    if native.closing.load(Ordering::Acquire) {
        return Err(stopped());
    }

    Ok(DiagnosticsCancellation {
        scan_id,
        cancellation_requested: native.diagnostics.scans.request_cancel(scan_id),
    })
}

fn scan_start_failure(error: ScanStartError) -> Failure {
    match error {
        ScanStartError::Stopped => stopped(),
        ScanStartError::Duplicate => Failure {
            code: "diagnostics_duplicate",
            message: "此诊断扫描标识已使用，请重新开始扫描",
        },
        ScanStartError::Busy => Failure {
            code: "diagnostics_busy",
            message: "已有诊断扫描正在运行，请等待或取消后重试",
        },
    }
}

fn stopped() -> Failure {
    Failure {
        code: "stopped",
        message: "应用正在关闭或本机服务已停止，诊断操作未启动",
    }
}

fn unavailable() -> Failure {
    Failure {
        code: "diagnostics_unavailable",
        message: "本机诊断操作暂时不可用",
    }
}
