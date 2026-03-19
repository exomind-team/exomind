#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutEvent, ShortcutState};

const DEFAULT_VOICE_SHORTCUT: &str = "Alt+Q";
const DEFAULT_MAIN_WINDOW_SHORTCUT: &str = "Ctrl+E";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_CANCEL_SHORTCUT: &str = "Escape";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_WINDOW_LABEL: &str = "voice-overlay";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_WIDTH: f64 = 560.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VOICE_OVERLAY_HEIGHT: f64 = 240.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const DEFAULT_VOICE_OVERLAY_BOTTOM_MARGIN: i32 = 56;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const MIN_VOICE_OVERLAY_BOTTOM_MARGIN: i32 = 24;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const MAX_VOICE_OVERLAY_BOTTOM_MARGIN: i32 = 160;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static VOICE_SHORTCUT_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static VOICE_CANCEL_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static MAIN_WINDOW_SHORTCUT_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static VOICE_OVERLAY_BOTTOM_MARGIN: AtomicI32 =
    AtomicI32::new(DEFAULT_VOICE_OVERLAY_BOTTOM_MARGIN);

/// Voice shortcut runtime state（运行时快捷键状态）.
#[derive(Default)]
pub struct VoiceShortcutState {
    shortcut: Mutex<String>,
}

/// Main window shortcut runtime state（主窗口快捷键状态）.
#[derive(Default)]
pub struct MainWindowShortcutState {
    shortcut: Mutex<Option<String>>,
    pending_activation: AtomicBool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowContext {
    pub title: Option<String>,
    pub process_name: Option<String>,
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

impl MainWindowShortcutState {
    pub fn new() -> Self {
        Self {
            shortcut: Mutex::new(Some(DEFAULT_MAIN_WINDOW_SHORTCUT.to_string())),
            pending_activation: AtomicBool::new(false),
        }
    }

    fn get(&self) -> Option<String> {
        self.shortcut
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| Some(DEFAULT_MAIN_WINDOW_SHORTCUT.to_string()))
    }

    fn set(&self, shortcut: Option<String>) {
        if let Ok(mut value) = self.shortcut.lock() {
            *value = shortcut;
        }
    }

    fn mark_activation_pending(&self) {
        self.pending_activation.store(true, Ordering::SeqCst);
    }

    fn take_pending_activation(&self) -> bool {
        self.pending_activation.swap(false, Ordering::SeqCst)
    }
}

/// Register global voice shortcut at startup（全局语音快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn register_voice_shortcut(app: &AppHandle, state: &VoiceShortcutState) {
    let shortcut = state.get();
    if let Err(error) = register_shortcut_listener(app, &shortcut) {
        log::warn!("failed to register voice shortcut {shortcut}: {error}");
    }
}

/// Register global main-window shortcut at startup（主窗口快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn register_main_window_shortcut(
    app: &AppHandle,
    state: &MainWindowShortcutState,
    voice_state: &VoiceShortcutState,
) {
    let Some(shortcut) = state.get() else {
        return;
    };

    if shortcut.eq_ignore_ascii_case(&voice_state.get()) {
        log::warn!("skip main window shortcut registration because it conflicts with voice shortcut");
        return;
    }

    if let Err(error) = register_main_window_shortcut_listener(app, &shortcut) {
        log::warn!("failed to register main window shortcut {shortcut}: {error}");
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn register_main_window_shortcut(
    _app: &AppHandle,
    _state: &MainWindowShortcutState,
    _voice_state: &VoiceShortcutState,
) {}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn register_voice_shortcut(_app: &AppHandle, _state: &VoiceShortcutState) {}

/// Apply hotkey change at runtime（运行时热更新快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn apply_voice_shortcut(
    app: &AppHandle,
    state: &VoiceShortcutState,
    main_window_state: &MainWindowShortcutState,
    raw_shortcut: &str,
) -> Result<String, String> {
    let next_shortcut = normalize_shortcut(raw_shortcut)?;
    if let Some(main_window_shortcut) = main_window_state.get() {
        if main_window_shortcut.eq_ignore_ascii_case(&next_shortcut) {
            return Err(format!(
                "shortcut conflicts with main window shortcut {main_window_shortcut}"
            ));
        }
    }
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
    _main_window_state: &MainWindowShortcutState,
    raw_shortcut: &str,
) -> Result<String, String> {
    let next_shortcut = normalize_shortcut(raw_shortcut)?;
    state.set(next_shortcut.clone());
    Ok(next_shortcut)
}

/// Apply main-window hotkey change at runtime（运行时热更新主窗口快捷键）.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn apply_main_window_shortcut(
    app: &AppHandle,
    state: &MainWindowShortcutState,
    voice_state: &VoiceShortcutState,
    raw_shortcut: Option<&str>,
) -> Result<Option<String>, String> {
    let next_shortcut = raw_shortcut
        .map(normalize_shortcut)
        .transpose()?;
    let current_shortcut = state.get();

    if current_shortcut == next_shortcut {
        return Ok(current_shortcut);
    }

    if let Some(next_shortcut_value) = next_shortcut.as_ref() {
        let voice_shortcut = voice_state.get();
        if voice_shortcut.eq_ignore_ascii_case(next_shortcut_value) {
            return Err(format!(
                "shortcut conflicts with voice shortcut {voice_shortcut}"
            ));
        }
    }

    if let Some(current_shortcut_value) = current_shortcut.as_ref() {
        let was_registered = app
            .global_shortcut()
            .is_registered(current_shortcut_value.as_str());
        if was_registered {
            app.global_shortcut()
                .unregister(current_shortcut_value.as_str())
                .map_err(|error| error.to_string())?;
        }
    }

    if let Some(next_shortcut_value) = next_shortcut.as_ref() {
        if let Err(error) = register_main_window_shortcut_listener(app, next_shortcut_value) {
            if let Some(current_shortcut_value) = current_shortcut.as_ref() {
                let _ = register_main_window_shortcut_listener(app, current_shortcut_value);
            }
            return Err(error);
        }
    }

    state.set(next_shortcut.clone());
    Ok(next_shortcut)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn apply_main_window_shortcut(
    _app: &AppHandle,
    state: &MainWindowShortcutState,
    _voice_state: &VoiceShortcutState,
    raw_shortcut: Option<&str>,
) -> Result<Option<String>, String> {
    let next_shortcut = raw_shortcut
        .map(normalize_shortcut)
        .transpose()?;
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
    .shadow(false)
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
fn clamp_overlay_bottom_margin(raw_value: i32) -> i32 {
    raw_value.clamp(
        MIN_VOICE_OVERLAY_BOTTOM_MARGIN,
        MAX_VOICE_OVERLAY_BOTTOM_MARGIN,
    )
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
fn register_main_window_shortcut_listener(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let _ = app.global_shortcut().unregister(shortcut);
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            handle_main_window_shortcut_event(app, event);
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
fn handle_main_window_shortcut_event(app: &AppHandle, event: ShortcutEvent) {
    match event.state {
        ShortcutState::Pressed => {
            if MAIN_WINDOW_SHORTCUT_KEY_DOWN.swap(true, Ordering::SeqCst) {
                return;
            }
            let _ = toggle_main_window_from_shortcut(app);
        }
        ShortcutState::Released => {
            MAIN_WINDOW_SHORTCUT_KEY_DOWN.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn toggle_main_window_from_shortcut(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let is_visible = window.is_visible().map_err(|error| error.to_string())?;
    let is_minimized = window.is_minimized().map_err(|error| error.to_string())?;
    let is_focused = window.is_focused().map_err(|error| error.to_string())?;

    if is_visible && !is_minimized && is_focused {
        window.minimize().map_err(|error| error.to_string())?;
        return Ok(());
    }

    if !is_visible {
        window.show().map_err(|error| error.to_string())?;
    }
    if is_minimized {
        let _ = window.unminimize();
    }
    window.set_focus().map_err(|error| error.to_string())?;
    app.state::<MainWindowShortcutState>().mark_activation_pending();
    app.emit("main-window-shortcut", "activate").ok();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_cancel_shortcut_listener(app: &AppHandle) -> Result<(), String> {
    let _ = app.global_shortcut().unregister(VOICE_CANCEL_SHORTCUT);
    app.global_shortcut()
        .on_shortcut(VOICE_CANCEL_SHORTCUT, |app, _shortcut, event| {
            match event.state {
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
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn unregister_cancel_shortcut(app: &AppHandle) -> Result<(), String> {
    VOICE_CANCEL_KEY_DOWN.store(false, Ordering::SeqCst);
    if !app.global_shortcut().is_registered(VOICE_CANCEL_SHORTCUT) {
        return Ok(());
    }
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

/// Get the current cursor position in screen coordinates.
/// Returns None on failure or on unsupported platforms.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn cursor_position() -> Option<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        // Win32 POINT: x/y are LONG (typedef long), which is always 32-bit on
        // Windows (LLP64), so i32 is the correct Rust mapping.
        // GetCursorPos returns BOOL (typedef int): nonzero = success.
        #[repr(C)]
        struct POINT {
            x: i32,
            y: i32,
        }
        extern "system" {
            fn GetCursorPos(lp_point: *mut POINT) -> i32;
        }
        let mut pt = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut pt) } != 0 {
            return Some((pt.x, pt.y));
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn foreground_window_context() -> ForegroundWindowContext {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    type Hwnd = *mut std::ffi::c_void;
    type Handle = *mut std::ffi::c_void;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowTextLengthW(h_wnd: Hwnd) -> i32;
        fn GetWindowTextW(h_wnd: Hwnd, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowThreadProcessId(h_wnd: Hwnd, lpdw_process_id: *mut u32) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            h_process: Handle,
            dw_flags: u32,
            lp_exe_name: *mut u16,
            lpdw_size: *mut u32,
        ) -> i32;
        fn CloseHandle(h_object: Handle) -> i32;
    }

    fn read_window_title(hwnd: Hwnd) -> Option<String> {
        let length = unsafe { GetWindowTextLengthW(hwnd) };
        if length <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let written = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if written <= 0 {
            return None;
        }
        let os = OsString::from_wide(&buffer[..written as usize]);
        let title = os.to_string_lossy().trim().to_string();
        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    }

    fn read_process_name(process_id: u32) -> Option<String> {
        if process_id == 0 {
            return None;
        }

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if handle.is_null() {
            return None;
        }

        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let success = unsafe {
            QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size)
        };
        unsafe {
            CloseHandle(handle);
        }
        if success == 0 || size == 0 {
            return None;
        }

        let os = OsString::from_wide(&buffer[..size as usize]);
        let full_path = os.to_string_lossy().trim().to_string();
        if full_path.is_empty() {
            return None;
        }

        Path::new(&full_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.trim().is_empty())
    }

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return ForegroundWindowContext::default();
    }

    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut process_id);
    }

    ForegroundWindowContext {
        title: read_window_title(hwnd),
        process_name: read_process_name(process_id),
    }
}

#[cfg(all(not(target_os = "windows"), not(any(target_os = "android", target_os = "ios"))))]
fn foreground_window_context() -> ForegroundWindowContext {
    ForegroundWindowContext::default()
}

/// Returns true if the point (cx, cy) is within the monitor rect defined by
/// (pos_x, pos_y, width, height). Right and bottom edges are exclusive,
/// matching Windows `MonitorFromPoint` semantics.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn cursor_in_monitor(cx: i32, cy: i32, pos_x: i32, pos_y: i32, width: u32, height: u32) -> bool {
    // width/height are u32; cast to i32 is safe for all real display sizes (<= 32767 px).
    cx >= pos_x && cy >= pos_y && cx < pos_x + width as i32 && cy < pos_y + height as i32
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_overlay_monitor(app: &AppHandle) -> Result<Option<tauri::Monitor>, String> {
    // Prefer the monitor containing the cursor so the overlay appears
    // on whichever screen the user is currently working on.
    if let Some((cx, cy)) = cursor_position() {
        let monitors = app.available_monitors().map_err(|e| e.to_string())?;
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            if cursor_in_monitor(cx, cy, pos.x, pos.y, size.width, size.height) {
                return Ok(Some(monitor));
            }
        }
        // Cursor is in a gap between monitors (non-contiguous layout) or
        // available_monitors() returned an empty list — fall through to main window.
        log::debug!(
            "cursor ({cx},{cy}) not within any monitor rect, falling back to main window monitor"
        );
    }

    // Fallback: use the monitor that contains the main window.
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
    let bottom_margin = clamp_overlay_bottom_margin(
        VOICE_OVERLAY_BOTTOM_MARGIN.load(Ordering::SeqCst),
    );
    let vertical_offset = (work_area_height as i32 - height - bottom_margin).max(0);

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

/// Simulate Enter key press via enigo.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn simulate_enter() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::Return, Direction::Click)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Simulate Enter key press via enigo（移动端不支持）.
#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn simulate_enter() -> Result<(), String> {
    Err("simulate_enter is not supported on mobile targets".to_string())
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

/// Update voice overlay bottom offset（更新语音悬浮窗底部间距）.
#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn voice_overlay_set_bottom_offset(
    app: AppHandle,
    offset: i32,
) -> Result<i32, String> {
    let normalized = clamp_overlay_bottom_margin(offset);
    VOICE_OVERLAY_BOTTOM_MARGIN.store(normalized, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(VOICE_OVERLAY_WINDOW_LABEL) {
        position_voice_overlay(&app, &window)?;
    }
    Ok(normalized)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn voice_overlay_set_bottom_offset(
    _app: AppHandle,
    offset: i32,
) -> Result<i32, String> {
    Ok(offset)
}

/// Update voice shortcut by settings page（设置页更新快捷键）.
#[tauri::command]
pub async fn voice_shortcut_set(
    app: AppHandle,
    state: State<'_, VoiceShortcutState>,
    main_window_state: State<'_, MainWindowShortcutState>,
    shortcut: String,
) -> Result<String, String> {
    apply_voice_shortcut(&app, &state, &main_window_state, &shortcut)
}

/// Read current voice shortcut（读取当前快捷键）.
#[tauri::command]
pub async fn voice_shortcut_get(state: State<'_, VoiceShortcutState>) -> Result<String, String> {
    Ok(state.get())
}

/// Update main window shortcut by settings page（设置页更新主窗口快捷键）.
#[tauri::command]
pub async fn main_window_shortcut_set(
    app: AppHandle,
    state: State<'_, MainWindowShortcutState>,
    voice_state: State<'_, VoiceShortcutState>,
    shortcut: Option<String>,
) -> Result<Option<String>, String> {
    apply_main_window_shortcut(&app, &state, &voice_state, shortcut.as_deref())
}

/// Read current main window shortcut（读取当前主窗口快捷键）.
#[tauri::command]
pub async fn main_window_shortcut_get(
    state: State<'_, MainWindowShortcutState>,
) -> Result<Option<String>, String> {
    Ok(state.get())
}

#[tauri::command]
pub async fn main_window_shortcut_take_pending_activation(
    state: State<'_, MainWindowShortcutState>,
) -> Result<bool, String> {
    Ok(state.take_pending_activation())
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

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn foreground_window_get() -> Result<ForegroundWindowContext, String> {
    Ok(foreground_window_context())
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn foreground_window_get() -> Result<ForegroundWindowContext, String> {
    Ok(ForegroundWindowContext::default())
}

#[cfg(test)]
mod tests {
    use super::{calculate_overlay_position, cursor_in_monitor};

    #[test]
    fn calculate_overlay_position_centers_bottom_on_primary_work_area() {
        let (x, y) = calculate_overlay_position(0, 0, 1920, 1080);
        assert_eq!(x, 680);
        assert_eq!(y, 784);
    }

    #[test]
    fn calculate_overlay_position_respects_monitor_offset() {
        let (x, y) = calculate_overlay_position(1920, 40, 1920, 1040);
        assert_eq!(x, 2600);
        assert_eq!(y, 784);
    }

    // --- cursor_in_monitor hit-test tests ---

    #[test]
    fn cursor_in_monitor_returns_true_when_cursor_is_inside() {
        // Cursor at center of a 1920x1080 monitor starting at (0,0)
        assert!(cursor_in_monitor(960, 540, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_true_at_top_left_corner() {
        // Top-left corner is inclusive
        assert!(cursor_in_monitor(0, 0, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_false_at_right_edge_exclusive() {
        // Right edge (x == pos_x + width) is exclusive, matching Windows semantics
        assert!(!cursor_in_monitor(1920, 540, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_false_at_bottom_edge_exclusive() {
        // Bottom edge (y == pos_y + height) is exclusive
        assert!(!cursor_in_monitor(960, 1080, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_true_at_last_pixel_inside() {
        // One pixel before right/bottom edge is still inside
        assert!(cursor_in_monitor(1919, 1079, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_false_when_cursor_is_to_the_left() {
        assert!(!cursor_in_monitor(-1, 540, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_returns_false_when_cursor_is_above() {
        assert!(!cursor_in_monitor(960, -1, 0, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_handles_secondary_monitor_with_positive_offset() {
        // Secondary monitor to the right: starts at x=1920
        assert!(cursor_in_monitor(2400, 400, 1920, 0, 1920, 1080));
        assert!(!cursor_in_monitor(1919, 400, 1920, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_handles_monitor_with_negative_offset() {
        // Secondary monitor to the left of primary: starts at x=-1920
        assert!(cursor_in_monitor(-960, 540, -1920, 0, 1920, 1080));
        assert!(!cursor_in_monitor(0, 540, -1920, 0, 1920, 1080));
    }

    #[test]
    fn cursor_in_monitor_handles_monitor_with_y_offset() {
        // Monitor with taskbar offset: work area starts at y=40
        assert!(cursor_in_monitor(960, 100, 0, 40, 1920, 1000));
        assert!(!cursor_in_monitor(960, 39, 0, 40, 1920, 1000));
    }
}
