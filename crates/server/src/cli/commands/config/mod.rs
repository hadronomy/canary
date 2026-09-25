mod human;
mod report;

use miette::{Result, WrapErr};
use usage_rs::{Args as UsageArgs, Subcommands};

use crate::LoadedConfig;
use crate::cli::args::GlobalArgs;
use crate::cli::commands::output::{self, Format};
use crate::cli::layer::{self, ConfigArgs};

/// Arguments for `canary config`.
#[derive(Debug, Clone, UsageArgs)]
pub(in crate::cli) struct Args {
    #[usage(subcommand)]
    pub(in crate::cli) command: Command,
}

/// Configuration inspection commands.
#[derive(Debug, Clone, Subcommands)]
pub(in crate::cli) enum Command {
    /// Validate the effective configuration.
    Check(CheckArgs),
    /// Print the effective configuration with secrets redacted.
    Show(ShowArgs),
    /// Explain which configuration layers were selected.
    Sources(SourcesArgs),
}

/// Arguments for `canary config check`.
#[derive(Debug, Clone, Default, UsageArgs)]
pub(in crate::cli) struct CheckArgs {
    #[usage(flatten)]
    server: layer::Server,
    /// Output format for the validation result.
    #[usage(long, value_enum, default = "human")]
    format: Format,
}

impl ConfigArgs for CheckArgs {
    #[inline(always)]
    fn apply(&self, layer: &mut layer::Layer) {
        self.server.apply(layer);
    }
}

/// Arguments for `canary config show`.
#[derive(Debug, Clone, Default, UsageArgs)]
pub(in crate::cli) struct ShowArgs {
    #[usage(flatten)]
    server: layer::Server,
    /// Output format for the redacted config report.
    #[usage(long, value_enum, default = "human")]
    format: Format,
}

impl ConfigArgs for ShowArgs {
    #[inline(always)]
    fn apply(&self, layer: &mut layer::Layer) {
        self.server.apply(layer);
    }
}

/// Arguments for `canary config sources`.
#[derive(Debug, Clone, Default, UsageArgs)]
pub(in crate::cli) struct SourcesArgs {
    #[usage(flatten)]
    server: layer::Server,
    /// Output format for the configuration source report.
    #[usage(long, value_enum, default = "human")]
    format: Format,
}

impl ConfigArgs for SourcesArgs {
    #[inline(always)]
    fn apply(&self, layer: &mut layer::Layer) {
        self.server.apply(layer);
    }
}

pub(in crate::cli) fn run(global: GlobalArgs, args: Args) -> Result<()> {
    match args.command {
        Command::Check(args) => {
            let loaded = load(&global, &args)?;
            if args.format.is_human() {
                return human::check(&loaded);
            }
            output::print(structured(args.format), &report::check(&loaded))
        }
        Command::Show(args) => {
            let loaded = load(&global, &args)?;
            if args.format.is_human() {
                return human::show(&loaded);
            }
            output::print(structured(args.format), &report::config(&loaded))
        }
        Command::Sources(args) => {
            let loaded = load(&global, &args)?;
            if args.format.is_human() {
                return human::sources(&loaded);
            }
            output::print(structured(args.format), &report::sources(&loaded))
        }
    }
}

#[inline(always)]
fn load(global: &GlobalArgs, args: &impl ConfigArgs) -> Result<LoadedConfig> {
    LoadedConfig::load_with(layer::input(global, args))
        .wrap_err("Failed to load server configuration.")
}

#[inline(always)]
fn structured(format: Format) -> output::StructuredFormat {
    format.structured().expect("human format is handled before structured output")
}
