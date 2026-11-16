use super::{facts, model::*};
use crate::{CoreError, EventId, EventRecord, ProfileId, TimeblockNodeRecord};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;

pub(super) fn record(
    connection: &Connection,
    p: ProfileId,
    id: EventId,
) -> Result<Option<SummaryInputRecord>, CoreError> {
    let row:Option<(String,Option<String>)>=connection.query_row("SELECT kind,CASE WHEN length(CAST(body AS BLOB))<=?3 THEN body END FROM events WHERE profile_id=?1 AND event_id=?2",params![p.to_string(),id.to_string(),crate::MAX_FACT_BYTES],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    row.map(|(kind, body)| {
        let body = body.ok_or(CoreError::RecoveryRequired)?;
        match kind.as_str() {
            "capture" => {
                let mut value: EventRecord = serde_json::from_str(&body)?;
                if value.event_id != id
                    || value.profile_id != p
                    || value.computed_digest()? != value.digest
                {
                    return Err(CoreError::RecoveryRequired);
                }
                value.local_seq = 0;
                Ok(SummaryInputRecord::Capture(value))
            }
            "timeblock/1" => {
                let mut value: TimeblockNodeRecord = serde_json::from_str(&body)?;
                if value.event_id != id
                    || value.profile_id != p
                    || value.computed_digest()? != value.digest
                {
                    return Err(CoreError::RecoveryRequired);
                }
                value.local_seq = 0;
                Ok(SummaryInputRecord::Timeblock(value))
            }
            _ => Err(facts::invalid("source is not original input")),
        }
    })
    .transpose()
}
pub(super) fn identity(value: &SummaryInputRecord) -> (EventId, &str, &str) {
    match value {
        SummaryInputRecord::Capture(v) => (v.event_id, "capture", &v.digest),
        SummaryInputRecord::Timeblock(v) => (v.event_id, "timeblock/1", &v.digest),
    }
}
pub(super) fn freeze(
    connection: &Connection,
    p: ProfileId,
    selection: SummarySelection,
) -> Result<SummarySourceSnapshot, CoreError> {
    facts::selection(&selection)?;
    let through: u64 = connection.query_row(
        "SELECT COALESCE(MAX(local_seq),0) FROM events WHERE profile_id=?1",
        [p.to_string()],
        |r| r.get(0),
    )?;
    if through > MAX_SUMMARY_SAFE_COUNTER {
        return Err(facts::invalid("safe highwater"));
    }
    // Include all typed nodes of selected blocks, even feedback appended outside
    // the initial wall range. Captures use the explicit, frozen range. Never
    // feed job/status/result facts back to the model implicitly.
    let block_json = serde_json::to_string(&selection.block_ids)?;
    let mut query=connection.prepare("SELECT e.event_id,e.kind,e.digest,length(CAST(e.body AS BLOB)) FROM events e JOIN (SELECT event_id FROM summary_capture_sources WHERE profile_id=?1 AND occurred_at_ms BETWEEN ?2 AND ?3 UNION SELECT event_id FROM summary_block_sources WHERE profile_id=?1 AND block_id IN (SELECT value FROM json_each(?4))) selected ON selected.event_id=e.event_id WHERE e.profile_id=?1 AND e.local_seq<=?5 ORDER BY e.local_seq,e.event_id LIMIT 1001")?;
    let rows = query.query_map(
        params![
            p.to_string(),
            selection.from_ms,
            selection.to_ms,
            block_json,
            through
        ],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, usize>(3)?,
            ))
        },
    )?;
    let mut sources = vec![];
    let mut feedback_ids = vec![];
    let mut missing_parents = vec![];
    let mut bytes = 0usize;
    let mut selected_count = 0usize;
    let mut page_limit = false;
    let mut input_byte_limit = false;
    let mut omitted = vec![];
    let mut materials = BTreeMap::<String, crate::OriginalRef>::new();
    for row in rows {
        let (id, kind, digest, body_bytes) = row?;
        let id: EventId = id.parse()?;
        selected_count += 1;
        if selected_count > MAX_SUMMARY_SOURCES {
            page_limit = true;
            break;
        }
        if body_bytes > MAX_SUMMARY_INPUT_BYTES {
            input_byte_limit = true;
            omitted.push(id);
            continue;
        }
        let value = record(connection, p, id)?.ok_or(CoreError::RecoveryRequired)?;
        let encoded = serde_json::to_vec(&value)?.len();
        if bytes
            .checked_add(encoded)
            .is_none_or(|n| n > MAX_SUMMARY_INPUT_BYTES)
        {
            input_byte_limit = true;
            omitted.push(id);
            continue;
        }
        bytes += encoded;
        match &value {
            SummaryInputRecord::Capture(event) => {
                for original in &event.originals {
                    materials.insert(original.original_id.to_string(), original.clone());
                }
            }
            SummaryInputRecord::Timeblock(node) => {
                for parent in &node.parents {
                    let present:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='timeblock/1')",params![p.to_string(),parent.to_string()],|r|r.get(0))?;
                    if !present && !missing_parents.contains(parent) {
                        if missing_parents.len() >= 128 {
                            return Err(CoreError::SummaryBlocked("missing_parent_limit"));
                        }
                        missing_parents.push(*parent);
                    }
                }
                if matches!(
                    &node.payload,
                    crate::TimeblockPayload::Action {
                        action: crate::TimeblockAction::SubmitFeedback { .. }
                            | crate::TimeblockAction::AppendFeedback { .. }
                    }
                ) {
                    feedback_ids.push(id);
                }
            }
        }
        sources.push(SummarySourceRef {
            event_id: id,
            kind,
            digest,
        });
    }
    let mut material_rows = vec![];
    for (_, original) in materials {
        let selected = selection
            .selected_original_ids
            .contains(&original.original_id);
        let state: Option<String> = connection
            .query_row(
                "SELECT state FROM original_stages WHERE profile_id=?1 AND original_id=?2",
                params![p.to_string(), original.original_id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        let read_state = if !selected {
            SummaryMaterialState::NotSelected
        } else if state.as_deref() == Some("verified") {
            SummaryMaterialState::VerifiedAvailable
        } else {
            SummaryMaterialState::Missing
        };
        material_rows.push(SummaryMaterial {
            original,
            selected,
            read_state,
        });
    }
    if selection
        .selected_original_ids
        .iter()
        .any(|id| !material_rows.iter().any(|m| m.original.original_id == *id))
    {
        return Err(facts::invalid("selected material outside frozen sources"));
    }
    let origin_heads = {
        let mut query=connection.prepare("SELECT origin_device,restoration_epoch,head_seq,head_hash FROM origin_heads WHERE profile_id=?1 ORDER BY origin_device,restoration_epoch")?;
        let rows = query
            .query_map([p.to_string()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u64>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(device, epoch, seq, hash)| {
                Ok(SummaryOriginHead {
                    origin: crate::OriginIdentity {
                        profile_id: p,
                        device_id: device.parse()?,
                        restoration_epoch: uuid::Uuid::parse_str(&epoch)?,
                    },
                    cursor: crate::OriginCursor { seq, hash },
                })
            })
            .collect::<Result<Vec<_>, CoreError>>()?
    };
    let metadata_only = material_rows
        .iter()
        .map(|m| m.original.original_id)
        .collect();
    let unread_originals = material_rows
        .iter()
        .map(|m| m.original.original_id)
        .collect();
    let mut snapshot = SummarySourceSnapshot {
        selection,
        sources,
        feedback_ids,
        origin_heads,
        through,
        input_encoded_bytes: bytes as u64,
        materials: material_rows,
        coverage: SummaryCoverage {
            page_limit,
            input_byte_limit,
            omitted_source_ids: omitted,
            read_failures: vec![],
            missing_parents,
            metadata_only,
            unread_originals,
            remote_visibility: SummaryRemoteVisibility::Unknown,
        },
        digest: String::new(),
    };
    snapshot.digest = facts::hash(&snapshot)?;
    facts::snapshot(&snapshot)?;
    Ok(snapshot)
}
pub(super) fn input(
    connection: &Connection,
    p: ProfileId,
    snapshot: &SummarySourceSnapshot,
) -> Result<SummaryInputRecords, CoreError> {
    facts::snapshot(snapshot)?;
    let mut records = vec![];
    let mut bytes = 0usize;
    for source in &snapshot.sources {
        let value = record(connection, p, source.event_id)?
            .ok_or(CoreError::SummaryBlocked("missing frozen source"))?;
        let (id, kind, digest) = identity(&value);
        if id != source.event_id || kind != source.kind || digest != source.digest {
            return Err(facts::invalid("frozen source changed"));
        }
        bytes = bytes
            .checked_add(serde_json::to_vec(&value)?.len())
            .ok_or(facts::invalid("input budget"))?;
        if bytes > MAX_SUMMARY_INPUT_BYTES {
            return Err(facts::invalid("input budget"));
        }
        records.push(value);
    }
    if bytes as u64 != snapshot.input_encoded_bytes {
        return Err(facts::invalid("frozen input byte count"));
    }
    Ok(SummaryInputRecords {
        snapshot_digest: snapshot.digest.clone(),
        records,
        encoded_bytes: bytes as u64,
    })
}
pub(super) fn changed(
    connection: &Connection,
    p: ProfileId,
    snapshot: &SummarySourceSnapshot,
) -> Result<bool, CoreError> {
    // Polling a task must not re-read its model input. Compare the selected
    // source index against the frozen per-origin vector (local_seq differs on
    // another device), then metadata-only material/known-parent readiness.
    let blocks = serde_json::to_string(&snapshot.selection.block_ids)?;
    let heads = serde_json::to_string(&snapshot.origin_heads)?;
    let newer:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM (SELECT event_id FROM summary_capture_sources WHERE profile_id=?1 AND occurred_at_ms BETWEEN ?2 AND ?3 UNION SELECT event_id FROM summary_block_sources WHERE profile_id=?1 AND block_id IN (SELECT value FROM json_each(?4))) selected JOIN origin_entries o ON o.event_id=selected.event_id AND o.profile_id=?1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?5) h WHERE json_extract(h.value,'$.origin.device_id')=o.origin_device AND json_extract(h.value,'$.origin.restoration_epoch')=o.restoration_epoch AND json_extract(h.value,'$.cursor.seq')>=o.origin_seq))",params![p.to_string(),snapshot.selection.from_ms,snapshot.selection.to_ms,blocks,heads],|r|r.get(0))?;
    if newer {
        return Ok(true);
    }
    for parent in &snapshot.coverage.missing_parents {
        let exists:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='timeblock/1')",params![p.to_string(),parent.to_string()],|r|r.get(0))?;
        if exists {
            return Ok(true);
        }
    }
    for material in snapshot.materials.iter().filter(|m| m.selected) {
        let ready:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM original_stages WHERE profile_id=?1 AND original_id=?2 AND state='verified')",params![p.to_string(),material.original.original_id.to_string()],|r|r.get(0))?;
        if ready != (material.read_state == SummaryMaterialState::VerifiedAvailable) {
            return Ok(true);
        }
    }
    Ok(false)
}
pub(super) fn selected_ready(snapshot: &SummarySourceSnapshot) -> bool {
    snapshot
        .materials
        .iter()
        .all(|m| !m.selected || m.read_state == SummaryMaterialState::VerifiedAvailable)
}
