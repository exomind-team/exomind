use crate::{
    BetaHost, HostError,
    agent_wait::{AgentWaitRequest, AgentWaitResult, AgentWaitState, WAIT_POLL_INTERVAL},
    http::{bearer, work},
};
use axum::{
    Json, Router,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::HeaderMap,
    routing::post,
};
use exomind_core::ProfileId;
use std::{sync::Arc, time::Duration};
use tokio::time::{Instant, sleep_until, timeout_at};

async fn wait(
    State(host): State<Arc<BetaHost>>,
    headers: HeaderMap,
    path: Result<Path<ProfileId>, PathRejection>,
    body: Result<Json<AgentWaitRequest>, JsonRejection>,
) -> Result<Json<AgentWaitResult>, HostError> {
    let token = bearer(&headers)?;
    let Path(profile) = path.map_err(|_| HostError::InvalidRequest)?;
    let Json(request) = body.map_err(|_| HostError::InvalidRequest)?;
    request.validate()?;

    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    let session = work(host.clone(), move |host| host.authenticate(&token)).await?;
    let admission_session = session.clone();
    let _permit = work(host.clone(), move |host| {
        host.begin_agent_wait(&admission_session, profile)
    })
    .await?;
    let mut signal = host.subscribe_agent_wait();
    let _initial_generation = signal.borrow().generation;
    let mut last_highwater = None;
    let mut first_read = true;
    if Instant::now() >= deadline {
        return Ok(Json(AgentWaitResult {
            state: AgentWaitState::Timeout,
            profile_id: profile,
            after_local_seq: request.after_local_seq,
            highwater: None,
        }));
    }

    loop {
        if signal.borrow().stopped {
            return Err(HostError::Stopped);
        }
        let read_session = session.clone();
        let highwater = match timeout_at(
            deadline,
            work(host.clone(), move |host| {
                host.agent_profile_highwater(&read_session, profile)
            }),
        )
        .await
        {
            Ok(result) => result?,
            Err(_) => {
                return Ok(Json(AgentWaitResult {
                    state: AgentWaitState::Timeout,
                    profile_id: profile,
                    after_local_seq: request.after_local_seq,
                    highwater: last_highwater,
                }));
            }
        };
        last_highwater = Some(highwater);
        if first_read && request.after_local_seq > highwater {
            return Err(HostError::InvalidRequest);
        }
        first_read = false;
        if Instant::now() >= deadline {
            return Ok(Json(AgentWaitResult {
                state: AgentWaitState::Timeout,
                profile_id: profile,
                after_local_seq: request.after_local_seq,
                highwater: last_highwater,
            }));
        }
        if highwater > request.after_local_seq {
            return Ok(Json(AgentWaitResult {
                state: AgentWaitState::Changed,
                profile_id: profile,
                after_local_seq: request.after_local_seq,
                highwater: Some(highwater),
            }));
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok(Json(AgentWaitResult {
                state: AgentWaitState::Timeout,
                profile_id: profile,
                after_local_seq: request.after_local_seq,
                highwater: Some(highwater),
            }));
        }
        let next_poll = (now + WAIT_POLL_INTERVAL).min(deadline);
        tokio::select! {
            _ = sleep_until(next_poll) => {}
            changed = signal.changed() => {
                if changed.is_err() || signal.borrow().stopped {
                    return Err(HostError::Stopped);
                }
                let _observed_generation = signal.borrow().generation;
            }
        }
    }
}

pub(crate) fn router() -> Router<Arc<BetaHost>> {
    Router::new().route("/beta/v1/profiles/:profile/wait", post(wait))
}
