//! Keep every app exit behind completion of the owned runtime stop.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::runtime_commands::{
    ensure_runtime_stopped, sync_android_runtime_keepalive, RuntimeProcessState,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ExitPhase {
    #[default]
    Running,
    Stopping,
    Ready,
}

#[derive(Default)]
pub struct AppExitState {
    phase: Mutex<ExitPhase>,
}

impl AppExitState {
    fn begin_stop(&self) -> Result<bool, String> {
        let mut phase = self
            .phase
            .lock()
            .map_err(|_| "failed to lock app exit state".to_string())?;
        if *phase != ExitPhase::Running {
            return Ok(false);
        }
        *phase = ExitPhase::Stopping;
        Ok(true)
    }

    fn complete_stop(&self, result: &Result<(), String>) -> Result<(), String> {
        let mut phase = self
            .phase
            .lock()
            .map_err(|_| "failed to lock app exit state".to_string())?;
        *phase = if result.is_ok() {
            ExitPhase::Ready
        } else {
            ExitPhase::Running
        };
        Ok(())
    }

    fn ready(&self) -> bool {
        self.phase
            .lock()
            .map(|phase| *phase == ExitPhase::Ready)
            .unwrap_or(false)
    }
}

/// Only a completed stop permits Tauri's final exit request to proceed.
pub fn exit_ready(app: &AppHandle) -> bool {
    app.state::<AppExitState>().ready()
}

/// The WebView and automation use the same native close event as the title bar.
#[tauri::command]
pub fn app_main_window_close(app: AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window is unavailable".to_string())?;
        window.close().map_err(|error| error.to_string())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        Err("main window closing is a desktop action".to_string())
    }
}

/// Quit controls share the tray's owned, awaited runtime shutdown path.
#[tauri::command]
pub fn app_request_exit(app: AppHandle) {
    request_exit(&app, 0);
}

/// Request one asynchronous stop for tray, window, and platform exit paths.
pub fn request_exit(app: &AppHandle, exit_code: i32) {
    match app.state::<AppExitState>().begin_stop() {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            log::error!("cannot begin app shutdown: {error}");
            return;
        }
    }

    let runtime_state = app.state::<Arc<RuntimeProcessState>>().inner().clone();
    // This gate is synchronous: queued startup cannot outlive the exit request.
    runtime_state.request_shutdown();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = ensure_runtime_stopped(runtime_state).await.map(|status| {
            sync_android_runtime_keepalive(&app, false, &status.host, status.port);
            crate::windows_appbar::detach_on_shutdown(&app);
        });
        if let Err(error) = app.state::<AppExitState>().complete_stop(&result) {
            log::error!("cannot complete app shutdown: {error}");
            return;
        }

        match result {
            Ok(()) => app.exit(exit_code),
            Err(error) => {
                // Keep the host available for a retry instead of claiming a
                // graceful exit while owned resources may still be active.
                log::error!("app shutdown failed; exit can be retried: {error}");
                if let Err(emit_error) = app.emit("app-shutdown-error", &error) {
                    log::warn!("failed to report app shutdown error: {emit_error}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::AppExitState;

    #[test]
    fn exit_is_blocked_until_owned_stop_completes() {
        let state = AppExitState::default();
        assert!(state.begin_stop().unwrap());
        assert!(!state.ready());
        state.complete_stop(&Ok(())).unwrap();
        assert!(state.ready());
    }

    #[test]
    fn repeated_exit_requests_share_one_stop() {
        let state = AppExitState::default();
        assert!(state.begin_stop().unwrap());
        assert!(!state.begin_stop().unwrap());
        state.complete_stop(&Ok(())).unwrap();
        assert!(!state.begin_stop().unwrap());
    }

    #[test]
    fn failed_stop_keeps_exit_blocked_and_allows_retry() {
        let state = AppExitState::default();
        state.begin_stop().unwrap();
        state
            .complete_stop(&Err("owned stop failed".into()))
            .unwrap();
        assert!(!state.ready());
        assert!(state.begin_stop().unwrap());
    }
}
