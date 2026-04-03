use clap::{CommandFactory, Parser};
use exomind_cli::cli::{Cli, EventlogCommand, ProposalCommand, RootCommand, TaskCommand};

#[test]
fn global_target_and_profile_flags_parse() {
    let cli = Cli::try_parse_from([
        "exomind",
        "--target",
        "127.0.0.1:9124",
        "--profile",
        "argon",
        "task",
        "list",
        "--status",
        "pending",
    ])
    .expect("cli should parse");

    assert_eq!(cli.target.as_deref(), Some("127.0.0.1:9124"));
    assert_eq!(cli.profile.as_deref(), Some("argon"));
    assert!(!cli.json);

    match cli.command.expect("task command") {
        RootCommand::Task(TaskCommand::List(args)) => {
            assert_eq!(args.status.as_deref(), Some("pending"));
        }
        other => panic!("expected task list command, got {other:?}"),
    }
}

#[test]
fn proposal_approve_parses_numeric_id() {
    let cli = Cli::try_parse_from(["exomind", "proposal", "approve", "12"])
        .expect("proposal approve should parse");

    match cli.command.expect("proposal command") {
        RootCommand::Proposal(ProposalCommand::Approve(args)) => {
            assert_eq!(args.proposal_id, 12);
        }
        other => panic!("expected proposal approve command, got {other:?}"),
    }
}

#[test]
fn root_help_mentions_eventlog_task_proposal_rt_and_examples() {
    let mut command = Cli::command();
    let rendered = command.render_long_help().to_string();

    assert!(rendered.contains("eventlog"));
    assert!(rendered.contains("task"));
    assert!(rendered.contains("proposal"));
    assert!(rendered.contains("rt"));
    assert!(rendered.contains("examples"));
}

#[test]
fn eventlog_get_parses_event_id() {
    let cli =
        Cli::try_parse_from(["exomind", "eventlog", "get", "evt-123"]).expect("eventlog get");

    match cli.command.expect("eventlog command") {
        RootCommand::Eventlog(EventlogCommand::Get(args)) => {
            assert_eq!(args.event_id, "evt-123");
        }
        other => panic!("expected eventlog get command, got {other:?}"),
    }
}
