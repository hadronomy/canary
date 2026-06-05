use std::fs::File;
use std::io;
use std::path::PathBuf;

use clap::{Args as ClapArgs, CommandFactory, Subcommand};
use miette::{IntoDiagnostic, Result, WrapErr};

use crate::cli::args::Cli;

/// Arguments for `canary generate`.
#[derive(Debug, Clone, ClapArgs)]
pub(in crate::cli) struct Args {
    #[command(subcommand)]
    command: Command,
}

/// Local artifact generation commands.
#[derive(Debug, Clone, Subcommand)]
enum Command {
    /// Generate shell completions on stdout.
    Completions {
        /// Shell to generate completions for.
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
    /// Generate a roff man page.
    Man {
        /// Directory to write canary.1 into. Stdout is used when omitted.
        #[arg(long, value_name = "DIR")]
        dir: Option<PathBuf>,
    },
}

pub(in crate::cli) fn run(args: Args) -> Result<()> {
    match args.command {
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            clap_complete::generate(shell, &mut cmd, "canary", &mut io::stdout());
            Ok(())
        }
        Command::Man { dir } => {
            let man = clap_mangen::Man::new(Cli::command());
            match dir {
                Some(dir) => {
                    std::fs::create_dir_all(&dir)
                        .into_diagnostic()
                        .wrap_err("Failed to create manpage output directory.")?;
                    let mut file = File::create(dir.join("canary.1"))
                        .into_diagnostic()
                        .wrap_err("Failed to create manpage file.")?;
                    man.render(&mut file).into_diagnostic()
                }
                None => man.render(&mut io::stdout()).into_diagnostic(),
            }
        }
    }
}
