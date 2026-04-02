use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use std::net::{IpAddr, SocketAddr};

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
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if is_loopback_request(&request) && has_trusted_loopback_origin(&request) {
        return Ok(next.run(request).await);
    }

    if state.allow_lan_without_auth && is_local_or_private_network_request(&request) {
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
