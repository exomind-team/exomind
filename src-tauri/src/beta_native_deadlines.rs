//! Native-owned platform reminders; no React lifetime or receiver Core writes.
use super::{trusted_window, Failure, NativeState};
use exomind_android_timeblock_end_alert::BetaDeadlineNotificationChannelState;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{State, WebviewWindow};
#[path = "beta_native_handoff.rs"]
mod handoff;

#[derive(Clone)]
struct Cancellation(tokio::sync::watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(tokio::sync::watch::channel(false).0)
    }
}
impl Cancellation {
    fn cancel(&self) {
        self.0.send_replace(true);
    }
    fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    async fn cancelled(&self) {
        let mut observed = self.0.subscribe();
        loop {
            if *observed.borrow() {
                return;
            }
            if observed.changed().await.is_err() {
                return;
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct Status {
    pub platform_state: &'static str,
    pub notification_permission: String,
    pub exact_alarm: bool,
    pub pending_count: usize,
    pub scheduled_count: usize,
    pub delivered_count: usize,
    pub keepalive_requested: bool,
    pub last_error_code: Option<&'static str>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            platform_state: "unavailable",
            notification_permission: "unavailable".into(),
            exact_alarm: false,
            pending_count: 0,
            scheduled_count: 0,
            delivered_count: 0,
            keepalive_requested: false,
            last_error_code: None,
        }
    }
}
#[derive(Default)]
pub(super) struct Bridge {
    status: Arc<Mutex<Status>>,
    cancel: Cancellation,
    running: Arc<AtomicBool>,
    done: Arc<tokio::sync::Notify>,
    permission_busy: Arc<AtomicBool>,
    handoffs: Arc<handoff::Mailbox>,
}
impl Bridge {
    pub(super) async fn stop(&self) -> Result<(), exomind_beta_host::HostError> {
        self.cancel.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while self.running.load(Ordering::Acquire) {
                self.done.notified().await;
            }
        })
        .await
        .map_err(|_| exomind_beta_host::HostError::Shutdown)?;
        if self
            .status
            .lock()
            .map_err(|_| exomind_beta_host::HostError::StatePoisoned)?
            .last_error_code
            == Some("deadline_alert_timeout")
        {
            return Err(exomind_beta_host::HostError::Shutdown);
        }
        Ok(())
    }
    #[cfg(target_os = "android")]
    pub(super) fn start(&self, app: tauri::AppHandle, state: std::sync::Weak<NativeState>) {
        use exomind_android_keepalive::AndroidRuntimeKeepaliveExt;
        use exomind_android_timeblock_end_alert::AndroidTimeblockEndAlertExt;
        use tauri::Emitter;
        if self.running.swap(true, Ordering::AcqRel) {
            return;
        }
        let cancel = self.cancel.clone();
        let status = self.status.clone();
        let running = self.running.clone();
        let done = self.done.clone();
        let handoffs = self.handoffs.clone();
        tauri::async_runtime::spawn(async move {
            struct Finished(Arc<AtomicBool>, Arc<tokio::sync::Notify>);
            impl Drop for Finished {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::Release);
                    self.1.notify_one();
                }
            }
            let _finished = Finished(running, done);
            let mut keepalive = false;
            let mut timed_out = false;
            loop {
                if cancel.is_cancelled() {
                    break;
                }
                let Some(state) = state.upgrade() else {
                    break;
                };
                if state.closing.load(Ordering::Acquire) {
                    break;
                }
                let event_app = app.clone();
                let app = app.clone();
                let step_status = status.clone();
                let step_handoffs = handoffs.clone();
                let step_cancelled = Arc::new(AtomicBool::new(false));
                let step_fence = step_cancelled.clone();
                let mut step = tauri::async_runtime::spawn_blocking(move || {
                    let result = state.host.local_deadline_alerts(&state.owner);
                    if state.closing.load(Ordering::Acquire) || step_fence.load(Ordering::Acquire) {
                        return keepalive;
                    }
                    drop(state);
                    // A failed sample is unknown eligibility, not an empty
                    // schedule. Preserve the last accepted platform request.
                    let clock_failed =
                        matches!(result, Err(exomind_beta_host::HostError::ClockUnavailable));
                    let pending = result
                        .as_ref()
                        .map(|rows| rows.iter().filter(|row| !row.completed).count())
                        .unwrap_or_else(|_| {
                            if clock_failed {
                                step_status
                                    .lock()
                                    .map(|status| status.pending_count)
                                    .unwrap_or(0)
                            } else {
                                0
                            }
                        });
                    let error = result.as_ref().err().map(|error| match error {
                        exomind_beta_host::HostError::ClockUnavailable => "clock_unavailable",
                        exomind_beta_host::HostError::Core(
                            exomind_core::CoreError::InvalidQuery("deadline alert capacity"),
                        ) => "deadline_alert_capacity",
                        _ => "deadline_alert_unavailable",
                    });
                    // On an invalid projection, cancel cached platform requests
                    // rather than keeping a run whose authority is unknown.
                    let alerts = result
                        .unwrap_or_default()
                        .into_iter()
                        .map(
                            |row| exomind_android_timeblock_end_alert::BetaDeadlineAlert {
                                deadline_id: row.deadline_id.to_string(),
                                profile_id: row.profile_id.to_string(),
                                block_id: row.block_id.to_string(),
                                block_name: exomind_android_timeblock_end_alert::project_deadline_notification_title(
                                    &row.block_name,
                                ),
                                block_note: exomind_android_timeblock_end_alert::project_deadline_notification_note(
                                    &row.block_note,
                                ),
                                due_at: row.due_at_ms,
                                remaining_ms: row.remaining_ms,
                                completed: row.completed,
                            },
                        )
                        .collect();
                    let requested_ack = step_handoffs.next_ack();
                    let platform = app.android_timeblock_end_alert().sync_beta_deadlines(
                        alerts,
                        requested_ack.map(|id| id.to_string()),
                        clock_failed,
                    );
                    if step_fence.load(Ordering::Acquire) {
                        return keepalive;
                    }
                    let want_keepalive = if clock_failed {
                        keepalive
                    } else {
                        pending > 0 && error.is_none()
                    };
                    let keepalive_ok = if want_keepalive != keepalive {
                        app.android_runtime_keepalive()
                            .set_enabled(
                                want_keepalive,
                                Some("外心计时服务".into()),
                                Some("保持本机计时与到点状态处理；系统仍可能延迟后台执行".into()),
                            )
                            .is_ok()
                    } else {
                        true
                    };
                    let next_keepalive = if keepalive_ok {
                        want_keepalive
                    } else {
                        keepalive
                    };
                    if step_fence.load(Ordering::Acquire) {
                        return next_keepalive;
                    }
                    let mut next = Status {
                        pending_count: pending,
                        keepalive_requested: next_keepalive,
                        ..Status::default()
                    };
                    match platform {
                        Ok(value) => {
                            match step_handoffs.publish(
                                value.pending_handoff,
                                requested_ack,
                                value.acknowledged_handoff_id,
                            ) {
                                Ok(true) => {
                                    let _ = app.emit("beta-deadline-handoff", ());
                                }
                                Ok(false) => {}
                                Err(_) => {
                                    if step_handoffs.fail() {
                                        let _ = app.emit("beta-deadline-handoff", ());
                                    }
                                    if let Ok(mut current) = step_status.lock() {
                                        current.platform_state = "failed";
                                        current.last_error_code = Some("deadline_handoff_invalid");
                                    }
                                    return next_keepalive;
                                }
                            }
                            next.platform_state = if error.is_none() && keepalive_ok {
                                "ready"
                            } else {
                                "failed"
                            };
                            next.notification_permission = value.notification_permission;
                            next.exact_alarm = value.exact_alarm;
                            next.scheduled_count = value.scheduled_count;
                            next.delivered_count = value.delivered_count;
                            next.last_error_code = error.or(if keepalive_ok {
                                None
                            } else {
                                Some("deadline_keepalive_unavailable")
                            });
                        }
                        Err(error) => {
                            let description = error.to_string();
                            let capacity = description.contains("capacity");
                            let handoff_error = description.contains("handoff");
                            if !handoff_error {
                                let _ = app.android_timeblock_end_alert().sync_beta_deadlines(
                                    vec![],
                                    None,
                                    false,
                                );
                            }
                            if step_handoffs.fail() {
                                let _ = app.emit("beta-deadline-handoff", ());
                            }
                            next.platform_state = "failed";
                            next.last_error_code = Some(if handoff_error {
                                "deadline_handoff_invalid"
                            } else if capacity {
                                "deadline_alert_capacity"
                            } else {
                                "deadline_alert_platform_failed"
                            });
                        }
                    }
                    if !step_fence.load(Ordering::Acquire) {
                        if let Ok(mut current) = step_status.lock() {
                            *current = next;
                        }
                    }
                    next_keepalive
                });
                // Old Tauri JNI callbacks panic if their response receiver is
                // dropped. Keep this one owned blocking call alive on timeout;
                // stop the bridge instead of queuing retries or aborting it.
                match tokio::time::timeout(std::time::Duration::from_secs(6), &mut step).await {
                    Ok(Ok(value)) => keepalive = value,
                    _ => {
                        step_cancelled.store(true, Ordering::Release);
                        timed_out = true;
                        if handoffs.fail() {
                            let _ = event_app.emit("beta-deadline-handoff", ());
                        }
                        if let Ok(mut value) = status.lock() {
                            value.platform_state = "failed";
                            value.last_error_code = Some("deadline_alert_timeout");
                        }
                        break;
                    }
                }
                tokio::select! {_=cancel.cancelled()=>break,_=handoffs.wake.notified()=>{},_=tokio::time::sleep(std::time::Duration::from_millis(500))=>{}}
            }
            // Explicit close cancels the platform projection after the last
            // acknowledged step. An unknown callback is never called drained.
            if !timed_out {
                let mut stop = tauri::async_runtime::spawn_blocking(move || {
                    let alerts = app
                        .android_timeblock_end_alert()
                        .sync_beta_deadlines(vec![], None, false)
                        .is_ok();
                    let keepalive = app
                        .android_runtime_keepalive()
                        .set_enabled(false, None, None)
                        .is_ok();
                    alerts && keepalive
                });
                let result =
                    tokio::time::timeout(std::time::Duration::from_secs(6), &mut stop).await;
                if let Ok(mut value) = status.lock() {
                    if matches!(result, Ok(Ok(true))) {
                        value.keepalive_requested = false;
                        value.scheduled_count = 0;
                    } else {
                        value.platform_state = "failed";
                        value.last_error_code = Some("deadline_alert_timeout");
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_settings_projection_is_device_scoped_and_does_not_claim_playback() {
        let status = exomind_android_timeblock_end_alert::BetaDeadlineNotificationChannelState {
            notification_permission: "denied".into(),
            notifications_enabled: false,
            channel_supported: true,
            channel_exists: true,
            channel_importance: "blocked".into(),
            channel_sound_enabled: Some(false),
            settings_available: true,
        };
        let value = serde_json::to_value(status).unwrap();

        assert_eq!(value["notificationPermission"], "denied");
        assert_eq!(value["notificationsEnabled"], false);
        assert_eq!(value["channelSupported"], true);
        assert_eq!(value["channelSoundEnabled"], false);
        assert_eq!(value["settingsAvailable"], true);
        assert!(value.get("profileId").is_none());
        assert!(value.get("soundPlayed").is_none());
        assert!(value.get("audible").is_none());
    }

    #[test]
    fn pre_notification_channel_platform_serializes_global_sound_scope_as_unsupported() {
        let value = serde_json::to_value(
            exomind_android_timeblock_end_alert::BetaDeadlineNotificationChannelState {
                notification_permission: "granted".into(),
                notifications_enabled: true,
                channel_supported: false,
                channel_exists: false,
                channel_importance: "unavailable".into(),
                channel_sound_enabled: None,
                settings_available: true,
            },
        )
        .unwrap();

        assert_eq!(value["channelSupported"], false);
        assert_eq!(value["channelExists"], false);
        assert_eq!(value["channelSoundEnabled"], serde_json::Value::Null);
        assert_eq!(value["settingsAvailable"], true);
        assert!(value.get("profileId").is_none());
    }

    #[test]
    fn android_deadline_projection_serializes_core_block_name_and_note_with_its_scope() {
        let value = serde_json::to_value(
            exomind_android_timeblock_end_alert::BetaDeadlineAlert {
                deadline_id: "deadline-id".into(),
                profile_id: "profile-id".into(),
                block_id: "block-id".into(),
                block_name: "课程复习".into(),
                block_note: "复习公式和例题".into(),
                due_at: 1,
                remaining_ms: 0,
                completed: true,
            },
        )
        .unwrap();

        assert_eq!(value["deadlineId"], "deadline-id");
        assert_eq!(value["profileId"], "profile-id");
        assert_eq!(value["blockId"], "block-id");
        assert_eq!(value["blockName"], "课程复习");
        assert_eq!(value["blockNote"], "复习公式和例题");
    }

    #[tokio::test]
    async fn stop_does_not_treat_timed_out_platform_call_as_drained() {
        let bridge = Bridge::default();
        bridge.status.lock().unwrap().last_error_code = Some("deadline_alert_timeout");
        assert!(matches!(
            bridge.stop().await,
            Err(exomind_beta_host::HostError::Shutdown)
        ));
    }
    #[tokio::test]
    async fn stop_waits_for_its_worker_and_accepts_completed_cleanup() {
        let bridge = Arc::new(Bridge::default());
        bridge.running.store(true, Ordering::Release);
        let own = bridge.clone();
        let work = tokio::spawn(async move {
            own.cancel.cancelled().await;
            own.running.store(false, Ordering::Release);
            own.done.notify_one();
        });
        bridge.stop().await.unwrap();
        work.await.unwrap();
        assert!(!bridge.running.load(Ordering::Acquire));
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

#[tauri::command]
pub(super) fn beta_deadline_handoff_pending(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Option<handoff::Handoff>, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(exomind_beta_host::HostError::Stopped.into());
    }
    state.deadlines.handoffs.pending()
}
#[tauri::command]
pub(super) async fn beta_deadline_handoff_ack(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    handoff_id: uuid::Uuid,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(exomind_beta_host::HostError::Stopped.into());
    }
    state
        .deadlines
        .handoffs
        .acknowledge(handoff_id, &state.deadlines.cancel)
        .await
}

#[tauri::command]
pub(super) fn beta_deadline_alert_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Status, Failure> {
    trusted_window(&window, state.inner())?;
    state
        .deadlines
        .status
        .lock()
        .map(|value| value.clone())
        .map_err(|_| exomind_beta_host::HostError::StatePoisoned.into())
}

/// Device-level notification-channel state is intentionally not profile-scoped.
/// It reports Android configuration, never proof that audio was actually heard.
#[tauri::command]
pub(super) async fn beta_deadline_alert_channel_state(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    #[cfg_attr(not(target_os = "android"), allow(unused_variables))] app: tauri::AppHandle,
) -> Result<BetaDeadlineNotificationChannelState, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(exomind_beta_host::HostError::Stopped.into());
    }

    #[cfg(target_os = "android")]
    {
        use exomind_android_timeblock_end_alert::AndroidTimeblockEndAlertExt;
        tauri::async_runtime::spawn_blocking(move || {
            app.android_timeblock_end_alert()
                .beta_deadline_notification_channel_state()
        })
        .await
        .map_err(|_| Failure {
            code: "deadline_alert_channel_state_unavailable",
            message: "Android 提醒渠道状态暂不可用，请重新读取",
        })?
        .map_err(|_| Failure {
            code: "deadline_alert_channel_state_unavailable",
            message: "Android 提醒渠道状态暂不可用，请重新读取",
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        let unavailable = BetaDeadlineNotificationChannelState::unavailable();
        Ok(unavailable)
    }
}

/// Opens Android's notification channel page only after an explicit user action.
#[tauri::command]
pub(super) async fn beta_deadline_alert_open_channel_settings(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    #[cfg_attr(not(target_os = "android"), allow(unused_variables))] app: tauri::AppHandle,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(Ordering::Acquire) {
        return Err(exomind_beta_host::HostError::Stopped.into());
    }

    #[cfg(target_os = "android")]
    {
        use exomind_android_timeblock_end_alert::AndroidTimeblockEndAlertExt;
        tauri::async_runtime::spawn_blocking(move || {
            app.android_timeblock_end_alert()
                .open_beta_deadline_notification_channel_settings()
        })
        .await
        .map_err(|_| Failure {
            code: "deadline_alert_settings_open_failed",
            message: "无法打开 Android 提醒渠道设置，请从系统应用通知设置中进入",
        })?
        .map_err(|_| Failure {
            code: "deadline_alert_settings_open_failed",
            message: "无法打开 Android 提醒渠道设置，请从系统应用通知设置中进入",
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        Err(Failure {
            code: "deadline_alert_settings_unavailable",
            message: "当前平台没有 Android 通知渠道设置",
        })
    }
}
#[tauri::command]
pub(super) async fn beta_deadline_alert_request_permission(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    app: tauri::AppHandle,
) -> Result<exomind_android_timeblock_end_alert::NotificationPermissionStatus, Failure> {
    trusted_window(&window, state.inner())?;
    #[cfg(target_os = "android")]
    {
        use exomind_android_timeblock_end_alert::AndroidTimeblockEndAlertExt;
        let busy = state.deadlines.permission_busy.clone();
        if busy.swap(true, Ordering::AcqRel) {
            return Err(Failure {
                code: "deadline_alert_busy",
                message: "系统提醒权限请求仍在处理中",
            });
        }
        let mut request = tauri::async_runtime::spawn_blocking(move || {
            struct Release(Arc<AtomicBool>);
            impl Drop for Release {
                fn drop(&mut self) {
                    self.0.store(false, Ordering::Release);
                }
            }
            let _release = Release(busy);
            app.android_timeblock_end_alert()
                .request_notification_permission()
        });
        tokio::time::timeout(std::time::Duration::from_secs(60), &mut request)
            .await
            .map_err(|_| Failure {
                code: "deadline_alert_timeout",
                message: "系统权限请求尚未确认，请在系统完成后刷新",
            })?
            .map_err(|_| Failure {
                code: "deadline_alert_platform_failed",
                message: "系统提醒权限状态暂不可用",
            })?
            .map_err(|_| Failure {
                code: "deadline_alert_platform_failed",
                message: "系统提醒权限请求尚未确认",
            })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(
            exomind_android_timeblock_end_alert::NotificationPermissionStatus {
                state: "unavailable".into(),
            },
        )
    }
}
