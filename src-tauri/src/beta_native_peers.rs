//! Main-window owner management. Invitation secrets stay out of logs and URLs.
use super::{Failure, NativeState, trusted_window, work};
use exomind_beta_host::{
    HostError, NearbyPeerCandidate, OriginalTransferResult, PEER_CORE_SCHEMA, PEER_PROTOCOL,
    PeerInvitation, PeerNetworkStatus, PeerOriginalStatus, PeerSyncResult,
};
use exomind_core::{DeviceId, OriginalId, ProfileId};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{State, WebviewWindow};
use uuid::Uuid;

#[derive(Serialize)]
pub(super) struct OriginalAutoDiagnostics {
    network_enabled: bool,
    policy_enabled: bool,
    max_bytes: u64,
    active_outbound: usize,
    deferred: bool,
    last_error_code: Option<&'static str>,
}

fn invitation(raw: &str) -> Result<PeerInvitation, HostError> {
    if raw.len() > 16384 {
        return Err(HostError::PayloadTooLarge);
    }
    let invite: PeerInvitation =
        serde_json::from_str(raw.trim()).map_err(|_| HostError::InvalidRequest)?;
    invite.verified_offer()?;
    Ok(invite)
}
fn claim(invite: &PeerInvitation, device: DeviceId) -> Uuid {
    let digest = Sha256::digest(
        format!(
            "exomind-native-join/1:{}:{}:{}",
            invite.offer.profile_id, invite.offer.invitation_id, device
        )
        .as_bytes(),
    );
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 15) | 0x80;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Uuid::from_bytes(bytes)
}
#[derive(Serialize)]
pub(super) struct InvitationView {
    invitation_text: String,
    invitation_id: Uuid,
    expires_at_ms: i64,
    local_addresses: Vec<String>,
}
#[derive(Serialize)]
pub(super) struct Inspection {
    profile_id: ProfileId,
    profile_name: String,
    issuer_device_id: DeviceId,
    fingerprint_sha256: String,
    expires_at_ms: i64,
    compatible: bool,
    requires_replacement: bool,
}
#[derive(Serialize)]
pub(super) struct JoinView {
    profile_id: ProfileId,
    peer_device_id: DeviceId,
    state: &'static str,
}

#[tauri::command]
pub(super) async fn beta_peer_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
) -> Result<PeerNetworkStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| state.peers.status(profile_id)).await
}
#[tauri::command]
pub(super) async fn beta_peer_nearby_candidates(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<Vec<NearbyPeerCandidate>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), |state| state.peers.nearby_candidates()).await
}

#[tauri::command]
pub(super) async fn beta_peer_set_enabled(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    enabled: bool,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(HostError::Stopped.into());
    }
    state
        .peers
        .set_enabled(enabled)
        .await
        .map_err(Failure::from)
}
#[tauri::command]
pub(super) async fn beta_peer_create_invitation(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    peer_device_id: Option<DeviceId>,
) -> Result<InvitationView, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(HostError::Stopped.into());
    }
    let issued = state
        .peers
        .create_invitation(profile_id)
        .await
        .map_err(Failure::from)?;
    let invite = issued
        .invitation
        .ok_or_else(|| Failure::from(HostError::PeerMembershipConflict))?;
    if let Some(device) = peer_device_id {
        let cloned = invite.clone();
        work(state.inner(), move |state| {
            let request = state.host.peer_replacement_request(
                &state.owner,
                profile_id,
                device,
                cloned.offer.invitation_id,
                claim(&cloned, device),
            )?;
            state
                .host
                .approve_peer_invitation_replacement(&state.owner, &request)?;
            Ok(())
        })
        .await?;
    }
    Ok(InvitationView {
        invitation_text: serde_json::to_string(&invite)
            .map_err(|_| Failure::from(HostError::InvalidRequest))?,
        invitation_id: invite.offer.invitation_id,
        expires_at_ms: invite.offer.expires_at_unix_ms,
        local_addresses: state
            .peers
            .local_addresses()
            .map_err(Failure::from)?
            .iter()
            .map(ToString::to_string)
            .collect(),
    })
}
#[tauri::command]
pub(super) async fn beta_peer_inspect_invitation(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    invitation_text: String,
) -> Result<Inspection, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        let invite = invitation(&invitation_text)?;
        let offer = &invite.offer;
        let expected_claim = claim(&invite, state.host.status()?.device_id);
        let replacement = match state.host.peer_rejoin_expectation(
            &state.owner,
            offer.profile_id,
            offer.issuer.device_id,
        ) {
            Ok(value) => value.is_some_and(|previous| previous.previous_claim_id != expected_claim),
            Err(HostError::Core(exomind_core::CoreError::UnknownProfile)) => false,
            Err(HostError::PeerMembershipConflict) => true,
            Err(error) => return Err(error),
        };
        Ok(Inspection {
            profile_id: offer.profile_id,
            profile_name: offer.profile_name.clone(),
            issuer_device_id: offer.issuer.device_id,
            fingerprint_sha256: offer.issuer.fingerprint_sha256.clone(),
            expires_at_ms: offer.expires_at_unix_ms,
            compatible: offer.schema == PEER_CORE_SCHEMA && offer.protocol == PEER_PROTOCOL,
            requires_replacement: replacement,
        })
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_peer_join_invitation(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    invitation_text: String,
    dial_address: Option<String>,
) -> Result<JoinView, Failure> {
    trusted_window(&window, state.inner())?;
    let dial_address = dial_address
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse::<std::net::SocketAddr>())
        .transpose()
        .map_err(|_| Failure::from(HostError::InvalidRequest))?;
    if let Some(address) = dial_address {
        if address.port() == 0 || address.ip().is_unspecified() || address.ip().is_multicast() {
            return Err(Failure::from(HostError::InvalidRequest));
        }
    }
    let (invite, id) = work(state.inner(), move |state| {
        let invite = invitation(&invitation_text)?;
        let id = claim(&invite, state.host.status()?.device_id);
        if invite.offer.schema != PEER_CORE_SCHEMA || invite.offer.protocol != PEER_PROTOCOL {
            return Err(HostError::PeerProtocolMismatch);
        }
        if let Some(expectation) = state
            .host
            .peer_rejoin_expectation(
                &state.owner,
                invite.offer.profile_id,
                invite.offer.issuer.device_id,
            )?
            .filter(|previous| previous.previous_claim_id != id)
        {
            state
                .host
                .prepare_peer_rejoin(&state.owner, &invite, id, &expectation)?;
        }
        Ok((invite, id))
    })
    .await?;
    let status = state
        .peers
        .join_with_route(&invite, id, dial_address)
        .await
        .map_err(Failure::from)?;
    Ok(JoinView {
        profile_id: status.profile_id,
        peer_device_id: status.issuer_device_id,
        state: if status.state == exomind_beta_host::PeerJoinState::Ready
            && status.remote_ready_observed
        {
            "ready"
        } else {
            "pending"
        },
    })
}
#[tauri::command]
pub(super) async fn beta_peer_sync(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    peer_device_id: DeviceId,
) -> Result<PeerSyncResult, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(HostError::Stopped.into());
    }
    state
        .peers
        .sync_now(profile_id, peer_device_id)
        .await
        .map_err(Failure::from)
}
#[tauri::command]
pub(super) async fn beta_peer_revoke(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    peer_device_id: DeviceId,
    expected_generation: u64,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.revoke_peer_member(
            &state.owner,
            profile_id,
            peer_device_id,
            expected_generation,
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_peer_original_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
) -> Result<PeerOriginalStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.peers.original_status(profile_id, original_id)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_peer_original_auto_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<OriginalAutoDiagnostics, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), |state| {
        let queue = state.peers.original_auto_queue_status()?;
        let policy = state.host.original_auto_policy(&state.owner)?;
        Ok(OriginalAutoDiagnostics {
            network_enabled: queue.network_enabled,
            policy_enabled: policy.enabled,
            max_bytes: policy.max_bytes,
            active_outbound: queue.active_outbound,
            deferred: queue.deferred,
            last_error_code: queue.last_error_code,
        })
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_peer_original_fetch(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    peer_device_id: DeviceId,
    request_id: Uuid,
) -> Result<OriginalTransferResult, Failure> {
    trusted_window(&window, state.inner())?;
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(HostError::Stopped.into());
    }
    state
        .peers
        .fetch_original(profile_id, peer_device_id, original_id, request_id)
        .await
        .map_err(Failure::from)
}
#[tauri::command]
pub(super) async fn beta_peer_original_fetch_any(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    request_id: Uuid,
    on_attempt: tauri::ipc::Channel<SourceAttempt>,
) -> Result<OriginalTransferResult, Failure> {
    trusted_window(&window, state.inner())?;
    let lease = state
        .attachment_jobs
        .begin(request_id, &format!("fetch:{profile_id}:{original_id}"))?;
    let status = state.peers.status(profile_id)?;
    if !status.network_enabled {
        return Err(HostError::PeerNetworkDisabled.into());
    }
    if !state
        .host
        .peer_members(&state.owner, profile_id)?
        .iter()
        .any(|member| {
            member.device_id == status.device_id
                && !member.revoked
                && member.state == exomind_beta_host::PeerJoinState::Ready
                && member.capabilities.read_originals
        })
    {
        return Err(HostError::PeerMembershipDenied.into());
    }
    let mut candidates = status
        .peers
        .into_iter()
        .filter(|peer| peer.member_state == "ready")
        .collect::<Vec<_>>();
    candidates.sort_by_key(|peer| {
        (
            peer.last_error_code.is_some(),
            std::cmp::Reverse(peer.last_sync_at_ms),
            peer.device_id.to_string(),
        )
    });
    if candidates.is_empty() {
        return Err(Failure {
            code: "no_original_source",
            message: "尚无已授权的来源设备，请先连接持有原件的设备",
        });
    }
    let total = candidates.len();
    let mut last = None;
    for (index, peer) in candidates.into_iter().enumerate() {
        lease.check(state.inner())?;
        let _ = on_attempt.send(SourceAttempt {
            index: index + 1,
            total,
            device_id: peer.device_id,
        });
        let result = tokio::select! {biased;
            _=lease.cancelled()=>return Err(HostError::PeerCancelled.into()),
            result=state.peers.fetch_original(profile_id,peer.device_id,original_id,request_id)=>result,
        };
        match result {
            Ok(value) if value.verified => return Ok(value),
            Ok(_) => last = Some(HostError::PeerSyncUnavailable),
            Err(
                error @ (HostError::PeerTransportUnavailable
                | HostError::PeerTimeout
                | HostError::PeerSyncUnavailable
                | HostError::PeerPinMismatch
                | HostError::PeerTls
                | HostError::PeerProtocolMismatch
                | HostError::PeerMembershipDenied
                | HostError::Forbidden
                | HostError::Unauthorized
                | HostError::NotFound
                | HostError::Core(exomind_core::CoreError::OriginalNotReady)),
            ) => last = Some(error),
            Err(error) => return Err(error.into()),
        }
    }
    Err(last.unwrap_or(HostError::NotFound).into())
}
#[derive(Clone, Serialize)]
pub(super) struct SourceAttempt {
    index: usize,
    total: usize,
    device_id: DeviceId,
}

#[tauri::command]
pub(super) async fn beta_peer_original_cancel(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    original_id: OriginalId,
    request_id: Uuid,
) -> Result<bool, Failure> {
    trusted_window(&window, state.inner())?;
    let selection_cancelled = state.attachment_jobs.cancel(request_id)?;
    if state.closing.load(std::sync::atomic::Ordering::Acquire) {
        return Err(HostError::Stopped.into());
    }
    state
        .peers
        .cancel_original_and_wait(profile_id, original_id, request_id)
        .await
        .map(|cancelled| cancelled || selection_cancelled)
        .map_err(Failure::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_claim_is_stable_but_a_new_invitation_is_distinct() {
        let device = DeviceId::new();
        let mut invite = PeerInvitation {
            offer: exomind_beta_host::PeerInvitationOffer {
                invitation_id: Uuid::new_v4(),
                issuer: exomind_beta_host::DeviceIdentityInfo {
                    device_id: DeviceId::new(),
                    spki_der: vec![],
                    fingerprint_sha256: "0".repeat(64),
                },
                profile_id: ProfileId::new(),
                profile_name: "synthetic".into(),
                protocol: PEER_PROTOCOL.into(),
                schema: PEER_CORE_SCHEMA,
                capabilities: exomind_beta_host::PeerCapabilities::FULL,
                candidates: vec!["127.0.0.1:43344".parse().unwrap()],
                expires_at_unix_ms: 1000,
            },
            secret: "0".repeat(64),
            signature: vec![],
        };
        let first = claim(&invite, device);
        assert!(!first.is_nil());
        assert_eq!(first, claim(&invite, device));
        assert_ne!(first, claim(&invite, DeviceId::new()));
        invite.offer.invitation_id = Uuid::new_v4();
        assert_ne!(first, claim(&invite, device));
    }
}
