use std::fs;
use std::io::Read;

use serde_json::Value;
use serde_json::json;

use crate::cli::{
    GlobalOptions, ProposalAddArgs, ProposalCommand, ProposalCommentArgs, ProposalIdArgs,
    ProposalListArgs,
};
use crate::commands::resolve_command_context;
use crate::error::CliError;
use crate::output;

pub async fn handle(command: ProposalCommand, global: &GlobalOptions) -> Result<(), CliError> {
    match command {
        ProposalCommand::Add(args) => print_value(global, &add_proposal(global, &args).await?),
        ProposalCommand::List(args) => print_list(global, &list_proposals(global, &args).await?),
        ProposalCommand::Get(args) => print_value(global, &get_proposal(global, &args).await?),
        ProposalCommand::Approve(args) => {
            print_value(global, &approve_proposal(global, &args).await?)
        }
        ProposalCommand::Reject(args) => {
            print_value(global, &reject_proposal(global, &args).await?)
        }
        ProposalCommand::Snooze(args) => {
            print_value(global, &snooze_proposal(global, &args).await?)
        }
        ProposalCommand::Comment(args) => {
            print_value(global, &comment_proposal(global, &args).await?)
        }
    }
}

pub async fn add_proposal(
    global: &GlobalOptions,
    args: &ProposalAddArgs,
) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_proposal_path("/api/proposals", context.scope.as_ref());
    let action_params = read_params_json(args.params_file.as_deref())?;
    let payload = json!({
        "title": args.title,
        "body": "",
        "action_type": args.action,
        "action_params": action_params,
        "publisher": default_publisher(),
    });

    context.client.post_json(&path, &payload).await
}

pub async fn list_proposals(
    global: &GlobalOptions,
    args: &ProposalListArgs,
) -> Result<Vec<Value>, CliError> {
    let context = resolve_command_context(global)?;
    let mut path = scoped_proposal_path("/api/proposals", context.scope.as_ref());
    if let Some(status) = &args.status {
        path = context
            .client
            .with_scope(&path, &[("status".to_string(), status.clone())]);
    }

    context.client.get_json(&path).await
}

pub async fn get_proposal(
    global: &GlobalOptions,
    args: &ProposalIdArgs,
) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_proposal_path(
        &format!("/api/proposals/{}", args.proposal_id),
        context.scope.as_ref(),
    );

    context.client.get_json(&path).await
}

pub async fn approve_proposal(
    global: &GlobalOptions,
    args: &ProposalIdArgs,
) -> Result<Value, CliError> {
    update_status(global, args, "approved").await
}

pub async fn reject_proposal(
    global: &GlobalOptions,
    args: &ProposalIdArgs,
) -> Result<Value, CliError> {
    update_status(global, args, "rejected").await
}

pub async fn snooze_proposal(
    global: &GlobalOptions,
    args: &ProposalIdArgs,
) -> Result<Value, CliError> {
    update_status(global, args, "snoozed").await
}

pub async fn comment_proposal(
    global: &GlobalOptions,
    args: &ProposalCommentArgs,
) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_proposal_path(
        &format!("/api/proposals/{}/comments", args.proposal_id),
        context.scope.as_ref(),
    );
    let payload = json!({
        "author": default_publisher(),
        "content": args.content,
    });

    context.client.post_json(&path, &payload).await
}

async fn update_status(
    global: &GlobalOptions,
    args: &ProposalIdArgs,
    status: &str,
) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_proposal_path(
        &format!("/api/proposals/{}", args.proposal_id),
        context.scope.as_ref(),
    );
    let payload = json!({ "status": status });

    context.client.patch_json(&path, &payload).await
}

fn scoped_proposal_path(path: &str, scope: Option<&crate::profile_scope::ProfileScope>) -> String {
    if let Some(scope) = scope {
        let client = crate::runtime_client::RuntimeClient::from_target("127.0.0.1:0", None)
            .expect("temporary runtime client for query formatting");
        client.with_scope(path, &scope.proposal_query_pairs())
    } else {
        path.to_string()
    }
}

fn read_params_json(path: Option<&str>) -> Result<Value, CliError> {
    let Some(path) = path else {
        return Ok(json!({}));
    };

    let raw = if path == "-" {
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer)?;
        buffer
    } else {
        fs::read_to_string(path)?
    };

    serde_json::from_str(&raw).map_err(|error| CliError::Message(error.to_string()))
}

fn default_publisher() -> Value {
    json!({
        "publisher_type": "agent",
        "id": "exomind-cli",
        "name": "ExoMind CLI",
    })
}

fn print_value(global: &GlobalOptions, value: &Value) -> Result<(), CliError> {
    if global.json {
        output::print_json(value).map_err(CliError::Message)?;
    } else {
        println!(
            "{} [{}] {}",
            value["title"].as_str().unwrap_or_default(),
            value["id"].as_u64().unwrap_or_default(),
            value["status"].as_str().unwrap_or_default()
        );
    }

    Ok(())
}

fn print_list(global: &GlobalOptions, values: &[Value]) -> Result<(), CliError> {
    if global.json {
        let payload =
            serde_json::to_value(values).map_err(|error| CliError::Message(error.to_string()))?;
        output::print_json(&payload).map_err(CliError::Message)?;
    } else {
        for value in values {
            println!(
                "{} [{}] {}",
                value["title"].as_str().unwrap_or_default(),
                value["id"].as_u64().unwrap_or_default(),
                value["status"].as_str().unwrap_or_default()
            );
        }
    }

    Ok(())
}
