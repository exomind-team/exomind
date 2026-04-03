#[derive(Debug, Clone, PartialEq, Eq)]
enum ScopeSource {
    Profile,
    UserId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileScope {
    scope_key: String,
    source: ScopeSource,
}

impl ProfileScope {
    pub fn from_flags(profile: Option<&str>, user_id: Option<&str>) -> Option<Self> {
        if let Some(profile) = normalize_profile(profile) {
            return Some(Self {
                scope_key: profile,
                source: ScopeSource::Profile,
            });
        }

        normalize_user_id(user_id).map(|user_id| Self {
            scope_key: user_id,
            source: ScopeSource::UserId,
        })
    }

    pub fn scope_key(&self) -> Option<&str> {
        Some(&self.scope_key)
    }

    pub fn task_query_pairs(&self) -> Vec<(String, String)> {
        match self.source {
            ScopeSource::Profile => {
                vec![("profile_id".to_string(), self.scope_key.clone())]
            }
            ScopeSource::UserId => vec![("user_id".to_string(), self.scope_key.clone())],
        }
    }

    pub fn proposal_query_pairs(&self) -> Vec<(String, String)> {
        self.task_query_pairs()
    }

    pub fn eventlog_query_pairs(&self) -> Vec<(String, String)> {
        vec![("user_id".to_string(), self.scope_key.clone())]
    }
}

fn normalize_profile(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    if value.starts_with("profile-") {
        Some(value.to_string())
    } else {
        Some(format!("profile-{value}"))
    }
}

fn normalize_user_id(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
