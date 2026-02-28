use axum::{routing::get, Router};

use crate::RuntimeState;

pub mod topology;

/// Build route tree for runtime APIs（构建 runtime API 路由树）.
pub fn router() -> Router<RuntimeState> {
    Router::new().route("/topology", get(topology::get_topology))
}
