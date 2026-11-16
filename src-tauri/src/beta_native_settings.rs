//! Beta-owned desktop preferences. The Alpha settings engine can render these
//! values without opening its old Runtime config database.
use super::{trusted_window, Failure, NativeState};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

const DEFAULT_SHORTCUTS: [&str; 2] = ["Control+Shift+Space", "Control+Alt+Space"];
const MAX_PREFERENCES_BYTES: u64 = 16 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedPreferences {
    version: u8,
    shortcut: Option<String>,
    quick_focus: bool,
    customized: bool,
}

impl Default for SavedPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            shortcut: Some(DEFAULT_SHORTCUTS[0].into()),
            quick_focus: true,
            customized: false,
        }
    }
}

struct PreferencesState {
    saved: SavedPreferences,
    owned: BTreeSet<String>,
    unreadable: bool,
    error: Option<String>,
}

pub(super) struct DesktopPreferences {
    path: PathBuf,
    state: Mutex<PreferencesState>,
    quick_focus: AtomicBool,
    pressed: AtomicBool,
    activation_pending: AtomicBool,
}

#[derive(Serialize)]
pub(super) struct DesktopPreferencesInfo {
    shortcut: Option<String>,
    pub(super) registered_shortcut: Option<String>,
    registered_shortcuts: Vec<String>,
    quick_focus: bool,
    error: Option<String>,
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}
fn unavailable() -> Failure {
    failure(
        "desktop_preferences_unavailable",
        "桌面设置暂未确认，请重新读取后重试",
    )
}
fn unsupported() -> Failure {
    failure("unsupported_platform", "全局唤起快捷键仅适用于桌面应用")
}

impl DesktopPreferences {
    pub(super) fn open(root: &Path) -> Self {
        let path = root.join("desktop-preferences.beta.json");
        // Invalid settings must not stop the record store or get silently
        // overwritten by reading the page. An explicit shortcut change can
        // replace this one preferences file; all other data stays untouched.
        let read = (|| -> Result<SavedPreferences, ()> {
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(SavedPreferences::default())
                }
                Err(_) => return Err(()),
            };
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > MAX_PREFERENCES_BYTES
            {
                return Err(());
            }
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .map_err(|_| ())?
                .take(MAX_PREFERENCES_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| ())?;
            if bytes.len() as u64 > MAX_PREFERENCES_BYTES {
                return Err(());
            }
            let saved: SavedPreferences = serde_json::from_slice(&bytes).map_err(|_| ())?;
            if saved.version != 1 {
                return Err(());
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Some(shortcut) = saved.shortcut.as_deref() {
                normalize(shortcut).map_err(|_| ())?;
            }
            Ok(saved)
        })();
        let (saved, unreadable, error) = match read {
            Ok(saved) => (saved, false, None),
            Err(()) => (
                SavedPreferences {
                    shortcut: None,
                    customized: true,
                    ..SavedPreferences::default()
                },
                true,
                Some("快捷键设置无法读取，原文件已保留；请重新选择唤起快捷键".into()),
            ),
        };
        Self {
            path,
            quick_focus: AtomicBool::new(saved.quick_focus),
            state: Mutex::new(PreferencesState {
                saved,
                owned: BTreeSet::new(),
                unreadable,
                error,
            }),
            pressed: AtomicBool::new(false),
            activation_pending: AtomicBool::new(false),
        }
    }

    fn info(state: &PreferencesState) -> DesktopPreferencesInfo {
        DesktopPreferencesInfo {
            shortcut: state.saved.shortcut.clone(),
            registered_shortcut: if state.owned.len() == 1 {
                state.owned.first().cloned()
            } else {
                None
            },
            registered_shortcuts: state.owned.iter().cloned().collect(),
            quick_focus: state.saved.quick_focus,
            error: state.error.clone(),
        }
    }

    pub(super) fn snapshot(&self) -> Result<DesktopPreferencesInfo, Failure> {
        self.state
            .lock()
            .map(|state| Self::info(&state))
            .map_err(|_| unavailable())
    }

    fn persist(&self, saved: &SavedPreferences) -> Result<(), Failure> {
        if let Ok(metadata) = fs::symlink_metadata(&self.path) {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(unavailable());
            }
        }
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), Failure> {
            let bytes = serde_json::to_vec(saved).map_err(|_| unavailable())?;
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary).map_err(|_| unavailable())?;
            file.write_all(&bytes).map_err(|_| unavailable())?;
            file.sync_all().map_err(|_| unavailable())?;
            drop(file);
            fs::rename(&temporary, &self.path).map_err(|_| unavailable())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(super) fn start(&self, app: &AppHandle, owner: &Arc<NativeState>) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.unreadable {
            return;
        }
        let candidates = if state.saved.customized {
            state.saved.shortcut.iter().cloned().collect()
        } else {
            DEFAULT_SHORTCUTS
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>()
        };
        for candidate in candidates {
            let Ok(normalized) = normalize(&candidate) else {
                continue;
            };
            if register(app, owner, &normalized).is_ok() {
                state.owned.insert(normalized.clone());
                state.saved.shortcut = Some(normalized);
                state.error = None;
                return;
            }
        }
        if state.saved.shortcut.is_some() {
            state.error =
                Some("唤起快捷键未能注册，可能已被其他程序占用；请在设置中更换或重试".into());
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn set_shortcut(
        &self,
        app: &AppHandle,
        owner: &Arc<NativeState>,
        shortcut: Option<String>,
    ) -> Result<DesktopPreferencesInfo, Failure> {
        let next = shortcut.as_deref().map(normalize).transpose()?;
        let mut state = self.state.lock().map_err(|_| unavailable())?;
        if owner.closing.load(Ordering::Acquire) {
            return Err(unavailable());
        }
        let previous = state.saved.clone();
        let previous_owned = state.owned.clone();
        let registered_new = next
            .as_ref()
            .is_some_and(|value| !state.owned.contains(value));
        if let Some(value) = next.as_deref().filter(|_| registered_new) {
            if let Err(error) = register(app, owner, value) {
                state.error = Some(error.message.into());
                return Err(error);
            }
            state.owned.insert(value.to_owned());
        }
        // A failed release never steals a different feature's shortcut: only
        // keys inserted into this instance's owned set can be unregistered.
        let obsolete: Vec<_> = state
            .owned
            .iter()
            .filter(|value| Some(*value) != next.as_ref())
            .cloned()
            .collect();
        for value in obsolete {
            if app.global_shortcut().unregister(value.as_str()).is_err() {
                if registered_new {
                    if let Some(next) = next.as_deref() {
                        if app.global_shortcut().unregister(next).is_ok() {
                            state.owned.remove(next);
                        }
                    }
                }
                // Restore any previous keys already released by this attempt.
                for old in previous_owned
                    .iter()
                    .filter(|old| !state.owned.contains(*old))
                    .cloned()
                    .collect::<Vec<_>>()
                {
                    if register(app, owner, &old).is_ok() {
                        state.owned.insert(old);
                    }
                }
                state.error =
                    Some("旧快捷键未能完全释放，修改未保存；请重新读取当前快捷键状态".into());
                self.pressed.store(false, Ordering::Release);
                return Err(failure(
                    "shortcut_cleanup_failed",
                    "快捷键修改未完全完成，请重新读取当前状态",
                ));
            }
            state.owned.remove(&value);
        }
        let updated = SavedPreferences {
            shortcut: next.clone(),
            customized: true,
            ..previous.clone()
        };
        if let Err(error) = self.persist(&updated) {
            // Restore only our previous bindings. If restoration or cleanup
            // fails, expose the actual owned set instead of claiming rollback.
            for old in previous_owned
                .iter()
                .filter(|old| !state.owned.contains(*old))
                .cloned()
                .collect::<Vec<_>>()
            {
                if register(app, owner, &old).is_ok() {
                    state.owned.insert(old);
                }
            }
            if registered_new {
                if let Some(next) = next.as_deref() {
                    if app.global_shortcut().unregister(next).is_ok() {
                        state.owned.remove(next);
                    }
                }
            }
            state.error = Some(
                if state.owned == previous_owned {
                    "设置未能保存，原快捷键已恢复"
                } else {
                    "设置未能保存，快捷键恢复未完全确认；请重新读取当前状态"
                }
                .into(),
            );
            self.pressed.store(false, Ordering::Release);
            return Err(error);
        }
        state.saved = updated;
        state.unreadable = false;
        state.error = None;
        self.pressed.store(false, Ordering::Release);
        Ok(Self::info(&state))
    }

    fn set_quick_focus(&self, enabled: bool) -> Result<DesktopPreferencesInfo, Failure> {
        let mut state = self.state.lock().map_err(|_| unavailable())?;
        if state.unreadable {
            return Err(failure(
                "desktop_preferences_recovery_required",
                "请先重新选择唤起快捷键，再保存其他桌面设置",
            ));
        }
        let updated = SavedPreferences {
            quick_focus: enabled,
            ..state.saved.clone()
        };
        self.persist(&updated)?;
        state.saved = updated;
        self.quick_focus.store(enabled, Ordering::Release);
        Ok(Self::info(&state))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn normalize(value: &str) -> Result<String, Failure> {
    if value.len() > 128 || value.trim().is_empty() {
        return Err(failure("shortcut_invalid", "快捷键格式无效，请重新选择"));
    }
    value
        .trim()
        .parse::<Shortcut>()
        .map(|value| value.to_string())
        .map_err(|_| failure("shortcut_invalid", "快捷键格式无效，请重新选择"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register(app: &AppHandle, owner: &Arc<NativeState>, shortcut: &str) -> Result<(), Failure> {
    // Unlike Alpha's listener helper, do not unconditionally unregister the
    // requested key: it may belong to a different capability in this process.
    if app.global_shortcut().is_registered(shortcut) {
        return Err(failure(
            "shortcut_conflict",
            "快捷键已被当前应用的其他功能占用，请更换组合",
        ));
    }
    let weak = Arc::downgrade(owner);
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _, event| {
            if let Some(state) = weak.upgrade() {
                activate(app, &state, event);
            }
        })
        .map_err(|_| {
            failure(
                "shortcut_registration_failed",
                "唤起快捷键未能注册，可能已被其他程序占用",
            )
        })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn activate(app: &AppHandle, state: &NativeState, event: ShortcutEvent) {
    let settings = &state.desktop_preferences;
    if event.state == ShortcutState::Released {
        settings.pressed.store(false, Ordering::Release);
        return;
    }
    if state.closing.load(Ordering::Acquire) || settings.pressed.swap(true, Ordering::AcqRel) {
        return;
    }
    // Callback never takes the preferences lock: shortcut registration waits
    // for the main thread while settings writes run on the blocking pool.
    let result = (|| -> tauri::Result<()> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };
        if window.is_visible()? && !window.is_minimized()? && window.is_focused()? {
            return window.minimize();
        }
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        settings.activation_pending.store(true, Ordering::Release);
        #[derive(Clone, Serialize)]
        struct Activation {
            quick_focus: bool,
        }
        app.emit(
            "beta-main-window-shortcut",
            Activation {
                quick_focus: settings.quick_focus.load(Ordering::Acquire),
            },
        )
    })();
    if result.is_err() {
        log::warn!("Beta main window shortcut activation was not completed");
    }
}

#[tauri::command]
pub(super) async fn beta_desktop_preferences(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<DesktopPreferencesInfo, Failure> {
    trusted_window(&window, state.inner())?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.desktop_preferences.snapshot())
        .await
        .map_err(|_| unavailable())?
}

#[tauri::command]
pub(super) async fn beta_set_desktop_shortcut(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<NativeState>>,
    shortcut: Option<String>,
) -> Result<DesktopPreferencesInfo, Failure> {
    trusted_window(&window, state.inner())?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let state = state.inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            state
                .desktop_preferences
                .set_shortcut(&app, &state, shortcut)
        })
        .await
        .map_err(|_| unavailable())?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, shortcut);
        Err(unsupported())
    }
}

#[tauri::command]
pub(super) async fn beta_set_desktop_quick_focus(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    enabled: bool,
) -> Result<DesktopPreferencesInfo, Failure> {
    trusted_window(&window, state.inner())?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let state = state.inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            if state.closing.load(Ordering::Acquire) {
                return Err(unavailable());
            }
            state.desktop_preferences.set_quick_focus(enabled)
        })
        .await
        .map_err(|_| unavailable())?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = enabled;
        Err(unsupported())
    }
}

#[tauri::command]
pub(super) fn beta_take_desktop_activation(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    Ok(state
        .desktop_preferences
        .activation_pending
        .swap(false, Ordering::AcqRel))
}
