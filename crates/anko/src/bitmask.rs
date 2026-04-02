#![allow(unused)]
//! Internal bitmask utilities for command-local argument slots.
//!
//! This module provides a small typestate wrapper around
//! [`fixedbitset::FixedBitSet`].
//!
//! Why typestate?
//!
//! The compiler pipeline in this crate naturally has two phases:
//!
//! - build/compile time, where masks are assembled incrementally
//! - frozen/runtime time, where masks are read-only schema data
//!
//! Using a single generic `BitMask<State>` with phase markers gives us:
//!
//! - one representation
//! - one conceptual type
//! - a mutation API only in the mutable phase
//! - a read-only API in the frozen phase
//! - ergonomic construction via `BitMask::new(...)`
//!
//! The default generic parameter is [`Mutable`], so the builder-side call sites
//! stay pleasant:
//!
//! ```rust
//! # use fixedbitset::FixedBitSet;
//! # use std::marker::PhantomData;
//! #
//! # #[derive(Debug, Clone, Copy, PartialEq, Eq)]
//! # struct Mutable;
//! #
//! # #[derive(Debug, Clone, PartialEq, Eq)]
//! # struct BitMask<State = Mutable> {
//! #     bits: FixedBitSet,
//! #     _state: PhantomData<State>,
//! # }
//! #
//! # impl BitMask<Mutable> {
//! #     fn new(bit_len: usize) -> Self {
//! #         Self {
//! #             bits: FixedBitSet::with_capacity(bit_len),
//! #             _state: PhantomData,
//! #         }
//! #     }
//! # }
//! let mask = BitMask::new(16);
//! # let _ = mask;
//! ```
//!
//! The frozen form is explicit:
//!
//! ```rust
//! # use fixedbitset::FixedBitSet;
//! # use std::marker::PhantomData;
//! #
//! # #[derive(Debug, Clone, Copy, PartialEq, Eq)]
//! # struct Mutable;
//! #
//! # #[derive(Debug, Clone, Copy, PartialEq, Eq)]
//! # struct Frozen;
//! #
//! # #[derive(Debug, Clone, PartialEq, Eq)]
//! # struct BitMask<State = Mutable> {
//! #     bits: FixedBitSet,
//! #     _state: PhantomData<State>,
//! # }
//! #
//! # impl BitMask<Mutable> {
//! #     fn new(bit_len: usize) -> Self {
//! #         Self {
//! #             bits: FixedBitSet::with_capacity(bit_len),
//! #             _state: PhantomData,
//! #         }
//! #     }
//! #
//! #     fn freeze(self) -> BitMask<Frozen> {
//! #         BitMask {
//! #             bits: self.bits,
//! #             _state: PhantomData,
//! #         }
//! #     }
//! # }
//! let frozen = BitMask::new(16).freeze();
//! # let _ = frozen;
//! ```
//!
//! The bit positions correspond to command-local argument slots. The actual
//! addressable range is therefore determined by `LocalArgIndex`, not by
//! `FixedBitSet` itself.
//!
//! Typical usage inside the compiler:
//!
//! ```rust,ignore
//! let mut required = BitMask::new(local_count);
//!
//! for local in required_args {
//!     required.insert(local);
//! }
//!
//! let required = required.freeze();
//! ```
//!
//! Typical runtime usage from compiled schema data:
//!
//! ```rust,ignore
//! if command.required_mask.contains(local_arg) {
//!     // validate presence
//! }
//! ```

use std::marker::PhantomData;

use fixedbitset::FixedBitSet;

use crate::ids::LocalArgIndex;

/// Mutable bitmask phase marker.
///
/// `BitMask<Mutable>` supports construction and mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub(crate) struct Mutable;

/// Frozen bitmask phase marker.
///
/// `BitMask<Frozen>` supports read-only queries and iteration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub(crate) struct Frozen;

/// Internal bitmask over command-local argument slots.
///
/// This type is parameterized by a typestate marker:
///
/// - `BitMask` or `BitMask<Mutable>`: mutable construction phase
/// - `BitMask<Frozen>`: immutable compiled phase
///
/// The default state is [`Mutable`], so compiler-side code can simply write:
///
/// ```rust,ignore
/// let mut mask = BitMask::new(local_count);
/// mask.insert(local);
/// let mask = mask.freeze();
/// ```
///
/// The frozen form is intended for storage in compiled schema structs.
///
/// This wrapper intentionally keeps `fixedbitset` out of the rest of the crate,
/// so internal callers work with domain-level operations rather than raw bitset
/// APIs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BitMask<State = Mutable> {
    bits: FixedBitSet,
    _state: PhantomData<State>,
}

/// Convenient alias for the compiled read-only form.
///
/// This is useful in schema field definitions:
///
/// ```rust,ignore
/// pub(crate) struct CommandArg {
///     pub(crate) conflicts: FrozenBitMask,
///     pub(crate) requires: FrozenBitMask,
/// }
/// ```
pub(crate) type FrozenBitMask = BitMask<Frozen>;

impl BitMask<Mutable> {
    /// Create an empty mutable mask sized for `bit_len` command-local slots.
    ///
    /// The returned mask has all bits cleared.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mask = BitMask::new(32);
    /// assert!(mask.is_empty());
    /// assert_eq!(mask.len(), 32);
    /// ```
    #[inline]
    pub(crate) fn new(bit_len: usize) -> Self {
        Self { bits: FixedBitSet::with_capacity(bit_len), _state: PhantomData }
    }

    /// Create a mutable mask and set the provided indices.
    ///
    /// This is useful when lowering precomputed relations into a final mask.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mask = BitMask::from_indices(bit_len, [a, b, c]);
    /// assert!(mask.contains(a));
    /// assert!(mask.contains(b));
    /// assert!(mask.contains(c));
    /// ```
    pub(crate) fn from_indices(
        bit_len: usize,
        indices: impl IntoIterator<Item = LocalArgIndex>,
    ) -> Self {
        let mut mask = Self::new(bit_len);
        mask.extend(indices);
        mask
    }

    /// Set a bit for the given local argument index.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mut mask = BitMask::new(8);
    /// mask.insert(local);
    /// assert!(mask.contains(local));
    /// ```
    #[inline]
    pub(crate) fn insert(&mut self, index: LocalArgIndex) {
        self.bits.insert(index.index());
    }

    /// Set all bits from the provided indices.
    ///
    /// This is equivalent to repeated calls to [`insert`](Self::insert).
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mut mask = BitMask::new(8);
    /// mask.extend([a, b, c]);
    /// ```
    pub(crate) fn extend(&mut self, indices: impl IntoIterator<Item = LocalArgIndex>) {
        for index in indices {
            self.insert(index);
        }
    }

    /// Union this mutable mask with a frozen mask.
    ///
    /// This is especially handy when accumulating inherited requirements or
    /// composing precomputed masks during compilation.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mut out = BitMask::new(local_count);
    /// out.union_with(&precomputed);
    /// ```
    #[inline]
    pub(crate) fn union_with(&mut self, other: &BitMask<Frozen>) {
        self.bits.union_with(&other.bits);
    }

    /// Freeze this mutable mask into its read-only compiled form.
    ///
    /// After freezing, mutation methods are no longer available.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mut mask = BitMask::new(8);
    /// mask.insert(local);
    ///
    /// let frozen = mask.freeze();
    /// assert!(frozen.contains(local));
    /// ```
    #[inline]
    pub(crate) fn freeze(self) -> BitMask<Frozen> {
        BitMask { bits: self.bits, _state: PhantomData }
    }
}

impl BitMask<Frozen> {
    /// Create an empty frozen mask sized for `bit_len` command-local slots.
    ///
    /// This is mainly useful for cases where the final representation needs an
    /// explicit empty mask without going through a mutable assembly step.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mask = FrozenBitMask::empty(16);
    /// assert!(mask.is_empty());
    /// ```
    #[inline]
    pub(crate) fn empty(bit_len: usize) -> Self {
        BitMask::<Mutable>::new(bit_len).freeze()
    }

    /// Return `true` if the given local argument index is present in the mask.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if required_mask.contains(local) {
    ///     // local arg is required
    /// }
    /// ```
    #[inline]
    pub(crate) fn contains(&self, index: LocalArgIndex) -> bool {
        self.bits.contains(index.index())
    }

    /// Return `true` if this mask shares at least one bit with `other`.
    ///
    /// This is typically used for conflict or presence checks during parsing and
    /// validation.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if seen.intersects(&conflicts) {
    ///     // conflict detected
    /// }
    /// ```
    #[inline]
    pub(crate) fn intersects(&self, other: &Self) -> bool {
        self.bits.intersection(&other.bits).next().is_some()
    }

    /// Iterate over all set local argument indices in ascending order.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// for local in required_mask.iter() {
    ///     // validate each required local arg
    /// }
    /// ```
    #[inline]
    pub(crate) fn iter(&self) -> impl Iterator<Item = LocalArgIndex> + '_ {
        self.bits.ones().map(LocalArgIndex::from_index)
    }
}

impl<State> BitMask<State> {
    /// Return the logical bit length of the mask.
    ///
    /// This is the size of the command-local slot space the mask was created
    /// for, not the number of set bits.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mutable = BitMask::new(12);
    /// assert_eq!(mutable.len(), 12);
    ///
    /// let frozen = mutable.freeze();
    /// assert_eq!(frozen.len(), 12);
    /// ```
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.bits.len()
    }

    /// Return `true` if no bits are set.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mask = BitMask::new(6);
    /// assert!(mask.is_empty());
    /// ```
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.bits.is_clear()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[inline]
    fn local(index: usize) -> LocalArgIndex {
        LocalArgIndex::from_index(index)
    }

    #[test]
    fn mutable_masks_are_ergonomic_to_construct() {
        let mut mask = BitMask::new(8);
        assert_eq!(mask.len(), 8);
        assert!(mask.is_empty());

        mask.insert(local(1));
        mask.insert(local(3));
        mask.insert(local(5));

        let frozen = mask.freeze();
        assert_eq!(frozen.len(), 8);
        assert!(!frozen.is_empty());
        assert!(frozen.contains(local(1)));
        assert!(frozen.contains(local(3)));
        assert!(frozen.contains(local(5)));
        assert!(!frozen.contains(local(0)));
    }

    #[test]
    fn from_indices_sets_all_requested_bits() {
        let frozen = BitMask::from_indices(10, [local(0), local(4), local(9)]).freeze();

        assert!(frozen.contains(local(0)));
        assert!(frozen.contains(local(4)));
        assert!(frozen.contains(local(9)));
        assert!(!frozen.contains(local(1)));
    }

    #[test]
    fn intersection_works_for_frozen_masks() {
        let a = BitMask::from_indices(8, [local(1), local(2)]).freeze();
        let b = BitMask::from_indices(8, [local(2), local(7)]).freeze();
        let c = BitMask::from_indices(8, [local(5)]).freeze();

        assert!(a.intersects(&b));
        assert!(!a.intersects(&c));
    }

    #[test]
    fn iter_returns_set_bits_in_order() {
        let frozen = BitMask::from_indices(8, [local(5), local(1), local(6)]).freeze();

        let collected = frozen.iter().map(LocalArgIndex::index).collect::<Vec<_>>();
        assert_eq!(collected, vec![1, 5, 6]);
    }

    #[test]
    fn union_with_combines_frozen_into_mutable() {
        let source = BitMask::from_indices(8, [local(2), local(6)]).freeze();

        let mut out = BitMask::new(8);
        out.insert(local(1));
        out.union_with(&source);

        let out = out.freeze();
        let collected = out.iter().map(LocalArgIndex::index).collect::<Vec<_>>();

        assert_eq!(collected, vec![1, 2, 6]);
    }

    #[test]
    fn empty_creates_frozen_empty_mask() {
        let frozen = FrozenBitMask::empty(32);
        assert_eq!(frozen.len(), 32);
        assert!(frozen.is_empty());
    }
}
