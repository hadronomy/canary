//! Core parse-layer data model.
//!
//! This module provides:
//!
//! - raw OS-native values via [`RawValue`]
//! - immutable stored values via [`ValueStore`]
//! - argv-relative spans via [`Span`]
//! - future parser result structures such as [`ParseOutput`]
//!
//! These types are intentionally parser-engine agnostic.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::num::NonZeroU32;

use thiserror::Error;

use crate::ids::{ArgId, CommandId, LocalArgIndex};

/// OS-native raw value.
///
/// This is the fundamental value unit used throughout argv capture, tokenization,
/// normalization, and raw parse results.
///
/// `RawValue` preserves non-UTF8 data.
///
/// # Examples
///
/// ```rust
/// # use crate::parse::RawValue;
/// let value = RawValue::from("hello");
/// assert_eq!(value.try_as_str(), Ok("hello"));
/// ```
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct RawValue {
    inner: OsString,
}

impl RawValue {
    /// Create a new raw value.
    #[must_use]
    pub fn new(value: impl Into<OsString>) -> Self {
        Self { inner: value.into() }
    }

    /// Borrow as `OsStr`.
    #[must_use]
    pub fn as_os_str(&self) -> &OsStr {
        &self.inner
    }

    /// Convert into `OsString`.
    #[must_use]
    pub fn into_os_string(self) -> OsString {
        self.inner
    }

    /// Borrow as UTF-8 `&str`.
    ///
    /// # Errors
    ///
    /// Returns [`NonUtf8Value`] if the raw value is not valid UTF-8.
    pub fn try_as_str(&self) -> Result<&str, NonUtf8Value> {
        self.inner
            .to_str()
            .ok_or_else(|| NonUtf8Value { display: self.display().to_string().into_boxed_str() })
    }

    /// Return a display wrapper for diagnostics and logs.
    ///
    /// This uses lossy conversion when needed.
    #[must_use]
    pub fn display(&self) -> RawValueDisplay<'_> {
        RawValueDisplay { value: self }
    }

    /// Return `true` if this value is exactly `"-"`.
    #[must_use]
    pub(crate) fn is_single_dash(&self) -> bool {
        os_equals(self.as_os_str(), "-")
    }

    /// Return `true` if this value is exactly `"--"`.
    #[must_use]
    pub(crate) fn is_double_dash(&self) -> bool {
        os_equals(self.as_os_str(), "--")
    }

    /// Return `true` if this value begins with `'-'`.
    #[must_use]
    pub(crate) fn starts_with_dash(&self) -> bool {
        os_starts_with_dash(self.as_os_str())
    }
}

impl fmt::Debug for RawValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("RawValue").field(&self.display().to_string()).finish()
    }
}

impl From<OsString> for RawValue {
    fn from(value: OsString) -> Self {
        Self { inner: value }
    }
}

impl From<&OsStr> for RawValue {
    fn from(value: &OsStr) -> Self {
        Self { inner: value.to_os_string() }
    }
}

impl From<String> for RawValue {
    fn from(value: String) -> Self {
        Self { inner: OsString::from(value) }
    }
}

impl From<&str> for RawValue {
    fn from(value: &str) -> Self {
        Self { inner: OsString::from(value) }
    }
}

/// Display wrapper for [`RawValue`].
#[derive(Clone, Copy)]
pub struct RawValueDisplay<'a> {
    value: &'a RawValue,
}

impl fmt::Display for RawValueDisplay<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.value.as_os_str().to_string_lossy())
    }
}

impl fmt::Debug for RawValueDisplay<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

/// Error returned when a raw value is not valid UTF-8.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("value is not valid UTF-8: {display}")]
pub struct NonUtf8Value {
    display: Box<str>,
}

/// Opaque parse-layer ID for a stored raw value.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct ValueId(NonZeroU32);

impl ValueId {
    #[inline]
    pub(crate) fn from_index(index: usize) -> Self {
        let raw = u32::try_from(index + 1).expect("ValueId overflow");
        Self(NonZeroU32::new(raw).expect("ValueId must be non-zero"))
    }

    #[inline]
    pub(crate) fn index(self) -> usize {
        (self.0.get() - 1) as usize
    }
}

impl fmt::Debug for ValueId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("ValueId").field(&self.index()).finish()
    }
}

/// Frozen stored raw values used by tokenization, normalization, and parse
/// results.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ValueStore {
    values: Box<[RawValue]>,
}

impl ValueStore {
    /// Return the raw value for `id`.
    #[must_use]
    pub(crate) fn get(&self, id: ValueId) -> &RawValue {
        &self.values[id.index()]
    }

    /// Try to return the raw value for `id`.
    #[must_use]
    pub fn try_get(&self, id: ValueId) -> Option<&RawValue> {
        self.values.get(id.index())
    }

    /// Return the number of stored values.
    #[must_use]
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Return `true` if no values are stored.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Iterate over `(ValueId, &RawValue)` pairs.
    #[must_use]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (ValueId, &RawValue)> + '_ {
        self.values.iter().enumerate().map(|(index, value)| (ValueId::from_index(index), value))
    }
}

#[derive(Debug, Default)]
pub(crate) struct ValueStoreBuilder {
    values: Vec<RawValue>,
}

impl ValueStoreBuilder {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn from_store(store: &ValueStore) -> Self {
        Self { values: store.values.to_vec() }
    }

    /// Return the raw value for `id`.
    #[must_use]
    pub(crate) fn get(&self, id: ValueId) -> &RawValue {
        &self.values[id.index()]
    }

    pub(crate) fn push(&mut self, value: RawValue) -> ValueId {
        let id = ValueId::from_index(self.values.len());
        self.values.push(value);
        id
    }

    pub(crate) fn freeze(self) -> ValueStore {
        ValueStore { values: self.values.into_boxed_slice() }
    }
}

/// A span pointing into argv by argument index and argument part.
///
/// This is intentionally argument-oriented rather than byte-oriented. It is
/// stable and useful for CLI diagnostics.
///
/// `arg_index` is relative to the actual argument list, excluding the program
/// name.
///
/// So:
///
/// - `argv[0]` is the first real CLI argument after the executable name
/// - `argv[1]` is the second
/// - etc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    /// Index within the real argv list, excluding the program name.
    pub arg_index: u32,
    /// Which conceptual part of the arg this span refers to.
    pub part: SpanPart,
}

/// Span subdivision within one argv entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SpanPart {
    /// Whole arg.
    Whole,
    /// Long option name portion, e.g. `config` in `--config=value`.
    LongName,
    /// Short option name portion, e.g. `v` in `-v`.
    ShortName,
    /// Attached value portion, e.g. `value` in `--opt=value`.
    AttachedValue,
    /// Bare argv value.
    BareValue,
    /// `--` terminator.
    Terminator,
    /// Value seamlessly resolved from the process environment.
    Environment,
    /// Value seamlessly resolved from the schema's default specification.
    Default,
}

/// Origin of a matched value.
///
/// This is part of the raw parse result model, not tokenization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ValueOrigin {
    /// A bare argv value.
    Bare,
    /// A value attached to a long option, e.g. `--opt=value`.
    AttachedLong,
    /// A value attached to a short option, e.g. `-ovalue`.
    AttachedShort,
    /// A separate argv value following an option.
    Separate,
    /// A positional value.
    Positional,
    /// Value seamlessly resolved from the process environment.
    Environment,
    /// Value seamlessly resolved from the schema's default specification.
    Default,
}

/// A matched value occurrence in a future parse result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ValueOccurrence {
    /// Stored raw value ID.
    pub value: ValueId,
    /// Where the value came from in argv.
    pub span: Span,
    /// Semantic origin of the value.
    pub origin: ValueOrigin,
}

/// One occurrence of an arg in a future parse result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    /// Where the arg occurrence came from in argv.
    pub span: Span,
    /// Values attached to this occurrence.
    pub values: Box<[ValueOccurrence]>,
}

/// Raw matched data for one arg in a future parse result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArgMatch {
    /// Canonical arg ID.
    pub arg: ArgId,
    /// Command-local effective arg slot.
    pub local: LocalArgIndex,
    /// All occurrences of this arg.
    pub occurrences: Box<[Occurrence]>,
}

impl ArgMatch {
    /// Return the occurrence count.
    #[must_use]
    pub fn occurrence_count(&self) -> usize {
        self.occurrences.len()
    }

    /// Return `true` if the arg occurred at least once.
    #[must_use]
    pub fn is_present(&self) -> bool {
        !self.occurrences.is_empty()
    }
}

/// Raw matched data for one command invocation in a future parse result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandMatch {
    /// Matched command ID.
    pub command: CommandId,
    /// Matched args for this command view.
    pub args: Box<[ArgMatch]>,
    /// Nested matched subcommand, if any.
    pub subcommand: Option<Box<CommandMatch>>,
}

impl CommandMatch {
    /// Iterate over matched args.
    #[must_use]
    pub fn args(&self) -> impl ExactSizeIterator<Item = &ArgMatch> {
        self.args.iter()
    }

    /// Return the nested subcommand match, if any.
    #[must_use]
    pub fn subcommand(&self) -> Option<&CommandMatch> {
        self.subcommand.as_deref()
    }
}

/// Full future parser output.
///
/// This is the intended raw result model for the parser, before any typed decode
/// layer is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseOutput {
    /// Program name, if captured.
    pub program: Option<RawValue>,
    /// Root matched command invocation.
    pub root: CommandMatch,
    /// Shared raw values used by the invocation tree.
    pub values: ValueStore,
}

/// A parser-ready normalized token.
///
/// Long and short option names are decoded into explicit tokens, while raw
/// values still refer into the shared `ValueStore`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum NormalizedToken {
    /// A long option name without leading `--`.
    Long { name: Box<str>, span: Span },
    /// A short option name.
    Short { name: char, span: Span },
    /// A raw value token.
    Value { value: ValueId, span: Span },
    /// The `--` terminator.
    Terminator { span: Span },
}

#[cfg(unix)]
fn os_equals(value: &OsStr, expected: &str) -> bool {
    use std::os::unix::ffi::OsStrExt;

    value.as_bytes() == expected.as_bytes()
}

#[cfg(windows)]
fn os_equals(value: &OsStr, expected: &str) -> bool {
    use std::os::windows::ffi::OsStrExt;

    let units = value.encode_wide().collect::<Vec<_>>();
    let expected = expected.encode_utf16().collect::<Vec<_>>();
    units == expected
}

#[cfg(unix)]
fn os_starts_with_dash(value: &OsStr) -> bool {
    use std::os::unix::ffi::OsStrExt;

    value.as_bytes().first().copied() == Some(b'-')
}

#[cfg(windows)]
fn os_starts_with_dash(value: &OsStr) -> bool {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().next() == Some('-' as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_value_utf8_roundtrip_works() {
        let value = RawValue::from("hello");
        assert_eq!(value.try_as_str(), Ok("hello"));
        assert_eq!(value.display().to_string(), "hello");
    }

    #[test]
    fn value_store_assigns_dense_ids() {
        let mut builder = ValueStoreBuilder::new();
        let a = builder.push(RawValue::from("a"));
        let b = builder.push(RawValue::from("b"));
        let store = builder.freeze();

        assert_eq!(a.index(), 0);
        assert_eq!(b.index(), 1);
        assert_eq!(store.get(a).try_as_str(), Ok("a"));
        assert_eq!(store.get(b).try_as_str(), Ok("b"));
    }

    #[test]
    fn raw_value_dash_helpers_work() {
        assert!(RawValue::from("-").is_single_dash());
        assert!(RawValue::from("--").is_double_dash());
        assert!(RawValue::from("-v").starts_with_dash());
        assert!(!RawValue::from("value").starts_with_dash());
    }

    #[test]
    fn arg_match_presence_helpers_work() {
        let arg = ArgMatch {
            arg: ArgId::from_index(0),
            local: LocalArgIndex::from_index(0),
            occurrences: Box::new([]),
        };

        assert_eq!(arg.occurrence_count(), 0);
        assert!(!arg.is_present());
    }
}
