#[cfg(target_os = "android")]
use exomind_android_keep_awake::AndroidKeepAwakeExt;
use tauri::AppHandle;

#[tauri::command]
pub fn focus_keep_awake_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, enabled);
        return Err("focus keep awake is only supported on Android".to_string());
    }

    #[cfg(target_os = "android")]
    {
        app.android_keep_awake()
            .set_enabled(enabled)
            .map_err(|error| format!("failed to set focus keep awake: {error}"))
    }
}
