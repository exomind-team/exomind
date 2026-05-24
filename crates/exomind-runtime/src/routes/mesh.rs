use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use futures_util::stream::{self, Stream};
use serde::Deserialize;
use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::sync::broadcast;
use tokio::time::{Duration, Interval};

use crate::AppState;
use crate::discovery::DiscoveredPeer;
use crate::mesh::{PeerInfo, PeerInfoPublic, PeerInterestSnapshot, PeerStatus};
use serde::Serialize;

#[derive(Debug, Deserialize)]
struct CreatePeerRequest {
    id: String,
    base_url: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    auth_token: Option<String>,
    #[serde(default)]
    inbound_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdatePeerRequest {
    base_url: Option<String>,
    enabled: Option<bool>,
    capabilities: Option<Vec<String>>,
    auth_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateInterestsRequest {
    #[serde(default)]
    topics: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct IngestRemoteEventRequest {
    from_peer_id: String,
    event: crate::signal::SignalEvent,
}

#[derive(Debug, Deserialize)]
struct MeshStreamQuery {
    peer_id: String,
    #[serde(default = "default_heartbeat_interval")]
    heartbeat_interval: u64,
}

fn default_enabled() -> bool {
    true
}

fn default_heartbeat_interval() -> u64 {
    30
}

async fn list_peers(State(state): State<AppState>) -> Json<Vec<PeerInfoPublic>> {
    Json(state.mesh.list_peers_public())
}

async fn create_peer(
    State(state): State<AppState>,
    Json(req): Json<CreatePeerRequest>,
) -> (StatusCode, Json<PeerInfoPublic>) {
    let now = chrono::Utc::now().to_rfc3339();
    let peer = state.mesh.upsert_peer(PeerInfo {
        id: req.id,
        base_url: req.base_url,
        enabled: req.enabled,
        capabilities: req.capabilities,
        status: if req.enabled {
            PeerStatus::Unknown
        } else {
            PeerStatus::Disabled
        },
        last_seen: None,
        last_error: None,
        created_at: now.clone(),
        updated_at: now,
        auth_token: req.auth_token,
        inbound_secret: req.inbound_secret,
    });

    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&peer.id).await;
        relay.sync_local_interests_to_peer(&peer.id).await.ok();
    }

    (StatusCode::CREATED, Json(PeerInfoPublic::from(&peer)))
}

async fn update_peer(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
    Json(req): Json<UpdatePeerRequest>,
) -> Result<Json<PeerInfoPublic>, StatusCode> {
    let Some(mut peer) = state.mesh.get_peer(&peer_id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    if let Some(base_url) = req.base_url {
        peer.base_url = base_url;
    }
    if let Some(enabled) = req.enabled {
        peer.enabled = enabled;
        if enabled && matches!(peer.status, PeerStatus::Disabled) {
            peer.status = PeerStatus::Unknown;
        }
        if !enabled {
            peer.status = PeerStatus::Disabled;
        }
    }
    if let Some(capabilities) = req.capabilities {
        peer.capabilities = capabilities;
    }
    if let Some(auth_token) = req.auth_token {
        peer.auth_token = Some(auth_token);
    }

    let peer = state.mesh.upsert_peer(peer);
    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&peer.id).await;
        relay.sync_local_interests_to_peer(&peer.id).await.ok();
    }

    Ok(Json(PeerInfoPublic::from(&peer)))
}

async fn delete_peer(Path(peer_id): Path<String>, State(state): State<AppState>) -> StatusCode {
    if !state.mesh.delete_peer(&peer_id) {
        return StatusCode::NOT_FOUND;
    }

    if let Some(relay) = &state.mesh_relay {
        relay.remove_peer(&peer_id).await;
    }

    StatusCode::NO_CONTENT
}

async fn update_peer_interests(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
    Json(req): Json<UpdateInterestsRequest>,
) -> Json<PeerInterestSnapshot> {
    Json(state.mesh.set_peer_interests(&peer_id, req.topics))
}

async fn ingest_remote_event(
    State(state): State<AppState>,
    Json(req): Json<IngestRemoteEventRequest>,
) -> StatusCode {
    match state
        .mesh
        .ingest_remote_event(&req.from_peer_id, req.event)
        .await
    {
        Ok(true) => StatusCode::ACCEPTED,
        Ok(false) => StatusCode::OK,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

async fn stream_handler(
    State(state): State<AppState>,
    Query(query): Query<MeshStreamQuery>,
    headers: HeaderMap,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.signal_pool.subscribe();
    let peer_id = query.peer_id;
    let heartbeat_secs = query.heartbeat_interval;

    let replay_events = headers
        .get("Last-Event-ID")
        .and_then(|value| value.to_str().ok())
        .map(|last_id| state.signal_pool.window().since(last_id))
        .unwrap_or_else(|| state.signal_pool.window().recent(200));

    let replay = replay_events
        .into_iter()
        .filter(|event| state.mesh.should_stream_event_to_peer(&peer_id, event))
        .filter_map(|event| {
            serde_json::to_string(&event).ok().map(|json| {
                Event::default()
                    .event("signal")
                    .id(event.id.clone())
                    .data(json)
            })
        })
        .collect::<Vec<_>>();

    let replay_stream = stream::iter(replay.into_iter().map(Ok));
    let live_stream = MeshSseStream::new(rx, peer_id, heartbeat_secs, state);

    Sse::new(replay_stream.chain(live_stream))
}

// --- Pairing types ---

#[derive(Debug, Serialize)]
struct PairingInitiateResponse {
    session_id: String,
    pin: String,
}

#[derive(Debug, Deserialize)]
struct PairingRespondRequest {
    session_id: String,
    pin: String,
    responder_host_id: String,
    responder_base_url: String,
    /// Per-peer token generated by the responder; the initiator must present
    /// this token when making requests TO the responder.
    #[serde(default)]
    responder_inbound_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct PairingRespondResponse {
    paired: bool,
    peer_token: String,
    /// Per-peer token generated by the initiator; the responder must present
    /// this token when making requests TO the initiator.
    #[serde(skip_serializing_if = "Option::is_none")]
    initiator_inbound_token: Option<String>,
}

// --- Pairing handlers ---

async fn pairing_initiate(State(state): State<AppState>) -> Json<PairingInitiateResponse> {
    let session = state.pairing.initiate(state.host_id.clone());
    Json(PairingInitiateResponse {
        session_id: session.session_id,
        pin: session.pin,
    })
}

async fn pairing_respond(
    State(state): State<AppState>,
    Json(req): Json<PairingRespondRequest>,
) -> Result<Json<PairingRespondResponse>, StatusCode> {
    let responder_base_url = req.responder_base_url.clone();
    // When session_id is empty, look up by the initiator's host_id (this RT).
    let result = if req.session_id.is_empty() {
        state
            .pairing
            .respond_by_initiator(&state.host_id, &req.pin, &req.responder_host_id)
    } else {
        state
            .pairing
            .respond(&req.session_id, &req.pin, &req.responder_host_id)
    }
    .map_err(|err| match err {
        crate::pairing::PairingError::SessionNotFound => StatusCode::FORBIDDEN,
        crate::pairing::PairingError::IncorrectPin => StatusCode::FORBIDDEN,
    })?;

    // Generate a per-peer inbound token for the responder to use when calling us.
    let initiator_inbound_token = uuid::Uuid::new_v4().to_string();

    // Register the responder as a confirmed peer on this (initiator) side.
    let now = chrono::Utc::now().to_rfc3339();
    state.mesh.upsert_peer(PeerInfo {
        id: req.responder_host_id.clone(),
        base_url: req.responder_base_url,
        enabled: true,
        capabilities: vec![],
        status: PeerStatus::Unknown,
        last_seen: None,
        last_error: None,
        created_at: now.clone(),
        updated_at: now,
        // Outbound: use the responder's inbound_token (if provided) to auth TO them.
        auth_token: req.responder_inbound_token,
        // Inbound: the token the responder must present when calling us.
        inbound_secret: Some(initiator_inbound_token.clone()),
    });

    // If mesh relay is active, reconcile peers.
    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_all_peers().await;
    }

    // If Reticulum mesh is active, trigger a TCP connection to the paired peer.
    if let Some(connect_tx) = &state.ret_mesh_connect_tx {
        if let Some(port_str) = responder_base_url.rsplit(':').next() {
            if let Ok(rt_port) = port_str.parse::<u16>() {
                let peer_host_id = req.responder_host_id.clone();
                let tcp_addr = format!("127.0.0.1:{}", rt_port + 5000);
                let _ = connect_tx.send((peer_host_id, tcp_addr));
            }
        }
    }

    Ok(Json(PairingRespondResponse {
        paired: true,
        peer_token: result.peer_token,
        initiator_inbound_token: Some(initiator_inbound_token),
    }))
}

async fn list_discovered(State(state): State<AppState>) -> Json<Vec<DiscoveredPeer>> {
    let peers = state
        .mdns
        .as_ref()
        .map(|mdns| mdns.discovered_peers())
        .unwrap_or_default();
    Json(peers)
}

/// List peers discovered via Reticulum mesh (EXOMIND_RET_MESH=1).
async fn list_ret_discovered(
    State(state): State<AppState>,
) -> Json<Vec<exomind_net_pairing::DiscoveredPeer>> {
    let peers = match state.ret_mesh_peers.as_ref() {
        Some(peers) => {
            let map = peers.read().await;
            map.values()
                .cloned()
                .map(|peer| ret_peer_with_mesh_authorization_state(&state, peer))
                .collect()
        }
        None => Vec::new(),
    };
    Json(peers)
}

fn ret_peer_mesh_peer_id(peer: &exomind_net_pairing::DiscoveredPeer) -> &str {
    if peer.identity_hex.is_empty() {
        &peer.host_id
    } else {
        &peer.identity_hex
    }
}

async fn find_ret_peer_by_selector(
    state: &AppState,
    peer_selector: &str,
) -> Option<exomind_net_pairing::DiscoveredPeer> {
    let peers = state.ret_mesh_peers.as_ref()?;
    let map = peers.read().await;
    map.get(peer_selector)
        .cloned()
        .or_else(|| {
            map.values()
                .find(|peer| peer.host_id == peer_selector)
                .cloned()
        })
        .or_else(|| {
            map.values()
                .find(|peer| peer.identity_hex == peer_selector)
                .cloned()
        })
}

fn ret_peer_with_mesh_authorization_state(
    state: &AppState,
    mut peer: exomind_net_pairing::DiscoveredPeer,
) -> exomind_net_pairing::DiscoveredPeer {
    let authorized = state
        .mesh
        .get_peer(ret_peer_mesh_peer_id(&peer))
        .map(|mesh_peer| mesh_peer.enabled && mesh_peer.inbound_secret.is_some())
        .unwrap_or(false);

    match peer.trust_state {
        exomind_net_pairing::discovery::TrustState::Blocked
        | exomind_net_pairing::discovery::TrustState::Trusted => {}
        exomind_net_pairing::discovery::TrustState::Paired if !authorized => {
            peer.trust_state = exomind_net_pairing::discovery::TrustState::Discovered;
        }
        _ if authorized => {
            peer.trust_state = exomind_net_pairing::discovery::TrustState::Paired;
        }
        _ => {}
    }

    peer
}

#[derive(Debug, Serialize)]
struct RetPairResponse {
    paired: bool,
    peer: exomind_net_pairing::DiscoveredPeer,
    mesh_peer: PeerInfoPublic,
}

/// Pair with a peer discovered via Reticulum mesh.
///
/// This is the UI-facing control-plane hook for the Reticulum path: it registers
/// the peer as an enabled MeshState peer with a persisted inbound token and asks
/// the background mesh task to open a TCP transport connection. A raw Reticulum
/// connection alone is only discovery/reachability; Paired means this local RT
/// now has an authorization record for the peer.
async fn pair_ret_peer(
    Path(peer_selector): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<RetPairResponse>, StatusCode> {
    if state.ret_mesh_peers.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    let connect_tx = state
        .ret_mesh_connect_tx
        .clone()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    let peer = find_ret_peer_by_selector(&state, &peer_selector)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let peer_id = ret_peer_mesh_peer_id(&peer).to_string();
    if peer_id.is_empty() {
        return Err(StatusCode::CONFLICT);
    }

    let tcp_addr = format!("127.0.0.1:{}", peer.port + 5000);
    connect_tx
        .send((peer.host_id.clone(), tcp_addr))
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    let now = chrono::Utc::now().to_rfc3339();
    let legacy_peer = (peer_id != peer.host_id)
        .then(|| state.mesh.get_peer(&peer.host_id))
        .flatten();
    let existing_peer = state.mesh.get_peer(&peer_id).or(legacy_peer);
    if peer_id != peer.host_id {
        state.mesh.delete_peer(&peer.host_id);
    }
    let inbound_secret = existing_peer
        .as_ref()
        .and_then(|peer| peer.inbound_secret.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mesh_peer = state.mesh.upsert_peer(PeerInfo {
        id: peer_id.clone(),
        base_url: format!("http://127.0.0.1:{}", peer.port),
        enabled: true,
        capabilities: existing_peer
            .as_ref()
            .map(|peer| peer.capabilities.clone())
            .unwrap_or_default(),
        status: existing_peer
            .as_ref()
            .map(|peer| peer.status.clone())
            .unwrap_or(PeerStatus::Unknown),
        last_seen: existing_peer
            .as_ref()
            .and_then(|peer| peer.last_seen.clone()),
        last_error: None,
        created_at: existing_peer
            .as_ref()
            .map(|peer| peer.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
        auth_token: existing_peer
            .as_ref()
            .and_then(|peer| peer.auth_token.clone()),
        inbound_secret: Some(inbound_secret),
    });

    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&mesh_peer.id).await;
        relay.sync_local_interests_to_peer(&mesh_peer.id).await.ok();
    }

    let peer = ret_peer_with_mesh_authorization_state(&state, peer);

    tracing::info!(
        "Reticulum peer {} authorized as identity {} from UI pairing request",
        peer.host_id,
        mesh_peer.id
    );

    Ok(Json(RetPairResponse {
        paired: true,
        peer,
        mesh_peer: PeerInfoPublic::from(&mesh_peer),
    }))
}

#[derive(Debug, Serialize)]
struct RetUnpairResponse {
    paired: bool,
    peer: Option<exomind_net_pairing::DiscoveredPeer>,
    mesh_peer: PeerInfoPublic,
}

/// Revoke local authorization for a Reticulum peer without removing discovery.
async fn unpair_ret_peer(
    Path(peer_selector): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<RetUnpairResponse>, StatusCode> {
    let discovered_peer = find_ret_peer_by_selector(&state, &peer_selector).await;
    let peer_id = discovered_peer
        .as_ref()
        .map(|peer| ret_peer_mesh_peer_id(peer).to_string())
        .filter(|peer_id| !peer_id.is_empty())
        .unwrap_or_else(|| peer_selector.clone());

    let mesh_peer = state
        .mesh
        .revoke_peer_authorization(&peer_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&mesh_peer.id).await;
    }

    let peer = discovered_peer.map(|peer| ret_peer_with_mesh_authorization_state(&state, peer));

    tracing::info!(
        "Reticulum peer authorization revoked for identity {} from UI unpair request",
        mesh_peer.id
    );

    Ok(Json(RetUnpairResponse {
        paired: false,
        peer,
        mesh_peer: PeerInfoPublic::from(&mesh_peer),
    }))
}

#[derive(Deserialize)]
struct AnnounceToggleRequest {
    enabled: bool,
}

/// Toggle whether Reticulum sends periodic Announces.
async fn toggle_ret_announce(
    State(state): State<AppState>,
    Json(req): Json<AnnounceToggleRequest>,
) -> Json<serde_json::Value> {
    state
        .ret_mesh_announce_enabled
        .store(req.enabled, std::sync::atomic::Ordering::Relaxed);
    tracing::info!("Reticulum announce toggled: {}", req.enabled);
    Json(serde_json::json!({"announce_enabled": req.enabled}))
}

/// Protected mesh routes (behind auth middleware).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mesh/peers", get(list_peers).post(create_peer))
        .route("/mesh/peers/:peer_id", put(update_peer).delete(delete_peer))
        .route("/mesh/interests/:peer_id", put(update_peer_interests))
        .route("/mesh/events", post(ingest_remote_event))
        .route("/mesh/stream", get(stream_handler))
        .route("/mesh/discovered", get(list_discovered))
        .route("/mesh/ret/discovered", get(list_ret_discovered))
        .route("/mesh/ret/peers/:peer_id/pair", post(pair_ret_peer).delete(unpair_ret_peer))
        .route("/mesh/ret/announce", post(toggle_ret_announce))
        // Initiate is protected: only the local admin can create pairing sessions.
        // This prevents remote attackers from calling initiate + respond to self-pair.
        .route("/mesh/pairing/initiate", post(pairing_initiate))
}

/// Public mesh routes (no auth required).
/// Only `respond` is public — the remote device calls this before it has any token.
/// The PIN provides single-use, time-limited, out-of-band authentication.
pub fn public_router() -> Router<AppState> {
    Router::new().route("/mesh/pairing/respond", post(pairing_respond))
}

struct MeshSseStream {
    rx: broadcast::Receiver<crate::signal::SignalEvent>,
    peer_id: String,
    heartbeat: Interval,
    state: AppState,
}

impl MeshSseStream {
    fn new(
        rx: broadcast::Receiver<crate::signal::SignalEvent>,
        peer_id: String,
        heartbeat_secs: u64,
        state: AppState,
    ) -> Self {
        Self {
            rx,
            peer_id,
            heartbeat: tokio::time::interval(Duration::from_secs(heartbeat_secs)),
            state,
        }
    }
}

impl Stream for MeshSseStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();

        match this.rx.try_recv() {
            Ok(event) => {
                if this
                    .state
                    .mesh
                    .should_stream_event_to_peer(&this.peer_id, &event)
                    && let Ok(json) = serde_json::to_string(&event)
                {
                    return Poll::Ready(Some(Ok(Event::default()
                        .event("signal")
                        .id(event.id)
                        .data(json))));
                }
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            Err(broadcast::error::TryRecvError::Empty) => {}
            Err(broadcast::error::TryRecvError::Lagged(missed)) => {
                let payload = format!("{{\"warning\":\"lagged\",\"missed\":{missed}}}");
                return Poll::Ready(Some(Ok(Event::default().event("warning").data(payload))));
            }
            Err(broadcast::error::TryRecvError::Closed) => {
                return Poll::Ready(None);
            }
        }

        if this.heartbeat.poll_tick(cx).is_ready() {
            let ts = chrono::Utc::now().timestamp_millis();
            return Poll::Ready(Some(Ok(Event::default()
                .event("heartbeat")
                .data(format!("{{\"ts\":{ts}}}")))));
        }

        let mut recv_fut = Box::pin(this.rx.recv());

        match Pin::new(&mut recv_fut).poll(cx) {
            Poll::Ready(Ok(event)) => {
                if this
                    .state
                    .mesh
                    .should_stream_event_to_peer(&this.peer_id, &event)
                    && let Ok(json) = serde_json::to_string(&event)
                {
                    return Poll::Ready(Some(Ok(Event::default()
                        .event("signal")
                        .id(event.id)
                        .data(json))));
                }
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            Poll::Ready(Err(broadcast::error::RecvError::Lagged(missed))) => {
                let payload = format!("{{\"warning\":\"lagged\",\"missed\":{missed}}}");
                Poll::Ready(Some(Ok(Event::default().event("warning").data(payload))))
            }
            Poll::Ready(Err(broadcast::error::RecvError::Closed)) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}
