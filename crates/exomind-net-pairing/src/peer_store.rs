use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::pairing::PairedPeer;

/// JSON-serializable state persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PeerStoreData {
    pub paired_peers: HashMap<String, StoredPairedPeer>,
    pub identity_hex: Option<String>,
}

/// A paired peer with stable fields for persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPairedPeer {
    pub host_id: String,
    pub node_name: String,
    pub identity_hex: String,
    pub paired_at_ms: u64,
}

impl From<PairedPeer> for StoredPairedPeer {
    fn from(p: PairedPeer) -> Self {
        Self {
            host_id: p.host_id,
            node_name: p.node_name,
            identity_hex: p.identity_hex,
            paired_at_ms: p.paired_at_ms,
        }
    }
}

impl From<StoredPairedPeer> for PairedPeer {
    fn from(s: StoredPairedPeer) -> Self {
        Self {
            host_id: s.host_id,
            node_name: s.node_name,
            identity_hex: s.identity_hex,
            paired_at_ms: s.paired_at_ms,
        }
    }
}

/// Manages persistence of peer state to a JSON file.
pub struct PeerStore {
    path: PathBuf,
    data: PeerStoreData,
}

impl PeerStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let data = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        } else {
            PeerStoreData::default()
        };
        Self { path, data }
    }

    pub fn paired_peers(&self) -> Vec<PairedPeer> {
        self.data
            .paired_peers
            .values()
            .cloned()
            .map(PairedPeer::from)
            .collect()
    }

    pub fn add_paired_peer(&mut self, peer: PairedPeer) {
        let stored = StoredPairedPeer::from(peer);
        self.data
            .paired_peers
            .insert(stored.host_id.clone(), stored);
        self.flush();
    }

    pub fn identity_hex(&self) -> Option<&str> {
        self.data.identity_hex.as_deref()
    }

    pub fn set_identity_hex(&mut self, hex: String) {
        self.data.identity_hex = Some(hex);
        self.flush();
    }

    fn flush(&self) {
        if let Ok(content) = serde_json::to_string_pretty(&self.data) {
            let _ = std::fs::write(&self.path, content);
        }
    }
}
