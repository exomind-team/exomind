use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Register the Alt+Q PTT (Push-To-Talk) global shortcut.
/// Emits "voice-shortcut" event with payload "start" on press and "stop" on release.
pub fn register_voice_shortcut(app: &AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);

    if let Err(e) = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        match event.state {
            ShortcutState::Pressed => {
                app.emit("voice-shortcut", "start").ok();
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
