use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;

use miette::{IntoDiagnostic, Result, WrapErr};
use usage_lib::docs::manpage::ManpageRenderer;
use usage_rs::{Args as UsageArgs, Subcommands, ValueEnum};

use crate::cli::args::Cli;

/// Arguments for `canary generate`.
#[derive(Debug, Clone, UsageArgs)]
pub(in crate::cli) struct Args {
    #[usage(subcommand)]
    command: Command,
}

/// Local artifact generation commands.
#[derive(Debug, Clone, Subcommands)]
enum Command {
    /// Generate shell completions on stdout.
    Completions {
        /// Shell to generate completions for.
        #[usage(value_enum)]
        shell: Target,
    },
    /// Generate a roff man page.
    Man {
        /// Directory to write canary.1 into. Stdout is used when omitted.
        #[usage(long, value_name = "DIR")]
        dir: Option<PathBuf>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Target {
    Bash,
    Elvish,
    Zsh,
    Fish,
    #[usage(visible_alias = "nushell")]
    Nu,
    #[usage(name = "powershell", visible_alias = "pwsh")]
    PowerShell,
}

impl From<Target> for usage_rs::complete::Shell {
    fn from(shell: Target) -> Self {
        match shell {
            Target::Bash => Self::Bash,
            Target::Elvish => Self::Elvish,
            Target::Zsh => Self::Zsh,
            Target::Fish => Self::Fish,
            Target::Nu => Self::Nu,
            Target::PowerShell => Self::PowerShell,
        }
    }
}

pub(in crate::cli) fn run(args: Args) -> Result<()> {
    match args.command {
        Command::Completions { shell } => io::stdout()
            .write_all(Cli::completion_script(shell.into()).as_bytes())
            .into_diagnostic(),
        Command::Man { dir } => {
            let spec = Cli::to_kdl().parse().into_diagnostic()?;
            let man = ManpageRenderer::new(spec).render().into_diagnostic()?;
            match dir {
                Some(dir) => {
                    std::fs::create_dir_all(&dir)
                        .into_diagnostic()
                        .wrap_err("Failed to create manpage output directory.")?;
                    let mut file = File::create(dir.join("canary.1"))
                        .into_diagnostic()
                        .wrap_err("Failed to create manpage file.")?;
                    file.write_all(man.as_bytes()).into_diagnostic()
                }
                None => io::stdout().write_all(man.as_bytes()).into_diagnostic(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Cli, ManpageRenderer};

    #[test]
    fn generated_manpage_covers_server_commands() {
        let spec = Cli::to_kdl().parse().expect("valid CLI spec");
        let page = ManpageRenderer::new(spec).render().expect("valid man page");

        assert!(page.contains("canary"));
        assert!(page.contains("serve"));
    }

    #[test]
    fn completion_script_targets_canary() {
        let script = Cli::completion_script(usage_rs::complete::Shell::Bash);

        assert!(script.contains("canary"));
    }
}
