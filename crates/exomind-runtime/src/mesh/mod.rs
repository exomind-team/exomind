use crate::signal::{DeliveryRecord, DeliveryStatus, SignalEvent, SignalPool, TargetType};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use thiserror::Error;
use tokio::sync::{Mutex, oneshot};
use tokio::task::JoinHandle;
use tokio::time::Duration;

pub const MAX_HOP: u8 = 8;
const DEDUPE_CAPACITY: usize = 4096;
const LINK_PROOF_REQUEST_TOPIC: &str = "system.link_proof.request";
const LINK_PROOF_ACK_TOPIC: &str = "system.link_proof.ack";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PeerStatus {
    Unknown,
    Connecting,
    Online,
    Error,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub id: String,
    pub base_url: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub status: PeerStatus,
    pub last_seen: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Outbound token: what this RT sends as Bearer when calling the peer.
    #[serde(default)]
    pub auth_token: Option<String>,
    /// Inbound token: what the peer must send as Bearer when calling us.
    /// Generated during pairing and checked by `require_auth`.
    #[serde(default)]
    pub inbound_secret: Option<String>,
}

/// API-safe view of PeerInfo that excludes secret fields.
#[derive(Debug, Clone, Serialize)]
pub struct PeerInfoPublic {
    pub id: String,
    pub host_id: String,
    pub base_url: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub status: PeerStatus,
    pub last_seen: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<&PeerInfo> for PeerInfoPublic {
    fn from(p: &PeerInfo) -> Self {
        Self {
            id: p.id.clone(),
            host_id: p.id.clone(),
            base_url: p.base_url.clone(),
            enabled: p.enabled,
            capabilities: p.capabilities.clone(),
            status: p.status.clone(),
            last_seen: p.last_seen.clone(),
            last_error: p.last_error.clone(),
            created_at: p.created_at.clone(),
            updated_at: p.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInterestSnapshot {
    pub peer_id: String,
    pub topics: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerScopeGrant {
    pub peer_id: String,
    pub domain: String,
    pub scope_key: String,
    pub granted_at: String,
    pub granted_by: String,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ScopeGrantLookupError {
    #[error("multiple active grants for peer `{peer_id}` domain `{domain}`")]
    MultipleActiveGrants { peer_id: String, domain: String },
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum InboundSecretLookupError {
    #[error("multiple enabled peers share the same inbound secret")]
    MultipleEnabledPeers,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MeshPersistedState {
    peers: Vec<PeerInfo>,
    interests: Vec<PeerInterestSnapshot>,
    #[serde(default)]
    scope_grants: Vec<PeerScopeGrant>,
}

#[derive(Debug, Default)]
struct DedupeWindow {
    order: VecDeque<String>,
    seen: HashSet<String>,
}

impl DedupeWindow {
    fn remember(&mut self, event_id: &str) -> bool {
        if self.seen.contains(event_id) {
            return false;
        }

        self.order.push_back(event_id.to_string());
        self.seen.insert(event_id.to_string());

        while self.order.len() > DEDUPE_CAPACITY {
            if let Some(evicted) = self.order.pop_front() {
                self.seen.remove(&evicted);
            }
        }

        true
    }
}

pub struct MeshState {
    host_id: String,
    signal_pool: Arc<SignalPool>,
    persist_path: Option<PathBuf>,
    peers: RwLock<HashMap<String, PeerInfo>>,
    interests: RwLock<HashMap<String, PeerInterestSnapshot>>,
    scope_grants: RwLock<Vec<PeerScopeGrant>>,
    dedupe: RwLock<DedupeWindow>,
}

impl MeshState {
    pub fn new(
        host_id: String,
        signal_pool: Arc<SignalPool>,
        persist_path: Option<PathBuf>,
    ) -> Self {
        let persisted = persist_path.as_ref().and_then(load_persisted_state);

        let mut peers = HashMap::new();
        let mut interests = HashMap::new();
        let mut scope_grants = Vec::new();

        if let Some(state) = persisted {
            for peer in state.peers {
                peers.insert(peer.id.clone(), peer);
            }
            for snapshot in state.interests {
                interests.insert(snapshot.peer_id.clone(), snapshot);
            }
            scope_grants = state
                .scope_grants
                .into_iter()
                .filter(|grant| {
                    peers
                        .get(&grant.peer_id)
                        .map(|peer| peer.enabled)
                        .unwrap_or(false)
                })
                .collect::<Vec<_>>();
            sort_scope_grants(&mut scope_grants);
        }

        Self {
            host_id,
            signal_pool,
            persist_path,
            peers: RwLock::new(peers),
            interests: RwLock::new(interests),
            scope_grants: RwLock::new(scope_grants),
            dedupe: RwLock::new(DedupeWindow::default()),
        }
    }

    pub fn host_id(&self) -> &str {
        &self.host_id
    }

    pub fn list_peers(&self) -> Vec<PeerInfo> {
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut items = peers.values().cloned().collect::<Vec<_>>();
        items.sort_by(|left, right| left.id.cmp(&right.id));
        items
    }

    /// List peers without secret fields (for API responses).
    pub fn list_peers_public(&self) -> Vec<PeerInfoPublic> {
        self.list_peers().iter().map(PeerInfoPublic::from).collect()
    }

    /// Check if any **enabled** peer has the given inbound_secret.
    /// Disabled peers are excluded so that disabling a peer immediately revokes its token.
    pub fn has_peer_with_inbound_secret(&self, secret: &str) -> bool {
        matches!(self.peer_id_by_inbound_secret(secret), Ok(Some(_)))
    }

    pub fn peer_id_by_inbound_secret(
        &self,
        secret: &str,
    ) -> Result<Option<String>, InboundSecretLookupError> {
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let matches = peers
            .values()
            .find(|p| p.enabled && p.inbound_secret.as_deref() == Some(secret))
            .map(|peer| peer.id.clone());

        let duplicate_count = peers
            .values()
            .filter(|p| p.enabled && p.inbound_secret.as_deref() == Some(secret))
            .count();

        match duplicate_count {
            0 => Ok(None),
            1 => Ok(matches),
            _ => Err(InboundSecretLookupError::MultipleEnabledPeers),
        }
    }

    pub fn get_peer(&self, peer_id: &str) -> Option<PeerInfo> {
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        peers.get(peer_id).cloned()
    }

    pub fn upsert_peer(&self, mut peer: PeerInfo) -> PeerInfo {
        normalize_peer(&mut peer);
        let now = now_rfc3339();
        let had_existing = self.get_peer(&peer.id).is_some();

        {
            let mut peers = match self.peers.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(existing) = peers.get(&peer.id) {
                if peer.created_at.is_empty() {
                    peer.created_at = existing.created_at.clone();
                }
                if peer.last_seen.is_none() {
                    peer.last_seen = existing.last_seen.clone();
                }
                if peer.last_error.is_none() {
                    peer.last_error = existing.last_error.clone();
                }
                if peer.auth_token.is_none() {
                    peer.auth_token = existing.auth_token.clone();
                }
                if peer.inbound_secret.is_none() {
                    peer.inbound_secret = existing.inbound_secret.clone();
                }
                if peer.created_at.is_empty() {
                    peer.created_at = now.clone();
                }
            } else if peer.created_at.is_empty() {
                peer.created_at = now.clone();
            }

            peer.updated_at = now.clone();

            if peer.enabled {
                if matches!(peer.status, PeerStatus::Disabled) {
                    peer.status = PeerStatus::Unknown;
                }
            } else {
                peer.status = PeerStatus::Disabled;
            }

            peers.insert(peer.id.clone(), peer.clone());
        }

        self.persist();
        if !had_existing {
            self.revoke_all_scope_grants_for_peer(&peer.id);
        }
        if !peer.enabled {
            self.revoke_all_scope_grants_for_peer(&peer.id);
        }
        peer
    }

    pub fn delete_peer(&self, peer_id: &str) -> bool {
        let removed = {
            let mut peers = match self.peers.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            peers.remove(peer_id).is_some()
        };

        if removed {
            let mut interests = match self.interests.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            interests.remove(peer_id);
            drop(interests);
            self.revoke_all_scope_grants_for_peer(peer_id);
            self.persist();
        }

        removed
    }

    pub fn upsert_scope_grant(&self, mut grant: PeerScopeGrant) -> PeerScopeGrant {
        grant.domain = grant.domain.trim().to_string();
        grant.scope_key = grant.scope_key.trim().to_string();
        grant.granted_by = grant.granted_by.trim().to_string();

        {
            let mut grants = match self.scope_grants.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            grants.retain(|existing| {
                !(existing.peer_id == grant.peer_id && existing.domain == grant.domain)
            });
            grants.push(grant.clone());
            sort_scope_grants(&mut grants);
        }

        self.persist();
        grant
    }

    pub fn reconcile_scope_grants_for_enabled_peers(
        &self,
        domain: &str,
        scope_key: &str,
        granted_by: &str,
    ) -> Vec<PeerScopeGrant> {
        let enabled_peer_ids = self
            .list_peers()
            .into_iter()
            .filter(|peer| peer.enabled)
            .map(|peer| peer.id)
            .collect::<Vec<_>>();
        let granted_at = now_rfc3339();
        let domain = domain.trim().to_string();
        let scope_key = scope_key.trim().to_string();
        let granted_by = granted_by.trim().to_string();

        let next_grants = {
            let mut grants = match self.scope_grants.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            grants.retain(|grant| grant.domain != domain);

            let mut next = Vec::with_capacity(enabled_peer_ids.len());
            for peer_id in enabled_peer_ids {
                let grant = PeerScopeGrant {
                    peer_id,
                    domain: domain.clone(),
                    scope_key: scope_key.clone(),
                    granted_at: granted_at.clone(),
                    granted_by: granted_by.clone(),
                };
                grants.push(grant.clone());
                next.push(grant);
            }

            sort_scope_grants(&mut grants);
            next
        };

        self.persist();
        next_grants
    }

    pub fn resolve_scope_key_for_peer_domain(
        &self,
        peer_id: &str,
        domain: &str,
    ) -> Result<Option<String>, ScopeGrantLookupError> {
        let grants = match self.scope_grants.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if !peers.get(peer_id).map(|peer| peer.enabled).unwrap_or(false) {
            return Ok(None);
        }
        let matches = grants
            .iter()
            .filter(|grant| grant.peer_id == peer_id && grant.domain == domain)
            .cloned()
            .collect::<Vec<_>>();

        match matches.as_slice() {
            [] => Ok(None),
            [grant] => Ok(Some(grant.scope_key.clone())),
            _ => Err(ScopeGrantLookupError::MultipleActiveGrants {
                peer_id: peer_id.to_string(),
                domain: domain.to_string(),
            }),
        }
    }

    pub fn revoke_scope_grant(&self, peer_id: &str, domain: &str) -> bool {
        let removed = {
            let mut grants = match self.scope_grants.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let before = grants.len();
            grants.retain(|grant| !(grant.peer_id == peer_id && grant.domain == domain));
            before != grants.len()
        };

        if removed {
            self.persist();
        }

        removed
    }

    pub fn revoke_all_scope_grants_for_peer(&self, peer_id: &str) -> bool {
        let removed = {
            let mut grants = match self.scope_grants.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let before = grants.len();
            grants.retain(|grant| grant.peer_id != peer_id);
            before != grants.len()
        };

        if removed {
            self.persist();
        }

        removed
    }

    pub fn set_peer_interests(&self, peer_id: &str, topics: Vec<String>) -> PeerInterestSnapshot {
        let snapshot = PeerInterestSnapshot {
            peer_id: peer_id.to_string(),
            topics: normalize_topics(topics),
            updated_at: now_rfc3339(),
        };

        {
            let mut interests = match self.interests.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            interests.insert(peer_id.to_string(), snapshot.clone());
        }

        self.persist();
        snapshot
    }

    pub fn get_peer_interests(&self, peer_id: &str) -> Option<PeerInterestSnapshot> {
        let interests = match self.interests.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        interests.get(peer_id).cloned()
    }

    pub fn peer_accepts_topic(&self, peer_id: &str, topic: &str) -> bool {
        self.get_peer_interests(peer_id)
            .map(|snapshot| {
                snapshot
                    .topics
                    .iter()
                    .any(|item| item == "*" || item == topic)
            })
            .unwrap_or(false)
    }

    pub fn local_interest_topics(&self) -> Vec<String> {
        let mut topics = self
            .signal_pool
            .routes()
            .get_all()
            .into_iter()
            .filter(|route| route.enabled && !matches!(route.target_type, TargetType::Remote))
            .map(|route| route.topic)
            .collect::<Vec<_>>();
        topics.sort();
        topics.dedup();
        topics
    }

    pub fn recent_delivery_records(&self, limit: usize) -> Vec<DeliveryRecord> {
        self.signal_pool.journal().recent(limit)
    }

    pub fn record_signal_delivery(
        &self,
        event_id: &str,
        route_id: impl Into<String>,
        target_ref: impl Into<String>,
        status: DeliveryStatus,
        reason: Option<String>,
    ) {
        let route_id = route_id.into();
        let target_ref = target_ref.into();
        let now = now_rfc3339();
        if let Err(error) = self.signal_pool.journal().append(DeliveryRecord {
            event_id: event_id.to_string(),
            route_id: route_id.clone(),
            target_ref,
            status,
            reason,
            started_at: now.clone(),
            finished_at: now,
        }) {
            tracing::warn!(
                event_id = %event_id,
                route_id = %route_id,
                error = %error,
                "signal delivery journal append failed (Signal 投递日志追加失败)"
            );
        }
    }

    pub fn should_stream_event_to_peer(&self, peer_id: &str, event: &SignalEvent) -> bool {
        if event.origin_host_id == peer_id {
            return false;
        }
        if event.hop >= MAX_HOP {
            return false;
        }

        if is_targeted_link_proof_event_for_peer(event, peer_id) {
            return true;
        }

        let targeted_by_remote_route = self
            .signal_pool
            .routes()
            .match_routes(&event.topic)
            .iter()
            .any(|route| {
                matches!(route.target_type, TargetType::Remote) && route.target_ref == peer_id
            });

        targeted_by_remote_route || self.peer_accepts_topic(peer_id, &event.topic)
    }

    pub async fn ingest_remote_event(
        &self,
        from_peer_id: &str,
        mut event: SignalEvent,
    ) -> Result<bool, Infallible> {
        if event.origin_host_id == self.host_id {
            self.record_mesh_delivery(
                &event.id,
                from_peer_id,
                DeliveryStatus::Skipped,
                Some("origin bounce".to_string()),
            );
            return Ok(false);
        }

        if event.hop >= MAX_HOP {
            self.record_mesh_delivery(
                &event.id,
                from_peer_id,
                DeliveryStatus::Skipped,
                Some("hop limit".to_string()),
            );
            return Ok(false);
        }

        let accepted = {
            let mut dedupe = match self.dedupe.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            dedupe.remember(&event.id)
        };

        if !accepted {
            self.record_mesh_delivery(
                &event.id,
                from_peer_id,
                DeliveryStatus::Skipped,
                Some("duplicate event id".to_string()),
            );
            return Ok(false);
        }

        event.hop = event.hop.saturating_add(1);
        self.mark_peer_online(from_peer_id);
        self.signal_pool.publish(event.clone());
        self.record_mesh_delivery(&event.id, from_peer_id, DeliveryStatus::Sent, None);

        Ok(true)
    }

    pub fn mark_peer_online(&self, peer_id: &str) {
        self.update_peer_metadata(peer_id, |peer| {
            peer.status = PeerStatus::Online;
            peer.last_seen = Some(now_rfc3339());
            peer.last_error = None;
        });
    }

    pub fn mark_peer_connecting(&self, peer_id: &str) {
        self.update_peer_metadata(peer_id, |peer| {
            peer.status = PeerStatus::Connecting;
            peer.last_error = None;
        });
    }

    pub fn mark_peer_error(&self, peer_id: &str, error: impl Into<String>) {
        let error = error.into();
        self.update_peer_metadata(peer_id, move |peer| {
            peer.status = PeerStatus::Error;
            peer.last_error = Some(error.clone());
        });
    }

    fn update_peer_metadata(&self, peer_id: &str, mut updater: impl FnMut(&mut PeerInfo)) {
        let updated = {
            let mut peers = match self.peers.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(peer) = peers.get_mut(peer_id) {
                updater(peer);
                peer.updated_at = now_rfc3339();
                true
            } else {
                false
            }
        };

        if updated {
            self.persist();
        }
    }

    fn record_mesh_delivery(
        &self,
        event_id: &str,
        peer_id: &str,
        status: DeliveryStatus,
        reason: Option<String>,
    ) {
        self.record_signal_delivery(
            event_id,
            format!("mesh:{peer_id}"),
            peer_id.to_string(),
            status,
            reason,
        );
    }

    fn persist(&self) {
        let Some(path) = &self.persist_path else {
            return;
        };

        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let peers = match self.peers.read() {
            Ok(guard) => guard.values().cloned().collect::<Vec<_>>(),
            Err(poisoned) => poisoned.into_inner().values().cloned().collect::<Vec<_>>(),
        };
        let interests = match self.interests.read() {
            Ok(guard) => guard.values().cloned().collect::<Vec<_>>(),
            Err(poisoned) => poisoned.into_inner().values().cloned().collect::<Vec<_>>(),
        };
        let scope_grants = match self.scope_grants.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&MeshPersistedState {
            peers,
            interests,
            scope_grants,
        }) {
            let _ = std::fs::write(path, json);
        }
    }
}

pub struct MeshRelayManager {
    mesh: Arc<MeshState>,
    client: reqwest::Client,
    workers: Mutex<HashMap<String, WorkerHandle>>,
}

struct WorkerHandle {
    stop_tx: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

impl MeshRelayManager {
    pub fn new(mesh: Arc<MeshState>) -> Self {
        Self {
            mesh,
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            workers: Mutex::new(HashMap::new()),
        }
    }

    pub async fn reconcile_all_peers(self: &Arc<Self>) {
        for peer in self.mesh.list_peers() {
            self.reconcile_peer(&peer.id).await;
        }
    }

    pub async fn reconcile_peer(self: &Arc<Self>, peer_id: &str) {
        self.stop_worker(peer_id).await;

        let Some(peer) = self.mesh.get_peer(peer_id) else {
            return;
        };
        if !peer.enabled {
            return;
        }

        let (stop_tx, stop_rx) = oneshot::channel();
        let peer_id = peer.id.clone();
        let relay = Arc::clone(self);
        let task = tokio::spawn(async move {
            relay.peer_worker_loop(peer_id, stop_rx).await;
        });

        let mut workers = self.workers.lock().await;
        workers.insert(peer.id, WorkerHandle { stop_tx, task });
    }

    pub async fn remove_peer(&self, peer_id: &str) {
        self.stop_worker(peer_id).await;
    }

    pub async fn sync_local_interests_to_all_peers(&self) {
        for peer in self.mesh.list_peers() {
            let _ = self.sync_local_interests_to_peer(&peer.id).await;
        }
    }

    pub async fn sync_local_interests_to_peer(&self, peer_id: &str) -> Result<(), reqwest::Error> {
        let Some(peer) = self.mesh.get_peer(peer_id) else {
            return Ok(());
        };
        if !peer.enabled {
            return Ok(());
        }

        let url = format!(
            "{}/mesh/interests/{}",
            peer.base_url.trim_end_matches('/'),
            self.mesh.host_id()
        );
        let topics = self.mesh.local_interest_topics();
        let mut request = self
            .client
            .put(url)
            .timeout(Duration::from_secs(3))
            .json(&serde_json::json!({ "topics": topics }));
        if let Some(token) = &peer.auth_token {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        let response = request.send().await?;
        response.error_for_status()?;
        Ok(())
    }

    pub async fn forward_event_to_peers(&self, event: SignalEvent) {
        for peer in self.mesh.list_peers() {
            if !peer.enabled || !self.mesh.should_stream_event_to_peer(&peer.id, &event) {
                continue;
            }

            let url = format!("{}/mesh/events", peer.base_url.trim_end_matches('/'));
            let mut request =
                self.client
                    .post(url)
                    .timeout(Duration::from_secs(3))
                    .json(&serde_json::json!({
                        "from_peer_id": self.mesh.host_id(),
                        "event": event.clone(),
                    }));
            if let Some(token) = &peer.auth_token {
                request = request.header("Authorization", format!("Bearer {token}"));
            }
            let response = request.send().await;

            match response {
                Ok(response) => {
                    if let Err(error) = response.error_for_status() {
                        self.mesh.mark_peer_error(&peer.id, error.to_string());
                    } else {
                        self.mesh.mark_peer_online(&peer.id);
                    }
                }
                Err(error) => {
                    self.mesh.mark_peer_error(&peer.id, error.to_string());
                }
            }
        }
    }

    pub async fn shutdown(&self) {
        let handles = {
            let mut workers = self.workers.lock().await;
            workers
                .drain()
                .map(|(_, handle)| handle)
                .collect::<Vec<_>>()
        };

        for handle in handles {
            let _ = handle.stop_tx.send(());
            handle.task.abort();
            let _ = handle.task.await;
        }
    }

    async fn stop_worker(&self, peer_id: &str) {
        let handle = {
            let mut workers = self.workers.lock().await;
            workers.remove(peer_id)
        };

        if let Some(handle) = handle {
            let _ = handle.stop_tx.send(());
            handle.task.abort();
            let _ = handle.task.await;
        }
    }

    async fn peer_worker_loop(
        self: Arc<Self>,
        peer_id: String,
        mut stop_rx: oneshot::Receiver<()>,
    ) {
        let host_id = self.mesh.host_id().to_string();
        let mut last_event_id: Option<String> = None;

        loop {
            let Some(peer) = self.mesh.get_peer(&peer_id) else {
                return;
            };
            if !peer.enabled {
                return;
            }

            let _ = self.sync_local_interests_to_peer(&peer_id).await;
            self.mesh.mark_peer_connecting(&peer_id);

            let mut request = self.client.get(format!(
                "{}/mesh/stream?peer_id={host_id}&heartbeat_interval=10",
                peer.base_url.trim_end_matches('/')
            ));
            if let Some(token) = &peer.auth_token {
                request = request.header("Authorization", format!("Bearer {token}"));
            }
            if let Some(last_event_id) = last_event_id.as_deref() {
                request = request.header("Last-Event-ID", last_event_id);
            }

            let response = tokio::select! {
                _ = &mut stop_rx => return,
                result = request.send() => result,
            };

            let response = match response {
                Ok(response) => match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        self.mesh.mark_peer_error(&peer_id, error.to_string());
                        if wait_or_stop(&mut stop_rx, Duration::from_millis(500)).await {
                            return;
                        }
                        continue;
                    }
                },
                Err(error) => {
                    self.mesh.mark_peer_error(&peer_id, error.to_string());
                    if wait_or_stop(&mut stop_rx, Duration::from_millis(500)).await {
                        return;
                    }
                    continue;
                }
            };

            self.mesh.mark_peer_online(&peer_id);

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            loop {
                let next_chunk = tokio::select! {
                    _ = &mut stop_rx => return,
                    chunk = stream.next() => chunk,
                };

                match next_chunk {
                    Some(Ok(chunk)) => {
                        let normalized = String::from_utf8_lossy(&chunk).replace("\r\n", "\n");
                        buffer.push_str(&normalized);
                        for block in drain_sse_blocks(&mut buffer) {
                            if let Some(event) = parse_signal_event_from_block(&block) {
                                last_event_id = Some(event.id.clone());
                                let _ = self.mesh.ingest_remote_event(&peer_id, event).await;
                            }
                        }
                    }
                    Some(Err(error)) => {
                        self.mesh.mark_peer_error(&peer_id, error.to_string());
                        break;
                    }
                    None => {
                        break;
                    }
                }
            }

            if wait_or_stop(&mut stop_rx, Duration::from_millis(300)).await {
                return;
            }
        }
    }
}

async fn wait_or_stop(stop_rx: &mut oneshot::Receiver<()>, duration: Duration) -> bool {
    tokio::select! {
        _ = stop_rx => true,
        _ = tokio::time::sleep(duration) => false,
    }
}

fn normalize_peer(peer: &mut PeerInfo) {
    peer.base_url = peer.base_url.trim().trim_end_matches('/').to_string();
    peer.capabilities = normalize_topics(peer.capabilities.clone());
}

fn normalize_topics(mut topics: Vec<String>) -> Vec<String> {
    topics.retain(|topic| !topic.trim().is_empty());
    topics.sort();
    topics.dedup();
    topics
}

fn sort_scope_grants(grants: &mut Vec<PeerScopeGrant>) {
    grants.sort_by(|left, right| {
        left.domain
            .cmp(&right.domain)
            .then_with(|| left.peer_id.cmp(&right.peer_id))
            .then_with(|| left.scope_key.cmp(&right.scope_key))
    });
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn is_targeted_link_proof_event_for_peer(event: &SignalEvent, peer_id: &str) -> bool {
    matches!(
        event.topic.as_str(),
        LINK_PROOF_REQUEST_TOPIC | LINK_PROOF_ACK_TOPIC
    ) && event
        .payload
        .get("target_peer_id")
        .and_then(|value| value.as_str())
        .map(|target_peer_id| target_peer_id == peer_id)
        .unwrap_or(false)
}

fn load_persisted_state(path: &PathBuf) -> Option<MeshPersistedState> {
    let json = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<MeshPersistedState>(&json).ok()
}

fn drain_sse_blocks(buffer: &mut String) -> Vec<String> {
    let mut blocks = Vec::new();

    while let Some(index) = buffer.find("\n\n") {
        let block = buffer[..index].trim().to_string();
        buffer.drain(..index + 2);
        if !block.is_empty() {
            blocks.push(block);
        }
    }

    blocks
}

fn parse_signal_event_from_block(block: &str) -> Option<SignalEvent> {
    let mut event_name = "message";
    let mut data_lines = Vec::new();

    for line in block.lines() {
        if let Some(value) = line.strip_prefix("event:") {
            event_name = value.trim();
            continue;
        }
        if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }

    if event_name != "signal" || data_lines.is_empty() {
        return None;
    }

    serde_json::from_str::<SignalEvent>(&data_lines.join("\n")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use tempfile::tempdir;

    fn make_peer(id: &str) -> PeerInfo {
        PeerInfo {
            id: id.to_string(),
            base_url: format!("http://{id}.local:1949"),
            enabled: true,
            capabilities: vec![],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            auth_token: None,
            inbound_secret: None,
        }
    }

    fn make_link_proof_event(topic: &str, target_peer_id: &str) -> SignalEvent {
        let ack_kind = if topic == "system.link_proof.ack" {
            Some("receipt")
        } else {
            None
        };

        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "ui:test".to_string(),
            origin_host_id: "host-local".to_string(),
            hop: 0,
            trace_id: Some("trace-link-proof".to_string()),
            payload: serde_json::json!({
                "proof_session_id": "proof-session-1",
                "attempt_id": "attempt-1",
                "initiated_by_peer_id": "host-local",
                "target_peer_id": target_peer_id,
                "ack_kind": ack_kind
            }),
        }
    }

    #[test]
    fn streams_link_proof_events_to_target_peer_without_route_or_interest() {
        let pool = Arc::new(SignalPool::new(None));
        let mesh = MeshState::new("host-local".to_string(), Arc::clone(&pool), None);
        mesh.upsert_peer(make_peer("host-phone"));

        for topic in ["system.link_proof.request", "system.link_proof.ack"] {
            let event = make_link_proof_event(topic, "host-phone");
            assert!(
                mesh.should_stream_event_to_peer("host-phone", &event),
                "targeted {topic} should bypass route/interest checks（应绕过路由/兴趣检查）"
            );
        }
    }

    #[test]
    fn does_not_stream_link_proof_events_to_non_target_peer_without_route_or_interest() {
        let pool = Arc::new(SignalPool::new(None));
        let mesh = MeshState::new("host-local".to_string(), Arc::clone(&pool), None);
        mesh.upsert_peer(make_peer("host-phone"));

        for topic in ["system.link_proof.request", "system.link_proof.ack"] {
            let event = make_link_proof_event(topic, "host-tablet");
            assert!(
                !mesh.should_stream_event_to_peer("host-phone", &event),
                "non-targeted {topic} should not leak to other peers（不应泄漏到其他节点）"
            );
        }
    }

    #[test]
    fn upsert_peer_preserves_existing_secrets_when_request_omits_them() {
        let pool = Arc::new(SignalPool::new(None));
        let mesh = MeshState::new("host-local".to_string(), Arc::clone(&pool), None);

        mesh.upsert_peer(PeerInfo {
            id: "host-phone".to_string(),
            base_url: "http://host-phone.local:1949".to_string(),
            enabled: true,
            capabilities: vec!["relay".to_string()],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            auth_token: Some("token-outbound".to_string()),
            inbound_secret: Some("token-inbound".to_string()),
        });

        mesh.upsert_peer(PeerInfo {
            id: "host-phone".to_string(),
            base_url: "http://host-phone.local:1950".to_string(),
            enabled: true,
            capabilities: vec!["relay".to_string()],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: String::new(),
            updated_at: String::new(),
            auth_token: None,
            inbound_secret: None,
        });

        let peer = mesh
            .get_peer("host-phone")
            .expect("peer should still exist after upsert");
        assert_eq!(peer.base_url, "http://host-phone.local:1950");
        assert_eq!(peer.auth_token.as_deref(), Some("token-outbound"));
        assert_eq!(peer.inbound_secret.as_deref(), Some("token-inbound"));
    }

    #[test]
    fn reloads_persisted_peers_and_interests_from_disk() {
        let temp_dir = tempdir().unwrap();
        let persist_path = temp_dir.path().join("mesh-state.json");
        let pool = Arc::new(SignalPool::new(None));

        let original = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path.clone()),
        );
        original.upsert_peer(PeerInfo {
            id: "host-phone".to_string(),
            base_url: "http://host-phone.local:1949".to_string(),
            enabled: true,
            capabilities: vec!["relay".to_string()],
            status: PeerStatus::Online,
            last_seen: Some(chrono::Utc::now().to_rfc3339()),
            last_error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            auth_token: Some("token-outbound".to_string()),
            inbound_secret: Some("token-inbound".to_string()),
        });
        original.set_peer_interests(
            "host-phone",
            vec!["eventlog.replication.appended".to_string()],
        );

        let reopened = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path),
        );
        let peer = reopened
            .get_peer("host-phone")
            .expect("peer should reload from persisted mesh state");
        assert_eq!(peer.base_url, "http://host-phone.local:1949");
        assert_eq!(peer.auth_token.as_deref(), Some("token-outbound"));
        assert_eq!(peer.inbound_secret.as_deref(), Some("token-inbound"));

        let interests = reopened
            .get_peer_interests("host-phone")
            .expect("peer interests should reload from persisted mesh state");
        assert_eq!(
            interests.topics,
            vec!["eventlog.replication.appended".to_string()]
        );
    }

    #[test]
    fn persists_and_reloads_peer_scope_grants() {
        let temp_dir = tempdir().unwrap();
        let persist_path = temp_dir.path().join("mesh-state.json");
        let pool = Arc::new(SignalPool::new(None));

        let original = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path.clone()),
        );
        original.upsert_peer(make_peer("host-phone"));
        original.upsert_scope_grant(PeerScopeGrant {
            peer_id: "host-phone".to_string(),
            domain: "tasks".to_string(),
            scope_key: "profile-a".to_string(),
            granted_at: "2026-04-13T00:00:00Z".to_string(),
            granted_by: "test".to_string(),
        });

        let reopened = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path),
        );

        let scope_key = reopened
            .resolve_scope_key_for_peer_domain("host-phone", "tasks")
            .expect("scope grant lookup should succeed");
        assert_eq!(scope_key.as_deref(), Some("profile-a"));
    }

    #[test]
    fn duplicate_peer_scope_grants_fail_closed() {
        let temp_dir = tempdir().unwrap();
        let persist_path = temp_dir.path().join("mesh-state.json");
        std::fs::write(
            &persist_path,
            serde_json::json!({
                "peers": [
                    {
                        "id": "host-phone",
                        "base_url": "http://host-phone.local:1949",
                        "enabled": true,
                        "capabilities": [],
                        "status": "unknown",
                        "last_seen": null,
                        "last_error": null,
                        "created_at": "2026-04-13T00:00:00Z",
                        "updated_at": "2026-04-13T00:00:00Z",
                        "auth_token": null,
                        "inbound_secret": "peer-secret"
                    }
                ],
                "interests": [],
                "scope_grants": [
                    {
                        "peer_id": "host-phone",
                        "domain": "tasks",
                        "scope_key": "profile-a",
                        "granted_at": "2026-04-13T00:00:00Z",
                        "granted_by": "test"
                    },
                    {
                        "peer_id": "host-phone",
                        "domain": "tasks",
                        "scope_key": "profile-b",
                        "granted_at": "2026-04-13T00:01:00Z",
                        "granted_by": "test"
                    }
                ]
            })
            .to_string(),
        )
        .unwrap();

        let pool = Arc::new(SignalPool::new(None));
        let reopened = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path),
        );

        let error = reopened
            .resolve_scope_key_for_peer_domain("host-phone", "tasks")
            .expect_err("multiple grants must fail closed");
        assert_eq!(
            error,
            ScopeGrantLookupError::MultipleActiveGrants {
                peer_id: "host-phone".to_string(),
                domain: "tasks".to_string(),
            }
        );
    }

    #[test]
    fn duplicate_inbound_secrets_fail_closed() {
        let pool = Arc::new(SignalPool::new(None));
        let mesh = MeshState::new("host-local".to_string(), Arc::clone(&pool), None);
        mesh.upsert_peer(PeerInfo {
            id: "host-phone".to_string(),
            base_url: "http://host-phone.local:1949".to_string(),
            enabled: true,
            capabilities: vec![],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: "2026-04-13T00:00:00Z".to_string(),
            updated_at: "2026-04-13T00:00:00Z".to_string(),
            auth_token: None,
            inbound_secret: Some("shared-secret".to_string()),
        });
        mesh.upsert_peer(PeerInfo {
            id: "host-tablet".to_string(),
            base_url: "http://host-tablet.local:1949".to_string(),
            enabled: true,
            capabilities: vec![],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: "2026-04-13T00:00:00Z".to_string(),
            updated_at: "2026-04-13T00:00:00Z".to_string(),
            auth_token: None,
            inbound_secret: Some("shared-secret".to_string()),
        });

        assert_eq!(
            mesh.peer_id_by_inbound_secret("shared-secret"),
            Err(InboundSecretLookupError::MultipleEnabledPeers)
        );
        assert!(!mesh.has_peer_with_inbound_secret("shared-secret"));
    }

    #[test]
    fn stale_scope_grants_for_missing_peers_are_filtered_on_load() {
        let temp_dir = tempdir().unwrap();
        let persist_path = temp_dir.path().join("mesh-state.json");
        std::fs::write(
            &persist_path,
            serde_json::json!({
                "peers": [],
                "interests": [],
                "scope_grants": [
                    {
                        "peer_id": "host-phone",
                        "domain": "tasks",
                        "scope_key": "profile-a",
                        "granted_at": "2026-04-13T00:00:00Z",
                        "granted_by": "test"
                    }
                ]
            })
            .to_string(),
        )
        .unwrap();

        let pool = Arc::new(SignalPool::new(None));
        let reopened = MeshState::new(
            "host-local".to_string(),
            Arc::clone(&pool),
            Some(persist_path),
        );

        assert_eq!(
            reopened
                .resolve_scope_key_for_peer_domain("host-phone", "tasks")
                .unwrap(),
            None
        );

        reopened.upsert_peer(make_peer("host-phone"));
        assert_eq!(
            reopened
                .resolve_scope_key_for_peer_domain("host-phone", "tasks")
                .unwrap(),
            None
        );
    }
}
