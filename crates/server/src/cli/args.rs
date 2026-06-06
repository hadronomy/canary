use std::path::PathBuf;

use clap::{ArgAction, Args, Parser, Subcommand, ValueEnum};

use super::commands;
use super::layer::{self, ConfigArgs};
use crate::config::LogFormat;

/// Canary's command-line interface.
#[derive(Debug, Clone, Parser)]
#[command(name = "canary", version = crate::VERSION.cli_label(), about = "Canary knowledge server")]
pub(in crate::cli) struct Cli {
    #[command(flatten)]
    global: GlobalArgs,
    #[command(subcommand)]
    command: Option<Command>,
}

impl Cli {
    /// Executes the parsed command.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the selected command cannot complete.
    pub(in crate::cli) fn run(self) -> miette::Result<()> {
        match self.command.unwrap_or_default() {
            Command::Serve(args) => commands::serve::run(self.global, args),
            Command::Version(args) => commands::version::run(args),
            Command::Config(args) => commands::config::run(self.global, args),
            Command::Worker(args) => commands::worker::run(self.global, args),
            Command::Dev(args) => commands::dev::run(args),
            Command::Generate(args) => commands::generate::run(args),
        }
    }
}

/// Arguments accepted before or after any subcommand.
#[derive(Debug, Clone, Default, Args)]
pub(in crate::cli) struct GlobalArgs {
    /// Load this TOML file instead of using automatic config-file discovery.
    #[arg(short, long, global = true, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Increase log verbosity. Repeat for debug and trace.
    #[arg(short, long, global = true, action = ArgAction::Count, conflicts_with = "log_filter")]
    verbose: u8,

    /// Decrease log verbosity. Repeat twice to silence logs.
    #[arg(short, long, global = true, action = ArgAction::Count, conflicts_with = "log_filter")]
    quiet: u8,

    /// Exact tracing EnvFilter. Conflicts with -v and -q.
    #[arg(long, global = true, value_name = "FILTER", conflicts_with_all = ["verbose", "quiet"])]
    log_filter: Option<String>,

    /// Log output format.
    #[arg(long, global = true, value_enum, value_name = "FORMAT")]
    log_format: Option<CliLogFormat>,
}

impl GlobalArgs {
    fn verbosity_filter(&self) -> Option<&'static str> {
        if self.verbose == 0 && self.quiet == 0 {
            return None;
        }
        match i16::from(self.verbose) - i16::from(self.quiet) {
            i16::MIN..=-2 => Some("off"),
            -1 => Some("error"),
            0 => Some("warn"),
            1 => Some("info"),
            2 => Some("debug"),
            _ => Some("trace"),
        }
    }
}

impl ConfigArgs for GlobalArgs {
    fn apply(&self, layer: &mut layer::Layer) {
        layer.path(self.config.clone());
        layer
            .filter(self.log_filter.clone().or_else(|| self.verbosity_filter().map(str::to_owned)));
        layer.format(self.log_format.map(Into::into));
    }
}

/// CLI spelling for [`LogFormat`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "snake_case")]
enum CliLogFormat {
    Pretty,
    Json,
}

impl From<CliLogFormat> for LogFormat {
    #[inline(always)]
    fn from(value: CliLogFormat) -> Self {
        match value {
            CliLogFormat::Pretty => Self::Pretty,
            CliLogFormat::Json => Self::Json,
        }
    }
}

/// Top-level Canary commands.
#[derive(Debug, Clone, Subcommand)]
enum Command {
    /// Run the HTTP and MCP resource server.
    #[command(visible_alias = "server")]
    Serve(commands::serve::Args),
    /// Print full build and git metadata.
    Version(commands::version::Args),
    /// Inspect and validate the resolved configuration.
    Config(commands::config::Args),
    /// Temporal worker process commands.
    Worker(commands::worker::Args),
    /// Local server plus worker runtime.
    Dev(commands::dev::Args),
    /// Generate shell completions and man pages.
    Generate(commands::generate::Args),
}

impl Default for Command {
    #[inline(always)]
    fn default() -> Self {
        Self::Serve(commands::serve::Args::default())
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{Cli, Command};
    use crate::cli::commands;

    #[test]
    fn clap_configuration_is_valid() {
        use clap::CommandFactory;

        Cli::command().debug_assert();
    }

    #[test]
    fn no_subcommand_defaults_to_serve() {
        let cli = Cli::parse_from(["canary"]);

        assert!(cli.command.is_none());
    }

    #[test]
    fn serve_alias_parses() {
        let cli = Cli::parse_from(["canary", "server"]);

        assert!(matches!(cli.command, Some(Command::Serve(_))));
    }

    #[test]
    fn global_verbosity_parses_after_subcommand() {
        let cli = Cli::parse_from(["canary", "serve", "-vv"]);

        assert_eq!(cli.global.verbosity_filter(), Some("debug"));
    }

    #[test]
    fn log_filter_conflicts_with_verbosity() {
        assert!(Cli::try_parse_from(["canary", "-v", "--log-filter", "info"]).is_err());
    }

    #[test]
    fn config_and_worker_commands_parse() {
        let cli = Cli::parse_from(["canary", "config", "show"]);
        assert!(matches!(
            cli.command,
            Some(Command::Config(args)) if matches!(args.command, commands::config::Command::Show(_))
        ));

        let cli = Cli::parse_from(["canary", "worker", "run"]);
        assert!(matches!(
            cli.command,
            Some(Command::Worker(args)) if matches!(args.command, commands::worker::Command::Run(_))
        ));
    }

    #[test]
    fn config_commands_accept_server_config_flags() {
        let cli = Cli::parse_from([
            "canary",
            "config",
            "show",
            "--bind",
            "127.0.0.1:8080",
            "--request-timeout",
            "5s",
        ]);

        assert!(matches!(
            cli.command,
            Some(Command::Config(args)) if matches!(args.command, commands::config::Command::Show(_))
        ));
    }
}
