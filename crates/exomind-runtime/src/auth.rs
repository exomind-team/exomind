use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

use crate::AppState;

/// Data-plane mesh paths that peer tokens are allowed to access.
/// Control-plane paths (/mesh/peers*, /mesh/pairing/initiate) require admin secret.
const PEER_ALLOWED_PREFIXES: &[&str] = &[
    "/mesh/events",
    "/mesh/stream",
    "/mesh/interests/",
    "/mesh/discovered",
];

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

fn is_peer_allowed_path(path: &str) -> bool {
    PEER_ALLOWED_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
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
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
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

    // Check the request path before consuming the request.
    let path = request.uri().path().to_string();

    match provided_token {
        // 1. Global admin secret — full access to all protected routes.
        Some(ref token) if constant_time_eq(token.as_bytes(), expected_secret.as_bytes()) => {
            Ok(next.run(request).await)
        }
        // 2. Per-peer inbound secret — data-plane mesh routes only.
        //    Peers can relay events and stream signals, but cannot manage peers
        //    or initiate pairing (those are admin/control-plane operations).
        Some(ref token) if state.mesh.has_peer_with_inbound_secret(token) => {
            if is_peer_allowed_path(&path) {
                Ok(next.run(request).await)
            } else {
                Err(StatusCode::FORBIDDEN)
            }
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
