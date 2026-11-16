use super::{
    ImportAck, MAX_ORIGIN_PAGE_BYTES, OriginCursor, OriginEntry, OriginIdentity, OriginPage,
    ReplicaContext, ReplicatedFact,
    facts::load_fact,
    origin,
    transfer::{cursor_at, encoded_size, identity, receiver_cursor},
};
use crate::{Core, CoreError, EventId, OriginalRef};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::HashSet;

struct Conflict {
    seq: u64,
    event: EventId,
    expected: Option<String>,
    received: String,
    reason: &'static str,
}
fn conflicting(
    slot: &mut Option<Conflict>,
    entry: &OriginEntry,
    expected: Option<String>,
    reason: &'static str,
) -> CoreError {
    *slot = Some(Conflict {
        seq: entry.origin_seq,
        event: entry.fact.event_id(),
        expected,
        received: entry.fact.digest().into(),
        reason,
    });
    CoreError::ReplicationConflict {
        event_id: entry.fact.event_id(),
        origin_seq: entry.origin_seq,
    }
}
fn valid_cursor(cursor: &OriginCursor) -> bool {
    cursor.seq <= i64::MAX as u64
        && cursor.hash.len() == 64
        && cursor
            .hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_page(context: &ReplicaContext, page: &OriginPage) -> Result<(), CoreError> {
    if page.origin.profile_id != context.profile_id {
        return Err(CoreError::ScopeMismatch);
    }
    if page.origin != identity(context) {
        return Err(CoreError::InvalidReplication(
            "not an authenticated direct origin",
        ));
    }
    if page.entries.len() > 100
        || !valid_cursor(&page.from)
        || !valid_cursor(&page.to)
        || !valid_cursor(&page.through)
        || page.to.seq.checked_sub(page.from.seq) != Some(page.entries.len() as u64)
        || page.to.seq > page.through.seq
        || page.has_more != (page.to.seq < page.through.seq)
        || page.entries.is_empty() && page.has_more
    {
        return Err(CoreError::InvalidReplication("invalid origin page range"));
    }
    let mut previous = page.from.clone();
    let mut events = HashSet::new();
    for entry in &page.entries {
        entry.fact.validate()?;
        if entry.fact.profile_id() != page.origin.profile_id
            || entry.fact.device_id() != page.origin.device_id
        {
            return Err(CoreError::InvalidReplication(
                "relayed or cross-profile fact",
            ));
        }
        if entry.origin_seq != previous.seq + 1
            || !events.insert(entry.fact.event_id())
            || origin::entry_hash(
                &page.origin,
                entry.origin_seq,
                entry.fact.fact_type(),
                entry.fact.event_id(),
                entry.fact.digest(),
                &previous.hash,
            )? != entry.chain_hash
        {
            return Err(CoreError::InvalidReplication("invalid origin hash chain"));
        }
        previous = OriginCursor {
            seq: entry.origin_seq,
            hash: entry.chain_hash.clone(),
        };
    }
    if previous != page.to
        || page.to.seq == page.through.seq && page.to.hash != page.through.hash
        || encoded_size(page)? > MAX_ORIGIN_PAGE_BYTES
    {
        return Err(CoreError::InvalidReplication(
            "origin page digest or byte budget",
        ));
    }
    Ok(())
}

fn check_references(connection: &Connection, fact: &ReplicatedFact) -> Result<(), CoreError> {
    let mut statement=connection.prepare("SELECT ordinal,CASE WHEN length(original_id)=36 THEN original_id END FROM event_originals WHERE event_id=?1 ORDER BY ordinal LIMIT 257")?;
    let rows = statement
        .query_map([fact.event_id().to_string()], |row| {
            Ok((row.get::<_, usize>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.len() != fact.originals().len() {
        return Err(CoreError::RecoveryRequired);
    }
    for ((ordinal, id), original) in rows.into_iter().zip(fact.originals()) {
        if ordinal >= fact.originals().len()
            || &fact.originals()[ordinal] != original
            || id.as_deref() != Some(original.original_id.to_string().as_str())
        {
            return Err(CoreError::RecoveryRequired);
        }
        let (profile, stored) = crate::manifests::manifest(connection, original.original_id)?;
        if profile != fact.profile_id() || stored != *original {
            return Err(CoreError::RecoveryRequired);
        }
    }
    Ok(())
}
fn admit_references(transaction: &Transaction<'_>, fact: &ReplicatedFact) -> Result<(), CoreError> {
    for original in fact.originals() {
        // A remote member knowing a private local draft's UUID/hash must not
        // acquire its bytes by appending a fact that publishes that draft.
        let private:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM original_stages s WHERE s.original_id=?1 AND NOT EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=s.original_id AND e.profile_id=?2))",params![original.original_id.to_string(),fact.profile_id().to_string()],|row|row.get(0))?;
        if private {
            return Err(CoreError::OriginalConflict);
        }
        crate::manifests::ensure_manifest(transaction, fact.profile_id(), original)?;
    }
    Ok(())
}
fn existing_origin(
    connection: &Connection,
    id: &OriginIdentity,
    seq: u64,
) -> Result<Option<(String, String, String, String)>, CoreError> {
    type Row = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let row:Option<Row>=connection.query_row("SELECT CASE WHEN length(event_id)=36 THEN event_id END,CASE WHEN length(fact_type)<=16 THEN fact_type END,CASE WHEN length(digest)=64 THEN digest END,CASE WHEN length(chain_hash)=64 THEN chain_hash END FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq=?4",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),seq],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
    row.map(|(event, kind, digest, chain)| {
        Ok((
            event.ok_or(CoreError::RecoveryRequired)?,
            kind.ok_or(CoreError::RecoveryRequired)?,
            digest.ok_or(CoreError::RecoveryRequired)?,
            chain.ok_or(CoreError::RecoveryRequired)?,
        ))
    })
    .transpose()
}
fn missing_for_page(
    transaction: &Transaction<'_>,
    page: &OriginPage,
) -> Result<Vec<OriginalRef>, CoreError> {
    let mut seen = HashSet::new();
    let mut missing = vec![];
    for original in page.entries.iter().flat_map(|entry| entry.fact.originals()) {
        if !seen.insert(original.original_id) {
            continue;
        }
        let ready:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM original_stages WHERE original_id=?1 AND profile_id=?2 AND state='verified')",params![original.original_id.to_string(),page.origin.profile_id.to_string()],|row|row.get(0))?;
        if !ready {
            missing.push(original.clone());
        }
    }
    Ok(missing)
}
fn apply_page(
    transaction: &Transaction<'_>,
    core: &Core,
    context: &ReplicaContext,
    page: &OriginPage,
    conflict: &mut Option<Conflict>,
) -> Result<ImportAck, CoreError> {
    let id = &page.origin;
    let mut current = receiver_cursor(transaction, id)?;
    if page.from.seq > current.seq {
        return Err(CoreError::InvalidReplication("origin sequence gap"));
    }
    if cursor_at(transaction, id, page.from.seq)? != page.from {
        return Err(CoreError::InvalidReplication("origin prefix differs"));
    }
    let accepted:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM accepted_origin_epochs WHERE profile_id=?1 AND origin_device=?2)",params![id.profile_id.to_string(),id.device_id.to_string()],|row|row.get(0))?;
    if !accepted {
        transaction.execute(
            "INSERT INTO accepted_origin_epochs VALUES(?1,?2,?3)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string()
            ],
        )?;
        transaction.execute(
            "INSERT INTO origin_heads VALUES(?1,?2,?3,0,?4)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string(),
                current.hash
            ],
        )?;
        transaction.execute(
            "INSERT INTO receive_cursors VALUES(?1,?2,?3,0,?4)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string(),
                current.hash
            ],
        )?;
    }
    let before = current.seq;
    let mut inserted = 0;
    let mut duplicates = 0;
    let mut typed_changed = false;
    for entry in &page.entries {
        let received = entry.fact.portable();
        if let ReplicatedFact::AgentSummary(record) = &received {
            crate::external_summaries::validate_available_sources(transaction, record)?;
        }
        if entry.origin_seq <= before {
            let (event, kind, digest, chain) = existing_origin(transaction, id, entry.origin_seq)?
                .ok_or(CoreError::RecoveryRequired)?;
            if event != received.event_id().to_string()
                || kind != received.fact_type()
                || digest != received.digest()
                || chain != entry.chain_hash
            {
                return Err(conflicting(conflict, entry, Some(digest), "origin_entry"));
            }
            let stored =
                load_fact(transaction, received.event_id())?.ok_or(CoreError::RecoveryRequired)?;
            if stored.canonical_fact_bytes()? != received.canonical_fact_bytes()? {
                return Err(conflicting(
                    conflict,
                    entry,
                    Some(stored.digest().into()),
                    "event_body",
                ));
            }
            check_references(transaction, &stored)?;
            duplicates += 1;
            continue;
        }
        if entry.origin_seq != current.seq + 1 {
            return Err(CoreError::InvalidReplication("origin sequence gap"));
        }
        let stored = load_fact(transaction, received.event_id())?;
        if let Some(stored) = stored {
            if stored.profile_id() != id.profile_id
                || stored.device_id() != id.device_id
                || stored.fact_type() != received.fact_type()
                || stored.canonical_fact_bytes()? != received.canonical_fact_bytes()?
            {
                let expected =
                    (stored.profile_id() == id.profile_id).then(|| stored.digest().to_string());
                return Err(conflicting(conflict, entry, expected, "event_body"));
            }
            check_references(transaction, &stored)?;
            duplicates += 1;
        } else {
            admit_references(transaction, &received)?;
            let kind = match &received {
                ReplicatedFact::Capture(_) => "capture",
                ReplicatedFact::Timeblock(_) => "timeblock/1",
                ReplicatedFact::SummaryJob(_) => "summary_job/1",
                ReplicatedFact::Summary(_) => "summary/1",
                ReplicatedFact::AgentSummary(_) => "agent_summary/1",
            };
            transaction.execute(
                "INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,?5)",
                params![
                    received.event_id().to_string(),
                    id.profile_id.to_string(),
                    received.digest(),
                    received.body()?,
                    kind
                ],
            )?;
            for (ordinal, original) in received.originals().iter().enumerate() {
                transaction.execute(
                    "INSERT INTO event_originals VALUES(?1,?2,?3)",
                    params![
                        received.event_id().to_string(),
                        ordinal,
                        original.original_id.to_string()
                    ],
                )?;
            }
            typed_changed |= matches!(&received, ReplicatedFact::Timeblock(_));
            match &received {
                ReplicatedFact::Capture(v) => crate::summaries::note_capture(transaction, v)?,
                ReplicatedFact::Timeblock(v) => crate::summaries::index_timeblock(transaction, v)?,
                ReplicatedFact::SummaryJob(v) => crate::summaries::index_import(
                    transaction,
                    v.event_id,
                    v.profile_id,
                    v.task_id,
                    "summary_job/1",
                )?,
                ReplicatedFact::Summary(v) => crate::summaries::index_import(
                    transaction,
                    v.event_id,
                    v.profile_id,
                    v.task_id,
                    "summary/1",
                )?,
                // Derived external attestations do not create model work,
                // internal task qualification, or attachment read authority.
                ReplicatedFact::AgentSummary(_) => {}
            }
            inserted += 1;
        }
        let repeated:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND event_id=?4)",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),received.event_id().to_string()],|row|row.get(0))?;
        if repeated {
            return Err(conflicting(
                conflict,
                entry,
                Some(received.digest().into()),
                "event_reordered",
            ));
        }
        transaction.execute(
            "INSERT INTO origin_entries VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string(),
                entry.origin_seq,
                received.event_id().to_string(),
                received.fact_type(),
                received.digest(),
                entry.chain_hash
            ],
        )?;
        current = OriginCursor {
            seq: entry.origin_seq,
            hash: entry.chain_hash.clone(),
        };
    }
    if current.seq > before {
        transaction.execute("UPDATE origin_heads SET head_seq=?4,head_hash=?5 WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),current.seq,current.hash])?;
        transaction.execute("UPDATE receive_cursors SET cursor_seq=?4,cursor_hash=?5 WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),current.seq,current.hash])?;
    }
    let projection_complete = if typed_changed {
        crate::timeblocks::rebuild_after_import(transaction, id.profile_id, core.device_id())?
    } else {
        transaction.query_row(
            "SELECT status='complete' FROM replication_projection_status WHERE profile_id=?1",
            [id.profile_id.to_string()],
            |row| row.get(0),
        )?
    };
    let _ = context; // Host alone owns the current member-generation truth.
    Ok(ImportAck {
        origin: id.clone(),
        cursor: current,
        inserted,
        duplicates,
        replayed: page.to.seq <= before,
        projection_complete,
        missing_originals: missing_for_page(transaction, page)?,
    })
}
pub(super) fn import_page(
    core: &Core,
    context: &ReplicaContext,
    page: &OriginPage,
) -> Result<ImportAck, CoreError> {
    core.check_replica_context(context)?;
    validate_page(context, page)?;
    let mut connection = core.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut conflict = None;
    match apply_page(&transaction, core, context, page, &mut conflict) {
        Ok(ack) => {
            transaction.commit()?;
            Ok(ack)
        }
        Err(error) => {
            transaction.rollback()?;
            if let Some(conflict) = conflict {
                // Independent, minimal reconciliation evidence. Storage/IO/busy
                // errors never become conflicts, and no business body is logged.
                let evidence =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                evidence.execute("INSERT INTO import_conflicts(profile_id,origin_device,restoration_epoch,origin_seq,event_id,expected_digest,received_digest,reason) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![page.origin.profile_id.to_string(),page.origin.device_id.to_string(),page.origin.restoration_epoch.to_string(),conflict.seq,conflict.event.to_string(),conflict.expected,conflict.received,conflict.reason])?;
                evidence.commit()?;
            }
            Err(error)
        }
    }
}
