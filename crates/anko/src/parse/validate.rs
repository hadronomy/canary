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
        if !state.is_seen(local) {
            continue;
        }

        if let Some(spec) = arg.value_spec() {
            let builder = match &state.matches[local.index()] {
                // If occurrences is empty, the parser already emitted a MissingValue error!
                Some(b) if !b.occurrences.is_empty() => b,
                _ => continue,
            };

            let total_values: usize = builder.occurrences.iter().map(|o| o.values.len()).sum();

            let min = spec.arity().min();
            let max = spec.arity().max();

            if let Some(m) = max
                && total_values > m as usize
            {
                let mut current_count = 0;
                let mut offending_span = None;

                for occ in &builder.occurrences {
                    if occ.values.is_empty() {
                        current_count += 1;
                        if current_count > m as usize {
                            offending_span = Some(occ.span);
                            break;
                        }
                    } else {
                        for val in &*occ.values {
                            current_count += 1;
                            if current_count > m as usize {
                                // Spans dynamically from the flag to the offending value!
                                offending_span = Some(crate::parse::model::Span {
                                    arg_index: occ.span.arg_index,
                                    part: crate::parse::model::SpanPart::ArgRange {
                                        end_index: val.span.arg_index,
                                    },
                                });
                                break;
                            }
                        }
                    }
                    if offending_span.is_some() {
                        break;
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
                // If there are too few, point to the first occurrence that started the chain
                let span = builder.occurrences.first().map(|o| o.span).or(command_span);
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
