//! A single owned model worker. Network/model work never holds the Core gate;
//! final qualification, failure and publication return through the same gate.
use crate::{
    BetaHost, HostError, Session, context, local_intents, model_config,
    model_provider::{self, ModelCallError},
    resources,
    summary_material::{self, MaterialError, PreparedOriginal},
    summary_material_consent::{self, SummaryMaterialConsent},
};
use exomind_core::{
    EventId, MAX_ORIGINAL_CHUNK_BYTES, OriginalChunk, OriginalId, OriginalReadPermit, ProfileId,
    Receipt, SummaryArtifactPage, SummaryBeginCommand, SummaryControlAction, SummaryControlCommand,
    SummaryExecutorContext, SummaryFailureKind, SummaryInputRecords, SummaryRequestCommand,
    SummaryRunTicket, SummarySelection, SummaryState, SummaryTaskPage, SummaryTaskView,
    SummaryWork,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::sync::watch;
use uuid::Uuid;

const POLL: Duration = Duration::from_millis(500);
const MAX_ATTEMPTS: u32 = 3;
fn ensure_local_intents(
    resources: &mut crate::Resources,
    device: exomind_core::DeviceId,
) -> Result<&mut local_intents::Store, HostError> {
    if resources.local_intents.is_none() {
        let root = resources.persistence.root.clone();
        resources.local_intents = Some(local_intents::Store::open(&root, device)?);
    }
    resources
        .local_intents
        .as_mut()
        .ok_or(HostError::IntentCacheUnavailable)
}

#[derive(Debug, Clone, Serialize)]
pub struct SummaryServiceStatus {
    pub running: bool,
    pub active_profile_id: Option<ProfileId>,
    pub active_task_id: Option<Uuid>,
    pub last_error_code: Option<String>,
}
#[derive(Default)]
struct WorkerState {
    attempted: bool,
    running: bool,
    thread: Option<JoinHandle<()>>,
    active: Option<(ProfileId, Uuid)>,
    error: Option<String>,
}
pub(crate) struct Services {
    cancelled: AtomicBool,
    stop: watch::Sender<bool>,
    state: Mutex<WorkerState>,
    changed: Condvar,
}
impl Default for Services {
    fn default() -> Self {
        let (stop, _) = watch::channel(false);
        Self {
            cancelled: AtomicBool::new(false),
            stop,
            state: Mutex::new(WorkerState::default()),
            changed: Condvar::new(),
        }
    }
}
impl Services {
    fn state(&self) -> std::sync::MutexGuard<'_, WorkerState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn request_stop(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.stop.send_replace(true);
        self.changed.notify_all();
    }
    fn status(&self, accepting: bool) -> SummaryServiceStatus {
        let state = self.state();
        SummaryServiceStatus {
            running: state.running && accepting,
            active_profile_id: state.active.map(|v| v.0),
            active_task_id: state.active.map(|v| v.1),
            last_error_code: state.error.clone(),
        }
    }
    fn error(&self, code: &str) {
        self.state().error = Some(code.into());
    }
    pub fn wait_stopped(&self, timeout: Duration) -> Result<(), HostError> {
        let deadline = Instant::now() + timeout;
        let mut state = self.state();
        while state.running
            || state
                .thread
                .as_ref()
                .is_some_and(|thread| !thread.is_finished())
        {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HostError::Shutdown);
            }
            state = self
                .changed
                .wait_timeout(state, remaining.min(Duration::from_millis(10)))
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        let thread = state.thread.take();
        drop(state);
        if let Some(thread) = thread {
            thread.join().map_err(|_| HostError::Shutdown)?;
        }
        Ok(())
    }
}
struct ExitGuard(Arc<Services>);
impl Drop for ExitGuard {
    fn drop(&mut self) {
        let mut state = self.0.state();
        state.running = false;
        state.active = None;
        self.0.changed.notify_all();
    }
}
#[derive(Default)]
struct Scan {
    profile: usize,
    after: HashMap<ProfileId, Option<Uuid>>,
}
struct Claimed {
    task: SummaryTaskView,
    work: SummaryWork,
    records: Result<SummaryInputRecords, HostError>,
    configuration: model_config::StoredConfiguration,
    role_digest: String,
    material_consent: Option<SummaryMaterialConsent>,
}
#[derive(Debug, Clone, Copy)]
enum Qualification {
    Current,
    Stale,
    ConfigurationChanged,
    ConfigurationUnavailable,
    ConsentChanged,
}
enum OriginalReadFailure {
    Cancelled,
    Qualification(Qualification),
    Material(MaterialError),
    Host,
}

fn ticket_current(
    core: &exomind_core::Core,
    executor: &SummaryExecutorContext,
    ticket: &SummaryRunTicket,
) -> Result<bool, HostError> {
    match core.validate_summary_run(executor, ticket) {
        Ok(()) => Ok(true),
        Err(
            exomind_core::CoreError::StaleSummaryTicket
            | exomind_core::CoreError::SummaryNotOwner
            | exomind_core::CoreError::SummaryExecutorStopped
            | exomind_core::CoreError::SummaryBlocked(_)
            | exomind_core::CoreError::SummaryConflict,
        ) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

impl BetaHost {
    pub fn summary_tasks_page(
        &self,
        session: &Session,
        p: ProfileId,
        after: Option<Uuid>,
        limit: usize,
    ) -> Result<SummaryTaskPage, HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, p, false)?;
        Ok(r.core
            .summary_tasks_page(&context(&r.core, &authority)?, p, after, limit)?)
    }
    pub fn summary_task(
        &self,
        session: &Session,
        p: ProfileId,
        id: Uuid,
    ) -> Result<SummaryTaskView, HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, p, false)?;
        Ok(r.core
            .read_summary_task(&context(&r.core, &authority)?, p, id)?)
    }
    pub fn summary_artifacts_page(
        &self,
        session: &Session,
        p: ProfileId,
        task: Uuid,
        before: Option<u64>,
        limit: usize,
    ) -> Result<SummaryArtifactPage, HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, p, false)?;
        Ok(r.core
            .summary_artifacts_page(&context(&r.core, &authority)?, p, task, before, limit)?)
    }
    pub fn summary_block_selection(
        &self,
        session: &Session,
        p: ProfileId,
        block: exomind_core::TimeblockId,
    ) -> Result<SummarySelection, HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, p, false)?;
        Ok(r.core
            .summary_block_selection(&context(&r.core, &authority)?, p, block)?)
    }
    pub fn request_summary(
        &self,
        session: &Session,
        command: &SummaryRequestCommand,
    ) -> Result<Receipt, HostError> {
        if !command.selection.selected_original_ids.is_empty() {
            return Err(HostError::Forbidden);
        }
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, command.profile_id, true)?;
        Ok(r.core
            .request_summary(&context(&r.core, &authority)?, command)?)
    }
    pub fn request_summary_with_material_consent(
        &self,
        session: &Session,
        command: &SummaryRequestCommand,
        consent: &SummaryMaterialConsent,
    ) -> Result<Receipt, HostError> {
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let authority = self.profile_authority(r, session, command.profile_id, true)?;
        if authority.kind != crate::GrantKind::Human {
            return Err(HostError::Forbidden);
        }
        let core_context = context(&r.core, &authority)?;
        consent.validate(&command.selection)?;
        let configuration =
            model_config::load(&r.persistence.root, self.device_id, command.profile_id)?
                .filter(|value| value.enabled)
                .ok_or(HostError::ModelConfigurationUnavailable)?;
        if configuration.revision != consent.provider_config_revision {
            return Err(HostError::ModelConfigurationConflict);
        }
        let store = ensure_local_intents(r, self.device_id)?;
        summary_material_consent::store_request(store, command, consent)?;
        Ok(r.core.request_summary(&core_context, command)?)
    }
    pub fn control_summary(
        &self,
        session: &Session,
        command: &SummaryControlCommand,
    ) -> Result<Receipt, HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        let authority = self.profile_authority(r, session, command.profile_id, true)?;
        let core_context = context(&r.core, &authority)?;
        if !matches!(&command.action, SummaryControlAction::Cancel) {
            let task =
                r.core
                    .read_summary_task(&core_context, command.profile_id, command.task_id)?;
            let selection = match &command.action {
                SummaryControlAction::QueueUpdate { selection, .. } => selection,
                _ => &task.selection,
            };
            if !selection.selected_original_ids.is_empty() {
                return Err(HostError::Forbidden);
            }
        }
        Ok(r.core.control_summary(&core_context, command)?)
    }
    pub fn control_summary_with_material_consent(
        &self,
        session: &Session,
        command: &SummaryControlCommand,
        consent: &SummaryMaterialConsent,
    ) -> Result<Receipt, HostError> {
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let authority = self.profile_authority(r, session, command.profile_id, true)?;
        if authority.kind != crate::GrantKind::Human {
            return Err(HostError::Forbidden);
        }
        let core_context = context(&r.core, &authority)?;
        let task = r
            .core
            .read_summary_task(&core_context, command.profile_id, command.task_id)?;
        let selection = match &command.action {
            SummaryControlAction::Cancel => return Err(HostError::InvalidRequest),
            SummaryControlAction::QueueUpdate { selection, .. } => selection,
            _ => &task.selection,
        };
        consent.validate(selection)?;
        let configuration =
            model_config::load(&r.persistence.root, self.device_id, command.profile_id)?
                .filter(|value| value.enabled)
                .ok_or(HostError::ModelConfigurationUnavailable)?;
        if configuration.revision != consent.provider_config_revision {
            return Err(HostError::ModelConfigurationConflict);
        }
        let store = ensure_local_intents(r, self.device_id)?;
        summary_material_consent::store_control(store, command, selection, consent)?;
        Ok(r.core.control_summary(&core_context, command)?)
    }
    pub fn summary_service_status(
        &self,
        owner: &Session,
    ) -> Result<SummaryServiceStatus, HostError> {
        let _state = self.active_state()?;
        self.owner(owner)?;
        Ok(self
            .summary_jobs
            .status(self.accepting.load(Ordering::Acquire)))
    }
    pub fn start_summary_services(self: &Arc<Self>) -> Result<SummaryServiceStatus, HostError> {
        let _gate = self.active_state()?;
        let mut state = self.summary_jobs.state();
        if state.attempted {
            return Ok(SummaryServiceStatus {
                running: state.running,
                active_profile_id: state.active.map(|v| v.0),
                active_task_id: state.active.map(|v| v.1),
                last_error_code: state.error.clone(),
            });
        }
        if self.summary_jobs.cancelled.load(Ordering::Acquire) {
            return Err(HostError::Stopped);
        }
        state.attempted = true;
        state.running = true;
        let weak = Arc::downgrade(self);
        let services = self.summary_jobs.clone();
        match std::thread::Builder::new()
            .name("exomind-beta-summary".into())
            .spawn(move || run(weak, services))
        {
            Ok(thread) => state.thread = Some(thread),
            Err(_) => {
                state.running = false;
                state.error = Some("summary_service_unavailable".into());
            }
        }
        Ok(SummaryServiceStatus {
            running: state.running,
            active_profile_id: None,
            active_task_id: None,
            last_error_code: state.error.clone(),
        })
    }
    fn summary_executor(&self) -> Result<SummaryExecutorContext, HostError> {
        let state = self.active_state()?;
        Ok(resources(&state)?.core.local_summary_executor())
    }
    fn recover_summaries(&self, executor: &SummaryExecutorContext) -> Result<usize, HostError> {
        let sample = self.clock.sample()?;
        let state = self.active_state()?;
        Ok(resources(&state)?
            .core
            .recover_summary_attempts(executor, sample.wall_ms)?)
    }
    fn claim_summary(
        &self,
        executor: &SummaryExecutorContext,
        scan: &mut Scan,
        services: &Services,
    ) -> Result<Option<Claimed>, HostError> {
        let sample = self.clock.sample()?;
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        r.core.reconcile_summary_triggers(executor)?;
        let profiles = r.core.profiles()?;
        if profiles.is_empty() {
            return Ok(None);
        }
        if profiles.len() > 4096 {
            return Err(HostError::PayloadTooLarge);
        }
        let p = profiles[scan.profile % profiles.len()].profile_id;
        scan.profile = (scan.profile + 1) % profiles.len();
        let read = r.core.local_human(p)?;
        let after = scan.after.get(&p).copied().flatten();
        let tasks = r.core.summary_tasks_page(&read, p, after, 100)?;
        scan.after.insert(p, tasks.next_after);
        let configuration = model_config::load(&r.persistence.root, self.device_id, p)?;
        for task in tasks.items {
            if task.owner_device_id != self.device_id
                || !task.conflicts.is_empty()
                || !matches!(
                    task.state,
                    SummaryState::Queued
                        | SummaryState::WaitingConfiguration
                        | SummaryState::RetryWait
                )
            {
                continue;
            }
            if task
                .current_run
                .as_ref()
                .and_then(|run| run.attempt.as_ref())
                .and_then(|attempt| attempt.retry_at_ms)
                .is_some_and(|retry| retry > sample.wall_ms)
            {
                continue;
            }
            let Some(configuration) = configuration.as_ref().filter(|value| value.enabled) else {
                if task.state == SummaryState::Queued {
                    r.core
                        .summary_wait_for_configuration(executor, p, task.task_id)?;
                }
                continue;
            };
            let material_consent = if task.selection.selected_original_ids.is_empty() {
                None
            } else {
                let consent = {
                    let store = ensure_local_intents(r, self.device_id)?;
                    summary_material_consent::read_for_task(store, &task)?
                };
                let Some(consent) = consent else {
                    services.error("summary_material_consent_required");
                    continue;
                };
                if consent.provider_config_revision != configuration.revision {
                    services.error("summary_material_consent_stale");
                    continue;
                }
                Some(consent)
            };
            let Some(run) = &task.current_run else {
                continue;
            };
            let role_digest = configuration.role_digest(p);
            let begin = SummaryBeginCommand {
                command_id: exomind_core::CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                task_id: task.task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: run.run_id,
                attempt_id: Uuid::new_v4(),
                role_config_digest: role_digest.clone(),
                max_attempts: MAX_ATTEMPTS,
                now_ms: sample.wall_ms,
            };
            let work = match r.core.begin_summary_attempt(executor, &begin) {
                Ok(value) => value,
                Err(exomind_core::CoreError::SummaryBlocked("originals_missing")) => {
                    services.error("summary_original_missing");
                    continue;
                }
                Err(
                    exomind_core::CoreError::SummaryBlocked(_)
                    | exomind_core::CoreError::SummaryConflict
                    | exomind_core::CoreError::SummaryNotOwner
                    | exomind_core::CoreError::StaleSummaryTicket,
                ) => continue,
                Err(error) => return Err(error.into()),
            };
            let records = r
                .core
                .summary_input_records(executor, &work.ticket)
                .map_err(HostError::from);
            let owned = model_config::StoredConfiguration::for_worker(configuration);
            return Ok(Some(Claimed {
                task,
                work,
                records,
                configuration: owned,
                role_digest,
                material_consent,
            }));
        }
        Ok(None)
    }
    fn qualify_summary(
        &self,
        executor: &SummaryExecutorContext,
        claim: &Claimed,
    ) -> Result<Qualification, HostError> {
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        if !ticket_current(&r.core, executor, &claim.work.ticket)? {
            return Ok(Qualification::Stale);
        }
        let configuration =
            match model_config::load(&r.persistence.root, self.device_id, claim.task.profile_id) {
                Ok(Some(value))
                    if value.enabled && value.revision == claim.configuration.revision =>
                {
                    value
                }
                Ok(_) => return Ok(Qualification::ConfigurationChanged),
                Err(_) => return Ok(Qualification::ConfigurationUnavailable),
            };
        if claim.task.selection.selected_original_ids.is_empty() {
            return Ok(if claim.material_consent.is_none() {
                Qualification::Current
            } else {
                Qualification::ConsentChanged
            });
        }
        let Some(expected) = &claim.material_consent else {
            return Ok(Qualification::ConsentChanged);
        };
        if expected.provider_config_revision != configuration.revision {
            return Ok(Qualification::ConfigurationChanged);
        }
        let store = ensure_local_intents(r, self.device_id)?;
        let current = summary_material_consent::read_for_task(store, &claim.task)?;
        if current.as_ref() != Some(expected) {
            return Ok(Qualification::ConsentChanged);
        }
        Ok(Qualification::Current)
    }
    fn summary_failure(
        &self,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
        kind: SummaryFailureKind,
        retry_at: Option<i64>,
    ) -> Result<(), HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        r.core
            .fail_summary_attempt(executor, ticket, kind, retry_at)?;
        Ok(())
    }
    fn summary_publish(
        &self,
        executor: &SummaryExecutorContext,
        claim: &Claimed,
        output: &exomind_core::SummaryOutput,
    ) -> Result<(), HostError> {
        let state = self.active_state()?;
        let r = resources(&state)?;
        if !ticket_current(&r.core, executor, &claim.work.ticket)? {
            return Ok(());
        }
        match model_config::load(&r.persistence.root, self.device_id, claim.task.profile_id) {
            Ok(Some(config))
                if config.enabled && config.revision == claim.configuration.revision =>
            {
                r.core
                    .finish_summary_attempt(executor, &claim.work.ticket, output)?;
            }
            Ok(_) => {
                r.core.fail_summary_attempt(
                    executor,
                    &claim.work.ticket,
                    SummaryFailureKind::ConfigurationChanged,
                    None,
                )?;
            }
            Err(_) => {
                r.core.fail_summary_attempt(
                    executor,
                    &claim.work.ticket,
                    SummaryFailureKind::ExternalOutcomeUnknown,
                    None,
                )?;
            }
        }
        Ok(())
    }
}

fn begin_summary_original_read(
    weak: &Weak<BetaHost>,
    profile: ProfileId,
    original: OriginalId,
) -> Result<OriginalReadPermit, OriginalReadFailure> {
    let host = weak.upgrade().ok_or(OriginalReadFailure::Cancelled)?;
    let state = host.active_state().map_err(|_| OriginalReadFailure::Host)?;
    let r = resources(&state).map_err(|_| OriginalReadFailure::Host)?;
    let reader = r
        .core
        .local_human(profile)
        .map_err(|_| OriginalReadFailure::Host)?;
    r.core
        .begin_original_read(&reader, profile, original)
        .map_err(|_| OriginalReadFailure::Host)
}

fn read_summary_original_chunk(
    weak: &Weak<BetaHost>,
    profile: ProfileId,
    permit: &OriginalReadPermit,
    offset: u64,
    length: usize,
) -> Result<OriginalChunk, OriginalReadFailure> {
    let host = weak.upgrade().ok_or(OriginalReadFailure::Cancelled)?;
    let state = host.active_state().map_err(|_| OriginalReadFailure::Host)?;
    let r = resources(&state).map_err(|_| OriginalReadFailure::Host)?;
    let reader = r
        .core
        .local_human(profile)
        .map_err(|_| OriginalReadFailure::Host)?;
    r.core
        .read_original_range_with_permit(&reader, permit, offset, length)
        .map_err(|_| OriginalReadFailure::Host)
}

fn finish_summary_original_read(
    weak: &Weak<BetaHost>,
    profile: ProfileId,
    permit: &OriginalReadPermit,
) -> Result<(), OriginalReadFailure> {
    let host = weak.upgrade().ok_or(OriginalReadFailure::Cancelled)?;
    let state = host.active_state().map_err(|_| OriginalReadFailure::Host)?;
    let r = resources(&state).map_err(|_| OriginalReadFailure::Host)?;
    let reader = r
        .core
        .local_human(profile)
        .map_err(|_| OriginalReadFailure::Host)?;
    r.core
        .finish_original_read(&reader, permit)
        .map_err(|_| OriginalReadFailure::Host)
}

fn qualify_original_read(
    weak: &Weak<BetaHost>,
    services: &Services,
    executor: &SummaryExecutorContext,
    claim: &Claimed,
) -> Result<(), OriginalReadFailure> {
    if services.cancelled.load(Ordering::Acquire) {
        return Err(OriginalReadFailure::Cancelled);
    }
    let host = weak.upgrade().ok_or(OriginalReadFailure::Cancelled)?;
    match host
        .qualify_summary(executor, claim)
        .map_err(|_| OriginalReadFailure::Host)?
    {
        Qualification::Current => Ok(()),
        other => Err(OriginalReadFailure::Qualification(other)),
    }
}

fn read_selected_originals(
    weak: &Weak<BetaHost>,
    services: &Services,
    executor: &SummaryExecutorContext,
    claim: &Claimed,
    records: &SummaryInputRecords,
) -> Result<Vec<PreparedOriginal>, OriginalReadFailure> {
    if claim.task.selection != claim.work.snapshot.selection {
        return Err(OriginalReadFailure::Material(MaterialError::Changed));
    }
    let consent = claim
        .material_consent
        .as_ref()
        .ok_or(OriginalReadFailure::Material(MaterialError::ConsentBudget))?;
    qualify_original_read(weak, services, executor, claim)?;
    let originals = summary_material::selected_original_refs(
        claim.task.profile_id,
        &claim.work.snapshot,
        records,
        consent.max_original_bytes,
    )
    .map_err(OriginalReadFailure::Material)?;
    let mut prepared = Vec::with_capacity(originals.len());
    for original in originals {
        qualify_original_read(weak, services, executor, claim)?;
        let permit =
            begin_summary_original_read(weak, claim.task.profile_id, original.original_id)?;
        let capacity = usize::try_from(original.byte_length)
            .map_err(|_| OriginalReadFailure::Material(MaterialError::ConsentBudget))?;
        let mut bytes = Vec::with_capacity(capacity);
        let mut offset = 0_u64;
        while offset < original.byte_length {
            qualify_original_read(weak, services, executor, claim)?;
            let length = usize::try_from(
                (original.byte_length - offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64),
            )
            .map_err(|_| OriginalReadFailure::Material(MaterialError::ConsentBudget))?;
            let chunk =
                read_summary_original_chunk(weak, claim.task.profile_id, &permit, offset, length)?;
            if chunk.original != original || chunk.offset != offset || chunk.bytes.len() != length {
                return Err(OriginalReadFailure::Material(MaterialError::Changed));
            }
            bytes.extend_from_slice(&chunk.bytes);
            offset += length as u64;
        }
        // Core permits are generation-bound rather than leased resources. A
        // complete read must finish against the same original generation;
        // dropping an incomplete permit cancels the read without side effects.
        finish_summary_original_read(weak, claim.task.profile_id, &permit)?;
        summary_material::verify_original_bytes(&original, &bytes)
            .map_err(OriginalReadFailure::Material)?;
        qualify_original_read(weak, services, executor, claim)?;
        prepared.push(PreparedOriginal { original, bytes });
    }
    Ok(prepared)
}

fn run(weak: Weak<BetaHost>, services: Arc<Services>) {
    let _guard = ExitGuard(services.clone());
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(value) => value,
        Err(_) => {
            services.error("summary_service_unavailable");
            return;
        }
    };
    runtime.block_on(async_worker(weak, services));
    // Any resolver blocking work owns no Host/Core capability. Publication is
    // already sealed; do not make a system DNS call an unbounded close wait.
    runtime.shutdown_timeout(Duration::from_secs(2));
}
async fn stopped(cancel: &mut watch::Receiver<bool>) {
    loop {
        if *cancel.borrow_and_update() {
            return;
        }
        if cancel.changed().await.is_err() {
            return;
        }
    }
}
async fn async_worker(weak: Weak<BetaHost>, services: Arc<Services>) {
    let executor = match weak.upgrade().and_then(|host| host.summary_executor().ok()) {
        Some(value) => value,
        None => return,
    };
    if let Some(host) = weak.upgrade() {
        if host.recover_summaries(&executor).is_err() {
            services.error("summary_recovery_unavailable");
            return;
        }
    }
    let mut scan = Scan::default();
    let mut cancel = services.stop.subscribe();
    while !services.cancelled.load(Ordering::Acquire) {
        let Some(host) = weak.upgrade() else {
            break;
        };
        let claimed = host.claim_summary(&executor, &mut scan, &services);
        drop(host);
        match claimed {
            Ok(Some(claim)) => process(&weak, &services, &executor, claim).await,
            Ok(None) => {}
            Err(HostError::Stopped) => break,
            Err(error) => services.error(match error {
                HostError::ClockUnavailable => "clock_unavailable",
                HostError::ModelConfigurationRecoveryRequired => {
                    "model_configuration_recovery_required"
                }
                HostError::ModelConfigurationUnavailable => "model_configuration_unavailable",
                _ => "summary_material_unavailable",
            }),
        }
        tokio::select! {biased;_=stopped(&mut cancel)=>break,_=tokio::time::sleep(POLL)=>{}}
    }
    if let Some(host) = weak.upgrade() {
        if let Ok(state) = host.state() {
            if let Ok(r) = resources(&state) {
                let _ = r.core.stop_summary_executor(&executor);
            }
        }
    }
}
fn fail(
    weak: &Weak<BetaHost>,
    _services: &Services,
    executor: &SummaryExecutorContext,
    claim: &Claimed,
    kind: SummaryFailureKind,
    retry: Option<i64>,
) -> Result<(), HostError> {
    if let Some(host) = weak.upgrade() {
        host.summary_failure(executor, &claim.work.ticket, kind, retry)?;
    }
    Ok(())
}
async fn process(
    weak: &Weak<BetaHost>,
    services: &Arc<Services>,
    executor: &SummaryExecutorContext,
    claim: Claimed,
) {
    services.state().active = Some((claim.task.profile_id, claim.task.task_id));
    let result = process_one(weak, services, executor, &claim).await;
    if result.is_err() {
        services.error("summary_commit_unavailable");
    } else {
        services.state().error = None;
    }
    services.state().active = None;
}
async fn process_one(
    weak: &Weak<BetaHost>,
    services: &Arc<Services>,
    executor: &SummaryExecutorContext,
    claim: &Claimed,
) -> Result<(), HostError> {
    let records = match &claim.records {
        Ok(value) => value,
        Err(_) => {
            fail(
                weak,
                services,
                executor,
                claim,
                SummaryFailureKind::MaterialUnavailable,
                None,
            )?;
            return Ok(());
        }
    };
    let originals = if claim.task.selection.selected_original_ids.is_empty() {
        Vec::new()
    } else {
        match read_selected_originals(weak, services, executor, claim, records) {
            Ok(value) => value,
            Err(OriginalReadFailure::Cancelled)
            | Err(OriginalReadFailure::Qualification(Qualification::Stale)) => return Ok(()),
            Err(OriginalReadFailure::Qualification(Qualification::ConfigurationChanged)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::ConfigurationChanged,
                    None,
                )?;
                return Ok(());
            }
            Err(OriginalReadFailure::Qualification(Qualification::ConfigurationUnavailable)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::ConfigurationChanged,
                    None,
                )?;
                return Ok(());
            }
            Err(OriginalReadFailure::Qualification(Qualification::ConsentChanged))
            | Err(OriginalReadFailure::Host)
            | Err(OriginalReadFailure::Qualification(Qualification::Current)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::MaterialUnavailable,
                    None,
                )?;
                return Ok(());
            }
            Err(OriginalReadFailure::Material(MaterialError::InputLimit)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::InputTooLarge,
                    None,
                )?;
                return Ok(());
            }
            Err(OriginalReadFailure::Material(MaterialError::UnsupportedOriginals)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::UnsupportedMaterial,
                    None,
                )?;
                return Ok(());
            }
            Err(OriginalReadFailure::Material(_)) => {
                fail(
                    weak,
                    services,
                    executor,
                    claim,
                    SummaryFailureKind::MaterialUnavailable,
                    None,
                )?;
                return Ok(());
            }
        }
    };
    let prepared = match summary_material::prepare(
        claim.task.profile_id,
        claim.task.artifact_kind,
        &claim.work.snapshot,
        records,
        &originals,
        &claim.configuration.settings,
    ) {
        Ok(value) => value,
        Err(error) => {
            let kind = match error {
                MaterialError::InputLimit => SummaryFailureKind::InputTooLarge,
                MaterialError::UnsupportedOriginals => SummaryFailureKind::UnsupportedMaterial,
                _ => SummaryFailureKind::MaterialUnavailable,
            };
            fail(weak, services, executor, claim, kind, None)?;
            return Ok(());
        }
    };
    if services.cancelled.load(Ordering::Acquire) {
        return Ok(());
    }
    let Some(host) = weak.upgrade() else {
        return Ok(());
    };
    match host.qualify_summary(executor, claim)? {
        Qualification::Current => {}
        Qualification::Stale => return Ok(()),
        Qualification::ConfigurationChanged => {
            fail(
                weak,
                services,
                executor,
                claim,
                SummaryFailureKind::ConfigurationChanged,
                None,
            )?;
            return Ok(());
        }
        Qualification::ConfigurationUnavailable => {
            fail(
                weak,
                services,
                executor,
                claim,
                SummaryFailureKind::ConfigurationChanged,
                None,
            )?;
            return Ok(());
        }
        Qualification::ConsentChanged => {
            fail(
                weak,
                services,
                executor,
                claim,
                SummaryFailureKind::MaterialUnavailable,
                None,
            )?;
            return Ok(());
        }
    }
    drop(host);
    let operation = model_provider::complete(
        &claim.configuration.settings,
        &prepared.input,
        services.stop.subscribe(),
    );
    tokio::pin!(operation);
    let mut interval = tokio::time::interval(POLL);
    let reply = loop {
        tokio::select! {biased;
            _=interval.tick()=>{
                let Some(host)=weak.upgrade()else{return Ok(());};
                match host.qualify_summary(executor,claim)?{Qualification::Current=>{},Qualification::Stale=>return Ok(()),Qualification::ConfigurationChanged=>{fail(weak,services,executor,claim,SummaryFailureKind::ConfigurationChanged,None)?;return Ok(());},Qualification::ConfigurationUnavailable=>{fail(weak,services,executor,claim,SummaryFailureKind::ExternalOutcomeUnknown,None)?;return Ok(());},Qualification::ConsentChanged=>{fail(weak,services,executor,claim,SummaryFailureKind::MaterialUnavailable,None)?;return Ok(());}}
            },
            reply=&mut operation=>break reply,
        }
    };
    match reply {
        Ok(reply) => match summary_material::output(
            reply,
            &claim.work.snapshot,
            &claim.configuration.settings,
            claim.role_digest.clone(),
            prepared.request_input_digest.clone(),
            &prepared.read_original_ids,
        ) {
            Ok(output) => {
                if let Some(host) = weak.upgrade() {
                    host.summary_publish(executor, claim, &output)?;
                }
            }
            Err(_) => fail(
                weak,
                services,
                executor,
                claim,
                SummaryFailureKind::InvalidOutput,
                None,
            )?,
        },
        Err(ModelCallError::Cancelled) => {}
        Err(error) => {
            let kind = match error {
                ModelCallError::RateLimited => SummaryFailureKind::RateLimited,
                ModelCallError::Unavailable => SummaryFailureKind::ProviderUnavailable,
                ModelCallError::Timeout => SummaryFailureKind::Timeout,
                ModelCallError::ExternalOutcomeUnknown => {
                    SummaryFailureKind::ExternalOutcomeUnknown
                }
                ModelCallError::InputTooLarge => SummaryFailureKind::InputTooLarge,
                ModelCallError::Authentication
                | ModelCallError::InvalidConfiguration
                | ModelCallError::Rejected => SummaryFailureKind::ProviderRejected,
                _ => SummaryFailureKind::InvalidOutput,
            };
            let retry = if error.retryable() {
                let prior = claim
                    .task
                    .current_run
                    .as_ref()
                    .and_then(|run| run.attempt.as_ref())
                    .map_or(0, |attempt| attempt.number)
                    .min(3);
                let delay_ms = 3000i64.saturating_mul(1i64 << prior);
                weak.upgrade()
                    .and_then(|host| host.clock.sample().ok())
                    .and_then(|sample| sample.wall_ms.checked_add(delay_ms))
            } else {
                None
            };
            fail(weak, services, executor, claim, kind, retry)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "summary_jobs_tests.rs"]
mod tests;
