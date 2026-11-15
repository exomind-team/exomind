//! Bounded metadata queries for replicas that still need original bytes. This
//! is a read projection of committed references, never a staging/cleanup job.
use crate::{Core, CoreError, OriginalId, OriginalRef, ProfileId, WriterContext};
use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MissingOriginalsPage {
    pub items: Vec<OriginalRef>,
    pub next_after: Option<OriginalId>,
}
impl Core {
    /// Only originals referenced by a committed fact in this profile are
    /// eligible. Local private uploads and other profiles cannot enter this
    /// queue merely because an ID or content hash is known.
    pub fn missing_originals_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        after: Option<OriginalId>,
        limit: usize,
    ) -> Result<MissingOriginalsPage, CoreError> {
        self.check_scope(context, profile)?;
        if limit == 0 || limit > 100 {
            return Err(CoreError::InvalidQuery("missing original limit"));
        }
        let connection = self.connection()?;
        let mut query=connection.prepare("SELECT CASE WHEN typeof(m.original_id)='text' AND length(m.original_id)=36 THEN m.original_id END FROM original_manifests m WHERE m.profile_id=?1 AND (?2 IS NULL OR m.original_id>?2) AND EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=m.original_id AND e.profile_id=?1) AND NOT EXISTS(SELECT 1 FROM original_stages s WHERE s.original_id=m.original_id AND s.profile_id=?1 AND s.state='verified' AND s.next_offset=s.byte_length) ORDER BY m.original_id LIMIT ?3")?;
        let ids = query
            .query_map(
                params![
                    profile.to_string(),
                    after.map(|id| id.to_string()),
                    limit + 1
                ],
                |row| row.get::<_, Option<String>>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = ids.len() > limit;
        let mut items = Vec::with_capacity(ids.len().min(limit));
        for raw in ids.into_iter().take(limit) {
            let id = raw
                .ok_or(CoreError::RecoveryRequired)?
                .parse::<OriginalId>()
                .map_err(|_| CoreError::RecoveryRequired)?;
            let (bound, original) = crate::manifests::manifest(&connection, id)?;
            if bound != profile {
                return Err(CoreError::RecoveryRequired);
            }
            items.push(original);
        }
        let next_after = if has_more {
            items.last().map(|item| item.original_id)
        } else {
            None
        };
        Ok(MissingOriginalsPage { items, next_after })
    }
}
