use serde_json::json;

use crate::cli::{GlobalOptions, RtCommand, RtUseArgs};
use crate::error::CliError;
use crate::output;
use crate::runtime_client::RuntimeClient;
use crate::state::CliState;
use crate::target::{TargetProbeStatus, TargetResolutionSource, candidate_ports, probe_targets, resolve_target};

pub async fn handle(command: RtCommand, global: &GlobalOptions) -> Result<(), CliError> {
    match command {
        RtCommand::Status => rt_status(global).await,
        RtCommand::Probe => rt_probe(global).await,
        RtCommand::Use(args) => rt_use(global, args),
        RtCommand::ClearDefault => rt_clear_default(global),
    }
}

async fn rt_status(global: &GlobalOptions) -> Result<(), CliError> {
    let payload = status_payload(global).await?;

    if global.json {
        output::print_json(&payload).map_err(CliError::Message)?;
    } else {
        println!("Selected target: {}", payload["target"].as_str().unwrap_or_default());
        println!("Source: {}", payload["source"].as_str().unwrap_or_default());
        println!("Health: ok");
    }

    Ok(())
}

async fn rt_probe(global: &GlobalOptions) -> Result<(), CliError> {
    let statuses = probe_payload().await?;

    let payload = serde_json::to_value(&statuses).map_err(|error| CliError::Message(error.to_string()))?;
    if global.json {
        output::print_json(&payload).map_err(CliError::Message)?;
    } else {
        for status in &statuses {
            let label = if status.healthy { "healthy" } else { "unreachable" };
            println!("{} [{label}]", status.target);
        }
    }

    Ok(())
}

pub async fn status_payload(global: &GlobalOptions) -> Result<serde_json::Value, CliError> {
    let state = CliState::load(&CliState::resolve_path())?;
    let ports = candidate_ports();
    let resolved = resolve_target(global.target.as_deref(), &state, &ports, |candidate| {
        std::net::TcpStream::connect(candidate).is_ok()
    })
    .ok_or_else(|| CliError::Message("no RT target resolved (未解析到 RT 目标)".to_string()))?;

    let client = RuntimeClient::from_target(
        resolved.target.clone(),
        state
            .target_state(&resolved.target)
            .and_then(|entry| entry.auth_token.clone()),
    )?;
    let health = client.health().await?;

    Ok(json!({
        "target": resolved.target,
        "source": source_label(resolved.source),
        "healthy": true,
        "health": health,
    }))
}

pub async fn probe_payload() -> Result<Vec<TargetProbeStatus>, CliError> {
    let ports = candidate_ports();
    let mut statuses = Vec::with_capacity(ports.len());

    for target in probe_targets(&ports, |_| false)
        .into_iter()
        .map(|status| status.target)
    {
        let healthy = match RuntimeClient::from_target(target.clone(), None) {
            Ok(client) => client.health().await.is_ok(),
            Err(_) => false,
        };
        statuses.push(TargetProbeStatus { target, healthy });
    }

    Ok(statuses)
}

fn rt_use(global: &GlobalOptions, args: RtUseArgs) -> Result<(), CliError> {
    let state_path = CliState::resolve_path();
    let mut state = CliState::load(&state_path)?;
    state.default_target = Some(args.target.clone());
    state.save(&state_path)?;

    let payload = json!({
        "default_target": args.target,
        "state_path": state_path,
    });

    if global.json {
        output::print_json(&payload).map_err(CliError::Message)?;
    } else {
        println!(
            "Default RT target saved (默认 RT 目标已保存): {}",
            payload["default_target"].as_str().unwrap_or_default()
        );
    }

    Ok(())
}

fn rt_clear_default(global: &GlobalOptions) -> Result<(), CliError> {
    let state_path = CliState::resolve_path();
    let mut state = CliState::load(&state_path)?;
    state.default_target = None;
    state.save(&state_path)?;

    let payload = json!({
        "default_target": serde_json::Value::Null,
        "state_path": state_path,
    });

    if global.json {
        output::print_json(&payload).map_err(CliError::Message)?;
    } else {
        println!("Default RT target cleared (默认 RT 目标已清除)");
    }

    Ok(())
}

fn source_label(source: TargetResolutionSource) -> &'static str {
    match source {
        TargetResolutionSource::Explicit => "explicit",
        TargetResolutionSource::SavedDefault => "saved_default",
        TargetResolutionSource::Probed => "probed",
    }
}
