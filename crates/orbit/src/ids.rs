#![allow(unused)]
//! Dense identifier types used throughout the compiled schema.
//!
//! These IDs are intentionally small, copyable newtypes over non-zero integer
//! primitives.
//!
//! Design goals:
//!
//! - compact storage
//! - fast indexing into frozen slices
//! - niche optimization for `Option<Id>`
//! - no accidental mixing of different ID domains
//! - pleasant debugging
//!
//! Why `NonZero*`?
//!
//! Using non-zero integer types allows Rust to optimize `Option<Id>` to the same
//! size as `Id` itself. This is especially useful for fields such as:
//!
//! - `Option<CommandId>` for parent commands
//! - `Option<Symbol>` for optional interned strings
//! - `Option<ValueSpecId>` for optional value specs
//!
//! Why 1-based encoding?
//!
//! Externally, these IDs are opaque. Internally, we map:
//!
//! - storage index `0` -> raw non-zero value `1`
//! - storage index `1` -> raw non-zero value `2`
//! - ...
//!
//! This gives a compact representation while keeping zero available as the niche
//! value for `Option<T>`.
//!
//! Local vs global IDs
//!
//! Most schema IDs are global and use `u32` under the hood:
//!
//! - [`CommandId`]
//! - [`ArgId`]
//! - [`GroupId`]
//! - [`ValueSpecId`]
//! - [`Symbol`]
//!
//! Command-local effective argument slots use [`LocalArgIndex`], which is backed
//! by `u16`.
//!
//! That means each compiled command can currently have at most `u16::MAX`
//! effective arguments in its local view.
//!
//! This is a deliberate compactness trade-off and can be widened later if needed.

use std::fmt;
use std::num::{NonZeroU16, NonZeroU32};

/// Opaque ID for a compiled command node.
///
/// This is a dense, globally unique identifier into the compiled schema's
/// command table.
///
/// `Option<CommandId>` is niche-optimized to the same size as `CommandId`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct CommandId(NonZeroU32);

/// Opaque ID for a compiled argument definition.
///
/// This identifies the canonical argument record in the global compiled schema.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct ArgId(NonZeroU32);

/// Opaque ID for a compiled argument group.
///
/// This identifies a canonical group definition in the global compiled schema.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct GroupId(NonZeroU32);

/// Opaque ID for a compiled value specification.
///
/// This identifies a canonical value spec in the global compiled schema.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct ValueSpecId(NonZeroU32);

/// Opaque ID for an interned UTF-8 string in the schema string pool.
///
/// Symbols are used for command names, help text, long names, aliases, headings,
/// environment variable names, and similar UTF-8 metadata.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct Symbol(NonZeroU32);

/// Command-local effective argument index.
///
/// This is not a global schema ID. Instead, it identifies a slot in a single
/// command's effective argument view.
///
/// A local slot is used for:
///
/// - required masks
/// - conflicts masks
/// - requires masks
/// - parser match state
///
/// This type is intentionally backed by `u16` to keep per-command structures
/// compact.
///
/// `Option<LocalArgIndex>` is niche-optimized to the same size as
/// `LocalArgIndex`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct LocalArgIndex(NonZeroU16);

/// Implement the common dense-ID behavior for a non-zero newtype.
///
/// This macro is intentionally small and focused. It provides:
///
/// - `from_index(usize)`
/// - `index() -> usize`
/// - `get() -> <int>`
/// - a user-friendly `Debug` impl that prints the logical zero-based index
///
/// The internal encoding is always:
///
/// - stored raw value = `index + 1`
/// - logical index = `raw - 1`
///
/// That keeps `0` available as the niche value for `Option<Self>`.
///
/// Why a macro here?
///
/// All of the ID newtypes share the same behavior pattern but differ in:
///
/// - their concrete type name
/// - their underlying non-zero type
/// - their raw integer width (`u16` vs `u32`)
///
/// Using a small macro keeps the implementations consistent without making the
/// file repetitive.
///
/// Example expansion shape:
///
/// ```rust,ignore
/// impl_dense_id!(CommandId, NonZeroU32, u32, "CommandId");
/// impl_dense_id!(LocalArgIndex, NonZeroU16, u16, "LocalArgIndex");
/// ```
///
/// The final string parameter is only used in panic messages.
macro_rules! impl_dense_id {
    ($name:ident, $nz:ty, $int:ty, $label:literal) => {
        impl $name {
            /// Create an ID from a zero-based storage index.
            ///
            /// Internally this is encoded as `index + 1` so that zero remains
            /// available as the niche value for `Option<Self>`.
            ///
            /// # Panics
            ///
            /// Panics if the provided index cannot fit in the underlying integer
            /// representation.
            ///
            /// # Examples
            ///
            /// ```rust,ignore
            /// let id = CommandId::from_index(0);
            /// assert_eq!(id.index(), 0);
            /// ```
            #[inline]
            pub(crate) fn from_index(index: usize) -> Self {
                let raw = <$int>::try_from(index + 1).expect(concat!($label, " overflow"));
                Self(<$nz>::new(raw).expect(concat!($label, " must be non-zero")))
            }

            /// Return the zero-based storage index for this ID.
            ///
            /// This is intended for indexing into frozen internal slices.
            ///
            /// # Examples
            ///
            /// ```rust,ignore
            /// let id = ArgId::from_index(7);
            /// assert_eq!(id.index(), 7);
            /// ```
            #[inline]
            pub(crate) fn index(self) -> usize {
                (self.0.get() - 1) as usize
            }

            /// Return the raw non-zero encoded integer value.
            ///
            /// This is mostly useful for diagnostics, debugging, and testing.
            ///
            /// Note that this is not the same as the logical storage index:
            ///
            /// - `from_index(0).get() == 1`
            /// - `from_index(1).get() == 2`
            ///
            /// # Examples
            ///
            /// ```rust,ignore
            /// let id = GroupId::from_index(3);
            /// assert_eq!(id.get(), 4);
            /// ```
            #[inline]
            pub(crate) fn get(self) -> $int {
                self.0.get()
            }
        }

        impl fmt::Debug for $name {
            /// Format the ID using its logical zero-based index.
            ///
            /// This is intentionally more useful in debugging than printing the
            /// raw encoded non-zero integer.
            ///
            /// For example, `CommandId::from_index(4)` is rendered as:
            ///
            /// ```text
            /// CommandId(4)
            /// ```
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.debug_tuple(stringify!($name)).field(&self.index()).finish()
            }
        }
    };
}

impl_dense_id!(CommandId, NonZeroU32, u32, "CommandId");
impl_dense_id!(ArgId, NonZeroU32, u32, "ArgId");
impl_dense_id!(GroupId, NonZeroU32, u32, "GroupId");
impl_dense_id!(ValueSpecId, NonZeroU32, u32, "ValueSpecId");
impl_dense_id!(Symbol, NonZeroU32, u32, "Symbol");
impl_dense_id!(LocalArgIndex, NonZeroU16, u16, "LocalArgIndex");

#[cfg(test)]
mod tests {
    use std::mem::size_of;

    use super::*;

    #[test]
    fn command_id_round_trips_index() {
        let id = CommandId::from_index(0);
        assert_eq!(id.index(), 0);
        assert_eq!(id.get(), 1);

        let id = CommandId::from_index(41);
        assert_eq!(id.index(), 41);
        assert_eq!(id.get(), 42);
    }

    #[test]
    fn arg_id_round_trips_index() {
        let id = ArgId::from_index(7);
        assert_eq!(id.index(), 7);
        assert_eq!(id.get(), 8);
    }

    #[test]
    fn group_id_round_trips_index() {
        let id = GroupId::from_index(12);
        assert_eq!(id.index(), 12);
        assert_eq!(id.get(), 13);
    }

    #[test]
    fn value_spec_id_round_trips_index() {
        let id = ValueSpecId::from_index(3);
        assert_eq!(id.index(), 3);
        assert_eq!(id.get(), 4);
    }

    #[test]
    fn symbol_round_trips_index() {
        let sym = Symbol::from_index(99);
        assert_eq!(sym.index(), 99);
        assert_eq!(sym.get(), 100);
    }

    #[test]
    fn local_arg_index_round_trips_index() {
        let local = LocalArgIndex::from_index(0);
        assert_eq!(local.index(), 0);
        assert_eq!(local.get(), 1);

        let local = LocalArgIndex::from_index(255);
        assert_eq!(local.index(), 255);
        assert_eq!(local.get(), 256);
    }

    #[test]
    fn option_ids_use_niche_optimization() {
        assert_eq!(size_of::<CommandId>(), size_of::<Option<CommandId>>());
        assert_eq!(size_of::<ArgId>(), size_of::<Option<ArgId>>());
        assert_eq!(size_of::<GroupId>(), size_of::<Option<GroupId>>());
        assert_eq!(size_of::<ValueSpecId>(), size_of::<Option<ValueSpecId>>());
        assert_eq!(size_of::<Symbol>(), size_of::<Option<Symbol>>());
        assert_eq!(size_of::<LocalArgIndex>(), size_of::<Option<LocalArgIndex>>());
    }

    #[test]
    fn different_id_types_are_distinct() {
        let command = CommandId::from_index(1);
        let arg = ArgId::from_index(1);
        let group = GroupId::from_index(1);
        let value = ValueSpecId::from_index(1);
        let symbol = Symbol::from_index(1);
        let local = LocalArgIndex::from_index(1);

        assert_eq!(format!("{command:?}"), "CommandId(1)");
        assert_eq!(format!("{arg:?}"), "ArgId(1)");
        assert_eq!(format!("{group:?}"), "GroupId(1)");
        assert_eq!(format!("{value:?}"), "ValueSpecId(1)");
        assert_eq!(format!("{symbol:?}"), "Symbol(1)");
        assert_eq!(format!("{local:?}"), "LocalArgIndex(1)");
    }
}
