use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "exomind",
    about = "ExoMind RT client shell (RT 客户端外壳)",
    long_about = "ExoMind RT client shell (RT 客户端外壳) with connect-first defaults."
)]
pub struct Cli {
    #[arg(long, global = true)]
    pub target: Option<String>,

    #[arg(long, global = true)]
    pub profile: Option<String>,

    #[arg(long = "user-id", global = true)]
    pub user_id: Option<String>,

    #[arg(long, global = true)]
    pub json: bool,

    #[arg(long = "spawn-if-missing", global = true)]
    pub spawn_if_missing: bool,

    #[command(subcommand)]
    pub command: Option<RootCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalOptions {
    pub target: Option<String>,
    pub profile: Option<String>,
    pub user_id: Option<String>,
    pub json: bool,
    pub spawn_if_missing: bool,
}

impl From<&Cli> for GlobalOptions {
    fn from(value: &Cli) -> Self {
        Self {
            target: value.target.clone(),
            profile: value.profile.clone(),
            user_id: value.user_id.clone(),
            json: value.json,
            spawn_if_missing: value.spawn_if_missing,
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum RootCommand {
    #[command(subcommand)]
    Eventlog(EventlogCommand),
    #[command(subcommand)]
    Task(TaskCommand),
    #[command(subcommand)]
    Proposal(ProposalCommand),
    #[command(subcommand)]
    Rt(RtCommand),
    Examples,
}

#[derive(Debug, Subcommand)]
pub enum EventlogCommand {
    Add(EventlogAddArgs),
    List(EventlogListArgs),
    Get(EventlogGetArgs),
    Watch(EventlogWatchArgs),
}

#[derive(Debug, Args)]
pub struct EventlogAddArgs {
    #[arg(long)]
    pub content: String,

    #[arg(long = "tag")]
    pub tags: Vec<String>,
}

#[derive(Debug, Args)]
pub struct EventlogListArgs {
    #[arg(long)]
    pub limit: Option<usize>,

    #[arg(long = "tag")]
    pub tags: Vec<String>,
}

#[derive(Debug, Args)]
pub struct EventlogGetArgs {
    pub event_id: String,
}

#[derive(Debug, Args)]
pub struct EventlogWatchArgs {
    #[arg(long = "since-id")]
    pub since_id: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum TaskCommand {
    Add(TaskAddArgs),
    List(TaskListArgs),
    Get(TaskGetArgs),
    Update(TaskUpdateArgs),
    Start(TaskIdArgs),
    Complete(TaskIdArgs),
    Cancel(TaskIdArgs),
    Suspend(TaskIdArgs),
    Resume(TaskIdArgs),
}

#[derive(Debug, Args)]
pub struct TaskAddArgs {
    #[arg(long)]
    pub title: String,

    #[arg(long)]
    pub priority: Option<String>,

    #[arg(long = "tag")]
    pub tags: Vec<String>,
}

#[derive(Debug, Args)]
pub struct TaskListArgs {
    #[arg(long)]
    pub status: Option<String>,

    #[arg(long = "tag")]
    pub tags: Vec<String>,

    #[arg(long = "parent-id")]
    pub parent_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct TaskGetArgs {
    pub task_id: String,
}

#[derive(Debug, Args)]
pub struct TaskUpdateArgs {
    pub task_id: String,

    #[arg(long)]
    pub title: Option<String>,
}

#[derive(Debug, Args)]
pub struct TaskIdArgs {
    pub task_id: String,
}

#[derive(Debug, Subcommand)]
pub enum ProposalCommand {
    Add(ProposalAddArgs),
    List(ProposalListArgs),
    Get(ProposalIdArgs),
    Approve(ProposalIdArgs),
    Reject(ProposalIdArgs),
    Snooze(ProposalIdArgs),
    Comment(ProposalCommentArgs),
}

#[derive(Debug, Args)]
pub struct ProposalAddArgs {
    #[arg(long)]
    pub action: String,

    #[arg(long)]
    pub title: String,

    #[arg(long = "params-file")]
    pub params_file: Option<String>,
}

#[derive(Debug, Args)]
pub struct ProposalListArgs {
    #[arg(long)]
    pub status: Option<String>,
}

#[derive(Debug, Args)]
pub struct ProposalIdArgs {
    pub proposal_id: u64,
}

#[derive(Debug, Args)]
pub struct ProposalCommentArgs {
    pub proposal_id: u64,

    #[arg(long)]
    pub content: String,
}

#[derive(Debug, Subcommand)]
pub enum RtCommand {
    Status,
    Probe,
    Use(RtUseArgs),
    ClearDefault,
}

#[derive(Debug, Args)]
pub struct RtUseArgs {
    pub target: String,
}
