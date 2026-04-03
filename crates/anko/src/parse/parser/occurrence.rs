//! Small typed helpers for constructing value occurrences.
//!
//! The parser frequently needs to create [`ValueOccurrence`] values with a
//! consistent origin and span. This module centralizes that logic so the parse
//! loop, fallback injection, and positional handling can stay compact.

use crate::ids::LocalArgIndex;
use crate::parse::model::{Span, SpanPart, ValueId, ValueOccurrence, ValueOrigin};
use crate::parse::state::CommandState;

/// A parser-internal description of one matched value.
///
/// This type intentionally mirrors the fields needed to build a
/// [`ValueOccurrence`] while offering named constructors for the common origins
/// used throughout parsing.
#[derive(Clone, Copy, Debug)]
pub(super) struct MatchedValue {
    value: ValueId,
    span: Span,
    origin: ValueOrigin,
}

impl MatchedValue {
    /// Create a positional occurrence.
    #[must_use]
    pub(super) fn positional(value: ValueId, span: Span) -> Self {
        Self { value, span, origin: ValueOrigin::Positional }
    }

    /// Create an environment fallback occurrence.
    #[must_use]
    pub(super) fn environment(value: ValueId, span: Span) -> Self {
        Self { value, span, origin: ValueOrigin::Environment }
    }

    /// Create a default fallback occurrence.
    #[must_use]
    pub(super) fn default(value: ValueId, span: Span) -> Self {
        Self { value, span, origin: ValueOrigin::Default }
    }

    /// Create an option-derived occurrence.
    ///
    /// The value origin is derived from the value span:
    ///
    /// - attached to a long option => `AttachedLong`
    /// - attached to a short option => `AttachedShort`
    /// - otherwise => `Separate`
    #[must_use]
    pub(super) fn option(value: ValueId, option_span: Span, value_span: Span) -> Self {
        let origin = match value_span.part {
            SpanPart::AttachedValue if matches!(option_span.part, SpanPart::LongName) => {
                ValueOrigin::AttachedLong
            }
            SpanPart::AttachedValue => ValueOrigin::AttachedShort,
            _ => ValueOrigin::Separate,
        };

        Self { value, span: value_span, origin }
    }
}

impl From<MatchedValue> for ValueOccurrence {
    fn from(value: MatchedValue) -> Self {
        Self { value: value.value, span: value.span, origin: value.origin }
    }
}

/// Bind one value occurrence into command state.
pub(super) fn bind_value(
    state: &mut CommandState,
    local: LocalArgIndex,
    occurrence_span: Span,
    value: MatchedValue,
) {
    state.match_builder(local).push_value(occurrence_span, value.into());
}
