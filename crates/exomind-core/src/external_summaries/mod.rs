//! External Agent attestations, separate from internal model jobs/current
//! qualification. A producer context is minted only by a trusted embedding.
mod facts;
mod model;
mod schema;
mod store;
pub use model::*;
pub(crate) use schema::{migrate as migrate_schema, validate as validate_schema};
pub(crate) use store::validate_available_sources;
#[cfg(test)]
mod tests;
