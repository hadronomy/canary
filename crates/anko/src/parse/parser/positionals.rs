//! Positional argument dispatch.
//!
//! Positional consumption is monotonic during parsing: once a positional has
//! reached capacity, it will never become available again. This module keeps a
//! tiny hot-path cache so the parser does not need to rescan all local args for
//! every bare value token.

use crate::builder::ArgKind;
use crate::ids::LocalArgIndex;
use crate::schema::{ArgRef, CommandRef};

/// Runtime value capacity of a positional argument.
#[derive(Clone, Copy)]
enum PositionalCapacity {
    /// Accept exactly one value.
    Single,
    /// Accept up to `max` values.
    Bounded(usize),
    /// Accept arbitrarily many values.
    Unbounded,
}

impl PositionalCapacity {
    /// Return whether the positional can accept another value after
    /// `seen_values` values have already been bound.
    fn can_accept_value(self, seen_values: usize) -> bool {
        match self {
            Self::Single => seen_values == 0,
            Self::Bounded(max) => seen_values < max,
            Self::Unbounded => true,
        }
    }
}

/// One positional slot in the dispatch table.
struct PositionalEntry {
    local: LocalArgIndex,
    capacity: PositionalCapacity,
    seen_values: usize,
}

/// Lightweight positional dispatch cache.
pub(super) struct Positionals {
    entries: Vec<PositionalEntry>,
    cursor: usize,
}

impl Positionals {
    /// Build the positional dispatch table for one command.
    pub(super) fn new(command: CommandRef<'_>) -> Self {
        let entries = command
            .local_args()
            .filter(|&(_local, arg, _)| arg.kind() == ArgKind::Positional)
            .map(|(local, arg, _)| PositionalEntry {
                local,
                capacity: positional_capacity(arg),
                seen_values: 0,
            })
            .collect();

        Self { entries, cursor: 0 }
    }

    /// Return the local slot that should receive the next positional value.
    pub(super) fn next_local(&mut self) -> Option<LocalArgIndex> {
        while let Some(entry) = self.entries.get(self.cursor) {
            if entry.capacity.can_accept_value(entry.seen_values) {
                return Some(entry.local);
            }

            self.cursor += 1;
        }

        None
    }

    /// Record one consumed positional value.
    pub(super) fn record_value(&mut self, local: LocalArgIndex) {
        let Some(entry) = self.entries.get_mut(self.cursor) else {
            return;
        };

        debug_assert_eq!(entry.local, local);
        entry.seen_values += 1;

        if !entry.capacity.can_accept_value(entry.seen_values) {
            self.cursor += 1;
        }
    }
}

/// Compute the runtime capacity for a positional argument from its value spec.
fn positional_capacity(arg: ArgRef<'_>) -> PositionalCapacity {
    match arg.value_spec() {
        None => PositionalCapacity::Single,
        Some(spec) => match spec.arity().max() {
            None => PositionalCapacity::Unbounded,
            Some(1) => PositionalCapacity::Single,
            Some(max) => PositionalCapacity::Bounded(usize::from(max)),
        },
    }
}
