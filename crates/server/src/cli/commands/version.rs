use miette::Result;

use crate::VERSION;
use crate::cli::commands::output::{self, StructuredFormat};

/// Arguments for `canary version`.
#[derive(Debug, Clone, Copy, Default, usage_rs::Args)]
pub(in crate::cli) struct Args {
    /// Output format for the build report.
    #[usage(long, value_enum, default = "toml")]
    format: StructuredFormat,
}

#[inline(always)]
pub(in crate::cli) fn run(args: Args) -> Result<()> {
    output::print(args.format, &VERSION.report())
}
