//! Parse-time validation over command-local match state.

use std::fs;
use std::path::Path;

use crate::builder::Validator;
use crate::parse::error::ParseFailure;
use crate::parse::model::{Span, SpanPart, ValueStoreBuilder};
use crate::parse::state::CommandState;
use crate::schema::CommandRef;

pub(crate) fn validate_command(
    command: CommandRef<'_>,
    state: &CommandState,
    values: &ValueStoreBuilder,
    command_span: Option<Span>,
) -> Result<(), ParseFailure> {
    validate_required(command, state, command_span)?;
    validate_groups(command, state, command_span)?;
    validate_conflicts(command, state, command_span)?;
    validate_requires(command, state)?;
    validate_arity(command, state, command_span)?;
    validate_values(command, state, values)?;
    Ok(())
}

fn validate_arity(
    command: CommandRef<'_>,
    state: &CommandState,
    command_span: Option<Span>,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) {
            continue;
        }

        let Some(spec) = arg.value_spec() else {
            continue;
        };

        let Some(builder) =
            state.matches[local.index()].as_ref().filter(|builder| !builder.occurrences.is_empty())
        else {
            // If occurrences is empty, the parser already emitted a MissingValue
            // error.
            continue;
        };

        let total_values = builder.occurrences.iter().map(|occ| occ.values.len()).sum::<usize>();

        let min = spec.arity().min();
        let max = spec.arity().max();

        if let Some(max_values) = max.map(|m| m as usize)
            && total_values > max_values
        {
            let mut seen = 0usize;
            let mut offending_span = None;

            'occurrences: for occ in &builder.occurrences {
                if occ.values.is_empty() {
                    seen += 1;
                    if seen > max_values {
                        offending_span = Some(occ.span);
                        break;
                    }
                    continue;
                }

                for value in occ.values.iter() {
                    seen += 1;
                    if seen > max_values {
                        // Span dynamically grows from the flag to the
                        // offending value.
                        offending_span = Some(Span {
                            arg_index: occ.span.arg_index,
                            part: SpanPart::ArgRange { end_index: value.span.arg_index },
                        });
                        break 'occurrences;
                    }
                }
            }

            return Err(ParseFailure::ArityMismatch {
                arg: arg.id(),
                span: offending_span.or(command_span),
                found: total_values,
                min,
                max,
            });
        }

        if total_values < min as usize {
            return Err(ParseFailure::ArityMismatch {
                arg: arg.id(),
                span: builder.occurrences.first().map(|occ| occ.span).or(command_span),
                found: total_values,
                min,
                max,
            });
        }
    }

    Ok(())
}

fn validate_values(
    command: CommandRef<'_>,
    state: &CommandState,
    values: &ValueStoreBuilder,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) || !arg.takes_value() {
            continue;
        }

        let Some(builder) = state.matches[local.index()].as_ref() else {
            continue;
        };

        for occ in &builder.occurrences {
            for value in occ.values.iter() {
                let raw = values.get(value.value);

                for validator in arg.validators() {
                    apply_builtin_validator(validator, raw).map_err(|message| {
                        ParseFailure::ValidationError {
                            arg: arg.id(),
                            span: value.span,
                            message: message.into_boxed_str(),
                        }
                    })?;
                }

                for validator in arg.custom_validators() {
                    validator.validate(raw).map_err(|err| ParseFailure::ValidationError {
                        arg: arg.id(),
                        span: value.span,
                        message: err.message().into(),
                    })?;
                }
            }
        }
    }

    Ok(())
}

fn apply_builtin_validator(
    validator: &Validator,
    value: &crate::parse::RawValue,
) -> Result<(), String> {
    let path = Path::new(value.as_os_str());

    match validator {
        Validator::Exists => path_metadata(path).map(|_| ()),
        Validator::File => {
            let metadata = path_metadata(path)?;
            if metadata.is_file() { Ok(()) } else { Err("path is not a file".to_string()) }
        }
        Validator::Directory => {
            let metadata = path_metadata(path)?;
            if metadata.is_dir() { Ok(()) } else { Err("path is not a directory".to_string()) }
        }
    }
}

fn path_metadata(path: &Path) -> Result<fs::Metadata, String> {
    fs::metadata(path).map_err(|_| "path does not exist".to_string())
}

fn validate_groups(
    command: CommandRef<'_>,
    state: &CommandState,
    span: Option<Span>,
) -> Result<(), ParseFailure> {
    for group in command.groups() {
        if !group.required() {
            continue;
        }

        let has_member = group.members().any(|member| {
            command.local_arg_by_id(member.id()).is_some_and(|local| state.is_seen(local))
        });

        if !has_member {
            return Err(ParseFailure::MissingGroup { group: group.id(), span });
        }
    }

    Ok(())
}

fn validate_required(
    command: CommandRef<'_>,
    state: &CommandState,
    span: Option<Span>,
) -> Result<(), ParseFailure> {
    for local in command.required_mask().iter() {
        if !state.is_seen(local) {
            let arg = command.local_arg_entry(local).arg;
            return Err(ParseFailure::MissingRequired { arg, span });
        }
    }

    Ok(())
}

fn validate_conflicts(
    command: CommandRef<'_>,
    state: &CommandState,
    command_span: Option<Span>,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) {
            continue;
        }

        let entry = command.local_arg_entry(local);
        let Some(other) =
            entry.conflicts.iter().find(|&other| other != local && state.is_seen(other))
        else {
            continue;
        };

        let span = state.matches[local.index()]
            .as_ref()
            .and_then(|m| m.occurrences.first())
            .map(|occ| occ.span)
            .or(command_span);

        return Err(ParseFailure::Conflict {
            left: arg.id(),
            right: command.local_arg_entry(other).arg,
            span,
        });
    }

    Ok(())
}

fn validate_requires(command: CommandRef<'_>, state: &CommandState) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) {
            continue;
        }

        let entry = command.local_arg_entry(local);
        for required in entry.requires.iter() {
            if !state.is_seen(required) {
                return Err(ParseFailure::Requires {
                    arg: arg.id(),
                    required: command.local_arg_entry(required).arg,
                });
            }
        }
    }

    Ok(())
}
