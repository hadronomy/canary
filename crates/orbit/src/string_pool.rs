#![allow(unused)]
//! Internal UTF-8 string interning for compiled schema metadata.
//!
//! This module provides two closely related types:
//!
//! - [`StringInterner`]: a mutable build-time interner
//! - [`StringPool`]: a frozen runtime string table
//!
//! The overall flow is:
//!
//! 1. builder/compiler code interns repeated UTF-8 strings into
//!    [`StringInterner`]
//! 2. the compiler freezes the interner into a [`StringPool`]
//! 3. compiled schema data stores compact [`crate::ids::Symbol`] values
//! 4. runtime code resolves symbols through the frozen pool
//!
//! # Why intern strings?
//!
//! CLI schemas tend to repeat the same strings in many places:
//!
//! - command names
//! - long option names
//! - aliases
//! - help headings
//! - help text
//! - environment variable names
//!
//! Interning keeps the compiled schema compact and makes the internal
//! representation more stable and easier to reason about.
//!
//! # What should be interned?
//!
//! Good candidates:
//!
//! - canonical metadata strings
//! - help/doc text
//! - display labels
//!
//! Poor candidates:
//!
//! - raw argv values
//! - per-parse transient data
//!
//! Raw values belong elsewhere in the parsing pipeline and should generally
//! remain OS-native rather than being interned as UTF-8 strings.
//!
//! # Stability
//!
//! Symbols are assigned in insertion order, so the interner is deterministic as
//! long as the compiler visits inputs deterministically.
//!
//! # Typical usage
//!
//! ```rust,ignore
//! let mut interner = StringInterner::new();
//!
//! let name = interner.intern("build");
//! let about = interner.intern("Compile the project");
//! let alias = interner.intern("b");
//!
//! assert_eq!(interner.get(name), "build");
//! assert_eq!(interner.get(about), "Compile the project");
//! assert_eq!(interner.get(alias), "b");
//!
//! let pool = interner.freeze();
//! assert_eq!(pool.get(name), "build");
//! ```
//!
//! # Design note
//!
//! This is intentionally a small private implementation rather than a heavy
//! external interner dependency. It keeps the schema core straightforward and
//! easy to evolve.

use std::collections::HashMap;

use crate::ids::Symbol;

/// Frozen pool of interned UTF-8 strings.
///
/// `StringPool` is the runtime form used by the compiled schema. Strings are
/// stored densely and referenced by [`Symbol`].
///
/// This type is immutable after construction.
///
/// # Examples
///
/// ```rust,ignore
/// let mut interner = StringInterner::new();
/// let sym = interner.intern("verbose");
/// let pool = interner.freeze();
///
/// assert_eq!(pool.get(sym), "verbose");
/// ```
#[derive(Clone, Debug)]
pub(crate) struct StringPool {
    items: Box<[Box<str>]>,
}

impl StringPool {
    /// Return the string for `symbol`.
    ///
    /// # Panics
    ///
    /// Panics if `symbol` does not belong to this pool.
    ///
    /// In normal crate usage this should not happen, because symbols are created
    /// by the matching interner and then stored in compiled schema data.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let text = pool.get(symbol);
    /// ```
    #[inline]
    pub(crate) fn get(&self, symbol: Symbol) -> &str {
        &self.items[symbol.index()]
    }

    /// Try to resolve a symbol to a string.
    ///
    /// This is mainly useful for defensive code and tests. Most internal call
    /// sites should prefer [`get`](Self::get), since symbols are expected to be
    /// valid by construction.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(text) = pool.try_get(symbol) {
    ///     // use text
    /// }
    /// ```
    #[inline]
    pub(crate) fn try_get(&self, symbol: Symbol) -> Option<&str> {
        self.items.get(symbol.index()).map(Box::as_ref)
    }

    /// Return the number of interned strings in the pool.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// assert_eq!(pool.len(), 3);
    /// ```
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.items.len()
    }

    /// Return `true` if the pool contains no strings.
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Iterate over all `(Symbol, &str)` pairs in insertion order.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// for (sym, text) in pool.iter() {
    ///     eprintln!("{sym:?} => {text}");
    /// }
    /// ```
    #[inline]
    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = (Symbol, &str)> + '_ {
        self.items
            .iter()
            .enumerate()
            .map(|(index, item)| (Symbol::from_index(index), item.as_ref()))
    }
}

/// Mutable build-time string interner.
///
/// `StringInterner` assigns stable dense [`Symbol`] handles to UTF-8 strings.
/// Interning the same string multiple times returns the same symbol.
///
/// Symbols are assigned in insertion order.
///
/// # Examples
///
/// ```rust,ignore
/// let mut interner = StringInterner::new();
///
/// let a = interner.intern("build");
/// let b = interner.intern("test");
/// let a2 = interner.intern("build");
///
/// assert_eq!(a, a2);
/// assert_ne!(a, b);
/// assert_eq!(interner.get(a), "build");
/// ```
#[derive(Debug, Default)]
pub(crate) struct StringInterner {
    map: HashMap<Box<str>, Symbol>,
    items: Vec<Box<str>>,
}

impl StringInterner {
    /// Create an empty interner.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let interner = StringInterner::new();
    /// assert!(interner.is_empty());
    /// ```
    #[must_use]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Intern `value` and return its stable symbol.
    ///
    /// If the same string has already been interned, the existing symbol is
    /// returned.
    ///
    /// Symbols are assigned in insertion order the first time a string appears.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let verbose = interner.intern("verbose");
    /// let verbose_again = interner.intern("verbose");
    /// assert_eq!(verbose, verbose_again);
    /// ```
    pub(crate) fn intern(&mut self, value: impl AsRef<str>) -> Symbol {
        let value = value.as_ref();

        if let Some(&existing) = self.map.get(value) {
            return existing;
        }

        let owned: Box<str> = value.into();
        let symbol = Symbol::from_index(self.items.len());

        self.map.insert(owned.clone(), symbol);
        self.items.push(owned);

        symbol
    }

    /// Resolve a previously interned string to its symbol.
    ///
    /// Returns `None` if the string is not present.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let sym = interner.intern("release");
    /// assert_eq!(interner.resolve("release"), Some(sym));
    /// assert_eq!(interner.resolve("debug"), None);
    /// ```
    #[inline]
    pub(crate) fn resolve(&self, value: &str) -> Option<Symbol> {
        self.map.get(value).copied()
    }

    /// Return the string for `symbol`.
    ///
    /// # Panics
    ///
    /// Panics if `symbol` does not belong to this interner.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let sym = interner.intern("build");
    /// assert_eq!(interner.get(sym), "build");
    /// ```
    #[inline]
    pub(crate) fn get(&self, symbol: Symbol) -> &str {
        &self.items[symbol.index()]
    }

    /// Try to resolve a symbol to a string.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(text) = interner.try_get(symbol) {
    ///     // use text
    /// }
    /// ```
    #[inline]
    pub(crate) fn try_get(&self, symbol: Symbol) -> Option<&str> {
        self.items.get(symbol.index()).map(Box::as_ref)
    }

    /// Return the number of distinct interned strings.
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.items.len()
    }

    /// Return `true` if the interner contains no strings.
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Iterate over all `(Symbol, &str)` pairs in insertion order.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// for (sym, text) in interner.iter() {
    ///     eprintln!("{sym:?} => {text}");
    /// }
    /// ```
    #[inline]
    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = (Symbol, &str)> + '_ {
        self.items
            .iter()
            .enumerate()
            .map(|(index, item)| (Symbol::from_index(index), item.as_ref()))
    }

    /// Freeze this interner into an immutable runtime [`StringPool`].
    ///
    /// The returned pool preserves the same symbol-to-string mapping.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let mut interner = StringInterner::new();
    /// let sym = interner.intern("verbose");
    ///
    /// let pool = interner.freeze();
    /// assert_eq!(pool.get(sym), "verbose");
    /// ```
    #[must_use]
    pub(crate) fn freeze(self) -> StringPool {
        StringPool { items: self.items.into_boxed_slice() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interning_same_string_returns_same_symbol() {
        let mut interner = StringInterner::new();

        let a = interner.intern("build");
        let b = interner.intern("build");

        assert_eq!(a, b);
        assert_eq!(interner.len(), 1);
    }

    #[test]
    fn interning_distinct_strings_returns_distinct_symbols() {
        let mut interner = StringInterner::new();

        let a = interner.intern("build");
        let b = interner.intern("test");
        let c = interner.intern("release");

        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
        assert_eq!(interner.len(), 3);
    }

    #[test]
    fn symbols_are_assigned_in_insertion_order() {
        let mut interner = StringInterner::new();

        let first = interner.intern("alpha");
        let second = interner.intern("beta");
        let third = interner.intern("gamma");

        assert_eq!(first.index(), 0);
        assert_eq!(second.index(), 1);
        assert_eq!(third.index(), 2);
    }

    #[test]
    fn resolve_finds_existing_strings() {
        let mut interner = StringInterner::new();

        let sym = interner.intern("verbose");
        assert_eq!(interner.resolve("verbose"), Some(sym));
        assert_eq!(interner.resolve("quiet"), None);
    }

    #[test]
    fn get_round_trips_symbol_to_string() {
        let mut interner = StringInterner::new();

        let sym = interner.intern("release");
        assert_eq!(interner.get(sym), "release");
        assert_eq!(interner.try_get(sym), Some("release"));
    }

    #[test]
    fn freeze_preserves_symbol_mapping() {
        let mut interner = StringInterner::new();

        let build = interner.intern("build");
        let test = interner.intern("test");
        let about = interner.intern("Compile the project");

        let pool = interner.freeze();

        assert_eq!(pool.get(build), "build");
        assert_eq!(pool.get(test), "test");
        assert_eq!(pool.get(about), "Compile the project");
        assert_eq!(pool.len(), 3);
    }

    #[test]
    fn iter_preserves_insertion_order() {
        let mut interner = StringInterner::new();

        interner.intern("alpha");
        interner.intern("beta");
        interner.intern("gamma");

        let entries = interner.iter().map(|(sym, text)| (sym.index(), text)).collect::<Vec<_>>();

        assert_eq!(entries, vec![(0, "alpha"), (1, "beta"), (2, "gamma")]);
    }

    #[test]
    fn frozen_iter_preserves_insertion_order() {
        let mut interner = StringInterner::new();

        interner.intern("one");
        interner.intern("two");
        interner.intern("three");

        let pool = interner.freeze();

        let entries = pool.iter().map(|(sym, text)| (sym.index(), text)).collect::<Vec<_>>();

        assert_eq!(entries, vec![(0, "one"), (1, "two"), (2, "three")]);
    }

    #[test]
    fn empty_interner_and_pool_report_empty_state() {
        let interner = StringInterner::new();
        assert!(interner.is_empty());

        let pool = interner.freeze();
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
    }
}
