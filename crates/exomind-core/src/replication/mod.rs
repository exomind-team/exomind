//! Data-plane origin positions. Membership/revocation truth stays in Host.
mod facts;
mod ingest;
mod origin;
mod schema;
mod transfer;
use crate::{Core, CoreError, DeviceId, ProfileId};
pub use facts::ReplicatedFact;
pub(crate) use origin::{provision_local_origin, record_local_fact};
pub(crate) use schema::{migrate, validate_objects, validate_schema};
pub(crate) use schema::{migrate_summary_facts, validate_summary_schema};
use serde::{Deserialize, Serialize};
pub use transfer::{ImportAck, OriginEntry, OriginPage, OriginPageQuery};
use uuid::Uuid;
pub const MAX_ORIGIN_PAGE_BYTES: usize = crate::MAX_FACT_BYTES + 64 * 1024;
pub const DEFAULT_ORIGIN_PAGE_BYTES: usize = 192 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginIdentity {
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub restoration_epoch: Uuid,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginCursor {
    pub seq: u64,
    pub hash: String,
}

/// An in-process, direct-origin capability, never a request DTO. This carries
/// the Host's admission generation; Core deliberately owns no member table.
/// Host must revalidate that generation while holding its final gate across
/// the bounded Core transaction. Reopening Core invalidates all old contexts.
///
/// ```compile_fail
/// let _: exomind_core::ReplicaContext = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone)]
pub struct ReplicaContext {
    pub(crate) lifecycle: Uuid,
    pub(crate) profile_id: ProfileId,
    pub(crate) authenticated_origin: DeviceId,
    pub(crate) restoration_epoch: Uuid,
    member_generation: u64,
}
impl ReplicaContext {
    pub fn profile_id(&self) -> ProfileId {
        self.profile_id
    }
    pub fn authenticated_origin(&self) -> DeviceId {
        self.authenticated_origin
    }
    pub fn restoration_epoch(&self) -> Uuid {
        self.restoration_epoch
    }
    pub fn member_generation(&self) -> u64 {
        self.member_generation
    }
}
impl Core {
    /// Trusted Host management boundary, like local_human; never expose this
    /// factory as an unauthenticated HTTP operation. It accepts a direct peer,
    /// not a relay claiming a third party's origin or permission from a hash.
    pub fn trusted_replica_context(
        &self,
        profile_id: ProfileId,
        authenticated_origin: DeviceId,
        restoration_epoch: Uuid,
        member_generation: u64,
    ) -> Result<ReplicaContext, CoreError> {
        if restoration_epoch.is_nil()
            || member_generation == 0
            || authenticated_origin == self.device_id()
        {
            return Err(CoreError::InvalidReplication(
                "invalid direct-origin admission",
            ));
        }
        self.local_human(profile_id)?;
        Ok(ReplicaContext {
            lifecycle: self.lifecycle(),
            profile_id,
            authenticated_origin,
            restoration_epoch,
            member_generation,
        })
    }
    pub(crate) fn check_replica_context(&self, context: &ReplicaContext) -> Result<(), CoreError> {
        if context.lifecycle != self.lifecycle() {
            return Err(CoreError::ForeignContext);
        }
        if context.authenticated_origin == self.device_id()
            || context.restoration_epoch.is_nil()
            || context.member_generation == 0
        {
            return Err(CoreError::InvalidReplication(
                "invalid direct-origin admission",
            ));
        }
        Ok(())
    }
}
