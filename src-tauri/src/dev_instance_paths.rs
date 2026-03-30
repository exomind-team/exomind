use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const DEV_APP_DATA_DIR_ENV: &str = "EXOMIND_DEV_APP_DATA_DIR";
pub const DEV_RUNTIME_DATA_DIR_ENV: &str = "EXOMIND_DEV_RUNTIME_DATA_DIR";
pub const DEV_WEBVIEW_MAIN_DATA_DIR_ENV: &str = "EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR";
pub const DEV_WEBVIEW_OVERLAY_DATA_ROOT_ENV: &str = "EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT";
pub const DEV_LEGACY_SHARED_APP_DATA_DIR_ENV: &str = "EXOMIND_DEV_LEGACY_SHARED_APP_DATA_DIR";
pub const DEV_LEGACY_SHARED_RUNTIME_DIR_ENV: &str = "EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR";

const RUNTIME_DIR_NAME: &str = "runtime";
const APP_DATA_LEGACY_SEED_MARKER_NAME: &str = ".legacy-app-data-seeded";
const RUNTIME_LEGACY_SEED_MARKER_NAME: &str = ".legacy-runtime-seeded";
const APP_DATA_SEED_ENTRY_NAMES: &[&str] = &[".exomind", "eventlog", "settings"];
const RUNTIME_SQLITE_BASENAMES: &[&str] = &[
    "signal-pool.sqlite",
    "eventlog.sqlite",
    "tasks.sqlite",
    "timeblocks.sqlite",
    "sessions.sqlite",
    "config.sqlite",
];
const RUNTIME_JSON_FILE_NAMES: &[&str] = &["runtime-network-mode.json", "runtime-target-mode.json"];
const RUNTIME_DIR_ENTRY_NAMES: &[&str] = &["agents", "eventlog"];

fn resolve_env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("failed to create dir {:?}: {error}", path))
}

pub fn resolve_instance_app_data_dir_with_fallback(fallback: &Path) -> PathBuf {
    resolve_env_path(DEV_APP_DATA_DIR_ENV).unwrap_or_else(|| fallback.to_path_buf())
}

pub fn resolve_instance_runtime_dir_from_app_data_dir(app_data_dir: &Path) -> PathBuf {
    if let Some(runtime_dir) = resolve_env_path(DEV_RUNTIME_DATA_DIR_ENV) {
        return runtime_dir;
    }

    app_data_dir.join(RUNTIME_DIR_NAME)
}

pub fn resolve_instance_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    let resolved = resolve_instance_app_data_dir_with_fallback(&fallback);
    ensure_dir(&resolved)?;
    Ok(resolved)
}

pub fn resolve_overlay_webview_data_dir(label: &str) -> Option<PathBuf> {
    let root = resolve_env_path(DEV_WEBVIEW_OVERLAY_DATA_ROOT_ENV)?;
    let resolved = root.join(label);
    ensure_dir(&resolved).ok()?;
    Some(resolved)
}

pub fn resolve_main_webview_data_dir() -> Option<PathBuf> {
    let resolved = resolve_env_path(DEV_WEBVIEW_MAIN_DATA_DIR_ENV)?;
    ensure_dir(&resolved).ok()?;
    Some(resolved)
}

pub fn resolve_legacy_shared_app_data_dir() -> Option<PathBuf> {
    resolve_env_path(DEV_LEGACY_SHARED_APP_DATA_DIR_ENV)
}

pub fn resolve_legacy_shared_runtime_dir() -> Option<PathBuf> {
    resolve_env_path(DEV_LEGACY_SHARED_RUNTIME_DIR_ENV)
}

pub fn resolve_mcp_bridge_base_port() -> Option<u16> {
    std::env::var("EXOMIND_MCP_BRIDGE_BASE_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn runtime_seed_whitelist() -> Vec<String> {
    let mut names = Vec::new();
    for base in RUNTIME_SQLITE_BASENAMES {
        names.push((*base).to_string());
        names.push(format!("{base}-wal"));
        names.push(format!("{base}-shm"));
    }
    for file_name in RUNTIME_JSON_FILE_NAMES {
        names.push((*file_name).to_string());
    }
    names
}

fn app_data_seed_whitelist() -> Vec<String> {
    APP_DATA_SEED_ENTRY_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}

fn runtime_seed_entry_names() -> Vec<String> {
    let mut names = runtime_seed_whitelist();
    for entry_name in RUNTIME_DIR_ENTRY_NAMES {
        names.push((*entry_name).to_string());
    }
    names
}

fn copy_missing_path_recursive(source_path: &Path, target_path: &Path) -> Result<(), String> {
    if source_path.is_dir() {
        ensure_dir(target_path)?;
        let entries = std::fs::read_dir(source_path)
            .map_err(|error| format!("failed to read legacy dir {:?}: {error}", source_path))?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!("failed to iterate legacy dir {:?}: {error}", source_path)
            })?;
            let child_source = entry.path();
            let child_target = target_path.join(entry.file_name());
            copy_missing_path_recursive(&child_source, &child_target)?;
        }
        return Ok(());
    }

    if source_path.is_file() {
        if target_path.exists() {
            return Ok(());
        }
        if let Some(parent) = target_path.parent() {
            ensure_dir(parent)?;
        }
        std::fs::copy(source_path, target_path).map_err(|error| {
            format!(
                "failed to seed path {:?} -> {:?}: {error}",
                source_path, target_path
            )
        })?;
    }

    Ok(())
}

fn seed_named_entries_if_missing(
    target_root: &Path,
    legacy_root: &Path,
    entry_names: &[String],
) -> Result<(), String> {
    let mut errors = Vec::new();

    for entry_name in entry_names {
        let source_path = legacy_root.join(entry_name);
        if !source_path.exists() {
            continue;
        }

        let target_path = target_root.join(entry_name);
        if let Err(error) = copy_missing_path_recursive(&source_path, &target_path) {
            errors.push(error);
        }
    }

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    Ok(())
}

fn write_seed_marker(target_dir: &Path, marker_name: &str) -> Result<(), String> {
    std::fs::write(target_dir.join(marker_name), b"seeded\n").map_err(|error| {
        format!(
            "failed to write legacy seed marker {:?}: {error}",
            target_dir.join(marker_name)
        )
    })
}

pub fn seed_instance_app_data_dir_if_needed(
    app_data_dir: &Path,
    legacy_app_data_dir: &Path,
) -> Result<(), String> {
    ensure_dir(app_data_dir)?;

    let marker_path = app_data_dir.join(APP_DATA_LEGACY_SEED_MARKER_NAME);
    if marker_path.exists() {
        return Ok(());
    }
    if legacy_app_data_dir.exists() {
        let entry_names = app_data_seed_whitelist();
        seed_named_entries_if_missing(app_data_dir, legacy_app_data_dir, &entry_names)?;
    }

    write_seed_marker(app_data_dir, APP_DATA_LEGACY_SEED_MARKER_NAME)
}

pub fn seed_instance_runtime_dir_if_needed(
    runtime_dir: &Path,
    legacy_runtime_dir: &Path,
) -> Result<(), String> {
    ensure_dir(runtime_dir)?;

    let marker_path = runtime_dir.join(RUNTIME_LEGACY_SEED_MARKER_NAME);
    if marker_path.exists() {
        return Ok(());
    }
    if legacy_runtime_dir.exists() {
        let entry_names = runtime_seed_entry_names();
        seed_named_entries_if_missing(runtime_dir, legacy_runtime_dir, &entry_names)?;
    }

    write_seed_marker(runtime_dir, RUNTIME_LEGACY_SEED_MARKER_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        original: Option<OsString>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: Option<&str>) -> Self {
            let original = std::env::var_os(key);
            match value {
                Some(next) => unsafe { std::env::set_var(key, next) },
                None => unsafe { std::env::remove_var(key) },
            }
            Self { key, original }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(value) => unsafe { std::env::set_var(self.key, value) },
                None => unsafe { std::env::remove_var(self.key) },
            }
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("exomind-{name}-{nanos}"))
    }

    #[test]
    fn dev_instance_paths_env_override_wins_over_fallback() {
        let _lock = ENV_MUTEX.lock().expect("env test lock should succeed");
        let _guard = EnvGuard::set(
            DEV_APP_DATA_DIR_ENV,
            Some("D:/tmp/exomind-instance/app-data"),
        );
        let fallback = PathBuf::from("C:/Users/test/AppData/Local/com.exomind.app");

        let resolved = resolve_instance_app_data_dir_with_fallback(&fallback);

        assert_eq!(resolved, PathBuf::from("D:/tmp/exomind-instance/app-data"));
    }

    #[test]
    fn dev_instance_paths_fallback_is_used_when_override_missing() {
        let _lock = ENV_MUTEX.lock().expect("env test lock should succeed");
        let _guard = EnvGuard::set(DEV_APP_DATA_DIR_ENV, None);
        let fallback = PathBuf::from("C:/Users/test/AppData/Local/com.exomind.app");

        let resolved = resolve_instance_app_data_dir_with_fallback(&fallback);

        assert_eq!(resolved, fallback);
    }

    #[test]
    fn dev_instance_paths_runtime_dir_defaults_to_app_data_runtime() {
        let _lock = ENV_MUTEX.lock().expect("env test lock should succeed");
        let _guard = EnvGuard::set(DEV_RUNTIME_DATA_DIR_ENV, None);
        let app_data_dir = PathBuf::from("D:/tmp/exomind-instance/app-data");

        let resolved = resolve_instance_runtime_dir_from_app_data_dir(&app_data_dir);

        assert_eq!(resolved, app_data_dir.join("runtime"));
    }

    #[test]
    fn dev_instance_paths_app_data_seed_copies_selected_entries_once() {
        let app_data_dir = temp_path("app-data-seed-target");
        let legacy_dir = temp_path("app-data-seed-legacy");
        fs::create_dir_all(legacy_dir.join(".exomind")).expect("legacy .exomind dir should exist");
        fs::create_dir_all(legacy_dir.join("settings")).expect("legacy settings dir should exist");
        fs::create_dir_all(legacy_dir.join("eventlog")).expect("legacy eventlog dir should exist");
        fs::create_dir_all(legacy_dir.join("runtime")).expect("legacy runtime dir should exist");

        fs::write(
            legacy_dir.join(".exomind").join("messages.jsonl"),
            "legacy-messages",
        )
        .expect("legacy messages should be written");
        fs::write(
            legacy_dir.join("settings").join("runtime-target-mode.json"),
            "{\"targetMode\":\"embedded\"}",
        )
        .expect("legacy settings should be written");
        fs::write(
            legacy_dir.join("eventlog").join("anonymous.md"),
            "legacy-eventlog-md",
        )
        .expect("legacy eventlog markdown should be written");
        fs::write(
            legacy_dir.join("runtime").join("config.sqlite"),
            "ignore-runtime",
        )
        .expect("legacy runtime file should be written");
        fs::write(legacy_dir.join("cache.tmp"), "ignore-cache")
            .expect("legacy cache file should be written");

        seed_instance_app_data_dir_if_needed(&app_data_dir, &legacy_dir)
            .expect("first app data seed should succeed");

        assert_eq!(
            fs::read_to_string(app_data_dir.join(".exomind").join("messages.jsonl"))
                .expect("messages snapshot should exist"),
            "legacy-messages"
        );
        assert_eq!(
            fs::read_to_string(
                app_data_dir
                    .join("settings")
                    .join("runtime-target-mode.json")
            )
            .expect("settings snapshot should exist"),
            "{\"targetMode\":\"embedded\"}"
        );
        assert_eq!(
            fs::read_to_string(app_data_dir.join("eventlog").join("anonymous.md"))
                .expect("eventlog snapshot should exist"),
            "legacy-eventlog-md"
        );
        assert!(
            !app_data_dir.join("device_id.txt").exists(),
            "device identity should stay instance-specific"
        );
        assert!(
            !app_data_dir.join("runtime").exists(),
            "runtime should be handled by dedicated runtime seeding"
        );
        assert!(
            !app_data_dir.join("cache.tmp").exists(),
            "non-whitelist root files must not be copied"
        );

        seed_instance_app_data_dir_if_needed(&app_data_dir, &legacy_dir)
            .expect("second app data seed should be a no-op");

        fs::remove_dir_all(&app_data_dir).ok();
        fs::remove_dir_all(&legacy_dir).ok();
    }

    #[test]
    fn dev_instance_paths_runtime_seed_copies_whitelist_once_without_overwriting() {
        let runtime_dir = temp_path("runtime-seed-target");
        let legacy_dir = temp_path("runtime-seed-legacy");
        fs::create_dir_all(&legacy_dir).expect("legacy runtime dir should be created");
        fs::create_dir_all(legacy_dir.join("agents").join("life-alpha"))
            .expect("legacy agent dir should be created");
        fs::create_dir_all(legacy_dir.join("eventlog"))
            .expect("legacy runtime eventlog dir should exist");

        fs::write(legacy_dir.join("eventlog.sqlite"), "legacy-eventlog")
            .expect("legacy eventlog should be written");
        fs::write(legacy_dir.join("tasks.sqlite"), "legacy-tasks")
            .expect("legacy tasks should be written");
        fs::write(
            legacy_dir
                .join("agents")
                .join("life-alpha")
                .join("agent.state.json"),
            "{\"name\":\"life-alpha\"}",
        )
        .expect("legacy agent state should be written");
        fs::write(
            legacy_dir.join("eventlog").join("profile-v2.md"),
            "legacy-eventlog-markdown",
        )
        .expect("legacy runtime eventlog markdown should be written");
        fs::write(legacy_dir.join("note.txt"), "ignore-me")
            .expect("non-whitelist file should be written");

        seed_instance_runtime_dir_if_needed(&runtime_dir, &legacy_dir)
            .expect("first seed should succeed");

        let seeded_eventlog = fs::read_to_string(runtime_dir.join("eventlog.sqlite"))
            .expect("eventlog sqlite should be copied on first seed");
        assert_eq!(seeded_eventlog, "legacy-eventlog");
        assert_eq!(
            fs::read_to_string(
                runtime_dir
                    .join("agents")
                    .join("life-alpha")
                    .join("agent.state.json")
            )
            .expect("agent state snapshot should exist"),
            "{\"name\":\"life-alpha\"}"
        );
        assert_eq!(
            fs::read_to_string(runtime_dir.join("eventlog").join("profile-v2.md"))
                .expect("runtime eventlog markdown snapshot should exist"),
            "legacy-eventlog-markdown"
        );
        assert!(
            !runtime_dir.join("note.txt").exists(),
            "non-whitelist file must not be copied"
        );

        fs::write(runtime_dir.join("tasks.sqlite"), "instance-owned")
            .expect("instance-owned file should be written");
        fs::write(legacy_dir.join("tasks.sqlite"), "legacy-updated")
            .expect("legacy tasks should be updated");

        seed_instance_runtime_dir_if_needed(&runtime_dir, &legacy_dir)
            .expect("second seed should succeed");

        let preserved_tasks = fs::read_to_string(runtime_dir.join("tasks.sqlite"))
            .expect("existing instance file should remain");
        assert_eq!(preserved_tasks, "instance-owned");

        fs::remove_dir_all(&runtime_dir).ok();
        fs::remove_dir_all(&legacy_dir).ok();
    }

    #[test]
    fn dev_instance_paths_runtime_seed_retries_when_some_entries_fail() {
        let runtime_dir = temp_path("runtime-seed-retry-target");
        let legacy_dir = temp_path("runtime-seed-retry-legacy");
        fs::create_dir_all(&legacy_dir).expect("legacy runtime dir should be created");
        fs::create_dir_all(legacy_dir.join("agents").join("life-alpha"))
            .expect("legacy agent dir should be created");
        fs::write(legacy_dir.join("eventlog.sqlite"), "legacy-eventlog")
            .expect("legacy eventlog should be written");
        fs::write(
            legacy_dir
                .join("agents")
                .join("life-alpha")
                .join("agent.state.json"),
            "{\"name\":\"life-alpha\"}",
        )
        .expect("legacy agent state should be written");

        fs::create_dir_all(&runtime_dir).expect("runtime target should be created");
        fs::write(runtime_dir.join("agents"), "blocking-file")
            .expect("blocking file should be created");

        let first_seed = seed_instance_runtime_dir_if_needed(&runtime_dir, &legacy_dir);
        assert!(
            first_seed.is_err(),
            "a conflicting target path should fail this seed attempt"
        );
        assert_eq!(
            fs::read_to_string(runtime_dir.join("eventlog.sqlite"))
                .expect("successful entries should still be copied"),
            "legacy-eventlog"
        );
        assert!(
            !runtime_dir.join(RUNTIME_LEGACY_SEED_MARKER_NAME).exists(),
            "marker must stay absent so the next launch retries the missing entries"
        );

        fs::remove_file(runtime_dir.join("agents")).expect("blocking file should be removable");
        seed_instance_runtime_dir_if_needed(&runtime_dir, &legacy_dir)
            .expect("seed should succeed after the blocking file is removed");
        assert_eq!(
            fs::read_to_string(
                runtime_dir
                    .join("agents")
                    .join("life-alpha")
                    .join("agent.state.json")
            )
            .expect("retry should populate previously failed entries"),
            "{\"name\":\"life-alpha\"}"
        );
        assert!(
            runtime_dir.join(RUNTIME_LEGACY_SEED_MARKER_NAME).exists(),
            "marker should be written after a fully successful retry"
        );

        fs::remove_dir_all(&runtime_dir).ok();
        fs::remove_dir_all(&legacy_dir).ok();
    }
}
