use std::path::PathBuf;

use super::commands;
use super::layer::{self, ConfigArgs};
use crate::config::LogFormat;

/// Canary's command-line interface.
#[derive(Debug, Clone, usage_rs::Cli)]
#[usage(
    name = "canary",
    bin = "canary",
    version = crate::VERSION.cli_label(),
    version_spec = "0.1.0-alpha.1",
    about = "Canary knowledge server",
    author = env!("CARGO_PKG_AUTHORS"),
    license = env!("CARGO_PKG_LICENSE"),
    repository = env!("CARGO_PKG_REPOSITORY"),
    completion,
    default_subcommand = "serve",
    default_subcommand_on_empty,
    unknown_flags = "error",
    args_override_self = false
)]
pub(in crate::cli) struct Cli {
    #[usage(flatten)]
    global: GlobalArgs,
    #[usage(subcommand)]
    command: Command,
}

impl Cli {
    /// Executes the parsed command.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the selected command cannot complete.
    pub(in crate::cli) fn run(self) -> miette::Result<()> {
        match self.command {
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
#[derive(Debug, Clone, Default, usage_rs::Args)]
pub(in crate::cli) struct GlobalArgs {
    /// Load this TOML file instead of using automatic config-file discovery.
    #[usage(short, long, global = true, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Increase log verbosity. Repeat for debug and trace.
    #[usage(short, long, global = true, count, conflicts = "log_filter")]
    verbose: u8,

    /// Decrease log verbosity. Repeat twice to silence logs.
    #[usage(short, long, global = true, count, conflicts = "log_filter")]
    quiet: u8,

    /// Exact tracing EnvFilter. Conflicts with -v and -q.
    #[usage(long, global = true, value_name = "FILTER")]
    log_filter: Option<String>,

    /// Log output format.
    #[usage(long, global = true, value_enum, value_name = "FORMAT")]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, usage_rs::ValueEnum)]
#[usage(rename_all = "snake_case")]
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
#[derive(Debug, Clone, usage_rs::Subcommands)]
enum Command {
    /// Run the HTTP and MCP resource server.
    #[usage(visible_alias = "server")]
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

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::{Cli, Command};
    use crate::cli::commands;

    #[test]
    fn usage_spec_contains_commands() {
        let spec = Cli::to_kdl();
        assert!(spec.contains("cmd serve"));
        assert!(spec.contains("cmd config"));
        assert_eq!(Cli::spec().version, Some(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn no_subcommand_defaults_to_serve() {
        let cli = parse(&["canary"]);

        assert!(matches!(cli.command, Command::Serve(_)));
    }

    #[test]
    fn serve_alias_parses() {
        let cli = parse(&["canary", "server"]);

        assert!(matches!(cli.command, Command::Serve(_)));
    }

    #[test]
    fn global_verbosity_parses_after_subcommand() {
        let cli = parse(&["canary", "serve", "-vv"]);

        assert_eq!(cli.global.verbosity_filter(), Some("debug"));
    }

    #[test]
    fn log_filter_conflicts_with_verbosity() {
        let argv = ["canary", "-v", "--log-filter", "info"].map(OsStr::new);
        assert!(Cli::try_parse_from(&argv).is_err());
    }

    #[test]
    fn rejects_unknown_and_repeated_flags() {
        assert!(Cli::try_parse_from(&[OsStr::new("canary"), OsStr::new("--unknown")]).is_err());
        assert!(
            Cli::try_parse_from(&[
                OsStr::new("canary"),
                OsStr::new("--config"),
                OsStr::new("one.toml"),
                OsStr::new("--config"),
                OsStr::new("two.toml"),
            ])
            .is_err()
        );
    }

    #[test]
    fn rejects_zero_worker_concurrency() {
        let argv = ["canary", "worker", "run", "--concurrency", "0"].map(OsStr::new);
        assert!(Cli::try_parse_from(&argv).is_err());
    }

    #[test]
    fn config_and_worker_commands_parse() {
        let cli = parse(&["canary", "config", "show"]);
        assert!(matches!(
            cli.command,
            Command::Config(args) if matches!(args.command, commands::config::Command::Show(_))
        ));

        let cli = parse(&["canary", "worker", "run"]);
        assert!(matches!(
            cli.command,
            Command::Worker(args) if matches!(args.command, commands::worker::Command::Run(_))
        ));
    }

    #[test]
    fn config_commands_accept_server_config_flags() {
        let cli = parse(&[
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
            Command::Config(args) if matches!(args.command, commands::config::Command::Show(_))
        ));
    }

    fn parse(words: &[&str]) -> Cli {
        let argv = words.iter().map(OsStr::new).collect::<Vec<_>>();
        Cli::try_parse_from(&argv).expect("valid Canary command")
    }
}
