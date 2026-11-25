use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.exomindtimeblockendalert";

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid Android deadline notification text")]
    InvalidDeadlineNotificationText,
    #[cfg(target_os = "android")]
    #[error("Android monotonic clock unavailable")]
    ClockUnavailable,
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

pub const MAX_BETA_DEADLINE_TITLE_BYTES: usize = 256;
pub const MAX_BETA_DEADLINE_NOTE_BYTES: usize = 512;
const EMPTY_BLOCK_TITLE: &str = "未命名时间块";

/// Project Core-verified block text to one bounded, single-line notification
/// title. The source remains the accepted Core projection; control characters
/// and layout-only line breaks are not sent to Android's notification UI.
pub fn project_deadline_notification_title(value: &str) -> String {
    project_notification_text(value, MAX_BETA_DEADLINE_TITLE_BYTES, EMPTY_BLOCK_TITLE, false)
}

/// Project Core-verified note text to a bounded, single-line notification body.
/// An empty note stays empty so Android can present its neutral fallback.
pub fn project_deadline_notification_note(value: &str) -> String {
    project_notification_text(value, MAX_BETA_DEADLINE_NOTE_BYTES, "", true)
}

fn is_notification_bidi_control(value: char) -> bool {
    matches!(
        value,
        '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
    )
}

fn project_notification_text(
    value: &str,
    max_bytes: usize,
    fallback: &str,
    allow_empty: bool,
) -> String {
    const ELLIPSIS: &str = "…";
    let mut projected = String::new();
    let mut pending_space = false;
    let mut truncated = false;

    for character in value.chars() {
        if is_notification_bidi_control(character) {
            continue;
        }
        if character.is_control() || character.is_whitespace() {
            pending_space = !projected.is_empty();
            continue;
        }

        let separator_bytes = usize::from(pending_space);
        if projected.len() + separator_bytes + character.len_utf8() > max_bytes {
            truncated = true;
            break;
        }
        if pending_space {
            projected.push(' ');
        }
        projected.push(character);
        pending_space = false;
    }

    if truncated {
        while projected.len() + ELLIPSIS.len() > max_bytes {
            projected.pop();
        }
        if ELLIPSIS.len() <= max_bytes {
            projected.push_str(ELLIPSIS);
        }
    }

    let projected = projected.trim().to_owned();
    if projected.is_empty() {
        if allow_empty {
            String::new()
        } else {
            fallback.to_owned()
        }
    } else {
        projected
    }
}

fn is_projected_notification_text(
    value: &str,
    max_bytes: usize,
    fallback: &str,
    allow_empty: bool,
) -> bool {
    value.len() <= max_bytes
        && !value
            .chars()
            .any(|character| character.is_control() || is_notification_bidi_control(character))
        && project_notification_text(value, max_bytes, fallback, allow_empty) == value
}

fn validate_deadline_notification_text(alert: &BetaDeadlineAlert) -> Result<()> {
    if !is_projected_notification_text(
        &alert.block_name,
        MAX_BETA_DEADLINE_TITLE_BYTES,
        EMPTY_BLOCK_TITLE,
        false,
    ) || !is_projected_notification_text(
        &alert.block_note,
        MAX_BETA_DEADLINE_NOTE_BYTES,
        "",
        true,
    ) {
        return Err(Error::InvalidDeadlineNotificationText);
    }
    Ok(())
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
    pub block_name: String,
    pub block_note: String,
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
        for alert in &alerts {
            validate_deadline_notification_text(alert)?;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_projection_flattens_line_breaks_and_keeps_bounded_unicode() {
        assert_eq!(project_deadline_notification_title("  课程\n复习  "), "课程 复习");
        assert_eq!(project_deadline_notification_note("复习\n公式\t与例题"), "复习 公式 与例题");

        let long_name = "计划📚".repeat(100);
        let bounded = project_deadline_notification_title(&long_name);
        assert!(bounded.len() <= MAX_BETA_DEADLINE_TITLE_BYTES);
        assert!(bounded.ends_with('…'));
        assert!(bounded.chars().all(|character| !character.is_control()));
    }

    #[test]
    fn notification_projection_uses_name_fallback_and_preserves_an_empty_note() {
        assert_eq!(project_deadline_notification_title("\n\u{202e}"), EMPTY_BLOCK_TITLE);
        assert_eq!(project_deadline_notification_note("\n\u{202e}"), "");
    }

    #[test]
    fn native_projection_validation_rejects_unbounded_or_unsanitized_text() {
        let mut alert = BetaDeadlineAlert {
            deadline_id: "d".into(),
            profile_id: "p".into(),
            block_id: "b".into(),
            block_name: "课程复习".into(),
            block_note: "复习公式".into(),
            due_at: 1,
            remaining_ms: 0,
            completed: true,
        };
        assert!(validate_deadline_notification_text(&alert).is_ok());

        alert.block_name.push('\n');
        assert!(matches!(
            validate_deadline_notification_text(&alert),
            Err(Error::InvalidDeadlineNotificationText)
        ));

        alert.block_name = "课程复习".into();
        alert.block_note = "很长".repeat(MAX_BETA_DEADLINE_NOTE_BYTES);
        assert!(matches!(
            validate_deadline_notification_text(&alert),
            Err(Error::InvalidDeadlineNotificationText)
        ));
    }
}
