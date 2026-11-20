use crate::CoreError;
use rusqlite::{Connection, OptionalExtension, Transaction, params};

const TIMEBLOCK_INDEX: &str = "CREATE INDEX events_timeline_block_effective_at ON events(profile_id,json_extract(body,'$.effective_at_ms'),local_seq) WHERE kind='timeblock/1'";
const SUMMARY_INDEX: &str = "CREATE INDEX events_timeline_summary_occurred_at ON events(profile_id,json_extract(body,'$.occurred_at_ms'),local_seq) WHERE kind IN ('summary/1','agent_summary/1')";

pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    tx.execute_batch(TIMEBLOCK_INDEX)?;
    tx.execute_batch(SUMMARY_INDEX)?;
    validate(tx)
}

pub(crate) fn validate(connection: &Connection) -> Result<(), CoreError> {
    // Core10 validation supplies the events table in the reference schema and
    // protects its existing kinds, rows, child keys, and tag indexes.
    crate::record_organization::validate_schema(connection)?;
    for (name, expected) in [
        ("events_timeline_block_effective_at", TIMEBLOCK_INDEX),
        ("events_timeline_summary_occurred_at", SUMMARY_INDEX),
    ] {
        let actual: Option<Option<String>> = connection
            .query_row(
                "SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql END FROM sqlite_schema WHERE type='index' AND name=?1",
                params![name],
                |row| row.get(0),
            )
            .optional()?;
        if actual.flatten().as_deref() != Some(expected) {
            return Err(CoreError::RecoveryRequired);
        }
    }
    Ok(())
}
