use serde_json::Value;
use serde_json::json;

use crate::cli::{
    GlobalOptions, TaskAddArgs, TaskCommand, TaskIdArgs, TaskListArgs, TaskUpdateArgs,
};
use crate::commands::resolve_command_context;
use crate::error::CliError;
use crate::output;

pub async fn handle(command: TaskCommand, global: &GlobalOptions) -> Result<(), CliError> {
    match command {
        TaskCommand::Add(args) => print_value(global, &add_task(global, &args).await?),
        TaskCommand::List(args) => print_list(global, &list_tasks(global, &args).await?),
        TaskCommand::Get(args) => print_value(
            global,
            &get_task(
                global,
                &TaskIdArgs {
                    task_id: args.task_id,
                },
            )
            .await?,
        ),
        TaskCommand::Update(args) => print_value(global, &update_task(global, &args).await?),
        TaskCommand::Start(args) => print_value(global, &start_task(global, &args).await?),
        TaskCommand::Complete(args) => print_value(global, &complete_task(global, &args).await?),
        TaskCommand::Cancel(args) => print_value(global, &cancel_task(global, &args).await?),
        TaskCommand::Suspend(args) => print_value(global, &suspend_task(global, &args).await?),
        TaskCommand::Resume(args) => print_value(global, &resume_task(global, &args).await?),
    }
}

pub async fn add_task(global: &GlobalOptions, args: &TaskAddArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_task_path("/tasks", context.scope.as_ref());
    let payload = json!({
        "title": args.title,
        "priority": args.priority,
        "tags": args.tags,
    });

    context.client.post_json(&path, &payload).await
}

pub async fn list_tasks(
    global: &GlobalOptions,
    args: &TaskListArgs,
) -> Result<Vec<Value>, CliError> {
    let context = resolve_command_context(global)?;
    let mut path = scoped_task_path("/tasks", context.scope.as_ref());
    let mut extra_pairs = Vec::new();
    if let Some(status) = &args.status {
        extra_pairs.push(("status".to_string(), status.clone()));
    }
    if let Some(tag) = args.tags.first() {
        extra_pairs.push(("tag".to_string(), tag.clone()));
    }
    if let Some(parent_id) = &args.parent_id {
        extra_pairs.push(("parent_id".to_string(), parent_id.clone()));
    }
    if !extra_pairs.is_empty() {
        path = context.client.with_scope(&path, &extra_pairs);
    }

    context.client.get_json(&path).await
}

pub async fn get_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_task_path(&format!("/tasks/{}", args.task_id), context.scope.as_ref());

    context.client.get_json(&path).await
}

pub async fn update_task(global: &GlobalOptions, args: &TaskUpdateArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_task_path(&format!("/tasks/{}", args.task_id), context.scope.as_ref());
    let payload = json!({
        "title": args.title,
    });

    context.client.put_json(&path, &payload).await
}

pub async fn start_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    transition_task(global, args, "in_progress", false).await
}

pub async fn suspend_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    transition_task(global, args, "suspended", false).await
}

pub async fn resume_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    transition_task(global, args, "in_progress", false).await
}

pub async fn complete_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    transition_task(global, args, "completed", true).await
}

pub async fn cancel_task(global: &GlobalOptions, args: &TaskIdArgs) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let path = scoped_task_path(
        &format!("/tasks/{}/cancel", args.task_id),
        context.scope.as_ref(),
    );

    context.client.post_json(&path, &json!({})).await
}

async fn transition_task(
    global: &GlobalOptions,
    args: &TaskIdArgs,
    status: &str,
    shortcut: bool,
) -> Result<Value, CliError> {
    let context = resolve_command_context(global)?;
    let mut path = scoped_task_path(
        &format!("/tasks/{}/transition", args.task_id),
        context.scope.as_ref(),
    );
    if shortcut {
        path = context
            .client
            .with_scope(&path, &[("shortcut".to_string(), "true".to_string())]);
    }
    let payload = json!({ "status": status });

    context.client.post_json(&path, &payload).await
}

fn scoped_task_path(path: &str, scope: Option<&crate::profile_scope::ProfileScope>) -> String {
    if let Some(scope) = scope {
        let client = crate::runtime_client::RuntimeClient::from_target("127.0.0.1:0", None)
            .expect("temporary runtime client for query formatting");
        client.with_scope(path, &scope.task_query_pairs())
    } else {
        path.to_string()
    }
}

fn print_value(global: &GlobalOptions, value: &Value) -> Result<(), CliError> {
    if global.json {
        output::print_json(value).map_err(CliError::Message)?;
    } else {
        println!(
            "{} [{}] {}",
            value["title"].as_str().unwrap_or_default(),
            value["id"].as_str().unwrap_or_default(),
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
                value["id"].as_str().unwrap_or_default(),
                value["status"].as_str().unwrap_or_default()
            );
        }
    }

    Ok(())
}
