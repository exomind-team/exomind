//! Foreground, user-invoked Android clipboard image reading. No background watch.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{plugin::TauriPlugin, Runtime};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    media_type: String,
    data_base64: String,
    file_name: String,
}

#[cfg(target_os = "android")]
struct AndroidClipboard<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn read_image<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<ClipboardImage>, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Deserialize)]
        struct Response {
            image: Option<ClipboardImage>,
        }
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<AndroidClipboard<R>>()
                .0
                .run_mobile_plugin::<Response>("readImage", ())
                .map(|response| response.image)
                .map_err(|_| "无法读取剪贴板图片，请重新复制图片并在当前窗口重试".to_string())
        })
        .await
        .map_err(|_| "剪贴板图片读取中断，请重试".to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("此剪贴板通道仅适用于 Android".to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("exomind-android-clipboard")
        .invoke_handler(tauri::generate_handler![read_image])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(AndroidClipboard(_api.register_android_plugin(
                "app.tauri.exomindclipboard",
                "ClipboardImagePlugin",
            )?));
            Ok(())
        })
        .build()
}
