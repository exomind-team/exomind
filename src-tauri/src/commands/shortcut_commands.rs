use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Register the Alt+Q PTT (Push-To-Talk) global shortcut.
/// Emits "voice-shortcut" event with payload "start" on press and "stop" on release.
pub fn register_voice_shortcut(app: &AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);

    if let Err(e) = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        match event.state {
            ShortcutState::Pressed => {
                app.emit("voice-shortcut", "start").ok();
                let _ = voice_overlay_show_internal(app);
            }
            ShortcutState::Released => {
                app.emit("voice-shortcut", "stop").ok();
            }
        }
    }) {
        eprintln!("[shortcut] failed to register voice shortcut Alt+Q: {e}");
    }
}

/// Simulate Ctrl+V paste via enigo.
#[tauri::command]
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

/// 内部函数：显示悬浮窗（供 register_voice_shortcut 调用）
fn voice_overlay_show_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let _voice_window = WebviewWindowBuilder::new(
        app,
        "voice-overlay",
        WebviewUrl::App("voice-overlay.html".into()),
    )
    .title("ExoMind Voice")
    .inner_size(220.0, 52.0)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 显示语音悬浮窗（Tauri command，供前端调用）
#[tauri::command]
pub async fn voice_overlay_show(app: AppHandle) -> Result<(), String> {
    voice_overlay_show_internal(&app)
}

/// 隐藏语音悬浮窗（不销毁，下次复用）
#[tauri::command]
pub async fn voice_overlay_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
