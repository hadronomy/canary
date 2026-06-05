use std::io;

use miette::{IntoDiagnostic, Result};
use serde::Serialize;

/// Output format selected by commands with both human and structured views.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
#[value(rename_all = "snake_case")]
pub(in crate::cli::commands) enum Format {
    #[default]
    Human,
    Toml,
    Json,
}

impl Format {
    #[inline(always)]
    pub(super) const fn is_human(self) -> bool {
        matches!(self, Self::Human)
    }

    #[inline(always)]
    pub(super) const fn structured(self) -> Option<StructuredFormat> {
        match self {
            Self::Human => None,
            Self::Toml => Some(StructuredFormat::Toml),
            Self::Json => Some(StructuredFormat::Json),
        }
    }
}

/// Structured output format selected by commands that need machine-readable data.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
#[value(rename_all = "snake_case")]
pub(in crate::cli::commands) enum StructuredFormat {
    #[default]
    Toml,
    Json,
}

impl StructuredFormat {
    #[inline(always)]
    pub(super) const fn is_json(self) -> bool {
        matches!(self, Self::Json)
    }
}

pub(in crate::cli::commands) fn print<T>(format: StructuredFormat, value: &T) -> Result<()>
where
    T: Serialize,
{
    if format.is_json() {
        serde_json::to_writer_pretty(io::stdout(), value).into_diagnostic()?;
        println!();
        return Ok(());
    }
    print!("{}", toml::to_string_pretty(value).into_diagnostic()?);
    Ok(())
}
