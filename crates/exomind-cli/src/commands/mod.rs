use crate::cli::GlobalOptions;
use crate::error::CliError;
use crate::profile_scope::ProfileScope;
use crate::runtime_client::RuntimeClient;
use crate::state::CliState;
use crate::target::{candidate_ports, resolve_target};

pub mod eventlog;
pub mod proposal;
pub mod rt;
pub mod task;

pub(crate) struct CommandContext {
    pub client: RuntimeClient,
    pub scope: Option<ProfileScope>,
}

pub(crate) fn resolve_command_context(global: &GlobalOptions) -> Result<CommandContext, CliError> {
    let state = CliState::load(&CliState::resolve_path())?;
    let ports = candidate_ports();
    let resolved = resolve_target(global.target.as_deref(), &state, &ports, |candidate| {
        std::net::TcpStream::connect(candidate).is_ok()
    })
    .ok_or_else(|| {
        if global.spawn_if_missing {
            CliError::Message(
                "spawn-if-missing is not implemented yet (显式 RT 自启尚未实现)".to_string(),
            )
        } else {
            CliError::Message("no RT target resolved (未解析到 RT 目标)".to_string())
        }
    })?;

    let scope = ProfileScope::from_flags(global.profile.as_deref(), global.user_id.as_deref())
        .or_else(|| {
            state
                .target_state(&resolved.target)
                .and_then(|entry| entry.default_profile.as_deref())
                .and_then(|profile| ProfileScope::from_flags(Some(profile), None))
        });
    let token = state
        .target_state(&resolved.target)
        .and_then(|entry| entry.auth_token.clone());
    let client = RuntimeClient::from_target(resolved.target, token)?;

    Ok(CommandContext { client, scope })
}
