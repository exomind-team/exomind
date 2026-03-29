use serde::Serialize;
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.exomindrtkeepalive";

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeepalivePayload {
    enabled: bool,
    title: Option<String>,
    text: Option<String>,
}

pub struct AndroidRuntimeKeepalive<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidRuntimeKeepalive<R> {
    pub fn set_enabled(
        &self,
        enabled: bool,
        title: Option<String>,
        text: Option<String>,
    ) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin(
                    "setEnabled",
                    KeepalivePayload {
                        enabled,
                        title,
                        text,
                    },
                )
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = (enabled, title, text);
            Ok(())
        }
    }
}

pub trait AndroidRuntimeKeepaliveExt<R: Runtime> {
    fn android_runtime_keepalive(&self) -> &AndroidRuntimeKeepalive<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidRuntimeKeepaliveExt<R> for T {
    fn android_runtime_keepalive(&self) -> &AndroidRuntimeKeepalive<R> {
        self.state::<AndroidRuntimeKeepalive<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("android-runtime-keepalive")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle =
                _api.register_android_plugin(PLUGIN_IDENTIFIER, "RuntimeKeepalivePlugin")?;

            app.manage(AndroidRuntimeKeepalive {
                #[cfg(target_os = "android")]
                mobile_plugin_handle: handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });
            Ok(())
        })
        .build()
}
