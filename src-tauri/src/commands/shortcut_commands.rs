#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, State};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutEvent, ShortcutState};

const DEFAULT_VOICE_SHORTCUT: &str = "Alt+Q";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_CANCEL_SHORTCUT: &str = "Escape";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_WINDOW_LABEL: &str = "voice-overlay";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_WIDTH: f64 = 220.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_HEIGHT: f64 = 52.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_BOTTOM_MARGIN: i32 = 32;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static VOICE_SHORTCUT_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static VOICE_CANCEL_KEY_DOWN: AtomicBool = AtomicBool::new(false);

/// Voice shortcut runtime state（运行时快捷键状态）.
#[derive(Default)]
pub struct VoiceShortcutState {
    shortcut: Mutex<String>,
}

impl VoiceShortcutState {
    pub fn new() -> Self {
        Self {
            shortcut: Mutex::new(DEFAULT_VOICE_SHORTCUT.to_string()),
        }
    }

    fn get(&self) -> String {
        self.shortcut
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| DEFAULT_VOICE_SHORTCUT.to_string())
    }

    fn set(&self, shortcut: String) {
        if let Ok(mut value) = self.shortcut.lock() {
            *value = shortcut;
        }
    }
}

/// Register global voice shortcut at startup（全局语音快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn register_voice_shortcut(app: &AppHandle, state: &VoiceShortcutState) {
    let shortcut = state.get();
    if let Err(error) = register_shortcut_listener(app, &shortcut) {
        eprintln!("[shortcut] failed to register voice shortcut {shortcut}: {error}");
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn register_voice_shortcut(_app: &AppHandle, _state: &VoiceShortcutState) {}

/// Apply hotkey change at runtime（运行时热更新快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn apply_voice_shortcut(
    app: &AppHandle,
    state: &VoiceShortcutState,
    raw_shortcut: &str,
) -> Result<String, String> {
    let next_shortcut = normalize_shortcut(raw_shortcut)?;
    let current_shortcut = state.get();

    if current_shortcut.eq_ignore_ascii_case(&next_shortcut) {
        return Ok(current_shortcut);
    }

    let was_registered = app
        .global_shortcut()
        .is_registered(current_shortcut.as_str());
    if was_registered {
        app.global_shortcut()
            .unregister(current_shortcut.as_str())
            .map_err(|error| error.to_string())?;
    }

    if let Err(error) = register_shortcut_listener(app, &next_shortcut) {
        if was_registered {
            let _ = register_shortcut_listener(app, &current_shortcut);
        }
        return Err(error);
    }

    state.set(next_shortcut.clone());
    Ok(next_shortcut)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn apply_voice_shortcut(
    _app: &AppHandle,
    state: &VoiceShortcutState,
    raw_shortcut: &str,
) -> Result<String, String> {
    let next_shortcut = normalize_shortcut(raw_shortcut)?;
    state.set(next_shortcut.clone());
    Ok(next_shortcut)
}

/// Pre-create overlay window hidden（预热悬浮窗）to avoid first-open white flash（首开白屏）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn ensure_voice_overlay_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(VOICE_OVERLAY_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        VOICE_OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("voice-overlay.html".into()),
    )
    .title("ExoMind Voice")
    .inner_size(VOICE_OVERLAY_WIDTH, VOICE_OVERLAY_HEIGHT)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    let window = builder.build().map_err(|error| error.to_string())?;

    position_voice_overlay(app, &window)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn ensure_voice_overlay_window(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

fn normalize_shortcut(raw_shortcut: &str) -> Result<String, String> {
    let normalized = raw_shortcut.trim();
    if normalized.is_empty() {
        return Err("voice shortcut cannot be empty".to_string());
    }
    Ok(normalized.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_shortcut_listener(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    // Make registration idempotent（幂等）for hot-reload / duplicate init paths.
    let _ = app.global_shortcut().unregister(shortcut);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            handle_shortcut_event(app, event);
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn handle_shortcut_event(app: &AppHandle, event: ShortcutEvent) {
    match event.state {
        ShortcutState::Pressed => {
            // Debounce long-press key repeat（长按重复按键去抖）.
            if VOICE_SHORTCUT_KEY_DOWN.swap(true, Ordering::SeqCst) {
                return;
            }
            app.emit("voice-shortcut", "start").ok();
            let _ = voice_overlay_show_internal(app);
        }
        ShortcutState::Released => {
            VOICE_SHORTCUT_KEY_DOWN.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_cancel_shortcut_listener(app: &AppHandle) -> Result<(), String> {
    let _ = app.global_shortcut().unregister(VOICE_CANCEL_SHORTCUT);
    app.global_shortcut()
        .on_shortcut(VOICE_CANCEL_SHORTCUT, |app, _shortcut, event| match event.state {
            ShortcutState::Pressed => {
                if VOICE_CANCEL_KEY_DOWN.swap(true, Ordering::SeqCst) {
                    return;
                }
                app.emit("voice-shortcut", "cancel").ok();
                let _ = voice_overlay_hide_internal(app);
            }
            ShortcutState::Released => {
                VOICE_CANCEL_KEY_DOWN.store(false, Ordering::SeqCst);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn unregister_cancel_shortcut(app: &AppHandle) -> Result<(), String> {
    VOICE_CANCEL_KEY_DOWN.store(false, Ordering::SeqCst);
    app.global_shortcut()
        .unregister(VOICE_CANCEL_SHORTCUT)
        .map_err(|error| error.to_string())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn register_cancel_shortcut_listener(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn unregister_cancel_shortcut(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_overlay_monitor(app: &AppHandle) -> Result<Option<tauri::Monitor>, String> {
    if let Some(main_window) = app.get_webview_window("main") {
        let current_monitor = main_window
            .current_monitor()
            .map_err(|error| error.to_string())?;
        if current_monitor.is_some() {
            return Ok(current_monitor);
        }
    }

    app.primary_monitor().map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn calculate_overlay_position(
    work_area_x: i32,
    work_area_y: i32,
    work_area_width: u32,
    work_area_height: u32,
) -> (i32, i32) {
    let width = VOICE_OVERLAY_WIDTH.round() as i32;
    let height = VOICE_OVERLAY_HEIGHT.round() as i32;
    let horizontal_center_offset = ((work_area_width as i32 - width) / 2).max(0);
    let vertical_offset = (work_area_height as i32 - height - VOICE_OVERLAY_BOTTOM_MARGIN).max(0);

    (
        work_area_x + horizontal_center_offset,
        work_area_y + vertical_offset,
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn position_voice_overlay(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = resolve_overlay_monitor(app)? else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let (x, y) = calculate_overlay_position(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

/// Simulate Ctrl+V paste via enigo.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn simulate_paste() -> Result<(), String> {
    // Run in blocking thread since enigo is not Send on all platforms
    tokio::task::spawn_blocking(|| {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Simulate Ctrl+V paste via enigo（移动端不支持）.
#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn simulate_paste() -> Result<(), String> {
    Err("simulate_paste is not supported on mobile targets".to_string())
}

/// 内部函数：显示悬浮窗（供 register_voice_shortcut 调用）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn voice_overlay_show_internal(app: &AppHandle) -> Result<(), String> {
    ensure_voice_overlay_window(app)?;
    if let Some(window) = app.get_webview_window(VOICE_OVERLAY_WINDOW_LABEL) {
        position_voice_overlay(app, &window)?;
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn voice_overlay_hide_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(VOICE_OVERLAY_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn voice_overlay_hide_internal(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// 显示语音悬浮窗（Tauri command，供前端调用）
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn voice_overlay_show(app: AppHandle) -> Result<(), String> {
    voice_overlay_show_internal(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn voice_overlay_show(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

/// 隐藏语音悬浮窗（不销毁，下次复用）
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn voice_overlay_hide(app: AppHandle) -> Result<(), String> {
    voice_overlay_hide_internal(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn voice_overlay_hide(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

/// Update voice shortcut by settings page（设置页更新快捷键）.
#[tauri::command]
pub async fn voice_shortcut_set(
    app: AppHandle,
    state: State<'_, VoiceShortcutState>,
    shortcut: String,
) -> Result<String, String> {
    apply_voice_shortcut(&app, &state, &shortcut)
}

/// Read current voice shortcut（读取当前快捷键）.
#[tauri::command]
pub async fn voice_shortcut_get(state: State<'_, VoiceShortcutState>) -> Result<String, String> {
    Ok(state.get())
}

/// Sync recording lifecycle（同步录音生命周期）to arm/disarm global Esc cancel.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn voice_recording_set_active(app: AppHandle, active: bool) -> Result<(), String> {
    if active {
        register_cancel_shortcut_listener(&app)
    } else {
        unregister_cancel_shortcut(&app)
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn voice_recording_set_active(_app: AppHandle, _active: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::calculate_overlay_position;

    #[test]
    fn calculate_overlay_position_centers_bottom_on_primary_work_area() {
        let (x, y) = calculate_overlay_position(0, 0, 1920, 1080);
        assert_eq!(x, 850);
        assert_eq!(y, 996);
    }

    #[test]
    fn calculate_overlay_position_respects_monitor_offset() {
        let (x, y) = calculate_overlay_position(1920, 40, 1920, 1040);
        assert_eq!(x, 2770);
        assert_eq!(y, 996);
    }
}
