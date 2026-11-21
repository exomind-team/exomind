//! Focused, GUI-free tests for the Windows taskbar application identity.
//!
//! These exercise the pure selection/validation logic and the configured
//! Tauri identifiers. They never launch a window or call the shell.

#[path = "../src/windows_app_identity.rs"]
mod windows_app_identity;

use windows_app_identity::{
    select_app_user_model_id, validate_app_user_model_id, ALPHA_APP_USER_MODEL_ID,
    BETA_APP_USER_MODEL_ID,
};

#[test]
fn beta_has_one_stable_app_user_model_id() {
    assert_eq!(BETA_APP_USER_MODEL_ID, "com.exomind.app.v06.beta");
    assert_eq!(
        select_app_user_model_id("com.exomind.app.v06.beta"),
        Ok(BETA_APP_USER_MODEL_ID)
    );
}

#[test]
fn alpha_and_beta_app_user_model_ids_are_distinct() {
    assert_eq!(ALPHA_APP_USER_MODEL_ID, "com.exomind.app.v06");
    assert_ne!(ALPHA_APP_USER_MODEL_ID, BETA_APP_USER_MODEL_ID);
    assert_eq!(
        select_app_user_model_id(ALPHA_APP_USER_MODEL_ID),
        Ok(ALPHA_APP_USER_MODEL_ID)
    );
    assert_eq!(
        select_app_user_model_id(BETA_APP_USER_MODEL_ID),
        Ok(BETA_APP_USER_MODEL_ID)
    );
}

#[test]
fn configured_alpha_identifier_matches_the_alpha_app_user_model_id() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["identifier"].as_str(), Some(ALPHA_APP_USER_MODEL_ID));
}

#[test]
fn configured_beta_identifier_matches_the_beta_app_user_model_id() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.beta.conf.json")).unwrap();
    assert_eq!(config["identifier"].as_str(), Some(BETA_APP_USER_MODEL_ID));
}

#[test]
fn unknown_identifiers_are_rejected() {
    for identifier in [
        "",
        "com.exomind.app",
        "com.exomind.app.v06.beta-other",
        "com.example.other",
    ] {
        assert!(
            select_app_user_model_id(identifier).is_err(),
            "unexpected success for {identifier:?}"
        );
    }
}

#[test]
fn validation_rejects_invalid_shapes() {
    assert!(validate_app_user_model_id("").is_err());
    assert!(validate_app_user_model_id(&"x".repeat(129)).is_err());
    assert!(validate_app_user_model_id("com.exomind\n.app.v06").is_err());
    assert!(validate_app_user_model_id(" com.exomind.app.v06").is_err());
    assert!(validate_app_user_model_id("com.exomind.app.v06 ").is_err());
    assert!(validate_app_user_model_id(ALPHA_APP_USER_MODEL_ID).is_ok());
    assert!(validate_app_user_model_id(BETA_APP_USER_MODEL_ID).is_ok());
}
