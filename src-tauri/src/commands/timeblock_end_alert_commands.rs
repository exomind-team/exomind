#[cfg(target_os = "android")]
use exomind_android_timeblock_end_alert::AndroidTimeblockEndAlertExt;
use exomind_android_timeblock_end_alert::{
    NotificationPermissionStatus, PendingTimeblockEndHandoff, ScheduleTimeblockEndAlertRequest,
};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeblockEndAlertNotificationPermissionPayload {
    state: String,
}

#[tauri::command]
pub fn timeblock_end_alert_schedule(
    app: AppHandle,
    #[cfg_attr(not(target_os = "android"), allow(unused_variables))]
    request: ScheduleTimeblockEndAlertRequest,
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, request);
        return Err("timeblock end alert is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_timeblock_end_alert()
            .schedule_end_alert(request)
            .map_err(|error| format!("failed to schedule timeblock end alert: {error}"))
    }
}

#[tauri::command]
pub fn timeblock_end_alert_cancel(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Err("timeblock end alert is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_timeblock_end_alert()
            .cancel_end_alert()
            .map_err(|error| format!("failed to cancel timeblock end alert: {error}"))
    }
}

#[tauri::command]
pub fn timeblock_end_alert_take_pending_handoff(
    app: AppHandle,
) -> Result<Option<PendingTimeblockEndHandoff>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Err("timeblock end alert is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_timeblock_end_alert()
            .take_pending_handoff()
            .map_err(|error| format!("failed to read pending timeblock end handoff: {error}"))
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn map_notification_permission_status(
    status: NotificationPermissionStatus,
) -> TimeblockEndAlertNotificationPermissionPayload {
    TimeblockEndAlertNotificationPermissionPayload {
        state: status.state,
    }
}

#[tauri::command]
pub fn timeblock_end_alert_notification_permission_state(
    app: AppHandle,
) -> Result<TimeblockEndAlertNotificationPermissionPayload, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Err("timeblock end alert is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_timeblock_end_alert()
            .notification_permission_state()
            .map(map_notification_permission_status)
            .map_err(|error| {
                format!("failed to read timeblock end alert notification permission: {error}")
            })
    }
}

#[tauri::command]
pub fn timeblock_end_alert_notification_permission_request(
    app: AppHandle,
) -> Result<TimeblockEndAlertNotificationPermissionPayload, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Err("timeblock end alert is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_timeblock_end_alert()
            .request_notification_permission()
            .map(map_notification_permission_status)
            .map_err(|error| {
                format!("failed to request timeblock end alert notification permission: {error}")
            })
    }
}
