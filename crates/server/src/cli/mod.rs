//! Command-line entrypoint for the Canary server.
//!
//! Clap parses command intent, the config module resolves settings, and the
//! runner hands the loaded process to the server runtime.

mod args;
mod commands;
mod layer;

use clap::Parser;
use miette::{IntoDiagnostic, MietteHandlerOpts, Result, WrapErr};

use self::args::Cli;

/// Runs the Canary command-line application.
///
/// # Errors
///
/// Returns a diagnostic when the selected command cannot complete.
pub fn main() -> Result<()> {
    human_panic::setup_panic!();
    install_diagnostics()?;
    Cli::parse().run()
}

fn install_diagnostics() -> Result<()> {
    miette::set_hook(Box::new(|_| {
        Box::new(MietteHandlerOpts::new().terminal_links(true).context_lines(2).build())
    }))
    .into_diagnostic()
    .wrap_err("Failed to install the miette report handler.")
}
