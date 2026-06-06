use miette::Result;

/// Arguments for `canary dev`.
#[derive(Debug, Clone, Copy, Default, clap::Args)]
pub(in crate::cli) struct Args;

#[inline(always)]
pub(in crate::cli) fn run(_args: Args) -> Result<()> {
    Err(miette::miette!(
        code = "canary_server::cli::todo",
        help = "The dev runtime will start the local server plus worker processes once the worker stack grows beyond the stubs.",
        "canary dev is not implemented yet"
    ))
}
