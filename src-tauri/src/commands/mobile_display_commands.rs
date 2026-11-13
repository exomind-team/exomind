/// System bars are owned by the Android Activity; desktop/Web keep their own
/// existing fullscreen behavior. The Activity reapplies this mode after focus
/// and orientation changes, without relying on WebView CSS safe-area support.
#[tauri::command]
pub async fn mobile_fullscreen_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, enabled);
        Err("mobile fullscreen is only supported on Android".to_string())
    }

    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let webview = app
            .get_webview("main")
            .ok_or_else(|| "main Android WebView is unavailable".to_string())?;
        let (send, receive) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |webview| {
                webview.jni_handle().exec(move |env, activity, _| {
                    let result = env
                        .call_method(activity, "setExomindFullscreen", "(Z)V", &[enabled.into()])
                        .map(|_| ())
                        .map_err(|error| {
                            let message = format!("failed to set Android fullscreen: {error}");
                            // JNI errors leave Java exceptions pending on this shared UI
                            // thread. Clear them before returning a recoverable command error.
                            match env.exception_clear() {
                                Ok(()) => message,
                                Err(clear_error) => format!(
                                    "{message}; failed to clear Java exception: {clear_error}"
                                ),
                            }
                        });
                    let _ = send.send(result);
                });
            })
            .map_err(|error| format!("Android display handle unavailable: {error}"))?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receive)
            .await
            .map_err(|_| "Android fullscreen update timed out".to_string())?
            .map_err(|_| "Android fullscreen update was interrupted".to_string())?
    }
}
