use axum::{Router, routing::get};

use crate::AppState;

pub mod agents;
pub mod signals;
pub mod topology;

/// Build route tree for runtime APIs（构建 runtime API 路由树）.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/topology", get(topology::get_topology))
        .merge(agents::router())
        .merge(signals::router())
}
