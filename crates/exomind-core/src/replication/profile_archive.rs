//! Human-admitted, offline profile history import primitives.
//!
//! These capabilities carry no peer member, carrier, writer, or command receipt.
use super::{ImportAck, OriginPage, OriginPageProof, OriginProvenanceKey, ReplicatedFact, ingest};
use crate::{
    AuthorKind, Core, CoreError, OriginalBytesState, OriginalId, OriginalRef, ProfileId,
    WriterContext,
};
use rusqlite::params;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileArchiveFactMatch {
    New,
    Identical,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProfileArchiveOriginalState {
    pub manifest: Option<OriginalRef>,
    pub bytes_state: Option<OriginalBytesState>,
    pub referenced: bool,
    pub private_stage: bool,
}

/// In-process authority minted from a local Human context. This grants only
/// admission of historical facts into one profile; it is not a replica or
/// network capability and cannot create a command receipt.
pub struct ProfileArchiveImportContext {
    lifecycle: Uuid,
    profile_id: ProfileId,
    device_id: crate::DeviceId,
}

impl Core {
    /// Trusted Host boundary. The Host must qualify the current session and
    /// explicitly request this context only after Human confirmation.
    pub fn profile_archive_import_context(
        &self,
        human: &WriterContext,
        profile: ProfileId,
    ) -> Result<ProfileArchiveImportContext, CoreError> {
        self.check_scope(human, profile)?;
        if human.author_kind != AuthorKind::Human {
            return Err(CoreError::OriginalLifecycleHumanOnly);
        }
        Ok(ProfileArchiveImportContext {
            lifecycle: self.lifecycle(),
            profile_id: profile,
            device_id: self.device_id(),
        })
    }

    /// Compare one bounded typed fact without exposing another profile's body.
    pub fn profile_archive_fact_match(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        incoming: &ReplicatedFact,
    ) -> Result<ProfileArchiveFactMatch, CoreError> {
        self.check_scope(context, profile)?;
        incoming.validate()?;
        if incoming.profile_id() != profile {
            return Err(CoreError::ScopeMismatch);
        }
        let connection = self.connection()?;
        let Some(stored) = super::facts::load_fact(&connection, incoming.event_id())? else {
            return Ok(ProfileArchiveFactMatch::New);
        };
        if stored.profile_id() == profile
            && stored.canonical_fact_bytes()? == incoming.canonical_fact_bytes()?
        {
            Ok(ProfileArchiveFactMatch::Identical)
        } else {
            Ok(ProfileArchiveFactMatch::Conflict)
        }
    }

    /// Read local manifest/lifecycle metadata for preview. A private stage is
    /// surfaced as a conflict so an archive cannot publish an unsent draft.
    pub fn profile_archive_original_state(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        id: OriginalId,
    ) -> Result<ProfileArchiveOriginalState, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let manifest = match crate::manifests::manifest(&connection, id) {
            Ok((stored_profile, original)) if stored_profile == profile => Some(original),
            Ok(_) => return Err(CoreError::OriginalConflict),
            Err(CoreError::UnknownOriginal) => None,
            Err(error) => return Err(error),
        };
        let referenced: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=?1 AND e.profile_id=?2)",
            params![id.to_string(), profile.to_string()],
            |row| row.get(0),
        )?;
        let private_stage: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM original_stages s WHERE s.original_id=?1 AND s.profile_id=?2 AND NOT EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=s.original_id AND e.profile_id=?2))",
            params![id.to_string(), profile.to_string()],
            |row| row.get(0),
        )?;
        drop(connection);
        let bytes_state = if manifest.is_some() && !private_stage {
            Some(
                self.original_lifecycle_status(context, profile, id)?
                    .bytes_state,
            )
        } else {
            None
        };
        Ok(ProfileArchiveOriginalState {
            manifest,
            bytes_state,
            referenced,
            private_stage,
        })
    }

    /// Validate page shape and canonical chain before the Host presents a plan.
    pub fn validate_profile_archive_page(
        &self,
        profile: ProfileId,
        page: &OriginPage,
    ) -> Result<(), CoreError> {
        ingest::validate_archive_page(profile, page)
    }

    /// Returns true only when a same-device source page is an exact subset of
    /// the existing local origin. A matching DeviceId never admits new facts.
    pub fn profile_archive_local_page_duplicate(
        &self,
        page: &OriginPage,
    ) -> Result<bool, CoreError> {
        self.validate_profile_archive_page(page.origin.profile_id, page)?;
        if page.origin.device_id != self.device_id() {
            return Ok(false);
        }
        let human = match self.local_human(page.origin.profile_id) {
            Ok(value) => value,
            Err(CoreError::UnknownProfile) => return Ok(false),
            Err(error) => return Err(error),
        };
        if self.replication_identity(&human, page.origin.profile_id)? != page.origin {
            return Ok(false);
        }
        ingest::local_archive_page_duplicate(self, page).map(|ack| ack.is_some())
    }

    /// Import one page under the separate Human historical-import context.
    /// The Host verifies signatures before calling this method. Existing source
    /// keys remain immutable, and no source-device receipt is synthesized.
    pub fn import_profile_archive_page(
        &self,
        context: &ProfileArchiveImportContext,
        page: &OriginPage,
        key: Option<&OriginProvenanceKey>,
        proof: Option<&OriginPageProof>,
    ) -> Result<ImportAck, CoreError> {
        if context.lifecycle != self.lifecycle()
            || context.device_id != self.device_id()
            || context.profile_id != page.origin.profile_id
        {
            return Err(CoreError::ForeignContext);
        }
        if page.origin.device_id == self.device_id() {
            let human = self.local_human(context.profile_id)?;
            if self.replication_identity(&human, context.profile_id)? != page.origin {
                return Err(CoreError::InvalidReplication(
                    "archive origin collides with local device identity",
                ));
            }
        }
        if key.is_none() {
            let human = self.local_human(context.profile_id)?;
            if self
                .origin_provenance_key(&human, context.profile_id, page.origin.device_id)?
                .is_some()
            {
                for entry in &page.entries {
                    if self.profile_archive_fact_match(&human, context.profile_id, &entry.fact)?
                        != ProfileArchiveFactMatch::Identical
                    {
                        return Err(CoreError::InvalidReplication(
                            "pinned origin requires its proof",
                        ));
                    }
                }
            }
        }
        if key.is_some() != proof.is_some() {
            return Err(CoreError::InvalidReplication(
                "archive proof pair incomplete",
            ));
        }
        ingest::import_archive_page(self, page, key.zip(proof))
    }
}
