use super::{Failure, NativeState, trusted_window, work};
use exomind_beta_host::SummaryMaterialConsent;
use exomind_core::{
    EventId, ProfileId, Receipt, SummaryArtifactPage, SummaryControlCommand, SummaryRequestCommand,
    SummarySelection, SummaryTaskPage, SummaryTaskView, TimeblockId,
};
use std::sync::Arc;
use tauri::{State, WebviewWindow};
use uuid::Uuid;
#[tauri::command]
pub(super) async fn beta_timeline_event(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    event_id: EventId,
) -> Result<Option<exomind_core::TimelineItem>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .timeline_event(&state.human(profile_id)?, profile_id, event_id)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_summary_tasks(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    after: Option<Uuid>,
    limit: usize,
) -> Result<SummaryTaskPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .summary_tasks_page(&state.human(profile_id)?, profile_id, after, limit)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_summary_task(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    task_id: Uuid,
) -> Result<SummaryTaskView, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .summary_task(&state.human(profile_id)?, profile_id, task_id)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_summary_artifacts(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    task_id: Uuid,
    before: Option<u64>,
    limit: usize,
) -> Result<SummaryArtifactPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.summary_artifacts_page(
            &state.human(profile_id)?,
            profile_id,
            task_id,
            before,
            limit,
        )
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_request_summary(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: SummaryRequestCommand,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .request_summary(&state.human(command.profile_id)?, &command)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_control_summary(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: SummaryControlCommand,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .control_summary(&state.human(command.profile_id)?, &command)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_summary_block_selection(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    block_id: TimeblockId,
) -> Result<SummarySelection, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .summary_block_selection(&state.human(profile_id)?, profile_id, block_id)
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_request_summary_with_material_consent(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: SummaryRequestCommand,
    consent: SummaryMaterialConsent,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.request_summary_with_material_consent(
            &state.human(command.profile_id)?,
            &command,
            &consent,
        )
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_control_summary_with_material_consent(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: SummaryControlCommand,
    consent: SummaryMaterialConsent,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.control_summary_with_material_consent(
            &state.human(command.profile_id)?,
            &command,
            &consent,
        )
    })
    .await
}
#[tauri::command]
pub(super) async fn beta_summary_service_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
) -> Result<exomind_beta_host::SummaryServiceStatus, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.summary_service_status(&state.owner)
    })
    .await
}
