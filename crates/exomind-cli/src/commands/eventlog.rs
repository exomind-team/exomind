use serde_json::Value;
use serde_json::json;

use crate::cli::{
    EventlogAddArgs, EventlogCommand, EventlogGetArgs, EventlogListArgs, EventlogWatchArgs,
    GlobalOptions,
};
use crate::commands::resolve_command_context;
use crate::error::CliError;
use crate::output;

pub async fn handle(command: EventlogCommand, global: &GlobalOptions) -> Result<(), CliError> {
    match command {
        EventlogCommand::Add(args) => {
            let created = add_event(global, &args).await?;
            print_value(global, &created)
        }
        EventlogCommand::List(args) => {
            let events = list_events(global, &args).await?;
            print_list(global, &events)
        }
        EventlogCommand::Get(args) => {
            let event = get_event(global, &args).await?;
            print_value(global, &event)
        }
        EventlogCommand::Watch(args) => {
            let events = watch_events(global, &args).await?;
            print_list(global, &events)
        }
    }
}

pub async fn add_event(global: &GlobalOptions, args: &EventlogAddArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_eventlog_path("/eventlog", context.scope.as_ref());
    let payload = json!({
        "content": args.content,
        "tags": args.tags,
    });

    context.client.post_json(&path, &payload).await
}

pub async fn list_events(
    global: &GlobalOptions,
    args: &EventlogListArgs,
) -> Result<Vec<Value>, CliError> {
    let context = resolve_command_context(global)?;
    let mut path = scoped_eventlog_path("/eventlog", context.scope.as_ref());
    let mut extra_pairs = Vec::new();
    if let Some(limit) = args.limit {
        extra_pairs.push(("limit".to_string(), limit.to_string()));
    }
    if !args.tags.is_empty() {
        extra_pairs.push(("tags".to_string(), args.tags.join(",")));
    }
    if !extra_pairs.is_empty() {
        path = context.client.with_scope(&path, &extra_pairs);
    }

    context.client.get_json(&path).await
}

pub async fn get_event(global: &GlobalOptions, args: &EventlogGetArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_eventlog_path(
        &format!("/eventlog/{}", args.event_id),
        context.scope.as_ref(),
    );

    context.client.get_json(&path).await
}

pub async fn watch_events(
    global: &GlobalOptions,
    args: &EventlogWatchArgs,
) -> Result<Vec<Value>, CliError> {
    let context = resolve_command_context(global)?;
    let mut path = scoped_eventlog_path("/eventlog/watch", context.scope.as_ref());
    if let Some(since_id) = &args.since_id {
        path = context
            .client
            .with_scope(&path, &[("since_id".to_string(), since_id.clone())]);
    }

    context.client.get_json(&path).await
}

fn scoped_eventlog_path(path: &str, scope: Option<&crate::profile_scope::ProfileScope>) -> String {
    if let Some(scope) = scope {
        let client = crate::runtime_client::RuntimeClient::from_target("127.0.0.1:0", None)
            .expect("temporary runtime client for query formatting");
        client.with_scope(path, &scope.eventlog_query_pairs())
    } else {
        path.to_string()
    }
}

fn print_value(global: &GlobalOptions, value: &Value) -> Result<(), CliError> {
    if global.json {
        output::print_json(value).map_err(CliError::Message)?;
    } else {
        println!(
            "{} [{}]",
            value["content"].as_str().unwrap_or_default(),
            value["id"].as_str().unwrap_or_default()
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
                "{} [{}]",
                value["content"].as_str().unwrap_or_default(),
                value["id"].as_str().unwrap_or_default()
            );
        }
    }

    Ok(())
}
