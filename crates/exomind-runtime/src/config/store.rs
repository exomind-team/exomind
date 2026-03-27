use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

use thiserror::Error;

use super::sqlite_store::SqliteConfigStore;
use super::types::{ConfigEntry, PutConfigEntryInput};

#[derive(Debug, Error)]
pub enum ConfigStoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

enum ConfigStoreBackend {
    Memory(RwLock<HashMap<(String, String), ConfigEntry>>),
    Sqlite(SqliteConfigStore),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigStoreBackendKind {
    Memory,
    Sqlite,
}

pub struct ConfigStore {
    backend: ConfigStoreBackend,
}

impl ConfigStore {
    pub fn new() -> Self {
        Self {
            backend: ConfigStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, ConfigStoreError> {
        Ok(Self {
            backend: ConfigStoreBackend::Sqlite(SqliteConfigStore::open(path)?),
        })
    }

    pub fn put(&self, input: PutConfigEntryInput) -> Result<ConfigEntry, ConfigStoreError> {
        match &self.backend {
            ConfigStoreBackend::Sqlite(store) => store.put(input),
            ConfigStoreBackend::Memory(_) => {
                let entry = ConfigEntry {
                    scope: input.scope,
                    key: input.key,
                    value: input.value,
                    sensitive: input.sensitive,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                    source: input.source,
                    source_origin: input.source_origin,
                };
                self.with_memory_mut(|entries| {
                    entries.insert((entry.scope.clone(), entry.key.clone()), entry.clone());
                    Ok(entry)
                })
            }
        }
    }

    pub fn get(&self, scope: &str, key: &str) -> Result<Option<ConfigEntry>, ConfigStoreError> {
        match &self.backend {
            ConfigStoreBackend::Sqlite(store) => store.get(scope, key),
            ConfigStoreBackend::Memory(_) => {
                Ok(self.memory_entries().get(&(scope.to_string(), key.to_string())).cloned())
            }
        }
    }

    pub fn list(&self, scope: Option<&str>) -> Result<Vec<ConfigEntry>, ConfigStoreError> {
        self.list_by_prefix(scope, None)
    }

    pub fn list_by_prefix(
        &self,
        scope: Option<&str>,
        prefix: Option<&str>,
    ) -> Result<Vec<ConfigEntry>, ConfigStoreError> {
        match &self.backend {
            ConfigStoreBackend::Sqlite(store) => store.list(scope, prefix),
            ConfigStoreBackend::Memory(_) => {
                let mut entries: Vec<ConfigEntry> = self
                    .memory_entries()
                    .into_values()
                    .filter(|entry| scope.is_none_or(|value| entry.scope == value))
                    .filter(|entry| prefix.is_none_or(|value| entry.key.starts_with(value)))
                    .collect();
                entries.sort_by(|left, right| {
                    left.scope
                        .cmp(&right.scope)
                        .then_with(|| left.key.cmp(&right.key))
                });
                Ok(entries)
            }
        }
    }

    pub fn delete(&self, scope: &str, key: &str) -> Result<Option<ConfigEntry>, ConfigStoreError> {
        match &self.backend {
            ConfigStoreBackend::Sqlite(store) => store.delete(scope, key),
            ConfigStoreBackend::Memory(_) => Ok(
                self.with_memory_mut(|entries| entries.remove(&(scope.to_string(), key.to_string())))
            ),
        }
    }

    pub fn backend_kind(&self) -> ConfigStoreBackendKind {
        match &self.backend {
            ConfigStoreBackend::Memory(_) => ConfigStoreBackendKind::Memory,
            ConfigStoreBackend::Sqlite(_) => ConfigStoreBackendKind::Sqlite,
        }
    }

    fn memory_entries(&self) -> HashMap<(String, String), ConfigEntry> {
        match &self.backend {
            ConfigStoreBackend::Memory(entries) => entries.read().unwrap().clone(),
            ConfigStoreBackend::Sqlite(_) => unreachable!("memory_entries called on sqlite backend"),
        }
    }

    fn with_memory_mut<R>(
        &self,
        f: impl FnOnce(&mut HashMap<(String, String), ConfigEntry>) -> R,
    ) -> R {
        match &self.backend {
            ConfigStoreBackend::Memory(entries) => {
                let mut guard = entries.write().unwrap();
                f(&mut guard)
            }
            ConfigStoreBackend::Sqlite(_) => {
                unreachable!("with_memory_mut called on sqlite backend")
            }
        }
    }
}

impl Default for ConfigStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::config::types::{DEVICE_CONFIG_SCOPE, USER_CONFIG_SCOPE};

    fn put_input(scope: &str, key: &str, value: &str) -> PutConfigEntryInput {
        PutConfigEntryInput {
            scope: scope.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            sensitive: false,
            source: Some("test".to_string()),
            source_origin: Some("http://localhost:1420".to_string()),
        }
    }

    #[test]
    fn starts_empty_in_memory() {
        let store = ConfigStore::new();

        let entries = store.list(Some(USER_CONFIG_SCOPE)).unwrap();

        assert!(entries.is_empty());
        assert_eq!(store.backend_kind(), ConfigStoreBackendKind::Memory);
    }

    #[test]
    fn upserts_and_filters_entries_in_memory() {
        let store = ConfigStore::new();
        store
            .put(put_input(USER_CONFIG_SCOPE, "exomind:themePreference", "dark"))
            .unwrap();
        store
            .put(put_input(USER_CONFIG_SCOPE, "exomind:voiceShortcutHotkey", "Alt+Q"))
            .unwrap();
        store
            .put(put_input(DEVICE_CONFIG_SCOPE, "exomind:themePreference", "light"))
            .unwrap();
        store
            .put(put_input(USER_CONFIG_SCOPE, "exomind:themePreference", "light"))
            .unwrap();

        let entries = store
            .list_by_prefix(Some(USER_CONFIG_SCOPE), Some("exomind:"))
            .unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "exomind:themePreference");
        assert_eq!(entries[0].value, "light");
        assert_eq!(entries[1].key, "exomind:voiceShortcutHotkey");
        assert_eq!(store.get(USER_CONFIG_SCOPE, "exomind:themePreference").unwrap().unwrap().value, "light");
    }

    #[test]
    fn sqlite_backend_persists_between_reopens() {
        let temp_dir = tempdir().unwrap();
        let sqlite_path = temp_dir.path().join("config.sqlite");

        {
            let store = ConfigStore::with_sqlite_path(&sqlite_path).unwrap();
            store
                .put(put_input(USER_CONFIG_SCOPE, "moss_api_key", "sk-test-123"))
                .unwrap();
            assert_eq!(store.backend_kind(), ConfigStoreBackendKind::Sqlite);
        }

        let reopened = ConfigStore::with_sqlite_path(&sqlite_path).unwrap();
        let entry = reopened
            .get(USER_CONFIG_SCOPE, "moss_api_key")
            .unwrap()
            .expect("config entry should persist");

        assert_eq!(entry.value, "sk-test-123");
        assert_eq!(reopened.list(Some(USER_CONFIG_SCOPE)).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes_existing_entry() {
        let store = ConfigStore::new();
        store
            .put(put_input(USER_CONFIG_SCOPE, "exomind:inputSendMode", "enter-send"))
            .unwrap();

        let deleted = store
            .delete(USER_CONFIG_SCOPE, "exomind:inputSendMode")
            .unwrap();

        assert!(deleted.is_some());
        assert!(store.get(USER_CONFIG_SCOPE, "exomind:inputSendMode").unwrap().is_none());
    }
}
