//! Parse-time validation over command-local match state.

use crate::ids::LocalArgIndex;
use crate::parse::error::ParseFailure;
use crate::parse::state::CommandState;
use crate::schema::CommandRef;

pub(crate) fn validate_command(
    command: CommandRef<'_>,
    state: &CommandState,
) -> Result<(), ParseFailure> {
    validate_required(command, state)?;
    validate_conflicts(command, state)?;
    validate_requires(command, state)?;
    Ok(())
}

fn validate_required(command: CommandRef<'_>, state: &CommandState) -> Result<(), ParseFailure> {
    for local in command.required_mask().iter() {
        if !state.is_seen(local) {
            let arg = command.local_arg_entry(local).arg;
            return Err(ParseFailure::MissingRequired { arg });
        }
    }

    Ok(())
}

fn validate_conflicts(command: CommandRef<'_>, state: &CommandState) -> Result<(), ParseFailure> {
    for (local, arg, _) in command.local_args() {
        if !state.is_seen(local) {
            continue;
        }

        let entry = command.local_arg_entry(local);
        if !state.seen.clone().freeze().intersects(&entry.conflicts) {
            continue;
        }
        if let Some(other) = first_set_other_than(&entry.conflicts, local) {
            let left = arg.id();
            let right = command.local_arg_entry(other).arg;
            return Err(ParseFailure::Conflict { left, right });
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

fn first_set_other_than(
    mask: &crate::bitmask::FrozenBitMask,
    local: LocalArgIndex,
) -> Option<LocalArgIndex> {
    mask.iter().find(|other| *other != local)
}
