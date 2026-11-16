use crate::{CoreError, ProfileId};
use rusqlite::{Connection, Transaction, params};
const OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "summary_capture_sources",
        "CREATE TABLE summary_capture_sources(event_id TEXT PRIMARY KEY REFERENCES events(event_id),profile_id TEXT NOT NULL REFERENCES profiles(id),occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0))",
    ),
    (
        "index",
        "summary_capture_range",
        "CREATE INDEX summary_capture_range ON summary_capture_sources(profile_id,occurred_at_ms,event_id)",
    ),
    (
        "table",
        "summary_block_sources",
        "CREATE TABLE summary_block_sources(profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(event_id),PRIMARY KEY(profile_id,block_id,event_id))",
    ),
    (
        "table",
        "summary_layout",
        "CREATE TABLE summary_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout_revision INTEGER NOT NULL CHECK(layout_revision=1))",
    ),
    (
        "table",
        "summary_nodes",
        "CREATE TABLE summary_nodes(event_id TEXT PRIMARY KEY REFERENCES events(event_id),profile_id TEXT NOT NULL REFERENCES profiles(id),task_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('summary_job/1','summary/1')))",
    ),
    (
        "index",
        "summary_task_nodes",
        "CREATE INDEX summary_task_nodes ON summary_nodes(profile_id,task_id)",
    ),
    (
        "table",
        "summary_auto_baseline",
        "CREATE TABLE summary_auto_baseline(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),through_local_seq INTEGER NOT NULL CHECK(through_local_seq>=0))",
    ),
    (
        "table",
        "summary_auto_candidates",
        "CREATE TABLE summary_auto_candidates(profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,creator_event_id TEXT NOT NULL REFERENCES events(event_id),state TEXT NOT NULL CHECK(state IN ('pending','created')),PRIMARY KEY(profile_id,block_id))",
    ),
    (
        "table",
        "summary_auto_scan",
        "CREATE TABLE summary_auto_scan(singleton INTEGER PRIMARY KEY CHECK(singleton=1),after_profile TEXT NOT NULL,after_block TEXT NOT NULL)",
    ),
    (
        "table",
        "summary_attempts",
        "CREATE TABLE summary_attempts(attempt_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),task_id TEXT NOT NULL,run_id TEXT NOT NULL,core_lifecycle TEXT NOT NULL,snapshot_digest TEXT NOT NULL,role_config_digest TEXT NOT NULL,attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 8),max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 8),result_command_id TEXT NOT NULL UNIQUE,result_event_id TEXT NOT NULL UNIQUE,published_event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('active','finished','failed','revoked')))",
    ),
];
pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    for (_, _, sql) in OBJECTS {
        tx.execute_batch(sql)?;
    }
    tx.execute("INSERT INTO summary_layout VALUES(1,1)", [])?;
    tx.execute("INSERT INTO summary_auto_scan VALUES(1,'','')", [])?;
    // Upgrading must not suddenly execute/charge for all historical completed
    // blocks. Explicit requests still support that history after migration.
    tx.execute("INSERT INTO summary_auto_baseline SELECT p.id,COALESCE(MAX(e.local_seq),0) FROM profiles p LEFT JOIN events e ON e.profile_id=p.id GROUP BY p.id",[])?;
    // One-time index backfill; normal freeze never deserializes unselected P
    // history. This does not create old automatic triggers or rewrite facts.
    let mut query=tx.prepare("SELECT kind,CASE WHEN length(CAST(body AS BLOB))<=?1 THEN body END FROM events WHERE kind IN ('capture','timeblock/1') ORDER BY local_seq")?;
    let mut rows = query.query([crate::MAX_FACT_BYTES])?;
    while let Some(row) = rows.next()? {
        let kind: String = row.get(0)?;
        let body: Option<String> = row.get(1)?;
        let body = body.ok_or(CoreError::RecoveryRequired)?;
        if kind == "capture" {
            let value: crate::EventRecord = serde_json::from_str(&body)?;
            super::note_capture(tx, &value)?;
        } else {
            let value: crate::TimeblockNodeRecord = serde_json::from_str(&body)?;
            super::index_timeblock(tx, &value)?;
        }
    }
    // Retain creators of unfinished old local blocks too. Reconciliation uses
    // the baseline to retire already-completed history without paid work; a
    // post-upgrade feedback (including remote import) can still trigger once.
    tx.execute("INSERT OR IGNORE INTO summary_auto_candidates SELECT e.profile_id,CASE WHEN json_extract(e.body,'$.payload.action.kind')='start' THEN json_extract(e.body,'$.payload.action.block_id') ELSE json_extract(e.body,'$.payload.action.next.block_id') END,e.event_id,'pending' FROM events e WHERE e.kind='timeblock/1' AND json_extract(e.body,'$.device_id')=(SELECT device_id FROM identity WHERE singleton=1) AND json_extract(e.body,'$.payload.kind')='action' AND json_extract(e.body,'$.payload.action.kind') IN ('start','rotate') ORDER BY e.local_seq",[])?;
    validate(tx)
}
pub(crate) fn validate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(tx, OBJECTS)?;
    let count: (i64, i64) = tx.query_row(
        "SELECT count(*),COALESCE(sum(singleton=1 AND layout_revision=1),0) FROM summary_layout",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if count != (1, 1) {
        return Err(CoreError::RecoveryRequired);
    }
    let scanner: i64 = tx.query_row(
        "SELECT count(*) FROM summary_auto_scan WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    if scanner != 1 {
        return Err(CoreError::RecoveryRequired);
    }
    let missing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM profiles p WHERE NOT EXISTS(SELECT 1 FROM summary_auto_baseline b WHERE b.profile_id=p.id))",[],|r|r.get(0))?;
    if missing {
        return Err(CoreError::RecoveryRequired);
    }
    let damaged:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM events e LEFT JOIN summary_capture_sources s ON s.event_id=e.event_id WHERE e.kind='capture' AND (s.event_id IS NULL OR s.profile_id<>e.profile_id OR s.occurred_at_ms<>json_extract(e.body,'$.occurred_at_ms'))) OR EXISTS(SELECT 1 FROM summary_capture_sources s JOIN events e ON e.event_id=s.event_id WHERE e.kind<>'capture' OR s.profile_id<>e.profile_id) OR EXISTS(SELECT 1 FROM events e LEFT JOIN summary_nodes s ON s.event_id=e.event_id WHERE e.kind IN ('summary_job/1','summary/1') AND (s.event_id IS NULL OR s.profile_id<>e.profile_id OR s.kind<>e.kind OR s.task_id<>json_extract(e.body,'$.task_id'))) OR EXISTS(SELECT 1 FROM summary_nodes s JOIN events e ON e.event_id=s.event_id WHERE s.profile_id<>e.profile_id OR s.kind<>e.kind)",[],|r|r.get(0))?;
    if damaged {
        return Err(CoreError::RecoveryRequired);
    }
    let broken_blocks:bool=tx.query_row("WITH expected(profile_id,block_id,event_id) AS (SELECT profile_id,COALESCE(json_extract(body,'$.payload.action.block_id'),json_extract(body,'$.payload.block_id'),json_extract(body,'$.payload.action.from_block_id')),event_id FROM events WHERE kind='timeblock/1' UNION SELECT profile_id,json_extract(body,'$.payload.action.next.block_id'),event_id FROM events WHERE kind='timeblock/1' AND json_extract(body,'$.payload.action.kind')='rotate') SELECT EXISTS(SELECT * FROM expected EXCEPT SELECT * FROM summary_block_sources) OR EXISTS(SELECT * FROM summary_block_sources EXCEPT SELECT * FROM expected)",[],|r|r.get(0))?;
    if broken_blocks {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
pub(crate) fn provision(tx: &Transaction<'_>, p: ProfileId) -> Result<(), CoreError> {
    tx.execute(
        "INSERT INTO summary_auto_baseline VALUES(?1,0)",
        [p.to_string()],
    )?;
    Ok(())
}
pub(crate) fn index(
    connection: &Connection,
    event: crate::EventId,
    p: ProfileId,
    task: uuid::Uuid,
    kind: &str,
) -> Result<(), CoreError> {
    connection.execute(
        "INSERT INTO summary_nodes VALUES(?1,?2,?3,?4)",
        params![event.to_string(), p.to_string(), task.to_string(), kind],
    )?;
    Ok(())
}
