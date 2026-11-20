use crate::{
    BetaHost, HostError, SummaryMaterialConsent, SummaryServiceStatus,
    http::{bearer, work},
};
use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::HeaderMap,
    routing::{get, post},
};
use exomind_core::{
    EventId, ProfileId, Receipt, SummaryArtifactPage, SummaryControlCommand, SummaryRequestCommand,
    SummarySelection, SummaryTaskPage, SummaryTaskView, TimeblockId,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskQuery {
    after: Option<Uuid>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactQuery {
    before: Option<u64>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MaterialRequest {
    command: SummaryRequestCommand,
    consent: SummaryMaterialConsent,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MaterialControl {
    command: SummaryControlCommand,
    consent: SummaryMaterialConsent,
}
async fn tasks(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    query: Result<Query<TaskQuery>, QueryRejection>,
) -> Result<Json<SummaryTaskPage>, HostError> {
    let token = bearer(&headers)?;
    let Path(p) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(q) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_tasks_page(
                &host.authenticate(&token)?,
                p,
                q.after,
                q.limit.unwrap_or(25),
            )
        })
        .await?,
    ))
}
async fn task(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, Uuid)>, PathRejection>,
) -> Result<Json<SummaryTaskView>, HostError> {
    let token = bearer(&headers)?;
    let Path((p, id)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_task(&host.authenticate(&token)?, p, id)
        })
        .await?,
    ))
}
async fn artifacts(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, Uuid)>, PathRejection>,
    query: Result<Query<ArtifactQuery>, QueryRejection>,
) -> Result<Json<SummaryArtifactPage>, HostError> {
    let token = bearer(&headers)?;
    let Path((p, id)) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(q) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_artifacts_page(
                &host.authenticate(&token)?,
                p,
                id,
                q.before,
                q.limit.unwrap_or(25),
            )
        })
        .await?,
    ))
}
async fn request(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<SummaryRequestCommand>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(p) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(command) = body.map_err(|_| HostError::InvalidRequest)?;
    if command.profile_id != p {
        return Err(HostError::Forbidden);
    }
    Ok(Json(
        work(host, move |host| {
            host.request_summary(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}
async fn control(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<SummaryControlCommand>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(p) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(command) = body.map_err(|_| HostError::InvalidRequest)?;
    if command.profile_id != p {
        return Err(HostError::Forbidden);
    }
    Ok(Json(
        work(host, move |host| {
            host.control_summary(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}
async fn selection(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, TimeblockId)>, PathRejection>,
) -> Result<Json<SummarySelection>, HostError> {
    let token = bearer(&headers)?;
    let Path((p, block)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_block_selection(&host.authenticate(&token)?, p, block)
        })
        .await?,
    ))
}
async fn material_request(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<MaterialRequest>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(input) = body.map_err(|_| HostError::InvalidRequest)?;
    if input.command.profile_id != profile {
        return Err(HostError::Forbidden);
    }
    Ok(Json(
        work(host, move |host| {
            host.request_summary_with_material_consent(
                &host.authenticate(&token)?,
                &input.command,
                &input.consent,
            )
        })
        .await?,
    ))
}
async fn material_control(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<MaterialControl>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(input) = body.map_err(|_| HostError::InvalidRequest)?;
    if input.command.profile_id != profile {
        return Err(HostError::Forbidden);
    }
    Ok(Json(
        work(host, move |host| {
            host.control_summary_with_material_consent(
                &host.authenticate(&token)?,
                &input.command,
                &input.consent,
            )
        })
        .await?,
    ))
}
async fn status(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
) -> Result<Json<SummaryServiceStatus>, HostError> {
    let token = bearer(&headers)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_service_status(&host.authenticate(&token)?)
        })
        .await?,
    ))
}
pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new()
        .route(
            "/beta/v1/profiles/:profile/timeline/events/:event",
            get(source),
        )
        .route("/beta/v1/profiles/:profile/summaries/tasks", get(tasks))
        .route(
            "/beta/v1/profiles/:profile/summaries/tasks/:task",
            get(task),
        )
        .route(
            "/beta/v1/profiles/:profile/summaries/tasks/:task/artifacts",
            get(artifacts),
        )
        .route(
            "/beta/v1/profiles/:profile/summaries/requests",
            post(request),
        )
        .route(
            "/beta/v1/profiles/:profile/summaries/controls",
            post(control),
        )
        .route(
            "/beta/v1/profiles/:profile/summaries/material-requests",
            post(material_request),
        )
        .route(
            "/beta/v1/profiles/:profile/summaries/material-controls",
            post(material_control),
        )
        .route(
            "/beta/v1/profiles/:profile/timeblocks/:block/summary-selection",
            get(selection),
        )
        .route("/beta/v1/summary-service", get(status))
}

async fn source(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<(ProfileId, EventId)>, PathRejection>,
) -> Result<Json<Option<exomind_core::TimelineItem>>, HostError> {
    let token = bearer(&headers)?;
    let Path((profile, event)) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeline_event(&host.authenticate(&token)?, profile, event)
        })
        .await?,
    ))
}
