//! A single invitation exchange over an already pinned, mutually authenticated
//! channel. Durable membership transitions live in membership, never in this
//! network state machine. Retrying uses the same claim, not a new member ID.
use super::{PeerChannel, PeerPin, membership::*};
use crate::{BetaHost, HostError, Session};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;
use uuid::Uuid;

const MAX_PAIRING_FRAME_BYTES: usize = 32 * 1024;

// Secret-bearing requests deliberately do not implement Debug. Errors sent to
// the remote endpoint contain a closed code set, never database/error text.
#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Claim {
        claim: PeerJoinClaim,
    },
    Confirm {
        confirmation: PeerJoinConfirmation,
    },
    Finished {
        acknowledgement: PeerReadyAcknowledgement,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Response {
    Claimed { receipt: PeerClaimReceipt },
    Ready { receipt: PeerReadyReceipt },
    Rejected { code: Rejection },
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Rejection {
    Denied,
    Conflict,
    Expired,
    Revoked,
    Consumed,
    Incompatible,
    Invalid,
    Unavailable,
}
impl Rejection {
    fn of(error: &HostError) -> Self {
        match error {
            HostError::PeerMembershipDenied | HostError::Unauthorized | HostError::Forbidden => {
                Self::Denied
            }
            HostError::PeerMembershipConflict => Self::Conflict,
            HostError::PeerInvitationExpired => Self::Expired,
            HostError::PeerInvitationRevoked => Self::Revoked,
            HostError::PeerInvitationConsumed => Self::Consumed,
            HostError::PeerProtocolMismatch => Self::Incompatible,
            HostError::InvalidRequest | HostError::PayloadTooLarge => Self::Invalid,
            _ => Self::Unavailable,
        }
    }
    fn error(self) -> HostError {
        match self {
            Self::Denied => HostError::PeerMembershipDenied,
            Self::Conflict => HostError::PeerMembershipConflict,
            Self::Expired => HostError::PeerInvitationExpired,
            Self::Revoked => HostError::PeerInvitationRevoked,
            Self::Consumed => HostError::PeerInvitationConsumed,
            Self::Incompatible => HostError::PeerProtocolMismatch,
            Self::Invalid => HostError::InvalidRequest,
            Self::Unavailable => HostError::PeerMembershipUnavailable,
        }
    }
}
async fn send(channel: &PeerChannel, value: &impl Serialize) -> Result<(), HostError> {
    let bytes = serde_json::to_vec(value).map_err(|_| HostError::InvalidRequest)?;
    if bytes.len() > MAX_PAIRING_FRAME_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    channel.send_frame(bytes).await
}
async fn read<T: DeserializeOwned>(channel: &PeerChannel) -> Result<T, HostError> {
    let bytes = channel.read_frame().await?;
    if bytes.len() > MAX_PAIRING_FRAME_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidRequest)
}
async fn step<T: Send + 'static>(
    host: &Arc<BetaHost>,
    channel: &Arc<PeerChannel>,
    action: impl FnOnce(&BetaHost, &PeerChannel) -> Result<T, HostError> + Send + 'static,
) -> Result<T, HostError> {
    let host = host.clone();
    let channel = channel.clone();
    tokio::task::spawn_blocking(move || action(&host, &channel))
        .await
        .map_err(|_| HostError::StatePoisoned)?
}
async fn reject(channel: &PeerChannel, error: HostError) -> HostError {
    // Preserve the local cause even if the already-failing connection cannot
    // deliver the safe rejection. The channel has its own finite I/O deadline.
    let _ = send(
        channel,
        &Response::Rejected {
            code: Rejection::of(&error),
        },
    )
    .await;
    error
}
impl BetaHost {
    /// Local owner approval is required before preparing the join. This does
    /// not start listeners, select routes, or grant the peer local admin access.
    pub async fn join_peer_profile_over_transport(
        self: &Arc<Self>,
        owner: &Session,
        invitation: &PeerInvitation,
        claim_id: Uuid,
        channel: PeerChannel,
    ) -> Result<PeerJoinStatus, HostError> {
        if channel.binding_pin(self)?
            != PeerPin::from_sha256(&invitation.offer.issuer.fingerprint_sha256)?
        {
            // Even a valid TLS channel may belong to a different invitation.
            // Do this before serializing or sending the one-use secret.
            return Err(HostError::PeerPinMismatch);
        }
        let channel = Arc::new(channel);
        let owner = owner.clone();
        let invitation = invitation.clone();
        let claim = step(self, &channel, move |host, channel| {
            channel.binding_pin(host)?;
            host.prepare_peer_join(&owner, &invitation, claim_id)
        })
        .await?;
        send(&channel, &Request::Claim { claim }).await?;
        let receipt = match read(&channel).await? {
            Response::Claimed { receipt } => receipt,
            Response::Rejected { code } => return Err(code.error()),
            Response::Ready { .. } => return Err(HostError::InvalidRequest),
        };
        let confirmation = step(self, &channel, move |host, channel| {
            host.accept_peer_claim_verified(channel, &receipt)
        })
        .await?;
        send(&channel, &Request::Confirm { confirmation }).await?;
        let ready = match read(&channel).await? {
            Response::Ready { receipt } => receipt,
            Response::Rejected { code } => return Err(code.error()),
            Response::Claimed { .. } => return Err(HostError::InvalidRequest),
        };
        let acknowledgement = ready.acknowledgement()?;
        let status = step(self, &channel, move |host, channel| {
            host.finish_peer_join_verified(channel, &ready)
        })
        .await?;
        send(&channel, &Request::Finished { acknowledgement }).await?;
        Ok(status)
    }

    /// Handle one join exchange. Only the invitation claim endpoint is exposed
    /// here; an unknown TLS key cannot query profiles or invoke business IPC.
    pub async fn accept_peer_join_over_transport(
        self: &Arc<Self>,
        channel: PeerChannel,
    ) -> Result<(), HostError> {
        channel.binding_pin(self)?;
        let channel = Arc::new(channel);
        let claim = match read(&channel).await? {
            Request::Claim { claim } => claim,
            Request::Confirm { .. } | Request::Finished { .. } => {
                return Err(reject(&channel, HostError::InvalidRequest).await);
            }
        };
        let receipt = match step(self, &channel, move |host, channel| {
            host.claim_peer_invitation_verified(channel, &claim)
        })
        .await
        {
            Ok(receipt) => receipt,
            Err(error) => return Err(reject(&channel, error).await),
        };
        send(&channel, &Response::Claimed { receipt }).await?;
        let confirmation = match read(&channel).await? {
            Request::Confirm { confirmation } => confirmation,
            Request::Claim { .. } | Request::Finished { .. } => {
                return Err(reject(&channel, HostError::InvalidRequest).await);
            }
        };
        let ready = match step(self, &channel, move |host, channel| {
            host.confirm_peer_join_verified(channel, &confirmation)
        })
        .await
        {
            Ok(ready) => ready,
            Err(error) => return Err(reject(&channel, error).await),
        };
        send(&channel, &Response::Ready { receipt: ready }).await?;
        let acknowledgement = match read(&channel).await? {
            Request::Finished { acknowledgement } => acknowledgement,
            Request::Claim { .. } | Request::Confirm { .. } => {
                return Err(reject(&channel, HostError::InvalidRequest).await);
            }
        };
        match step(self, &channel, move |host, channel| {
            host.acknowledge_peer_ready_verified(channel, &acknowledgement)
        })
        .await
        {
            Ok(_) => Ok(()),
            Err(error) => Err(reject(&channel, error).await),
        }
    }
}

#[cfg(test)]
#[path = "pairing_tests.rs"]
mod tests;
