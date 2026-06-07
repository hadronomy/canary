use clap::{Args as ClapArgs, Subcommand, ValueEnum};
use futures_util::pin_mut;
use miette::{IntoDiagnostic, Result, WrapErr};

use crate::cli::args::GlobalArgs;
use crate::cli::layer::{self, ConfigArgs};
use crate::shutdown::{ShutdownCoordinator, wait_for_shutdown_signal};
use crate::{LoadedWorkerConfig, build_runtime, init_observability};

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
    Workflow,
    RustActivities,
    Parser,
    Ingestion,
    Source,
    Embedding,
}

impl ConfigArgs for Args {
    #[inline(always)]
    fn apply(&self, _: &mut layer::Layer) {}
}

pub(in crate::cli) fn run(global: GlobalArgs, args: Args) -> Result<()> {
    match args.command {
        Command::Run(args) => run_worker(global, args),
        Command::Inspect => inspect(global),
    }
}

fn run_worker(global: GlobalArgs, args: RunArgs) -> Result<()> {
    let loaded =
        LoadedWorkerConfig::load_with(layer::input(&global, &Args { command: Command::Inspect }))
            .wrap_err("Failed to load worker configuration.")?;
    init_observability(&loaded.settings.observability)
        .into_diagnostic()
        .wrap_err("Failed to initialize observability.")?;

    let runtime = build_runtime(&loaded.settings.runtime)
        .into_diagnostic()
        .wrap_err("Failed to build the Tokio runtime.")?;

    runtime.block_on(async move {
        let shutdown = ShutdownCoordinator::new(loaded.settings.workers.shutdown_grace_period);
        let worker = canary_workers::WorkerRuntime::build_with(
            loaded.settings.workers,
            canary_workers::WorkerRuntimeOptions {
                kind: args.kind.unwrap_or_default().into(),
                task_queue: args
                    .task_queue
                    .map(canary_workers::TaskQueue::new)
                    .transpose()
                    .into_diagnostic()?,
                concurrency: args.concurrency,
            },
        )
        .await
        .into_diagnostic()?;
        let run = worker.run(shutdown.register());
        pin_mut!(run);

        tokio::select! {
            result = &mut run => result.into_diagnostic(),
            reason = wait_for_shutdown_signal() => {
                shutdown.request(reason?);
                run.await.into_diagnostic()
            }
        }
    })
}

fn inspect(global: GlobalArgs) -> Result<()> {
    let loaded =
        LoadedWorkerConfig::load_with(layer::input(&global, &Args { command: Command::Inspect }))
            .wrap_err("Failed to load worker configuration.")?;
    println!("{}", serde_json::to_string_pretty(&loaded.settings.workers).into_diagnostic()?);
    Ok(())
}

impl From<Kind> for canary_workers::WorkerKind {
    #[inline(always)]
    fn from(value: Kind) -> Self {
        match value {
            Kind::All => Self::All,
            Kind::Workflow => Self::Workflow,
            Kind::RustActivities => Self::RustActivities,
            Kind::Parser => Self::Parser,
            Kind::Ingestion => Self::Ingestion,
            Kind::Source => Self::Source,
            Kind::Embedding => Self::Embedding,
        }
    }
}
