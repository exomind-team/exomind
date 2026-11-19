//! Owner-only management metadata and idempotent issuance for external Agents.
//!
//! This module deliberately exposes no auth-table token hashes, owner material,
//! profile names, or profile contents. The existing schema stores only a
//! revoked bit, so the DTO does not invent issuance or revocation timestamps.

use crate::{BetaHost, GrantKind, GrantRequest, HostError, Session};
use exomind_core::{AgentId, ProfileId};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use uuid::Uuid;

type RawGrantMetadata = (String, String, String, Option<String>, i64);

/// A raw grant credential that can move into Native memory but cannot be
/// serialized or accidentally printed through `Debug`.
pub struct GrantCredential(Vec<u8>);

impl GrantCredential {
    /// Borrows token bytes for trusted in-memory authentication or clipboard
    /// handoff. The wrapper remains non-serializable and zeroes its bytes on
    /// drop.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl std::fmt::Debug for GrantCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("GrantCredential([REDACTED])")
    }
}

impl Drop for GrantCredential {
    fn drop(&mut self) {
        self.0.fill(0);
        std::hint::black_box(&self.0);
    }
}

/// Safe management metadata for one grant in one explicit profile scope.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GrantMetadata {
    pub grant_id: Uuid,
    pub profile_id: ProfileId,
    pub kind: GrantKind,
    pub agent_id: Option<AgentId>,
    pub revoked: bool,
}

/// The one-time result of a newly created management grant.
#[derive(Debug)]
pub struct ManagedGrantIssue {
    pub metadata: GrantMetadata,
    pub credential: GrantCredential,
}

impl BetaHost {
    /// Lists external Agent grant metadata for one existing local profile.
    ///
    /// The owner session is required. The query is constrained by the supplied
    /// profile ID and never reads the owner's token or a grant's token hash.
    /// Native human sessions are internal authority, outside this management UI.
    pub fn grant_metadata_for_profile(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<Vec<GrantMetadata>, HostError> {
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        self.owner(session)?;
        resources.core.local_human(profile)?;

        let records = {
            let mut statement = resources.persistence.auth.prepare(
                "SELECT id,profile_id,kind,agent_id,revoked FROM grants \
                 WHERE profile_id=?1 AND kind<>'human' ORDER BY id COLLATE BINARY",
            )?;
            let rows = statement.query_map([profile.to_string()], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?;
            rows.collect::<Result<Vec<RawGrantMetadata>, _>>()?
        };
        records.into_iter().map(parse_metadata).collect()
    }

    /// Looks up an external Agent grant in the requested local profile.
    pub fn grant_metadata_for_profile_id(
        &self,
        session: &Session,
        profile: ProfileId,
        grant_id: Uuid,
    ) -> Result<GrantMetadata, HostError> {
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        self.owner(session)?;
        resources.core.local_human(profile)?;
        metadata_for_id(&resources.persistence.auth, profile, grant_id)
    }

    /// Issues a grant under a caller-stable ID, or reports that the same ID
    /// already exists without minting a replacement token.
    ///
    /// `Some` is returned only when this call minted the token. `None` means
    /// the ID already names a grant with the same profile, role, and Agent ID;
    /// its one-time token cannot be recovered from the auth database. A
    /// different request under the same ID is rejected.
    pub fn grant_with_id(
        &self,
        session: &Session,
        grant_id: Uuid,
        request: GrantRequest,
    ) -> Result<Option<ManagedGrantIssue>, HostError> {
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        self.owner(session)?;
        if grant_id.is_nil() {
            return Err(HostError::InvalidRequest);
        }
        validate_management_request(&request)?;
        resources.core.local_human(request.profile_id)?;

        if let Some(existing) = metadata_for_id_if_present(&resources.persistence.auth, grant_id)? {
            if existing.profile_id != request.profile_id {
                return Err(HostError::NotFound);
            }
            if existing.kind != request.kind || existing.agent_id != request.agent_id {
                return Err(HostError::InvalidRequest);
            }
            return Ok(None);
        }

        let raw_token = crate::storage::token();
        let raw_token_hash = crate::storage::token_hash(&raw_token);
        let credential = GrantCredential(raw_token.into_bytes());
        resources.persistence.auth.execute(
            "INSERT INTO grants(id,profile_id,kind,agent_id,token_hash) \
             VALUES(?1,?2,?3,?4,?5)",
            params![
                grant_id.to_string(),
                request.profile_id.to_string(),
                request.kind.label(),
                request.agent_id.map(|id| id.to_string()),
                raw_token_hash,
            ],
        )?;

        Ok(Some(ManagedGrantIssue {
            metadata: GrantMetadata {
                grant_id,
                profile_id: request.profile_id,
                kind: request.kind,
                agent_id: request.agent_id,
                revoked: false,
            },
            credential,
        }))
    }

    /// Revokes one grant only when it belongs to the requested local profile.
    ///
    /// The database bit is the permission boundary. Accepted facts and their
    /// receipts remain durable; this method never attempts to reverse them.
    pub fn revoke_grant_for_profile(
        &self,
        session: &Session,
        profile: ProfileId,
        grant_id: Uuid,
    ) -> Result<GrantMetadata, HostError> {
        {
            let state = self.active_state()?;
            let resources = crate::resources(&state)?;
            self.owner(session)?;
            resources.core.local_human(profile)?;
            metadata_for_id(&resources.persistence.auth, profile, grant_id)?;
        }

        // Reuse the existing revocation path and its verification cancellation.
        // Grant profile IDs are immutable; the scoped lookup above prevents an
        // ID from another profile from reaching this owner-only operation.
        self.revoke_grant(session, grant_id)?;
        self.grant_metadata_for_profile_id(session, profile, grant_id)
    }
}

fn validate_management_request(request: &GrantRequest) -> Result<(), HostError> {
    if request.kind == GrantKind::Human {
        return Err(HostError::InvalidRequest);
    }
    let requires_agent = matches!(
        request.kind,
        GrantKind::AgentNote | GrantKind::SummaryProducer
    );
    if request.agent_id.is_some() != requires_agent {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}

fn metadata_for_id(
    auth: &Connection,
    profile: ProfileId,
    grant_id: Uuid,
) -> Result<GrantMetadata, HostError> {
    metadata_for_id_if_present(auth, grant_id)?
        .filter(|metadata| metadata.profile_id == profile && metadata.kind != GrantKind::Human)
        .ok_or(HostError::NotFound)
}

fn metadata_for_id_if_present(
    auth: &Connection,
    grant_id: Uuid,
) -> Result<Option<GrantMetadata>, HostError> {
    let row = auth
        .query_row(
            "SELECT id,profile_id,kind,agent_id,revoked FROM grants WHERE id=?1",
            [grant_id.to_string()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    row.map(parse_metadata).transpose()
}

fn parse_metadata(raw: RawGrantMetadata) -> Result<GrantMetadata, HostError> {
    let (grant_id, profile_id, kind, agent_id, revoked) = raw;
    Ok(GrantMetadata {
        grant_id: grant_id
            .parse()
            .map_err(|_| HostError::CredentialsUnavailable)?,
        profile_id: profile_id
            .parse()
            .map_err(|_| HostError::CredentialsUnavailable)?,
        kind: GrantKind::parse(&kind)?,
        agent_id: agent_id
            .map(|id| id.parse())
            .transpose()
            .map_err(|_| HostError::CredentialsUnavailable)?,
        revoked: revoked != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentAccessCheck, AgentCapability};
    use exomind_core::{CaptureCommand, CommandId, EventId};
    use serde_json::Value;
    use std::collections::BTreeSet;

    fn request(profile_id: ProfileId, kind: GrantKind) -> GrantRequest {
        GrantRequest {
            profile_id,
            kind,
            agent_id: matches!(kind, GrantKind::AgentNote | GrantKind::SummaryProducer)
                .then(AgentId::new),
        }
    }

    fn capture(profile_id: ProfileId, text: &str) -> CaptureCommand {
        CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id,
            occurred_at_ms: 1_794_560_000_000,
            text: text.to_owned(),
            tags: vec!["synthetic".to_owned()],
            originals: Vec::new(),
        }
    }

    fn authenticate(host: &BetaHost, issue: ManagedGrantIssue) -> Session {
        let token = std::str::from_utf8(issue.credential.as_bytes()).unwrap();
        host.authenticate(token).unwrap()
    }

    #[test]
    fn metadata_is_profile_scoped_and_contains_no_credentials_or_profile_content() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let p = ProfileId::new();
        let q = ProfileId::new();
        host.provision_profile(&owner, p, "Synthetic P").unwrap();
        host.provision_profile(&owner, q, "Synthetic Q").unwrap();
        let p_id = Uuid::new_v4();
        let q_id = Uuid::new_v4();

        let p_issue = host
            .grant_with_id(&owner, p_id, request(p, GrantKind::Observer))
            .unwrap();
        let q_issue = host
            .grant_with_id(&owner, q_id, request(q, GrantKind::AgentNote))
            .unwrap();
        assert!(p_issue.is_some());
        assert!(q_issue.is_some());
        let debug = format!("{:?}", p_issue.as_ref().unwrap());
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("token_hash"));
        drop(p_issue);
        drop(q_issue);

        let listed = host.grant_metadata_for_profile(&owner, p).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].grant_id, p_id);
        assert_eq!(listed[0].profile_id, p);
        assert_eq!(listed[0].kind, GrantKind::Observer);
        assert!(listed[0].agent_id.is_none());
        assert!(!listed[0].revoked);

        let serialized: Value = serde_json::to_value(&listed).unwrap();
        let fields: BTreeSet<&str> = serialized[0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            fields,
            BTreeSet::from(["agent_id", "grant_id", "kind", "profile_id", "revoked"])
        );
        let json = serialized.to_string();
        assert!(!json.contains("token"));
        assert!(!json.contains("token_hash"));
        assert!(!json.contains("owner_token"));
        assert!(!json.contains("Synthetic P"));
        assert!(!json.contains("Synthetic Q"));
        assert!(!json.contains(&q_id.to_string()));
        assert!(matches!(
            host.grant_metadata_for_profile_id(&owner, q, p_id),
            Err(HostError::NotFound)
        ));
        assert!(matches!(
            host.revoke_grant_for_profile(&owner, q, p_id),
            Err(HostError::NotFound)
        ));
        assert!(
            !host
                .grant_metadata_for_profile_id(&owner, p, p_id)
                .unwrap()
                .revoked
        );
        host.stop().unwrap();
    }

    #[test]
    fn native_human_sessions_are_not_external_agent_management_entries() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "Synthetic native workspace")
            .unwrap();
        let human = host.native_human_session(&owner, profile).unwrap();
        let internal_id: String = {
            let state = host.active_state().unwrap();
            crate::resources(&state)
                .unwrap()
                .persistence
                .auth
                .query_row(
                    "SELECT id FROM grants WHERE profile_id=?1 AND kind='human'",
                    [profile.to_string()],
                    |row| row.get(0),
                )
                .unwrap()
        };
        let internal_id = Uuid::parse_str(&internal_id).unwrap();
        let agent_id = Uuid::new_v4();
        host.grant_with_id(&owner, agent_id, request(profile, GrantKind::Observer))
            .unwrap();

        let listed = host.grant_metadata_for_profile(&owner, profile).unwrap();
        assert_eq!(
            listed.len(),
            1,
            "internal Native authority must not break the external Agent role contract"
        );
        assert_eq!(listed[0].grant_id, agent_id);
        assert!(matches!(
            host.grant_metadata_for_profile_id(&owner, profile, internal_id),
            Err(HostError::NotFound)
        ));
        assert!(matches!(
            host.revoke_grant_for_profile(&owner, profile, internal_id),
            Err(HostError::NotFound)
        ));
        host.capture(
            &human,
            &capture(profile, "Synthetic native authority remains usable"),
        )
        .unwrap();
        host.stop().unwrap();
    }

    #[test]
    fn management_roles_keep_their_existing_capabilities_and_never_issue_human() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "Synthetic grants")
            .unwrap();

        let observer = host
            .grant_with_id(
                &owner,
                Uuid::new_v4(),
                request(profile, GrantKind::Observer),
            )
            .unwrap()
            .unwrap();
        let note = host
            .grant_with_id(
                &owner,
                Uuid::new_v4(),
                request(profile, GrantKind::AgentNote),
            )
            .unwrap()
            .unwrap();
        let summary = host
            .grant_with_id(
                &owner,
                Uuid::new_v4(),
                request(profile, GrantKind::SummaryProducer),
            )
            .unwrap()
            .unwrap();
        let observer_session = authenticate(&host, observer);
        let note_session = authenticate(&host, note);
        let summary_session = authenticate(&host, summary);

        let read = vec![
            AgentCapability::EventsRead,
            AgentCapability::TimelineRead,
            AgentCapability::ReceiptsRead,
            AgentCapability::OriginalsRead,
            AgentCapability::TimeblocksRead,
            AgentCapability::SummariesRead,
        ];
        let access = |session: &Session| {
            host.check_agent_access(session, profile, &AgentAccessCheck { required: vec![] })
                .unwrap()
                .allowed
        };
        assert_eq!(access(&observer_session), read);
        assert_eq!(
            access(&note_session),
            [
                read.clone(),
                vec![
                    AgentCapability::CaptureAppendAgentNote,
                    AgentCapability::OriginalsStage,
                ],
            ]
            .concat()
        );
        assert_eq!(
            access(&summary_session),
            [read, vec![AgentCapability::ExternalSummaryAppend]].concat()
        );

        assert!(matches!(
            host.grant_with_id(&owner, Uuid::new_v4(), request(profile, GrantKind::Human)),
            Err(HostError::InvalidRequest)
        ));
        assert!(matches!(
            host.grant_with_id(
                &owner,
                Uuid::new_v4(),
                GrantRequest {
                    profile_id: profile,
                    kind: GrantKind::Observer,
                    agent_id: Some(AgentId::new()),
                }
            ),
            Err(HostError::InvalidRequest)
        ));
        host.stop().unwrap();
    }

    #[test]
    fn revocation_denies_new_requests_while_another_grant_reads_the_old_receipt() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "Synthetic revoke")
            .unwrap();
        let writer = host
            .grant_with_id(
                &owner,
                Uuid::new_v4(),
                request(profile, GrantKind::AgentNote),
            )
            .unwrap()
            .unwrap();
        let observer = host
            .grant_with_id(
                &owner,
                Uuid::new_v4(),
                request(profile, GrantKind::Observer),
            )
            .unwrap()
            .unwrap();
        let writer_grant_id = writer.metadata.grant_id;
        let writer_session = authenticate(&host, writer);
        let observer_session = authenticate(&host, observer);
        let accepted = capture(profile, "synthetic note accepted before revocation");
        let receipt = host.capture(&writer_session, &accepted).unwrap();

        let revoked = host
            .revoke_grant_for_profile(&owner, profile, writer_grant_id)
            .unwrap();
        assert!(revoked.revoked);
        assert!(matches!(
            host.capture(
                &writer_session,
                &capture(profile, "synthetic note after revocation")
            ),
            Err(HostError::Unauthorized)
        ));
        assert_eq!(
            host.receipt(&observer_session, profile, accepted.command_id)
                .unwrap(),
            Some(receipt)
        );
        host.stop().unwrap();
    }

    #[test]
    fn stable_grant_id_recovers_metadata_without_minting_a_second_token() {
        let directory = tempfile::tempdir().unwrap();
        let profile = ProfileId::new();
        let grant_id = Uuid::new_v4();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        host.provision_profile(&owner, profile, "Synthetic recovery")
            .unwrap();

        let first = host
            .grant_with_id(&owner, grant_id, request(profile, GrantKind::Observer))
            .unwrap();
        assert!(first.is_some());
        drop(first);
        assert!(
            host.grant_with_id(&owner, grant_id, request(profile, GrantKind::Observer))
                .unwrap()
                .is_none()
        );
        let before_restart = host
            .grant_metadata_for_profile_id(&owner, profile, grant_id)
            .unwrap();
        host.stop().unwrap();
        drop(host);

        let reopened = BetaHost::open(directory.path()).unwrap();
        let reopened_owner = reopened.owner_session().unwrap();
        assert!(
            reopened
                .grant_with_id(
                    &reopened_owner,
                    grant_id,
                    request(profile, GrantKind::Observer)
                )
                .unwrap()
                .is_none()
        );
        let after_restart = reopened
            .grant_metadata_for_profile_id(&reopened_owner, profile, grant_id)
            .unwrap();
        assert_eq!(before_restart, after_restart);
        assert_eq!(
            reopened
                .grant_metadata_for_profile(&reopened_owner, profile)
                .unwrap()
                .len(),
            1
        );
        reopened.stop().unwrap();
    }
}
