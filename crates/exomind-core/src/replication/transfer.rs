use super::{
    DEFAULT_ORIGIN_PAGE_BYTES, MAX_ORIGIN_PAGE_BYTES, OriginCursor, OriginIdentity, ReplicaContext,
    ReplicatedFact, facts::load_fact, origin,
};
use crate::{Core, CoreError, EventId, OriginalRef, ProfileId, WriterContext};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct OriginPageQuery {
    pub after: Option<OriginCursor>,
    pub through: Option<OriginCursor>,
    pub limit: usize,
    pub max_bytes: usize,
}
impl Default for OriginPageQuery {
    fn default() -> Self {
        Self {
            after: None,
            through: None,
            limit: 100,
            max_bytes: DEFAULT_ORIGIN_PAGE_BYTES,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginEntry {
    pub origin_seq: u64,
    pub chain_hash: String,
    pub fact: ReplicatedFact,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginPage {
    pub origin: OriginIdentity,
    pub from: OriginCursor,
    pub to: OriginCursor,
    pub through: OriginCursor,
    pub has_more: bool,
    pub entries: Vec<OriginEntry>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportAck {
    pub origin: OriginIdentity,
    pub cursor: OriginCursor,
    pub inserted: u64,
    pub duplicates: u64,
    pub replayed: bool,
    pub projection_complete: bool,
    pub missing_originals: Vec<OriginalRef>,
}
pub(super) fn identity(context: &ReplicaContext) -> OriginIdentity {
    OriginIdentity {
        profile_id: context.profile_id,
        device_id: context.authenticated_origin,
        restoration_epoch: context.restoration_epoch,
    }
}
pub(super) fn encoded_size(value: &impl Serialize) -> Result<usize, CoreError> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| std::io::Error::other("encoding overflow"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, value)?;
    Ok(counter.0)
}
pub(super) fn cursor_at(
    connection: &Connection,
    id: &OriginIdentity,
    seq: u64,
) -> Result<OriginCursor, CoreError> {
    if seq > i64::MAX as u64 {
        return Err(CoreError::InvalidQuery("origin cursor range"));
    }
    if seq == 0 {
        return Ok(OriginCursor {
            seq,
            hash: origin::genesis(id)?,
        });
    }
    let hash:Option<Option<String>>=connection.query_row("SELECT CASE WHEN typeof(chain_hash)='text' AND length(chain_hash)=64 THEN chain_hash END FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq=?4",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),seq],|row|row.get(0)).optional()?;
    let hash = hash.flatten().ok_or(CoreError::RecoveryRequired)?;
    origin::verify_endpoint(connection, id, seq, &hash)?;
    Ok(OriginCursor { seq, hash })
}
pub(super) fn receiver_cursor(
    connection: &Connection,
    id: &OriginIdentity,
) -> Result<OriginCursor, CoreError> {
    let epoch:Option<Option<String>>=connection.query_row("SELECT CASE WHEN typeof(restoration_epoch)='text' AND length(restoration_epoch)=36 THEN restoration_epoch END FROM accepted_origin_epochs WHERE profile_id=?1 AND origin_device=?2",params![id.profile_id.to_string(),id.device_id.to_string()],|row|row.get(0)).optional()?;
    match epoch {
        None => {
            let orphaned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM receive_cursors WHERE profile_id=?1 AND origin_device=?2) OR EXISTS(SELECT 1 FROM origin_heads WHERE profile_id=?1 AND origin_device=?2)",params![id.profile_id.to_string(),id.device_id.to_string()],|row|row.get(0))?;
            if orphaned {
                return Err(CoreError::RecoveryRequired);
            }
            Ok(OriginCursor {
                seq: 0,
                hash: origin::genesis(id)?,
            })
        }
        Some(Some(epoch)) if epoch == id.restoration_epoch.to_string() => {
            let cursor:Option<(u64,Option<String>)>=connection.query_row("SELECT cursor_seq,CASE WHEN typeof(cursor_hash)='text' AND length(cursor_hash)=64 THEN cursor_hash END FROM receive_cursors WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string()],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
            let (seq, hash) = cursor.ok_or(CoreError::RecoveryRequired)?;
            let cursor = OriginCursor {
                seq,
                hash: hash.ok_or(CoreError::RecoveryRequired)?,
            };
            if cursor != origin::head(connection, id)? {
                return Err(CoreError::RecoveryRequired);
            }
            Ok(cursor)
        }
        Some(Some(_)) => Err(CoreError::OriginEpochChanged),
        Some(None) => Err(CoreError::RecoveryRequired),
    }
}
impl Core {
    pub fn replication_cursor(&self, context: &ReplicaContext) -> Result<OriginCursor, CoreError> {
        self.check_replica_context(context)?;
        let connection = self.connection()?;
        receiver_cursor(&connection, &identity(context))
    }
    /// Own-origin only. Receiving a fact does not grant relay provenance.
    pub fn export_origin_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &OriginPageQuery,
    ) -> Result<OriginPage, CoreError> {
        self.check_scope(context, profile)?;
        if query.limit == 0
            || query.limit > 100
            || query.max_bytes == 0
            || query.max_bytes > MAX_ORIGIN_PAGE_BYTES
        {
            return Err(CoreError::InvalidQuery("origin page budget"));
        }
        let connection = self.connection()?;
        let id = origin::local_identity(&connection, profile, self.device_id())?;
        let head = origin::head(&connection, &id)?;
        let through = query.through.clone().unwrap_or(head.clone());
        if through.seq > head.seq || cursor_at(&connection, &id, through.seq)? != through {
            return Err(CoreError::InvalidQuery("unknown origin snapshot"));
        }
        let from = query.after.clone().unwrap_or(OriginCursor {
            seq: 0,
            hash: origin::genesis(&id)?,
        });
        if from.seq > through.seq || cursor_at(&connection, &id, from.seq)? != from {
            return Err(CoreError::InvalidQuery("unknown origin prefix"));
        }
        let mut page = OriginPage {
            origin: id.clone(),
            from: from.clone(),
            to: from,
            through,
            has_more: false,
            entries: vec![],
        };
        let mut statement=connection.prepare("SELECT origin_seq,CASE WHEN length(event_id)=36 THEN event_id END,CASE WHEN length(chain_hash)=64 THEN chain_hash END,CASE WHEN length(fact_type)<=16 THEN fact_type END,CASE WHEN length(digest)=64 THEN digest END FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq>?4 AND origin_seq<=?5 ORDER BY origin_seq LIMIT ?6")?;
        let mut rows = statement.query(params![
            profile.to_string(),
            self.device_id().to_string(),
            id.restoration_epoch.to_string(),
            page.from.seq,
            page.through.seq,
            query.limit
        ])?;
        while let Some(row) = rows.next()? {
            let seq: u64 = row.get(0)?;
            let event: EventId = row
                .get::<_, Option<String>>(1)?
                .ok_or(CoreError::RecoveryRequired)?
                .parse()?;
            let chain: String = row
                .get::<_, Option<String>>(2)?
                .ok_or(CoreError::RecoveryRequired)?;
            let fact = load_fact(&connection, event)?.ok_or(CoreError::RecoveryRequired)?;
            if seq != page.to.seq + 1
                || fact.profile_id() != profile
                || fact.device_id() != self.device_id()
                || row.get::<_, Option<String>>(3)?.as_deref() != Some(fact.fact_type())
                || row.get::<_, Option<String>>(4)?.as_deref() != Some(fact.digest())
                || origin::entry_hash(
                    &id,
                    seq,
                    fact.fact_type(),
                    event,
                    fact.digest(),
                    &page.to.hash,
                )? != chain
            {
                return Err(CoreError::RecoveryRequired);
            }
            let previous = page.to.clone();
            page.entries.push(OriginEntry {
                origin_seq: seq,
                chain_hash: chain.clone(),
                fact,
            });
            page.to = OriginCursor { seq, hash: chain };
            page.has_more = seq < page.through.seq;
            let required = encoded_size(&page)?;
            if required > query.max_bytes {
                page.entries.pop();
                page.to = previous;
                page.has_more = page.to.seq < page.through.seq;
                if page.entries.is_empty() {
                    return Err(CoreError::OriginPageOversize {
                        required_bytes: required,
                        origin_seq: seq,
                    });
                }
                break;
            }
        }
        page.has_more = page.to.seq < page.through.seq;
        if page.entries.is_empty() && page.has_more {
            return Err(CoreError::RecoveryRequired);
        }
        let required = encoded_size(&page)?;
        if required > query.max_bytes {
            return Err(CoreError::OriginPageOversize {
                required_bytes: required,
                origin_seq: page.to.seq,
            });
        }
        Ok(page)
    }
    pub fn import_origin_page(
        &self,
        context: &ReplicaContext,
        page: &OriginPage,
    ) -> Result<ImportAck, CoreError> {
        super::ingest::import_page(self, context, page)
    }
}
