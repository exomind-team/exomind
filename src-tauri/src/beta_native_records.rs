//! Native record organization commands for the Beta renderer.
//!
//! Corrections append a separate fact under the local human session. Tagged
//! reads only filter the selected profile's capture page.

use super::{trusted_window, work, Failure, NativeState};
use exomind_core::{
    CorrectionEntry, CorrectionPage, EventId, EventPage, EventQuery, ProfileId, Receipt,
    RecordCorrectionCommand,
};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

#[tauri::command]
pub(super) async fn beta_events_page_with_tag(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: EventQuery,
    tag: Option<String>,
) -> Result<EventPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        let human = state.human(profile_id)?;
        state
            .host
            .events_page_with_tag(&human, profile_id, &query, tag.as_deref())
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_record_correction(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: RecordCorrectionCommand,
) -> Result<Receipt, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        let human = state.human(command.profile_id)?;
        state.host.record_correction(&human, &command)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_correction_event(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    event_id: EventId,
) -> Result<Option<CorrectionEntry>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        let human = state.human(profile_id)?;
        state.host.correction_event(&human, profile_id, event_id)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_corrections_page(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    profile_id: ProfileId,
    query: EventQuery,
    target_event_id: Option<EventId>,
) -> Result<CorrectionPage, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        let human = state.human(profile_id)?;
        match target_event_id {
            Some(target) => state
                .host
                .corrections_page_for_target(&human, profile_id, &query, target),
            None => state.host.corrections_page(&human, profile_id, &query),
        }
    })
    .await
}
