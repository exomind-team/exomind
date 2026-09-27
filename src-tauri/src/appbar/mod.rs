mod geometry;

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBarStatus {
    pub registered: bool,
    pub edge: &'static str,
    pub width_dip: f64,
    pub bounds: Option<Bounds>,
}

#[cfg(windows)]
mod windows_impl;

#[cfg(windows)]
pub use windows_impl::{dock_right, status, undock};

#[cfg(not(windows))]
pub fn dock_right(_window: &tauri::WebviewWindow, _width_dip: f64) -> Result<AppBarStatus, String> {
    Err("Windows AppBar 仅支持 Windows 桌面 / Windows AppBar is Windows-only".into())
}

#[cfg(not(windows))]
pub fn undock(_window: &tauri::WebviewWindow) -> Result<AppBarStatus, String> {
    Err("Windows AppBar 仅支持 Windows 桌面 / Windows AppBar is Windows-only".into())
}

#[cfg(not(windows))]
pub fn status() -> AppBarStatus {
    AppBarStatus {
        registered: false,
        edge: "right",
        width_dip: 0.0,
        bounds: None,
    }
}
