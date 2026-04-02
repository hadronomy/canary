#![allow(unused)]
//! Mutable parser state.
//!
//! This module contains internal state used while matching normalized tokens
//! against a compiled command view.

use crate::bitmask::BitMask;
use crate::ids::{ArgId, LocalArgIndex};
use crate::parse::model::{ArgMatch, Occurrence, Span, ValueOccurrence};
use crate::schema::CommandRef;

#[derive(Debug, Default)]
pub(crate) struct MatchBuilder {
    pub(crate) occurrences: Vec<Occurrence>,
}

impl MatchBuilder {
    pub(crate) fn push_flag(&mut self, span: Span) {
        self.occurrences.push(Occurrence { span, values: Box::new([]) });
    }

    pub(crate) fn push_value(&mut self, span: Span, value: ValueOccurrence) {
        self.occurrences.push(Occurrence { span, values: vec![value].into_boxed_slice() });
    }

    pub(crate) fn freeze(self, arg: ArgId, local: LocalArgIndex) -> ArgMatch {
        ArgMatch { arg, local, occurrences: self.occurrences.into_boxed_slice() }
    }
}

#[derive(Debug)]
pub(crate) struct CommandState {
    pub(crate) seen: BitMask,
    pub(crate) matches: Vec<Option<MatchBuilder>>,
}

impl CommandState {
    pub(crate) fn new(command: CommandRef<'_>) -> Self {
        let len = command.arg_count();
        Self { seen: BitMask::new(len), matches: (0..len).map(|_| None).collect() }
    }

    pub(crate) fn mark_seen(&mut self, local: LocalArgIndex) {
        self.seen.insert(local);
    }

    pub(crate) fn is_seen(&self, local: LocalArgIndex) -> bool {
        let frozen = self.seen.clone().freeze();
        frozen.contains(local)
    }

    pub(crate) fn match_builder(&mut self, local: LocalArgIndex) -> &mut MatchBuilder {
        self.matches[local.index()].get_or_insert_with(MatchBuilder::default)
    }

    pub(crate) fn freeze(self, command: CommandRef<'_>) -> Box<[ArgMatch]> {
        self.matches
            .into_iter()
            .enumerate()
            .filter_map(|(index, builder)| {
                let local = LocalArgIndex::from_index(index);
                let (_, arg, _) = command
                    .local_args()
                    .find(|(slot, _, _)| *slot == local)
                    .expect("every local slot must correspond to an effective arg");

                builder.map(|builder| builder.freeze(arg.id(), local))
            })
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }
}
