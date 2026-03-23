use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use super::sqlite_store::{SignalStoreError, SqliteSignalStore};
use super::types::{SignalRoute, TargetType};

enum RoutePersistBackend {
    None,
    Json(PathBuf),
    Sqlite(Arc<SqliteSignalStore>),
}

pub struct RouteTable {
    routes: RwLock<HashMap<String, Vec<SignalRoute>>>,
    persist_backend: RoutePersistBackend,
}

#[derive(serde::Deserialize)]
struct DefaultRouteEntry {
    topic: String,
    target_type: TargetType,
    target_ref: String,
}

impl RouteTable {
    pub fn new(default_path: Option<&Path>, persist_path: Option<PathBuf>) -> Self {
        let all_routes = load_routes_from_default_and_json(default_path, persist_path.as_deref());
        Self {
            routes: RwLock::new(build_route_map(all_routes)),
            persist_backend: persist_path
                .map(RoutePersistBackend::Json)
                .unwrap_or(RoutePersistBackend::None),
        }
    }

    pub(crate) fn with_sqlite_store(
        default_path: Option<&Path>,
        store: Arc<SqliteSignalStore>,
    ) -> Result<Self, SignalStoreError> {
        let legacy_path = store.path().with_file_name("routes.json");
        store.import_legacy_routes_if_needed(&legacy_path)?;
        let persisted_routes = store.load_routes()?;
        let all_routes = if persisted_routes.is_empty() {
            load_default_routes(default_path)
        } else {
            persisted_routes
        };

        Ok(Self {
            routes: RwLock::new(build_route_map(all_routes)),
            persist_backend: RoutePersistBackend::Sqlite(store),
        })
    }

    pub fn add(&self, route: SignalRoute) -> Result<(), SignalStoreError> {
        let mut map = match self.routes.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut next = map.clone();
        next.entry(route.topic.clone()).or_default().push(route);
        self.persist_locked(&next)?;
        *map = next;
        Ok(())
    }

    pub fn get_all(&self) -> Vec<SignalRoute> {
        let map = match self.routes.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.values().flatten().cloned().collect()
    }

    pub fn get_by_id(&self, id: &str) -> Option<SignalRoute> {
        let map = match self.routes.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.values().flatten().find(|route| route.id == id).cloned()
    }

    pub fn update(
        &self,
        id: &str,
        mut updater: impl FnMut(&mut SignalRoute),
    ) -> Result<bool, SignalStoreError> {
        let mut map = match self.routes.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut next = map.clone();

        let mut found = false;
        let mut old_topic: Option<String> = None;
        let mut updated_route: Option<SignalRoute> = None;

        for (topic, routes) in next.iter_mut() {
            if let Some(route) = routes.iter_mut().find(|route| route.id == id) {
                old_topic = Some(topic.clone());
                updater(route);
                route.updated_at = chrono::Utc::now().to_rfc3339();
                updated_route = Some(route.clone());
                found = true;
                break;
            }
        }

        if let (Some(old), Some(route)) = (&old_topic, &updated_route)
            && *old != route.topic
        {
            if let Some(routes) = next.get_mut(old.as_str()) {
                routes.retain(|candidate| candidate.id != id);
                if routes.is_empty() {
                    next.remove(old.as_str());
                }
            }
            next.entry(route.topic.clone())
                .or_default()
                .push(route.clone());
        }

        if found {
            self.persist_locked(&next)?;
            *map = next;
        }
        Ok(found)
    }

    pub fn delete(&self, id: &str) -> Result<bool, SignalStoreError> {
        let mut map = match self.routes.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut next = map.clone();

        let mut found = false;
        let mut empty_topics = Vec::new();
        for (topic, routes) in next.iter_mut() {
            let before = routes.len();
            routes.retain(|route| route.id != id);
            if routes.len() < before {
                found = true;
                if routes.is_empty() {
                    empty_topics.push(topic.clone());
                }
            }
        }

        for topic in empty_topics {
            next.remove(&topic);
        }

        if found {
            self.persist_locked(&next)?;
            *map = next;
        }
        Ok(found)
    }

    pub fn match_routes(&self, topic: &str) -> Vec<SignalRoute> {
        let map = match self.routes.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut result = Vec::new();
        if let Some(routes) = map.get(topic) {
            for route in routes {
                if route.enabled {
                    result.push(route.clone());
                }
            }
        }

        if topic != "*"
            && let Some(wildcard_routes) = map.get("*")
        {
            for route in wildcard_routes {
                if route.enabled {
                    result.push(route.clone());
                }
            }
        }

        result
    }

    pub fn replace_all(&self, routes: Vec<SignalRoute>) -> Result<(), SignalStoreError> {
        let mut map = match self.routes.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let next = build_route_map(routes);
        self.persist_locked(&next)?;
        *map = next;
        Ok(())
    }

    pub(crate) fn replace_all_in_memory(&self, routes: Vec<SignalRoute>) {
        let mut map = match self.routes.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *map = build_route_map(routes);
    }

    fn persist_locked(
        &self,
        map: &HashMap<String, Vec<SignalRoute>>,
    ) -> Result<(), SignalStoreError> {
        let all_routes: Vec<SignalRoute> = map.values().flatten().cloned().collect();
        match &self.persist_backend {
            RoutePersistBackend::None => Ok(()),
            RoutePersistBackend::Json(path) => {
                let json = serde_json::to_string_pretty(&all_routes)?;
                std::fs::write(path, json)?;
                Ok(())
            }
            RoutePersistBackend::Sqlite(store) => store.replace_routes(&all_routes),
        }
    }
}

fn load_routes_from_default_and_json(
    default_path: Option<&Path>,
    persist_path: Option<&Path>,
) -> Vec<SignalRoute> {
    let mut all_routes = load_default_routes(default_path);

    if let Some(path) = persist_path
        && let Ok(data) = std::fs::read_to_string(path)
        && let Ok(persisted) = serde_json::from_str::<Vec<SignalRoute>>(&data)
    {
        all_routes.extend(persisted);
    }

    all_routes
}

fn load_default_routes(default_path: Option<&Path>) -> Vec<SignalRoute> {
    let mut routes = Vec::new();
    if let Some(path) = default_path
        && let Ok(data) = std::fs::read_to_string(path)
        && let Ok(entries) = serde_json::from_str::<Vec<DefaultRouteEntry>>(&data)
    {
        let now = chrono::Utc::now().to_rfc3339();
        for entry in entries {
            routes.push(SignalRoute {
                id: uuid::Uuid::new_v4().to_string(),
                enabled: true,
                topic: entry.topic,
                target_type: entry.target_type,
                target_ref: entry.target_ref,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }
    }
    routes
}

fn build_route_map(routes: Vec<SignalRoute>) -> HashMap<String, Vec<SignalRoute>> {
    let mut map = HashMap::new();
    for route in routes {
        map.entry(route.topic.clone())
            .or_insert_with(Vec::new)
            .push(route);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_route(topic: &str, target_ref: &str) -> SignalRoute {
        let now = chrono::Utc::now().to_rfc3339();
        SignalRoute {
            id: uuid::Uuid::new_v4().to_string(),
            enabled: true,
            topic: topic.to_string(),
            target_type: TargetType::Agent,
            target_ref: target_ref.to_string(),
            created_at: now.clone(),
            updated_at: now,
        }
    }

    #[test]
    fn add_and_get_all() {
        let table = RouteTable::new(None, None);
        table
            .add(make_route("user.input.text", "classifier"))
            .unwrap();
        table.add(make_route("session.end", "reviewer")).unwrap();
        assert_eq!(table.get_all().len(), 2);
    }

    #[test]
    fn get_by_id_returns_correct_route() {
        let table = RouteTable::new(None, None);
        let route = make_route("test.topic", "target-a");
        let id = route.id.clone();
        table.add(route).unwrap();

        let found = table.get_by_id(&id);
        assert!(found.is_some());
        assert_eq!(found.unwrap().target_ref, "target-a");
    }

    #[test]
    fn get_by_id_returns_none_for_missing() {
        let table = RouteTable::new(None, None);
        assert!(table.get_by_id("nonexistent").is_none());
    }

    #[test]
    fn delete_removes_route() {
        let table = RouteTable::new(None, None);
        let route = make_route("topic", "target");
        let id = route.id.clone();
        table.add(route).unwrap();

        assert!(table.delete(&id).unwrap());
        assert!(table.get_by_id(&id).is_none());
        assert_eq!(table.get_all().len(), 0);
    }

    #[test]
    fn delete_returns_false_for_missing() {
        let table = RouteTable::new(None, None);
        assert!(!table.delete("nonexistent").unwrap());
    }

    #[test]
    fn update_modifies_route() {
        let table = RouteTable::new(None, None);
        let route = make_route("topic", "old-target");
        let id = route.id.clone();
        table.add(route).unwrap();

        let updated = table.update(&id, |route| {
            route.target_ref = "new-target".to_string();
        });
        assert!(updated.unwrap());
        assert_eq!(table.get_by_id(&id).unwrap().target_ref, "new-target");
    }

    #[test]
    fn update_returns_false_for_missing() {
        let table = RouteTable::new(None, None);
        assert!(!table.update("nonexistent", |_| {}).unwrap());
    }

    #[test]
    fn match_routes_exact_and_wildcard() {
        let table = RouteTable::new(None, None);
        table
            .add(make_route("user.input.text", "classifier"))
            .unwrap();
        table.add(make_route("*", "ui")).unwrap();

        let matched = table.match_routes("user.input.text");
        assert_eq!(matched.len(), 2);

        let refs: Vec<&str> = matched
            .iter()
            .map(|route| route.target_ref.as_str())
            .collect();
        assert!(refs.contains(&"classifier"));
        assert!(refs.contains(&"ui"));
    }

    #[test]
    fn match_routes_wildcard_topic_does_not_double_match() {
        let table = RouteTable::new(None, None);
        table.add(make_route("*", "ui")).unwrap();

        let matched = table.match_routes("*");
        assert_eq!(matched.len(), 1);
    }

    #[test]
    fn disabled_routes_not_matched() {
        let table = RouteTable::new(None, None);
        let mut route = make_route("topic", "target");
        route.enabled = false;
        table.add(route).unwrap();

        let matched = table.match_routes("topic");
        assert_eq!(matched.len(), 0);
    }

    #[test]
    fn loads_default_routes_from_file() {
        let dir = std::env::temp_dir().join(format!("exomind-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let default_path = dir.join("defaults.json");
        std::fs::write(
            &default_path,
            r#"[
                {"topic": "user.input.text", "target_type": "agent", "target_ref": "classifier"},
                {"topic": "*", "target_type": "frontend", "target_ref": "ui"}
            ]"#,
        )
        .unwrap();

        let table = RouteTable::new(Some(&default_path), None);
        assert_eq!(table.get_all().len(), 2);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn persist_and_reload() {
        let dir = std::env::temp_dir().join(format!("exomind-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let persist_path = dir.join("routes.json");

        let table = RouteTable::new(None, Some(persist_path.clone()));
        let route = make_route("test", "target-persist");
        let id = route.id.clone();
        table.add(route).unwrap();

        let table2 = RouteTable::new(None, Some(persist_path));
        let reloaded = table2.get_by_id(&id);
        assert!(reloaded.is_some());
        assert_eq!(reloaded.unwrap().target_ref, "target-persist");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
