use super::{facts, model::*};
use crate::{
    AgentId, Core, CoreError, Durability, MAX_FACT_BYTES, MAX_SUMMARY_INPUT_BYTES,
    MAX_SUMMARY_SAFE_COUNTER, OriginalRef, ProfileId, Receipt, ReplicatedFact, SummaryInputRecord,
    SummaryRemoteVisibility, SummarySourceRef,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::collections::BTreeMap;

fn source(
    connection: &Connection,
    p: ProfileId,
    expected: &SummarySourceRef,
) -> Result<Option<(u64, SummaryInputRecord)>, CoreError> {
    type Row = (u64, String, String, String, Option<String>);
    let row: Option<Row> = connection.query_row("SELECT local_seq,profile_id,kind,digest,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?2 THEN body END FROM events WHERE event_id=?1", params![expected.event_id.to_string(),MAX_FACT_BYTES], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional()?;
    row.map(|(seq, profile, kind, digest, body)| {
        if seq == 0
            || profile != p.to_string()
            || kind != expected.kind
            || digest != expected.digest
        {
            return Err(facts::invalid("source binding"));
        }
        let body = body.ok_or(CoreError::RecoveryRequired)?;
        let record = match kind.as_str() {
            "capture" => {
                let mut value: crate::EventRecord = serde_json::from_str(&body)?;
                ReplicatedFact::Capture(value.clone()).validate()?;
                if value.event_id != expected.event_id
                    || value.profile_id != p
                    || value.digest != expected.digest
                {
                    return Err(facts::invalid("source body binding"));
                }
                value.local_seq = 0;
                SummaryInputRecord::Capture(value)
            }
            "timeblock/1" => {
                let mut value: crate::TimeblockNodeRecord = serde_json::from_str(&body)?;
                ReplicatedFact::Timeblock(value.clone()).validate()?;
                if value.event_id != expected.event_id
                    || value.profile_id != p
                    || value.digest != expected.digest
                {
                    return Err(facts::invalid("source body binding"));
                }
                value.local_seq = 0;
                SummaryInputRecord::Timeblock(value)
            }
            _ => return Err(facts::invalid("derived source refused")),
        };
        Ok((seq, record))
    })
    .transpose()
}
fn material_refs(
    materials: &mut BTreeMap<String, OriginalRef>,
    input: &SummaryInputRecord,
) -> Result<(), CoreError> {
    if let SummaryInputRecord::Capture(record) = input {
        for original in &record.originals {
            if let Some(old) = materials.get(&original.original_id.to_string()) {
                if old != original {
                    return Err(facts::invalid("source material conflict"));
                }
            }
            materials.insert(original.original_id.to_string(), original.clone());
            if materials.len() > 256 {
                return Err(facts::invalid("material limit"));
            }
        }
    }
    Ok(())
}
fn freeze(
    connection: &Connection,
    p: ProfileId,
    command: &ExternalSummaryAppendCommand,
) -> Result<ExternalSummarySnapshot, CoreError> {
    let current: u64 = connection.query_row(
        "SELECT COALESCE(MAX(local_seq),0) FROM events WHERE profile_id=?1",
        [p.to_string()],
        |row| row.get(0),
    )?;
    if command.observed_through > current {
        return Err(facts::invalid("observation ahead of available history"));
    }
    let mut bytes = 0usize;
    let mut materials = BTreeMap::new();
    for reference in &command.sources {
        let (sequence, input) =
            source(connection, p, reference)?.ok_or(facts::invalid("source unavailable"))?;
        if sequence > command.observed_through {
            return Err(facts::invalid("source beyond producer observation"));
        }
        bytes = bytes
            .checked_add(serde_json::to_vec(&input)?.len())
            .ok_or(facts::invalid("input byte limit"))?;
        if bytes > MAX_SUMMARY_INPUT_BYTES {
            return Err(facts::invalid("input byte limit"));
        }
        material_refs(&mut materials, &input)?;
    }
    let materials: Vec<_> = materials.into_values().collect();
    let mut snapshot = ExternalSummarySnapshot {
        observed_through: command.observed_through,
        sources: command.sources.clone(),
        input_encoded_bytes: bytes as u64,
        coverage: ExternalSummaryCoverage {
            scope: ExternalSummaryScope::ExplicitSources,
            source_delivery: ExternalSummarySourceDelivery::NotAttested,
            remote_visibility: SummaryRemoteVisibility::Unknown,
            unread_original_ids: materials
                .iter()
                .map(|original| original.original_id)
                .collect(),
        },
        materials,
        digest: String::new(),
    };
    snapshot.seal()?;
    snapshot.validate()?;
    Ok(snapshot)
}
/// Known source contradictions are rejected. Missing cross-origin sources may
/// arrive later, so they remain unknown, never evidence of complete delivery.
/// Producer-local observed_through is deliberately not compared to local_seq.
pub(crate) fn validate_available_sources(
    connection: &Connection,
    record: &ExternalSummaryRecord,
) -> Result<(), CoreError> {
    let mut complete = true;
    let mut bytes = 0usize;
    let mut materials = BTreeMap::new();
    for reference in &record.snapshot.sources {
        if let Some((_, input)) = source(connection, record.profile_id, reference)? {
            bytes = bytes
                .checked_add(serde_json::to_vec(&input)?.len())
                .ok_or(facts::invalid("input byte limit"))?;
            if bytes as u64 > record.snapshot.input_encoded_bytes {
                return Err(facts::invalid("known source byte mismatch"));
            }
            material_refs(&mut materials, &input)?;
        } else {
            complete = false;
        }
    }
    if bytes as u64 > record.snapshot.input_encoded_bytes {
        return Err(facts::invalid("known source byte mismatch"));
    }
    for material in materials.values() {
        if !record.snapshot.materials.contains(material) {
            return Err(facts::invalid("known source material mismatch"));
        }
    }
    if complete
        && (bytes as u64 != record.snapshot.input_encoded_bytes
            || materials.into_values().collect::<Vec<_>>() != record.snapshot.materials)
    {
        return Err(facts::invalid("frozen source derivation mismatch"));
    }
    Ok(())
}
impl Core {
    /// Trusted Host factory only. Neither an HTTP body nor a peer fact can
    /// construct producer authority or turn it into an internal model ticket.
    pub fn local_external_summary_producer(
        &self,
        profile_id: ProfileId,
        agent_id: AgentId,
    ) -> Result<ExternalSummaryProducerContext, CoreError> {
        Ok(ExternalSummaryProducerContext {
            scope: self.local_agent(profile_id, agent_id)?,
            agent_id,
        })
    }
    pub fn append_external_summary(
        &self,
        producer: &ExternalSummaryProducerContext,
        command: &ExternalSummaryAppendCommand,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(&producer.scope, command.profile_id)?;
        facts::source_refs(&command.sources, command.observed_through)?;
        facts::output(&command.narrative, &command.evidence, &command.sources)?;
        if command.occurred_at_ms < 0 {
            return Err(facts::invalid("negative occurrence time"));
        }
        let input_digest = facts::hash(&(
            "external-summary-append/1",
            self.device_id(),
            producer.agent_id,
            command,
        ))?;
        let mut connection = self.connection()?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let old: Option<(String, String)> = tx
            .query_row(
                "SELECT input_digest,receipt FROM command_receipts WHERE command_id=?1",
                [command.command_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((input, raw)) = old {
            if input != input_digest {
                return Err(CoreError::CommandConflict);
            }
            let mut receipt: Receipt = serde_json::from_str(&raw)?;
            if receipt.profile_id != command.profile_id
                || receipt.command_id != command.command_id
                || receipt.event_id != command.event_id
            {
                return Err(CoreError::RecoveryRequired);
            }
            receipt.replayed = true;
            return Ok(receipt);
        }
        let snapshot = freeze(&tx, command.profile_id, command)?;
        let mut record = ExternalSummaryRecord {
            event_id: command.event_id,
            profile_id: command.profile_id,
            device_id: self.device_id(),
            producer_agent_id: producer.agent_id,
            occurred_at_ms: command.occurred_at_ms,
            snapshot,
            narrative: command.narrative.clone(),
            evidence: command.evidence.clone(),
            digest: String::new(),
            local_seq: 0,
        };
        record.digest = record.computed_digest()?;
        record.validate()?;
        let old_event: Option<(u64, String, String, String, Option<String>)> = tx
            .query_row(
                "SELECT local_seq,profile_id,kind,digest,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?2 THEN body END FROM events WHERE event_id=?1",
                params![command.event_id.to_string(),MAX_FACT_BYTES],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()?;
        let local_seq = if let Some((seq, p, kind, digest, body)) = old_event {
            if p != command.profile_id.to_string()
                || kind != EXTERNAL_SUMMARY_FACT_TYPE
                || digest != record.digest
            {
                return Err(CoreError::EventConflict);
            }
            let previous: ExternalSummaryRecord =
                serde_json::from_str(&body.ok_or(CoreError::RecoveryRequired)?)?;
            previous.validate()?;
            if previous.canonical_fact_bytes()? != record.canonical_fact_bytes()? {
                return Err(CoreError::RecoveryRequired);
            }
            seq
        } else {
            tx.execute(
                "INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,?5)",
                params![
                    record.event_id.to_string(),
                    record.profile_id.to_string(),
                    record.digest,
                    crate::fact_encoding::encode_fact(&record)?,
                    EXTERNAL_SUMMARY_FACT_TYPE
                ],
            )?;
            let sequence = tx.last_insert_rowid() as u64;
            crate::replication::record_local_fact(
                &tx,
                record.profile_id,
                record.device_id,
                record.event_id,
                EXTERNAL_SUMMARY_FACT_TYPE,
                &record.digest,
            )?;
            sequence
        };
        if local_seq > MAX_SUMMARY_SAFE_COUNTER {
            return Err(facts::invalid("safe local sequence"));
        }
        let receipt = Receipt {
            command_id: command.command_id,
            event_id: command.event_id,
            profile_id: command.profile_id,
            local_seq,
            event_digest: record.digest,
            durability: Durability::LocalCommitted,
            replayed: false,
        };
        tx.execute("INSERT INTO command_receipts(command_id,profile_id,input_digest,receipt) VALUES(?1,?2,?3,?4)",params![command.command_id.to_string(),command.profile_id.to_string(),input_digest,serde_json::to_string(&receipt)?])?;
        tx.commit()?;
        Ok(receipt)
    }
}
