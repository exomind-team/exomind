//! Portable origin integrity for multi-device history. A carrier's TLS key
//! authenticates the carrier, not the author of a forwarded fact. Every prefix
//! position has its own origin signature, so a valid final head cannot be used
//! to admit a fabricated earlier page. This module grants no membership.
use super::{DeviceIdentityInfo, Identity, identity};
use crate::{BetaHost, HostError, Session};
use exomind_core::{Core, OriginCursor, OriginIdentity, OriginPage, OriginPageQuery, ProfileId};
use serde::{Deserialize, Serialize};

const POSITION_DOMAIN: &[u8] = b"exomind-origin-position/1\0";
const MAX_PAGE_FACTS: usize = 100;
// A 100-entry JSON signature vector at 64 bytes/signature needs at most 25,600
// bytes. Public SPKI, the frozen-head signature and the RPC wrapper fit in the
// remaining allowance. Preserve the existing logical framing ceiling.
const ENVELOPE_RESERVE: usize = 40 * 1024;
const RPC_WRAPPER_RESERVE: usize = 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SignedOriginPage {
    pub page: OriginPage,
    pub signer: DeviceIdentityInfo,
    pub through_signature: Vec<u8>,
    pub entry_signatures: Vec<Vec<u8>>,
}

#[derive(Serialize)]
struct SignedPosition<'a> {
    origin: &'a OriginIdentity,
    position: &'a OriginCursor,
}
fn position_message(
    origin: &OriginIdentity,
    position: &OriginCursor,
) -> Result<Vec<u8>, HostError> {
    let mut bytes = POSITION_DOMAIN.to_vec();
    bytes.extend_from_slice(&serde_json::to_vec(&SignedPosition { origin, position })?);
    Ok(bytes)
}
fn valid_cursor(value: &OriginCursor) -> bool {
    value.seq <= i64::MAX as u64
        && value.hash.len() == 64
        && value
            .hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_positions(page: &OriginPage) -> bool {
    // DeviceId/ProfileId already reject nil at construction/deserialization.
    if page.origin.restoration_epoch.is_nil()
        || page.entries.len() > MAX_PAGE_FACTS
        || !valid_cursor(&page.from)
        || !valid_cursor(&page.to)
        || !valid_cursor(&page.through)
        || page.from.seq > page.to.seq
        || page.to.seq > page.through.seq
        || page.to.seq - page.from.seq != page.entries.len() as u64
        || page.has_more != (page.to.seq < page.through.seq)
        || page.entries.is_empty() && page.has_more
        || page.to.seq == page.through.seq && page.to.hash != page.through.hash
    {
        return false;
    }
    let mut previous = page.from.clone();
    for entry in &page.entries {
        let position = OriginCursor {
            seq: entry.origin_seq,
            hash: entry.chain_hash.clone(),
        };
        if previous.seq.checked_add(1) != Some(entry.origin_seq)
            || !valid_cursor(&position)
            || entry.fact.profile_id() != page.origin.profile_id
            || entry.fact.device_id() != page.origin.device_id
        {
            return false;
        }
        previous = position;
    }
    previous == page.to
}

fn sign_local_page(identity: &Identity, page: OriginPage) -> Result<SignedOriginPage, HostError> {
    let signed = sign_local_page_unbounded(identity, page)?;
    if serde_json::to_vec(&signed)?.len() + RPC_WRAPPER_RESERVE > super::framing::MAX_MESSAGE_BYTES
    {
        return Err(HostError::PayloadTooLarge);
    }
    Ok(signed)
}

fn sign_local_page_unbounded(
    identity: &Identity,
    page: OriginPage,
) -> Result<SignedOriginPage, HostError> {
    if page.origin.device_id != identity.info.device_id || !valid_positions(&page) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let through_signature =
        identity.sign_message(&position_message(&page.origin, &page.through)?)?;
    let entry_signatures = page
        .entries
        .iter()
        .map(|entry| {
            identity.sign_message(&position_message(
                &page.origin,
                &OriginCursor {
                    seq: entry.origin_seq,
                    hash: entry.chain_hash.clone(),
                },
            )?)
        })
        .collect::<Result<Vec<_>, HostError>>()?;
    Ok(SignedOriginPage {
        page,
        signer: identity.info.clone(),
        through_signature,
        entry_signatures,
    })
}

impl SignedOriginPage {
    /// Authenticate positions under a key already qualified by Host authority.
    /// Core still validates canonical bodies, chain continuity, replay and the
    /// current receive cursor atomically during import. A signature, including
    /// one valid under a self-supplied key, never grants profile access.
    pub(super) fn verify_positions(
        &self,
        expected_origin: &OriginIdentity,
        expected_signer: &DeviceIdentityInfo,
    ) -> Result<(), HostError> {
        if &self.page.origin != expected_origin
            || &self.signer != expected_signer
            || expected_signer.device_id != expected_origin.device_id
            || self.entry_signatures.len() != self.page.entries.len()
            || !valid_positions(&self.page)
        {
            return Err(HostError::PeerMembershipDenied);
        }
        identity::verify_message(
            expected_signer,
            &position_message(expected_origin, &self.page.through)?,
            &self.through_signature,
        )?;
        for (entry, signature) in self.page.entries.iter().zip(&self.entry_signatures) {
            identity::verify_message(
                expected_signer,
                &position_message(
                    expected_origin,
                    &OriginCursor {
                        seq: entry.origin_seq,
                        hash: entry.chain_hash.clone(),
                    },
                )?,
                signature,
            )?;
        }
        Ok(())
    }
}

pub(super) fn signed_page_query(query: &OriginPageQuery) -> Result<OriginPageQuery, HostError> {
    if query.limit == 0
        || query.limit > MAX_PAGE_FACTS
        || query.max_bytes == 0
        || query.max_bytes > exomind_core::MAX_ORIGIN_PAGE_BYTES
    {
        return Err(HostError::InvalidRequest);
    }
    Ok(OriginPageQuery {
        max_bytes: query
            .max_bytes
            .min(super::framing::MAX_MESSAGE_BYTES - ENVELOPE_RESERVE),
        ..query.clone()
    })
}

/// Archive proofs reuse the same source signatures but do not inherit the peer
/// transport frame ceiling or any carrier/member qualification.
pub(super) fn export_local_archive_page(
    identity: &Identity,
    core: &Core,
    profile: ProfileId,
    query: &OriginPageQuery,
) -> Result<SignedOriginPage, HostError> {
    if query.limit == 0
        || query.limit > MAX_PAGE_FACTS
        || query.max_bytes == 0
        || query.max_bytes > exomind_core::MAX_ORIGIN_PAGE_BYTES
    {
        return Err(HostError::InvalidRequest);
    }
    let reader = core.local_human(profile)?;
    let page = core.export_origin_page(&reader, profile, query)?;
    sign_local_page_unbounded(identity, page)
}

/// The caller must qualify its local owner or current peer read scope before
/// entering this data-plane helper. Only Core's verified own-origin export is
/// eligible for a local signature; received sources need their retained proofs.
pub(super) fn export_local_page(
    identity: &Identity,
    core: &Core,
    profile: ProfileId,
    query: &OriginPageQuery,
) -> Result<SignedOriginPage, HostError> {
    let reader = core.local_human(profile)?;
    sign_local_page(
        identity,
        core.export_origin_page(&reader, profile, &signed_page_query(query)?)?,
    )
}

impl BetaHost {
    /// Trusted embedding seam. This can sign only the current device's actual
    /// durable origin; it is not a public arbitrary-message signing endpoint.
    pub(super) fn signed_origin_page(
        &self,
        owner: &Session,
        profile: ProfileId,
        query: &OriginPageQuery,
    ) -> Result<SignedOriginPage, HostError> {
        let identity = self.transport_identity(owner)?;
        let state = self.active_state()?;
        self.owner(owner)?;
        let core = &crate::resources(&state)?.core;
        export_local_page(&identity, core, profile, query)
    }
}

#[cfg(test)]
#[path = "origin_proof_tests.rs"]
mod tests;
