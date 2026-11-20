//! Core11 read index: unrelated correction digests must not consume a selected
//! capture's material budget. The length and ID suffixes let the bounded scan
//! inspect metadata before loading any correction body.
use crate::CoreError;
use rusqlite::{Connection, OptionalExtension, Transaction};

const NAME: &str = "summary_correction_target_digest_sequence";

fn definition() -> String {
    format!(
        "CREATE INDEX {NAME} ON events(profile_id,json_extract(body,'$.target_event_id'),json_extract(body,'$.target_digest'),local_seq,length(CAST(body AS BLOB)),event_id) WHERE kind='correction/1'"
    )
}

pub(super) fn candidates_sql() -> String {
    format!(
        "SELECT event_id,length(CAST(body AS BLOB)),local_seq FROM events INDEXED BY {NAME} WHERE profile_id=?1 AND kind='correction/1' AND json_extract(body,'$.target_event_id')=?2 AND json_extract(body,'$.target_digest')=?3 AND local_seq<=?4 ORDER BY local_seq ASC LIMIT ?5"
    )
}

pub(crate) fn migrate(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    transaction.execute_batch(&definition())?;
    validate(transaction)
}

pub(crate) fn validate(connection: &Connection) -> Result<(), CoreError> {
    let actual: Option<Option<String>> = connection.query_row(
        "SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=16384 THEN sql END FROM sqlite_schema WHERE type='index' AND name=?1",
        [NAME], |row| row.get(0),
    ).optional()?;
    if actual.flatten().as_deref() != Some(definition().as_str()) {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn correction_candidates_seek_profile_target_digest_and_snapshot_without_sorting() {
        let root = tempfile::tempdir().unwrap();
        let core = crate::Core::open(root.path()).unwrap();
        let connection = core.connection().unwrap();
        let mut statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", candidates_sql()))
            .unwrap();
        let plan = statement
            .query_map(
                rusqlite::params!["profile", "target", "digest", 100, 65],
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        assert!(plan.contains(NAME), "query plan: {plan}");
        assert!(
            plan.contains("profile_id=? AND <expr>=? AND <expr>=? AND local_seq<?"),
            "query must seek all selection keys: {plan}"
        );
        assert!(
            !plan.contains("TEMP B-TREE"),
            "bounded reader must not sort the correction history: {plan}"
        );
    }
}
