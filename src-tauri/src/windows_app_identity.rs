//! Stable Windows taskbar identity.
//!
//! Windows derives each top-level window's AppUserModelID (AUMID) from the
//! process default set by `SetCurrentProcessExplicitAppUserModelID`. Without it
//! `GetApplicationUserModelId` returns `APPMODEL_ERROR_NO_APPLICATION` and the
//! taskbar cannot pin or group the application under a stable identity.

pub const ALPHA_APP_USER_MODEL_ID: &str = "com.exomind.app.v06";
pub const BETA_APP_USER_MODEL_ID: &str = "com.exomind.app.v06.beta";

const MAX_APP_USER_MODEL_ID_CHARS: usize = 128;

/// Selects the stable AUMID for a configured Tauri identifier.
///
/// Only the two shipped runtime identities are accepted so an unexpected
/// overlay fails closed instead of silently inventing an identity.
pub fn select_app_user_model_id(identifier: &str) -> Result<&'static str, String> {
    validate_app_user_model_id(identifier)?;
    match identifier {
        ALPHA_APP_USER_MODEL_ID => Ok(ALPHA_APP_USER_MODEL_ID),
        BETA_APP_USER_MODEL_ID => Ok(BETA_APP_USER_MODEL_ID),
        _ => Err(format!(
            "unexpected Tauri identifier for AppUserModelID: {identifier:?}"
        )),
    }
}

/// Validates the shape of an AppUserModelID without touching the shell.
pub fn validate_app_user_model_id(identifier: &str) -> Result<(), String> {
    if identifier.is_empty() {
        return Err("AppUserModelID must not be empty".to_string());
    }
    if identifier.chars().count() > MAX_APP_USER_MODEL_ID_CHARS {
        return Err(format!(
            "AppUserModelID must not exceed {MAX_APP_USER_MODEL_ID_CHARS} characters"
        ));
    }
    if identifier.chars().any(char::is_control) {
        return Err("AppUserModelID must not contain control characters".to_string());
    }
    if identifier.trim() != identifier {
        return Err(
            "AppUserModelID must not have leading or trailing whitespace".to_string(),
        );
    }
    Ok(())
}

/// Applies the configured identifier as the current process AppUserModelID.
///
/// Must run before the first taskbar-visible window is created. A failure here
/// is reported but never treated as success.
#[cfg(windows)]
#[cfg_attr(test, allow(dead_code))]
pub fn apply_app_user_model_id(identifier: &str) -> Result<(), String> {
    let app_id = select_app_user_model_id(identifier)?;
    let wide: Vec<u16> = app_id.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives this call.
    unsafe {
        windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            windows::core::PCWSTR(wide.as_ptr()),
        )
    }
    .map_err(|error| format!("failed to set process AppUserModelID {app_id:?}: {error}"))
}

#[cfg(not(windows))]
#[cfg_attr(test, allow(dead_code))]
pub fn apply_app_user_model_id(identifier: &str) -> Result<(), String> {
    select_app_user_model_id(identifier).map(|_| ())
}
