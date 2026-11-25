use super::*;

impl Core {
    /// One SQLite read transaction across all profiles. Completed rows remain
    /// visible only for the current, locally accepted run awaiting attention;
    /// this closes pending->done races without replaying historical timers.
    pub fn local_deadline_alerts(
        &self,
        context: &SchedulerContext,
        stamp: &ClockStamp,
    ) -> Result<Vec<LocalDeadlineAlert>, CoreError> {
        self.check_scheduler(context)?;
        self.check_clock(stamp)?;
        let mut connection = self.connection()?;
        let tx = connection.transaction()?;
        let (device, generation, active) = owner(&tx)?;
        if !active || device != self.device_id() {
            return Ok(vec![]);
        }
        // Match only the current run, never a prior row for the same block.
        let ids = {
            let mut query=tx.prepare("SELECT d.deadline_id FROM timeblock_deadlines d JOIN replication_projection_status p ON p.profile_id=d.profile_id AND p.status='complete' JOIN timeblock_state s ON s.profile_id=d.profile_id WHERE d.owner_generation=?1 AND d.state IN ('pending','done') AND d.block_id=json_extract(s.body,'$.active') AND d.run_event_id IS NOT NULL AND (json_extract(s.body,'$.blocks.\"'||d.block_id||'\".run_event_id') IS NULL OR d.run_event_id=json_extract(s.body,'$.blocks.\"'||d.block_id||'\".run_event_id')) ORDER BY d.profile_id LIMIT ?2")?;
            let rows = query
                .query_map(
                    params![generation, (MAX_LOCAL_DEADLINE_ALERTS + 1) as u64],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if ids.len() > MAX_LOCAL_DEADLINE_ALERTS {
            return Err(CoreError::InvalidQuery("deadline alert capacity"));
        }
        let mut result = vec![];
        for id in ids {
            let id = Uuid::parse_str(&id)?;
            let row = deadline(&tx, id)?.ok_or(CoreError::RecoveryRequired)?;
            let projected = state(&tx, row.profile)?;
            let Some(block) = projected.blocks.get(&row.block.to_string()) else {
                return Err(CoreError::RecoveryRequired);
            };
            if block.run_device_id != Some(device)
                || block.run_event_id != row.run
                || !matches!(block.spec.timer, TimerSpec::CountDown { .. })
            {
                continue;
            }
            let completed = row.state == "done";
            if (!completed
                && (block.phase != TimeblockPhase::Running
                    || block.deadline_reached
                    || block.generation != row.generation))
                || (completed
                    && (!block.deadline_reached
                        || !matches!(
                            block.phase,
                            TimeblockPhase::Running | TimeblockPhase::FeedbackPending
                        )))
            {
                continue;
            }
            let remaining = if completed {
                0
            } else if row.epoch == stamp.clock.epoch_id {
                row.elapsed.saturating_sub(stamp.clock.elapsed_ms)
            } else {
                row.wall.saturating_sub(stamp.wall_ms).max(0) as u64
            };
            result.push(LocalDeadlineAlert {
                deadline_id: id,
                profile_id: row.profile,
                block_id: row.block,
                block_name: block.spec.name.clone(),
                block_note: block.spec.note.clone(),
                due_at_ms: stamp
                    .wall_ms
                    .saturating_add(remaining.min(i64::MAX as u64) as i64),
                remaining_ms: remaining,
                completed,
            });
        }
        tx.commit()?;
        Ok(result)
    }
}
