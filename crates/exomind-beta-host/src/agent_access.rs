//! Read-only discovery of the current grant, never an authorization ticket.
use crate::{BetaHost, GrantKind, HostError, PROTOCOL, Session, resources};
use exomind_core::{AgentId, DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCapability {
    EventsRead,
    TimelineRead,
    ReceiptsRead,
    OriginalsRead,
    TimeblocksRead,
    SummariesRead,
    CaptureAppendHuman,
    CaptureAppendAgentNote,
    OriginalsStage,
    TimeblocksControl,
    SummariesControl,
    Wait,
    ExportBundle,
    ExternalSummaryAppend,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentAccessCheck {
    pub required: Vec<AgentCapability>,
}

#[derive(Debug, Serialize)]
pub struct AgentAccess {
    pub protocol: &'static str,
    pub runtime_id: Uuid,
    pub device_id: DeviceId,
    pub profile_id: ProfileId,
    pub grant_kind: GrantKind,
    pub agent_id: Option<AgentId>,
    pub allowed: Vec<AgentCapability>,
    pub unsupported: Vec<AgentCapability>,
    pub max_page_items: usize,
    pub max_original_chunk_bytes: usize,
}

impl BetaHost {
    /// All later operations still recheck lifecycle, scope and revocation.
    /// No profile list, token, model configuration or source body is returned.
    pub fn check_agent_access(
        &self,
        session: &Session,
        profile: ProfileId,
        request: &AgentAccessCheck,
    ) -> Result<AgentAccess, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        if request.required.len() > 32
            || request
                .required
                .iter()
                .enumerate()
                .any(|(index, capability)| request.required[..index].contains(capability))
        {
            return Err(HostError::InvalidRequest);
        }
        use AgentCapability::*;
        let mut allowed = vec![
            EventsRead,
            TimelineRead,
            ReceiptsRead,
            OriginalsRead,
            TimeblocksRead,
            SummariesRead,
        ];
        match authority.kind {
            GrantKind::Observer => {}
            GrantKind::Human => allowed.extend([
                CaptureAppendHuman,
                OriginalsStage,
                TimeblocksControl,
                SummariesControl,
            ]),
            GrantKind::AgentNote => allowed.extend([CaptureAppendAgentNote, OriginalsStage]),
        }
        if request
            .required
            .iter()
            .any(|capability| !allowed.contains(capability))
        {
            return Err(HostError::Forbidden);
        }
        Ok(AgentAccess {
            protocol: PROTOCOL,
            runtime_id: self.runtime_id,
            device_id: self.device_id,
            profile_id: profile,
            grant_kind: authority.kind,
            agent_id: authority.agent_id,
            allowed,
            unsupported: vec![Wait, ExportBundle, ExternalSummaryAppend],
            max_page_items: 100,
            max_original_chunk_bytes: exomind_core::MAX_ORIGINAL_CHUNK_BYTES,
        })
    }
}
