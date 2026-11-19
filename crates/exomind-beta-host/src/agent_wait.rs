//! Bounded, profile-scoped change waits for Beta Agent clients.
//!
//! Each HTTP request owns its polling loop and concurrency permit. There is no
//! detached worker and no background polling when the endpoint is idle.

use crate::{BetaHost, HostError, Session, resources};
use exomind_core::{EventQuery, ProfileId};
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::watch;

pub(crate) const MAX_WAIT_TIMEOUT_MS: u64 = 30_000;
pub(crate) const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_CONCURRENT_WAITS: usize = 4;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AgentWaitRequest {
    pub after_local_seq: u64,
    pub timeout_ms: u64,
}

impl AgentWaitRequest {
    pub(crate) fn validate(&self) -> Result<(), HostError> {
        if !(1..=MAX_WAIT_TIMEOUT_MS).contains(&self.timeout_ms) {
            return Err(HostError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentWaitState {
    Changed,
    Timeout,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentWaitResult {
    pub state: AgentWaitState,
    pub profile_id: ProfileId,
    pub after_local_seq: u64,
    pub highwater: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct WaitSignal {
    pub(crate) generation: u64,
    pub(crate) stopped: bool,
}

pub(crate) struct AgentWaitService {
    active: Arc<AtomicUsize>,
    signal: watch::Sender<WaitSignal>,
}

impl Default for AgentWaitService {
    fn default() -> Self {
        let (signal, _) = watch::channel(WaitSignal::default());
        Self {
            active: Arc::new(AtomicUsize::new(0)),
            signal,
        }
    }
}

pub(crate) struct AgentWaitPermit {
    active: Arc<AtomicUsize>,
}

impl Drop for AgentWaitPermit {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

impl AgentWaitService {
    fn admit(&self) -> Result<AgentWaitPermit, HostError> {
        let mut active = self.active.load(Ordering::Acquire);
        loop {
            if active >= MAX_CONCURRENT_WAITS {
                return Err(HostError::AgentWaitBusy);
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Ok(AgentWaitPermit {
                        active: self.active.clone(),
                    });
                }
                Err(current) => active = current,
            }
        }
    }

    pub(crate) fn subscribe(&self) -> watch::Receiver<WaitSignal> {
        self.signal.subscribe()
    }

    pub(crate) fn wake(&self) {
        self.signal.send_modify(|signal| {
            signal.generation = signal.generation.wrapping_add(1);
        });
    }

    pub(crate) fn stop(&self) {
        self.signal.send_modify(|signal| {
            signal.generation = signal.generation.wrapping_add(1);
            signal.stopped = true;
        });
    }
}

impl BetaHost {
    pub(crate) fn begin_agent_wait(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<AgentWaitPermit, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.profile_authority(resources, session, profile, false)?;
        drop(state);
        self.agent_wait.admit()
    }

    pub(crate) fn subscribe_agent_wait(&self) -> watch::Receiver<WaitSignal> {
        self.agent_wait.subscribe()
    }

    /// The capture page's highwater covers the full profile sequence, including
    /// typed facts that are not captures. It returns no record body to Wait.
    pub(crate) fn agent_profile_highwater(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<u64, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let query = EventQuery {
            limit: 1,
            ..EventQuery::default()
        };
        Ok(resources
            .core
            .events_page(
                &crate::context(&resources.core, &authority)?,
                profile,
                &query,
            )?
            .highwater)
    }
}
