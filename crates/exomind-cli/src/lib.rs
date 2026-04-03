pub mod cli;
pub mod examples;
pub mod output;
pub mod profile_scope;
pub mod state;
pub mod target;

use clap::Parser;
use cli::{Cli, RootCommand};

pub async fn run() -> Result<(), String> {
    let cli = Cli::parse();
    dispatch(cli).await
}

pub async fn dispatch(cli: Cli) -> Result<(), String> {
    match cli.command {
        None => {
            print!("{}", output::homepage_text());
            Ok(())
        }
        Some(RootCommand::Examples) => {
            print!("{}", output::examples_text());
            Ok(())
        }
        Some(command) => {
            print!("{}", output::placeholder_command_text(&command));
            Ok(())
        }
    }
}
