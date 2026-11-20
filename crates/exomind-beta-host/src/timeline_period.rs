use crate::{BetaHost, HostError, Session, context, resources};
use exomind_core::{ProfileId, TimelinePage, TimelinePeriodQuery};

impl BetaHost {
    /// Reads the same typed timeline facts through a bounded explicit time window.
    /// Timeblock rows retain both occurred_at_ms and effective_at_ms; range
    /// membership follows the latter. This facade deliberately does not request
    /// the separately paged timeblock interval projection.
    pub fn timeline_period_page(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &TimelinePeriodQuery,
    ) -> Result<TimelinePage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources.core.timeline_period_page(
            &context(&resources.core, &authority)?,
            profile,
            query,
        )?)
    }
}
