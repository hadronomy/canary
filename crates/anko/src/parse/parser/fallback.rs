//! Environment and default fallback application.
//!
//! Fallbacks are applied only after explicit argv parsing for a command has
//! completed and only for local arguments that were not already seen.

use super::occurrence::{MatchedValue, bind_value};
use super::{Parser, synthetic_span};
use crate::builder::ArgActionKind;
use crate::ids::LocalArgIndex;
use crate::parse::model::{RawValue, SpanPart};
use crate::parse::state::CommandState;
use crate::schema::{ArgRef, CommandRef, DefaultValueRef};

impl<'a, E, S> Parser<'a, E, S>
where
    E: super::env::EnvProvider,
    S: super::suggest::SuggestionProvider,
{
    /// Apply all configured fallback sources for unseen local arguments.
    pub(super) fn apply_fallbacks(&mut self, cmd: CommandRef<'a>, state: &mut CommandState) {
        for (local, arg, _) in cmd.local_args() {
            if state.is_seen(local) {
                continue;
            }

            if self.apply_env_fallback(arg, local, state) {
                continue;
            }

            self.apply_default_fallback(arg, local, state);
        }
    }

    /// Apply an environment fallback for an unseen argument.
    ///
    /// Returns `true` if the environment produced a value or flag occurrence.
    fn apply_env_fallback(
        &mut self,
        arg: ArgRef<'a>,
        local: LocalArgIndex,
        state: &mut CommandState,
    ) -> bool {
        let Some(env_name) = arg.env() else {
            return false;
        };

        let Some(value) = self.env.var_os(env_name) else {
            return false;
        };

        let env_span = synthetic_span(SpanPart::Environment);

        if !arg.takes_value() {
            let text = value.to_string_lossy();

            if text.is_empty() || text == "0" || text.eq_ignore_ascii_case("false") {
                return false;
            }

            if arg.action() == ArgActionKind::Count
                && let Ok(count) = text.parse::<usize>()
            {
                state.mark_seen(local);
                for _ in 0..count {
                    state.match_builder(local).push_flag(env_span);
                }
                return true;
            }
        }

        state.mark_seen(local);

        if arg.takes_value() {
            let value_id = self.values.push(RawValue::from(value));
            bind_value(state, local, env_span, MatchedValue::environment(value_id, env_span));
        } else {
            state.match_builder(local).push_flag(env_span);
        }

        true
    }

    /// Apply a configured default fallback for an unseen argument.
    fn apply_default_fallback(
        &mut self,
        arg: ArgRef<'a>,
        local: LocalArgIndex,
        state: &mut CommandState,
    ) {
        let Some(spec) = arg.value_spec() else {
            return;
        };

        let Some(DefaultValueRef::String(default)) = spec.default() else {
            return;
        };

        let default_span = synthetic_span(SpanPart::Default);
        let value_id = self.values.push(RawValue::from(default));

        state.mark_seen(local);
        bind_value(state, local, default_span, MatchedValue::default(value_id, default_span));
    }
}
