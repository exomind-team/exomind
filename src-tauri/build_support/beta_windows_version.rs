use std::ffi::OsStr;

const BETA_IDENTIFIER: &str = "com.exomind.app.v06.beta";

/// Selects the Windows-only resource compatibility override without changing env.
pub fn select_resource_version(
    target_os: &str,
    overlay: Option<&OsStr>,
    beta_config: &str,
) -> Result<Option<String>, &'static str> {
    if target_os != "windows" {
        return Ok(None);
    }
    let Some(overlay) = overlay else {
        return Ok(None);
    };
    let Some(overlay) = overlay.to_str() else {
        return Ok(None);
    };
    let Ok(overlay) = serde_json::from_str::<serde_json::Value>(overlay) else {
        // Keep Tauri's original validation when no exact Beta overlay is known.
        return Ok(None);
    };
    if overlay.get("identifier").and_then(|value| value.as_str()) != Some(BETA_IDENTIFIER) {
        return Ok(None);
    }
    let config: serde_json::Value =
        serde_json::from_str(beta_config).map_err(|_| "Invalid Beta resource reference config")?;
    if config.get("identifier").and_then(|value| value.as_str()) != Some(BETA_IDENTIFIER) {
        return Err("Beta resource reference identifier mismatch");
    }
    let expected = config
        .get("version")
        .and_then(|value| value.as_str())
        .filter(|version| !version.is_empty() && !version.contains('\0'))
        .ok_or("Beta resource reference version is missing or invalid")?;
    let version = overlay
        .get("version")
        .and_then(|value| value.as_str())
        .ok_or("Explicit Beta TAURI_CONFIG version is required")?;
    if version != expected {
        return Err("Beta TAURI_CONFIG version differs from tauri.beta.conf.json");
    }
    Ok(Some(version.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::select_resource_version;
    use std::ffi::OsStr;

    const CONFIG: &str = include_str!("../tauri.beta.conf.json");

    fn beta_overlay(version: serde_json::Value) -> String {
        serde_json::json!({"identifier":"com.exomind.app.v06.beta", "version":version}).to_string()
    }

    #[test]
    fn windows_without_overlay_keeps_original_package_version() {
        assert_eq!(select_resource_version("windows", None, CONFIG), Ok(None));
    }

    #[test]
    fn windows_alpha_and_similar_identifier_keep_original_package_version() {
        for identifier in ["com.exomind.app.v06", "com.exomind.app.v06.beta-other"] {
            let overlay = serde_json::json!({"identifier":identifier}).to_string();
            assert_eq!(
                select_resource_version("windows", Some(OsStr::new(&overlay)), CONFIG),
                Ok(None)
            );
        }
    }

    #[test]
    fn non_windows_does_not_parse_or_override_overlay() {
        for target in ["android", "linux", "macos"] {
            assert_eq!(
                select_resource_version(target, Some(OsStr::new("invalid JSON")), CONFIG),
                Ok(None)
            );
        }
    }

    #[test]
    fn beta_overlay_without_explicit_version_fails_closed() {
        let overlay = OsStr::new(r#"{"identifier":"com.exomind.app.v06.beta"}"#);
        assert!(select_resource_version("windows", Some(overlay), CONFIG).is_err());
    }

    #[test]
    fn beta_overlay_with_wrong_or_non_string_version_fails_closed() {
        for version in [
            serde_json::json!("0.6.0-alpha05"),
            serde_json::json!("0.6.0-beta999"),
            serde_json::json!(null),
            serde_json::json!(6005),
        ] {
            let overlay = beta_overlay(version);
            assert!(
                select_resource_version("windows", Some(OsStr::new(&overlay)), CONFIG).is_err()
            );
        }
    }

    #[test]
    fn exact_beta_overlay_selects_reference_config_version() {
        let config: serde_json::Value = serde_json::from_str(CONFIG).unwrap();
        let version = config["version"].as_str().unwrap();
        let overlay = beta_overlay(serde_json::json!(version));
        assert_eq!(
            select_resource_version("windows", Some(OsStr::new(&overlay)), CONFIG),
            Ok(Some(version.to_owned()))
        );
    }

    #[test]
    fn malformed_windows_overlay_keeps_original_tauri_validation() {
        assert_eq!(
            select_resource_version("windows", Some(OsStr::new("{")), CONFIG),
            Ok(None)
        );
    }
}
