pub mod cli;
pub mod commands;
pub mod error;
pub mod examples;
pub mod output;
pub mod profile_scope;
pub mod runtime_client;
pub mod state;
pub mod target;

use clap::Parser;
use cli::{Cli, GlobalOptions, RootCommand};
use error::CliError;

pub async fn run() -> Result<(), CliError> {
    let cli = Cli::parse();
    dispatch(cli).await
}

pub async fn dispatch(cli: Cli) -> Result<(), CliError> {
    let global = GlobalOptions::from(&cli);

    match cli.command {
        None => {
            print!("{}", output::homepage_text());
            Ok(())
        }
        Some(RootCommand::Examples) => {
            print!("{}", output::examples_text());
            Ok(())
        }
        Some(RootCommand::Eventlog(command)) => commands::eventlog::handle(command, &global).await,
        Some(RootCommand::Proposal(command)) => commands::proposal::handle(command, &global).await,
        Some(RootCommand::Rt(command)) => commands::rt::handle(command, &global).await,
        Some(RootCommand::Task(command)) => commands::task::handle(command, &global).await,
    }
}
