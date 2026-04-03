use axum::{Router, routing::get};

use crate::AppState;

pub mod agent_sessions;
pub mod agents;
pub mod config;
pub mod energy;
pub mod eventlog;
pub mod mesh;
pub mod profiles;
pub mod proposals;
#[cfg(not(target_os = "android"))]
pub mod pty;
pub mod reminders;
pub mod sessions;
pub mod signals;
pub mod tasks;
pub mod timeblocks;
pub mod today_planner;
pub mod topology;
pub mod workspace;

/// Build protected route tree for runtime APIs（构建 runtime API 路由树）.
pub fn router() -> Router<AppState> {
    let r = Router::new()
        .route("/topology", get(topology::get_topology))
        .merge(agents::router())
        .merge(agent_sessions::router())
        .merge(config::router())
        .merge(energy::router())
        .merge(eventlog::router())
        .merge(mesh::router())
        .merge(profiles::router())
        .merge(proposals::router())
        .merge(reminders::router())
        .merge(sessions::router())
        .merge(signals::router())
        .merge(tasks::router())
        .merge(today_planner::router())
        .merge(timeblocks::router())
        .merge(workspace::router());
    #[cfg(not(target_os = "android"))]
    let r = r.merge(pty::router());
    r
}

/// Build public route tree (no auth required).
pub fn public_router() -> Router<AppState> {
    Router::new().merge(mesh::public_router())
}
