//! 语音快捷键 & 悬浮窗管理命令
//!
//! Phase 1: 提供悬浮窗的显示/隐藏 Tauri command。
//! Phase 2: 集成 tauri-plugin-global-shortcut PTT 快捷键 + enigo 模拟粘贴。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 显示语音悬浮窗（按需创建，已存在则复用）
#[tauri::command]
pub async fn voice_overlay_show(app: AppHandle) -> Result<(), String> {
    // 尝试获取已存在的窗口
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 首次创建（动态窗口，不依赖 tauri.conf.json 静态声明）
    let _voice_window = WebviewWindowBuilder::new(
        &app,
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

/// 隐藏语音悬浮窗（不销毁，下次复用）
#[tauri::command]
pub async fn voice_overlay_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("voice-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
