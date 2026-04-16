use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use std::net::{IpAddr, SocketAddr};

use crate::AppState;

/// Request identity injected for peer-auth data-plane calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedPeerIdentity {
    pub peer_id: String,
}

/// Peer-compatible mesh paths: peer token is allowed, admin token may also access.
const PEER_COMPATIBLE_PATHS: &[&str] = &["/mesh/events", "/mesh/stream", "/mesh/discovered"];

/// Peer-only mesh paths: only peer token is allowed.
const PEER_ONLY_PATHS: &[&str] = &[
    "/mesh/eventlog/snapshot/sqlite",
    "/mesh/tasks/summary",
    "/mesh/tasks/pull",
    "/mesh/tasks/snapshot/sqlite",
    "/mesh/timeblocks/snapshot/sqlite",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeerPathAccess {
    Denied,
    Compatible,
    PeerOnly,
}

/// Constant-time byte comparison to prevent timing attacks.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn peer_path_access(path: &str) -> PeerPathAccess {
    if PEER_ONLY_PATHS.contains(&path) {
        return PeerPathAccess::PeerOnly;
    }
    if PEER_COMPATIBLE_PATHS.contains(&path) || path.starts_with("/mesh/interests/") {
        return PeerPathAccess::Compatible;
    }

    PeerPathAccess::Denied
}

fn is_loopback_request(request: &Request) -> bool {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip().is_loopback())
        .unwrap_or(false)
}

fn is_local_or_private_network_ip(ip: IpAddr) -> bool {
    if ip.is_loopback() {
        return true;
    }

    match ip {
        IpAddr::V4(ipv4) => ipv4.is_private() || ipv4.is_link_local(),
        IpAddr::V6(ipv6) => ipv6.is_unique_local() || ipv6.is_unicast_link_local(),
    }
}

fn is_local_or_private_network_request(request: &Request) -> bool {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| is_local_or_private_network_ip(addr.ip()))
        .unwrap_or(false)
}

fn parse_origin_scheme_and_host(origin: &str) -> Option<(&str, &str)> {
    let origin = origin.trim();
    let (scheme, remainder) = origin.split_once("://")?;
    let authority = remainder
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();

    if scheme.is_empty() || authority.is_empty() || authority.contains('@') {
        return None;
    }

    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = &rest[..end];
        let trailing = &rest[end + 1..];
        if !trailing.is_empty()
            && !(trailing.starts_with(':')
                && trailing[1..].chars().all(|char| char.is_ascii_digit())
                && !trailing[1..].is_empty())
        {
            return None;
        }
        return Some((scheme, host));
    }

    let (host, trailing) = authority.split_once(':').unwrap_or((authority, ""));
    if host.is_empty()
        || trailing.contains(':')
        || (!trailing.is_empty() && !trailing.chars().all(|char| char.is_ascii_digit()))
    {
        return None;
    }

    Some((scheme, host))
}

pub(crate) fn is_trusted_loopback_origin_value(origin: &str) -> bool {
    let Some((scheme, host)) = parse_origin_scheme_and_host(origin) else {
        return false;
    };

    if !matches!(
        scheme.to_ascii_lowercase().as_str(),
        "http" | "https" | "tauri"
    ) {
        return false;
    }

    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "tauri.localhost"
    )
}

fn has_trusted_loopback_origin(request: &Request) -> bool {
    request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(is_trusted_loopback_origin_value)
        .unwrap_or(false)
}

/// Bearer token auth middleware (Bearer Token 鉴权中间件).
///
/// If `AppState.auth_secret` is `None`, all requests are allowed (local dev mode).
/// If set, the middleware checks `Authorization: Bearer <token>` header or `?token=<token>` query param.
///
/// Accepts:
/// 1. The global `auth_secret` (full admin access to all protected routes).
/// 2. Any enabled peer's `inbound_secret` (data-plane mesh routes only).
///
/// Returns 401 if no valid token, 403 if peer token hits a non-mesh route.
pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path().to_string();
    let peer_path_access = peer_path_access(&path);

    if peer_path_access != PeerPathAccess::PeerOnly
        && is_loopback_request(&request)
        && has_trusted_loopback_origin(&request)
    {
        return Ok(next.run(request).await);
    }

    if peer_path_access != PeerPathAccess::PeerOnly
        && state.allow_lan_without_auth
        && is_local_or_private_network_request(&request)
    {
        return Ok(next.run(request).await);
    }

    let Some(expected_secret) = &state.auth_secret else {
        // No secret configured: allow all requests (local dev mode).
        return Ok(next.run(request).await);
    };

    // Try Authorization header first.
    let token_from_header = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| token.to_string());

    // Fall back to ?token= query param (URL-decoded).
    let token_from_query = request
        .uri()
        .query()
        .and_then(|query| {
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix("token="))
        })
        .map(|token| {
            percent_encoding::percent_decode_str(token)
                .decode_utf8_lossy()
                .into_owned()
        });

    let provided_token = token_from_header.or(token_from_query);

    match provided_token {
        // 1. Global admin secret — full access to all protected routes.
        Some(ref token) if constant_time_eq(token.as_bytes(), expected_secret.as_bytes()) => {
            if peer_path_access == PeerPathAccess::PeerOnly {
                Err(StatusCode::FORBIDDEN)
            } else {
                Ok(next.run(request).await)
            }
        }
        // 2. Per-peer inbound secret — data-plane mesh routes only.
        //    Peers can relay events and stream signals, but cannot manage peers
        //    or initiate pairing (those are admin/control-plane operations).
        Some(ref token) => {
            match state.mesh.peer_id_by_inbound_secret(token) {
                Ok(Some(peer_id)) => {
                    if peer_path_access == PeerPathAccess::Denied {
                        return Err(StatusCode::FORBIDDEN);
                    }
                    request
                        .extensions_mut()
                        .insert(AuthenticatedPeerIdentity { peer_id });
                    Ok(next.run(request).await)
                }
                Ok(None) | Err(_) => Err(StatusCode::UNAUTHORIZED),
            }
        }
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::extract::Extension;
    use axum::routing::get;
    use axum::{Json, Router};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::util::ServiceExt;

    use crate::mesh::{PeerInfo, PeerStatus};

    fn test_state() -> AppState {
        let mut state = AppState::new(0);
        state.auth_secret = Some("admin-secret".to_string());
        state.mesh.upsert_peer(PeerInfo {
            id: "peer-phone".to_string(),
            base_url: "http://peer-phone.local:1949".to_string(),
            enabled: true,
            capabilities: vec![],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: "2026-04-13T00:00:00Z".to_string(),
            updated_at: "2026-04-13T00:00:00Z".to_string(),
            auth_token: None,
            inbound_secret: Some("peer-secret".to_string()),
        });
        state
    }

    fn auth_test_router(state: AppState) -> Router {
        Router::new()
            .route(
                "/mesh/eventlog/snapshot/sqlite",
                get(
                    |Extension(identity): Extension<AuthenticatedPeerIdentity>| async move {
                        Json(serde_json::json!({ "peer_id": identity.peer_id }))
                    },
                ),
            )
            .route(
                "/mesh/tasks/summary",
                get(
                    |Extension(identity): Extension<AuthenticatedPeerIdentity>| async move {
                        Json(serde_json::json!({ "peer_id": identity.peer_id }))
                    },
                ),
            )
            .route(
                "/mesh/tasks/pull",
                get(
                    |Extension(identity): Extension<AuthenticatedPeerIdentity>| async move {
                        Json(serde_json::json!({ "peer_id": identity.peer_id }))
                    },
                ),
            )
            .route(
                "/mesh/timeblocks/snapshot/sqlite",
                get(
                    |Extension(identity): Extension<AuthenticatedPeerIdentity>| async move {
                        Json(serde_json::json!({ "peer_id": identity.peer_id }))
                    },
                ),
            )
            .route(
                "/mesh/tasks/grants/reconcile",
                get(|| async { StatusCode::NO_CONTENT }),
            )
            .route("/mesh/peers", get(|| async { StatusCode::NO_CONTENT }))
            .route_layer(axum::middleware::from_fn_with_state(
                state.clone(),
                require_auth,
            ))
            .with_state(state)
    }

    #[tokio::test]
    async fn peer_token_injects_peer_identity_on_peer_only_route() {
        let response = auth_test_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/mesh/tasks/summary")
                    .header("authorization", "Bearer peer-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["peer_id"], serde_json::json!("peer-phone"));
    }

    #[tokio::test]
    async fn admin_token_is_forbidden_on_peer_only_route() {
        let response = auth_test_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/mesh/tasks/summary")
                    .header("authorization", "Bearer admin-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn peer_token_cannot_access_control_plane_routes() {
        let response = auth_test_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/mesh/peers")
                    .header("authorization", "Bearer peer-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn peer_token_injects_peer_identity_on_task_pull_route() {
        let response = auth_test_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/mesh/tasks/pull")
                    .header("authorization", "Bearer peer-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["peer_id"], serde_json::json!("peer-phone"));
    }

    #[tokio::test]
    async fn peer_token_injects_peer_identity_on_eventlog_and_timeblock_snapshot_routes() {
        for path in [
            "/mesh/eventlog/snapshot/sqlite",
            "/mesh/timeblocks/snapshot/sqlite",
        ] {
            let response = auth_test_router(test_state())
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header("authorization", "Bearer peer-secret")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK, "path={path}");
            let body = response.into_body().collect().await.unwrap().to_bytes();
            let payload: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(payload["peer_id"], serde_json::json!("peer-phone"));
        }
    }

    #[tokio::test]
    async fn admin_token_is_forbidden_on_eventlog_and_timeblock_snapshot_routes() {
        for path in [
            "/mesh/eventlog/snapshot/sqlite",
            "/mesh/timeblocks/snapshot/sqlite",
        ] {
            let response = auth_test_router(test_state())
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header("authorization", "Bearer admin-secret")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::FORBIDDEN, "path={path}");
        }
    }

    #[tokio::test]
    async fn duplicate_inbound_secret_is_rejected_for_peer_only_route() {
        let state = test_state();
        state.mesh.upsert_peer(PeerInfo {
            id: "peer-tablet".to_string(),
            base_url: "http://peer-tablet.local:1949".to_string(),
            enabled: true,
            capabilities: vec![],
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: "2026-04-13T00:00:00Z".to_string(),
            updated_at: "2026-04-13T00:00:00Z".to_string(),
            auth_token: None,
            inbound_secret: Some("peer-secret".to_string()),
        });

        let response = auth_test_router(state)
            .oneshot(
                Request::builder()
                    .uri("/mesh/tasks/summary")
                    .header("authorization", "Bearer peer-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn peer_token_cannot_access_task_scope_grant_route() {
        let response = auth_test_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/mesh/tasks/grants/reconcile")
                    .header("authorization", "Bearer peer-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
