//! Parse-time validation over command-local match state.

use std::path::Path;

use crate::builder::Validator;
use crate::parse::error::ParseFailure;
use crate::parse::state::CommandState;
use crate::schema::CommandRef;

pub(crate) fn validate_command(
    command: CommandRef<'_>,
    state: &CommandState,
    values: &crate::parse::model::ValueStoreBuilder,
    command_span: Option<crate::parse::model::Span>,
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
    command_span: Option<crate::parse::model::Span>,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        // Arity only applies if the user ACTUALLY provided the argument!
        if !state.is_seen(local) {
            continue;
        }

        if let Some(spec) = arg.value_spec() {
            let total_values: usize = state.matches[local.index()]
                .as_ref()
                .map(|m| m.occurrences.iter().map(|o| o.values.len()).sum())
                .unwrap_or(0);

            let min = spec.arity().min();
            let max = spec.arity().max();

            if total_values < min as usize || max.is_some_and(|m| total_values > m as usize) {
                let span = state.matches[local.index()]
                    .as_ref()
                    .and_then(|m| m.occurrences.first().map(|o| o.span))
                    .or(command_span);

                return Err(ParseFailure::ArityMismatch {
                    arg: arg.id(),
                    span,
                    found: total_values,
                    min,
                    max,
                });
            }
        }
    }
    Ok(())
}

fn validate_values(
    command: CommandRef<'_>,
    state: &CommandState,
    values: &crate::parse::model::ValueStoreBuilder,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) || !arg.takes_value() {
            continue;
        }

        if let Some(builder) = &state.matches[local.index()] {
            for occ in &builder.occurrences {
                for val in &*occ.values {
                    let raw = values.get(val.value);

                    for validator in arg.validators() {
                        apply_builtin_validator(validator, raw).map_err(|msg| {
                            ParseFailure::ValidationError {
                                arg: arg.id(),
                                span: val.span,
                                message: msg.into_boxed_str(),
                            }
                        })?;
                    }

                    for validator in arg.custom_validators() {
                        validator.validate(raw).map_err(|err| ParseFailure::ValidationError {
                            arg: arg.id(),
                            span: val.span,
                            message: err.message().into(),
                        })?;
                    }
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
    match validator {
        Validator::Exists => {
            let path = Path::new(value.as_os_str());
            if !path.exists() {
                return Err("path does not exist".to_string());
            }
        }
        Validator::File => {
            let path = Path::new(value.as_os_str());
            if !path.exists() {
                return Err("path does not exist".to_string());
            }
            if !path.is_file() {
                return Err("path is not a file".to_string());
            }
        }
        Validator::Directory => {
            let path = Path::new(value.as_os_str());
            if !path.exists() {
                return Err("path does not exist".to_string());
            }
            if !path.is_dir() {
                return Err("path is not a directory".to_string());
            }
        }
    }
    Ok(())
}

fn validate_groups(
    command: CommandRef<'_>,
    state: &CommandState,
    span: Option<crate::parse::model::Span>,
) -> Result<(), ParseFailure> {
    for group in command.groups() {
        if group.required() {
            let mut has_member = false;
            for arg in group.members() {
                if let Some(local) = command.local_arg_by_id(arg.id())
                    && state.is_seen(local)
                {
                    has_member = true;
                    break;
                }
            }

            if !has_member {
                return Err(ParseFailure::MissingGroup { group: group.id(), span });
            }
        }
    }
    Ok(())
}

fn validate_required(
    command: CommandRef<'_>,
    state: &CommandState,
    span: Option<crate::parse::model::Span>,
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
    command_span: Option<crate::parse::model::Span>,
) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) {
            continue;
        }

        let entry = command.local_arg_entry(local);

        if let Some(other) =
            entry.conflicts.iter().find(|&other| other != local && state.is_seen(other))
        {
            let left = arg.id();
            let right = command.local_arg_entry(other).arg;

            let span = state.matches[local.index()]
                .as_ref()
                .and_then(|m| m.occurrences.first().map(|o| o.span))
                .or(command_span);

            return Err(ParseFailure::Conflict { left, right, span });
        }
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
