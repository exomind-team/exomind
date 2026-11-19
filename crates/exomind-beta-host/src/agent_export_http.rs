use crate::{
    BetaHost, HostError,
    agent_export::AgentExportRequest,
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
use exomind_core::ProfileId;
use std::sync::Arc;

async fn export_bundle(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<AgentExportRequest>, JsonRejection>,
) -> Result<Json<crate::agent_export::AgentExportBundle>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(request) = body.map_err(|_| HostError::InvalidRequest)?;
    let session = work(host.clone(), move |host| host.authenticate(&token)).await?;
    Ok(Json(
        work(host, move |host| {
            host.agent_export_bundle(&session, profile, &request)
        })
        .await?,
    ))
}

pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new().route(
        "/beta/v1/profiles/:profile/export-bundle",
        post(export_bundle),
    )
}
