//! Referenced original bytes over one owned, pinned channel. Metadata delivery
//! is not byte delivery; only a locally sealed hash may produce Verified.
use super::original_admission::OriginalAdmission;
use super::{
    PeerCancellation, PeerChannel,
    authorization::{PeerOperation, PeerProfileScope},
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{
    BeginStageCommand, CoreError, DeviceId, MAX_ORIGINAL_CHUNK_BYTES, OriginalAvailability,
    OriginalId, OriginalRef, ProfileId, StageId, StageState, VerificationProof, VerificationTicket,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

const PROTOCOL: &str = "exomind-peer-original/1";
const MAX_CONTROL_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct OriginalTransferOptions {
    pub session_timeout: Duration,
    pub message_timeout: Duration,
    /// A finite session may stop before completion; the durable stage offset
    /// permits another session to continue without repeating confirmed bytes.
    pub max_chunks: usize,
}
impl Default for OriginalTransferOptions {
    fn default() -> Self {
        Self {
            session_timeout: Duration::from_secs(120),
            message_timeout: Duration::from_secs(10),
            max_chunks: 1024,
        }
    }
}
impl OriginalTransferOptions {
    fn validate(self) -> Result<(), HostError> {
        if self.session_timeout < Duration::from_millis(50)
            || self.session_timeout > Duration::from_secs(3600)
            || self.message_timeout < Duration::from_millis(50)
            || self.message_timeout > Duration::from_secs(30)
            || self.max_chunks == 0
            || self.max_chunks > 65536
        {
            return Err(HostError::InvalidRequest);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct OriginalTransferResult {
    pub original: OriginalRef,
    pub verified: bool,
    pub resumed_from: u64,
    pub transferred_bytes: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Probe {
        protocol: String,
        schema: i64,
        profile_id: ProfileId,
        expected: OriginalRef,
    },
    Probed {
        original: OriginalRef,
        available: bool,
    },
    Start {
        protocol: String,
        schema: i64,
        profile_id: ProfileId,
        expected: OriginalRef,
        offset: u64,
    },
    Ready {
        original: OriginalRef,
        offset: u64,
    },
    Read {
        offset: u64,
        length: usize,
    },
    Data {
        original_id: OriginalId,
        offset: u64,
        length: usize,
        chunk_sha256: String,
    },
    Accepted {
        next_offset: u64,
    },
    Checking,
    Pong,
    Pause {
        next_offset: u64,
    },
    Paused {
        next_offset: u64,
    },
    Verified {
        original_id: OriginalId,
        byte_length: u64,
        sha256: String,
    },
    Confirmed,
    Rejected {
        code: Rejection,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Rejection {
    Denied,
    Missing,
    NotReady,
    Conflict,
    Integrity,
    Unavailable,
    Invalid,
    Incompatible,
}
impl Rejection {
    fn of(error: &HostError) -> Self {
        match error {
            HostError::Unauthorized
            | HostError::Forbidden
            | HostError::PeerMembershipDenied
            | HostError::Core(CoreError::ScopeMismatch | CoreError::OriginalAccessDenied) => {
                Self::Denied
            }
            HostError::Core(
                CoreError::UnknownOriginal | CoreError::UnknownStage | CoreError::UnknownProfile,
            ) => Self::Missing,
            HostError::Core(
                CoreError::OriginalNotReady
                    | CoreError::StageIncomplete
                    | CoreError::OriginalLifecycleRestoreRequired,
            ) => {
                Self::NotReady
            }
            HostError::Core(
                CoreError::OriginalConflict
                | CoreError::StageConflict
                | CoreError::ChunkConflict
                | CoreError::OriginalLifecycleConflict,
            ) => Self::Conflict,
            HostError::Core(
                CoreError::OriginalHashMismatch | CoreError::OriginalIntegrityMismatch,
            ) => Self::Integrity,
            HostError::InvalidRequest
            | HostError::PayloadTooLarge
            | HostError::Core(CoreError::InvalidOriginalOffset) => Self::Invalid,
            HostError::PeerProtocolMismatch => Self::Incompatible,
            _ => Self::Unavailable,
        }
    }
    fn error(self) -> HostError {
        match self {
            Self::Denied => HostError::PeerMembershipDenied,
            Self::Missing => HostError::Core(CoreError::UnknownOriginal),
            Self::NotReady => HostError::Core(CoreError::OriginalNotReady),
            Self::Conflict => HostError::Core(CoreError::OriginalConflict),
            Self::Integrity => HostError::Core(CoreError::OriginalIntegrityMismatch),
            Self::Unavailable => HostError::PeerTransportUnavailable,
            Self::Invalid => HostError::InvalidRequest,
            Self::Incompatible => HostError::PeerProtocolMismatch,
        }
    }
}
/// Tracks only blocking work belonging to one admitted fetch. Dropping its
/// async caller closes admission, but does not pretend running blocking jobs
/// have finished. The callback must not capture Host/Core or a strong owner.
pub(super) struct TransferCompletion {
    state: Mutex<CompletionState>,
    drained: Box<dyn Fn() + Send + Sync>,
    changed: tokio::sync::Notify,
    #[cfg(test)]
    source_hook: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    #[cfg(test)]
    worker_exit_hook: Mutex<Option<(PeerCancellation, PeerCancellation)>>,
}
#[derive(Default)]
struct CompletionState {
    jobs: usize,
    closed: bool,
    notified: bool,
}
pub(super) struct TransferCompletionLease {
    completion: Arc<TransferCompletion>,
}
impl TransferCompletion {
    pub(super) fn track_channel(self: &Arc<Self>, channel: &PeerChannel) -> Result<(), HostError> {
        let guard = self.register()?;
        let closed = channel.closed_notification();
        tokio::spawn(async move {
            let _guard = guard;
            closed.await;
        });
        Ok(())
    }
    pub(super) fn new(drained: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(CompletionState::default()),
            drained: Box::new(drained),
            changed: tokio::sync::Notify::new(),
            #[cfg(test)]
            source_hook: Mutex::new(None),
            #[cfg(test)]
            worker_exit_hook: Mutex::new(None),
        })
    }
    pub(super) fn register(self: &Arc<Self>) -> Result<TransferCompletionLease, HostError> {
        let mut state = self.state.lock().map_err(|_| HostError::StatePoisoned)?;
        if state.closed {
            return Err(HostError::PeerCancelled);
        }
        state.jobs = state.jobs.checked_add(1).ok_or(HostError::PeerBusy)?;
        Ok(TransferCompletionLease {
            completion: self.clone(),
        })
    }
    pub(super) fn close(&self) {
        let notify = {
            let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            state.closed = true;
            Self::notify(&mut state)
        };
        if notify {
            (self.drained)();
            self.changed.notify_waiters();
        }
    }
    pub(super) async fn wait_closed(&self, timeout: Duration) -> Result<(), HostError> {
        tokio::time::timeout(timeout, async {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if {
                    let state = self.state.lock().map_err(|_| HostError::StatePoisoned)?;
                    state.closed && state.jobs == 0
                } {
                    return Ok(());
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| HostError::Shutdown)?
    }
    #[cfg(test)]
    pub(super) fn set_source_hook(&self, hook: impl FnOnce() + Send + 'static) {
        *self.source_hook.lock().unwrap() = Some(Box::new(hook));
    }
    #[cfg(test)]
    pub(super) fn state_for_test(&self) -> (bool, usize) {
        let state = self.state.lock().unwrap();
        (state.closed, state.jobs)
    }
    #[cfg(test)]
    pub(super) fn set_worker_exit_hook(
        &self,
        entered: PeerCancellation,
        release: PeerCancellation,
    ) {
        *self.worker_exit_hook.lock().unwrap() = Some((entered, release));
    }
    #[cfg(test)]
    pub(super) async fn before_worker_exit(&self) {
        let hook = { self.worker_exit_hook.lock().unwrap().take() };
        if let Some((entered, release)) = hook {
            entered.cancel();
            tokio::time::timeout(Duration::from_secs(5), release.cancelled())
                .await
                .expect("owned pre-join barrier release");
        }
    }
    #[cfg(test)]
    fn before_source(&self) {
        let hook = { self.source_hook.lock().unwrap().take() };
        if let Some(hook) = hook {
            hook();
        }
    }
    fn notify(state: &mut CompletionState) -> bool {
        if state.closed && state.jobs == 0 && !state.notified {
            state.notified = true;
            true
        } else {
            false
        }
    }
}
impl Drop for TransferCompletionLease {
    fn drop(&mut self) {
        let notify = {
            let mut state = self
                .completion
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            state.jobs = state
                .jobs
                .checked_sub(1)
                .expect("owned original completion lease");
            TransferCompletion::notify(&mut state)
        };
        if notify {
            (self.completion.drained)();
            self.completion.changed.notify_waiters();
        }
    }
}

struct Io {
    channel: PeerChannel,
    cancel: PeerCancellation,
    end: Instant,
    options: OriginalTransferOptions,
}
impl Drop for Io {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
impl Io {
    fn remaining(&self) -> Result<Duration, HostError> {
        if self.cancel.is_cancelled() {
            return Err(HostError::PeerCancelled);
        }
        let left = self.end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(HostError::PeerTimeout);
        }
        Ok(left.min(self.options.message_timeout))
    }
    async fn send(&mut self, control: &Control) -> Result<(), HostError> {
        let bytes = serde_json::to_vec(control).map_err(|_| HostError::InvalidRequest)?;
        if bytes.len() > MAX_CONTROL_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        self.send_bytes(bytes).await
    }
    async fn send_bytes(&mut self, bytes: Vec<u8>) -> Result<(), HostError> {
        let timeout = self.remaining()?;
        tokio::select! {biased;_=self.cancel.cancelled()=>Err(HostError::PeerCancelled),result=tokio::time::timeout(timeout,self.channel.send_frame(bytes))=>result.map_err(|_|HostError::PeerTimeout)?}
    }
    async fn raw(&mut self) -> Result<Vec<u8>, HostError> {
        let timeout = self.remaining()?;
        tokio::select! {biased;_=self.cancel.cancelled()=>Err(HostError::PeerCancelled),result=tokio::time::timeout(timeout,self.channel.read_frame())=>result.map_err(|_|HostError::PeerTimeout)?}
    }
    async fn read(&mut self) -> Result<Control, HostError> {
        let bytes = self.raw().await?;
        if bytes.len() > MAX_CONTROL_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        let value: Control = decode(&bytes)?;
        if let Control::Rejected { code } = value {
            return Err(code.error());
        }
        Ok(value)
    }
}
fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, HostError> {
    serde_json::from_slice(bytes).map_err(|_| HostError::InvalidRequest)
}
struct CancelOnDrop(PeerCancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
struct Prepared {
    original: OriginalRef,
    stage: StageId,
    offset: u64,
    existing: bool,
    admission: Arc<OriginalAdmission>,
    cancelled: PeerCancellation,
}
fn stage_id(device: DeviceId, profile: ProfileId, original: OriginalId) -> StageId {
    let digest = Sha256::digest(
        format!("exomind-peer-materialization/1\0{device}\0{profile}\0{original}").as_bytes(),
    );
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
        .to_string()
        .parse()
        .expect("non-nil domain UUID")
}
impl BetaHost {
    fn prepare_original(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        original: OriginalId,
        admission: Arc<OriginalAdmission>,
        cancelled: PeerCancellation,
    ) -> Result<Prepared, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::MaterializeOriginals,
            |resources, member| {
                admission.validate(
                    self,
                    resources,
                    member.profile_id,
                    original,
                    Some(&cancelled),
                )?;
                let core = &resources.core;
                let human = core.local_human(member.profile_id)?;
                let availability =
                    core.original_availability(&human, member.profile_id, original)?;
                let description = match &availability {
                    OriginalAvailability::Missing { original } => original,
                    OriginalAvailability::Local { stage } => &stage.original,
                };
                if description != admission.original() {
                    return Err(HostError::Core(CoreError::OriginalConflict));
                }
                let status = match availability {
                    OriginalAvailability::Local { stage } => stage,
                    OriginalAvailability::Missing { original } => core.begin_stage(
                        &human,
                        &BeginStageCommand {
                            stage_id: stage_id(
                                self.device_id,
                                member.profile_id,
                                original.original_id,
                            ),
                            original_id: original.original_id,
                            profile_id: member.profile_id,
                            expected_sha256: original.sha256.clone(),
                            byte_length: original.byte_length,
                            file_name: original.file_name.clone(),
                            media_type: original.media_type.clone(),
                        },
                    )?,
                };
                if status.state == StageState::HashMismatch {
                    return Err(HostError::Core(CoreError::OriginalHashMismatch));
                }
                let existing = status.state == StageState::Verified;
                if status.original != *admission.original() {
                    return Err(HostError::Core(CoreError::OriginalConflict));
                }
                if status.next_offset > status.original.byte_length
                    || (existing && status.next_offset != status.original.byte_length)
                {
                    return Err(HostError::Core(CoreError::RecoveryRequired));
                }
                if !existing {
                    core.stage_status(&human, status.stage_id)?;
                }
                Ok(Prepared {
                    original: status.original,
                    stage: status.stage_id,
                    offset: status.next_offset,
                    existing,
                    admission,
                    cancelled,
                })
            },
        )
    }
    fn materialize_write(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        prepared: &Prepared,
        offset: u64,
        bytes: &[u8],
    ) -> Result<u64, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::MaterializeOriginals,
            |resources, member| {
                prepared.admission.validate(
                    self,
                    resources,
                    member.profile_id,
                    prepared.original.original_id,
                    Some(&prepared.cancelled),
                )?;
                let core = &resources.core;
                let human = core.local_human(member.profile_id)?;
                let availability = core.original_availability(
                    &human,
                    member.profile_id,
                    prepared.original.original_id,
                )?;
                let OriginalAvailability::Local { stage } = availability else {
                    return Err(HostError::Core(CoreError::OriginalNotReady));
                };
                if stage.stage_id != prepared.stage || stage.original != prepared.original {
                    return Err(HostError::Core(CoreError::OriginalConflict));
                }
                Ok(core
                    .write_stage_chunk(&human, prepared.stage, offset, bytes)?
                    .next_offset)
            },
        )
    }
    fn freeze_original(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        prepared: &Prepared,
    ) -> Result<VerificationTicket, HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::MaterializeOriginals,
            |resources, member| {
                prepared.admission.validate(
                    self,
                    resources,
                    member.profile_id,
                    prepared.original.original_id,
                    Some(&prepared.cancelled),
                )?;
                let core = &resources.core;
                let human = core.local_human(member.profile_id)?;
                if prepared.existing {
                    Ok(core.verified_original_ticket(
                        &human,
                        member.profile_id,
                        prepared.original.original_id,
                    )?)
                } else {
                    Ok(core.freeze_stage(&human, prepared.stage)?)
                }
            },
        )
    }
    fn seal_original(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        prepared: &Prepared,
        proof: &VerificationProof,
    ) -> Result<(), HostError> {
        self.with_peer_resources(
            channel,
            scope,
            PeerOperation::MaterializeOriginals,
            |resources, member| {
                prepared.admission.validate(
                    self,
                    resources,
                    member.profile_id,
                    prepared.original.original_id,
                    Some(&prepared.cancelled),
                )?;
                let core = &resources.core;
                let human = core.local_human(member.profile_id)?;
                if prepared.existing {
                    let actual =
                        core.confirm_verified_original(&human, member.profile_id, proof)?;
                    if actual != prepared.original {
                        return Err(HostError::Core(CoreError::OriginalConflict));
                    }
                } else {
                    let stage = core.finish_stage(&human, proof)?;
                    if stage.original != prepared.original || stage.state != StageState::Verified {
                        return Err(HostError::Core(CoreError::OriginalNotReady));
                    }
                }
                Ok(())
            },
        )
    }
    fn original_description(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        original: OriginalId,
    ) -> Result<OriginalRef, HostError> {
        self.with_peer_scope(
            channel,
            scope,
            PeerOperation::ReadOriginals,
            |core, member| {
                let reader = core.local_human(member.profile_id)?;
                Ok(
                    match core.original_availability(&reader, member.profile_id, original)? {
                        OriginalAvailability::Missing { original } => original,
                        OriginalAvailability::Local { stage } => stage.original,
                    },
                )
            },
        )
    }
    fn peer_original_bytes_available(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        profile: ProfileId,
        original: OriginalId,
    ) -> Result<bool, HostError> {
        self.with_peer_scope(
            channel,
            scope,
            PeerOperation::ReadOriginals,
            |core, member| {
                if member.profile_id != profile {
                    return Err(HostError::PeerMembershipDenied);
                }
                let human = core.local_human(profile)?;
                let lifecycle =
                    core.original_lifecycle_status(&human, profile, original)?;
                if !matches!(
                    lifecycle.bytes_state,
                    exomind_core::OriginalBytesState::Available
                        | exomind_core::OriginalBytesState::Reclaimed
                ) {
                    return Ok(false);
                }
                Ok(matches!(
                    core.original_availability(&human, profile, original)?,
                    OriginalAvailability::Local { stage }
                        if stage.state == StageState::Verified
                            && stage.next_offset == stage.original.byte_length
                ))
            },
        )
    }
    pub async fn download_peer_original_over_transport(
        self: &Arc<Self>,
        owner: &Session,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        channel: PeerChannel,
        options: OriginalTransferOptions,
    ) -> Result<OriginalTransferResult, HostError> {
        self.download_peer_original_owned(
            owner, profile, peer, original, channel, options, None, None,
        )
        .await
    }
    pub(super) async fn probe_peer_original_over_transport(
        self: &Arc<Self>,
        owner: &Session,
        profile: ProfileId,
        peer: DeviceId,
        expected: OriginalRef,
        channel: PeerChannel,
        options: OriginalTransferOptions,
        cancelled: PeerCancellation,
    ) -> Result<bool, HostError> {
        options.validate()?;
        self.qualify_transport(owner)?;
        channel.binding_pin(self)?;
        let lease = self.peers.register(false)?;
        let host = self.clone();
        let runtime = tokio::runtime::Handle::current();
        let global_cancel = self.peers.cancel.clone();
        let cancel = PeerCancellation::new();
        let _cancel = CancelOnDrop(cancel.clone());
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            runtime.block_on(async move {
                let mut io = Io {
                    channel,
                    cancel,
                    end: Instant::now() + options.session_timeout,
                    options,
                };
                let scope = host.peer_profile_scope(&io.channel, profile, peer)?;
                let probe = async {
                    io.send(&Control::Probe {
                        protocol: PROTOCOL.into(),
                        schema: exomind_core::CORE_SCHEMA_VERSION,
                        profile_id: profile,
                        expected: expected.clone(),
                    })
                    .await?;
                    match io.read().await? {
                        Control::Probed { original, available } if original == expected => {
                            Ok(available)
                        }
                        Control::Probed { .. } => Err(HostError::Core(CoreError::OriginalConflict)),
                        _ => Err(HostError::InvalidRequest),
                    }
                };
                tokio::select! {
                    biased;
                    _ = cancelled.cancelled() => Err(HostError::PeerCancelled),
                    _ = global_cancel.cancelled() => Err(HostError::Stopped),
                    result = probe => result,
                }
            })
        })
        .await
        .map_err(|_| HostError::StatePoisoned)?
    }
    pub(super) async fn download_peer_original_owned(
        self: &Arc<Self>,
        owner: &Session,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        channel: PeerChannel,
        options: OriginalTransferOptions,
        completion: Option<Arc<TransferCompletion>>,
        admission: Option<Arc<OriginalAdmission>>,
    ) -> Result<OriginalTransferResult, HostError> {
        options.validate()?;
        self.qualify_transport(owner)?;
        channel.binding_pin(self)?;
        let lease = self.peers.register(false)?;
        let host = self.clone();
        let runtime = tokio::runtime::Handle::current();
        let cancel = PeerCancellation::new();
        let _cancel = CancelOnDrop(cancel.clone());
        let admission = match admission {
            Some(ticket) => ticket,
            None => OriginalAdmission::direct(self, owner, profile, original, cancel.clone())?,
        };
        let completion_lease = completion
            .as_ref()
            .map(|work| work.register())
            .transpose()?;
        tokio::task::spawn_blocking(move || {
            let _completion_lease = completion_lease;
            let _lease = lease;
            runtime.block_on(async move {
                let mut io = Io {
                    channel,
                    cancel,
                    end: Instant::now() + options.session_timeout,
                    options,
                };
                let scope = host.peer_profile_scope(&io.channel, profile, peer)?;
                let result = download_with_completion(
                    &host,
                    &mut io,
                    &scope,
                    profile,
                    original,
                    completion.as_ref(),
                    &admission,
                )
                .await;
                let state = host.active_state()?;
                let resources = crate::resources(&state)?;
                admission.validate_result(&host, resources, &result, Some(&io.cancel))?;
                result
            })
        })
        .await
        .map_err(|_| HostError::StatePoisoned)?
    }
    pub(super) async fn serve_peer_original_over_transport(
        self: &Arc<Self>,
        channel: PeerChannel,
        scope: PeerProfileScope,
        options: OriginalTransferOptions,
    ) -> Result<OriginalTransferResult, HostError> {
        self.serve_peer_original_owned(channel, scope, options, None)
            .await
    }
    pub(super) async fn serve_peer_original_owned(
        self: &Arc<Self>,
        channel: PeerChannel,
        scope: PeerProfileScope,
        options: OriginalTransferOptions,
        completion: Option<Arc<TransferCompletion>>,
    ) -> Result<OriginalTransferResult, HostError> {
        options.validate()?;
        channel.binding_pin(self)?;
        let lease = self.peers.register(false)?;
        let host = self.clone();
        let runtime = tokio::runtime::Handle::current();
        let cancel = PeerCancellation::new();
        let _cancel = CancelOnDrop(cancel.clone());
        let completion_lease = completion
            .as_ref()
            .map(|work| work.register())
            .transpose()?;
        tokio::task::spawn_blocking(move || {
            let _completion_lease = completion_lease;
            let _lease = lease;
            #[cfg(test)]
            if let Some(completion) = &completion {
                completion.before_source();
            }
            runtime.block_on(async move {
                let mut io = Io {
                    channel,
                    cancel,
                    end: Instant::now() + options.session_timeout,
                    options,
                };
                let result = serve(&host, &mut io, &scope).await;
                if let Err(error) = &result {
                    let _ = io
                        .send(&Control::Rejected {
                            code: Rejection::of(error),
                        })
                        .await;
                }
                result
            })
        })
        .await
        .map_err(|_| HostError::StatePoisoned)?
    }
}
async fn verify(
    host: &Arc<BetaHost>,
    io: &mut Io,
    ticket: VerificationTicket,
    completion: Option<&Arc<TransferCompletion>>,
) -> Result<VerificationProof, HostError> {
    let lease = host.peers.register(false)?;
    let global = host.peers.cancel.clone();
    let cancel = io.cancel.clone();
    let completion_lease = completion.map(|work| work.register()).transpose()?;
    let mut job = tokio::task::spawn_blocking(move || {
        let _completion_lease = completion_lease;
        let _lease = lease;
        ticket.verify(|| global.is_cancelled() || cancel.is_cancelled())
    });
    let heartbeat = (io.options.message_timeout / 2).min(Duration::from_millis(500));
    loop {
        let remaining = io.remaining()?;
        tokio::select! {biased;
            _=io.cancel.cancelled()=>return Err(HostError::PeerCancelled),
            _=host.peers.cancel.cancelled()=>return Err(HostError::Stopped),
            result=&mut job=>return result.map_err(|_|HostError::StatePoisoned)?.map_err(HostError::Core),
            _=tokio::time::sleep(heartbeat.min(remaining))=>{
                io.send(&Control::Checking).await?;if !matches!(io.read().await?,Control::Pong){return Err(HostError::InvalidRequest);}
            }
        }
    }
}
async fn download_with_completion(
    host: &Arc<BetaHost>,
    io: &mut Io,
    scope: &PeerProfileScope,
    profile: ProfileId,
    original: OriginalId,
    completion: Option<&Arc<TransferCompletion>>,
    admission: &Arc<OriginalAdmission>,
) -> Result<OriginalTransferResult, HostError> {
    let prepared = host.prepare_original(
        &io.channel,
        scope,
        original,
        admission.clone(),
        io.cancel.clone(),
    )?;
    io.send(&Control::Start {
        protocol: PROTOCOL.into(),
        schema: exomind_core::CORE_SCHEMA_VERSION,
        profile_id: profile,
        expected: prepared.original.clone(),
        offset: prepared.offset,
    })
    .await?;
    match io.read().await? {
        Control::Ready { original, offset }
            if original == prepared.original && offset == prepared.offset => {}
        _ => return Err(HostError::InvalidRequest),
    }
    let mut offset = prepared.offset;
    let mut chunks = 0;
    while offset < prepared.original.byte_length {
        if chunks >= io.options.max_chunks {
            io.send(&Control::Pause {
                next_offset: offset,
            })
            .await?;
            if !matches!(io.read().await?,Control::Paused{next_offset}if next_offset==offset) {
                return Err(HostError::InvalidRequest);
            }
            return Ok(OriginalTransferResult {
                original: prepared.original,
                verified: false,
                resumed_from: prepared.offset,
                transferred_bytes: offset - prepared.offset,
            });
        }
        let length =
            (prepared.original.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
        io.send(&Control::Read { offset, length }).await?;
        let checksum = match io.read().await? {
            Control::Data {
                original_id,
                offset: at,
                length: count,
                chunk_sha256,
            } if original_id == original && at == offset && count == length => chunk_sha256,
            Control::Paused { next_offset } if next_offset == offset => {
                return Ok(OriginalTransferResult {
                    original: prepared.original,
                    verified: false,
                    resumed_from: prepared.offset,
                    transferred_bytes: offset - prepared.offset,
                });
            }
            _ => return Err(HostError::InvalidRequest),
        };
        let bytes = io.raw().await?;
        if bytes.len() != length || format!("{:x}", Sha256::digest(&bytes)) != checksum {
            return Err(HostError::Core(CoreError::OriginalIntegrityMismatch));
        }
        let next = host.materialize_write(&io.channel, scope, &prepared, offset, &bytes)?;
        if next != offset + length as u64 {
            return Err(HostError::Core(CoreError::ChunkConflict));
        }
        io.send(&Control::Accepted { next_offset: next }).await?;
        offset = next;
        chunks += 1;
    }
    let ticket = host.freeze_original(&io.channel, scope, &prepared)?;
    let proof = verify(host, io, ticket, completion).await?;
    host.seal_original(&io.channel, scope, &prepared, &proof)?;
    io.send(&Control::Verified {
        original_id: original,
        byte_length: prepared.original.byte_length,
        sha256: prepared.original.sha256.clone(),
    })
    .await?;
    if !matches!(io.read().await?, Control::Confirmed) {
        return Err(HostError::InvalidRequest);
    }
    Ok(OriginalTransferResult {
        original: prepared.original,
        verified: true,
        resumed_from: prepared.offset,
        transferred_bytes: offset - prepared.offset,
    })
}
async fn serve(
    host: &BetaHost,
    io: &mut Io,
    scope: &PeerProfileScope,
) -> Result<OriginalTransferResult, HostError> {
    let first = io.read().await?;
    let first = match first {
        Control::Probe {
            protocol,
            schema,
            profile_id,
            expected,
        } => {
            if protocol != PROTOCOL || schema != exomind_core::CORE_SCHEMA_VERSION {
                return Err(HostError::PeerProtocolMismatch);
            }
            let original =
                host.original_description(&io.channel, scope, expected.original_id)?;
            if original != expected {
                return Err(HostError::Core(CoreError::OriginalConflict));
            }
            host.with_peer_scope(
                &io.channel,
                scope,
                PeerOperation::ReadOriginals,
                |_, member| {
                    if member.profile_id != profile_id {
                        return Err(HostError::PeerMembershipDenied);
                    }
                    Ok(())
                },
            )?;
            let available = host.peer_original_bytes_available(
                &io.channel,
                scope,
                profile_id,
                original.original_id,
            )?;
            io.send(&Control::Probed {
                original: original.clone(),
                available,
            })
            .await?;
            return Ok(OriginalTransferResult {
                original,
                verified: available,
                resumed_from: 0,
                transferred_bytes: 0,
            });
        }
        value => value,
    };
    let (profile, expected, start) = match first {
        Control::Start {
            protocol,
            schema,
            profile_id,
            expected,
            offset,
        } => {
            if protocol != PROTOCOL || schema != exomind_core::CORE_SCHEMA_VERSION {
                return Err(HostError::PeerProtocolMismatch);
            }
            (profile_id, expected, offset)
        }
        _ => return Err(HostError::InvalidRequest),
    };
    let original = host.original_description(&io.channel, scope, expected.original_id)?;
    if original != expected || start > original.byte_length {
        return Err(HostError::Core(CoreError::OriginalConflict));
    }
    // Read callbacks use member.profile_id, and this explicit match prevents a
    // valid P scope from accepting a misleading Q control header.
    host.with_peer_scope(
        &io.channel,
        scope,
        PeerOperation::ReadOriginals,
        |_, member| {
            if member.profile_id != profile {
                return Err(HostError::PeerMembershipDenied);
            }
            Ok(())
        },
    )?;
    io.send(&Control::Ready {
        original: original.clone(),
        offset: start,
    })
    .await?;
    let mut offset = start;
    let mut chunks = 0;
    loop {
        match io.read().await? {
            Control::Read { offset: at, length } => {
                if at != offset
                    || length == 0
                    || length > MAX_ORIGINAL_CHUNK_BYTES
                    || length as u64 > original.byte_length - offset
                {
                    return Err(HostError::Core(CoreError::InvalidOriginalOffset));
                }
                if chunks >= io.options.max_chunks {
                    io.send(&Control::Paused {
                        next_offset: offset,
                    })
                    .await?;
                    return Ok(OriginalTransferResult {
                        original,
                        verified: false,
                        resumed_from: start,
                        transferred_bytes: offset - start,
                    });
                }
                let chunk = host.peer_original_range(
                    &io.channel,
                    scope,
                    original.original_id,
                    offset,
                    length,
                )?;
                if chunk.original != original
                    || chunk.offset != offset
                    || chunk.bytes.len() != length
                {
                    return Err(HostError::Core(CoreError::OriginalIntegrityMismatch));
                }
                io.send(&Control::Data {
                    original_id: original.original_id,
                    offset,
                    length,
                    chunk_sha256: format!("{:x}", Sha256::digest(&chunk.bytes)),
                })
                .await?;
                io.send_bytes(chunk.bytes).await?;
                match io.read().await? {
                    Control::Accepted { next_offset } if next_offset == offset + length as u64 => {
                        offset = next_offset
                    }
                    _ => return Err(HostError::InvalidRequest),
                }
                chunks += 1;
            }
            Control::Checking if offset == original.byte_length => {
                host.original_description(&io.channel, scope, original.original_id)?;
                io.send(&Control::Pong).await?;
            }
            Control::Pause { next_offset } if next_offset == offset => {
                io.send(&Control::Paused {
                    next_offset: offset,
                })
                .await?;
                return Ok(OriginalTransferResult {
                    original,
                    verified: false,
                    resumed_from: start,
                    transferred_bytes: offset - start,
                });
            }
            Control::Verified {
                original_id,
                byte_length,
                sha256,
            } if offset == original.byte_length
                && original_id == original.original_id
                && byte_length == original.byte_length
                && sha256 == original.sha256 =>
            {
                host.original_description(&io.channel, scope, original.original_id)?;
                io.send(&Control::Confirmed).await?;
                return Ok(OriginalTransferResult {
                    original,
                    verified: true,
                    resumed_from: start,
                    transferred_bytes: offset - start,
                });
            }
            _ => return Err(HostError::InvalidRequest),
        }
    }
}

#[cfg(test)]
#[path = "original_transfer_tests.rs"]
mod tests;
