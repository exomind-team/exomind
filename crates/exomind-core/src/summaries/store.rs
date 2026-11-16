use super::{facts, model::*, projection, sources};
use crate::{
    AuthorKind, CommandId, Core, CoreError, Durability, EventId, ProfileId, Receipt, WriterContext,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::sync::atomic::Ordering;
use uuid::Uuid;

fn id(domain: &str, values: &[&str]) -> Uuid {
    super::derived_uuid(domain, values)
}
fn event(domain: &str, values: &[&str]) -> EventId {
    id(domain, values)
        .to_string()
        .parse()
        .expect("non-nil derived UUID")
}
fn command(domain: &str, values: &[&str]) -> CommandId {
    id(domain, values)
        .to_string()
        .parse()
        .expect("non-nil derived UUID")
}
fn replay(
    c: &Connection,
    p: ProfileId,
    cmd: CommandId,
    digest: &str,
) -> Result<Option<Receipt>, CoreError> {
    let row: Option<(String, String, String)> = c
        .query_row(
            "SELECT profile_id,input_digest,receipt FROM command_receipts WHERE command_id=?1",
            [cmd.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(profile, stored, body)| {
        if profile != p.to_string() || stored != digest {
            return Err(CoreError::CommandConflict);
        }
        let mut receipt: Receipt = serde_json::from_str(&body)?;
        receipt.replayed = true;
        Ok(receipt)
    })
    .transpose()
}
fn receipt(
    tx: &Transaction<'_>,
    cmd: CommandId,
    node: EventId,
    p: ProfileId,
    digest: &str,
    input: &str,
    seq: u64,
) -> Result<Receipt, CoreError> {
    let receipt = Receipt {
        command_id: cmd,
        event_id: node,
        profile_id: p,
        local_seq: seq,
        event_digest: digest.into(),
        durability: Durability::LocalCommitted,
        replayed: false,
    };
    tx.execute(
        "INSERT INTO command_receipts VALUES(?1,?2,?3,?4)",
        params![
            cmd.to_string(),
            p.to_string(),
            input,
            serde_json::to_string(&receipt)?
        ],
    )?;
    Ok(receipt)
}
fn insert_job(
    tx: &Transaction<'_>,
    mut node: SummaryJobRecord,
) -> Result<(u64, String), CoreError> {
    node.digest = node.computed_digest()?;
    node.validate()?;
    let body = crate::fact_encoding::encode_fact(&node)?;
    if tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE event_id=?1)",
        [node.event_id.to_string()],
        |r| r.get::<_, bool>(0),
    )? {
        return Err(CoreError::EventConflict);
    }
    tx.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,'summary_job/1')",params![node.event_id.to_string(),node.profile_id.to_string(),node.digest,body])?;
    let seq = tx.last_insert_rowid() as u64;
    super::schema::index(
        tx,
        node.event_id,
        node.profile_id,
        node.task_id,
        "summary_job/1",
    )?;
    crate::replication::record_local_fact(
        tx,
        node.profile_id,
        node.device_id,
        node.event_id,
        "summary_job/1",
        &node.digest,
    )?;
    Ok((seq, node.digest))
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
fn node(
    core: &Core,
    p: ProfileId,
    task: Uuid,
    ev: EventId,
    parents: Vec<EventId>,
    payload: SummaryJobPayload,
    actor: SummaryActorKind,
    time: i64,
) -> SummaryJobRecord {
    SummaryJobRecord {
        event_id: ev,
        profile_id: p,
        device_id: core.device_id(),
        author_id: core.human_author(),
        actor_kind: actor,
        task_id: task,
        parents,
        occurred_at_ms: time,
        payload,
        digest: String::new(),
        local_seq: 0,
    }
}
fn qualify(task: &projection::Task, core: &Core) -> Result<(), CoreError> {
    if task.owner.device != core.device_id() {
        return Err(CoreError::SummaryNotOwner);
    }
    if task.owner.cancelled
        || !task.view.conflicts.is_empty()
        || task.view.reason.as_deref().is_some_and(|s| {
            matches!(
                s,
                "trigger_incomplete" | "missing_parents" | "owner_conflict"
            )
        })
    {
        return Err(CoreError::SummaryBlocked("task_qualification"));
    }
    Ok(())
}
fn checked_view(
    c: &Connection,
    p: ProfileId,
    id: Uuid,
    lifecycle: Uuid,
) -> Result<projection::Task, CoreError> {
    let mut task = projection::load(c, p, id)?;
    if let Some(snapshot) = task
        .view
        .current_run
        .as_ref()
        .and_then(|r| r.snapshot.as_ref())
    {
        task.view.coverage_changed = sources::changed(c, p, snapshot)?;
    }
    if task.view.state == SummaryState::Running {
        if let Some(attempt) = task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.attempt.as_ref())
        {
            let local: Option<(String, String)> = c
                .query_row(
                    "SELECT core_lifecycle,state FROM summary_attempts WHERE attempt_id=?1",
                    [attempt.attempt_id.to_string()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if task.owner.device.to_string()
                == c.query_row::<String, _, _>(
                    "SELECT device_id FROM identity WHERE singleton=1",
                    [],
                    |r| r.get(0),
                )?
                && local.is_none_or(|(owner, state)| {
                    owner != lifecycle.to_string() || state != "active"
                })
            {
                task.view.state = SummaryState::Failed;
                task.view.reason = Some("external_outcome_unknown".into());
            }
        }
    }
    Ok(task)
}
impl Core {
    pub fn local_summary_executor(&self) -> SummaryExecutorContext {
        SummaryExecutorContext {
            lifecycle: self.lifecycle(),
            device_id: self.device_id(),
        }
    }
    fn check_summary_executor(&self, executor: &SummaryExecutorContext) -> Result<(), CoreError> {
        if executor.lifecycle != self.lifecycle() || executor.device_id != self.device_id() {
            return Err(CoreError::ForeignContext);
        }
        if self.summary_stopped.load(Ordering::Acquire) {
            return Err(CoreError::SummaryExecutorStopped);
        }
        Ok(())
    }
    /// Lifecycle cancellation only. It neither cancels the user's task nor emits
    /// a portable receipt. Connection serialization fences every future seal.
    pub fn stop_summary_executor(
        &self,
        executor: &SummaryExecutorContext,
    ) -> Result<(), CoreError> {
        let _c = self.connection()?;
        self.check_summary_executor(executor)?;
        self.summary_stopped.store(true, Ordering::Release);
        Ok(())
    }
    pub fn summary_block_selection(
        &self,
        context: &WriterContext,
        p: ProfileId,
        block: crate::TimeblockId,
    ) -> Result<SummarySelection, CoreError> {
        self.check_scope(context, p)?;
        let c = self.connection()?;
        let a = crate::timeblocks::summary_anchor(&c, p, block)?;
        if !a.eligible {
            return Err(CoreError::SummaryBlocked("feedback_required"));
        }
        Ok(SummarySelection {
            block_ids: vec![block],
            from_ms: a.from_ms,
            to_ms: a.to_ms,
            selected_original_ids: vec![],
        })
    }
    pub fn request_summary(
        &self,
        context: &WriterContext,
        request: &SummaryRequestCommand,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, request.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::SummaryControlDenied);
        }
        facts::selection(&request.selection)?;
        if request.artifact_kind == SummaryArtifactKind::ExternalSummary {
            return Err(facts::invalid(
                "external producer requires separate authority",
            ));
        }
        let input = facts::hash(&(
            context.author_id,
            context.device_id,
            "summary-request/1",
            request,
        ))?;
        let mut c = self.connection()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(old) = replay(&tx, request.profile_id, request.command_id, &input)? {
            return Ok(old);
        }
        let (task, key, creator, owner, selection) =
            if request.purpose == SummaryPurpose::FirstReviewV1 {
                if request.selection.block_ids.len() != 1 {
                    return Err(facts::invalid("first review one block"));
                }
                let b = request.selection.block_ids[0];
                let a = crate::timeblocks::summary_anchor(&tx, request.profile_id, b)?;
                if !a.eligible {
                    return Err(CoreError::SummaryBlocked("feedback_required"));
                }
                (
                    super::first_id(request.profile_id, b),
                    super::first_key(request.profile_id, b),
                    a.creator_event_id,
                    a.creator_device_id,
                    SummarySelection {
                        block_ids: vec![b],
                        from_ms: a.from_ms,
                        to_ms: a.to_ms,
                        selected_original_ids: request.selection.selected_original_ids.clone(),
                    },
                )
            } else {
                (
                    id(
                        "summary-manual/1",
                        &[
                            &request.profile_id.to_string(),
                            &request.event_id.to_string(),
                        ],
                    ),
                    format!("{}/manual/{}", request.profile_id, request.event_id),
                    request.event_id,
                    self.device_id(),
                    request.selection.clone(),
                )
            };
        if !projection::load_jobs(&tx, request.profile_id, task)?.is_empty() {
            return Err(CoreError::SummaryBlocked("trigger_already_requested"));
        }
        let run = id("summary-initial-run/1", &[&task.to_string()]);
        let n = node(
            self,
            request.profile_id,
            task,
            request.event_id,
            vec![],
            SummaryJobPayload::Requested {
                trigger_key: key,
                creator_event_id: creator,
                default_owner_device_id: owner,
                purpose: request.purpose,
                artifact_kind: request.artifact_kind,
                selection,
                initial_run_id: run,
            },
            SummaryActorKind::Human,
            now(),
        );
        let (seq, digest) = insert_job(&tx, n)?;
        let result = receipt(
            &tx,
            request.command_id,
            request.event_id,
            request.profile_id,
            &digest,
            &input,
            seq,
        )?;
        tx.commit()?;
        Ok(result)
    }
    pub fn control_summary(
        &self,
        context: &WriterContext,
        request: &SummaryControlCommand,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, request.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::SummaryControlDenied);
        }
        let input = facts::hash(&(
            context.author_id,
            context.device_id,
            "summary-control/1",
            request,
        ))?;
        let mut c = self.connection()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(old) = replay(&tx, request.profile_id, request.command_id, &input)? {
            return Ok(old);
        }
        let task = projection::load(&tx, request.profile_id, request.task_id)?;
        let mut heads = request.expected_control_heads.clone();
        heads.sort_by_key(ToString::to_string);
        let mut actual = task.view.control_heads.clone();
        actual.sort_by_key(ToString::to_string);
        if task.owner.generation != request.expected_owner_generation
            || task.owner.token != request.expected_owner_control_event_id
            || heads != actual
        {
            return Err(CoreError::SummaryConflict);
        }
        if !task.view.conflicts.is_empty()
            && !matches!(request.action, SummaryControlAction::ResolveOwner { .. })
        {
            return Err(CoreError::SummaryConflict);
        }
        match &request.action {
            SummaryControlAction::QueueUpdate {
                run_id,
                selection,
                supersedes_artifact_id,
            } => {
                facts::selection(selection)?;
                if task.owner.cancelled || *run_id == task.owner.run {
                    return Err(CoreError::SummaryConflict);
                }
                if let Some(old) = supersedes_artifact_id {
                    let old = projection::artifact(&tx, request.profile_id, *old)?
                        .ok_or(CoreError::UnknownSummaryTask)?;
                    if old.task_id != request.task_id {
                        return Err(CoreError::ScopeMismatch);
                    }
                }
            }
            SummaryControlAction::TakeOverForSelf {
                run_id,
                resume_cancelled,
            }
            | SummaryControlAction::ResolveOwner {
                run_id,
                resume_cancelled,
                ..
            } => {
                if *run_id == task.owner.run
                    || run_id.is_nil()
                    || (task.owner.cancelled && !*resume_cancelled)
                {
                    return Err(CoreError::SummaryConflict);
                }
            }
            _ => {}
        }
        let n = node(
            self,
            request.profile_id,
            request.task_id,
            request.event_id,
            task.full_heads,
            SummaryJobPayload::Controlled {
                expected_owner_generation: request.expected_owner_generation,
                expected_owner_control_event_id: request.expected_owner_control_event_id,
                action: request.action.clone(),
            },
            SummaryActorKind::Human,
            now(),
        );
        let (seq, digest) = insert_job(&tx, n)?;
        tx.execute("UPDATE summary_attempts SET state='revoked' WHERE profile_id=?1 AND task_id=?2 AND state='active'",params![request.profile_id.to_string(),request.task_id.to_string()])?;
        let result = receipt(
            &tx,
            request.command_id,
            request.event_id,
            request.profile_id,
            &digest,
            &input,
            seq,
        )?;
        tx.commit()?;
        Ok(result)
    }
    pub fn read_summary_task(
        &self,
        context: &WriterContext,
        p: ProfileId,
        id: Uuid,
    ) -> Result<SummaryTaskView, CoreError> {
        self.check_scope(context, p)?;
        let mut c = self.connection()?;
        let tx = c.transaction()?;
        let view = checked_view(&tx, p, id, self.lifecycle())?.view;
        tx.commit()?;
        Ok(view)
    }
    pub fn summary_tasks_page(
        &self,
        context: &WriterContext,
        p: ProfileId,
        after: Option<Uuid>,
        limit: usize,
    ) -> Result<SummaryTaskPage, CoreError> {
        self.check_scope(context, p)?;
        if limit == 0 || limit > MAX_SUMMARY_PAGE_SIZE {
            return Err(CoreError::InvalidQuery("summary page limit"));
        }
        let mut c = self.connection()?;
        let tx = c.transaction()?;
        let ids = {
            let mut q=tx.prepare("SELECT DISTINCT task_id FROM summary_nodes WHERE profile_id=?1 AND task_id>?2 ORDER BY task_id LIMIT ?3")?;
            q.query_map(
                params![
                    p.to_string(),
                    after.map(|i| i.to_string()).unwrap_or_default(),
                    limit + 1
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?
        };
        let more = ids.len() > limit;
        let mut items = vec![];
        for value in ids.into_iter().take(limit) {
            items.push(checked_view(&tx, p, Uuid::parse_str(&value)?, self.lifecycle())?.view);
        }
        let next_after = if more {
            items.last().map(|i| i.task_id)
        } else {
            None
        };
        tx.commit()?;
        Ok(SummaryTaskPage { items, next_after })
    }
    pub fn summary_artifacts_page(
        &self,
        context: &WriterContext,
        p: ProfileId,
        task: Uuid,
        before: Option<u64>,
        limit: usize,
    ) -> Result<SummaryArtifactPage, CoreError> {
        self.check_scope(context, p)?;
        if limit == 0
            || limit > MAX_SUMMARY_PAGE_SIZE
            || before.is_some_and(|n| n > MAX_SUMMARY_SAFE_COUNTER)
        {
            return Err(CoreError::InvalidQuery("summary artifact page"));
        }
        let mut c = self.connection()?;
        let tx = c.transaction()?;
        let projected = checked_view(&tx, p, task, self.lifecycle())?;
        let highwater: u64 = tx.query_row(
            "SELECT COALESCE(MAX(local_seq),0) FROM events WHERE profile_id=?1",
            [p.to_string()],
            |r| r.get(0),
        )?;
        let rows = {
            let mut q=tx.prepare("SELECT e.event_id,e.local_seq FROM summary_nodes s JOIN events e ON e.event_id=s.event_id WHERE s.profile_id=?1 AND s.task_id=?2 AND s.kind='summary/1' AND e.local_seq<?3 ORDER BY e.local_seq DESC LIMIT ?4")?;
            q.query_map(
                params![
                    p.to_string(),
                    task.to_string(),
                    before.unwrap_or(highwater.saturating_add(1)),
                    limit + 1
                ],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?
        };
        let more = rows.len() > limit;
        let mut items = vec![];
        let mut last = 0;
        for (id, seq) in rows.into_iter().take(limit) {
            let a =
                projection::artifact(&tx, p, id.parse()?)?.ok_or(CoreError::RecoveryRequired)?;
            last = seq;
            let current = projected.view.latest_artifact_id == Some(a.event_id);
            items.push(SummaryArtifactView {
                event_id: a.event_id,
                profile_id: p,
                occurred_at_ms: a.occurred_at_ms,
                device_id: a.device_id,
                author_id: a.author_id,
                task_id: a.task_id,
                run_id: a.run_id,
                attempt_id: a.attempt_id,
                artifact_kind: a.artifact_kind,
                snapshot: a.snapshot,
                output: a.output,
                supersedes_artifact_id: a.supersedes_artifact_id,
                current,
                reason: if current {
                    None
                } else {
                    Some("historical_or_unqualified".into())
                },
            });
        }
        tx.commit()?;
        Ok(SummaryArtifactPage {
            items,
            next_before: if more { Some(last) } else { None },
            highwater,
        })
    }
    pub fn reconcile_summary_triggers(
        &self,
        executor: &SummaryExecutorContext,
    ) -> Result<SummaryReconcileResult, CoreError> {
        let mut c = self.connection()?;
        self.check_summary_executor(executor)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let after: (String, String) = tx.query_row(
            "SELECT after_profile,after_block FROM summary_auto_scan WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let query = |after: &(String, String)| -> Result<Vec<(String, String, String)>, CoreError> {
            let mut q=tx.prepare("SELECT profile_id,block_id,creator_event_id FROM summary_auto_candidates WHERE state='pending' AND (profile_id>?1 OR (profile_id=?1 AND block_id>?2)) ORDER BY profile_id,block_id LIMIT 101")?;
            Ok(q.query_map(params![after.0, after.1], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?)
        };
        let mut rows = query(&after)?;
        if rows.is_empty() {
            rows = query(&(String::new(), String::new()))?;
        }
        let mut out = SummaryReconcileResult {
            created: vec![],
            existing: vec![],
            blocked: vec![],
            has_more: rows.len() > 100,
        };
        for (p, b, creator) in rows.into_iter().take(100) {
            tx.execute(
                "UPDATE summary_auto_scan SET after_profile=?1,after_block=?2 WHERE singleton=1",
                params![p, b],
            )?;
            let p: ProfileId = p.parse()?;
            let block = b.parse()?;
            let task = super::first_id(p, block);
            if !projection::load_jobs(&tx, p, task)?.is_empty() {
                out.existing.push(task);
                tx.execute("UPDATE summary_auto_candidates SET state='created' WHERE profile_id=?1 AND block_id=?2",params![p.to_string(),b])?;
                continue;
            }
            let a = match crate::timeblocks::summary_anchor(&tx, p, block) {
                Ok(a)
                    if a.eligible
                        && a.creator_device_id == self.device_id()
                        && a.creator_event_id.to_string() == creator =>
                {
                    a
                }
                _ => {
                    out.blocked.push(block);
                    continue;
                }
            };
            let new_completion:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM summary_block_sources s JOIN events e ON e.event_id=s.event_id JOIN summary_auto_baseline b ON b.profile_id=e.profile_id WHERE s.profile_id=?1 AND s.block_id=?2 AND e.local_seq>b.through_local_seq AND json_extract(e.body,'$.payload.action.kind')='submit_feedback' AND json_extract(e.body,'$.payload.action.block_id')=?2)",params![p.to_string(),block.to_string()],|r|r.get(0))?;
            if !new_completion {
                tx.execute("UPDATE summary_auto_candidates SET state='created' WHERE profile_id=?1 AND block_id=?2",params![p.to_string(),b])?;
                continue;
            }
            let ev = event(
                "summary-auto-request/1",
                &[&self.device_id().to_string(), &task.to_string()],
            );
            let n = node(
                self,
                p,
                task,
                ev,
                vec![],
                SummaryJobPayload::Requested {
                    trigger_key: super::first_key(p, block),
                    creator_event_id: a.creator_event_id,
                    default_owner_device_id: a.creator_device_id,
                    purpose: SummaryPurpose::FirstReviewV1,
                    artifact_kind: SummaryArtifactKind::Review,
                    selection: SummarySelection {
                        block_ids: vec![block],
                        from_ms: a.from_ms,
                        to_ms: a.to_ms,
                        selected_original_ids: vec![],
                    },
                    initial_run_id: id("summary-initial-run/1", &[&task.to_string()]),
                },
                SummaryActorKind::Executor,
                now(),
            );
            insert_job(&tx, n)?;
            tx.execute("UPDATE summary_auto_candidates SET state='created' WHERE profile_id=?1 AND block_id=?2",params![p.to_string(),b])?;
            out.created.push(task);
        }
        tx.commit()?;
        Ok(out)
    }
    pub fn begin_summary_attempt(
        &self,
        executor: &SummaryExecutorContext,
        request: &SummaryBeginCommand,
    ) -> Result<SummaryWork, CoreError> {
        let mut c = self.connection()?;
        self.check_summary_executor(executor)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !facts::sha(&request.role_config_digest)
            || request.max_attempts == 0
            || request.max_attempts > MAX_SUMMARY_ATTEMPTS
            || request.attempt_id.is_nil()
            || request.now_ms < 0
        {
            return Err(facts::invalid("begin bounds"));
        }
        let input = facts::hash(&(self.device_id(), "summary-begin/1", request))?;
        let task = projection::load(&tx, request.profile_id, request.task_id)?;
        qualify(&task, self)?;
        if task.owner.generation != request.expected_owner_generation
            || task.owner.token != request.expected_owner_control_event_id
            || task.owner.run != request.expected_run_id
        {
            return Err(CoreError::SummaryConflict);
        }
        // A lost begin response can only recover a still-active ticket in THIS
        // lifecycle. It does not authorize repeating an ambiguous external request.
        if let Some(old) = replay(&tx, request.profile_id, request.command_id, &input)? {
            let source = task
                .view
                .current_run
                .as_ref()
                .and_then(|r| r.snapshot.clone())
                .ok_or(CoreError::SummaryConflict)?;
            let ticket = self.make_summary_ticket(request, &source);
            self.validate_summary_ticket(&tx, executor, &ticket)?;
            return Ok(SummaryWork {
                ticket,
                snapshot: source,
                receipt: old,
            });
        }
        let retry_ready = task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.attempt.as_ref())
            .and_then(|a| a.retry_at_ms)
            .is_none_or(|at| at <= request.now_ms);
        if !matches!(
            task.view.state,
            SummaryState::Queued | SummaryState::WaitingConfiguration | SummaryState::RetryWait
        ) || !retry_ready
        {
            return Err(CoreError::SummaryBlocked("attempt_state"));
        }
        let previous = task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.attempt.as_ref())
            .map(|a| a.number)
            .unwrap_or(0);
        let maximum = if previous > 0 {
            if task.role_config_digest.as_deref() != Some(request.role_config_digest.as_str()) {
                return Err(CoreError::SummaryBlocked(
                    "configuration_changed_new_run_required",
                ));
            }
            task.max_attempts.min(request.max_attempts)
        } else {
            request.max_attempts
        };
        if previous >= maximum {
            return Err(CoreError::SummaryBlocked("attempt_limit"));
        }
        let source = match task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.snapshot.clone())
        {
            Some(source) => source,
            None => sources::freeze(&tx, request.profile_id, task.owner.selection.clone())?,
        };
        if source.sources.is_empty() {
            return Err(CoreError::SummaryBlocked("empty_sources"));
        }
        if !sources::selected_ready(&source) {
            return Err(CoreError::SummaryBlocked("originals_missing"));
        }
        let n = node(
            self,
            request.profile_id,
            request.task_id,
            request.event_id,
            task.full_heads,
            SummaryJobPayload::Execution {
                run_id: task.owner.run,
                owner_generation: task.owner.generation,
                owner_control_event_id: task.owner.token,
                state: SummaryState::Running,
                reason: None,
                attempt_id: Some(request.attempt_id),
                attempt_number: previous + 1,
                retry_at_ms: None,
                snapshot: Some(source.clone()),
                role_config_digest: Some(request.role_config_digest.clone()),
                max_attempts: maximum,
            },
            SummaryActorKind::Executor,
            request.now_ms,
        );
        let (seq, digest) = insert_job(&tx, n)?;
        let result = receipt(
            &tx,
            request.command_id,
            request.event_id,
            request.profile_id,
            &digest,
            &input,
            seq,
        )?;
        let values: [&str; 2] = [
            &request.attempt_id.to_string(),
            &self.device_id().to_string(),
        ];
        tx.execute(
            "INSERT INTO summary_attempts VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'active')",
            params![
                request.attempt_id.to_string(),
                request.profile_id.to_string(),
                request.task_id.to_string(),
                task.owner.run.to_string(),
                self.lifecycle().to_string(),
                source.digest,
                request.role_config_digest,
                previous + 1,
                maximum,
                command("summary-result-command/1", &values).to_string(),
                event("summary-result/1", &values).to_string(),
                event("summary-published/1", &values).to_string()
            ],
        )?;
        tx.commit()?;
        Ok(SummaryWork {
            ticket: self.make_summary_ticket(request, &source),
            snapshot: source,
            receipt: result,
        })
    }
    fn make_summary_ticket(
        &self,
        r: &SummaryBeginCommand,
        s: &SummarySourceSnapshot,
    ) -> SummaryRunTicket {
        SummaryRunTicket {
            lifecycle: self.lifecycle(),
            profile_id: r.profile_id,
            task_id: r.task_id,
            run_id: r.expected_run_id,
            attempt_id: r.attempt_id,
            owner_generation: r.expected_owner_generation,
            owner_control_event_id: r.expected_owner_control_event_id,
            snapshot_digest: s.digest.clone(),
        }
    }
    fn validate_summary_ticket(
        &self,
        c: &Connection,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
    ) -> Result<projection::Task, CoreError> {
        self.check_summary_executor(executor)?;
        if ticket.lifecycle != self.lifecycle() {
            return Err(CoreError::StaleSummaryTicket);
        }
        let task = projection::load(c, ticket.profile_id, ticket.task_id)?;
        qualify(&task, self)?;
        let active:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM summary_attempts WHERE attempt_id=?1 AND profile_id=?2 AND task_id=?3 AND run_id=?4 AND core_lifecycle=?5 AND snapshot_digest=?6 AND state='active')",params![ticket.attempt_id.to_string(),ticket.profile_id.to_string(),ticket.task_id.to_string(),ticket.run_id.to_string(),ticket.lifecycle.to_string(),ticket.snapshot_digest],|r|r.get(0))?;
        if !active
            || task.view.state != SummaryState::Running
            || task.owner.generation != ticket.owner_generation
            || task.owner.token != ticket.owner_control_event_id
            || task.owner.run != ticket.run_id
            || task
                .view
                .current_run
                .as_ref()
                .and_then(|r| r.attempt.as_ref())
                .is_none_or(|a| a.attempt_id != ticket.attempt_id)
        {
            return Err(CoreError::StaleSummaryTicket);
        }
        Ok(task)
    }
    pub fn summary_input_records(
        &self,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
    ) -> Result<SummaryInputRecords, CoreError> {
        let mut c = self.connection()?;
        let tx = c.transaction()?;
        let task = self.validate_summary_ticket(&tx, executor, ticket)?;
        let source = task
            .view
            .current_run
            .and_then(|r| r.snapshot)
            .ok_or(CoreError::StaleSummaryTicket)?;
        if source.digest != ticket.snapshot_digest {
            return Err(CoreError::StaleSummaryTicket);
        }
        let input = sources::input(&tx, ticket.profile_id, &source)?;
        tx.commit()?;
        Ok(input)
    }
    pub fn validate_summary_run(
        &self,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
    ) -> Result<(), CoreError> {
        let c = self.connection()?;
        self.validate_summary_ticket(&c, executor, ticket)
            .map(|_| ())
    }
    pub fn finish_summary_attempt(
        &self,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
        output: &SummaryOutput,
    ) -> Result<SummaryCommitOutcome, CoreError> {
        let mut c = self.connection()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // A committed result receipt is immutable. Reading that same receipt
        // again is allowed after a later cancel/stop; no fact is re-sealed.
        if executor.lifecycle == self.lifecycle()
            && ticket.lifecycle == self.lifecycle()
            && executor.device_id == self.device_id()
        {
            let stored:Option<(String,String)>=tx.query_row("SELECT result_command_id,result_event_id FROM summary_attempts WHERE attempt_id=?1 AND profile_id=?2 AND task_id=?3 AND run_id=?4 AND core_lifecycle=?5 AND snapshot_digest=?6 AND state='finished'",params![ticket.attempt_id.to_string(),ticket.profile_id.to_string(),ticket.task_id.to_string(),ticket.run_id.to_string(),ticket.lifecycle.to_string(),ticket.snapshot_digest],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            if let Some((command, event)) = stored {
                let command = command.parse()?;
                let input = facts::hash(&(ticket.attempt_id, output))?;
                let receipt = replay(&tx, ticket.profile_id, command, &input)?
                    .ok_or(CoreError::RecoveryRequired)?;
                return Ok(SummaryCommitOutcome::Applied {
                    receipt,
                    artifact_event_id: event.parse()?,
                });
            }
        }
        let task = match self.validate_summary_ticket(&tx, executor, ticket) {
            Ok(task) => task,
            Err(
                CoreError::StaleSummaryTicket
                | CoreError::SummaryExecutorStopped
                | CoreError::SummaryNotOwner
                | CoreError::SummaryBlocked(_),
            ) => return Ok(SummaryCommitOutcome::Stale),
            Err(e) => return Err(e),
        };
        let source = task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.snapshot.clone())
            .ok_or(CoreError::StaleSummaryTicket)?;
        facts::output(output, &source)?;
        if task.role_config_digest.as_deref() != Some(&output.model.role_config_digest) {
            return Err(facts::invalid("configuration changed"));
        }
        let(cmd,ev,pub_ev):(String,String,String)=tx.query_row("SELECT result_command_id,result_event_id,published_event_id FROM summary_attempts WHERE attempt_id=?1",[ticket.attempt_id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        let cmd = cmd.parse()?;
        let ev = ev.parse()?;
        let pub_ev = pub_ev.parse()?;
        let input = facts::hash(&(ticket.attempt_id, output))?;
        let mut artifact = SummaryArtifactRecord {
            event_id: ev,
            profile_id: ticket.profile_id,
            device_id: self.device_id(),
            author_id: self.human_author(),
            task_id: ticket.task_id,
            run_id: ticket.run_id,
            attempt_id: ticket.attempt_id,
            owner_generation: ticket.owner_generation,
            owner_control_event_id: ticket.owner_control_event_id,
            artifact_kind: task.artifact_kind,
            snapshot: source,
            output: output.clone(),
            supersedes_artifact_id: task.owner.supersedes,
            occurred_at_ms: now(),
            digest: String::new(),
            local_seq: 0,
        };
        artifact.digest = artifact.computed_digest()?;
        artifact.validate()?;
        tx.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,'summary/1')",params![ev.to_string(),ticket.profile_id.to_string(),artifact.digest,crate::fact_encoding::encode_fact(&artifact)?])?;
        let seq = tx.last_insert_rowid() as u64;
        super::schema::index(&tx, ev, ticket.profile_id, ticket.task_id, "summary/1")?;
        crate::replication::record_local_fact(
            &tx,
            ticket.profile_id,
            self.device_id(),
            ev,
            "summary/1",
            &artifact.digest,
        )?;
        insert_job(
            &tx,
            node(
                self,
                ticket.profile_id,
                ticket.task_id,
                pub_ev,
                task.full_heads,
                SummaryJobPayload::Published {
                    run_id: ticket.run_id,
                    attempt_id: ticket.attempt_id,
                    owner_generation: ticket.owner_generation,
                    owner_control_event_id: ticket.owner_control_event_id,
                    artifact_event_id: ev,
                },
                SummaryActorKind::Executor,
                artifact.occurred_at_ms,
            ),
        )?;
        let result = receipt(
            &tx,
            cmd,
            ev,
            ticket.profile_id,
            &artifact.digest,
            &input,
            seq,
        )?;
        tx.execute(
            "UPDATE summary_attempts SET state='finished' WHERE attempt_id=?1",
            [ticket.attempt_id.to_string()],
        )?;
        tx.commit()?;
        Ok(SummaryCommitOutcome::Applied {
            receipt: result,
            artifact_event_id: ev,
        })
    }
    pub fn fail_summary_attempt(
        &self,
        executor: &SummaryExecutorContext,
        ticket: &SummaryRunTicket,
        kind: SummaryFailureKind,
        retry_at_ms: Option<i64>,
    ) -> Result<SummaryAttemptOutcome, CoreError> {
        let mut c = self.connection()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = match self.validate_summary_ticket(&tx, executor, ticket) {
            Ok(t) => t,
            Err(
                CoreError::StaleSummaryTicket
                | CoreError::SummaryExecutorStopped
                | CoreError::SummaryNotOwner
                | CoreError::SummaryBlocked(_),
            ) => return Ok(SummaryAttemptOutcome::Stale),
            Err(e) => return Err(e),
        };
        if retry_at_ms.is_some_and(|ms| ms < 0) {
            return Err(facts::invalid("retry time"));
        }
        let attempt = task
            .view
            .current_run
            .as_ref()
            .and_then(|r| r.attempt.as_ref())
            .ok_or(CoreError::StaleSummaryTicket)?;
        // An unknown outcome (including restart) never schedules a second paid call.
        let may_retry = retry_at_ms.is_some()
            && attempt.number < task.max_attempts
            && matches!(
                kind,
                SummaryFailureKind::RateLimited | SummaryFailureKind::ProviderUnavailable
            );
        let state = if may_retry {
            SummaryState::RetryWait
        } else {
            SummaryState::Failed
        };
        let reason = serde_json::to_value(kind)?
            .as_str()
            .ok_or(facts::invalid("failure enum"))?
            .to_string();
        let ev = event("summary-failure/1", &[&ticket.attempt_id.to_string()]);
        let cmd = command(
            "summary-failure-command/1",
            &[&ticket.attempt_id.to_string()],
        );
        let input = facts::hash(&(ticket.attempt_id, kind, retry_at_ms))?;
        let (seq, digest) = insert_job(
            &tx,
            node(
                self,
                ticket.profile_id,
                ticket.task_id,
                ev,
                task.full_heads.clone(),
                SummaryJobPayload::Execution {
                    run_id: ticket.run_id,
                    owner_generation: ticket.owner_generation,
                    owner_control_event_id: ticket.owner_control_event_id,
                    state,
                    reason: Some(reason),
                    attempt_id: Some(ticket.attempt_id),
                    attempt_number: attempt.number,
                    retry_at_ms: if may_retry { retry_at_ms } else { None },
                    snapshot: task.view.current_run.and_then(|r| r.snapshot),
                    role_config_digest: task.role_config_digest,
                    max_attempts: task.max_attempts,
                },
                SummaryActorKind::Executor,
                now(),
            ),
        )?;
        tx.execute(
            "UPDATE summary_attempts SET state='failed' WHERE attempt_id=?1",
            [ticket.attempt_id.to_string()],
        )?;
        let r = receipt(&tx, cmd, ev, ticket.profile_id, &digest, &input, seq)?;
        tx.commit()?;
        Ok(SummaryAttemptOutcome::Applied { receipt: r })
    }
    /// Reconcile ambiguous old-process attempts without acquiring them. No
    /// provider retry is implied; human new-run control is required afterward.
    pub fn recover_summary_attempts(
        &self,
        executor: &SummaryExecutorContext,
        now_ms: i64,
    ) -> Result<usize, CoreError> {
        if now_ms < 0 {
            return Err(facts::invalid("recovery time"));
        }
        let mut c = self.connection()?;
        self.check_summary_executor(executor)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let rows = {
            let mut q=tx.prepare("SELECT attempt_id,profile_id,task_id,run_id,attempt_number,max_attempts,role_config_digest FROM summary_attempts WHERE state='active' AND core_lifecycle<>?1 ORDER BY attempt_id LIMIT 100")?;
            q.query_map([self.lifecycle().to_string()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, u32>(4)?,
                    r.get::<_, u32>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        let mut count = 0;
        for (a, p, t, run, number, max, config) in rows {
            let p = p.parse()?;
            let task = projection::load(&tx, p, Uuid::parse_str(&t)?)?;
            if task.owner.device == self.device_id()
                && task.owner.run.to_string() == run
                && task.view.state == SummaryState::Running
                && task
                    .view
                    .current_run
                    .as_ref()
                    .and_then(|r| r.attempt.as_ref())
                    .is_some_and(|v| v.attempt_id.to_string() == a)
            {
                insert_job(
                    &tx,
                    node(
                        self,
                        p,
                        task.view.task_id,
                        event("summary-recovery/1", &[&a]),
                        task.full_heads,
                        SummaryJobPayload::Execution {
                            run_id: task.owner.run,
                            owner_generation: task.owner.generation,
                            owner_control_event_id: task.owner.token,
                            state: SummaryState::Failed,
                            reason: Some("external_outcome_unknown".into()),
                            attempt_id: Some(Uuid::parse_str(&a)?),
                            attempt_number: number,
                            retry_at_ms: None,
                            snapshot: task.view.current_run.and_then(|r| r.snapshot),
                            role_config_digest: Some(config),
                            max_attempts: max,
                        },
                        SummaryActorKind::Executor,
                        now_ms,
                    ),
                )?;
                count += 1;
            }
            tx.execute(
                "UPDATE summary_attempts SET state='revoked' WHERE attempt_id=?1",
                [a],
            )?;
        }
        tx.commit()?;
        Ok(count)
    }
    /// Configuration absence is a durable, bounded state; repeated polling is a
    /// read/no-op. It never mints an attempt or provider capability.
    pub fn summary_wait_for_configuration(
        &self,
        executor: &SummaryExecutorContext,
        p: ProfileId,
        task_id: Uuid,
    ) -> Result<(), CoreError> {
        let mut c = self.connection()?;
        self.check_summary_executor(executor)?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = projection::load(&tx, p, task_id)?;
        qualify(&task, self)?;
        if task.view.state == SummaryState::WaitingConfiguration {
            return Ok(());
        }
        if task.view.state != SummaryState::Queued {
            return Err(CoreError::SummaryBlocked("configuration_state"));
        }
        insert_job(
            &tx,
            node(
                self,
                p,
                task_id,
                event(
                    "summary-wait-config/1",
                    &[&task.owner.token.to_string(), &task.owner.run.to_string()],
                ),
                task.full_heads,
                SummaryJobPayload::Execution {
                    run_id: task.owner.run,
                    owner_generation: task.owner.generation,
                    owner_control_event_id: task.owner.token,
                    state: SummaryState::WaitingConfiguration,
                    reason: Some("configuration_required".into()),
                    attempt_id: None,
                    attempt_number: 0,
                    retry_at_ms: None,
                    snapshot: None,
                    role_config_digest: None,
                    max_attempts: MAX_SUMMARY_ATTEMPTS,
                },
                SummaryActorKind::Executor,
                now(),
            ),
        )?;
        tx.commit()?;
        Ok(())
    }
}
