use miette::Result;

use crate::cli::commands::worker;

/// Arguments for `canary dev`.
#[derive(Debug, Clone, Copy, Default, clap::Args)]
pub(in crate::cli) struct Args;

#[inline(always)]
pub(in crate::cli) fn run(_args: Args) -> Result<()> {
    worker::todo("canary dev")
}
