//! Foreground, user-invoked Android clipboard image reading. No background watch.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{Runtime, plugin::TauriPlugin};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    media_type: String,
    data_base64: String,
    file_name: String,
}

#[cfg(target_os = "android")]
struct AndroidClipboard<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFile {
    pub path: String,
    pub file_name: String,
    pub media_type: String,
}

#[cfg(target_os = "android")]
pub async fn read_files<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<ClipboardFile>, String> {
    #[derive(Deserialize)]
    struct Response {
        files: Vec<ClipboardFile>,
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AndroidClipboard<R>>()
            .0
            .run_mobile_plugin::<Response>("readFiles", ())
            .map(|response| response.files)
            .map_err(|_| "无法读取剪贴板文件，请重新复制或使用附件选择".to_string())
    })
    .await
    .map_err(|_| "剪贴板读取中断".to_string())?
}

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

/// Called only by the Native original adapter after a verified private cache copy.
#[cfg(target_os = "android")]
pub async fn open_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: String,
    media_type: String,
) -> Result<(), String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        path: String,
        media_type: String,
    }
    #[derive(Deserialize)]
    struct Response {
        opened: bool,
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let response = app
            .state::<AndroidClipboard<R>>()
            .0
            .run_mobile_plugin::<Response>("openFile", Args { path, media_type })
            .map_err(|_| "系统打开失败".to_string())?;
        if response.opened {
            Ok(())
        } else {
            Err("系统未接受打开请求".to_string())
        }
    })
    .await
    .map_err(|_| "系统打开中断".to_string())?
}
