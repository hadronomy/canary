//! Help rendering errors.

use std::io;

use thiserror::Error;

/// Error produced while rendering or printing help.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum HelpError {
    /// Writing help output failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}
