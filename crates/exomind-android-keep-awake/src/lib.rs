use serde::Serialize;
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.exomindkeepawake";

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
struct KeepAwakePayload {
    enabled: bool,
}

pub struct AndroidKeepAwake<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidKeepAwake<R> {
    pub fn set_enabled(&self, enabled: bool) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin("setEnabled", KeepAwakePayload { enabled })
                .map_err(Into::into)
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = enabled;
            Ok(())
        }
    }
}

pub trait AndroidKeepAwakeExt<R: Runtime> {
    fn android_keep_awake(&self) -> &AndroidKeepAwake<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidKeepAwakeExt<R> for T {
    fn android_keep_awake(&self) -> &AndroidKeepAwake<R> {
        self.state::<AndroidKeepAwake<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("android-keep-awake")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "FocusKeepAwakePlugin")?;

            app.manage(AndroidKeepAwake {
                #[cfg(target_os = "android")]
                mobile_plugin_handle: handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });
            Ok(())
        })
        .build()
}
