//! Private local execution fence. It is not a peer capability or wire DTO.
//! The managed predicate captures Shared/Weak jobs and cancellation watches,
//! never a strong PeerNetwork/Host/Core reference.
use super::{OriginalTransferResult, PeerCancellation, original_auto_store};
use crate::{BetaHost, HostError, Resources, Session};
use exomind_core::{OriginalAvailability, OriginalId, OriginalRef, ProfileId};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Copy)]
pub(super) enum OriginalFetchMode {
    Manual,
    Automatic { policy_revision: Uuid },
}
type ManagedCheck = Box<dyn Fn() -> Result<bool, HostError> + Send + Sync>;
pub(super) struct OriginalAdmission {
    runtime_id: Uuid,
    profile_id: ProfileId,
    original: OriginalRef,
    intent_revision: Option<Uuid>,
    mode: OriginalFetchMode,
    cancelled: PeerCancellation,
    managed: Option<ManagedCheck>,
}
impl OriginalAdmission {
    pub(super) fn managed(
        runtime_id: Uuid,
        profile_id: ProfileId,
        original: OriginalRef,
        intent_revision: Option<Uuid>,
        mode: OriginalFetchMode,
        cancelled: PeerCancellation,
        check: impl Fn() -> Result<bool, HostError> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime_id,
            profile_id,
            original,
            intent_revision,
            mode,
            cancelled,
            managed: Some(Box::new(check)),
        })
    }
    /// Low-level Owner transport calls remain explicit one-off manual work.
    /// They have no controller generation, but still bind the durable intent
    /// and their own session cancellation so a release can revoke old work.
    pub(super) fn direct(
        host: &BetaHost,
        owner: &Session,
        p: ProfileId,
        id: OriginalId,
        cancelled: PeerCancellation,
    ) -> Result<Arc<Self>, HostError> {
        let state = host.active_state()?;
        host.owner(owner)?;
        let r = crate::resources(&state)?;
        let original = match r
            .core
            .original_availability(&r.core.local_human(p)?, p, id)?
        {
            OriginalAvailability::Missing { original } => original,
            OriginalAvailability::Local { stage } => stage.original,
        };
        let intent = original_auto_store::intent(&r.persistence.auth, p, id)?;
        Ok(Arc::new(Self {
            runtime_id: host.runtime_id,
            profile_id: p,
            original,
            intent_revision: intent.intent_revision,
            mode: OriginalFetchMode::Manual,
            cancelled,
            managed: None,
        }))
    }
    pub(super) fn original(&self) -> &OriginalRef {
        &self.original
    }
    pub(super) fn validate(
        &self,
        host: &BetaHost,
        r: &Resources,
        p: ProfileId,
        id: OriginalId,
        session_cancel: Option<&PeerCancellation>,
    ) -> Result<(), HostError> {
        if self.runtime_id != host.runtime_id {
            return Err(HostError::Unauthorized);
        }
        if self.profile_id != p || self.original.original_id != id {
            return Err(HostError::PeerMembershipDenied);
        }
        if self.cancelled.is_cancelled()
            || session_cancel.is_some_and(PeerCancellation::is_cancelled)
        {
            return Err(HostError::PeerCancelled);
        }
        if let Some(check) = &self.managed {
            if !check()? {
                return Err(HostError::PeerCancelled);
            }
        }
        let intent = original_auto_store::intent(&r.persistence.auth, p, id)?;
        if intent.intent_revision != self.intent_revision {
            return Err(HostError::PeerCancelled);
        }
        if self.managed.is_some() && !super::network_store::settings(&r.persistence.auth)?.enabled {
            return Err(HostError::PeerNetworkDisabled);
        }
        if let OriginalFetchMode::Automatic { policy_revision } = self.mode {
            if !original_auto_store::eligible(
                &r.persistence.auth,
                p,
                id,
                self.original.byte_length,
                policy_revision,
                self.intent_revision,
            )? {
                return Err(HostError::PeerCancelled);
            }
        }
        Ok(())
    }
    pub(super) fn validate_result(
        &self,
        host: &BetaHost,
        r: &Resources,
        result: &Result<OriginalTransferResult, HostError>,
        session_cancel: Option<&PeerCancellation>,
    ) -> Result<(), HostError> {
        self.validate(
            host,
            r,
            self.profile_id,
            self.original.original_id,
            session_cancel,
        )?;
        if let Ok(value) = result {
            if value.verified {
                let actual = r.core.original_availability(
                    &r.core.local_human(self.profile_id)?,
                    self.profile_id,
                    self.original.original_id,
                )?;
                let ready = matches!(actual,OriginalAvailability::Local{stage}
                    if stage.state==exomind_core::StageState::Verified
                        &&stage.next_offset==stage.original.byte_length
                        &&stage.original==value.original&&value.original==self.original);
                if !ready {
                    return Err(HostError::Core(exomind_core::CoreError::OriginalNotReady));
                }
            }
        }
        Ok(())
    }
}
