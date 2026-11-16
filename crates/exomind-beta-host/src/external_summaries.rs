//! External producers have a dedicated append capability. Ordinary capture,
//! staging, timer and model-job writes continue to deny this grant kind.
use crate::{BetaHost, GrantKind, HostError, Session, resources};
use exomind_core::{ExternalSummaryAppendCommand, Receipt};

impl BetaHost {
    pub fn append_external_summary(
        &self,
        session: &Session,
        command: &ExternalSummaryAppendCommand,
    ) -> Result<Receipt, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, command.profile_id, false)?;
        if authority.kind != GrantKind::SummaryProducer {
            return Err(HostError::Forbidden);
        }
        let producer = resources.core.local_external_summary_producer(
            authority.profile_id,
            authority
                .agent_id
                .ok_or(HostError::CredentialsUnavailable)?,
        )?;
        // Qualification and the Core transaction share this final Host gate;
        // revocation/stop cannot interleave between them.
        Ok(resources.core.append_external_summary(&producer, command)?)
    }
}
