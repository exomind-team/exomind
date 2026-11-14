//! Private local draft bytes. Only the main Beta window can use this adapter;
//! source bytes are never exposed through the HTTP or overlay interfaces.
use super::{Failure, NativeState, trusted_window, work};
use exomind_beta_host::{
    HostError, LocalSourceBegin, LocalSourceInfo, MAX_LOCAL_SOURCE_CHUNK_BYTES,
};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

fn bounded_range(offset: u64, length: usize) -> Result<(), Failure> {
    if length > MAX_LOCAL_SOURCE_CHUNK_BYTES {
        return Err(HostError::PayloadTooLarge.into());
    }
    let length = u64::try_from(length).map_err(|_| Failure::from(HostError::InvalidRequest))?;
    offset
        .checked_add(length)
        .ok_or_else(|| Failure::from(HostError::InvalidRequest))?;
    Ok(())
}

#[tauri::command]
pub(super) async fn beta_begin_local_source(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    command: LocalSourceBegin,
) -> Result<LocalSourceInfo, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.begin_local_source(&state.owner, &command)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_local_source_status(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
) -> Result<Option<LocalSourceInfo>, Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state.host.local_source_status(&state.owner, &key)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_write_local_source_chunk(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<LocalSourceInfo, Failure> {
    trusted_window(&window, state.inner())?;
    bounded_range(offset, bytes.len())?;
    work(state.inner(), move |state| {
        state
            .host
            .write_local_source_chunk(&state.owner, &key, offset, &bytes)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_finish_local_source(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
) -> Result<LocalSourceInfo, Failure> {
    trusted_window(&window, state.inner())?;
    // Whole-source hashing runs outside the UI thread. The Host owns the
    // verification admission, cancellation and final generation check.
    work(state.inner(), move |state| {
        state.host.finish_local_source(&state.owner, &key)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_read_local_source_range(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, Failure> {
    trusted_window(&window, state.inner())?;
    bounded_range(offset, length)?;
    work(state.inner(), move |state| {
        state
            .host
            .read_local_source_range(&state.owner, &key, offset, length)
    })
    .await
}

#[tauri::command]
pub(super) async fn beta_remove_local_source(
    window: WebviewWindow,
    state: State<'_, Arc<NativeState>>,
    key: String,
    generation: u64,
) -> Result<(), Failure> {
    trusted_window(&window, state.inner())?;
    work(state.inner(), move |state| {
        state
            .host
            .remove_local_source(&state.owner, &key, generation)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ipc_rejects_oversized_and_overflowing_ranges_before_blocking_work() {
        assert_eq!(
            bounded_range(0, MAX_LOCAL_SOURCE_CHUNK_BYTES + 1)
                .unwrap_err()
                .code,
            "payload_too_large"
        );
        assert_eq!(
            bounded_range(u64::MAX, 1).unwrap_err().code,
            "invalid_request"
        );
        assert!(
            bounded_range(
                u64::MAX - MAX_LOCAL_SOURCE_CHUNK_BYTES as u64,
                MAX_LOCAL_SOURCE_CHUNK_BYTES
            )
            .is_ok()
        );
    }
}
