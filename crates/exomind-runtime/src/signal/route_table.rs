use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::types::{SignalRoute, TargetType};

/// Persistent route table backed by a JSON file.
pub struct RouteTable {
    /// Routes indexed by topic for fast lookup.
    routes: RwLock<HashMap<String, Vec<SignalRoute>>>,
    /// Path to the user-mutable routes file (written on CRUD).
    persist_path: Option<PathBuf>,
}

/// Minimal JSON shape accepted in default-routes config files.
/// Fields like `id`, `enabled`, `created_at`, `updated_at` are auto-generated.
#[derive(serde::Deserialize)]
struct DefaultRouteEntry {
    topic: String,
    target_type: TargetType,
    target_ref: String,
}

impl RouteTable {
    /// Create a new RouteTable, optionally loading innate routes from `default_path`
    /// and user routes from `persist_path`.
    pub fn new(default_path: Option<&Path>, persist_path: Option<PathBuf>) -> Self {
        let mut all_routes: Vec<SignalRoute> = Vec::new();

        // Load innate (default) routes.
        if let Some(path) = default_path
            && let Ok(data) = std::fs::read_to_string(path)
            && let Ok(entries) = serde_json::from_str::<Vec<DefaultRouteEntry>>(&data)
        {
            let now = chrono::Utc::now().to_rfc3339();
            for entry in entries {
                all_routes.push(SignalRoute {
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

        // Load persisted user routes (overrides nothing, just appends).
        if let Some(ref path) = persist_path
            && let Ok(data) = std::fs::read_to_string(path)
            && let Ok(persisted) = serde_json::from_str::<Vec<SignalRoute>>(&data)
        {
            all_routes.extend(persisted);
        }

        let mut map: HashMap<String, Vec<SignalRoute>> = HashMap::new();
        for route in all_routes {
            map.entry(route.topic.clone()).or_default().push(route);
        }

        Self {
            routes: RwLock::new(map),
            persist_path,
        }
    }

    /// Add a new route and persist.
    pub fn add(&self, route: SignalRoute) {
        let topic = route.topic.clone();
        if let Ok(mut map) = self.routes.write() {
            map.entry(topic).or_default().push(route);
            self.persist_locked(&map);
        }
    }

    /// Get all routes across all topics.
    pub fn get_all(&self) -> Vec<SignalRoute> {
        let map = match self.routes.read() {
            Ok(m) => m,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.values().flatten().cloned().collect()
    }

    /// Get a route by its ID.
    pub fn get_by_id(&self, id: &str) -> Option<SignalRoute> {
        let map = match self.routes.read() {
            Ok(m) => m,
            Err(poisoned) => poisoned.into_inner(),
        };
        map.values().flatten().find(|r| r.id == id).cloned()
    }

    /// Update an existing route. Returns true if found and updated.
    pub fn update(&self, id: &str, mut updater: impl FnMut(&mut SignalRoute)) -> bool {
        let mut map = match self.routes.write() {
            Ok(m) => m,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Find the route across all topics.
        let mut found = false;
        let mut old_topic: Option<String> = None;
        let mut updated_route: Option<SignalRoute> = None;

        for (topic, routes) in map.iter_mut() {
            if let Some(route) = routes.iter_mut().find(|r| r.id == id) {
                old_topic = Some(topic.clone());
                updater(route);
                route.updated_at = chrono::Utc::now().to_rfc3339();
                updated_route = Some(route.clone());
                found = true;
                break;
            }
        }

        // If topic changed, relocate.
        if let (Some(old), Some(route)) = (&old_topic, &updated_route)
            && *old != route.topic
        {
            if let Some(routes) = map.get_mut(old.as_str()) {
                routes.retain(|r| r.id != id);
                if routes.is_empty() {
                    map.remove(old.as_str());
                }
            }
            let new_topic = route.topic.clone();
            map.entry(new_topic).or_default().push(route.clone());
        }

        if found {
            self.persist_locked(&map);
        }
        found
    }

    /// Delete a route by ID. Returns true if found and deleted.
    pub fn delete(&self, id: &str) -> bool {
        let mut map = match self.routes.write() {
            Ok(m) => m,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut found = false;
        let mut empty_topics = Vec::new();

        for (topic, routes) in map.iter_mut() {
            let before = routes.len();
            routes.retain(|r| r.id != id);
            if routes.len() < before {
                found = true;
                if routes.is_empty() {
                    empty_topics.push(topic.clone());
                }
            }
        }

        for topic in empty_topics {
            map.remove(&topic);
        }

        if found {
            self.persist_locked(&map);
        }
        found
    }

    /// Match routes for a given topic: exact match + wildcard "*".
    pub fn match_routes(&self, topic: &str) -> Vec<SignalRoute> {
        let map = match self.routes.read() {
            Ok(m) => m,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut result = Vec::new();

        // Exact match.
        if let Some(routes) = map.get(topic) {
            for r in routes {
                if r.enabled {
                    result.push(r.clone());
                }
            }
        }

        // Wildcard match (skip if topic is already "*").
        if topic != "*"
            && let Some(wildcard_routes) = map.get("*")
        {
            for r in wildcard_routes {
                if r.enabled {
                    result.push(r.clone());
                }
            }
        }

        result
    }

    /// Persist current state to the persist_path.
    fn persist_locked(&self, map: &HashMap<String, Vec<SignalRoute>>) {
        if let Some(ref path) = self.persist_path {
            let all: Vec<&SignalRoute> = map.values().flatten().collect();
            if let Ok(json) = serde_json::to_string_pretty(&all) {
                // Best-effort write; ignore errors.
                let _ = std::fs::write(path, json);
            }
        }
    }
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
        table.add(make_route("user.input.text", "classifier"));
        table.add(make_route("session.end", "reviewer"));
        assert_eq!(table.get_all().len(), 2);
    }

    #[test]
    fn get_by_id_returns_correct_route() {
        let table = RouteTable::new(None, None);
        let route = make_route("test.topic", "target-a");
        let id = route.id.clone();
        table.add(route);

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
        table.add(route);

        assert!(table.delete(&id));
        assert!(table.get_by_id(&id).is_none());
        assert_eq!(table.get_all().len(), 0);
    }

    #[test]
    fn delete_returns_false_for_missing() {
        let table = RouteTable::new(None, None);
        assert!(!table.delete("nonexistent"));
    }

    #[test]
    fn update_modifies_route() {
        let table = RouteTable::new(None, None);
        let route = make_route("topic", "old-target");
        let id = route.id.clone();
        table.add(route);

        let updated = table.update(&id, |r| {
            r.target_ref = "new-target".to_string();
        });
        assert!(updated);
        assert_eq!(table.get_by_id(&id).unwrap().target_ref, "new-target");
    }

    #[test]
    fn update_returns_false_for_missing() {
        let table = RouteTable::new(None, None);
        assert!(!table.update("nonexistent", |_| {}));
    }

    #[test]
    fn match_routes_exact_and_wildcard() {
        let table = RouteTable::new(None, None);
        table.add(make_route("user.input.text", "classifier"));
        table.add(make_route("*", "ui"));

        let matched = table.match_routes("user.input.text");
        assert_eq!(matched.len(), 2);

        let refs: Vec<&str> = matched.iter().map(|r| r.target_ref.as_str()).collect();
        assert!(refs.contains(&"classifier"));
        assert!(refs.contains(&"ui"));
    }

    #[test]
    fn match_routes_wildcard_topic_does_not_double_match() {
        let table = RouteTable::new(None, None);
        table.add(make_route("*", "ui"));

        // Querying for "*" itself should only return once.
        let matched = table.match_routes("*");
        assert_eq!(matched.len(), 1);
    }

    #[test]
    fn disabled_routes_not_matched() {
        let table = RouteTable::new(None, None);
        let mut route = make_route("topic", "target");
        route.enabled = false;
        table.add(route);

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

        // Create table and add a route.
        let table = RouteTable::new(None, Some(persist_path.clone()));
        let route = make_route("test", "target-persist");
        let id = route.id.clone();
        table.add(route);

        // Reload from persisted file.
        let table2 = RouteTable::new(None, Some(persist_path));
        let reloaded = table2.get_by_id(&id);
        assert!(reloaded.is_some());
        assert_eq!(reloaded.unwrap().target_ref, "target-persist");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
