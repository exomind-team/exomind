use std::io;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const SHOW_MAIN_ITEM_ID: &str = "system-tray-show-main";
const HIDE_MAIN_ITEM_ID: &str = "system-tray-hide-main";
const QUIT_ITEM_ID: &str = "system-tray-quit";

/// Install and retain the desktop tray icon and its menu.
pub fn install(app: &AppHandle) -> Result<(), io::Error> {
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "default application icon is required for the system tray",
        )
    })?;

    let show_main = MenuItem::with_id(app, SHOW_MAIN_ITEM_ID, "显示外心", true, None::<&str>)
        .map_err(|error| io::Error::other(error.to_string()))?;
    let hide_main = MenuItem::with_id(app, HIDE_MAIN_ITEM_ID, "隐藏到托盘", true, None::<&str>)
        .map_err(|error| io::Error::other(error.to_string()))?;
    let quit = MenuItem::with_id(app, QUIT_ITEM_ID, "退出外心", true, None::<&str>)
        .map_err(|error| io::Error::other(error.to_string()))?;
    let menu = Menu::with_items(app, &[&show_main, &hide_main, &quit])
        .map_err(|error| io::Error::other(error.to_string()))?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip(format!("外心 {}", env!("CARGO_PKG_VERSION")))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MAIN_ITEM_ID => show_main_window(app),
            HIDE_MAIN_ITEM_ID => hide_main_window(app),
            QUIT_ITEM_ID => crate::app_lifecycle::request_exit(app, 0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|error| io::Error::other(error.to_string()))?;

    if !app.manage(SystemTrayState { _icon: tray }) {
        return Err(io::Error::other("system tray state is already registered").into());
    }

    Ok(())
}

/// Keep the tray handle alive for the lifetime of the Tauri app.
struct SystemTrayState {
    _icon: TrayIcon,
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("cannot show the main window from the system tray: window is missing");
        return;
    };

    if let Err(error) = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus())
    {
        log::warn!("failed to show the main window from the system tray: {error}");
    }
}

fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("cannot hide the main window from the system tray: window is missing");
        return;
    };

    if let Err(error) = window.hide() {
        log::warn!("failed to hide the main window to the system tray: {error}");
    }
}
