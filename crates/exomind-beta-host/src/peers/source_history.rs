//! A live, append-qualified P member explicitly endorses its durable history
//! inventory. Original source signatures authenticate every imported prefix.
//! Endorsement binds a first source key within P; it grants no network member,
//! credentials, remote access or local writer. Known pins/revocations win.
use super::{
    DeviceIdentityInfo, PeerChannel, PeerJoinState, PeerMember,
    authorization::{PeerOperation, PeerProfileScope},
    identity, membership_store,
    origin_proof::{self, SignedOriginPage},
    sync_store::{self, AckBaseline, OutgoingAckKey},
};
use crate::{BetaHost, HostError, Resources};
use exomind_core::{
    Core, ImportAck, OriginCursor, OriginIdentity, OriginPageProof, OriginPageQuery,
    OriginProvenanceKey, OriginSnapshot, ProfileId, VerifiedOriginContext,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(super) const MAX_SOURCES: usize = 256;
const ENDORSEMENT_DOMAIN: &[u8] = b"exomind-origin-history-endorsement/1\0";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SourceOffer {
    pub origin: OriginIdentity,
    pub materialized_head: OriginCursor,
    pub available_head: OriginCursor,
    pub source: DeviceIdentityInfo,
    pub carrier: DeviceIdentityInfo,
    pub endorsement: Vec<u8>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SourceCatalog {
    pub sources: Vec<SourceOffer>,
    pub unavailable: Vec<OriginSnapshot>,
    pub fingerprint: Option<String>,
}
pub(super) fn inventory_fingerprint(
    profile: ProfileId,
    inventory: &[OriginSnapshot],
) -> Result<String, HostError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            "exomind-history-inventory/1",
            profile,
            inventory
        ))?)
    ))
}
pub(super) use exomind_core::OriginReceiveState as ReceivePosition;
#[derive(Serialize)]
struct Endorsement<'a> {
    origin: &'a OriginIdentity,
    materialized_head: &'a OriginCursor,
    available_head: &'a OriginCursor,
    source: &'a DeviceIdentityInfo,
    carrier: &'a DeviceIdentityInfo,
}
pub(super) fn endorsement_message(offer: &SourceOffer) -> Result<Vec<u8>, HostError> {
    let mut bytes = ENDORSEMENT_DOMAIN.to_vec();
    bytes.extend_from_slice(&serde_json::to_vec(&Endorsement {
        origin: &offer.origin,
        materialized_head: &offer.materialized_head,
        available_head: &offer.available_head,
        source: &offer.source,
        carrier: &offer.carrier,
    })?);
    Ok(bytes)
}
fn key(source: &DeviceIdentityInfo) -> OriginProvenanceKey {
    OriginProvenanceKey {
        public_key_spki: source.spki_der.clone(),
        fingerprint_sha256: source.fingerprint_sha256.clone(),
    }
}
fn valid_cursor(cursor: &OriginCursor) -> bool {
    cursor.seq <= i64::MAX as u64
        && cursor.hash.len() == 64
        && cursor
            .hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn qualify_source(
    resources: &Resources,
    profile: ProfileId,
    source: &DeviceIdentityInfo,
) -> Result<(), HostError> {
    if let Some(member) =
        membership_store::member(&resources.persistence.auth, profile, source.device_id)?
    {
        if member.record.revoked
            || member.record.state != PeerJoinState::Ready
            || !member.record.capabilities.append_facts
            || member.record.pin != source.fingerprint_sha256
        {
            return Err(HostError::PeerMembershipDenied);
        }
    }
    let reader = resources.core.local_human(profile)?;
    if let Some(stored) =
        resources
            .core
            .origin_provenance_key(&reader, profile, source.device_id)?
    {
        if stored != key(source) {
            return Err(HostError::PeerMembershipDenied);
        }
    }
    Ok(())
}
fn qualify_offer(
    resources: &Resources,
    member: &PeerMember,
    offer: &SourceOffer,
) -> Result<VerifiedOriginContext, HostError> {
    if offer.origin.profile_id != member.profile_id
        || offer.origin.restoration_epoch.is_nil()
        || offer.origin.device_id != offer.source.device_id
        || offer.origin.device_id == resources.core.device_id()
        || offer.carrier.device_id != member.device_id
        || offer.carrier.fingerprint_sha256 != member.pin
        || !valid_cursor(&offer.available_head)
        || !valid_cursor(&offer.materialized_head)
        || offer.available_head.seq > offer.materialized_head.seq
        || offer.available_head.seq == offer.materialized_head.seq
            && offer.available_head.hash != offer.materialized_head.hash
    {
        return Err(HostError::PeerMembershipDenied);
    }
    identity::verify_message(
        &offer.carrier,
        &endorsement_message(offer)?,
        &offer.endorsement,
    )?;
    qualify_source(resources, member.profile_id, &offer.source)?;
    Ok(resources.core.trusted_verified_origin_context(
        member.profile_id,
        member.device_id,
        &offer.origin,
        member.generation,
        key(&offer.source),
    )?)
}
fn qualify_local_offer(
    resources: &Resources,
    member: &PeerMember,
    offer: &SourceOffer,
) -> Result<(), HostError> {
    let identity = resources
        .peer_identity
        .as_ref()
        .ok_or(HostError::PeerIdentityUnavailable)?;
    if offer.origin.profile_id != member.profile_id
        || offer.origin.device_id == member.device_id
        || offer.source.device_id != offer.origin.device_id
        || offer.carrier != identity.info
    {
        return Err(HostError::PeerMembershipDenied);
    }
    identity::verify_message(
        &offer.carrier,
        &endorsement_message(offer)?,
        &offer.endorsement,
    )?;
    qualify_source(resources, member.profile_id, &offer.source)?;
    let reader = resources.core.local_human(member.profile_id)?;
    if offer.origin.device_id == identity.info.device_id {
        if offer.source != identity.info
            || resources
                .core
                .replication_identity(&reader, member.profile_id)?
                != offer.origin
        {
            return Err(HostError::PeerMembershipDenied);
        }
    } else {
        let stored = resources
            .core
            .verified_origin_state(&reader, &offer.origin)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        if stored.key != key(&offer.source) || stored.cursor.seq < offer.available_head.seq {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
    }
    Ok(())
}
fn export_page(
    resources: &Resources,
    offer: &SourceOffer,
    query: &OriginPageQuery,
) -> Result<SignedOriginPage, HostError> {
    if query.through.as_ref() != Some(&offer.available_head) {
        return Err(HostError::InvalidRequest);
    }
    let identity = resources
        .peer_identity
        .as_ref()
        .ok_or(HostError::PeerIdentityUnavailable)?;
    if offer.origin.device_id == identity.info.device_id {
        return origin_proof::export_local_page(
            identity,
            &resources.core,
            offer.origin.profile_id,
            query,
        );
    }
    let reader = resources.core.local_human(offer.origin.profile_id)?;
    let page = resources.core.export_known_origin_page(
        &reader,
        &offer.origin,
        &origin_proof::signed_page_query(query)?,
    )?;
    let (stored, proof) = resources.core.origin_page_proof(&reader, &page)?;
    if stored != key(&offer.source) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(SignedOriginPage {
        page,
        signer: offer.source.clone(),
        entry_signatures: proof.entry_signatures,
        through_signature: proof.through_signature,
    })
}
fn check_data_cursor(
    core: &Core,
    origin: &OriginIdentity,
    cursor: &OriginCursor,
) -> Result<(), HostError> {
    let reader = core.local_human(origin.profile_id)?;
    core.export_known_origin_page(
        &reader,
        origin,
        &OriginPageQuery {
            after: Some(cursor.clone()),
            through: Some(cursor.clone()),
            limit: 1,
            ..Default::default()
        },
    )?;
    Ok(())
}

impl BetaHost {
    pub(super) fn peer_history_probe(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
    ) -> Result<(OriginIdentity, OriginCursor, String), HostError> {
        self.with_peer_scope(
            channel,
            scope,
            PeerOperation::SendHistory,
            |core, member| {
                let reader = core.local_human(member.profile_id)?;
                let inventory = core.origin_inventory(&reader, member.profile_id, MAX_SOURCES)?;
                let own = inventory
                    .iter()
                    .find(|s| s.origin.device_id == core.device_id())
                    .ok_or(HostError::PeerSyncRecoveryRequired)?;
                Ok((
                    own.origin.clone(),
                    own.head.clone(),
                    inventory_fingerprint(member.profile_id, &inventory)?,
                ))
            },
        )
    }
    pub(super) fn peer_history_health(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
    ) -> Result<(bool, bool), HostError> {
        self.with_peer_scope(channel, scope, PeerOperation::SyncHealth, |core, member| {
            Ok(core.replication_health(&core.local_human(member.profile_id)?, member.profile_id)?)
        })
    }
    pub(super) fn peer_source_catalog(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
    ) -> Result<SourceCatalog, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::SendHistory,
            |resources, member| {
                let identity = resources
                    .peer_identity
                    .as_ref()
                    .ok_or(HostError::PeerIdentityUnavailable)?;
                let reader = resources.core.local_human(member.profile_id)?;
                let inventory =
                    resources
                        .core
                        .origin_inventory(&reader, member.profile_id, MAX_SOURCES)?;
                let mut catalog = SourceCatalog {
                    fingerprint: Some(inventory_fingerprint(member.profile_id, &inventory)?),
                    ..Default::default()
                };
                for snapshot in inventory {
                    // The receiver is the authority for its own source. Never echo
                    // its origin through a foreign carrier or register a self ACK.
                    if snapshot.origin.device_id == member.device_id {
                        continue;
                    }
                    let available = if snapshot.origin.device_id == self.device_id {
                        Some((identity.info.clone(), snapshot.head.clone()))
                    } else {
                        resources
                            .core
                            .verified_origin_state(&reader, &snapshot.origin)?
                            .map(|s| {
                                (
                                    DeviceIdentityInfo {
                                        device_id: snapshot.origin.device_id,
                                        spki_der: s.key.public_key_spki,
                                        fingerprint_sha256: s.key.fingerprint_sha256,
                                    },
                                    s.cursor,
                                )
                            })
                    };
                    let Some((source, available_head)) = available else {
                        catalog.unavailable.push(snapshot);
                        continue;
                    };
                    if matches!(
                        qualify_source(resources, member.profile_id, &source),
                        Err(HostError::PeerMembershipDenied)
                    ) {
                        catalog.unavailable.push(snapshot);
                        continue;
                    }
                    qualify_source(resources, member.profile_id, &source)?;
                    let mut offer = SourceOffer {
                        origin: snapshot.origin,
                        materialized_head: snapshot.head,
                        available_head,
                        source,
                        carrier: identity.info.clone(),
                        endorsement: Vec::new(),
                    };
                    offer.endorsement = identity.sign_message(&endorsement_message(&offer)?)?;
                    catalog.sources.push(offer);
                }
                Ok(catalog)
            },
        )
    }
    pub(super) fn peer_source_cursor(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        offer: &SourceOffer,
    ) -> Result<ReceivePosition, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::ReceiveHistory,
            |resources, member| {
                let context = qualify_offer(resources, member, offer)?;
                Ok(resources.core.verified_origin_receive_state(&context)?)
            },
        )
    }
    pub(super) fn peer_import_source_page(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        offer: &SourceOffer,
        signed: &SignedOriginPage,
    ) -> Result<(ImportAck, OriginCursor), HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::ReceiveHistory,
            |resources, member| {
                let context = qualify_offer(resources, member, offer)?;
                if signed.page.through != offer.available_head {
                    return Err(HostError::InvalidRequest);
                }
                signed.verify_positions(&offer.origin, &offer.source)?;
                let ack = resources.core.import_verified_origin_page(
                    &context,
                    &signed.page,
                    &OriginPageProof {
                        entry_signatures: signed.entry_signatures.clone(),
                        through_signature: signed.through_signature.clone(),
                    },
                )?;
                let position = resources.core.verified_origin_receive_state(&context)?;
                Ok((ack, position.verified))
            },
        )
    }
    pub(super) fn peer_export_source_page(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        offer: &SourceOffer,
        query: &OriginPageQuery,
    ) -> Result<SignedOriginPage, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::SendHistory,
            |resources, member| {
                qualify_local_offer(resources, member, offer)?;
                export_page(resources, offer, query)
            },
        )
    }
    pub(super) fn peer_source_ack_baseline(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        offer: &SourceOffer,
    ) -> Result<AckBaseline, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::SendHistory,
            |resources, member| {
                qualify_local_offer(resources, member, offer)?;
                sync_store::register(
                    &mut resources.persistence.auth,
                    &OutgoingAckKey::new(offer.origin.clone(), member.device_id)?,
                )
            },
        )
    }
    pub(super) fn peer_confirm_source_ack(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        offer: &SourceOffer,
        baseline: &AckBaseline,
        position: &ReceivePosition,
    ) -> Result<(), HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::SendHistory,
            |resources, member| {
                qualify_local_offer(resources, member, offer)?;
                if baseline.key().origin() != &offer.origin
                    || baseline.key().target() != member.device_id
                    || position.verified.seq > position.data.seq
                    || !valid_cursor(&position.data)
                    || !valid_cursor(&position.verified)
                {
                    return Err(HostError::InvalidRequest);
                }
                // A relay may hold less history than its target. Persist only the
                // prefix this sender can actually verify. A prior higher ACK still
                // fences a sender rollback; it is never silently reset.
                let data = if position.data.seq > offer.materialized_head.seq {
                    &offer.materialized_head
                } else {
                    &position.data
                };
                let verified = if position.verified.seq > offer.materialized_head.seq {
                    &offer.materialized_head
                } else {
                    &position.verified
                };
                sync_store::fence(baseline, data)?;
                check_data_cursor(&resources.core, &offer.origin, data)?;
                check_data_cursor(&resources.core, &offer.origin, verified)?;
                sync_store::confirm(&mut resources.persistence.auth, baseline.key(), data)?;
                Ok(())
            },
        )
    }
}
