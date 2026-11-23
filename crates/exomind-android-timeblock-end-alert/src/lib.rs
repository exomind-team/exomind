use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.exomindtimeblockendalert";

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[cfg(target_os = "android")]
    #[error("Android monotonic clock unavailable")]
    ClockUnavailable,
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTimeblockEndAlertRequest {
    pub start_id: String,
    pub title: String,
    pub due_at: i64,
    pub sound_enabled: bool,
    pub auto_open_focus: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTimeblockEndHandoff {
    pub kind: String,
    pub start_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPermissionStatus {
    pub state: String,
}

/// Read-only snapshot of the Android timeblock reminder notification channel.
/// This describes OS configuration only; it does not prove audible playback.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BetaDeadlineNotificationChannelState {
    pub notification_permission: String,
    pub notifications_enabled: bool,
    pub channel_supported: bool,
    pub channel_exists: bool,
    pub channel_importance: String,
    pub channel_sound_enabled: Option<bool>,
    pub settings_available: bool,
}

impl BetaDeadlineNotificationChannelState {
    pub fn unavailable() -> Self {
        Self {
            notification_permission: "unavailable".into(),
            notifications_enabled: false,
            channel_supported: false,
            channel_exists: false,
            channel_importance: "unavailable".into(),
            channel_sound_enabled: None,
            settings_available: false,
        }
    }
}

/// Native-only projection of accepted local operational deadlines. This is
/// separate from Alpha's single timer contract and never authorizes Core writes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BetaDeadlineAlert {
    pub deadline_id: String,
    pub profile_id: String,
    pub block_id: String,
    pub due_at: i64,
    pub remaining_ms: u64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetaDeadlineAlertStatus {
    pub notification_permission: String,
    pub exact_alarm: bool,
    pub scheduled_count: usize,
    pub delivered_count: usize,
    pub pending_handoff: Option<BetaDeadlineHandoff>,
    pub acknowledged_handoff_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetaDeadlineHandoff {
    pub handoff_id: String,
    pub profile_id: String,
    pub block_id: String,
    pub deadline_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BetaDeadlineAlertsRequest {
    alerts: Vec<BetaDeadlineAlert>,
    expires_at_elapsed_ms: u64,
    acknowledge_handoff_id: Option<String>,
    preserve_alerts: bool,
}

pub struct AndroidTimeblockEndAlert<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidTimeblockEndAlert<R> {
    pub fn sync_beta_deadlines(
        &self,
        alerts: Vec<BetaDeadlineAlert>,
        acknowledge_handoff_id: Option<String>,
        preserve_alerts: bool,
    ) -> Result<BetaDeadlineAlertStatus> {
        #[cfg(target_os = "android")]
        {
            let mut sample = std::mem::MaybeUninit::<libc::timespec>::uninit();
            // SAFETY: CLOCK_BOOTTIME writes one ABI-correct timespec to a live
            // aligned allocation. Android elapsedRealtime uses this same clock,
            // including suspend; wall-clock rollback cannot revive queued work.
            if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, sample.as_mut_ptr()) } != 0 {
                return Err(Error::ClockUnavailable);
            }
            let sample = unsafe { sample.assume_init() };
            let now = (sample.tv_sec as u64)
                .saturating_mul(1000)
                .saturating_add(sample.tv_nsec as u64 / 1_000_000);
            self.mobile_plugin_handle
                .run_mobile_plugin(
                    "syncBetaDeadlines",
                    BetaDeadlineAlertsRequest {
                        alerts,
                        expires_at_elapsed_ms: now.saturating_add(5000),
                        acknowledge_handoff_id,
                        preserve_alerts,
                    },
                )
                .map_err(Into::into)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (alerts, acknowledge_handoff_id, preserve_alerts);
            Ok(BetaDeadlineAlertStatus {
                notification_permission: "unavailable".into(),
                exact_alarm: false,
                scheduled_count: 0,
                delivered_count: 0,
                pending_handoff: None,
                acknowledged_handoff_id: None,
            })
        }
    }
    pub fn schedule_end_alert(&self, request: ScheduleTimeblockEndAlertRequest) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("scheduleEndAlert", request)
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = request;
            Ok(())
        }
    }

    pub fn cancel_end_alert(&self) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("cancelEndAlert", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(())
        }
    }

    pub fn take_pending_handoff(&self) -> Result<Option<PendingTimeblockEndHandoff>> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("takePendingHandoff", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(None)
        }
    }

    pub fn notification_permission_state(&self) -> Result<NotificationPermissionStatus> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("notificationPermissionState", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(NotificationPermissionStatus {
                state: "unavailable".to_string(),
            })
        }
    }

    pub fn request_notification_permission(&self) -> Result<NotificationPermissionStatus> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("notificationPermissionRequest", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(NotificationPermissionStatus {
                state: "unavailable".to_string(),
            })
        }
    }

    pub fn beta_deadline_notification_channel_state(
        &self,
    ) -> Result<BetaDeadlineNotificationChannelState> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("notificationChannelState", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(BetaDeadlineNotificationChannelState::unavailable())
        }
    }

    pub fn open_beta_deadline_notification_channel_settings(&self) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("openNotificationChannelSettings", ())
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            Ok(())
        }
    }
}

pub trait AndroidTimeblockEndAlertExt<R: Runtime> {
    fn android_timeblock_end_alert(&self) -> &AndroidTimeblockEndAlert<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidTimeblockEndAlertExt<R> for T {
    fn android_timeblock_end_alert(&self) -> &AndroidTimeblockEndAlert<R> {
        self.state::<AndroidTimeblockEndAlert<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("android-timeblock-end-alert")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle =
                _api.register_android_plugin(PLUGIN_IDENTIFIER, "TimeblockEndAlertPlugin")?;

            app.manage(AndroidTimeblockEndAlert {
                #[cfg(target_os = "android")]
                mobile_plugin_handle: handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });
            Ok(())
        })
        .build()
}
