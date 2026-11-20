//! Native-only management for per-profile external Agent grants.
//!
//! The renderer receives grant metadata and opaque handles only. Raw bearer
//! tokens remain in the bounded application-memory vault until Native copies
//! them to the OS clipboard or the material is explicitly released.

use super::{trusted_window, Failure, NativeState};
use exomind_beta_host::{GrantKind, GrantMetadata, GrantRequest, HostError};
use exomind_core::{AgentId, CoreError, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    str,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

const MAX_VAULT_ENTRIES: usize = 8;
const MAX_TOKEN_BYTES: usize = 4 * 1024;
const MAX_VAULT_BYTES: usize = MAX_VAULT_ENTRIES * MAX_TOKEN_BYTES;

/// Stable Native create input. `grant_id` is supplied once by the caller and
/// must be reused to recover an uncertain IPC acknowledgement.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GrantIssueCommand {
    pub grant_id: Uuid,
    pub profile_id: ProfileId,
    pub kind: GrantKind,
    pub agent_id: Option<AgentId>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GrantIssuance {
    Created,
    Existing,
    Recovered,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum GrantCredentialState {
    Available,
    Copied,
    Unavailable,
}

/// Safe response from create/recovery. It intentionally has no token field.
#[derive(Debug, Clone, Serialize)]
pub(super) struct GrantIssueResult {
    pub grant: GrantMetadata,
    pub issuance: GrantIssuance,
    pub credential_handle: Option<Uuid>,
    pub credential_state: GrantCredentialState,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GrantRevokeCompletion {
    Confirmed,
    RevokedCleanupUnconfirmed,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct GrantRevokeResult {
    pub grant: GrantMetadata,
    pub credential_material_released: bool,
    pub completion: GrantRevokeCompletion,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub(super) struct GrantCredentialCopyResult {
    pub credential_handle: Uuid,
    pub credential_state: GrantCredentialState,
    pub material_retained: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub(super) struct GrantCredentialReleaseResult {
    pub material_released: bool,
    pub credential_state: GrantCredentialState,
}

#[derive(Serialize)]
struct AgentAccessHandoff<'a> {
    protocol: &'static str,
    api_base_url: &'a str,
    api: HandoffApi,
    device: HandoffDevice<'a>,
    profile: HandoffProfile<'a>,
    grant: HandoffGrant,
    credential: HandoffCredential<'a>,
    network: HandoffNetwork,
}

#[derive(Serialize)]
struct HandoffApi {
    hello: &'static str,
    access_check: &'static str,
    authorization_header: &'static str,
}

#[derive(Serialize)]
struct HandoffDevice<'a> {
    device_id: &'a str,
}

#[derive(Serialize)]
struct HandoffProfile<'a> {
    profile_id: &'a str,
    display_name: &'a str,
}

#[derive(Serialize)]
struct HandoffGrant {
    grant_id: Uuid,
    kind: GrantKind,
    agent_id: Option<AgentId>,
}

#[derive(Serialize)]
struct HandoffCredential<'a> {
    scheme: &'static str,
    token: &'a str,
}

#[derive(Serialize)]
struct HandoffNetwork {
    listener_scope: &'static str,
    remote_clients_reachable: bool,
}

fn agent_access_handoff_json(
    metadata: &GrantMetadata,
    profile_name: &str,
    device_id: &str,
    api_base_url: &str,
    token: &str,
) -> Result<String, ()> {
    let profile_id = metadata.profile_id.to_string();
    let payload = AgentAccessHandoff {
        protocol: "exomind-beta/1",
        api_base_url,
        api: HandoffApi {
            hello: "GET /hello",
            access_check: "POST /profiles/{profile_id}/access/check",
            authorization_header: "Authorization: Bearer <credential.token>",
        },
        device: HandoffDevice { device_id },
        profile: HandoffProfile {
            profile_id: &profile_id,
            display_name: profile_name,
        },
        grant: HandoffGrant {
            grant_id: metadata.grant_id,
            kind: metadata.kind,
            agent_id: metadata.agent_id,
        },
        credential: HandoffCredential {
            scheme: "Bearer",
            token,
        },
        network: HandoffNetwork {
            listener_scope: "loopback_only",
            remote_clients_reachable: false,
        },
    };
    serde_json::to_string_pretty(&payload).map_err(|_| ())
}

#[derive(Clone, PartialEq, Eq)]
struct GrantIntent {
    grant_id: Uuid,
    profile_id: ProfileId,
    kind: GrantKind,
    agent_id: Option<AgentId>,
}

impl GrantIntent {
    fn from_command(command: &GrantIssueCommand) -> Self {
        Self {
            grant_id: command.grant_id,
            profile_id: command.profile_id,
            kind: command.kind,
            agent_id: command.agent_id,
        }
    }

    fn matches(&self, metadata: &GrantMetadata) -> bool {
        self.grant_id == metadata.grant_id
            && self.profile_id == metadata.profile_id
            && self.kind == metadata.kind
            && self.agent_id == metadata.agent_id
    }
}

#[derive(Clone, Copy)]
enum ReservationState {
    InFlight,
    Uncertain,
}

struct Reservation {
    intent: GrantIntent,
    handle: Uuid,
    state: ReservationState,
}

struct VaultEntry {
    intent: GrantIntent,
    metadata: GrantMetadata,
    handle: Uuid,
    material: exomind_beta_host::GrantCredential,
    copied: bool,
}

impl VaultEntry {
    fn issue_result(&self, issuance: GrantIssuance) -> GrantIssueResult {
        GrantIssueResult {
            grant: self.metadata.clone(),
            issuance,
            credential_handle: Some(self.handle),
            credential_state: if self.copied {
                GrantCredentialState::Copied
            } else {
                GrantCredentialState::Available
            },
        }
    }
}

#[derive(Default)]
struct VaultState {
    entries: HashMap<Uuid, VaultEntry>,
    reservations: HashMap<Uuid, Reservation>,
}

impl VaultState {
    fn reserved_bytes(&self) -> usize {
        self.entries
            .values()
            .map(|entry| entry.material.as_bytes().len())
            .sum::<usize>()
            .saturating_add(self.reservations.len().saturating_mul(MAX_TOKEN_BYTES))
    }

    fn slots_used(&self) -> usize {
        self.entries.len().saturating_add(self.reservations.len())
    }
}

/// Application-lifetime storage for one-time grant copy material.
///
/// Every issuance reserves bounded capacity before Host writes a grant. This
/// avoids successfully creating a grant and then silently losing its token to
/// a full vault. The operation mutex serializes Native grant mutations and
/// clipboard writes; it does not serialize external HTTP grant requests.
#[derive(Default)]
pub(super) struct GrantCredentialVault {
    operations: Mutex<()>,
    state: Mutex<VaultState>,
}

#[derive(Debug, PartialEq, Eq)]
enum BeginIssue {
    Started,
    Existing,
    InFlight,
    Uncertain,
}

enum VaultLookup {
    Credential(GrantIssueResult),
    InFlight,
    Uncertain(GrantIntent),
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VaultError {
    Capacity,
    RequestConflict,
    HandleUnavailable,
    InvalidMaterial,
    CopyFailed,
    Poisoned,
    ReservationMissing,
}

impl GrantCredentialVault {
    fn lock_operations(&self) -> Result<MutexGuard<'_, ()>, VaultError> {
        self.operations.lock().map_err(|_| VaultError::Poisoned)
    }

    fn begin_issue(&self, intent: GrantIntent) -> Result<BeginIssue, VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        if let Some(entry) = state.entries.get(&intent.grant_id) {
            if entry.intent != intent {
                return Err(VaultError::RequestConflict);
            }
            return Ok(BeginIssue::Existing);
        }
        if let Some(reservation) = state.reservations.get(&intent.grant_id) {
            if reservation.intent != intent {
                return Err(VaultError::RequestConflict);
            }
            return Ok(match reservation.state {
                ReservationState::InFlight => BeginIssue::InFlight,
                ReservationState::Uncertain => BeginIssue::Uncertain,
            });
        }

        let reserved_bytes = state
            .reserved_bytes()
            .checked_add(MAX_TOKEN_BYTES)
            .ok_or(VaultError::Capacity)?;
        if state.slots_used() >= MAX_VAULT_ENTRIES || reserved_bytes > MAX_VAULT_BYTES {
            return Err(VaultError::Capacity);
        }
        let mut handle = Uuid::new_v4();
        while state.entries.values().any(|entry| entry.handle == handle)
            || state
                .reservations
                .values()
                .any(|reservation| reservation.handle == handle)
        {
            handle = Uuid::new_v4();
        }
        state.reservations.insert(
            intent.grant_id,
            Reservation {
                intent,
                handle,
                state: ReservationState::InFlight,
            },
        );
        Ok(BeginIssue::Started)
    }

    fn finish_with_material(
        &self,
        intent: &GrantIntent,
        metadata: GrantMetadata,
        credential: exomind_beta_host::GrantCredential,
    ) -> Result<Option<Uuid>, VaultError> {
        let bytes = credential.as_bytes();
        if bytes.len() > MAX_TOKEN_BYTES
            || bytes.len() != 64
            || !bytes.iter().all(u8::is_ascii_hexdigit)
        {
            return Err(VaultError::InvalidMaterial);
        }
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let reservation = state
            .reservations
            .remove(&intent.grant_id)
            .ok_or(VaultError::ReservationMissing)?;
        if reservation.intent != *intent || !intent.matches(&metadata) {
            return Err(VaultError::RequestConflict);
        }
        if metadata.revoked {
            return Ok(None);
        }
        let handle = reservation.handle;
        state.entries.insert(
            intent.grant_id,
            VaultEntry {
                intent: intent.clone(),
                metadata,
                handle,
                material: credential,
                copied: false,
            },
        );
        Ok(Some(handle))
    }

    fn finish_without_material(&self, intent: &GrantIntent) -> Result<(), VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        if let Some(reservation) = state.reservations.get(&intent.grant_id) {
            if reservation.intent != *intent {
                return Err(VaultError::RequestConflict);
            }
        }
        state.reservations.remove(&intent.grant_id);
        Ok(())
    }

    fn mark_uncertain(&self, intent: &GrantIntent) -> Result<(), VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let reservation = state
            .reservations
            .get_mut(&intent.grant_id)
            .ok_or(VaultError::ReservationMissing)?;
        if reservation.intent != *intent {
            return Err(VaultError::RequestConflict);
        }
        reservation.state = ReservationState::Uncertain;
        Ok(())
    }

    fn lookup(&self, grant_id: Uuid, profile_id: ProfileId) -> Result<VaultLookup, VaultError> {
        let state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        if let Some(entry) = state.entries.get(&grant_id) {
            if entry.metadata.profile_id != profile_id {
                return Err(VaultError::HandleUnavailable);
            }
            return Ok(VaultLookup::Credential(
                entry.issue_result(GrantIssuance::Recovered),
            ));
        }
        if let Some(reservation) = state.reservations.get(&grant_id) {
            if reservation.intent.profile_id != profile_id {
                return Err(VaultError::HandleUnavailable);
            }
            return Ok(match reservation.state {
                ReservationState::InFlight => VaultLookup::InFlight,
                ReservationState::Uncertain => VaultLookup::Uncertain(reservation.intent.clone()),
            });
        }
        Ok(VaultLookup::None)
    }

    fn copy_with(
        &self,
        profile_id: ProfileId,
        grant_id: Uuid,
        handle: Uuid,
        write: impl FnOnce(&str) -> Result<(), ()>,
    ) -> Result<(), VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let entry = state
            .entries
            .get_mut(&grant_id)
            .filter(|entry| entry.handle == handle && entry.metadata.profile_id == profile_id)
            .ok_or(VaultError::HandleUnavailable)?;
        let text =
            str::from_utf8(entry.material.as_bytes()).map_err(|_| VaultError::InvalidMaterial)?;
        write(text).map_err(|_| VaultError::CopyFailed)?;
        entry.copied = true;
        Ok(())
    }

    #[cfg(test)]
    fn state_for_handle(
        &self,
        profile_id: ProfileId,
        grant_id: Uuid,
        handle: Uuid,
    ) -> Result<GrantCredentialState, VaultError> {
        let state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let entry = state
            .entries
            .get(&grant_id)
            .filter(|entry| entry.handle == handle && entry.metadata.profile_id == profile_id)
            .ok_or(VaultError::HandleUnavailable)?;
        Ok(if entry.copied {
            GrantCredentialState::Copied
        } else {
            GrantCredentialState::Available
        })
    }

    fn release_handle(&self, profile_id: ProfileId, handle: Uuid) -> Result<bool, VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let Some((grant_id, entry)) = state
            .entries
            .iter()
            .find(|(_, entry)| entry.handle == handle)
        else {
            return Ok(false);
        };
        if entry.metadata.profile_id != profile_id {
            return Err(VaultError::HandleUnavailable);
        }
        let grant_id = *grant_id;
        state.entries.remove(&grant_id);
        Ok(true)
    }

    fn release_grant(&self, profile_id: ProfileId, grant_id: Uuid) -> Result<bool, VaultError> {
        let mut state = self.state.lock().map_err(|_| VaultError::Poisoned)?;
        let removed_entry = state
            .entries
            .get(&grant_id)
            .is_some_and(|entry| entry.metadata.profile_id == profile_id);
        if removed_entry {
            state.entries.remove(&grant_id);
        }
        let removed_reservation = state
            .reservations
            .get(&grant_id)
            .is_some_and(|reservation| reservation.intent.profile_id == profile_id);
        if removed_reservation {
            state.reservations.remove(&grant_id);
        }
        Ok(removed_entry || removed_reservation)
    }

    fn clear_locked(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.entries.clear();
        state.reservations.clear();
    }

    /// Clears only process-local copy material. It never contacts Host and
    /// therefore cannot revoke a still-valid grant.
    pub(super) fn clear(&self) {
        let _operations = self
            .operations
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        self.clear_locked();
    }
}

fn validate_issue_command(command: &GrantIssueCommand) -> Result<(), Failure> {
    let requires_agent = match command.kind {
        GrantKind::Human => {
            return Err(failure(
                "human_grant_not_allowed",
                "外部 Agent 授权不能使用 human 角色",
            ));
        }
        GrantKind::Observer => false,
        GrantKind::AgentNote | GrantKind::SummaryProducer => true,
    };
    if command.agent_id.is_some() != requires_agent {
        return Err(failure(
            "invalid_grant_request",
            "agent_note 和 summary_producer 必须绑定 Agent ID；observer 不接收 Agent ID",
        ));
    }
    Ok(())
}

fn result_without_material(grant: GrantMetadata, issuance: GrantIssuance) -> GrantIssueResult {
    GrantIssueResult {
        grant,
        issuance,
        credential_handle: None,
        credential_state: GrantCredentialState::Unavailable,
    }
}

fn issue_grant(
    state: &NativeState,
    command: GrantIssueCommand,
) -> Result<GrantIssueResult, Failure> {
    let intent = GrantIntent::from_command(&command);
    match state
        .grant_credentials
        .begin_issue(intent.clone())
        .map_err(vault_failure)?
    {
        BeginIssue::Existing => return recover_grant(state, command.profile_id, command.grant_id),
        BeginIssue::InFlight => {
            return Err(failure(
                "grant_issue_pending",
                "此 grant ID 的签发仍在处理，请稍后用相同 ID 查证",
            ));
        }
        BeginIssue::Uncertain => return recover_grant(state, command.profile_id, command.grant_id),
        BeginIssue::Started => {}
    }

    let request = GrantRequest {
        profile_id: command.profile_id,
        kind: command.kind,
        agent_id: command.agent_id,
    };
    match state
        .host
        .grant_with_id(&state.owner, command.grant_id, request)
    {
        Ok(Some(issued)) => {
            let metadata = issued.metadata;
            let credential = issued.credential;
            let handle = match state.grant_credentials.finish_with_material(
                &intent,
                metadata.clone(),
                credential,
            ) {
                Ok(handle) => handle,
                Err(_) => {
                    let _ = state.grant_credentials.finish_without_material(&intent);
                    None
                }
            };
            Ok(GrantIssueResult {
                grant: metadata,
                issuance: GrantIssuance::Created,
                credential_handle: handle,
                credential_state: if handle.is_some() {
                    GrantCredentialState::Available
                } else {
                    GrantCredentialState::Unavailable
                },
            })
        }
        Ok(None) => {
            state
                .grant_credentials
                .finish_without_material(&intent)
                .map_err(vault_failure)?;
            let metadata = state
                .host
                .grant_metadata_for_profile_id(&state.owner, command.profile_id, command.grant_id)
                .map_err(Failure::from)?;
            if !intent.matches(&metadata) {
                return Err(failure(
                    "grant_id_conflict",
                    "grant ID 已绑定其他档案或角色，请刷新授权列表",
                ));
            }
            Ok(result_without_material(metadata, GrantIssuance::Existing))
        }
        Err(error) => settle_issue_error(state, &intent, error),
    }
}

fn settle_issue_error(
    state: &NativeState,
    intent: &GrantIntent,
    error: HostError,
) -> Result<GrantIssueResult, Failure> {
    match state
        .host
        .grant_metadata_for_profile_id(&state.owner, intent.profile_id, intent.grant_id)
    {
        Ok(metadata) => {
            state
                .grant_credentials
                .finish_without_material(intent)
                .map_err(vault_failure)?;
            if intent.matches(&metadata) {
                Ok(result_without_material(metadata, GrantIssuance::Existing))
            } else {
                Err(failure(
                    "grant_id_conflict",
                    "grant ID 已绑定其他档案或角色，请刷新授权列表",
                ))
            }
        }
        Err(HostError::NotFound | HostError::Core(CoreError::UnknownProfile)) => {
            state
                .grant_credentials
                .finish_without_material(intent)
                .map_err(vault_failure)?;
            Err(Failure::from(error))
        }
        Err(_) => {
            let _ = state.grant_credentials.mark_uncertain(intent);
            Err(failure(
                "grant_issue_unconfirmed",
                "签发结果暂未确认；请用相同 grant ID 恢复或刷新授权列表，勿自动重新签发",
            ))
        }
    }
}

fn recover_grant(
    state: &NativeState,
    profile_id: ProfileId,
    grant_id: Uuid,
) -> Result<GrantIssueResult, Failure> {
    let lookup = state
        .grant_credentials
        .lookup(grant_id, profile_id)
        .map_err(vault_failure)?;
    match lookup {
        VaultLookup::InFlight => Err(failure(
            "grant_issue_pending",
            "此 grant ID 的签发仍在处理，请稍后用相同 ID 查证",
        )),
        VaultLookup::Credential(mut cached) => {
            let metadata = state
                .host
                .grant_metadata_for_profile_id(&state.owner, profile_id, grant_id)
                .map_err(Failure::from)?;
            if cached.grant.kind != metadata.kind || cached.grant.agent_id != metadata.agent_id {
                let _ = state.grant_credentials.release_grant(profile_id, grant_id);
                return Err(failure(
                    "grant_metadata_changed",
                    "授权记录已变化，凭据材料已释放；请刷新授权列表",
                ));
            }
            if metadata.revoked {
                let _ = state.grant_credentials.release_grant(profile_id, grant_id);
                return Ok(result_without_material(metadata, GrantIssuance::Recovered));
            }
            cached.grant = metadata;
            Ok(cached)
        }
        VaultLookup::Uncertain(intent) => {
            match state
                .host
                .grant_metadata_for_profile_id(&state.owner, profile_id, grant_id)
            {
                Ok(metadata) => {
                    state
                        .grant_credentials
                        .finish_without_material(&intent)
                        .map_err(vault_failure)?;
                    if intent.matches(&metadata) {
                        Ok(result_without_material(metadata, GrantIssuance::Existing))
                    } else {
                        Err(failure(
                            "grant_id_conflict",
                            "grant ID 已绑定其他档案或角色，请刷新授权列表",
                        ))
                    }
                }
                Err(HostError::NotFound | HostError::Core(CoreError::UnknownProfile)) => {
                    state
                        .grant_credentials
                        .finish_without_material(&intent)
                        .map_err(vault_failure)?;
                    Err(Failure::from(HostError::NotFound))
                }
                Err(_) => Err(failure(
                    "grant_recovery_unconfirmed",
                    "授权状态仍未确认；请保留原 grant ID 并稍后重新读取",
                )),
            }
        }
        VaultLookup::None => {
            let metadata = state
                .host
                .grant_metadata_for_profile_id(&state.owner, profile_id, grant_id)
                .map_err(Failure::from)?;
            Ok(result_without_material(metadata, GrantIssuance::Existing))
        }
    }
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure { code, message }
}

fn vault_failure(error: VaultError) -> Failure {
    match error {
        VaultError::Capacity => failure(
            "grant_credential_capacity",
            "本机凭据交接槽已满；请释放已交接材料后再签发",
        ),
        VaultError::RequestConflict => failure(
            "grant_id_conflict",
            "grant ID 已用于不同档案或角色，请刷新授权列表",
        ),
        VaultError::HandleUnavailable => failure(
            "credential_handle_unavailable",
            "凭据句柄不可用或不属于当前档案；刷新授权状态后重试",
        ),
        VaultError::InvalidMaterial => failure(
            "credential_material_unavailable",
            "本机无法安全暂存一次性凭据；授权元数据仍可刷新并显式撤销",
        ),
        VaultError::CopyFailed => failure(
            "grant_clipboard_failed",
            "复制结果未确认；本机接入材料仍保留，可重试复制接入信息",
        ),
        VaultError::Poisoned | VaultError::ReservationMissing => failure(
            "grant_credential_unavailable",
            "本机凭据材料状态未确认；授权元数据仍可读取",
        ),
    }
}

async fn grant_work<T: Send + 'static>(
    state: &Arc<NativeState>,
    action: impl FnOnce(&NativeState) -> Result<T, Failure> + Send + 'static,
) -> Result<T, Failure> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if state.closing.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::from(HostError::Stopped));
        }
        // Recheck after acquiring the shared mutation fence. A request queued
        // before shutdown must not issue a durable grant after vault clearing.
        let _operations = state
            .grant_credentials
            .lock_operations()
            .map_err(vault_failure)?;
        if state.closing.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Failure::from(HostError::Stopped));
        }
        action(&state)
    })
    .await
    .map_err(|_| {
        failure(
            "grant_management_interrupted",
            "授权管理操作被中断，请刷新授权列表",
        )
    })?
}

/// Returns metadata only for the explicitly selected local profile.
#[tauri::command]
pub(super) async fn beta_grant_metadata_list(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
) -> Result<Vec<GrantMetadata>, Failure> {
    trusted_window(&window, state.inner())?;
    grant_work(state.inner(), move |state| {
        state
            .host
            .grant_metadata_for_profile(&state.owner, profile_id)
            .map_err(Failure::from)
    })
    .await
}

/// Creates or recovers one grant by stable ID without returning its token.
#[tauri::command]
pub(super) async fn beta_grant_issue(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: GrantIssueCommand,
) -> Result<GrantIssueResult, Failure> {
    trusted_window(&window, state.inner())?;
    validate_issue_command(&command)?;
    grant_work(state.inner(), move |state| issue_grant(state, command)).await
}

/// Resolves an uncertain create acknowledgement by the same profile and ID.
#[tauri::command]
pub(super) async fn beta_grant_recover(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    grant_id: Uuid,
) -> Result<GrantIssueResult, Failure> {
    trusted_window(&window, state.inner())?;
    grant_work(state.inner(), move |state| {
        recover_grant(state, profile_id, grant_id)
    })
    .await
}

/// Revokes only the selected profile's grant and drops its Native copy material.
#[tauri::command]
pub(super) async fn beta_grant_revoke(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    grant_id: Uuid,
) -> Result<GrantRevokeResult, Failure> {
    trusted_window(&window, state.inner())?;
    grant_work(state.inner(), move |state| {
        match state
            .host
            .revoke_grant_for_profile(&state.owner, profile_id, grant_id)
        {
            Ok(grant) => {
                let (material_released, cleanup_confirmed) =
                    match state.grant_credentials.release_grant(profile_id, grant_id) {
                        Ok(released) => (released, true),
                        Err(_) => (false, false),
                    };
                Ok(GrantRevokeResult {
                    grant,
                    credential_material_released: material_released,
                    completion: if cleanup_confirmed {
                        GrantRevokeCompletion::Confirmed
                    } else {
                        GrantRevokeCompletion::RevokedCleanupUnconfirmed
                    },
                })
            }
            Err(error) => {
                match state
                    .host
                    .grant_metadata_for_profile_id(&state.owner, profile_id, grant_id)
                {
                    Ok(grant) if grant.revoked => {
                        let material_released = state
                            .grant_credentials
                            .release_grant(profile_id, grant_id)
                            .unwrap_or(false);
                        Ok(GrantRevokeResult {
                            grant,
                            credential_material_released: material_released,
                            completion: GrantRevokeCompletion::RevokedCleanupUnconfirmed,
                        })
                    }
                    Ok(_) => Err(Failure::from(error)),
                    Err(_) => Err(failure(
                        "grant_revoke_unconfirmed",
                        "撤销回执未确认；请刷新此档案的授权列表后再操作",
                    )),
                }
            }
        }
    })
    .await
}

/// Copies the selected profile's scoped Agent handoff through Native clipboard support.
///
/// The token is never returned to the renderer. A failed clipboard call keeps
/// the vault entry available for an explicit retry; success retains it until
/// release, revocation, or application shutdown.
#[tauri::command]
pub(super) async fn beta_grant_copy_access_info(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    grant_id: Uuid,
    credential_handle: Uuid,
) -> Result<GrantCredentialCopyResult, Failure> {
    trusted_window(&window, state.inner())?;
    let api_base_url = {
        let server = state.server.lock().await;
        let Some(server) = server.as_ref() else {
            return Err(failure(
                "listener_unavailable",
                "本机 Beta API 尚未就绪；接入信息未复制",
            ));
        };
        let address = server.addr();
        if !address.ip().is_loopback() {
            return Err(failure(
                "listener_unavailable",
                "本机 Beta API 未绑定回环地址；接入信息未复制",
            ));
        }
        format!("http://{address}/beta/v1")
    };
    grant_work(state.inner(), move |state| {
        let host_status = state.host.status().map_err(Failure::from)?;
        if !host_status.running {
            return Err(Failure::from(HostError::Stopped));
        }
        let metadata = state
            .host
            .grant_metadata_for_profile_id(&state.owner, profile_id, grant_id)
            .map_err(Failure::from)?;
        if metadata.revoked {
            let _ = state.grant_credentials.release_grant(profile_id, grant_id);
            return Err(failure("grant_revoked", "此授权已撤销，不能再复制接入信息"));
        }
        let selected_profile = state
            .host
            .profiles(&state.owner)
            .map_err(Failure::from)?
            .into_iter()
            .find(|profile| profile.profile_id == profile_id)
            .ok_or_else(|| failure("invalid_request", "当前档案信息不可用；接入信息未复制"))?;
        let device_id = host_status.device_id.to_string();
        state
            .grant_credentials
            .copy_with(profile_id, grant_id, credential_handle, |text| {
                let handoff = agent_access_handoff_json(
                    &metadata,
                    &selected_profile.display_name,
                    &device_id,
                    &api_base_url,
                    text,
                )
                .map_err(|_| {
                    log::warn!("Beta Agent handoff serialization failed");
                })?;
                app.clipboard().write_text(&handoff).map_err(|error| {
                    // The pinned Windows arboard errors contain static platform
                    // context and OS failure text, never the text being copied.
                    #[cfg(windows)]
                    log::warn!("Beta Agent clipboard write failed: {error}");
                    #[cfg(not(windows))]
                    {
                        let _ = error;
                        log::warn!("Beta Agent clipboard write failed");
                    }
                })
            })
            .map_err(vault_failure)?;
        Ok(GrantCredentialCopyResult {
            credential_handle,
            credential_state: GrantCredentialState::Copied,
            material_retained: true,
        })
    })
    .await
}

/// Releases one Native copy handle without changing the Host grant.
#[tauri::command]
pub(super) async fn beta_grant_release_credential(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    credential_handle: Uuid,
) -> Result<GrantCredentialReleaseResult, Failure> {
    trusted_window(&window, state.inner())?;
    grant_work(state.inner(), move |state| {
        let material_released = state
            .grant_credentials
            .release_handle(profile_id, credential_handle)
            .map_err(vault_failure)?;
        Ok(GrantCredentialReleaseResult {
            material_released,
            credential_state: GrantCredentialState::Unavailable,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use exomind_beta_host::{AgentAccessCheck, AgentCapability, BetaHost};

    fn metadata(intent: &GrantIntent) -> GrantMetadata {
        GrantMetadata {
            grant_id: intent.grant_id,
            profile_id: intent.profile_id,
            kind: intent.kind,
            agent_id: intent.agent_id,
            revoked: false,
        }
    }

    fn intent(profile_id: ProfileId) -> GrantIntent {
        GrantIntent {
            grant_id: Uuid::new_v4(),
            profile_id,
            kind: GrantKind::Observer,
            agent_id: None,
        }
    }

    #[test]
    fn copied_handoff_contains_real_beta_scope_and_keeps_bearer_out_of_ipc_result() {
        let intent = intent(ProfileId::new());
        let grant = metadata(&intent);
        let bearer = "a".repeat(64);
        let json = agent_access_handoff_json(
            &grant,
            "Synthetic profile",
            "synthetic-device-id",
            "http://127.0.0.1:19191/beta/v1",
            &bearer,
        )
        .unwrap();
        let handoff: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(handoff["protocol"], "exomind-beta/1");
        assert_eq!(handoff["api_base_url"], "http://127.0.0.1:19191/beta/v1");
        assert_eq!(handoff["device"]["device_id"], "synthetic-device-id");
        assert_eq!(
            handoff["profile"]["profile_id"],
            intent.profile_id.to_string()
        );
        assert_eq!(handoff["profile"]["display_name"], "Synthetic profile");
        assert_eq!(handoff["grant"]["kind"], "observer");
        assert_eq!(handoff["credential"]["token"], bearer);
        assert_eq!(handoff["network"]["remote_clients_reachable"], false);

        let renderer_result = GrantCredentialCopyResult {
            credential_handle: Uuid::new_v4(),
            credential_state: GrantCredentialState::Copied,
            material_retained: true,
        };
        let renderer_json = serde_json::to_string(&renderer_result).unwrap();
        assert!(!renderer_json.contains(&bearer));
        assert!(renderer_json.contains("credential_handle"));
    }

    #[test]
    fn credential_handles_are_profile_scoped_and_release_does_not_revoke() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        let other_profile = ProfileId::new();
        host.provision_profile(&owner, profile, "Synthetic P")
            .unwrap();
        host.provision_profile(&owner, other_profile, "Synthetic Q")
            .unwrap();
        let vault = GrantCredentialVault::default();
        let grant_id = Uuid::new_v4();
        let issue = host
            .grant_with_id(
                &owner,
                grant_id,
                GrantRequest {
                    profile_id: profile,
                    kind: GrantKind::Observer,
                    agent_id: None,
                },
            )
            .unwrap()
            .unwrap();
        let credential = issue.credential;
        let credential_text = std::str::from_utf8(credential.as_bytes())
            .unwrap()
            .to_owned();
        let authorized = host.authenticate(&credential_text).unwrap();
        let command = GrantIssueCommand {
            grant_id,
            profile_id: profile,
            kind: GrantKind::Observer,
            agent_id: None,
        };
        let intent = GrantIntent::from_command(&command);
        assert!(matches!(
            vault.begin_issue(intent.clone()).unwrap(),
            BeginIssue::Started
        ));
        let handle = vault
            .finish_with_material(&intent, metadata(&intent), credential)
            .unwrap()
            .unwrap();
        let renderer_result = GrantIssueResult {
            grant: metadata(&intent),
            issuance: GrantIssuance::Created,
            credential_handle: Some(handle),
            credential_state: GrantCredentialState::Available,
        };
        let renderer_json = serde_json::to_string(&renderer_result).unwrap();
        assert!(renderer_json.contains(&handle.to_string()));
        assert!(!renderer_json.contains(&credential_text));

        assert_eq!(
            vault.release_handle(other_profile, handle),
            Err(VaultError::HandleUnavailable)
        );
        assert_eq!(
            vault.copy_with(other_profile, grant_id, handle, |_| Ok(())),
            Err(VaultError::HandleUnavailable)
        );
        assert!(vault.release_handle(profile, handle).unwrap());
        assert!(!vault.release_handle(profile, handle).unwrap());
        assert!(host
            .check_agent_access(
                &authorized,
                profile,
                &AgentAccessCheck {
                    required: vec![AgentCapability::EventsRead],
                },
            )
            .is_ok());
        host.revoke_grant_for_profile(&owner, profile, grant_id)
            .unwrap();
        assert!(matches!(
            host.check_agent_access(
                &authorized,
                profile,
                &AgentAccessCheck {
                    required: vec![AgentCapability::EventsRead],
                },
            ),
            Err(HostError::Unauthorized)
        ));
        host.stop().unwrap();
    }

    #[test]
    fn failed_clipboard_copy_keeps_material_for_retry_and_success_is_released_explicitly() {
        let directory = tempfile::tempdir().unwrap();
        let host = BetaHost::open(directory.path()).unwrap();
        let owner = host.owner_session().unwrap();
        let vault = GrantCredentialVault::default();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "Synthetic clipboard retry")
            .unwrap();
        let grant_id = Uuid::new_v4();
        let issue = host
            .grant_with_id(
                &owner,
                grant_id,
                GrantRequest {
                    profile_id: profile,
                    kind: GrantKind::Observer,
                    agent_id: None,
                },
            )
            .unwrap()
            .unwrap();
        let intent = GrantIntent {
            grant_id,
            profile_id: profile,
            kind: GrantKind::Observer,
            agent_id: None,
        };
        assert!(matches!(
            vault.begin_issue(intent.clone()).unwrap(),
            BeginIssue::Started
        ));
        let handle = vault
            .finish_with_material(&intent, metadata(&intent), issue.credential)
            .unwrap()
            .unwrap();

        assert_eq!(
            vault.copy_with(profile, intent.grant_id, handle, |_| Err(())),
            Err(VaultError::CopyFailed)
        );
        assert_eq!(
            vault
                .state_for_handle(profile, intent.grant_id, handle)
                .unwrap(),
            GrantCredentialState::Available
        );
        let endpoint = "http://127.0.0.1:19191/beta/v1";
        let copied = std::cell::RefCell::new(None);
        assert!(vault
            .copy_with(profile, intent.grant_id, handle, |token| {
                let handoff = agent_access_handoff_json(
                    &metadata(&intent),
                    "Synthetic clipboard retry",
                    "synthetic-device",
                    endpoint,
                    token,
                )?;
                *copied.borrow_mut() = Some(handoff);
                Ok(())
            })
            .is_ok());
        let copied = copied.into_inner().unwrap();
        assert!(copied.contains(endpoint));
        assert!(copied.contains("exomind-beta/1"));
        assert_eq!(
            vault
                .state_for_handle(profile, intent.grant_id, handle)
                .unwrap(),
            GrantCredentialState::Copied
        );
        assert!(vault.release_handle(profile, handle).unwrap());
        assert_eq!(
            vault.state_for_handle(profile, intent.grant_id, handle),
            Err(VaultError::HandleUnavailable)
        );
        host.stop().unwrap();
    }

    #[test]
    fn vault_reserves_hard_capacity_before_any_grant_is_issued() {
        let vault = GrantCredentialVault::default();
        let profile = ProfileId::new();
        let _operations = vault.lock_operations().unwrap();
        for _ in 0..MAX_VAULT_ENTRIES {
            assert!(matches!(
                vault.begin_issue(intent(profile)).unwrap(),
                BeginIssue::Started
            ));
        }
        assert_eq!(
            vault.begin_issue(intent(profile)),
            Err(VaultError::Capacity)
        );
        assert_eq!(
            vault.state.lock().unwrap().reserved_bytes(),
            MAX_VAULT_BYTES
        );
    }

    #[test]
    fn issue_dto_rejects_unimplemented_ttl_and_custom_capabilities() {
        let request = serde_json::json!({
            "grant_id": Uuid::new_v4(),
            "profile_id": ProfileId::new(),
            "kind": "observer",
            "agent_id": null,
            "ttl_seconds": 60,
            "capabilities": ["events_read"],
        });
        assert!(serde_json::from_value::<GrantIssueCommand>(request).is_err());
        let human = GrantIssueCommand {
            grant_id: Uuid::new_v4(),
            profile_id: ProfileId::new(),
            kind: GrantKind::Human,
            agent_id: None,
        };
        assert_eq!(
            validate_issue_command(&human).unwrap_err().code,
            "human_grant_not_allowed"
        );
        for (kind, agent_id) in [
            (GrantKind::Observer, None),
            (GrantKind::AgentNote, Some(AgentId::new())),
            (GrantKind::SummaryProducer, Some(AgentId::new())),
        ] {
            assert!(validate_issue_command(&GrantIssueCommand {
                grant_id: Uuid::new_v4(),
                profile_id: ProfileId::new(),
                kind,
                agent_id,
            })
            .is_ok());
        }
    }

    #[test]
    fn uncertain_issue_recovery_never_reissues_a_grant() {
        let directory = tempfile::tempdir().unwrap();
        let state = NativeState::open(&directory.path().join("host"), &directory.path().join("archive"), None).unwrap();
        let profile = ProfileId::new();
        state
            .host
            .provision_profile(&state.owner, profile, "Synthetic uncertain receipt")
            .unwrap();
        let command = GrantIssueCommand {
            grant_id: Uuid::new_v4(),
            profile_id: profile,
            kind: GrantKind::Observer,
            agent_id: None,
        };
        let intent = GrantIntent::from_command(&command);
        assert_eq!(
            state.grant_credentials.begin_issue(intent.clone()).unwrap(),
            BeginIssue::Started
        );
        state.grant_credentials.mark_uncertain(&intent).unwrap();

        assert_eq!(
            recover_grant(&state, profile, command.grant_id)
                .unwrap_err()
                .code,
            "not_found"
        );
        assert!(state
            .host
            .grant_metadata_for_profile(&state.owner, profile)
            .unwrap()
            .is_empty());
        state.host.stop().unwrap();
    }

    #[tokio::test]
    async fn native_shutdown_clears_copy_material_without_revoking_the_grant() {
        let directory = tempfile::tempdir().unwrap();
        let state = NativeState::open(&directory.path().join("host"), &directory.path().join("archive"), None).unwrap();
        let profile = ProfileId::new();
        state
            .host
            .provision_profile(&state.owner, profile, "Synthetic shutdown grant")
            .unwrap();
        let grant_id = Uuid::new_v4();
        let issue = state
            .host
            .grant_with_id(
                &state.owner,
                grant_id,
                GrantRequest {
                    profile_id: profile,
                    kind: GrantKind::Observer,
                    agent_id: None,
                },
            )
            .unwrap()
            .unwrap();
        let credential_text = std::str::from_utf8(issue.credential.as_bytes())
            .unwrap()
            .to_owned();
        let intent = GrantIntent {
            grant_id,
            profile_id: profile,
            kind: GrantKind::Observer,
            agent_id: None,
        };
        assert_eq!(
            state.grant_credentials.begin_issue(intent.clone()).unwrap(),
            BeginIssue::Started
        );
        state
            .grant_credentials
            .finish_with_material(&intent, issue.metadata, issue.credential)
            .unwrap()
            .unwrap();

        state.stop().await.unwrap();
        assert!(matches!(
            state.grant_credentials.lookup(grant_id, profile),
            Ok(VaultLookup::None)
        ));
        drop(state);

        let reopened = BetaHost::open(&directory.path().join("host")).unwrap();
        let authorized = reopened.authenticate(&credential_text).unwrap();
        assert!(reopened
            .check_agent_access(
                &authorized,
                profile,
                &AgentAccessCheck {
                    required: vec![AgentCapability::EventsRead],
                },
            )
            .is_ok());
        reopened.stop().unwrap();
    }
}
