use super::{
    model::*,
    projection::{Block, Point, State, ordered, revision},
};
use crate::{
    AuthorKind, CommandId, Core, CoreError, DeviceId, Durability, EventId, EventQuery,
    MAX_EVENT_PAGE_SIZE, ProfileId, Receipt, TimeblockId, WriterContext,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn hash(value: &impl Serialize) -> Result<String, CoreError> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
fn load_nodes(
    connection: &Connection,
    profile: ProfileId,
) -> Result<Vec<TimeblockNodeRecord>, CoreError> {
    let mut statement=connection.prepare("SELECT local_seq,body FROM events WHERE profile_id=?1 AND kind='timeblock/1' ORDER BY local_seq")?;
    let rows = statement.query_map([profile.to_string()], |row| {
        Ok((row.get::<_, u64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut nodes = vec![];
    for row in rows {
        let (seq, body) = row?;
        let mut node: TimeblockNodeRecord = serde_json::from_str(&body)?;
        node.local_seq = seq;
        nodes.push(node);
    }
    Ok(nodes)
}
fn state(connection: &Connection, profile: ProfileId) -> Result<State, CoreError> {
    let cached: Option<(String, String)> = connection
        .query_row(
            "SELECT revision,body FROM timeblock_state WHERE profile_id=?1",
            [profile.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((revision, body)) = cached {
        let state: State = serde_json::from_str(&body)?;
        if state.revision().0 != revision {
            return Err(CoreError::InvalidTimeblockHistory);
        }
        return Ok(state);
    }
    // It is a rebuildable projection, not another source of business truth.
    let mut state = State::default();
    for node in ordered(&load_nodes(connection, profile)?, profile)? {
        state.apply(&node, &mut vec![])?;
    }
    Ok(state)
}
fn store_state(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    state: &State,
) -> Result<(), CoreError> {
    transaction.execute("INSERT INTO timeblock_state VALUES(?1,?2,?3) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![profile.to_string(),state.revision().0,serde_json::to_string(state)?])?;
    Ok(())
}
fn point(stamp: &ClockStamp) -> Point {
    Point {
        wall_ms: stamp.wall_ms,
        clock: stamp.clock.clone(),
    }
}
fn owner(connection: &Connection) -> Result<(DeviceId, u64, bool), CoreError> {
    let (device, generation, active): (String, u64, bool) = connection.query_row(
        "SELECT device_id,generation,active FROM timeblock_scheduler_owner WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok((device.parse()?, generation, active))
}
fn mode_name(mode: CountdownEndMode) -> &'static str {
    match mode {
        CountdownEndMode::Soft => "soft",
        CountdownEndMode::Hard => "hard",
    }
}
fn parse_mode(mode: &str) -> Result<CountdownEndMode, CoreError> {
    match mode {
        "soft" => Ok(CountdownEndMode::Soft),
        "hard" => Ok(CountdownEndMode::Hard),
        _ => Err(CoreError::InvalidTimeblockHistory),
    }
}
fn refresh_deadline(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    state: &State,
    stamp: &ClockStamp,
) -> Result<(), CoreError> {
    let candidate = state
        .active
        .and_then(|id| state.blocks.get(&id.to_string()))
        .filter(|block| block.phase == TimeblockPhase::Running && !block.deadline_reached);
    let (_, owner_generation, owner_active) = owner(transaction)?;
    if let Some(block) = candidate {
        if let TimerSpec::CountDown {
            duration_ms,
            end_mode,
        } = block.spec.timer
        {
            transaction.execute("UPDATE timeblock_deadlines SET state='cancelled' WHERE profile_id=?1 AND state='pending' AND (block_id<>?2 OR generation<>?3)",params![profile.to_string(),block.spec.block_id.to_string(),block.generation])?;
            if !owner_active {
                return Ok(());
            }
            let exists:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM timeblock_deadlines WHERE profile_id=?1 AND block_id=?2 AND generation=?3)",params![profile.to_string(),block.spec.block_id.to_string(),block.generation],|row|row.get(0))?;
            if !exists {
                let remaining = duration_ms.saturating_sub(block.work_at(&point(stamp)));
                let due_wall = stamp
                    .wall_ms
                    .checked_add(remaining as i64)
                    .ok_or(CoreError::InvalidTimeblock("deadline overflow"))?;
                let due_elapsed = stamp
                    .clock
                    .elapsed_ms
                    .checked_add(remaining)
                    .filter(|value| *value <= i64::MAX as u64)
                    .ok_or(CoreError::InvalidTimeblock("deadline overflow"))?;
                transaction.execute("INSERT INTO timeblock_deadlines VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8,?9,?10,?11)",params![Uuid::new_v4().to_string(),profile.to_string(),block.spec.block_id.to_string(),block.generation,owner_generation,CommandId::new().to_string(),EventId::new().to_string(),due_wall,due_elapsed,stamp.clock.epoch_id.to_string(),mode_name(end_mode)])?;
            }
            return Ok(());
        }
    }
    transaction.execute(
        "UPDATE timeblock_deadlines SET state='cancelled' WHERE profile_id=?1 AND state='pending'",
        [profile.to_string()],
    )?;
    Ok(())
}
#[derive(Serialize)]
struct NodeFact<'a> {
    kind: &'static str,
    event_id: EventId,
    profile_id: ProfileId,
    device_id: DeviceId,
    source: &'a TimeblockSource,
    parents: &'a [EventId],
    occurred_at_ms: i64,
    effective_at_ms: i64,
    clock: &'a NodeClock,
    payload: &'a TimeblockPayload,
}
pub(super) fn node_digest(node: &TimeblockNodeRecord) -> Result<String, CoreError> {
    hash(&NodeFact {
        kind: "timeblock/1",
        event_id: node.event_id,
        profile_id: node.profile_id,
        device_id: node.device_id,
        source: &node.source,
        parents: &node.parents,
        occurred_at_ms: node.occurred_at_ms,
        effective_at_ms: node.effective_at_ms,
        clock: &node.clock,
        payload: &node.payload,
    })
}
fn receipt(
    transaction: &Transaction<'_>,
    command: CommandId,
    input_hash: &str,
) -> Result<Option<Receipt>, CoreError> {
    let row: Option<(String, String)> = transaction
        .query_row(
            "SELECT input_digest,receipt FROM command_receipts WHERE command_id=?1",
            [command.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    row.map(|(previous, body)| {
        if previous != input_hash {
            return Err(CoreError::CommandConflict);
        }
        let mut receipt: Receipt = serde_json::from_str(&body)?;
        receipt.replayed = true;
        Ok(receipt)
    })
    .transpose()
}
fn save_receipt(
    transaction: &Transaction<'_>,
    command: CommandId,
    node: &TimeblockNodeRecord,
    input_hash: &str,
) -> Result<Receipt, CoreError> {
    let receipt = Receipt {
        command_id: command,
        event_id: node.event_id,
        profile_id: node.profile_id,
        local_seq: node.local_seq,
        event_digest: node.digest.clone(),
        durability: Durability::LocalCommitted,
        replayed: false,
    };
    transaction.execute(
        "INSERT INTO command_receipts VALUES(?1,?2,?3,?4)",
        params![
            command.to_string(),
            node.profile_id.to_string(),
            input_hash,
            serde_json::to_string(&receipt)?
        ],
    )?;
    Ok(receipt)
}
fn append(
    transaction: &Transaction<'_>,
    node: &mut TimeblockNodeRecord,
    input_hash: &str,
    state: &mut State,
    stamp: &ClockStamp,
) -> Result<(), CoreError> {
    node.digest = node_digest(node)?;
    transaction.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,'timeblock/1')",params![node.event_id.to_string(),node.profile_id.to_string(),node.digest,serde_json::to_string(node)?])?;
    node.local_seq = transaction.last_insert_rowid() as u64;
    transaction.execute(
        "INSERT INTO timeblock_nodes VALUES(?1,?2)",
        params![node.event_id.to_string(), input_hash],
    )?;
    state.apply(node, &mut vec![])?;
    store_state(transaction, node.profile_id, state)?;
    refresh_deadline(transaction, node.profile_id, state, stamp)?;
    Ok(())
}

fn command_hash(context: &WriterContext, input: &TimeblockCommand) -> Result<String, CoreError> {
    #[derive(Serialize)]
    struct Request<'a> {
        kind: &'static str,
        profile: ProfileId,
        event: EventId,
        device: DeviceId,
        author: Uuid,
        expected_revision: &'a TimeblockRevision,
        action: &'a TimeblockAction,
    }
    hash(&Request {
        kind: "timeblock-command/1",
        profile: input.profile_id,
        event: input.event_id,
        device: context.device_id,
        author: context.author_id,
        expected_revision: &input.expected_revision,
        action: &input.action,
    })
}

impl Core {
    pub fn trusted_clock_stamp(
        &self,
        epoch: Uuid,
        wall_ms: i64,
        elapsed_ms: u64,
    ) -> Result<ClockStamp, CoreError> {
        if epoch.is_nil() || wall_ms < 0 || elapsed_ms > i64::MAX as u64 {
            return Err(CoreError::InvalidTimeblock("clock sample outside bounds"));
        }
        Ok(ClockStamp {
            lifecycle: self.lifecycle(),
            wall_ms,
            clock: NodeClock {
                epoch_id: epoch,
                elapsed_ms,
            },
        })
    }
    fn check_clock(&self, stamp: &ClockStamp) -> Result<(), CoreError> {
        if stamp.lifecycle != self.lifecycle() {
            Err(CoreError::ForeignContext)
        } else {
            Ok(())
        }
    }
    pub fn local_scheduler(&self) -> SchedulerContext {
        SchedulerContext {
            lifecycle: self.lifecycle(),
            device_id: self.device_id(),
        }
    }
    fn check_scheduler(&self, context: &SchedulerContext) -> Result<(), CoreError> {
        if context.lifecycle != self.lifecycle() || context.device_id != self.device_id() {
            Err(CoreError::ForeignContext)
        } else {
            Ok(())
        }
    }
    pub fn apply_timeblock(
        &self,
        context: &WriterContext,
        input: &TimeblockCommand,
        stamp: &ClockStamp,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, input.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::TimeblockControlDenied);
        }
        let request_hash = command_hash(context, input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(saved) = receipt(&transaction, input.command_id, &request_hash)? {
            return Ok(saved);
        }
        // Event replay also precedes current time/revision checks. A new command
        // may acknowledge the same immutable fact without executing it again.
        let existing:Option<(u64,String,Option<String>)>=transaction.query_row("SELECT e.local_seq,e.body,n.request_digest FROM events e LEFT JOIN timeblock_nodes n ON n.event_id=e.event_id WHERE e.event_id=?1",[input.event_id.to_string()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        if let Some((seq, body, previous)) = existing {
            if previous.as_deref() != Some(request_hash.as_str()) {
                return Err(CoreError::EventConflict);
            }
            let mut node: TimeblockNodeRecord = serde_json::from_str(&body)?;
            node.local_seq = seq;
            let result = save_receipt(&transaction, input.command_id, &node, &request_hash)?;
            transaction.commit()?;
            return Ok(result);
        }
        self.check_clock(stamp)?;
        let mut state = state(&transaction, input.profile_id)?;
        if state.revision() != input.expected_revision {
            return Err(CoreError::TimeblockConflict);
        }
        state.validate(&input.action)?;
        let mut node = TimeblockNodeRecord {
            event_id: input.event_id,
            profile_id: input.profile_id,
            device_id: self.device_id(),
            source: TimeblockSource {
                kind: TimeblockSourceKind::Human,
                author_id: context.author_id,
                owner_generation: None,
            },
            parents: state.heads.clone(),
            occurred_at_ms: stamp.wall_ms,
            effective_at_ms: stamp.wall_ms.max(state.last_boundary),
            clock: stamp.clock.clone(),
            payload: TimeblockPayload::Action {
                action: input.action.clone(),
            },
            digest: String::new(),
            local_seq: 0,
        };
        append(&transaction, &mut node, &request_hash, &mut state, stamp)?;
        let result = save_receipt(&transaction, input.command_id, &node, &request_hash)?;
        transaction.commit()?;
        Ok(result)
    }
    /// Read the stable command/caller receipt before the host advances its
    /// clock. This is not a reservation; apply_timeblock repeats the check in
    /// its final transaction, and no caller-provided time enters the digest.
    pub fn timeblock_command_receipt(
        &self,
        context: &WriterContext,
        input: &TimeblockCommand,
    ) -> Result<Option<Receipt>, CoreError> {
        self.check_scope(context, input.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::TimeblockControlDenied);
        }
        let input_hash = command_hash(context, input)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        receipt(&transaction, input.command_id, &input_hash)
    }
    pub fn timeblock_snapshot(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        stamp: &ClockStamp,
    ) -> Result<TimeblockSnapshot, CoreError> {
        self.check_scope(context, profile)?;
        self.check_clock(stamp)?;
        let connection = self.connection()?;
        let state = state(&connection, profile)?;
        let selected = state
            .active
            .and_then(|id| state.blocks.get(&id.to_string()));
        let clock = ClockStatus {
            server_now_ms: stamp.wall_ms,
            epoch_changed: selected
                .is_some_and(|block| block.last_clock.clock.epoch_id != stamp.clock.epoch_id),
            wall_clock_moved_back: selected.is_some_and(|block| {
                let anchor = block.run_anchor.as_ref().unwrap_or(&block.last_clock);
                if anchor.clock.epoch_id == stamp.clock.epoch_id {
                    stamp.wall_ms.saturating_add(100)
                        < anchor.wall_ms.saturating_add(
                            stamp
                                .clock
                                .elapsed_ms
                                .saturating_sub(anchor.clock.elapsed_ms)
                                as i64,
                        )
                } else {
                    stamp.wall_ms < anchor.wall_ms
                }
            }),
        };
        let active = selected
            .map(|block| -> Result<ActiveTimeblock, CoreError> {
                Ok(ActiveTimeblock {
                    block_id: block.spec.block_id,
                    name: block.spec.name.clone(),
                    note: block.spec.note.clone(),
                    timer: block.spec.timer.clone(),
                    phase: block.phase,
                    work_ms: block.work_at(&point(stamp)),
                    deadline_reached: block.deadline_reached,
                    deadline: deadline_snapshot(&connection, profile, block, stamp)?,
                })
            })
            .transpose()?;
        Ok(TimeblockSnapshot {
            profile_id: profile,
            revision: state.revision(),
            heads: state.heads,
            active,
            pending_feedback: state
                .blocks
                .values()
                .filter(|block| block.pending_feedback)
                .map(|block| block.spec.block_id)
                .collect(),
            clock,
        })
    }
    pub fn timeblock_nodes(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<TimeblockNodePage, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let (highwater, through, before) = page_bounds(&connection, profile, query)?;
        let mut statement=connection.prepare("SELECT local_seq,body FROM events WHERE profile_id=?1 AND kind='timeblock/1' AND local_seq<=?2 AND (?3 IS NULL OR local_seq<?3) AND (?4 IS NULL OR instr(body,?4)>0) ORDER BY local_seq DESC LIMIT ?5")?;
        let rows = statement.query_map(
            params![
                profile.to_string(),
                through,
                i64::try_from(before).ok(),
                query.search,
                (query.limit + 1) as u64
            ],
            |row| Ok((row.get::<_, u64>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut items = vec![];
        for row in rows {
            let (seq, body) = row?;
            let mut node: TimeblockNodeRecord = serde_json::from_str(&body)?;
            node.local_seq = seq;
            items.push(node);
        }
        let more = items.len() > query.limit;
        items.truncate(query.limit);
        let next_before = if more {
            items.last().map(|node| node.local_seq)
        } else {
            None
        };
        Ok(TimeblockNodePage {
            items,
            next_before,
            highwater,
        })
    }
    pub fn timeblock_intervals(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &IntervalQuery,
    ) -> Result<IntervalPage, CoreError> {
        self.check_scope(context, profile)?;
        if query.limit == 0 || query.limit > MAX_EVENT_PAGE_SIZE {
            return Err(CoreError::InvalidQuery("interval limit"));
        }
        let connection = self.connection()?;
        let mut nodes = ordered(&load_nodes(&connection, profile)?, profile)?;
        if let Some(wanted) = &query.through {
            let mut prefix = vec![];
            let mut current = State::default();
            let mut matched = current.revision() == *wanted;
            if !matched {
                for node in nodes {
                    current.apply(&node, &mut vec![])?;
                    prefix.push(node);
                    if current.revision() == *wanted {
                        matched = true;
                        break;
                    }
                }
            }
            if !matched {
                return Err(CoreError::InvalidQuery("unknown timeblock snapshot"));
            }
            nodes = prefix;
        }
        let projection = super::projection::project_timeblocks(
            profile,
            &nodes,
            &ProjectionQuery {
                from_ms: query.from_ms,
                to_ms: query.to_ms,
            },
        )?;
        let revision = revision(&projection.heads);
        let mut items = projection.intervals;
        let complete = items.len() <= query.limit;
        items.truncate(query.limit);
        let next_from_ms = if complete {
            None
        } else {
            items.last().map(|item| item.to_ms)
        };
        Ok(IntervalPage {
            items,
            revision,
            next_from_ms,
            complete,
        })
    }
    pub fn timeline_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<TimelinePage, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let (highwater, through, before) = page_bounds(&connection, profile, query)?;
        let mut statement=connection.prepare("SELECT local_seq,kind,body FROM events WHERE profile_id=?1 AND local_seq<=?2 AND (?3 IS NULL OR local_seq<?3) AND (?4 IS NULL OR instr(body,?4)>0) ORDER BY local_seq DESC LIMIT ?5")?;
        let rows = statement.query_map(
            params![
                profile.to_string(),
                through,
                i64::try_from(before).ok(),
                query.search,
                (query.limit + 1) as u64
            ],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?;
        let mut items = vec![];
        let mut last_seq = vec![];
        for row in rows {
            let (seq, kind, body) = row?;
            last_seq.push(seq);
            match kind.as_str() {
                "capture" => {
                    let mut event: crate::EventRecord = serde_json::from_str(&body)?;
                    event.local_seq = seq;
                    items.push(TimelineItem::Capture(event));
                }
                "timeblock/1" => {
                    let mut node: TimeblockNodeRecord = serde_json::from_str(&body)?;
                    node.local_seq = seq;
                    items.push(TimelineItem::Timeblock(node));
                }
                _ => return Err(CoreError::InvalidTimeblockHistory),
            }
        }
        let more = items.len() > query.limit;
        items.truncate(query.limit);
        let next_before = if more {
            last_seq.get(query.limit - 1).copied()
        } else {
            None
        };
        Ok(TimelinePage {
            items,
            next_before,
            highwater,
        })
    }
}

fn page_bounds(
    connection: &Connection,
    profile: ProfileId,
    query: &EventQuery,
) -> Result<(u64, u64, u64), CoreError> {
    if query.limit == 0
        || query.limit > MAX_EVENT_PAGE_SIZE
        || query.search.as_ref().is_some_and(|q| q.len() > 1024)
    {
        return Err(CoreError::InvalidQuery("page bounds"));
    }
    let current: u64 = connection.query_row(
        "SELECT COALESCE(MAX(local_seq),0) FROM events WHERE profile_id=?1",
        [profile.to_string()],
        |row| row.get(0),
    )?;
    let through = query.through.unwrap_or(current);
    if through > current {
        return Err(CoreError::InvalidQuery("future snapshot"));
    }
    let before = query.before.unwrap_or(through.saturating_add(1));
    if before == 0 || before > through.saturating_add(1) {
        return Err(CoreError::InvalidQuery("before cursor"));
    }
    Ok((through, through, before))
}
fn deadline_snapshot(
    connection: &Connection,
    profile: ProfileId,
    block: &Block,
    stamp: &ClockStamp,
) -> Result<Option<DeadlineSnapshot>, CoreError> {
    let row:Option<(String,u64,i64,String)>=connection.query_row("SELECT deadline_id,owner_generation,due_wall_ms,end_mode FROM timeblock_deadlines WHERE profile_id=?1 AND block_id=?2 AND generation=?3 AND state='pending'",params![profile.to_string(),block.spec.block_id.to_string(),block.generation],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
    row.map(|(id, generation, due, mode)| {
        let (device, current, active) = owner(connection)?;
        let duration = match block.spec.timer {
            TimerSpec::CountDown { duration_ms, .. } => duration_ms,
            _ => 0,
        };
        Ok(DeadlineSnapshot {
            deadline_id: Uuid::parse_str(&id)?,
            generation: block.generation,
            owner_device_id: device,
            owner_generation: generation,
            due_at_ms: due,
            remaining_ms: duration.saturating_sub(block.work_at(&point(stamp))),
            end_mode: parse_mode(&mode)?,
            eligible: active && current == generation,
        })
    })
    .transpose()
}

struct DeadlineRow {
    profile: ProfileId,
    block: TimeblockId,
    generation: u64,
    owner_generation: u64,
    command: CommandId,
    event: EventId,
    state: String,
    wall: i64,
    elapsed: u64,
    epoch: Uuid,
    mode: CountdownEndMode,
}
fn deadline(connection: &Connection, id: Uuid) -> Result<Option<DeadlineRow>, CoreError> {
    let row:Option<(String,String,u64,u64,String,String,String,i64,u64,String,String)>=connection.query_row("SELECT profile_id,block_id,generation,owner_generation,command_id,event_id,state,due_wall_ms,due_elapsed_ms,clock_epoch,end_mode FROM timeblock_deadlines WHERE deadline_id=?1",[id.to_string()],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?,row.get(9)?,row.get(10)?))).optional()?;
    row.map(|r| {
        Ok(DeadlineRow {
            profile: r.0.parse()?,
            block: r.1.parse()?,
            generation: r.2,
            owner_generation: r.3,
            command: r.4.parse()?,
            event: r.5.parse()?,
            state: r.6,
            wall: r.7,
            elapsed: r.8,
            epoch: Uuid::parse_str(&r.9)?,
            mode: parse_mode(&r.10)?,
        })
    })
    .transpose()
}
impl Core {
    pub fn due_deadlines(
        &self,
        context: &SchedulerContext,
        stamp: &ClockStamp,
        limit: usize,
    ) -> Result<Vec<DeadlineTicket>, CoreError> {
        self.due_deadlines_matching(context, stamp, limit, None)
    }
    pub fn due_deadlines_for_profile(
        &self,
        context: &SchedulerContext,
        profile: ProfileId,
        stamp: &ClockStamp,
    ) -> Result<Vec<DeadlineTicket>, CoreError> {
        self.due_deadlines_matching(context, stamp, MAX_EVENT_PAGE_SIZE, Some(profile))
    }
    fn due_deadlines_matching(
        &self,
        context: &SchedulerContext,
        stamp: &ClockStamp,
        limit: usize,
        profile: Option<ProfileId>,
    ) -> Result<Vec<DeadlineTicket>, CoreError> {
        self.check_scheduler(context)?;
        self.check_clock(stamp)?;
        if limit == 0 || limit > MAX_EVENT_PAGE_SIZE {
            return Err(CoreError::InvalidQuery("deadline limit"));
        }
        let connection = self.connection()?;
        let (device, generation, active) = owner(&connection)?;
        if !active || device != self.device_id() {
            return Ok(vec![]);
        }
        let mut statement=connection.prepare("SELECT deadline_id,profile_id,block_id,generation FROM timeblock_deadlines WHERE state='pending' AND owner_generation=?1 AND ((clock_epoch=?2 AND due_elapsed_ms<=?3) OR(clock_epoch<>?2 AND due_wall_ms<=?4)) AND (?6 IS NULL OR profile_id=?6) ORDER BY due_wall_ms,deadline_id LIMIT ?5")?;
        let rows = statement.query_map(
            params![
                generation,
                stamp.clock.epoch_id.to_string(),
                stamp.clock.elapsed_ms,
                stamp.wall_ms,
                limit as u64,
                profile.map(|id| id.to_string())
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u64>(3)?,
                ))
            },
        )?;
        let mut tickets = vec![];
        for row in rows {
            let (id, profile, block, g) = row?;
            tickets.push(DeadlineTicket {
                lifecycle: self.lifecycle(),
                deadline_id: Uuid::parse_str(&id)?,
                profile_id: profile.parse()?,
                block_id: block.parse()?,
                generation: g,
                owner_generation: generation,
            });
        }
        Ok(tickets)
    }
    pub fn complete_deadline(
        &self,
        context: &SchedulerContext,
        ticket: &DeadlineTicket,
        stamp: &ClockStamp,
    ) -> Result<DeadlineOutcome, CoreError> {
        self.check_scheduler(context)?;
        self.check_clock(stamp)?;
        if ticket.lifecycle != self.lifecycle() {
            return Ok(DeadlineOutcome::Stale);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (device, generation, active) = owner(&transaction)?;
        if !active || device != self.device_id() || generation != ticket.owner_generation {
            return Ok(DeadlineOutcome::Stale);
        }
        let Some(row) = deadline(&transaction, ticket.deadline_id)? else {
            return Ok(DeadlineOutcome::Stale);
        };
        if row.profile != ticket.profile_id
            || row.block != ticket.block_id
            || row.generation != ticket.generation
            || row.owner_generation != generation
        {
            return Ok(DeadlineOutcome::Stale);
        }
        let request_hash = hash(&(
            "timeblock-deadline/1",
            ticket.deadline_id,
            row.generation,
            row.owner_generation,
        ))?;
        if row.state == "done" {
            return Ok(receipt(&transaction, row.command, &request_hash)?
                .map(DeadlineOutcome::Applied)
                .unwrap_or(DeadlineOutcome::Stale));
        }
        if row.state != "pending"
            || if row.epoch == stamp.clock.epoch_id {
                stamp.clock.elapsed_ms < row.elapsed
            } else {
                stamp.wall_ms < row.wall
            }
        {
            return Ok(DeadlineOutcome::Stale);
        }
        let mut state = state(&transaction, row.profile)?;
        if state.active != Some(row.block)
            || !state
                .blocks
                .get(&row.block.to_string())
                .is_some_and(|block| {
                    block.generation == row.generation
                        && block.phase == TimeblockPhase::Running
                        && !block.deadline_reached
                })
        {
            return Ok(DeadlineOutcome::Stale);
        }
        let mut node = TimeblockNodeRecord {
            event_id: row.event,
            profile_id: row.profile,
            device_id: self.device_id(),
            source: TimeblockSource {
                kind: TimeblockSourceKind::Scheduler,
                author_id: Uuid::parse_str(&device.to_string())?,
                owner_generation: Some(generation),
            },
            parents: state.heads.clone(),
            occurred_at_ms: stamp.wall_ms,
            effective_at_ms: row.wall.max(state.last_boundary),
            clock: stamp.clock.clone(),
            payload: TimeblockPayload::DeadlineReached {
                block_id: row.block,
                deadline_id: ticket.deadline_id,
                generation: row.generation,
                end_mode: row.mode,
                due_wall_ms: row.wall,
                due_elapsed_ms: row.elapsed,
                clock_epoch: row.epoch,
            },
            digest: String::new(),
            local_seq: 0,
        };
        append(&transaction, &mut node, &request_hash, &mut state, stamp)?;
        transaction.execute(
            "UPDATE timeblock_deadlines SET state='done' WHERE deadline_id=?1",
            [ticket.deadline_id.to_string()],
        )?;
        let result = save_receipt(&transaction, row.command, &node, &request_hash)?;
        transaction.commit()?;
        Ok(DeadlineOutcome::Applied(result))
    }
    /// Trusted Rust membership/owner control, never a caller-selected HTTP role.
    pub fn revoke_scheduler_owner(&self, context: &SchedulerContext) -> Result<(), CoreError> {
        self.check_scheduler(context)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("UPDATE timeblock_scheduler_owner SET active=0,generation=generation+1 WHERE singleton=1",[])?;
        transaction.execute(
            "UPDATE timeblock_deadlines SET state='cancelled' WHERE state='pending'",
            [],
        )?;
        transaction.commit()?;
        Ok(())
    }
}
