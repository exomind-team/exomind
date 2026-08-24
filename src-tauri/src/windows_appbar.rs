use tauri::AppHandle;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::appbar;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const ACTION_DOCK_LABEL: &str = "action-dock";

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn ensure_action_dock_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(ACTION_DOCK_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        ACTION_DOCK_LABEL,
        WebviewUrl::App("action-dock.html".into()),
    )
    .title("ExoMind Dock")
    .inner_size(360.0, 800.0)
    .decorations(false)
    .resizable(false)
    .visible(false) // 隐藏直到停靠 / hidden until docked
    .build()
    .map_err(|error| format!("创建 action-dock 窗口失败: {error}"))?;

    Ok(window)
}

/// 停靠 action-dock 窗口到桌面右侧，使其他最大化窗口自动避让。
/// Dock the action-dock window to the right edge, shrinking the work area for other maximized windows.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn windows_appbar_attach_right(
    app: AppHandle,
    width_dip: f64,
) -> Result<appbar::AppBarStatus, String> {
    let window = ensure_action_dock_window(&app)?;
    window
        .show()
        .map_err(|error| format!("显示 action-dock 窗口失败: {error}"))?;
    appbar::dock_right(&window, width_dip)
}

/// 调整已停靠窗口的宽度。
/// Resize the docked window width.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn windows_appbar_resize(
    app: AppHandle,
    width_dip: f64,
) -> Result<appbar::AppBarStatus, String> {
    let window = app
        .get_webview_window(ACTION_DOCK_LABEL)
        .ok_or("action-dock 窗口不存在 / action-dock window not found")?;
    appbar::dock_right(&window, width_dip)
}

/// 释放 AppBar 注册并隐藏 action-dock 窗口。
/// Release the AppBar registration and hide the action-dock window.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn windows_appbar_detach(app: AppHandle) -> Result<appbar::AppBarStatus, String> {
    let Some(window) = app.get_webview_window(ACTION_DOCK_LABEL) else {
        return Ok(appbar::status());
    };
    let result = appbar::undock(&window)?;
    let _ = window.hide();
    Ok(result)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn mobile_appbar_unsupported() -> Result<appbar::AppBarStatus, String> {
    Err("Windows AppBar 仅支持桌面端 / Windows AppBar is desktop-only".into())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn windows_appbar_attach_right(
    _app: AppHandle,
    _width_dip: f64,
) -> Result<appbar::AppBarStatus, String> {
    mobile_appbar_unsupported()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn windows_appbar_resize(
    _app: AppHandle,
    _width_dip: f64,
) -> Result<appbar::AppBarStatus, String> {
    mobile_appbar_unsupported()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub fn windows_appbar_detach(_app: AppHandle) -> Result<appbar::AppBarStatus, String> {
    mobile_appbar_unsupported()
}

/// 退出时清理：释放 AppBar 注册，恢复桌面工作区。
/// Cleanup on exit: release AppBar, restore desktop work area.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn detach_on_shutdown(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(ACTION_DOCK_LABEL) {
        if let Err(error) = appbar::undock(&window) {
            log::warn!("AppBar 退出清理失败 / shutdown detach failed: {error}");
        }
    }
}
