use std::{
    ffi::c_void,
    mem::size_of,
    sync::{Mutex, OnceLock},
};

use tauri::WebviewWindow;
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{
            DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_RIGHT,
            ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABN_POSCHANGED, APPBARDATA,
        },
        WindowsAndMessaging::{GetWindowRect, MoveWindow},
    },
};

use super::{
    geometry::{right_edge_rect, Rect},
    AppBarStatus, Bounds,
};

const APPBAR_CALLBACK_MESSAGE: u32 = 0x8001; // WM_APP + 1
const APPBAR_SUBCLASS_ID: usize = 0x4558_4F42; // "EXOB"
const MIN_WIDTH_DIP: f64 = 220.0;
const MAX_WIDTH_DIP: f64 = 720.0;

#[derive(Clone, Copy, Debug)]
struct RuntimeState {
    registered: bool,
    hwnd: isize,
    width_dip: f64,
    restore_bounds: Option<Bounds>,
    bounds: Option<Bounds>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            registered: false,
            hwnd: 0,
            width_dip: 0.0,
            restore_bounds: None,
            bounds: None,
        }
    }
}

static STATE: OnceLock<Mutex<RuntimeState>> = OnceLock::new();

fn state() -> &'static Mutex<RuntimeState> {
    STATE.get_or_init(|| Mutex::new(RuntimeState::default()))
}

fn hwnd_from_value(value: isize) -> HWND {
    HWND(value as *mut c_void)
}

fn to_bounds(rect: RECT) -> Bounds {
    Bounds {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    }
}

fn to_rect(bounds: Bounds) -> RECT {
    RECT {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
    }
}

fn snapshot() -> RuntimeState {
    state().lock().map(|guard| *guard).unwrap_or_default()
}

pub fn status() -> AppBarStatus {
    let current = snapshot();
    AppBarStatus {
        registered: current.registered,
        edge: "right",
        width_dip: current.width_dip,
        bounds: current.bounds,
    }
}

fn monitor_rect(hwnd: HWND) -> Result<RECT, String> {
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        Ok(info.rcMonitor)
    } else {
        Err("读取显示器范围失败 / GetMonitorInfoW failed".into())
    }
}

fn physical_width(hwnd: HWND, width_dip: f64) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    (width_dip * dpi as f64 / 96.0).round() as i32
}

fn position(hwnd: HWND, width_dip: f64) -> Result<Bounds, String> {
    let monitor = monitor_rect(hwnd)?;
    let monitor_width = monitor.right - monitor.left;
    let width_px = physical_width(hwnd, width_dip).clamp(1, monitor_width);
    let proposed = RECT {
        left: monitor.right - width_px,
        top: monitor.top,
        right: monitor.right,
        bottom: monitor.bottom,
    };
    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uEdge: ABE_RIGHT,
        rc: proposed,
        ..Default::default()
    };

    unsafe {
        SHAppBarMessage(ABM_QUERYPOS, &mut data);
    }

    let approved = right_edge_rect(
        Rect {
            left: data.rc.left,
            top: data.rc.top,
            right: data.rc.right,
            bottom: data.rc.bottom,
        },
        width_px,
    );
    data.rc = RECT {
        left: approved.left,
        top: approved.top,
        right: approved.right,
        bottom: approved.bottom,
    };

    unsafe {
        SHAppBarMessage(ABM_SETPOS, &mut data);
        MoveWindow(
            hwnd,
            data.rc.left,
            data.rc.top,
            data.rc.right - data.rc.left,
            data.rc.bottom - data.rc.top,
            true,
        )
        .map_err(|error| format!("移动 AppBar 窗口失败 / MoveWindow failed: {error}"))?;
    }

    Ok(to_bounds(data.rc))
}

unsafe extern "system" fn appbar_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    if message == APPBAR_CALLBACK_MESSAGE && wparam.0 as u32 == ABN_POSCHANGED {
        let current = snapshot();
        if current.registered && current.hwnd == hwnd.0 as isize {
            if let Ok(bounds) = position(hwnd, current.width_dip) {
                if let Ok(mut guard) = state().lock() {
                    guard.bounds = Some(bounds);
                }
            }
        }
    }

    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

pub fn dock_right(window: &WebviewWindow, width_dip: f64) -> Result<AppBarStatus, String> {
    if !width_dip.is_finite() || !(MIN_WIDTH_DIP..=MAX_WIDTH_DIP).contains(&width_dip) {
        return Err(format!(
            "宽度必须在 {MIN_WIDTH_DIP:.0}–{MAX_WIDTH_DIP:.0} DIP 之间 / width is out of range"
        ));
    }

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("获取 Tauri HWND 失败 / failed to get HWND: {error}"))?;
    let hwnd_value = hwnd.0 as isize;
    let current = snapshot();

    // 已经注册同一窗口：只更新宽度
    // Same window already registered: only update width.
    if current.registered && current.hwnd == hwnd_value {
        if let Ok(mut guard) = state().lock() {
            guard.width_dip = width_dip;
        }
        let bounds = position(hwnd, width_dip)?;
        if let Ok(mut guard) = state().lock() {
            guard.bounds = Some(bounds);
        }
        return Ok(status());
    }

    // 已有其他窗口注册：先解除
    // Another window is registered: release it first.
    if current.registered {
        undock(window)?;
    }

    let mut original = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut original) }
        .map_err(|error| format!("读取原窗口位置失败 / GetWindowRect failed: {error}"))?;

    if !unsafe { SetWindowSubclass(hwnd, Some(appbar_subclass_proc), APPBAR_SUBCLASS_ID, 0) }
        .as_bool()
    {
        return Err("安装 AppBar 窗口回调失败 / SetWindowSubclass failed".into());
    }

    if let Ok(mut guard) = state().lock() {
        *guard = RuntimeState {
            registered: true,
            hwnd: hwnd_value,
            width_dip,
            restore_bounds: Some(to_bounds(original)),
            bounds: None,
        };
    }

    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: APPBAR_CALLBACK_MESSAGE,
        ..Default::default()
    };
    if unsafe { SHAppBarMessage(ABM_NEW, &mut data) } == 0 {
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(appbar_subclass_proc), APPBAR_SUBCLASS_ID);
        }
        if let Ok(mut guard) = state().lock() {
            *guard = RuntimeState::default();
        }
        return Err("Windows 拒绝注册 AppBar / ABM_NEW failed".into());
    }

    match position(hwnd, width_dip) {
        Ok(bounds) => {
            if let Ok(mut guard) = state().lock() {
                guard.bounds = Some(bounds);
            }
            Ok(status())
        }
        Err(error) => {
            let _ = undock(window);
            Err(error)
        }
    }
}

pub fn undock(_window: &WebviewWindow) -> Result<AppBarStatus, String> {
    let current = snapshot();
    if !current.registered || current.hwnd == 0 {
        return Ok(status());
    }

    if let Ok(mut guard) = state().lock() {
        guard.registered = false;
        guard.bounds = None;
    }

    let hwnd = hwnd_from_value(current.hwnd);
    let mut data = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        ..Default::default()
    };
    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        let _ = RemoveWindowSubclass(hwnd, Some(appbar_subclass_proc), APPBAR_SUBCLASS_ID);
    }

    if let Some(restore) = current.restore_bounds {
        let rect = to_rect(restore);
        unsafe {
            MoveWindow(
                hwnd,
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
                true,
            )
            .map_err(|error| format!("恢复原窗口位置失败 / restore MoveWindow failed: {error}"))?;
        }
    }

    if let Ok(mut guard) = state().lock() {
        *guard = RuntimeState::default();
    }
    Ok(status())
}
