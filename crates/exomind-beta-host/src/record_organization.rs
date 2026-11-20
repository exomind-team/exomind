use crate::{BetaHost, GrantKind, HostError, Session, context, resources};
use exomind_core::{
    CorrectionPage, EventId, EventPage, EventQuery, ProfileId, Receipt, RecordCorrectionCommand,
};

impl BetaHost {
    pub fn events_page_with_tag(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
        tag: Option<&str>,
    ) -> Result<EventPage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let context = context(&resources.core, &authority)?;
        Ok(resources
            .core
            .events_page_with_tag(&context, profile, query, tag)?)
    }

    pub fn record_correction(
        &self,
        session: &Session,
        command: &RecordCorrectionCommand,
    ) -> Result<Receipt, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, command.profile_id, true)?;
        if authority.kind != GrantKind::Human {
            return Err(HostError::Forbidden);
        }
        let context = context(&resources.core, &authority)?;
        Ok(resources.core.record_correction(&context, command)?)
    }

    pub fn corrections_page(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<CorrectionPage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let context = context(&resources.core, &authority)?;
        Ok(resources.core.corrections_page(&context, profile, query)?)
    }

    pub fn corrections_page_for_target(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
        target_event_id: EventId,
    ) -> Result<CorrectionPage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let context = context(&resources.core, &authority)?;
        Ok(resources.core.corrections_page_for_target(&context, profile, query, target_event_id)?)
    }
}
