use crate::{
    BetaHost, HostError,
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
    CommandId, EventId, EventQuery, IntervalPage, IntervalQuery, ProfileId, Receipt,
    TimeblockAction, TimeblockCommand, TimeblockNodePage, TimeblockRevision, TimeblockSnapshot,
    TimelinePage,
};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandBody {
    command_id: CommandId,
    event_id: EventId,
    expected_revision: TimeblockRevision,
    action: TimeblockAction,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadQuery {
    before: Option<u64>,
    through: Option<u64>,
    limit: Option<usize>,
    q: Option<String>,
}
impl ReadQuery {
    fn query(self) -> EventQuery {
        EventQuery {
            before: self.before,
            through: self.through,
            limit: self.limit.unwrap_or(100),
            search: self.q,
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Intervals {
    from_ms: i64,
    to_ms: i64,
    through: Option<TimeblockRevision>,
    limit: Option<usize>,
}
type ProfilePath = Result<Path<ProfileId>, PathRejection>;
async fn command(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    body: Result<Json<CommandBody>, JsonRejection>,
) -> Result<Json<Receipt>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(body) = body.map_err(|_| HostError::InvalidRequest)?;
    let command = TimeblockCommand {
        command_id: body.command_id,
        event_id: body.event_id,
        profile_id: profile,
        expected_revision: body.expected_revision,
        action: body.action,
    };
    Ok(Json(
        work(host, move |host| {
            host.apply_timeblock(&host.authenticate(&token)?, &command)
        })
        .await?,
    ))
}
async fn current(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
) -> Result<Json<TimeblockSnapshot>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeblock_snapshot(&host.authenticate(&token)?, profile)
        })
        .await?,
    ))
}
async fn nodes(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<ReadQuery>, QueryRejection>,
) -> Result<Json<TimeblockNodePage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeblock_nodes(&host.authenticate(&token)?, profile, &query.query())
        })
        .await?,
    ))
}
async fn timeline(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<ReadQuery>, QueryRejection>,
) -> Result<Json<TimelinePage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    Ok(Json(
        work(host, move |host| {
            host.timeline_page(&host.authenticate(&token)?, profile, &query.query())
        })
        .await?,
    ))
}
async fn intervals(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: ProfilePath,
    query: Result<Query<Intervals>, QueryRejection>,
) -> Result<Json<IntervalPage>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Query(query) = query.map_err(|_| HostError::InvalidRequest)?;
    let query = IntervalQuery {
        from_ms: query.from_ms,
        to_ms: query.to_ms,
        through: query.through,
        limit: query.limit.unwrap_or(100),
    };
    Ok(Json(
        work(host, move |host| {
            host.timeblock_intervals(&host.authenticate(&token)?, profile, &query)
        })
        .await?,
    ))
}
pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new()
        .route(
            "/beta/v1/profiles/:profile/timeblocks/current",
            get(current),
        )
        .route(
            "/beta/v1/profiles/:profile/timeblocks/commands",
            post(command),
        )
        .route("/beta/v1/profiles/:profile/timeblocks/nodes", get(nodes))
        .route(
            "/beta/v1/profiles/:profile/timeblocks/intervals",
            get(intervals),
        )
        .route("/beta/v1/profiles/:profile/timeline", get(timeline))
}
