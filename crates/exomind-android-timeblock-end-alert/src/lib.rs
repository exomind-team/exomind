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

pub struct AndroidTimeblockEndAlert<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidTimeblockEndAlert<R> {
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
