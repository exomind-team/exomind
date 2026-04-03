use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CliState {
    pub default_target: Option<String>,
    #[serde(default)]
    pub targets: BTreeMap<String, TargetState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct TargetState {
    pub default_profile: Option<String>,
    pub auth_token: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

impl CliState {
    pub fn config_path() -> Option<PathBuf> {
        dirs::config_dir().map(|dir| dir.join("ExoMind").join("cli-state.json"))
    }

    pub fn load(path: &Path) -> io::Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let raw = fs::read_to_string(path)?;
        serde_json::from_str(&raw)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let raw = serde_json::to_string_pretty(self)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(path, raw)
    }

    pub fn target_state(&self, target: &str) -> Option<&TargetState> {
        self.targets.get(target)
    }

    pub fn target_state_mut(&mut self, target: &str) -> &mut TargetState {
        self.targets.entry(target.to_string()).or_default()
    }
}
