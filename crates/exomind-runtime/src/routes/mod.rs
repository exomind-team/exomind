use axum::{Router, routing::get};

use crate::AppState;

pub mod agents;
pub mod energy;
pub mod eventlog;
pub mod mesh;
pub mod signals;
pub mod tasks;
pub mod topology;

/// Build protected route tree for runtime APIs（构建 runtime API 路由树）.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/topology", get(topology::get_topology))
        .merge(agents::router())
        .merge(energy::router())
        .merge(eventlog::router())
        .merge(mesh::router())
        .merge(signals::router())
        .merge(tasks::router())
}

/// Build public route tree (no auth required).
pub fn public_router() -> Router<AppState> {
    Router::new().merge(mesh::public_router())
}
