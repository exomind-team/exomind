//! The authenticated Beta host. HTTP and trusted native IPC share this facade;
//! the legacy Runtime and its stores are never instantiated here.
mod http;
#[cfg(test)]
mod original_tests;
mod originals;
mod originals_http;
#[cfg(test)]
mod stop_tests;
mod storage;

use exomind_core::{
    AgentId, CaptureCommand, CommandId, Core, CoreError, DeviceId, EventPage, EventQuery,
    ProfileId, ProfileInfo, Receipt, WriterContext,
};
pub use http::{RunningServer, serve, serve_with_frontend_origins};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{
        Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};
use storage::{Persistence, token, token_hash};
use uuid::Uuid;

pub const PROTOCOL: &str = "exomind-beta/1";

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("an absolute independent root is required")]
    InvalidRoot,
    #[error("the root belongs to another application")]
    ForeignRoot,
    #[error("the root is already in use")]
    RootInUse,
    #[error("private filesystem permissions could not be applied")]
    PrivatePermissions,
    #[error("existing owner credentials are unavailable or inconsistent")]
    CredentialsUnavailable,
    #[error("authentication required")]
    Unauthorized,
    #[error("capability or profile scope does not permit this action")]
    Forbidden,
    #[error("host has stopped")]
    Stopped,
    #[error("invalid request")]
    InvalidRequest,
    #[error("resource was not found")]
    NotFound,
    #[error("host state lock was poisoned")]
    StatePoisoned,
    #[error("only a loopback listener is permitted")]
    UntrustedBind,
    #[error("request host or origin was rejected")]
    UntrustedOrigin,
    #[error("listener shutdown was interrupted")]
    Shutdown,
    #[error("request body exceeds the permitted size")]
    PayloadTooLarge,
    #[error("all original verification slots are in use")]
    VerificationBusy,
    #[error("core operation failed")]
    Core(#[from] CoreError),
    #[error("host database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("host filesystem operation failed")]
    Filesystem(#[from] std::io::Error),
    #[error("host persisted data is invalid")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrantKind {
    Observer,
    Human,
    AgentNote,
}

impl GrantKind {
    fn label(self) -> &'static str {
        match self {
            Self::Observer => "observer",
            Self::Human => "human",
            Self::AgentNote => "agent_note",
        }
    }
    fn parse(value: &str) -> Result<Self, HostError> {
        match value {
            "observer" => Ok(Self::Observer),
            "human" => Ok(Self::Human),
            "agent_note" => Ok(Self::AgentNote),
            _ => Err(HostError::CredentialsUnavailable),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantRequest {
    pub profile_id: ProfileId,
    pub kind: GrantKind,
    pub agent_id: Option<AgentId>,
}

#[derive(Serialize)]
pub struct IssuedGrant {
    pub grant_id: Uuid,
    pub profile_id: ProfileId,
    pub kind: GrantKind,
    pub token: String,
}

#[derive(Clone, Copy)]
enum Authority {
    Owner,
    Grant(Uuid),
}

/// An in-process capability, not a serializable request DTO. Each final
/// operation checks its lifecycle and current revocation state under the gate.
#[derive(Clone)]
pub struct Session {
    runtime_id: Uuid,
    authority: Authority,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostStatus {
    pub protocol: &'static str,
    pub runtime_id: Uuid,
    pub device_id: DeviceId,
    pub running: bool,
    pub capabilities: HostCapabilities,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostCapabilities {
    pub originals: bool,
    pub max_original_chunk_bytes: usize,
}

struct Resources {
    core: Core,
    persistence: Persistence,
}
struct State {
    resources: Option<Resources>,
    listener_shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

pub struct BetaHost {
    runtime_id: Uuid,
    device_id: DeviceId,
    accepting: AtomicBool,
    gate: Mutex<State>,
    verifications: originals::VerificationRegistry,
    #[cfg(test)]
    capture_admitted: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

struct ProfileAuthority {
    profile_id: ProfileId,
    kind: GrantKind,
    agent_id: Option<AgentId>,
}

impl BetaHost {
    pub fn open(root: &Path) -> Result<Self, HostError> {
        let mut persistence = Persistence::open(root)?;
        let core_root = persistence.root.join("core");
        let main_database = core_root.join("beta-core.sqlite3");
        if persistence.owner_existed
            && (!main_database.exists() || std::fs::metadata(&main_database)?.len() == 0)
        {
            return Err(HostError::Core(CoreError::RecoveryRequired));
        }
        std::fs::create_dir_all(&core_root)?;
        storage::check_private_tree(&core_root)?;
        storage::private_path(&core_root, true)?;
        let core = match persistence.bound_device()? {
            Some(device) => Core::open_bound(&core_root, device)?,
            None => Core::open(&core_root)?,
        };
        persistence.bind_core(core.device_id())?;
        // Secure recognized core files only after Core has validated its schema
        // and ownership. Never modify a foreign directory to make it acceptable.
        storage::secure_private_tree(&core_root)?;
        Ok(Self {
            runtime_id: Uuid::new_v4(),
            device_id: core.device_id(),
            accepting: AtomicBool::new(true),
            verifications: originals::VerificationRegistry::default(),
            #[cfg(test)]
            capture_admitted: Mutex::new(None),
            gate: Mutex::new(State {
                resources: Some(Resources { core, persistence }),
                listener_shutdown: None,
            }),
        })
    }

    fn state(&self) -> Result<MutexGuard<'_, State>, HostError> {
        self.gate.lock().map_err(|_| HostError::StatePoisoned)
    }

    fn active_state(&self) -> Result<MutexGuard<'_, State>, HostError> {
        let state = self.state()?;
        if !self.accepting.load(Ordering::Acquire) {
            return Err(HostError::Stopped);
        }
        Ok(state)
    }

    /// Non-blocking admission fence, safe to call immediately from a native
    /// close callback. Resource release still happens through stop/the gate.
    pub fn request_stop(&self) {
        self.accepting.store(false, Ordering::Release);
    }

    pub fn status(&self) -> Result<HostStatus, HostError> {
        let running = if !self.accepting.load(Ordering::Acquire) {
            false
        } else {
            let state = self.state()?;
            self.accepting.load(Ordering::Acquire) && state.resources.is_some()
        };
        Ok(HostStatus {
            protocol: PROTOCOL,
            runtime_id: self.runtime_id,
            device_id: self.device_id,
            running,
            capabilities: HostCapabilities {
                originals: true,
                max_original_chunk_bytes: exomind_core::MAX_ORIGINAL_CHUNK_BYTES,
            },
        })
    }

    /// Trusted native embedding only. There is intentionally no HTTP endpoint
    /// that calls this method or accepts a caller-selected local author.
    pub fn owner_session(&self) -> Result<Session, HostError> {
        let state = self.active_state()?;
        resources(&state)?;
        Ok(Session {
            runtime_id: self.runtime_id,
            authority: Authority::Owner,
        })
    }

    pub fn authenticate(&self, raw_token: &str) -> Result<Session, HostError> {
        if raw_token.len() != 64 || !raw_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(HostError::Unauthorized);
        }
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let hash = token_hash(raw_token);
        let owner: String = resources.persistence.auth.query_row(
            "SELECT token_hash FROM owner WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let authority = if hash == owner {
            Authority::Owner
        } else {
            let grant: Option<String> = resources
                .persistence
                .auth
                .query_row(
                    "SELECT id FROM grants WHERE token_hash=?1 AND revoked=0",
                    [&hash],
                    |row| row.get(0),
                )
                .optional()?;
            let id = grant.ok_or(HostError::Unauthorized)?;
            Authority::Grant(Uuid::parse_str(&id).map_err(|_| HostError::CredentialsUnavailable)?)
        };
        Ok(Session {
            runtime_id: self.runtime_id,
            authority,
        })
    }

    fn owner(&self, session: &Session) -> Result<(), HostError> {
        if session.runtime_id != self.runtime_id {
            return Err(HostError::Unauthorized);
        }
        match session.authority {
            Authority::Owner => Ok(()),
            Authority::Grant(_) => Err(HostError::Forbidden),
        }
    }

    fn profile_authority(
        &self,
        resources: &Resources,
        session: &Session,
        profile: ProfileId,
        write: bool,
    ) -> Result<ProfileAuthority, HostError> {
        if session.runtime_id != self.runtime_id {
            return Err(HostError::Unauthorized);
        }
        let Authority::Grant(id) = session.authority else {
            return Err(HostError::Forbidden);
        };
        let row: Option<(String, String, Option<String>)> = resources
            .persistence
            .auth
            .query_row(
                "SELECT profile_id,kind,agent_id FROM grants WHERE id=?1 AND revoked=0",
                [id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let (stored, kind, agent) = row.ok_or(HostError::Unauthorized)?;
        let authority = ProfileAuthority {
            profile_id: stored
                .parse()
                .map_err(|_| HostError::CredentialsUnavailable)?,
            kind: GrantKind::parse(&kind)?,
            agent_id: agent
                .map(|id| id.parse())
                .transpose()
                .map_err(|_| HostError::CredentialsUnavailable)?,
        };
        if authority.profile_id != profile || (write && authority.kind == GrantKind::Observer) {
            return Err(HostError::Forbidden);
        }
        Ok(authority)
    }

    pub fn profiles(&self, session: &Session) -> Result<Vec<ProfileInfo>, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.owner(session)?;
        Ok(resources.core.profiles()?)
    }

    pub fn provision_profile(
        &self,
        session: &Session,
        profile: ProfileId,
        name: &str,
    ) -> Result<ProfileInfo, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.owner(session)?;
        Ok(resources.core.provision_profile(profile, name)?)
    }

    pub fn grant(
        &self,
        session: &Session,
        request: GrantRequest,
    ) -> Result<IssuedGrant, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.owner(session)?;
        resources.core.local_human(request.profile_id)?;
        if (request.kind == GrantKind::AgentNote) != request.agent_id.is_some() {
            return Err(HostError::InvalidRequest);
        }
        let raw_token = token();
        let grant_id = Uuid::new_v4();
        resources.persistence.auth.execute(
            "INSERT INTO grants(id,profile_id,kind,agent_id,token_hash) VALUES(?1,?2,?3,?4,?5)",
            params![
                grant_id.to_string(),
                request.profile_id.to_string(),
                request.kind.label(),
                request.agent_id.map(|id| id.to_string()),
                token_hash(&raw_token)
            ],
        )?;
        Ok(IssuedGrant {
            grant_id,
            profile_id: request.profile_id,
            kind: request.kind,
            token: raw_token,
        })
    }

    pub fn revoke_grant(&self, session: &Session, id: Uuid) -> Result<(), HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.owner(session)?;
        let changed = resources
            .persistence
            .auth
            .execute("UPDATE grants SET revoked=1 WHERE id=?1", [id.to_string()])?;
        if changed == 0 {
            return Err(HostError::NotFound);
        }
        self.verifications.cancel_grant(id)?;
        Ok(())
    }

    pub fn native_human_session(
        &self,
        owner: &Session,
        profile: ProfileId,
    ) -> Result<Session, HostError> {
        // The raw one-time grant token never leaves this trusted adapter call.
        let grant = self.grant(
            owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )?;
        self.authenticate(&grant.token)
    }

    pub fn capture(
        &self,
        session: &Session,
        command: &CaptureCommand,
    ) -> Result<Receipt, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, command.profile_id, true)?;
        let context = context(&resources.core, &authority)?;
        #[cfg(test)]
        if let Some(admitted) = self.capture_admitted.lock().unwrap().take() {
            // Tests observe final qualification without timing the gate/SQLite gap.
            let _ = admitted.send(());
        }
        Ok(resources.core.submit(&context, command)?)
    }

    pub fn events_page(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<EventPage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources
            .core
            .events_page(&context(&resources.core, &authority)?, profile, query)?)
    }

    pub fn receipt(
        &self,
        session: &Session,
        profile: ProfileId,
        command: CommandId,
    ) -> Result<Option<Receipt>, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources
            .core
            .receipt(&context(&resources.core, &authority)?, command)?)
    }

    pub fn stop(&self) -> Result<(), HostError> {
        self.stop_with_timeout(std::time::Duration::from_secs(5))
    }

    fn stop_with_timeout(&self, timeout: std::time::Duration) -> Result<(), HostError> {
        self.request_stop();
        {
            // Stop listener admission before waiting, but never retain the gate
            // while an owned verification drains its independent read handle.
            let mut state = self.state()?;
            if let Some(shutdown) = state.listener_shutdown.take() {
                let _ = shutdown.send(());
            }
        }
        self.verifications.cancel_all()?;
        self.verifications.wait_empty(timeout)?;
        // A timeout deliberately retains resources/the root lock: an old read
        // connection must not coexist with a newly opened host for this root.
        self.state()?.resources.take();
        Ok(())
    }

    pub(crate) fn publish_endpoint(
        &self,
        address: std::net::SocketAddr,
        shutdown: tokio::sync::oneshot::Sender<()>,
    ) -> Result<(), HostError> {
        let mut state = self.active_state()?;
        if state.listener_shutdown.is_some() {
            return Err(HostError::RootInUse);
        }
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        resources.persistence.descriptor.url = Some(format!("http://{address}"));
        resources.persistence.write_descriptor()?;
        state.listener_shutdown = Some(shutdown);
        Ok(())
    }
}

fn resources(state: &State) -> Result<&Resources, HostError> {
    state.resources.as_ref().ok_or(HostError::Stopped)
}
fn context(core: &Core, authority: &ProfileAuthority) -> Result<WriterContext, HostError> {
    match authority.kind {
        GrantKind::AgentNote => Ok(core.local_agent(
            authority.profile_id,
            authority
                .agent_id
                .ok_or(HostError::CredentialsUnavailable)?,
        )?),
        GrantKind::Human | GrantKind::Observer => Ok(core.local_human(authority.profile_id)?),
    }
}
