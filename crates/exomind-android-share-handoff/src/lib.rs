use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.exomindsharehandoff";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelPayload<'a> {
    handoff_id: &'a str,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct CancelResponse {
    cancelled: bool,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct ReceivingResponse {
    receiving: bool,
}

pub struct AndroidShareHandoff<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidShareHandoff<R> {
    pub fn cancel_receiving(&self, handoff_id: &str) -> Result<bool, Error> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<CancelResponse>(
                    "cancelReceiving",
                    CancelPayload { handoff_id },
                )
                .map(|response| response.cancelled)
                .map_err(Into::into)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = handoff_id;
            Ok(false)
        }
    }

    pub fn is_receiving(&self, handoff_id: &str) -> Result<bool, Error> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<ReceivingResponse>("isReceiving", CancelPayload { handoff_id })
                .map(|response| response.receiving)
                .map_err(Into::into)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = handoff_id;
            Ok(false)
        }
    }
}

pub trait AndroidShareHandoffExt<R: Runtime> {
    fn android_share_handoff(&self) -> &AndroidShareHandoff<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidShareHandoffExt<R> for T {
    fn android_share_handoff(&self) -> &AndroidShareHandoff<R> {
        self.state::<AndroidShareHandoff<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("exomind-android-share-handoff")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "ShareHandoffPlugin")?;
            app.manage(AndroidShareHandoff {
                #[cfg(target_os = "android")]
                handle,
                #[cfg(not(target_os = "android"))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });
            Ok(())
        })
        .build()
}
