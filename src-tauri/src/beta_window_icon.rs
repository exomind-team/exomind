//! The Windows runtime sets the title icon and taskbar icon independently.
//! Beta12 had a valid small logo but a null ICON_BIG (verified on its exact EXE).
pub(super) fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{LPARAM, WPARAM},
            UI::WindowsAndMessaging::{
                SendMessageW, ICON_BIG, ICON_SMALL2, WM_GETICON, WM_SETICON,
            },
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        // SAFETY: hwnd belongs to this live Tauri window. Borrow the icon Tao
        // already owns for this window; WM_SETICON does not transfer ownership.
        // No later Beta path replaces its small icon. A future dynamic-icon
        // feature must update both slots before releasing the old icon.
        unsafe {
            let icon = SendMessageW(hwnd, WM_GETICON, Some(WPARAM(ICON_SMALL2 as usize)), None);
            if icon.0 == 0 {
                return Err("the window has no application logo".into());
            }
            SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(ICON_BIG as usize)),
                Some(LPARAM(icon.0)),
            );
        }
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}
