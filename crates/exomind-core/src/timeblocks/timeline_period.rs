use super::super::model::{TimelineItem, TimelinePage};
use super::timeline_read;
use crate::{
    Core, CoreError, EventId, EventQuery, MAX_EVENT_TAG_BYTES, MAX_FACT_BYTES, ProfileId,
    WriterContext,
};
use rusqlite::{Connection, Params, params};

const MAX_PERIOD_CANDIDATES: usize = 4096;
const MAX_PERIOD_CANDIDATE_BYTES: usize = 16 * 1024 * 1024;

const CAPTURE_CANDIDATES: &str = "
SELECT e.local_seq,
       CASE WHEN typeof(e.event_id)='text' AND length(e.event_id)=36 THEN e.event_id END,
       e.kind,
       CASE WHEN typeof(e.digest)='text' AND length(e.digest)=64 THEN e.digest END,
       CASE WHEN typeof(e.body)='text' AND length(CAST(e.body AS BLOB))<=?5 THEN e.body END
FROM summary_capture_sources AS s INDEXED BY summary_capture_range
JOIN events AS e ON e.event_id=s.event_id AND e.profile_id=s.profile_id
WHERE s.profile_id=?1 AND s.occurred_at_ms>=?2 AND s.occurred_at_ms<?3
ORDER BY s.occurred_at_ms,s.event_id
LIMIT ?4";

const TIMEBLOCK_CANDIDATES: &str = "
SELECT local_seq,
       CASE WHEN typeof(event_id)='text' AND length(event_id)=36 THEN event_id END,
       kind,
       CASE WHEN typeof(digest)='text' AND length(digest)=64 THEN digest END,
       CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?5 THEN body END
FROM events INDEXED BY events_timeline_block_effective_at
WHERE profile_id=?1 AND kind='timeblock/1'
  AND json_extract(body,'$.effective_at_ms')>=?2
  AND json_extract(body,'$.effective_at_ms')<?3
ORDER BY json_extract(body,'$.effective_at_ms'),local_seq
LIMIT ?4";

const SUMMARY_CANDIDATES: &str = "
SELECT local_seq,
       CASE WHEN typeof(event_id)='text' AND length(event_id)=36 THEN event_id END,
       kind,
       CASE WHEN typeof(digest)='text' AND length(digest)=64 THEN digest END,
       CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=?5 THEN body END
FROM events INDEXED BY events_timeline_summary_occurred_at
WHERE profile_id=?1 AND kind IN ('summary/1','agent_summary/1')
  AND json_extract(body,'$.occurred_at_ms')>=?2
  AND json_extract(body,'$.occurred_at_ms')<?3
ORDER BY json_extract(body,'$.occurred_at_ms'),local_seq
LIMIT ?4";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelinePeriodQuery {
    pub from_ms: i64,
    pub to_ms: i64,
    pub before: Option<u64>,
    pub through: Option<u64>,
    pub limit: usize,
    pub search: Option<String>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct CandidateBudget {
    max_candidates: usize,
    max_body_bytes: usize,
    candidates: usize,
    body_bytes: usize,
}

impl CandidateBudget {
    fn production() -> Self {
        Self {
            max_candidates: MAX_PERIOD_CANDIDATES,
            max_body_bytes: MAX_PERIOD_CANDIDATE_BYTES,
            candidates: 0,
            body_bytes: 0,
        }
    }

    fn query_limit(self) -> u64 {
        self.max_candidates
            .saturating_sub(self.candidates)
            .saturating_add(1) as u64
    }

    fn account(&mut self, row: &timeline_read::TimelineRow) -> Result<(), CoreError> {
        if self.candidates >= self.max_candidates {
            return Err(CoreError::TimelinePeriodBudgetExceeded);
        }
        let body = row.4.as_ref().ok_or(CoreError::RecoveryRequired)?;
        if body.len() > MAX_FACT_BYTES
            || body.len() > self.max_body_bytes.saturating_sub(self.body_bytes)
        {
            return Err(CoreError::TimelinePeriodBudgetExceeded);
        }
        self.candidates += 1;
        self.body_bytes += body.len();
        Ok(())
    }
}

impl Core {
    pub fn timeline_period_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &TimelinePeriodQuery,
    ) -> Result<TimelinePage, CoreError> {
        self.timeline_period_page_with_budget(
            context,
            profile,
            query,
            CandidateBudget::production(),
        )
    }

    fn timeline_period_page_with_budget(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &TimelinePeriodQuery,
        mut budget: CandidateBudget,
    ) -> Result<TimelinePage, CoreError> {
        self.check_scope(context, profile)?;
        if query.from_ms < 0
            || query.to_ms <= query.from_ms
            || query
                .tag
                .as_ref()
                .is_some_and(|tag| tag.trim().is_empty() || tag.len() > MAX_EVENT_TAG_BYTES)
        {
            return Err(CoreError::InvalidQuery("timeline period bounds or tag"));
        }
        let sequence_query = EventQuery {
            before: query.before,
            through: query.through,
            limit: query.limit,
            search: query.search.clone(),
        };
        let connection = self.connection()?;
        let (highwater, through, before) =
            super::page_bounds(&connection, profile, &sequence_query)?;

        // These statements seek by indexed event time and stop after the shared
        // candidate budget. They deliberately do not filter q/tag or order by
        // local_seq in SQLite; sorting is bounded in memory after the scan.
        let profile_text = profile.to_string();
        let mut candidates = Vec::new();
        append_candidates(
            &connection,
            CAPTURE_CANDIDATES,
            params![
                profile_text,
                query.from_ms,
                query.to_ms,
                budget.query_limit(),
                MAX_FACT_BYTES
            ],
            &mut budget,
            &mut candidates,
        )?;
        append_candidates(
            &connection,
            TIMEBLOCK_CANDIDATES,
            params![
                profile_text,
                query.from_ms,
                query.to_ms,
                budget.query_limit(),
                MAX_FACT_BYTES
            ],
            &mut budget,
            &mut candidates,
        )?;
        append_candidates(
            &connection,
            SUMMARY_CANDIDATES,
            params![
                profile_text,
                query.from_ms,
                query.to_ms,
                budget.query_limit(),
                MAX_FACT_BYTES
            ],
            &mut budget,
            &mut candidates,
        )?;

        let mut items = Vec::new();
        for row in candidates {
            if row.0 > through || row.0 >= before {
                continue;
            }
            let body = row.4.as_deref().ok_or(CoreError::RecoveryRequired)?;
            if query
                .search
                .as_deref()
                .is_some_and(|search| !body.contains(search))
            {
                continue;
            }
            let item = timeline_read::decode(profile, row)?;
            let timestamp = period_timestamp(&item);
            if !(query.from_ms..query.to_ms).contains(&timestamp) {
                return Err(CoreError::RecoveryRequired);
            }
            if let (Some(tag), TimelineItem::Capture(record)) = (query.tag.as_deref(), &item) {
                if !capture_has_tag(&connection, profile, record.event_id, record.local_seq, tag)? {
                    continue;
                }
            }
            items.push(item);
        }

        items.sort_unstable_by(|left, right| item_local_seq(right).cmp(&item_local_seq(left)));
        let more = items.len() > query.limit;
        items.truncate(query.limit);
        let next_before = if more {
            items.last().map(item_local_seq)
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

fn append_candidates<P: Params>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    budget: &mut CandidateBudget,
    candidates: &mut Vec<timeline_read::TimelineRow>,
) -> Result<(), CoreError> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(parameters, timeline_read::row)?;
    for candidate in rows {
        let candidate = candidate?;
        budget.account(&candidate)?;
        candidates.push(candidate);
    }
    Ok(())
}

fn capture_has_tag(
    connection: &Connection,
    profile: ProfileId,
    event_id: EventId,
    local_seq: u64,
    tag: &str,
) -> Result<bool, CoreError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM event_tags INDEXED BY event_tags_profile_tag_sequence WHERE profile_id=?1 AND tag=?2 AND local_seq=?3 AND event_id=?4)",
        params![profile.to_string(), tag, local_seq, event_id.to_string()],
        |row| row.get(0),
    )?)
}

fn period_timestamp(item: &TimelineItem) -> i64 {
    match item {
        TimelineItem::Capture(record) => record.occurred_at_ms,
        TimelineItem::Timeblock(record) => record.effective_at_ms,
        TimelineItem::Summary(record) => record.occurred_at_ms,
        TimelineItem::AgentSummary(record) => record.occurred_at_ms,
    }
}

fn item_local_seq(item: &TimelineItem) -> u64 {
    match item {
        TimelineItem::Capture(record) => record.local_seq,
        TimelineItem::Timeblock(record) => record.local_seq,
        TimelineItem::Summary(record) => record.local_seq,
        TimelineItem::AgentSummary(record) => record.local_seq,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CaptureCommand, CommandId, TimeblockAction, TimeblockCommand, TimeblockId, TimerSpec,
    };
    use uuid::Uuid;

    fn capture(core: &Core, profile: ProfileId, at_ms: i64, text: &str) {
        core.submit(
            &core.local_human(profile).unwrap(),
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                occurred_at_ms: at_ms,
                text: text.into(),
                tags: vec![],
                originals: vec![],
            },
        )
        .unwrap();
    }

    #[test]
    fn an_over_budget_period_read_returns_no_page_and_leaves_legacy_reads_available() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path()).unwrap();
        let profile = core.create_profile("period budget").unwrap();
        let human = core.local_human(profile).unwrap();
        for index in 0..3 {
            capture(&core, profile, 1_500, &format!("candidate {index}"));
        }
        let query = TimelinePeriodQuery {
            from_ms: 1_000,
            to_ms: 2_000,
            before: None,
            through: None,
            limit: 2,
            search: None,
            tag: None,
        };
        let result = core.timeline_period_page_with_budget(
            &human,
            profile,
            &query,
            CandidateBudget {
                max_candidates: 2,
                max_body_bytes: MAX_PERIOD_CANDIDATE_BYTES,
                candidates: 0,
                body_bytes: 0,
            },
        );
        assert!(matches!(
            result,
            Err(CoreError::TimelinePeriodBudgetExceeded)
        ));
        assert_eq!(
            core.timeline_page(&human, profile, &EventQuery::default())
                .unwrap()
                .items
                .len(),
            3
        );
    }

    #[test]
    fn period_body_byte_budget_returns_no_partial_page_and_does_not_poison_reads() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path()).unwrap();
        let profile = core.create_profile("period byte budget").unwrap();
        let human = core.local_human(profile).unwrap();
        capture(&core, profile, 1_500, "body bytes");
        let query = TimelinePeriodQuery {
            from_ms: 1_000,
            to_ms: 2_000,
            before: None,
            through: None,
            limit: 10,
            search: None,
            tag: None,
        };
        let result = core.timeline_period_page_with_budget(
            &human,
            profile,
            &query,
            CandidateBudget {
                max_candidates: 10,
                max_body_bytes: 1,
                candidates: 0,
                body_bytes: 0,
            },
        );
        assert!(matches!(
            result,
            Err(CoreError::TimelinePeriodBudgetExceeded)
        ));
        assert_eq!(
            core.timeline_page(&human, profile, &EventQuery::default())
                .unwrap()
                .items
                .len(),
            1
        );
    }

    #[test]
    fn timeblock_period_position_uses_effective_time_while_record_keeps_occurred_time() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path()).unwrap();
        let profile = core.create_profile("effective time").unwrap();
        let human = core.local_human(profile).unwrap();
        let stamp = core
            .trusted_clock_stamp(Uuid::from_u128(17), 1_000, 1_000)
            .unwrap();
        let block_id = TimeblockId::new();
        let revision = core
            .timeblock_snapshot(&human, profile, &stamp)
            .unwrap()
            .revision;
        core.apply_timeblock(
            &human,
            &TimeblockCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                expected_revision: revision,
                action: TimeblockAction::Start {
                    block_id,
                    name: "effective fixture".into(),
                    note: String::new(),
                    timer: TimerSpec::CountUp,
                },
            },
            &stamp,
        )
        .unwrap();
        let mut node = core
            .timeblock_nodes(&human, profile, &EventQuery::default())
            .unwrap()
            .items
            .remove(0);
        node.occurred_at_ms = 2_000;
        node.effective_at_ms = 1_000;
        let item = TimelineItem::Timeblock(node);
        assert_eq!(period_timestamp(&item), 1_000);
        assert!(matches!(
            item,
            TimelineItem::Timeblock(record)
                if record.occurred_at_ms == 2_000 && record.effective_at_ms == 1_000
        ));
    }
}
