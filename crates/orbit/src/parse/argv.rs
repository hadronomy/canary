//! Argv capture.
//!
//! This module provides an owned, OS-native argv container suitable for
//! tokenization and later parsing.

use std::ffi::OsString;

use crate::parse::model::RawValue;

/// Owned argv input.
///
/// The program name is stored separately from the real argument list.
///
/// # Examples
///
/// ```rust
/// # use crate::parse::Argv;
/// let argv = Argv::from_iter(["prog", "--verbose", "file.txt"]);
///
/// assert_eq!(
///     argv.program().and_then(|v| v.try_as_str().ok()),
///     Some("prog"),
/// );
/// assert_eq!(argv.len(), 2);
/// ```
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Argv {
    program: Option<RawValue>,
    args: Box<[RawValue]>,
}

impl Argv {
    /// Capture argv from the current process environment.
    #[must_use]
    pub fn from_env() -> Self {
        Self::from_argv(std::env::args_os())
    }

    /// Build argv from an iterator of OS-native values.
    ///
    /// The first item, if present, becomes the program name. Remaining items are
    /// treated as real CLI args.
    #[must_use]
    pub fn from_argv<I, T>(iter: I) -> Self
    where
        I: IntoIterator<Item = T>,
        T: Into<OsString>,
    {
        let mut iter = iter.into_iter();
        let program = iter.next().map(|value| RawValue::from(value.into()));
        let args =
            iter.map(|value| RawValue::from(value.into())).collect::<Vec<_>>().into_boxed_slice();

        Self { program, args }
    }

    /// Create argv from an optional program name and explicit args.
    #[must_use]
    pub fn new(
        program: Option<impl Into<OsString>>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
    ) -> Self {
        Self {
            program: program.map(|value| RawValue::from(value.into())),
            args: args
                .into_iter()
                .map(|value| RawValue::from(value.into()))
                .collect::<Vec<_>>()
                .into_boxed_slice(),
        }
    }

    /// Return the program name, if any.
    #[must_use]
    pub fn program(&self) -> Option<&RawValue> {
        self.program.as_ref()
    }

    /// Return the real CLI args.
    #[must_use]
    pub fn args(&self) -> &[RawValue] {
        &self.args
    }

    /// Return the number of real CLI args.
    #[must_use]
    pub fn len(&self) -> usize {
        self.args.len()
    }

    /// Return `true` if there are no real CLI args.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.args.is_empty()
    }

    /// Iterate over real CLI args.
    #[must_use]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &RawValue> {
        self.args.iter()
    }

    pub(crate) fn into_parts(self) -> (Option<RawValue>, Box<[RawValue]>) {
        (self.program, self.args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_from_iter_splits_program_and_args() {
        let argv = Argv::from_argv(["prog", "--verbose", "file.txt"]);

        assert_eq!(argv.program().and_then(|v| v.try_as_str().ok()), Some("prog"));
        assert_eq!(argv.len(), 2);
        assert_eq!(argv.args()[0].try_as_str(), Ok("--verbose"));
        assert_eq!(argv.args()[1].try_as_str(), Ok("file.txt"));
    }

    #[test]
    fn argv_new_works() {
        let argv = Argv::new(Some("prog"), ["build", "--release"]);

        assert_eq!(argv.program().and_then(|v| v.try_as_str().ok()), Some("prog"));
        assert_eq!(argv.len(), 2);
    }
}
