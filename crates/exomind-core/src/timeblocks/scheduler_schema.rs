use super::{
    projection::{State, ordered},
    store::{legacy_run_binding, load_nodes, store_state},
};
use crate::{CommandId, CoreError, DeviceId, EventId, ProfileId, TimeblockId};
use rusqlite::{Transaction, params};

const OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "timeblock_deadlines",
        "CREATE TABLE timeblock_deadlines(deadline_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,generation INTEGER NOT NULL,owner_generation INTEGER NOT NULL,command_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('pending','done','cancelled')),due_wall_ms INTEGER NOT NULL,due_elapsed_ms INTEGER NOT NULL,clock_epoch TEXT NOT NULL,end_mode TEXT NOT NULL CHECK(end_mode IN ('soft','hard')),run_event_id TEXT REFERENCES events(event_id),CHECK(state<>'pending' OR run_event_id IS NOT NULL),UNIQUE(profile_id,block_id,run_event_id))",
    ),
    (
        "index",
        "timeblock_deadline_due",
        "CREATE INDEX timeblock_deadline_due ON timeblock_deadlines(state,due_wall_ms)",
    ),
];
// Historical schema3/schema4 definitions are an admission contract, not a
// repair template. A weakened old table must not be normalized by upgrading it.
const LEGACY_OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "timeblock_deadlines",
        "CREATE TABLE timeblock_deadlines(deadline_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),block_id TEXT NOT NULL,generation INTEGER NOT NULL,owner_generation INTEGER NOT NULL,command_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('pending','done','cancelled')),due_wall_ms INTEGER NOT NULL,due_elapsed_ms INTEGER NOT NULL,clock_epoch TEXT NOT NULL,end_mode TEXT NOT NULL CHECK(end_mode IN ('soft','hard')),UNIQUE(profile_id,block_id,generation))",
    ),
    (
        "index",
        "timeblock_deadline_due",
        "CREATE INDEX timeblock_deadline_due ON timeblock_deadlines(state,due_wall_ms)",
    ),
];
pub(crate) fn migrate(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(transaction, LEGACY_OBJECTS)?;
    let local: DeviceId = transaction
        .query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get::<_, String>(0),
        )?
        .parse()?;
    transaction.execute_batch("DROP INDEX timeblock_deadline_due; ALTER TABLE timeblock_deadlines RENAME TO timeblock_deadlines_schema4;")?;
    for (_, _, ddl) in OBJECTS {
        transaction.execute_batch(ddl)?;
    }
    let mut statement=transaction.prepare("SELECT deadline_id,profile_id,block_id,generation,owner_generation,command_id,event_id,state,due_wall_ms,due_elapsed_ms,clock_epoch,end_mode FROM timeblock_deadlines_schema4 ORDER BY deadline_id")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let profile: String = row.get(1)?;
        let block: String = row.get(2)?;
        let generation: u64 = row.get(3)?;
        let owner: u64 = row.get(4)?;
        let command: String = row.get(5)?;
        let event: String = row.get(6)?;
        let state: String = row.get(7)?;
        let wall: i64 = row.get(8)?;
        let elapsed: u64 = row.get(9)?;
        let epoch: String = row.get(10)?;
        let mode: String = row.get(11)?;
        let parsed_profile = profile
            .parse::<ProfileId>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        let parsed_block = block
            .parse::<TimeblockId>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        let parsed_id = id
            .parse::<uuid::Uuid>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        let parsed_epoch = epoch
            .parse::<uuid::Uuid>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        command
            .parse::<CommandId>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        event
            .parse::<EventId>()
            .map_err(|_| CoreError::RecoveryRequired)?;
        if parsed_id.is_nil()
            || parsed_epoch.is_nil()
            || generation == 0
            || owner == 0
            || generation > i64::MAX as u64
            || owner > i64::MAX as u64
            || wall < 0
            || elapsed > i64::MAX as u64
            || !matches!(state.as_str(), "pending" | "done" | "cancelled")
            || !matches!(mode.as_str(), "soft" | "hard")
        {
            return Err(CoreError::RecoveryRequired);
        }
        let run = if state == "pending" {
            let used:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM command_receipts WHERE command_id=?1) OR EXISTS(SELECT 1 FROM events WHERE event_id=?2)",params![command,event],|row|row.get(0))?;
            if used {
                return Err(CoreError::RecoveryRequired);
            }
            let profile = parsed_profile;
            let mut projected = State::default();
            for node in ordered(&load_nodes(transaction, profile)?, profile)? {
                projected.apply(&node, &mut vec![])?;
            }
            Some(
                legacy_run_binding(
                    transaction,
                    local,
                    profile,
                    parsed_block,
                    generation,
                    owner,
                    wall,
                    elapsed,
                    &epoch,
                    &mode,
                    &projected,
                )?
                .to_string(),
            )
        } else {
            None
        };
        transaction.execute(
            "INSERT INTO timeblock_deadlines VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                id, profile, block, generation, owner, command, event, state, wall, elapsed, epoch,
                mode, run
            ],
        )?;
    }
    drop(rows);
    drop(statement);
    transaction.execute_batch("DROP TABLE timeblock_deadlines_schema4;")?;
    // The old JSON is only a cache. Persist the new attribution once after
    // strict pending-intent binding, so ordinary reads do not replay all old
    // history merely because an older cache omitted the run UUID.
    let profiles = transaction
        .prepare("SELECT profile_id FROM replication_projection_status WHERE status='complete'")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for profile in profiles {
        let profile = profile.parse()?;
        let mut projected = State::default();
        for node in ordered(&load_nodes(transaction, profile)?, profile)? {
            projected.apply(&node, &mut vec![])?;
        }
        store_state(transaction, profile, &projected)?;
    }
    validate(transaction)
}
pub(crate) fn validate(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(transaction, OBJECTS)?;
    let invalid:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM timeblock_deadlines WHERE state='pending' AND (run_event_id IS NULL OR typeof(run_event_id)<>'text' OR length(run_event_id)<>36))",[],|row|row.get(0))?;
    if invalid {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
