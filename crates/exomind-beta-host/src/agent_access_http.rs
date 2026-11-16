use crate::{
    AgentAccess, AgentAccessCheck, BetaHost, HostError,
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

async fn check(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<AgentAccessCheck>, JsonRejection>,
) -> Result<Json<AgentAccess>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(request) = body.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.check_agent_access(&host.authenticate(&token)?, profile, &request)
        })
        .await?,
    ))
}

pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new().route("/beta/v1/profiles/:profile/access/check", post(check))
}
