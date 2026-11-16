use crate::{
    BetaHost, HostError,
    http::{bearer, work},
};
use axum::{
    Json, Router,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::HeaderMap,
    routing::post,
};
use exomind_core::{ExternalSummaryAppendCommand, ProfileId, Receipt};
use std::sync::Arc;

async fn append(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<ExternalSummaryAppendCommand>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(command) = body.map_err(|_| HostError::InvalidRequest)?;
    if command.profile_id != profile {
        return Err(HostError::Forbidden);
    }
    Ok(Json(
        work(host, move |host| {
            host.append_external_summary(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}

pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new().route(
        "/beta/v1/profiles/:profile/external-summaries",
        post(append),
    )
}
