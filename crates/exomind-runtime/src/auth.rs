use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

use crate::AppState;

/// Bearer token auth middleware (Bearer Token 鉴权中间件).
///
/// If `AppState.auth_secret` is `None`, all requests are allowed (local dev mode).
/// If set, the middleware checks `Authorization: Bearer <token>` header or `?token=<token>` query param.
///
/// Accepts:
/// 1. The global `auth_secret` (full admin access).
/// 2. Any registered peer's `inbound_secret` (scoped mesh access).
///
/// Returns 401 if the token does not match either.
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

    match provided_token {
        // 1. Global admin secret.
        Some(ref token) if token == expected_secret => Ok(next.run(request).await),
        // 2. Per-peer inbound secret.
        Some(ref token) if state.mesh.has_peer_with_inbound_secret(token) => {
            Ok(next.run(request).await)
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
