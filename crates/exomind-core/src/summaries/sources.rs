use super::{facts, model::*};
use crate::{
    CoreError, CorrectionRecord, EventId, EventRecord, OriginCursor, OriginIdentity, ProfileId,
    TimeblockNodeRecord,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{BTreeMap, HashMap};

const MAX_CORRECTIONS_PER_CAPTURE: usize = 64;
const MAX_CORRECTION_CANDIDATES_PER_SUMMARY: usize = 256;
const MAX_CORRECTION_CANDIDATE_BYTES_PER_SUMMARY: usize = MAX_SUMMARY_INPUT_BYTES;

fn decode_record(
    connection: &Connection,
    p: ProfileId,
    id: EventId,
    kind: &str,
    stored_digest: &str,
    body: &str,
) -> Result<SummaryInputRecord, CoreError> {
    match kind {
        "capture" => {
            let mut value: EventRecord = serde_json::from_str(body)?;
            if value.event_id != id
                || value.profile_id != p
                || value.digest != stored_digest
                || value.computed_digest()? != stored_digest
            {
                return Err(CoreError::RecoveryRequired);
            }
            value.local_seq = 0;
            Ok(SummaryInputRecord::Capture(value))
        }
        "timeblock/1" => {
            let mut value: TimeblockNodeRecord = serde_json::from_str(body)?;
            if value.event_id != id
                || value.profile_id != p
                || value.digest != stored_digest
                || value.computed_digest()? != stored_digest
            {
                return Err(CoreError::RecoveryRequired);
            }
            value.local_seq = 0;
            Ok(SummaryInputRecord::Timeblock(value))
        }
        "correction/1" => {
            let mut fact: CorrectionRecord = serde_json::from_str(body)?;
            if fact.event_id != id
                || fact.profile_id != p
                || fact.digest != stored_digest
                || fact.validate().is_err()
            {
                return Err(CoreError::RecoveryRequired);
            }
            let (origin, cursor) = correction_origin(connection, p, id, &fact)?;
            fact.local_seq = 0;
            Ok(SummaryInputRecord::Correction(SummaryCorrectionInput {
                fact,
                origin,
                cursor,
            }))
        }
        _ => Err(facts::invalid("source is not original input")),
    }
}

pub(super) fn record(
    connection: &Connection,
    p: ProfileId,
    id: EventId,
) -> Result<Option<SummaryInputRecord>, CoreError> {
    let row: Option<(String, String, Option<String>)> = connection
        .query_row(
            "SELECT kind,digest,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?3 THEN body END FROM events WHERE profile_id=?1 AND event_id=?2",
            params![p.to_string(), id.to_string(), crate::MAX_FACT_BYTES],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    row.map(|(kind, stored_digest, body)| {
        let body = body.ok_or(CoreError::RecoveryRequired)?;
        decode_record(connection, p, id, &kind, &stored_digest, &body)
    })
    .transpose()
}

fn correction_origin(
    connection: &Connection,
    profile: ProfileId,
    event_id: EventId,
    fact: &CorrectionRecord,
) -> Result<(OriginIdentity, OriginCursor), CoreError> {
    let row: Option<(String, String, u64, String)> = connection
        .query_row(
            "SELECT origin_device,restoration_epoch,origin_seq,chain_hash FROM origin_entries WHERE profile_id=?1 AND event_id=?2 AND fact_type='correction/1' AND digest=?3",
            params![profile.to_string(), event_id.to_string(), fact.digest.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let (device, epoch, seq, hash) = row.ok_or(CoreError::RecoveryRequired)?;
    let origin = OriginIdentity {
        profile_id: profile,
        device_id: device.parse()?,
        restoration_epoch: uuid::Uuid::parse_str(&epoch)?,
    };
    let cursor = OriginCursor { seq, hash };
    if origin.device_id != fact.device_id
        || origin.restoration_epoch.is_nil()
        || cursor.seq == 0
        || cursor.seq > MAX_SUMMARY_SAFE_COUNTER
        || !facts::sha(&cursor.hash)
    {
        return Err(CoreError::RecoveryRequired);
    }
    Ok((origin, cursor))
}

pub(super) fn identity(value: &SummaryInputRecord) -> (EventId, &str, &str) {
    match value {
        SummaryInputRecord::Capture(v) => (v.event_id, "capture", &v.digest),
        SummaryInputRecord::Timeblock(v) => (v.event_id, "timeblock/1", &v.digest),
        SummaryInputRecord::Correction(v) => (v.fact.event_id, "correction/1", &v.fact.digest),
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
    let mut query = connection.prepare(
        "SELECT e.event_id,e.kind,e.digest,length(CAST(e.body AS BLOB)),e.local_seq FROM events e JOIN (SELECT event_id FROM summary_capture_sources WHERE profile_id=?1 AND occurred_at_ms BETWEEN ?2 AND ?3 UNION SELECT event_id FROM summary_block_sources WHERE profile_id=?1 AND block_id IN (SELECT value FROM json_each(?4))) selected ON selected.event_id=e.event_id WHERE e.profile_id=?1 AND e.local_seq<=?5 ORDER BY e.local_seq,e.event_id LIMIT 1001",
    )?;
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
                r.get::<_, u64>(4)?,
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
    let mut selected_captures = Vec::<(EventId, String, i64, u64)>::new();
    let mut source_order = HashMap::<EventId, (u64, String)>::new();
    for row in rows {
        let (id, kind, digest, body_bytes, local_seq) = row?;
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
                if event.occurred_at_ms < selection.from_ms
                    || event.occurred_at_ms > selection.to_ms
                {
                    return Err(CoreError::RecoveryRequired);
                }
                selected_captures.push((
                    event.event_id,
                    event.digest.clone(),
                    event.occurred_at_ms,
                    local_seq,
                ));
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
            SummaryInputRecord::Correction(_) => {}
        }
        sources.push(SummarySourceRef {
            event_id: id,
            kind,
            digest,
        });
        source_order.insert(id, (local_seq, id.to_string()));
    }

    let mut correction_candidates_scanned = 0usize;
    let mut correction_candidate_bytes = 0usize;
    let profile_text = p.to_string();
    let mut stop_correction_scan = false;
    let correction_query = super::source_index::candidates_sql();
    let mut candidates = connection.prepare(&correction_query)?;
    for (target_id, target_digest, occurred_at_ms, _target_local_seq) in &selected_captures {
        if correction_candidates_scanned >= MAX_CORRECTION_CANDIDATES_PER_SUMMARY {
            page_limit = true;
            break;
        }
        if *occurred_at_ms < selection.from_ms || *occurred_at_ms > selection.to_ms {
            continue;
        }
        if sources.len() >= MAX_SUMMARY_SOURCES {
            page_limit = true;
            break;
        }
        let remaining_global =
            MAX_CORRECTION_CANDIDATES_PER_SUMMARY - correction_candidates_scanned;
        let target_limit = MAX_CORRECTIONS_PER_CAPTURE.min(remaining_global);
        let query_limit = (target_limit + 1) as i64;
        let rows = candidates.query_map(
            params![
                profile_text.as_str(),
                target_id.to_string(),
                target_digest,
                through,
                query_limit
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, usize>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            },
        )?;
        let mut target_candidates_scanned = 0usize;
        for row in rows {
            let (stored_event, body_bytes, local_seq) = row?;
            let id: EventId = stored_event.parse()?;
            // One metadata-only lookahead establishes incompleteness. It never
            // loads a body, and a dense target does not stop the next target.
            if target_candidates_scanned >= MAX_CORRECTIONS_PER_CAPTURE {
                page_limit = true;
                omitted.push(id);
                break;
            }
            if correction_candidates_scanned >= MAX_CORRECTION_CANDIDATES_PER_SUMMARY {
                page_limit = true;
                omitted.push(id);
                stop_correction_scan = true;
                break;
            }
            target_candidates_scanned += 1;
            correction_candidates_scanned += 1;
            if body_bytes > crate::MAX_FACT_BYTES {
                return Err(CoreError::RecoveryRequired);
            }
            let next_scan_bytes = correction_candidate_bytes.checked_add(body_bytes);
            if next_scan_bytes.is_none_or(|next| next > MAX_CORRECTION_CANDIDATE_BYTES_PER_SUMMARY)
            {
                input_byte_limit = true;
                omitted.push(id);
                continue;
            }
            correction_candidate_bytes = next_scan_bytes.ok_or(CoreError::RecoveryRequired)?;
            let value = record(connection, p, id)?.ok_or(CoreError::RecoveryRequired)?;
            let SummaryInputRecord::Correction(correction) = &value else {
                return Err(CoreError::RecoveryRequired);
            };
            if correction.fact.profile_id != p
                || correction.fact.target_event_id != *target_id
                || correction.fact.target_digest.as_str() != target_digest.as_str()
            {
                return Err(CoreError::RecoveryRequired);
            }
            if sources.len() >= MAX_SUMMARY_SOURCES {
                page_limit = true;
                omitted.push(id);
                stop_correction_scan = true;
                break;
            }

            let encoded = serde_json::to_vec(&value)?.len();
            if bytes
                .checked_add(encoded)
                .is_none_or(|next| next > MAX_SUMMARY_INPUT_BYTES)
            {
                input_byte_limit = true;
                omitted.push(id);
                continue;
            }
            bytes += encoded;
            sources.push(SummarySourceRef {
                event_id: id,
                kind: "correction/1".into(),
                digest: correction.fact.digest.clone(),
            });
            source_order.insert(id, (local_seq, id.to_string()));
        }
        if stop_correction_scan {
            break;
        }
    }
    sources.sort_by_key(|source| {
        source_order
            .get(&source.event_id)
            .cloned()
            .unwrap_or((u64::MAX, source.event_id.to_string()))
    });

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
        if let SummaryInputRecord::Correction(correction) = &value {
            let selected_capture_matches = snapshot.sources.iter().any(|candidate| {
                candidate.kind == "capture"
                    && candidate.event_id == correction.fact.target_event_id
                    && candidate.digest == correction.fact.target_digest
            });
            let origin_head = snapshot
                .origin_heads
                .iter()
                .find(|head| head.origin == correction.origin);
            if !selected_capture_matches
                || correction.fact.profile_id != p
                || correction.fact.device_id != correction.origin.device_id
                || correction.origin.profile_id != p
                || correction.cursor.seq == 0
                || correction.cursor.seq > MAX_SUMMARY_SAFE_COUNTER
                || !facts::sha(&correction.cursor.hash)
                || origin_head.is_none_or(|head| head.cursor.seq < correction.cursor.seq)
            {
                return Err(facts::invalid("correction outside frozen source heads"));
            }
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
    // Compare each correction's origin position with the frozen origin heads;
    // local_seq belongs to this Core and cannot be compared after replication.
    // Core10's profile/target index narrows each probe to one capture. Work can
    // grow with that target's correction history.
    let profile = p.to_string();
    let mut correction = connection.prepare(
        "SELECT EXISTS(SELECT 1 FROM events INDEXED BY original_lifecycle_correction_target_sequence WHERE profile_id=?1 AND kind='correction/1' AND json_extract(body,'$.target_event_id')=?2 AND json_extract(body,'$.target_digest')=?3 AND EXISTS(SELECT 1 FROM origin_entries o WHERE o.profile_id=events.profile_id AND o.event_id=events.event_id AND NOT EXISTS(SELECT 1 FROM json_each(?4) h WHERE json_extract(h.value,'$.origin.device_id')=o.origin_device AND json_extract(h.value,'$.origin.restoration_epoch')=o.restoration_epoch AND json_extract(h.value,'$.cursor.seq')>=o.origin_seq)))",
    )?;
    for source in snapshot
        .sources
        .iter()
        .filter(|source| source.kind == "capture")
    {
        let newer_correction: bool = correction.query_row(
            params![
                profile.as_str(),
                source.event_id.to_string(),
                source.digest.as_str(),
                heads.as_str()
            ],
            |row| row.get(0),
        )?;
        if newer_correction {
            return Ok(true);
        }
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
