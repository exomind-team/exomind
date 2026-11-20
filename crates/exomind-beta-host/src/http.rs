use crate::{BetaHost, GrantRequest, HostError, HostStatus};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, Request, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use exomind_core::{
    CaptureCommand, CommandId, CoreError, CorrectionEntry, CorrectionPage, EventId, EventPage,
    EventQuery, MAX_EVENT_TAG_BYTES, ProfileId, ProfileInfo, Receipt, RecordCorrectionCommand,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use uuid::Uuid;

const MAX_BODY_BYTES: usize = 1024 * 1024;
const SHUTDOWN_SECONDS: u64 = 5;

#[derive(Clone)]
struct Boundary {
    authorities: Vec<String>,
    origins: Vec<String>,
}

#[derive(Serialize)]
struct Failure {
    error: FailureDetail,
}
#[derive(Serialize)]
struct FailureDetail {
    code: &'static str,
    message: &'static str,
}

impl IntoResponse for HostError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Core(CoreError::InvalidExternalSummary(_)) => (
                StatusCode::BAD_REQUEST,
                "invalid_external_summary",
                "External summary sources, evidence or narrative are invalid",
            ),
            Self::PeerNetworkDisabled => (
                StatusCode::CONFLICT,
                "peer_network_disabled",
                "Device synchronization is paused; enable it before retrieving peer originals",
            ),
            Self::Core(CoreError::InvalidSummary(_)) => (
                StatusCode::BAD_REQUEST,
                "invalid_summary_request",
                "Summary request is invalid",
            ),
            Self::Core(CoreError::UnknownSummaryTask) => (
                StatusCode::NOT_FOUND,
                "summary_not_found",
                "Summary task or result was not found",
            ),
            Self::Core(CoreError::SummaryConflict) => (
                StatusCode::CONFLICT,
                "summary_conflict",
                "Summary ownership or control changed; refresh before continuing",
            ),
            Self::Core(CoreError::SummaryControlDenied | CoreError::SummaryNotOwner) => (
                StatusCode::FORBIDDEN,
                "summary_forbidden",
                "Summary control or execution is not permitted",
            ),
            Self::Core(CoreError::SummaryBlocked(_)) => (
                StatusCode::CONFLICT,
                "summary_blocked",
                "Summary sources or control need attention before execution",
            ),
            Self::Core(CoreError::SummaryExecutorStopped | CoreError::StaleSummaryTicket) => (
                StatusCode::CONFLICT,
                "summary_stale",
                "Summary execution is no longer current",
            ),
            Self::ModelConfigurationInvalid => (
                StatusCode::BAD_REQUEST,
                "model_configuration_invalid",
                "Check the summary model address, model and credential fields",
            ),
            Self::ModelConfigurationConflict => (
                StatusCode::CONFLICT,
                "model_configuration_conflict",
                "Summary model settings changed; reload before saving",
            ),
            Self::ModelConfigurationRecoveryRequired => (
                StatusCode::CONFLICT,
                "model_configuration_recovery_required",
                "Summary model settings require recovery; recording remains available",
            ),
            Self::ModelConfigurationUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "model_configuration_unavailable",
                "Summary model settings could not be read or saved",
            ),
            Self::ClockUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "clock_unavailable",
                "Host clock sample is unavailable; no clock-dependent operation was applied",
            ),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication required",
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Capability does not permit this operation",
            ),
            Self::Core(CoreError::TimeblockControlDenied) => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Timeblock control requires human authority",
            ),
            Self::Core(CoreError::CorrectionRequiresHuman) => (
                StatusCode::FORBIDDEN,
                "correction_requires_human",
                "A correction requires a human profile writer",
            ),
            Self::Core(CoreError::CorrectionTargetConflict) => (
                StatusCode::CONFLICT,
                "correction_target_conflict",
                "The target capture does not match this profile, event ID or digest",
            ),
            Self::Core(CoreError::TimeblockConflict) => (
                StatusCode::CONFLICT,
                "timeblock_conflict",
                "Timeblock revision or state changed",
            ),
            Self::Core(CoreError::InvalidTimeblockHistory) => (
                StatusCode::CONFLICT,
                "timeblock_history_incomplete",
                "Timeblock causal history is incomplete or inconsistent",
            ),
            Self::Stopped => (
                StatusCode::SERVICE_UNAVAILABLE,
                "stopped",
                "Host is stopped",
            ),
            Self::Core(CoreError::RecoveryRequired) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "recovery_required",
                "Existing storage requires explicit recovery or completion of initialization",
            ),
            Self::UntrustedOrigin => (
                StatusCode::FORBIDDEN,
                "untrusted_origin",
                "Request host or origin rejected",
            ),
            Self::Core(CoreError::TimelinePeriodBudgetExceeded) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "timeline_period_budget_exceeded",
                "Requested period exceeds the bounded read budget; narrow the time window",
            ),
            Self::InvalidRequest
            | Self::Core(
                CoreError::InvalidCapture(_)
                | CoreError::InvalidCorrection(_)
                | CoreError::InvalidQuery(_)
                | CoreError::InvalidOriginal(_)
                | CoreError::InvalidOriginalOffset
                | CoreError::InvalidReplication(_)
                | CoreError::InvalidTimeblock(_),
            ) => (
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Invalid request",
            ),
            Self::PayloadTooLarge | Self::Core(CoreError::FactTooLarge { .. }) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "Request body exceeds the permitted size",
            ),
            Self::AgentWaitBusy => (
                StatusCode::TOO_MANY_REQUESTS,
                "agent_wait_busy",
                "Agent wait capacity is full; retry after an active wait ends",
            ),
            Self::AgentBundleSerialization => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "agent_bundle_failed",
                "Agent bundle could not be serialized within its requested budget",
            ),
            Self::VerificationBusy => (
                StatusCode::TOO_MANY_REQUESTS,
                "verification_busy",
                "Original verification slots are busy",
            ),
            Self::NotFound
            | Self::Core(
                CoreError::UnknownProfile | CoreError::UnknownStage | CoreError::UnknownOriginal,
            ) => (StatusCode::NOT_FOUND, "not_found", "Resource not found"),
            Self::Core(
                CoreError::CommandConflict
                | CoreError::EventConflict
                | CoreError::ProfileConflict
                | CoreError::StageConflict
                | CoreError::OriginalConflict
                | CoreError::ChunkConflict,
            ) => (
                StatusCode::CONFLICT,
                "conflict",
                "Identifier is already bound to different content",
            ),
            Self::Core(CoreError::StageNotUploading) => (
                StatusCode::CONFLICT,
                "stage_not_uploading",
                "Stage no longer accepts bytes",
            ),
            Self::Core(CoreError::StageIncomplete) => (
                StatusCode::CONFLICT,
                "stage_incomplete",
                "Original upload is incomplete",
            ),
            Self::Core(CoreError::OriginalNotReady) => (
                StatusCode::CONFLICT,
                "original_not_ready",
                "Original is not verified",
            ),
            Self::Core(CoreError::OriginalHashMismatch) => (
                StatusCode::CONFLICT,
                "original_hash_mismatch",
                "Original bytes do not match the declared digest",
            ),
            Self::Core(CoreError::OriginalIntegrityMismatch) => (
                StatusCode::CONFLICT,
                "original_integrity_mismatch",
                "Stored original bytes failed integrity verification",
            ),
            Self::Core(CoreError::VerificationCancelled) => (
                StatusCode::CONFLICT,
                "verification_cancelled",
                "Original verification was cancelled",
            ),
            Self::Core(CoreError::StaleVerification) => (
                StatusCode::CONFLICT,
                "stale_verification",
                "Original verification is no longer current",
            ),
            Self::Core(
                CoreError::ScopeMismatch
                | CoreError::ForeignContext
                | CoreError::OriginalAccessDenied,
            ) => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Capability does not permit this operation",
            ),
            // Do not serialize source errors: SQLite and filesystem diagnostics
            // can contain paths, submitted values or credential material.
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "host_error",
                "Host operation failed",
            ),
        };
        (
            status,
            Json(Failure {
                error: FailureDetail { code, message },
            }),
        )
            .into_response()
    }
}

async fn boundary(State(boundary): State<Boundary>, request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    if !host.is_some_and(|host| boundary.authorities.iter().any(|allowed| allowed == host)) {
        return HostError::UntrustedOrigin.into_response();
    }
    let origin = match request.headers().get(header::ORIGIN) {
        Some(value) => match value.to_str().ok().and_then(|value| {
            boundary
                .origins
                .iter()
                .find(|allowed| allowed.as_str() == value)
        }) {
            Some(value) => Some(value.clone()),
            None => return HostError::UntrustedOrigin.into_response(),
        },
        None => None,
    };
    let preflight = request.method() == Method::OPTIONS
        && origin.is_some()
        && request
            .headers()
            .contains_key(header::ACCESS_CONTROL_REQUEST_METHOD);
    let mut response = if preflight {
        let method = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_METHOD)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let headers_allowed = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
            .map(|value| {
                value.to_str().ok().is_some_and(|value| {
                    value.split(',').all(|header| {
                        matches!(
                            header.trim().to_ascii_lowercase().as_str(),
                            "authorization" | "content-type"
                        )
                    })
                })
            })
            .unwrap_or(true);
        if !matches!(method, "GET" | "HEAD" | "POST" | "PUT" | "DELETE") || !headers_allowed {
            return HostError::UntrustedOrigin.into_response();
        }
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    // Status identity, private stage metadata and authenticated fact data must
    // not be replayed from a browser/proxy cache across grant or host changes.
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(origin) = origin {
        // The value comes from validated configuration, never arbitrary reflection.
        let Ok(origin) = HeaderValue::from_str(&origin) else {
            return HostError::UntrustedOrigin.into_response();
        };
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Origin"));
        if preflight {
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, HEAD, POST, PUT, DELETE"),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("authorization, content-type"),
            );
        }
    }
    response
}

pub(crate) fn bearer(headers: &HeaderMap) -> Result<String, HostError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(HostError::Unauthorized)?;
    let raw = value
        .strip_prefix("Bearer ")
        .filter(|value| !value.is_empty())
        .ok_or(HostError::Unauthorized)?;
    Ok(raw.to_owned())
}

pub(crate) async fn work<T: Send + 'static>(
    host: Arc<BetaHost>,
    action: impl FnOnce(&BetaHost) -> Result<T, HostError> + Send + 'static,
) -> Result<T, HostError> {
    tokio::task::spawn_blocking(move || action(&host))
        .await
        .map_err(|_| HostError::StatePoisoned)?
}

async fn hello(State(host): State<Arc<BetaHost>>) -> Result<Json<HostStatus>, HostError> {
    Ok(Json(work(host, BetaHost::status).await?))
}

async fn profiles(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ProfileInfo>>, HostError> {
    let token = bearer(&headers)?;
    Ok(Json(
        work(host, move |host| host.profiles(&host.authenticate(&token)?)).await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileName {
    name: String,
}

async fn provision(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    profile: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<ProfileName>, JsonRejection>,
) -> Result<Json<ProfileInfo>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = profile.map_err(|_| HostError::InvalidRequest)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.provision_profile(&host.authenticate(&token)?, profile, &body.name)
        })
        .await?,
    ))
}

async fn grant(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    body: Result<Json<GrantRequest>, JsonRejection>,
) -> Result<Json<crate::IssuedGrant>, HostError> {
    let token = bearer(&headers)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.grant(&host.authenticate(&token)?, body)
        })
        .await?,
    ))
}

async fn revoke(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    id: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, HostError> {
    let token = bearer(&headers)?;
    let Path(id) = id.map_err(|_| HostError::InvalidRequest)?;
    work(host, move |host| {
        host.revoke_grant(&host.authenticate(&token)?, id)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn capture(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    body: Result<Json<CaptureCommand>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Json(command) = body.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.capture(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QueryParameters {
    before: Option<u64>,
    through: Option<u64>,
    limit: Option<usize>,
    q: Option<String>,
    tag: Option<String>,
}

async fn events(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    profile: Result<Path<ProfileId>, PathRejection>,
    query: Result<Query<QueryParameters>, QueryRejection>,
) -> Result<Json<EventPage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = profile.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    if let Some(tag) = query.tag.as_deref()
        && (tag.trim().is_empty() || tag.len() > MAX_EVENT_TAG_BYTES)
    {
        return Err(HostError::InvalidRequest);
    }
    let tag = query.tag;
    let query = EventQuery {
        before: query.before,
        through: query.through,
        limit: query.limit.unwrap_or(100),
        search: query.q,
    };
    Ok(Json(
        work(host, move |host| {
            host.events_page_with_tag(&host.authenticate(&token)?, profile, &query, tag.as_deref())
        })
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorrectionBody {
    command_id: CommandId,
    event_id: exomind_core::EventId,
    occurred_at_ms: i64,
    target_event_id: exomind_core::EventId,
    target_digest: String,
    corrected_text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorrectionQuery {
    before: Option<u64>,
    through: Option<u64>,
    limit: Option<usize>,
    q: Option<String>,
    target_event_id: Option<exomind_core::EventId>,
}

async fn correct(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    profile: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<CorrectionBody>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = profile.map_err(|_| HostError::InvalidRequest)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    let command = RecordCorrectionCommand {
        command_id: body.command_id,
        event_id: body.event_id,
        profile_id: profile,
        occurred_at_ms: body.occurred_at_ms,
        target_event_id: body.target_event_id,
        target_digest: body.target_digest,
        corrected_text: body.corrected_text,
    };
    Ok(Json(
        work(host, move |host| {
            host.record_correction(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}

async fn corrections(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    profile: Result<Path<ProfileId>, PathRejection>,
    query: Result<Query<CorrectionQuery>, QueryRejection>,
) -> Result<Json<CorrectionPage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = profile.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    let target_event_id = query.target_event_id;
    let query = EventQuery {
        before: query.before,
        through: query.through,
        limit: query.limit.unwrap_or(100),
        search: query.q,
    };
    Ok(Json(
        work(host, move |host| {
            let session = host.authenticate(&token)?;
            match target_event_id {
                Some(target) => host.corrections_page_for_target(&session, profile, &query, target),
                None => host.corrections_page(&session, profile, &query),
            }
        })
        .await?,
    ))
}

async fn correction_event(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, EventId)>, PathRejection>,
) -> Result<Json<Option<CorrectionEntry>>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, event_id)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.correction_event(&host.authenticate(&token)?, profile, event_id)
        })
        .await?,
    ))
}

async fn receipt(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, CommandId)>, PathRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, command)) = path.map_err(|_| HostError::InvalidRequest)?;
    let receipt = work(host, move |host| {
        host.receipt(&host.authenticate(&token)?, profile, command)
    })
    .await?;
    Ok(Json(receipt.ok_or(HostError::NotFound)?))
}

fn router(host: Arc<BetaHost>, address: SocketAddr, frontend_origins: Vec<String>) -> Router {
    let authorities = vec![address.to_string(), format!("localhost:{}", address.port())];
    let mut origins: Vec<String> = authorities
        .iter()
        .map(|authority| format!("http://{authority}"))
        .collect();
    origins.extend(frontend_origins);
    Router::new()
        .route("/beta/v1/hello", get(hello))
        .route("/beta/v1/profiles", get(profiles))
        .route("/beta/v1/profiles/:profile", put(provision))
        .route("/beta/v1/grants", post(grant))
        .route("/beta/v1/grants/:id", delete(revoke))
        .route("/beta/v1/capture", post(capture))
        .route("/beta/v1/profiles/:profile/events", get(events))
        .route(
            "/beta/v1/profiles/:profile/corrections",
            get(corrections).post(correct),
        )
        .route(
            "/beta/v1/profiles/:profile/corrections/:event",
            get(correction_event),
        )
        .route("/beta/v1/profiles/:profile/receipts/:command", get(receipt))
        .merge(crate::agent_access_http::router())
        .merge(crate::agent_wait_http::router())
        .merge(crate::agent_export_http::router())
        .merge(crate::external_summaries_http::router())
        .merge(crate::originals_http::router())
        .merge(crate::timeblocks_http::router())
        .merge(crate::model_config_http::router())
        .merge(crate::summary_jobs_http::router())
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(
            Boundary {
                authorities,
                origins,
            },
            boundary,
        ))
        .with_state(host)
}

pub struct RunningServer {
    host: Arc<BetaHost>,
    address: SocketAddr,
    task: Option<JoinHandle<Result<(), std::io::Error>>>,
}

impl RunningServer {
    pub fn addr(&self) -> SocketAddr {
        self.address
    }

    pub async fn stop(mut self) -> Result<(), HostError> {
        let host = self.host.clone();
        work(host, BetaHost::stop).await?;
        if let Some(mut task) = self.task.take() {
            match tokio::time::timeout(Duration::from_secs(SHUTDOWN_SECONDS), &mut task).await {
                Ok(Ok(Ok(()))) => Ok(()),
                Ok(_) => Err(HostError::Shutdown),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    Err(HostError::Shutdown)
                }
            }
        } else {
            Ok(())
        }
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        // Synchronous facade stop holds no async lock and denies any queued
        // spawn_blocking work even if the embedding caller drops the listener.
        let _ = self.host.stop();
    }
}

pub async fn serve(host: Arc<BetaHost>, address: SocketAddr) -> Result<RunningServer, HostError> {
    serve_with_frontend_origins(host, address, Vec::new()).await
}

fn validate_frontend_origin(origin: &str) -> Result<(), HostError> {
    let authority = origin
        .strip_prefix("http://")
        .ok_or(HostError::UntrustedOrigin)?;
    if authority.is_empty()
        || authority.chars().any(|character| {
            character.is_whitespace()
                || matches!(character, '/' | '\\' | '@' | '?' | '#' | '%' | '*')
        })
    {
        return Err(HostError::UntrustedOrigin);
    }
    let loopback = if authority == "localhost" {
        true
    } else if let Some(port) = authority.strip_prefix("localhost:") {
        port.parse::<u16>().is_ok_and(|port| port != 0)
    } else if let Ok(socket) = authority.parse::<SocketAddr>() {
        socket.ip().is_loopback() && socket.port() != 0
    } else if let Ok(ip) = authority.parse::<std::net::Ipv4Addr>() {
        ip.is_loopback()
    } else {
        authority
            .strip_prefix('[')
            .and_then(|authority| authority.strip_suffix(']'))
            .and_then(|ip| ip.parse::<std::net::Ipv6Addr>().ok())
            .is_some_and(|ip| ip.is_loopback())
    };
    if !loopback || HeaderValue::from_str(origin).is_err() {
        return Err(HostError::UntrustedOrigin);
    }
    Ok(())
}

pub async fn serve_with_frontend_origins(
    host: Arc<BetaHost>,
    address: SocketAddr,
    frontend_origins: Vec<String>,
) -> Result<RunningServer, HostError> {
    if !address.ip().is_loopback() {
        return Err(HostError::UntrustedBind);
    }
    for origin in &frontend_origins {
        validate_frontend_origin(origin)?;
    }
    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let (shutdown, receive) = oneshot::channel();
    let bound_host = host.clone();
    work(bound_host, move |host| {
        host.publish_endpoint(address, shutdown)
    })
    .await?;
    let app = router(host.clone(), address, frontend_origins);
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = receive.await;
            })
            .await
    });
    Ok(RunningServer {
        host,
        address,
        task: Some(task),
    })
}
