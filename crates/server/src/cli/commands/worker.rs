use clap::{Args as ClapArgs, Subcommand, ValueEnum};
use miette::Result;

/// Arguments for `canary worker`.
#[derive(Debug, Clone, ClapArgs)]
pub(in crate::cli) struct Args {
    #[command(subcommand)]
    pub(in crate::cli) command: Command,
}

/// Worker command surface.
#[derive(Debug, Clone, Subcommand)]
pub(in crate::cli) enum Command {
    /// Run one Temporal worker process.
    Run(RunArgs),
    /// Inspect worker configuration.
    Inspect,
}

/// Arguments accepted by worker process execution.
#[derive(Debug, Clone, Default, ClapArgs)]
pub(in crate::cli) struct RunArgs {
    /// Temporal task queue to poll.
    #[arg(long, value_name = "NAME")]
    task_queue: Option<String>,
    /// Worker kind to launch.
    #[arg(long, value_enum, value_name = "KIND")]
    kind: Option<Kind>,
    /// Worker concurrency limit.
    #[arg(long, value_name = "N")]
    concurrency: Option<usize>,
}

/// Worker kinds accepted by `canary worker run`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab_case")]
enum Kind {
    #[default]
    All,
    Parser,
    Ingestion,
    Source,
    Embedding,
}

pub(in crate::cli) fn run(args: Args) -> Result<()> {
    match args.command {
        Command::Run(_) => todo("canary worker run"),
        Command::Inspect => todo("canary worker inspect"),
    }
}

pub(in crate::cli) fn todo(command: &'static str) -> Result<()> {
    Err(miette::miette!(
        code = "canary_server::cli::todo",
        help = "Worker execution is not wired yet; this command is here so the CLI shape can be exercised.",
        "{command} is not implemented yet"
    ))
}
