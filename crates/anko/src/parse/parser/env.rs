//! Environment access abstraction.
//!
//! The parser uses environment variables only through this tiny trait. That
//! keeps fallback behavior easy to test and avoids hard-coding direct access to
//! global process state throughout parser internals.

use std::ffi::OsString;

/// Source of environment variables for parser fallbacks.
pub(super) trait EnvProvider {
    /// Return the value of an environment variable if it exists.
    fn var_os(&self, name: &str) -> Option<OsString>;
}

/// Production environment provider backed by [`std::env`].
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct StdEnv;

impl EnvProvider for StdEnv {
    fn var_os(&self, name: &str) -> Option<OsString> {
        std::env::var_os(name)
    }
}
