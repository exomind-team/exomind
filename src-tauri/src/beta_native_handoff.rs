//! One current platform handoff and a bounded, durable-confirmation ACK queue.
use super::{Cancellation, Failure};
use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex, time::Duration};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Handoff {
    pub handoff_id: Uuid,
    pub profile_id: Uuid,
    pub block_id: Uuid,
    pub deadline_id: Uuid,
}
fn invalid() -> Failure {
    Failure {
        code: "deadline_handoff_invalid",
        message: "提醒来源尚未通过本机校验，请保留并重试",
    }
}
fn unconfirmed() -> Failure {
    Failure {
        code: "deadline_handoff_unconfirmed",
        message: "提醒打开确认尚未持久完成，请保留并重试",
    }
}
fn uuid(value: &str) -> Result<Uuid, Failure> {
    let id = Uuid::parse_str(value).map_err(|_| invalid())?;
    if id.is_nil() || id.to_string() != value {
        return Err(invalid());
    }
    Ok(id)
}
#[derive(Default)]
struct State {
    pending: Option<Handoff>,
    queued: VecDeque<Uuid>,
    finished: VecDeque<(Uuid, bool)>,
    failed: bool,
}
pub(super) struct Mailbox {
    state: Mutex<State>,
    changed: tokio::sync::watch::Sender<u64>,
    pub wake: tokio::sync::Notify,
}
impl Default for Mailbox {
    fn default() -> Self {
        Self {
            state: Mutex::new(State::default()),
            changed: tokio::sync::watch::channel(0).0,
            wake: tokio::sync::Notify::new(),
        }
    }
}
impl Mailbox {
    fn changed(&self) {
        self.changed
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }
    pub(super) fn pending(&self) -> Result<Option<Handoff>, Failure> {
        let state = self.state.lock().map_err(|_| invalid())?;
        if state.failed {
            return Err(unconfirmed());
        }
        Ok(state.pending.clone())
    }
    pub(super) fn next_ack(&self) -> Option<Uuid> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.queued.front().copied())
    }
    pub(super) fn fail(&self) -> bool {
        let mut changed = false;
        if let Ok(mut state) = self.state.lock() {
            changed = !state.failed;
            state.failed = true;
        }
        self.changed();
        changed
    }
    pub(super) fn publish(
        &self,
        raw: Option<exomind_android_timeblock_end_alert::BetaDeadlineHandoff>,
        requested: Option<Uuid>,
        acknowledged: Option<String>,
    ) -> Result<bool, Failure> {
        let incoming = raw
            .map(|raw| {
                Ok::<Handoff, Failure>(Handoff {
                    handoff_id: uuid(&raw.handoff_id)?,
                    profile_id: uuid(&raw.profile_id)?,
                    block_id: uuid(&raw.block_id)?,
                    deadline_id: uuid(&raw.deadline_id)?,
                })
            })
            .transpose()?;
        let acknowledged = acknowledged.as_deref().map(uuid).transpose()?;
        if acknowledged.is_some() && acknowledged != requested {
            return Err(invalid());
        }
        if acknowledged.is_some() && incoming.as_ref().map(|item| item.handoff_id) == acknowledged {
            return Err(invalid());
        }
        let mut state = self.state.lock().map_err(|_| invalid())?;
        if let (Some(old), Some(next)) = (&state.pending, &incoming) {
            if old.handoff_id == next.handoff_id && old != next {
                return Err(invalid());
            }
        }
        let changed = state.failed || state.pending != incoming;
        state.pending = incoming;
        state.failed = false;
        if let Some(id) = requested {
            state.queued.retain(|queued| *queued != id);
            state.finished.push_back((id, acknowledged == Some(id)));
            while state.finished.len() > 8 {
                state.finished.pop_front();
            }
        }
        drop(state);
        self.changed();
        Ok(changed)
    }
    pub(super) async fn acknowledge(
        &self,
        id: Uuid,
        cancel: &Cancellation,
    ) -> Result<bool, Failure> {
        if id.is_nil() {
            return Err(invalid());
        }
        let mut changed = self.changed.subscribe();
        {
            let mut state = self.state.lock().map_err(|_| invalid())?;
            if let Some((_, value)) = state.finished.iter().rev().find(|(done, _)| *done == id) {
                return Ok(*value);
            }
            if state.failed {
                return Err(unconfirmed());
            }
            if state.pending.as_ref().map(|pending| pending.handoff_id) != Some(id) {
                return Ok(false);
            }
            if !state.queued.contains(&id) {
                if state.queued.len() >= 4 {
                    return Err(Failure {
                        code: "deadline_handoff_busy",
                        message: "已有提醒确认等待系统完成",
                    });
                }
                state.queued.push_back(id);
            }
        }
        self.wake.notify_one();
        tokio::time::timeout(Duration::from_secs(8),async {
            loop {
                {let state=self.state.lock().map_err(|_|invalid())?;if let Some((_,value))=state.finished.iter().rev().find(|(done,_)|*done==id){return Ok(*value);}if state.failed{return Err(unconfirmed());}}
                tokio::select!{_=cancel.cancelled()=>return Err(unconfirmed()),result=changed.changed()=>{if result.is_err(){return Err(unconfirmed());}}}
            }
        }).await.map_err(|_|unconfirmed())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn raw(id: Uuid) -> exomind_android_timeblock_end_alert::BetaDeadlineHandoff {
        exomind_android_timeblock_end_alert::BetaDeadlineHandoff {
            handoff_id: id.to_string(),
            profile_id: Uuid::new_v4().to_string(),
            block_id: Uuid::new_v4().to_string(),
            deadline_id: Uuid::new_v4().to_string(),
        }
    }
    #[tokio::test]
    async fn ack_waits_for_platform_confirmation_and_old_ack_cannot_clear_latest_tap() {
        let mailbox = Arc::new(Mailbox::default());
        let cancel = Cancellation::default();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        mailbox.publish(Some(raw(first)), None, None).unwrap();
        assert!(!mailbox.acknowledge(Uuid::new_v4(), &cancel).await.unwrap());
        let receiver = mailbox.clone();
        let stop = cancel.clone();
        let ack = tokio::spawn(async move { receiver.acknowledge(first, &stop).await });
        mailbox.wake.notified().await;
        assert_eq!(mailbox.next_ack(), Some(first));
        assert!(!ack.is_finished());
        let newer = raw(second);
        mailbox
            .publish(Some(newer.clone()), Some(first), None)
            .unwrap();
        assert!(!ack.await.unwrap().unwrap());
        assert_eq!(mailbox.pending().unwrap().unwrap().handoff_id, second);
        let receiver = mailbox.clone();
        let stop = cancel.clone();
        let ack = tokio::spawn(async move { receiver.acknowledge(second, &stop).await });
        mailbox.wake.notified().await;
        assert!(!ack.is_finished());
        mailbox
            .publish(None, Some(second), Some(second.to_string()))
            .unwrap();
        assert!(ack.await.unwrap().unwrap());
        assert!(mailbox.pending().unwrap().is_none());
    }
    #[tokio::test]
    async fn failure_retains_pending_and_never_calls_a_queued_ack_durable() {
        let mailbox = Arc::new(Mailbox::default());
        let id = Uuid::new_v4();
        mailbox.publish(Some(raw(id)), None, None).unwrap();
        let receiver = mailbox.clone();
        let ack =
            tokio::spawn(async move { receiver.acknowledge(id, &Cancellation::default()).await });
        mailbox.wake.notified().await;
        mailbox.fail();
        assert_eq!(
            ack.await.unwrap().unwrap_err().code,
            "deadline_handoff_unconfirmed"
        );
        assert_eq!(
            mailbox
                .state
                .lock()
                .unwrap()
                .pending
                .as_ref()
                .unwrap()
                .handoff_id,
            id
        );
    }
    #[test]
    fn invalid_scope_or_unsolicited_ack_cannot_replace_cached_source() {
        let mailbox = Mailbox::default();
        let id = Uuid::new_v4();
        let valid = raw(id);
        mailbox.publish(Some(valid.clone()), None, None).unwrap();
        let mut changed = valid.clone();
        changed.profile_id = Uuid::new_v4().to_string();
        assert!(mailbox.publish(Some(changed), None, None).is_err());
        assert!(mailbox.publish(None, None, Some(id.to_string())).is_err());
        assert_eq!(mailbox.pending().unwrap().unwrap().handoff_id, id);
        assert!(
            mailbox
                .publish(Some(valid.clone()), Some(id), Some(id.to_string()))
                .is_err()
        );
        let mut malformed = valid;
        malformed.block_id = Uuid::nil().to_string();
        assert!(mailbox.publish(Some(malformed), None, None).is_err());
    }
}
