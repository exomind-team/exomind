use crate::{HostError, local_intents::Store};
use exomind_core::{
    EventId, ProfileId, SummaryControlAction, SummaryControlCommand, SummaryRequestCommand,
    SummarySelection, SummaryTaskView,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) const MAX_SELECTED_ORIGINAL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SummaryMaterialConsent {
    pub provider_config_revision: Uuid,
    pub max_original_bytes: u64,
}
impl SummaryMaterialConsent {
    pub(crate) fn validate(&self, selection: &SummarySelection) -> Result<(), HostError> {
        validate_consent(selection, self)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ConsentOperation {
    Request,
    Control,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ConsentRecord {
    version: u8,
    operation: ConsentOperation,
    profile_id: ProfileId,
    operation_event_id: EventId,
    task_id: Option<Uuid>,
    selection_digest: String,
    consent: SummaryMaterialConsent,
}

fn validate_consent(
    selection: &SummarySelection,
    consent: &SummaryMaterialConsent,
) -> Result<(), HostError> {
    if selection.selected_original_ids.is_empty()
        || consent.provider_config_revision.is_nil()
        || !(1..=MAX_SELECTED_ORIGINAL_BYTES).contains(&consent.max_original_bytes)
    {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}

pub(crate) fn selection_digest(selection: &SummarySelection) -> Result<String, HostError> {
    let bytes = serde_json::to_vec(selection).map_err(|_| HostError::InvalidRequest)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn store_record(
    store: &mut Store,
    profile: ProfileId,
    operation: ConsentOperation,
    event: EventId,
    task: Option<Uuid>,
    selection: &SummarySelection,
    consent: &SummaryMaterialConsent,
) -> Result<(), HostError> {
    validate_consent(selection, consent)?;
    let record = ConsentRecord {
        version: 1,
        operation,
        profile_id: profile,
        operation_event_id: event,
        task_id: task,
        selection_digest: selection_digest(selection)?,
        consent: consent.clone(),
    };
    let raw = serde_json::to_string(&record).map_err(|_| HostError::InvalidRequest)?;
    store.write_summary_material_consent(profile, event, &raw)
}

pub(crate) fn store_request(
    store: &mut Store,
    command: &SummaryRequestCommand,
    consent: &SummaryMaterialConsent,
) -> Result<(), HostError> {
    store_record(
        store,
        command.profile_id,
        ConsentOperation::Request,
        command.event_id,
        None,
        &command.selection,
        consent,
    )
}

pub(crate) fn store_control(
    store: &mut Store,
    command: &SummaryControlCommand,
    selection: &SummarySelection,
    consent: &SummaryMaterialConsent,
) -> Result<(), HostError> {
    if matches!(&command.action, SummaryControlAction::Cancel) {
        return Err(HostError::InvalidRequest);
    }
    store_record(
        store,
        command.profile_id,
        ConsentOperation::Control,
        command.event_id,
        Some(command.task_id),
        selection,
        consent,
    )
}

pub(crate) fn read_for_task(
    store: &Store,
    task: &SummaryTaskView,
) -> Result<Option<SummaryMaterialConsent>, HostError> {
    if task.selection.selected_original_ids.is_empty() {
        return Ok(None);
    }
    let raw = store.read_summary_material_consent(task.profile_id, task.owner_control_event_id)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    let record: ConsentRecord =
        serde_json::from_str(&raw).map_err(|_| HostError::IntentCacheCorrupt)?;
    if record.version != 1
        || record.profile_id != task.profile_id
        || record.operation_event_id != task.owner_control_event_id
        || record.selection_digest != selection_digest(&task.selection)?
    {
        return Ok(None);
    }
    let identity_matches = match record.operation {
        ConsentOperation::Request => {
            record.task_id.is_none() && task.creator_event_id == record.operation_event_id
        }
        ConsentOperation::Control => record.task_id == Some(task.task_id),
    };
    if !identity_matches {
        return Ok(None);
    }
    validate_consent(&task.selection, &record.consent)?;
    Ok(Some(record.consent))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_intents::Store;
    use exomind_core::{CommandId, SummaryArtifactKind, SummaryPurpose, SummaryState, TimeblockId};

    #[test]
    fn reopened_sidecar_requires_the_current_control_event_task_and_selection() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("host");
        let host = crate::BetaHost::open(&root).unwrap();
        let owner = host.owner_session().unwrap();
        let profile_id = ProfileId::new();
        host.provision_profile(&owner, profile_id, "Consent sidecar")
            .unwrap();
        let device_id = host.device_id;
        let request_event_id = EventId::new();
        let control_event_id = EventId::new();
        let task_id = Uuid::new_v4();
        let original_id = exomind_core::OriginalId::new();
        let selection = SummarySelection {
            block_ids: vec![TimeblockId::new()],
            from_ms: 0,
            to_ms: 1,
            selected_original_ids: vec![original_id],
        };
        let request_consent = SummaryMaterialConsent {
            provider_config_revision: Uuid::new_v4(),
            max_original_bytes: 68,
        };
        let control_consent = SummaryMaterialConsent {
            provider_config_revision: Uuid::new_v4(),
            max_original_bytes: 68,
        };
        let request = SummaryRequestCommand {
            command_id: CommandId::new(),
            event_id: request_event_id,
            profile_id,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::CompressedMessage,
            selection: selection.clone(),
        };
        let control = SummaryControlCommand {
            command_id: CommandId::new(),
            event_id: control_event_id,
            profile_id,
            task_id,
            expected_owner_generation: 1,
            expected_owner_control_event_id: request_event_id,
            expected_control_heads: vec![request_event_id],
            action: SummaryControlAction::QueueUpdate {
                run_id: Uuid::new_v4(),
                selection: selection.clone(),
                supersedes_artifact_id: None,
            },
        };
        {
            let mut store = Store::open(&root, device_id).unwrap();
            store_request(&mut store, &request, &request_consent).unwrap();
            store_control(&mut store, &control, &selection, &control_consent).unwrap();
        }
        host.stop().unwrap();
        drop(host);

        let store = Store::open(&root, device_id).unwrap();
        let task = SummaryTaskView {
            task_id,
            profile_id,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::CompressedMessage,
            selection: selection.clone(),
            created_at_ms: 0,
            trigger_key: "synthetic-control-identity".into(),
            creator_event_id: request_event_id,
            owner_device_id: device_id,
            owner_generation: 2,
            owner_control_event_id: control_event_id,
            current_run: None,
            state: SummaryState::Queued,
            reason: None,
            control_heads: vec![control_event_id],
            conflicts: vec![],
            latest_artifact_id: None,
            coverage_changed: false,
        };
        assert_eq!(read_for_task(&store, &task).unwrap(), Some(control_consent));

        let mut another_task = task.clone();
        another_task.task_id = Uuid::new_v4();
        assert_eq!(read_for_task(&store, &another_task).unwrap(), None);

        let mut changed_selection = task;
        changed_selection.selection.selected_original_ids = vec![exomind_core::OriginalId::new()];
        assert_eq!(read_for_task(&store, &changed_selection).unwrap(), None);
    }
}
