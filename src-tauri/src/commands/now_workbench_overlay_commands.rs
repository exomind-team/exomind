use tauri::AppHandle;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::dev_instance_paths::resolve_overlay_webview_data_dir;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const NOW_WORKBENCH_OVERLAY_WINDOW_LABEL: &str = "now-workbench-overlay";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const NOW_WORKBENCH_OVERLAY_WIDTH: f64 = 392.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const NOW_WORKBENCH_OVERLAY_HEIGHT: f64 = 470.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const NOW_WORKBENCH_OVERLAY_MARGIN: i32 = 24;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD: i32 = -30000;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn ensure_now_workbench_overlay_window(app: &AppHandle) -> Result<(), String> {
    if app
        .get_webview_window(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL)
        .is_some()
    {
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        NOW_WORKBENCH_OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("now-workbench-overlay.html".into()),
    )
    .title("ExoMind Now")
    .inner_size(NOW_WORKBENCH_OVERLAY_WIDTH, NOW_WORKBENCH_OVERLAY_HEIGHT)
    .always_on_top(true)
    .decorations(false)
    .shadow(false)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    let builder = if let Some(data_dir) =
        resolve_overlay_webview_data_dir(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL)
    {
        builder.data_directory(data_dir)
    } else {
        builder
    };

    let window = builder.build().map_err(|error| error.to_string())?;
    position_now_workbench_overlay_default(app, &window)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn ensure_now_workbench_overlay_window(_app: &AppHandle) -> Result<(), String> {
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
fn calculate_now_workbench_overlay_position(
    work_area_x: i32,
    work_area_y: i32,
    work_area_width: u32,
    work_area_height: u32,
) -> (i32, i32) {
    let width = NOW_WORKBENCH_OVERLAY_WIDTH.round() as i32;
    let height = NOW_WORKBENCH_OVERLAY_HEIGHT.round() as i32;
    let horizontal_offset = (work_area_width as i32 - width - NOW_WORKBENCH_OVERLAY_MARGIN).max(0);
    let vertical_offset = (work_area_height as i32 - height - NOW_WORKBENCH_OVERLAY_MARGIN).max(0);

    (
        work_area_x + horizontal_offset,
        work_area_y + vertical_offset,
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn is_windows_hidden_window_position(x: i32, y: i32) -> bool {
    x <= WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD
        && y <= WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn overlay_rect_intersects_monitor(
    window_x: i32,
    window_y: i32,
    window_width: u32,
    window_height: u32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> bool {
    let window_right = window_x + window_width as i32;
    let window_bottom = window_y + window_height as i32;
    let monitor_right = monitor_x + monitor_width as i32;
    let monitor_bottom = monitor_y + monitor_height as i32;

    window_x < monitor_right
        && window_right > monitor_x
        && window_y < monitor_bottom
        && window_bottom > monitor_y
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn overlay_position_is_visible_on_any_monitor(
    app: &AppHandle,
    x: i32,
    y: i32,
) -> Result<bool, String> {
    if is_windows_hidden_window_position(x, y) {
        return Ok(false);
    }

    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Ok(true);
    }

    let overlay_width = NOW_WORKBENCH_OVERLAY_WIDTH.round() as u32;
    let overlay_height = NOW_WORKBENCH_OVERLAY_HEIGHT.round() as u32;

    for monitor in monitors {
        let position = monitor.position();
        let size = monitor.size();
        if overlay_rect_intersects_monitor(
            x,
            y,
            overlay_width,
            overlay_height,
            position.x,
            position.y,
            size.width,
            size.height,
        ) {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn position_now_workbench_overlay_default(
    app: &AppHandle,
    window: &WebviewWindow,
) -> Result<(), String> {
    let Some(monitor) = resolve_overlay_monitor(app)? else {
        return Ok(());
    };

    let work_area = monitor.work_area();
    let (x, y) = calculate_now_workbench_overlay_position(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn now_workbench_overlay_show_internal(app: &AppHandle) -> Result<(), String> {
    ensure_now_workbench_overlay_window(app)?;
    if let Some(window) = app.get_webview_window(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL) {
        let current_position = window.outer_position().map_err(|error| error.to_string())?;
        if !overlay_position_is_visible_on_any_monitor(app, current_position.x, current_position.y)?
        {
            position_now_workbench_overlay_default(app, &window)?;
        }
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn now_workbench_overlay_restore_internal(app: &AppHandle) -> Result<(), String> {
    ensure_now_workbench_overlay_window(app)?;
    if let Some(window) = app.get_webview_window(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL) {
        position_now_workbench_overlay_default(app, &window)?;
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn now_workbench_overlay_hide_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn now_workbench_overlay_hide_internal(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_ensure(app: AppHandle) -> Result<(), String> {
    ensure_now_workbench_overlay_window(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_ensure(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_show(app: AppHandle) -> Result<(), String> {
    now_workbench_overlay_show_internal(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_show(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_restore(app: AppHandle) -> Result<(), String> {
    now_workbench_overlay_restore_internal(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_restore(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_hide(app: AppHandle) -> Result<(), String> {
    now_workbench_overlay_hide_internal(&app)
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_hide(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_focus_main(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_focus_main(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn now_workbench_overlay_set_position(
    app: AppHandle,
    x: i32,
    y: i32,
) -> Result<(), String> {
    ensure_now_workbench_overlay_window(&app)?;
    if let Some(window) = app.get_webview_window(NOW_WORKBENCH_OVERLAY_WINDOW_LABEL) {
        if !overlay_position_is_visible_on_any_monitor(&app, x, y)? {
            position_now_workbench_overlay_default(&app, &window)?;
        } else {
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn now_workbench_overlay_set_position(
    _app: AppHandle,
    _x: i32,
    _y: i32,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_now_workbench_overlay_position, is_windows_hidden_window_position,
        overlay_rect_intersects_monitor,
    };

    #[test]
    fn calculate_now_workbench_overlay_position_anchors_bottom_right() {
        let (x, y) = calculate_now_workbench_overlay_position(0, 0, 1920, 1080);
        assert_eq!(x, 1504);
        assert_eq!(y, 586);
    }

    #[test]
    fn calculate_now_workbench_overlay_position_respects_monitor_offset() {
        let (x, y) = calculate_now_workbench_overlay_position(1920, 40, 1920, 1040);
        assert_eq!(x, 3424);
        assert_eq!(y, 586);
    }

    #[test]
    fn treats_windows_hidden_window_sentinel_as_invalid_position() {
        assert!(is_windows_hidden_window_position(-32000, -32000));
        assert!(!is_windows_hidden_window_position(-1920, 40));
        assert!(!is_windows_hidden_window_position(3424, 586));
    }

    #[test]
    fn overlay_rect_intersects_visible_monitor_area_on_multi_screen_layout() {
        assert!(overlay_rect_intersects_monitor(
            2500, 120, 392, 470, 1920, 0, 1920, 1080
        ));
        assert!(overlay_rect_intersects_monitor(
            -1600, 120, 392, 470, -1920, 0, 1920, 1080
        ));
    }

    #[test]
    fn overlay_rect_detects_positions_fully_outside_all_monitors() {
        assert!(!overlay_rect_intersects_monitor(
            4000, 1200, 392, 470, 0, 0, 1920, 1080
        ));
        assert!(!overlay_rect_intersects_monitor(
            -5000, -2000, 392, 470, -1920, 0, 1920, 1080
        ));
    }
}
