use exomind_cli::profile_scope::ProfileScope;
use exomind_cli::state::CliState;
use exomind_cli::target::{TargetResolutionSource, resolve_target};

#[test]
fn explicit_target_wins_over_saved_target() {
    let mut state = CliState::default();
    state.default_target = Some("127.0.0.1:1950".to_string());

    let resolved = resolve_target(
        Some("127.0.0.1:9124"),
        &state,
        &[9124, 1950, 1949],
        |_| true,
    )
    .expect("target should resolve");

    assert_eq!(resolved.target, "127.0.0.1:9124");
    assert_eq!(resolved.source, TargetResolutionSource::Explicit);
}

#[test]
fn saved_target_wins_over_local_probe() {
    let mut state = CliState::default();
    state.default_target = Some("127.0.0.1:1950".to_string());

    let resolved = resolve_target(None, &state, &[9124, 1950, 1949], |candidate| {
        matches!(candidate, "127.0.0.1:9124" | "127.0.0.1:1950")
    })
    .expect("target should resolve");

    assert_eq!(resolved.target, "127.0.0.1:1950");
    assert_eq!(resolved.source, TargetResolutionSource::SavedDefault);
}

#[test]
fn profile_flag_becomes_profile_scope_key() {
    let scope = ProfileScope::from_flags(Some("argon"), None).expect("profile scope");

    assert_eq!(scope.scope_key(), Some("profile-argon"));
    assert_eq!(
        scope.task_query_pairs(),
        vec![("profile_id".to_string(), "profile-argon".to_string())]
    );
}

#[test]
fn profile_scope_is_not_double_prefixed() {
    let scope = ProfileScope::from_flags(Some("profile-argon"), None).expect("profile scope");

    assert_eq!(scope.scope_key(), Some("profile-argon"));
    assert_eq!(
        scope.task_query_pairs(),
        vec![("profile_id".to_string(), "profile-argon".to_string())]
    );
}

#[test]
fn eventlog_scope_maps_profile_to_user_id_query() {
    let scope = ProfileScope::from_flags(Some("argon"), None).expect("profile scope");

    assert_eq!(
        scope.eventlog_query_pairs(),
        vec![("user_id".to_string(), "profile-argon".to_string())]
    );
}
