use crate::{
    BetaHost, HostError, SummaryModelConfiguration, SummaryModelConfigurationCommand,
    http::{bearer, work},
};
use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::HeaderMap,
    routing::get,
};
use exomind_core::ProfileId;
use std::sync::Arc;

async fn read(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
) -> Result<Json<SummaryModelConfiguration>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.summary_model_configuration(&host.authenticate(&token)?, profile)
        })
        .await?,
    ))
}
async fn save(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<SummaryModelConfigurationCommand>, JsonRejection>,
) -> Result<Json<SummaryModelConfiguration>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(command) = body.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.configure_summary_model(&host.authenticate(&token)?, profile, &command)
        })
        .await?,
    ))
}
pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new()
        .route(
            "/beta/v1/profiles/:profile/summary-model",
            get(read).post(save),
        )
        .layer(DefaultBodyLimit::max(32768))
}
