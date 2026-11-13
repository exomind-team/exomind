use crate::{
    BetaHost, HostError,
    http::{bearer, work},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        rejection::{BytesRejection, JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use exomind_core::{
    BeginStageCommand, MAX_ORIGINAL_CHUNK_BYTES, OriginalChunk, OriginalId, ProfileId, StageId,
    StageStatus,
};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BeginMetadata {
    original_id: OriginalId,
    expected_sha256: String,
    byte_length: u64,
    file_name: String,
    media_type: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Offset {
    offset: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ByteRange {
    offset: u64,
    length: usize,
}

type StagePath = Result<Path<(ProfileId, StageId)>, PathRejection>;

async fn begin(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: StagePath,
    body: Result<Json<BeginMetadata>, JsonRejection>,
) -> Result<Json<StageStatus>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, stage)) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    let command = BeginStageCommand {
        stage_id: stage,
        profile_id: profile,
        original_id: body.original_id,
        expected_sha256: body.expected_sha256,
        byte_length: body.byte_length,
        file_name: body.file_name,
        media_type: body.media_type,
    };
    Ok(Json(
        work(host, move |host| {
            host.begin_stage(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}

async fn status(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: StagePath,
) -> Result<Json<StageStatus>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, stage)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.stage_status(&host.authenticate(&token)?, profile, stage)
        })
        .await?,
    ))
}

async fn chunk(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: StagePath,
    query: Result<Query<Offset>, QueryRejection>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<StageStatus>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, stage)) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/octet-stream")
    {
        return Err(HostError::InvalidRequest);
    }
    let bytes = body.map_err(|error| {
        if error.status() == axum::http::StatusCode::PAYLOAD_TOO_LARGE {
            HostError::PayloadTooLarge
        } else {
            HostError::InvalidRequest
        }
    })?;
    Ok(Json(
        work(host, move |host| {
            host.write_stage_chunk(
                &host.authenticate(&token)?,
                profile,
                stage,
                query.offset,
                &bytes,
            )
        })
        .await?,
    ))
}

async fn verify(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: StagePath,
) -> Result<Json<StageStatus>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, stage)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.verify_stage(&host.authenticate(&token)?, profile, stage)
        })
        .await?,
    ))
}

fn binary(chunk: OriginalChunk) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        chunk.bytes,
    )
        .into_response()
}

async fn stage_bytes(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: StagePath,
    query: Result<Query<ByteRange>, QueryRejection>,
) -> Result<Response, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, stage)) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(binary(
        work(host, move |host| {
            host.read_stage_range(
                &host.authenticate(&token)?,
                profile,
                stage,
                query.offset,
                query.length,
            )
        })
        .await?,
    ))
}

async fn original_bytes(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, OriginalId)>, PathRejection>,
    query: Result<Query<ByteRange>, QueryRejection>,
) -> Result<Response, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, original)) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(binary(
        work(host, move |host| {
            host.read_original_range(
                &host.authenticate(&token)?,
                profile,
                original,
                query.offset,
                query.length,
            )
        })
        .await?,
    ))
}

pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new()
        .route(
            "/beta/v1/profiles/:profile/stages/:stage",
            put(begin).get(status),
        )
        .route(
            "/beta/v1/profiles/:profile/stages/:stage/chunks",
            put(chunk).layer(DefaultBodyLimit::max(MAX_ORIGINAL_CHUNK_BYTES)),
        )
        .route(
            "/beta/v1/profiles/:profile/stages/:stage/verify",
            post(verify),
        )
        .route(
            "/beta/v1/profiles/:profile/stages/:stage/bytes",
            get(stage_bytes),
        )
        .route(
            "/beta/v1/profiles/:profile/originals/:original/bytes",
            get(original_bytes),
        )
}
