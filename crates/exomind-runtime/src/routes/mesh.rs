use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::stream::{self, Stream};
use futures_util::StreamExt;
use serde::Deserialize;
use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::sync::broadcast;
use tokio::time::{Duration, Interval};

use crate::AppState;
use crate::discovery::DiscoveredPeer;
use crate::mesh::{PeerInfo, PeerInterestSnapshot, PeerStatus};

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

async fn list_peers(State(state): State<AppState>) -> Json<Vec<PeerInfo>> {
    Json(state.mesh.list_peers())
}

async fn create_peer(
    State(state): State<AppState>,
    Json(req): Json<CreatePeerRequest>,
) -> (StatusCode, Json<PeerInfo>) {
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
    });

    if let Some(relay) = &state.mesh_relay {
        relay.reconcile_peer(&peer.id).await;
        relay.sync_local_interests_to_peer(&peer.id).await.ok();
    }

    (StatusCode::CREATED, Json(peer))
}

async fn update_peer(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
    Json(req): Json<UpdatePeerRequest>,
) -> Result<Json<PeerInfo>, StatusCode> {
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

    Ok(Json(peer))
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

async fn list_discovered(State(state): State<AppState>) -> Json<Vec<DiscoveredPeer>> {
    let peers = state
        .mdns
        .as_ref()
        .map(|mdns| mdns.discovered_peers())
        .unwrap_or_default();
    Json(peers)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mesh/peers", get(list_peers).post(create_peer))
        .route("/mesh/peers/:peer_id", put(update_peer).delete(delete_peer))
        .route("/mesh/interests/:peer_id", put(update_peer_interests))
        .route("/mesh/events", post(ingest_remote_event))
        .route("/mesh/stream", get(stream_handler))
        .route("/mesh/discovered", get(list_discovered))
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
                if this.state.mesh.should_stream_event_to_peer(&this.peer_id, &event)
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
                if this.state.mesh.should_stream_event_to_peer(&this.peer_id, &event)
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
