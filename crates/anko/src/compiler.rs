//! Lowering and validation from authoring builders into frozen compiled schema.
//!
//! This module is the bridge between:
//!
//! - mutable authoring-time builders in [`crate::builder`]
//! - immutable runtime schema in [`crate::schema`]
//!
//! The compilation pipeline is roughly:
//!
//! 1. validate direct authoring-time invariants
//! 2. intern strings and assign dense IDs
//! 3. lower canonical command, arg, group, and value-spec records
//! 4. build effective per-command views
//! 5. construct lookup tables and help ordering
//! 6. pack variable-length data into contiguous arrays
//! 7. freeze into a [`crate::schema::CompiledSchema`]
//!
//! This module is intentionally internal.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::bitmask::{BitMask, FrozenBitMask};
use crate::builder::{
    ArgActionKind, ArgDecl, ArgKind, CommandBuilder, DefaultValue, GroupBuilder, GroupRelation,
    HelpMeta, ParserKind, Validator, ValueSpecBuilder, Visibility,
};
use crate::error::{BuildError, BuildErrorKind};
use crate::ids::{ArgId, CommandId, GroupId, LocalArgIndex, Symbol, ValueSpecId};
use crate::schema::{
    ArgLocalLookup, Command, CommandArg, CommandLookup, CompiledArg, CompiledArgAlias,
    CompiledCommand, CompiledDefaultValue, CompiledGroup, CompiledHelpMeta, CompiledPossibleValue,
    CompiledSchema, CompiledValueSpec, CompiledVisibility, HelpItem, LongLookup, ShortLookup,
    SliceRange, SubcommandLookup,
};
use crate::string_pool::StringInterner;

const SYNTHETIC_HELP_ID: &str = "__help";
const SYNTHETIC_HELP_LONG: &str = "help";
const SYNTHETIC_HELP_SHORT: char = 'h';
const SYNTHETIC_HELP_TEXT: &str = "Print help information";

/// Compile a command builder into an immutable runtime [`Command`].
pub(crate) fn compile_command(builder: CommandBuilder) -> Result<Command, BuildError> {
    let mut cx = CompileCx::default();
    let root_path = builder.name().to_owned();
    let root = cx.lower_command(None, &builder, &root_path)?;
    cx.build_effective_views()?;

    Ok(Command { schema: Arc::new(cx.freeze()), root })
}

#[derive(Debug, Default)]
struct CompileCx {
    strings: StringInterner,
    commands: Vec<PendingCommand>,
    args: Vec<PendingArg>,
    groups: Vec<PendingGroup>,
    value_specs: Vec<PendingValueSpec>,
}

#[derive(Debug)]
struct PendingCommand {
    parent: Option<CommandId>,
    name: Symbol,
    about: Option<Symbol>,
    long_about: Option<Symbol>,
    aliases: Vec<Symbol>,
    subcommands: Vec<CommandId>,
    declared_args: Vec<ArgId>,
    declared_groups: Vec<GroupId>,
    help_arg: ArgId,
    compiled: Option<PendingCompiledCommand>,
}

#[derive(Debug)]
struct PendingCompiledCommand {
    parent: Option<CommandId>,
    name: Symbol,
    about: Option<Symbol>,
    long_about: Option<Symbol>,
    aliases: Vec<Symbol>,
    subcommands: Vec<CommandId>,
    groups: Vec<GroupId>,
    args: Vec<PendingCommandArg>,
    positionals: Vec<LocalArgIndex>,
    local_by_arg: Vec<ArgLocalLookup>,
    lookup: PendingCommandLookup,
    required_mask: FrozenBitMask,
    visible_items: Vec<HelpItem>,
}

#[derive(Debug)]
struct PendingCommandArg {
    arg: ArgId,
    local: LocalArgIndex,
    inherited: bool,
    conflicts: FrozenBitMask,
    requires: FrozenBitMask,
    groups: Vec<GroupId>,
}

#[derive(Debug)]
struct PendingCommandLookup {
    longs: Vec<LongLookup>,
    shorts: Vec<ShortLookup>,
    subcommands: Vec<SubcommandLookup>,
}

#[derive(Debug)]
struct PendingArg {
    declared_on: CommandId,
    id: Symbol,
    kind: ArgKind,
    declared_global: bool,
    short: Option<char>,
    long: Option<Symbol>,
    aliases: Vec<CompiledArgAlias>,
    action: ArgActionKind,
    value: Option<ValueSpecId>,
    env: Option<Symbol>,
    help: CompiledHelpMeta,
    visibility: CompiledVisibility,
    position: Option<u16>,
    required: bool,
    requires: Box<[Box<str>]>,
    conflicts: Box<[Box<str>]>,
    groups: Box<[Box<str>]>,
}

#[derive(Debug)]
struct PendingGroup {
    declared_on: CommandId,
    id: Symbol,
    members: Vec<ArgId>,
    required: bool,
    multiple: bool,
    relation: GroupRelation,
    help: Option<Symbol>,
}

#[derive(Debug)]
struct PendingValueSpec {
    parser: ParserKind,
    arity: crate::builder::Arity,
    hint: crate::builder::ValueHint,
    possible_values: Vec<CompiledPossibleValue>,
    default: Option<CompiledDefaultValue>,
    expected: &'static str,
    validators: Vec<Validator>,
    custom_validators: Vec<Arc<dyn crate::builder::ErasedValueValidator>>,
}

#[derive(Debug, Clone, Copy)]
struct EffectiveEntry {
    arg: ArgId,
    inherited: bool,
}

impl CompileCx {
    fn lower_command(
        &mut self,
        parent: Option<CommandId>,
        builder: &CommandBuilder,
        path: &str,
    ) -> Result<CommandId, BuildError> {
        validate_command_builder(builder, path)?;

        let id = CommandId::from_index(self.commands.len());

        let name = self.strings.intern(builder.name());
        let about = builder.about_ref().map(|text| self.strings.intern(text));
        let long_about = builder.long_about_ref().map(|text| self.strings.intern(text));
        let aliases = builder
            .aliases_ref()
            .iter()
            .map(|alias| self.strings.intern(alias))
            .collect::<Vec<_>>();

        let help_arg = self.synthesize_help_arg(id);

        self.commands.push(PendingCommand {
            parent,
            name,
            about,
            long_about,
            aliases,
            subcommands: Vec::new(),
            declared_args: Vec::new(),
            declared_groups: Vec::new(),
            help_arg,
            compiled: None,
        });

        for arg in builder.args_ref() {
            validate_arg_builder(arg, path)?;
            let arg_id = self.lower_arg(id, arg, path)?;
            self.commands[id.index()].declared_args.push(arg_id);
        }

        for group in builder.groups_ref() {
            validate_group_builder(group, path)?;
            let group_id = self.lower_group(id, group, path)?;
            self.commands[id.index()].declared_groups.push(group_id);
        }

        for child in builder.subcommands_ref() {
            let child_path = format!("{path} {}", child.name());
            let child_id = self.lower_command(Some(id), child, &child_path)?;
            self.commands[id.index()].subcommands.push(child_id);
        }

        Ok(id)
    }

    fn synthesize_help_arg(&mut self, declared_on: CommandId) -> ArgId {
        let pending = PendingArg {
            declared_on,
            id: self.strings.intern(SYNTHETIC_HELP_ID),
            kind: ArgKind::Flag,
            declared_global: false,
            short: Some(SYNTHETIC_HELP_SHORT),
            long: Some(self.strings.intern(SYNTHETIC_HELP_LONG)),
            aliases: Vec::new(),
            action: ArgActionKind::Help,
            value: None,
            env: None,
            help: CompiledHelpMeta {
                heading: None,
                help: Some(self.strings.intern(SYNTHETIC_HELP_TEXT)),
                long_help: None,
                value_name: None,
            },
            visibility: CompiledVisibility::Normal,
            position: None,
            required: false,
            requires: Box::new([]),
            conflicts: Box::new([]),
            groups: Box::new([]),
        };

        let id = ArgId::from_index(self.args.len());
        self.args.push(pending);
        id
    }

    fn lower_arg(
        &mut self,
        declared_on: CommandId,
        arg: &ArgDecl,
        path: &str,
    ) -> Result<ArgId, BuildError> {
        let value = match arg.value_ref() {
            Some(spec) => Some(self.lower_value_spec(spec, path, arg.id())?),
            None => None,
        };

        let pending = PendingArg {
            declared_on,
            id: self.strings.intern(arg.id()),
            kind: arg.kind(),
            declared_global: arg.declared_global(),
            short: arg.short_ref(),
            long: arg.long_ref().map(|long| self.strings.intern(long)),
            aliases: arg
                .aliases_ref()
                .iter()
                .map(|alias| CompiledArgAlias {
                    name: self.strings.intern(alias.name.as_str()),
                    hidden: alias.hidden,
                })
                .collect(),
            action: arg.action_ref(),
            value,
            env: arg.env_ref().map(|env| self.strings.intern(env)),
            help: self.lower_help_meta(arg.help_ref()),
            visibility: self.lower_visibility(arg.visibility_ref()),
            position: arg.position_ref(),
            required: arg.required_flag(),
            requires: boxed_strs(arg.requires_ref()),
            conflicts: boxed_strs(arg.conflicts_ref()),
            groups: boxed_strs(arg.groups_ref()),
        };

        let id = ArgId::from_index(self.args.len());
        self.args.push(pending);
        Ok(id)
    }

    fn lower_group(
        &mut self,
        declared_on: CommandId,
        group: &GroupBuilder,
        path: &str,
    ) -> Result<GroupId, BuildError> {
        let declared_args = &self.commands[declared_on.index()].declared_args;

        let mut arg_by_name = HashMap::<&str, ArgId>::new();
        for &arg_id in declared_args {
            let arg = &self.args[arg_id.index()];
            arg_by_name.insert(self.strings.get(arg.id), arg_id);
        }

        let mut members = Vec::with_capacity(group.members_ref().len());

        for member_name in group.members_ref() {
            let Some(&arg_id) = arg_by_name.get(member_name.as_str()) else {
                return Err(BuildError::new(
                    BuildErrorKind::UnknownReference,
                    path,
                    format!("group `{}` references unknown arg `{member_name}`", group.id()),
                ));
            };

            members.push(arg_id);
        }

        let id = GroupId::from_index(self.groups.len());
        self.groups.push(PendingGroup {
            declared_on,
            id: self.strings.intern(group.id()),
            members,
            required: group.required_flag(),
            multiple: group.multiple_flag(),
            relation: group.relation_kind(),
            help: group.help_ref().map(|help| self.strings.intern(help)),
        });

        Ok(id)
    }

    fn lower_value_spec(
        &mut self,
        spec: &ValueSpecBuilder,
        path: &str,
        arg_id: &str,
    ) -> Result<ValueSpecId, BuildError> {
        validate_value_spec(spec, path, arg_id)?;

        let id = ValueSpecId::from_index(self.value_specs.len());
        let expected = parser_expected(&spec.parser);

        self.value_specs.push(PendingValueSpec {
            parser: spec.parser.clone(),
            arity: spec.arity,
            hint: spec.hint,
            possible_values: spec
                .possible_values
                .iter()
                .map(|value| CompiledPossibleValue {
                    value: self.strings.intern(value.value.as_str()),
                    help: value.help.as_deref().map(|text| self.strings.intern(text)),
                    hidden: value.hidden,
                })
                .collect(),
            default: spec.default.as_ref().map(|default| match default {
                DefaultValue::String(value) => {
                    CompiledDefaultValue::String(self.strings.intern(value.as_str()))
                }
                DefaultValue::Display(value) => {
                    CompiledDefaultValue::Display(self.strings.intern(value.as_str()))
                }
            }),
            expected,
            validators: spec.validators.clone(),
            custom_validators: spec.custom_validators.clone(),
        });

        Ok(id)
    }

    fn lower_help_meta(&mut self, help: &HelpMeta) -> CompiledHelpMeta {
        CompiledHelpMeta {
            heading: help.heading.as_deref().map(|text| self.strings.intern(text)),
            help: help.help.as_deref().map(|text| self.strings.intern(text)),
            long_help: help.long_help.as_deref().map(|text| self.strings.intern(text)),
            value_name: help.value_name.as_deref().map(|text| self.strings.intern(text)),
        }
    }

    fn lower_visibility(&mut self, visibility: &Visibility) -> CompiledVisibility {
        match visibility {
            Visibility::Normal => CompiledVisibility::Normal,
            Visibility::Hidden => CompiledVisibility::Hidden,
            Visibility::Deprecated { note } => CompiledVisibility::Deprecated {
                note: note.as_deref().map(|text| self.strings.intern(text)),
            },
        }
    }

    fn build_effective_views(&mut self) -> Result<(), BuildError> {
        for index in 0..self.commands.len() {
            let id = CommandId::from_index(index);
            let compiled = self.build_effective_command(id)?;
            self.commands[index].compiled = Some(compiled);
        }

        Ok(())
    }

    fn build_effective_command(&self, id: CommandId) -> Result<PendingCompiledCommand, BuildError> {
        let pending = &self.commands[id.index()];
        let path = self.command_path(id);

        let effective_args = self.effective_args(id);
        if effective_args.len() > u16::MAX as usize {
            return Err(BuildError::new(
                BuildErrorKind::LimitExceeded,
                path.as_str(),
                format!(
                    "command has {} effective args, limit is {}",
                    effective_args.len(),
                    u16::MAX
                ),
            ));
        }

        let mut local_by_arg = HashMap::<ArgId, LocalArgIndex>::new();
        let mut local_by_arg_entries = Vec::<ArgLocalLookup>::with_capacity(effective_args.len());
        let mut arg_name_to_local = HashMap::<String, LocalArgIndex>::new();

        for (index, entry) in effective_args.iter().enumerate() {
            let local = LocalArgIndex::from_index(index);
            let arg = &self.args[entry.arg.index()];
            let name = self.strings.get(arg.id).to_owned();

            if arg_name_to_local.insert(name.clone(), local).is_some() {
                return Err(BuildError::new(
                    BuildErrorKind::DuplicateName,
                    path.as_str(),
                    format!("duplicate effective arg id `{name}`"),
                ));
            }

            local_by_arg.insert(entry.arg, local);
            local_by_arg_entries.push(ArgLocalLookup { arg: entry.arg, local });
        }

        local_by_arg_entries.sort_by_key(|entry| entry.arg.index());

        let effective_groups = self.effective_groups(id, &local_by_arg);
        let mut group_by_name = HashMap::<String, GroupId>::new();

        for &group_id in &effective_groups {
            let group = &self.groups[group_id.index()];
            let name = self.strings.get(group.id).to_owned();

            if arg_name_to_local.contains_key(&name) {
                return Err(BuildError::new(
                    BuildErrorKind::DuplicateName,
                    path.as_str(),
                    format!(
                        "relation namespace collision: `{name}` is both an arg \
                         id and a group id"
                    ),
                ));
            }

            if group_by_name.insert(name.clone(), group_id).is_some() {
                return Err(BuildError::new(
                    BuildErrorKind::DuplicateName,
                    path.as_str(),
                    format!("duplicate effective group id `{name}`"),
                ));
            }
        }

        let mut command_args = Vec::with_capacity(effective_args.len());

        for (index, entry) in effective_args.iter().enumerate() {
            let local = LocalArgIndex::from_index(index);
            let pending_arg = &self.args[entry.arg.index()];

            let mut conflicts_mask = BitMask::new(effective_args.len());
            let explicit_conflicts = self.resolve_conflicts_mask(
                path.as_str(),
                effective_args.len(),
                &pending_arg.conflicts,
                &arg_name_to_local,
                &group_by_name,
                &local_by_arg,
            )?;
            conflicts_mask.union_with(&explicit_conflicts);

            for &group_id in &effective_groups {
                let group = &self.groups[group_id.index()];
                if group.relation == GroupRelation::OneOf && group.members.contains(&entry.arg) {
                    for member in &group.members {
                        if *member != entry.arg
                            && let Some(&member_local) = local_by_arg.get(member)
                        {
                            conflicts_mask.insert(member_local);
                        }
                    }
                }
            }

            let conflicts = conflicts_mask.freeze();

            let requires = self.resolve_requires_mask(
                path.as_str(),
                effective_args.len(),
                &pending_arg.requires,
                &arg_name_to_local,
                &group_by_name,
                &local_by_arg,
            )?;

            let groups =
                self.resolve_group_memberships(path.as_str(), &pending_arg.groups, &group_by_name)?;

            command_args.push(PendingCommandArg {
                arg: entry.arg,
                local,
                inherited: entry.inherited,
                conflicts,
                requires,
                groups,
            });
        }

        let positionals = self.build_positionals(id, &command_args)?;
        let lookup = self.build_lookup(id, &command_args, &pending.subcommands)?;
        let visible_items = self.build_help_items(&command_args, &pending.subcommands);

        let mut req_mask = BitMask::new(command_args.len());
        for (index, entry) in command_args.iter().enumerate() {
            let arg = &self.args[entry.arg.index()];
            if arg.required {
                req_mask.insert(LocalArgIndex::from_index(index));
            }
        }
        let required_mask = req_mask.freeze();

        Ok(PendingCompiledCommand {
            parent: pending.parent,
            name: pending.name,
            about: pending.about,
            long_about: pending.long_about,
            aliases: pending.aliases.clone(),
            subcommands: pending.subcommands.clone(),
            groups: effective_groups,
            args: command_args,
            positionals,
            local_by_arg: local_by_arg_entries,
            lookup,
            required_mask,
            visible_items,
        })
    }

    fn effective_args(&self, id: CommandId) -> Vec<EffectiveEntry> {
        let mut out = Vec::<EffectiveEntry>::new();
        let mut seen = HashSet::<ArgId>::new();

        for command_id in self.lineage(id) {
            let command = &self.commands[command_id.index()];

            for &arg_id in &command.declared_args {
                let arg = &self.args[arg_id.index()];
                let include = command_id == id || arg.declared_global;

                if include && seen.insert(arg_id) {
                    out.push(EffectiveEntry { arg: arg_id, inherited: command_id != id });
                }
            }
        }

        let help_arg = self.commands[id.index()].help_arg;
        if seen.insert(help_arg) {
            out.push(EffectiveEntry { arg: help_arg, inherited: false });
        }

        out
    }

    fn effective_groups(
        &self,
        id: CommandId,
        local_by_arg: &HashMap<ArgId, LocalArgIndex>,
    ) -> Vec<GroupId> {
        let effective_arg_ids = local_by_arg.keys().copied().collect::<HashSet<_>>();
        let mut out = Vec::<GroupId>::new();

        for command_id in self.lineage(id) {
            let command = &self.commands[command_id.index()];

            for &group_id in &command.declared_groups {
                let group = &self.groups[group_id.index()];

                if group.members.iter().all(|member| effective_arg_ids.contains(member)) {
                    out.push(group_id);
                }
            }
        }

        out
    }

    fn resolve_conflicts_mask(
        &self,
        path: &str,
        bit_len: usize,
        symbolic: &[Box<str>],
        arg_name_to_local: &HashMap<String, LocalArgIndex>,
        group_by_name: &HashMap<String, GroupId>,
        local_by_arg: &HashMap<ArgId, LocalArgIndex>,
    ) -> Result<FrozenBitMask, BuildError> {
        let mut mask = BitMask::new(bit_len);

        for target in symbolic {
            if let Some(&local) = arg_name_to_local.get(target.as_ref()) {
                mask.insert(local);
                continue;
            }

            if let Some(&group_id) = group_by_name.get(target.as_ref()) {
                let group = &self.groups[group_id.index()];
                for member in &group.members {
                    let Some(&local) = local_by_arg.get(member) else {
                        continue;
                    };
                    mask.insert(local);
                }
                continue;
            }

            return Err(BuildError::new(
                BuildErrorKind::UnknownReference,
                path,
                format!("unknown relation target `{target}`"),
            ));
        }

        Ok(mask.freeze())
    }

    fn resolve_requires_mask(
        &self,
        path: &str,
        bit_len: usize,
        symbolic: &[Box<str>],
        arg_name_to_local: &HashMap<String, LocalArgIndex>,
        group_by_name: &HashMap<String, GroupId>,
        local_by_arg: &HashMap<ArgId, LocalArgIndex>,
    ) -> Result<FrozenBitMask, BuildError> {
        let mut mask = BitMask::new(bit_len);

        for target in symbolic {
            if let Some(&local) = arg_name_to_local.get(target.as_ref()) {
                mask.insert(local);
                continue;
            }

            if let Some(&group_id) = group_by_name.get(target.as_ref()) {
                let group = &self.groups[group_id.index()];

                let locals = group
                    .members
                    .iter()
                    .filter_map(|member| local_by_arg.get(member).copied())
                    .collect::<Vec<_>>();

                match locals.as_slice() {
                    [local] => {
                        mask.insert(*local);
                        continue;
                    }
                    [] => {
                        return Err(BuildError::new(
                            BuildErrorKind::UnknownReference,
                            path,
                            format!(
                                "group `{target}` is not effective in this \
                                 command view"
                            ),
                        ));
                    }
                    _ => {
                        return Err(BuildError::new(
                            BuildErrorKind::InvalidRelation,
                            path,
                            format!(
                                "requires target `{target}` refers to group \
                                 with multiple effective members, which is not \
                                 representable by the compiled requires mask"
                            ),
                        ));
                    }
                }
            }

            return Err(BuildError::new(
                BuildErrorKind::UnknownReference,
                path,
                format!("unknown relation target `{target}`"),
            ));
        }

        Ok(mask.freeze())
    }

    fn resolve_group_memberships(
        &self,
        path: &str,
        symbolic: &[Box<str>],
        group_by_name: &HashMap<String, GroupId>,
    ) -> Result<Vec<GroupId>, BuildError> {
        let mut seen = HashSet::<GroupId>::new();
        let mut out = Vec::<GroupId>::new();

        for group_name in symbolic {
            let Some(&group_id) = group_by_name.get(group_name.as_ref()) else {
                return Err(BuildError::new(
                    BuildErrorKind::UnknownReference,
                    path,
                    format!("unknown group `{group_name}`"),
                ));
            };

            if seen.insert(group_id) {
                out.push(group_id);
            }
        }

        Ok(out)
    }

    fn build_positionals(
        &self,
        id: CommandId,
        command_args: &[PendingCommandArg],
    ) -> Result<Vec<LocalArgIndex>, BuildError> {
        let mut positionals = command_args
            .iter()
            .filter_map(|entry| {
                let arg = &self.args[entry.arg.index()];
                (arg.kind == ArgKind::Positional).then_some((arg.position, entry.local, entry.arg))
            })
            .collect::<Vec<_>>();

        positionals
            .sort_by_key(|(position, local, _)| (position.unwrap_or(u16::MAX), local.index()));

        self.validate_positional_layout(id, &positionals)?;

        Ok(positionals.into_iter().map(|(_, local, _)| local).collect())
    }

    fn validate_positional_layout(
        &self,
        id: CommandId,
        positionals: &[(Option<u16>, LocalArgIndex, ArgId)],
    ) -> Result<(), BuildError> {
        let path = self.command_path(id);

        let mut seen = HashSet::<u16>::new();
        let mut expected = 0u16;

        for (position, _, arg_id) in positionals {
            let Some(position) = position else {
                continue;
            };

            if !seen.insert(*position) {
                let arg = &self.args[arg_id.index()];
                return Err(BuildError::new(
                    BuildErrorKind::InvalidPositionalLayout,
                    path.as_str(),
                    format!(
                        "duplicate positional index {} for arg `{}`",
                        position,
                        self.strings.get(arg.id),
                    ),
                ));
            }

            if *position != expected {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidPositionalLayout,
                    path.as_str(),
                    format!(
                        "positional indices must be contiguous starting at 0; \
                         expected {}, found {}",
                        expected, position
                    ),
                ));
            }

            expected = expected.saturating_add(1);
        }

        Ok(())
    }

    fn build_lookup(
        &self,
        id: CommandId,
        command_args: &[PendingCommandArg],
        subcommands: &[CommandId],
    ) -> Result<PendingCommandLookup, BuildError> {
        let path = self.command_path(id);

        let mut seen_long = HashSet::<String>::new();
        let mut seen_short = HashSet::<char>::new();
        let mut seen_sub = HashSet::<String>::new();

        let mut longs = Vec::<LongLookup>::new();
        let mut shorts = Vec::<ShortLookup>::new();
        let mut subcommand_lookups = Vec::<SubcommandLookup>::new();

        for entry in command_args {
            let arg = &self.args[entry.arg.index()];

            if let Some(long) = arg.long {
                let spelling = self.strings.get(long).to_owned();

                if !seen_long.insert(spelling.clone()) {
                    return Err(BuildError::new(
                        BuildErrorKind::DuplicateLong,
                        path.as_str(),
                        format!("duplicate long option `--{spelling}`"),
                    ));
                }

                longs.push(LongLookup { name: long, local: entry.local });
            }

            for alias in &arg.aliases {
                let spelling = self.strings.get(alias.name).to_owned();

                if !seen_long.insert(spelling.clone()) {
                    return Err(BuildError::new(
                        BuildErrorKind::DuplicateLong,
                        path.as_str(),
                        format!("duplicate long option alias `--{spelling}`"),
                    ));
                }

                longs.push(LongLookup { name: alias.name, local: entry.local });
            }

            if let Some(short) = arg.short {
                if !seen_short.insert(short) {
                    return Err(BuildError::new(
                        BuildErrorKind::DuplicateShort,
                        path.as_str(),
                        format!("duplicate short option `-{short}`"),
                    ));
                }

                shorts.push(ShortLookup { name: short, local: entry.local });
            }
        }

        for &subcommand_id in subcommands {
            let sub = &self.commands[subcommand_id.index()];
            let name = self.strings.get(sub.name).to_owned();

            if !seen_sub.insert(name.clone()) {
                return Err(BuildError::new(
                    BuildErrorKind::DuplicateName,
                    path.as_str(),
                    format!("duplicate subcommand name `{name}`"),
                ));
            }

            subcommand_lookups.push(SubcommandLookup { name: sub.name, command: subcommand_id });

            for &alias in &sub.aliases {
                let alias_name = self.strings.get(alias).to_owned();

                if !seen_sub.insert(alias_name.clone()) {
                    return Err(BuildError::new(
                        BuildErrorKind::DuplicateName,
                        path.as_str(),
                        format!("duplicate subcommand alias `{alias_name}`"),
                    ));
                }

                subcommand_lookups.push(SubcommandLookup { name: alias, command: subcommand_id });
            }
        }

        longs.sort_by(|a, b| self.strings.get(a.name).cmp(self.strings.get(b.name)));
        shorts.sort_by_key(|entry| entry.name);
        subcommand_lookups.sort_by(|a, b| self.strings.get(a.name).cmp(self.strings.get(b.name)));

        Ok(PendingCommandLookup { longs, shorts, subcommands: subcommand_lookups })
    }

    fn build_help_items(
        &self,
        command_args: &[PendingCommandArg],
        subcommands: &[CommandId],
    ) -> Vec<HelpItem> {
        let mut out = Vec::<HelpItem>::new();
        let mut seen_headings = HashSet::<Symbol>::new();

        for entry in command_args {
            let arg = &self.args[entry.arg.index()];

            if matches!(arg.visibility, CompiledVisibility::Hidden) {
                continue;
            }

            if let Some(heading) = arg.help.heading
                && seen_headings.insert(heading)
            {
                out.push(HelpItem::Heading(heading));
            }

            out.push(HelpItem::Arg(entry.local));
        }

        out.extend(subcommands.iter().copied().map(HelpItem::Subcommand));
        out
    }

    fn lineage(&self, id: CommandId) -> Vec<CommandId> {
        let mut lineage = Vec::<CommandId>::new();
        let mut cursor = Some(id);

        while let Some(command_id) = cursor {
            lineage.push(command_id);
            cursor = self.commands[command_id.index()].parent;
        }

        lineage.reverse();
        lineage
    }

    fn command_path(&self, id: CommandId) -> String {
        self.lineage(id)
            .into_iter()
            .map(|command_id| self.strings.get(self.commands[command_id.index()].name))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn freeze(self) -> CompiledSchema {
        let mut command_aliases = Vec::<Symbol>::new();
        let mut command_subcommands = Vec::<CommandId>::new();
        let mut command_groups = Vec::<GroupId>::new();
        let mut command_args = Vec::<CommandArg>::new();
        let mut command_positionals = Vec::<LocalArgIndex>::new();
        let mut command_visible_items = Vec::<HelpItem>::new();
        let mut command_arg_locals_by_id = Vec::<ArgLocalLookup>::new();

        let mut lookup_longs = Vec::<LongLookup>::new();
        let mut lookup_shorts = Vec::<ShortLookup>::new();
        let mut lookup_subcommands = Vec::<SubcommandLookup>::new();

        let mut arg_aliases = Vec::<CompiledArgAlias>::new();
        let mut group_members = Vec::<ArgId>::new();

        let mut value_possible_values = Vec::<CompiledPossibleValue>::new();
        let mut value_validators = Vec::<Validator>::new();
        let mut value_custom_validators =
            Vec::<Arc<dyn crate::builder::ErasedValueValidator>>::new();

        let commands = self
            .commands
            .into_iter()
            .map(|command| {
                let compiled =
                    command.compiled.expect("all commands must be compiled before freeze");

                let aliases = append_range(&mut command_aliases, compiled.aliases);
                let subcommands = append_range(&mut command_subcommands, compiled.subcommands);
                let groups = append_range(&mut command_groups, compiled.groups);

                let args_start = command_args.len();
                for arg in compiled.args {
                    let groups = append_range(&mut command_groups, arg.groups);

                    command_args.push(CommandArg {
                        arg: arg.arg,
                        local: arg.local,
                        inherited: arg.inherited,
                        conflicts: arg.conflicts,
                        requires: arg.requires,
                        groups,
                    });
                }
                let args = SliceRange::new(args_start, command_args.len() - args_start);

                let positionals = append_range(&mut command_positionals, compiled.positionals);
                let local_by_arg =
                    append_range(&mut command_arg_locals_by_id, compiled.local_by_arg);
                let visible_items =
                    append_range(&mut command_visible_items, compiled.visible_items);

                let lookup = CommandLookup {
                    longs: append_range(&mut lookup_longs, compiled.lookup.longs),
                    shorts: append_range(&mut lookup_shorts, compiled.lookup.shorts),
                    subcommands: append_range(&mut lookup_subcommands, compiled.lookup.subcommands),
                };

                CompiledCommand {
                    parent: compiled.parent,
                    name: compiled.name,
                    about: compiled.about,
                    long_about: compiled.long_about,
                    aliases,
                    subcommands,
                    groups,
                    args,
                    positionals,
                    local_by_arg,
                    visible_items,
                    lookup,
                    required_mask: compiled.required_mask,
                }
            })
            .collect::<Vec<_>>();

        let args = self
            .args
            .into_iter()
            .map(|arg| {
                let aliases = append_range(&mut arg_aliases, arg.aliases);

                CompiledArg {
                    declared_on: arg.declared_on,
                    id: arg.id,
                    kind: arg.kind,
                    action: arg.action,
                    value: arg.value,
                    declared_global: arg.declared_global,
                    required: arg.required,
                    short: arg.short,
                    long: arg.long,
                    env: arg.env,
                    position: arg.position,
                    aliases,
                    help: arg.help,
                    visibility: arg.visibility,
                }
            })
            .collect::<Vec<_>>();

        let groups = self
            .groups
            .into_iter()
            .map(|group| {
                let members = append_range(&mut group_members, group.members);

                CompiledGroup {
                    declared_on: group.declared_on,
                    id: group.id,
                    members,
                    required: group.required,
                    multiple: group.multiple,
                    relation: group.relation,
                    help: group.help,
                }
            })
            .collect::<Vec<_>>();

        let value_specs = self
            .value_specs
            .into_iter()
            .map(|spec| {
                let possible_values =
                    append_range(&mut value_possible_values, spec.possible_values);
                let validators = append_range(&mut value_validators, spec.validators);
                let custom_validators =
                    append_range(&mut value_custom_validators, spec.custom_validators);

                CompiledValueSpec {
                    parser: spec.parser,
                    arity: spec.arity,
                    hint: spec.hint,
                    possible_values,
                    default: spec.default,
                    expected: spec.expected,
                    validators,
                    custom_validators,
                }
            })
            .collect::<Vec<_>>();

        CompiledSchema {
            strings: self.strings.freeze(),
            commands: commands.into_boxed_slice(),
            args: args.into_boxed_slice(),
            groups: groups.into_boxed_slice(),
            value_specs: value_specs.into_boxed_slice(),
            command_aliases: command_aliases.into_boxed_slice(),
            command_subcommands: command_subcommands.into_boxed_slice(),
            command_groups: command_groups.into_boxed_slice(),
            command_args: command_args.into_boxed_slice(),
            command_positionals: command_positionals.into_boxed_slice(),
            command_visible_items: command_visible_items.into_boxed_slice(),
            command_arg_locals_by_id: command_arg_locals_by_id.into_boxed_slice(),
            lookup_longs: lookup_longs.into_boxed_slice(),
            lookup_shorts: lookup_shorts.into_boxed_slice(),
            lookup_subcommands: lookup_subcommands.into_boxed_slice(),
            arg_aliases: arg_aliases.into_boxed_slice(),
            group_members: group_members.into_boxed_slice(),
            value_possible_values: value_possible_values.into_boxed_slice(),
            value_validators: value_validators.into_boxed_slice(),
            value_custom_validators: value_custom_validators.into_boxed_slice(),
        }
    }
}

fn append_range<T>(backing: &mut Vec<T>, mut items: Vec<T>) -> SliceRange {
    let start = backing.len();
    backing.append(&mut items);
    SliceRange::new(start, backing.len() - start)
}

fn validate_command_builder(builder: &CommandBuilder, path: &str) -> Result<(), BuildError> {
    if builder.name().trim().is_empty() {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            "command name must not be empty",
        ));
    }

    for alias in builder.aliases_ref() {
        if alias.trim().is_empty() {
            return Err(BuildError::new(
                BuildErrorKind::InvalidRelation,
                path,
                "command alias must not be empty",
            ));
        }
    }

    let mut relation_namespace = HashSet::<String>::new();

    for arg in builder.args_ref() {
        let inserted = relation_namespace.insert(arg.id().to_owned());
        if !inserted {
            return Err(BuildError::new(
                BuildErrorKind::DuplicateName,
                path,
                format!("duplicate arg or group id `{}` in relation namespace", arg.id()),
            ));
        }
    }

    for group in builder.groups_ref() {
        let inserted = relation_namespace.insert(group.id().to_owned());
        if !inserted {
            return Err(BuildError::new(
                BuildErrorKind::DuplicateName,
                path,
                format!("duplicate arg or group id `{}` in relation namespace", group.id()),
            ));
        }
    }

    let mut subcommand_namespace = HashSet::<String>::new();

    for child in builder.subcommands_ref() {
        if child.name().trim().is_empty() {
            return Err(BuildError::new(
                BuildErrorKind::InvalidRelation,
                path,
                "subcommand name must not be empty",
            ));
        }

        if !subcommand_namespace.insert(child.name().to_owned()) {
            return Err(BuildError::new(
                BuildErrorKind::DuplicateName,
                path,
                format!("duplicate subcommand name `{}`", child.name()),
            ));
        }

        for alias in child.aliases_ref() {
            if alias.trim().is_empty() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    "subcommand alias must not be empty",
                ));
            }

            if !subcommand_namespace.insert(alias.clone()) {
                return Err(BuildError::new(
                    BuildErrorKind::DuplicateName,
                    path,
                    format!("duplicate subcommand alias `{alias}`"),
                ));
            }
        }
    }

    Ok(())
}

fn validate_arg_builder(arg: &crate::builder::ArgDecl, path: &str) -> Result<(), BuildError> {
    if arg.id().trim().is_empty() {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            "arg id must not be empty",
        ));
    }

    if arg.long_ref() == Some(SYNTHETIC_HELP_LONG) {
        return Err(BuildError::new(
            BuildErrorKind::DuplicateLong,
            path,
            "long option `--help` is reserved for the synthesized help flag",
        ));
    }

    if arg.short_ref() == Some(SYNTHETIC_HELP_SHORT) {
        return Err(BuildError::new(
            BuildErrorKind::DuplicateShort,
            path,
            "short option `-h` is reserved for the synthesized help flag",
        ));
    }

    if let Some(long) = arg.long_ref() {
        validate_long_spelling(long, path, "long option name")?;
    }

    for alias in arg.aliases_ref() {
        validate_long_spelling(alias.name.as_str(), path, "long option alias")?;
    }

    if let Some(short) = arg.short_ref()
        && (short == '-' || short.is_control() || short.is_whitespace())
    {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!("invalid short option character `{short}`"),
        ));
    }

    match arg.kind() {
        ArgKind::Flag => {
            if arg.value_ref().is_some() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("flag arg `{}` cannot carry a value specification", arg.id()),
                ));
            }

            let has_name = arg.short_ref().is_some()
                || arg.long_ref().is_some()
                || !arg.aliases_ref().is_empty();

            if !has_name {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("flag arg `{}` must declare a short, long, or alias name", arg.id()),
                ));
            }

            if arg.position_ref().is_some() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("flag arg `{}` cannot have a positional index", arg.id()),
                ));
            }
        }
        ArgKind::Option => {
            if arg.value_ref().is_none() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("option arg `{}` must carry a value specification", arg.id()),
                ));
            }

            let has_name = arg.short_ref().is_some()
                || arg.long_ref().is_some()
                || !arg.aliases_ref().is_empty();

            if !has_name {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("option arg `{}` must declare a short, long, or alias name", arg.id()),
                ));
            }

            if arg.position_ref().is_some() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("option arg `{}` cannot have a positional index", arg.id()),
                ));
            }
        }
        ArgKind::Positional => {
            if arg.short_ref().is_some()
                || arg.long_ref().is_some()
                || !arg.aliases_ref().is_empty()
            {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!(
                        "positional arg `{}` cannot have short, long, or alias names",
                        arg.id()
                    ),
                ));
            }

            if arg.declared_global() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("positional arg `{}` cannot be global", arg.id()),
                ));
            }

            if arg.value_ref().is_none() {
                return Err(BuildError::new(
                    BuildErrorKind::InvalidRelation,
                    path,
                    format!("positional arg `{}` must carry a value specification", arg.id()),
                ));
            }
        }
    }

    Ok(())
}

fn validate_group_builder(group: &GroupBuilder, path: &str) -> Result<(), BuildError> {
    if group.id().trim().is_empty() {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            "group id must not be empty",
        ));
    }

    if group.members_ref().is_empty() {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!("group `{}` must contain at least one member", group.id()),
        ));
    }

    let mut seen = HashSet::<&str>::new();
    for member in group.members_ref() {
        if !seen.insert(member.as_str()) {
            return Err(BuildError::new(
                BuildErrorKind::InvalidRelation,
                path,
                format!("group `{}` contains duplicate member `{member}`", group.id()),
            ));
        }
    }

    Ok(())
}

fn validate_value_spec(
    spec: &ValueSpecBuilder,
    path: &str,
    arg_id: &str,
) -> Result<(), BuildError> {
    if let Some(max) = spec.arity.max()
        && spec.arity.min() > max
    {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!(
                "arg `{arg_id}` has invalid arity: min {} exceeds max {}",
                spec.arity.min(),
                max
            ),
        ));
    }

    if let Some(DefaultValue::String(default)) = &spec.default {
        if !spec.possible_values.is_empty()
            && !spec.possible_values.iter().any(|value| value.value == *default)
        {
            return Err(BuildError::new(
                BuildErrorKind::InvalidDefault,
                path,
                format!(
                    "default value `{default}` for arg `{arg_id}` is not \
                     present in declared possible values"
                ),
            ));
        }

        if matches!(spec.parser, ParserKind::ValueEnum)
            && !spec.possible_values.iter().any(|value| value.value == *default)
        {
            return Err(BuildError::new(
                BuildErrorKind::InvalidDefault,
                path,
                format!(
                    "default value `{default}` for arg `{arg_id}` is not a \
                     declared enum value"
                ),
            ));
        }
    }

    let has_path_validator = spec.validators.iter().any(|validator| {
        matches!(validator, Validator::Exists | Validator::File | Validator::Directory)
    });

    if has_path_validator && !matches!(spec.parser, ParserKind::PathBuf) {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!("arg `{arg_id}` uses path validators but parser kind is not PathBuf"),
        ));
    }

    Ok(())
}

fn validate_long_spelling(value: &str, path: &str, what: &str) -> Result<(), BuildError> {
    if value.is_empty() {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!("{what} must not be empty"),
        ));
    }

    if value.starts_with('-') {
        return Err(BuildError::new(
            BuildErrorKind::InvalidRelation,
            path,
            format!("{what} `{value}` must not start with `-`"),
        ));
    }

    Ok(())
}

fn parser_expected(parser: &ParserKind) -> &'static str {
    match parser {
        ParserKind::OsString => "value",
        ParserKind::String => "string",
        ParserKind::PathBuf => "path",
        ParserKind::ValueEnum => "one of the allowed values",
        ParserKind::Custom(custom) => custom.type_name(),
    }
}

fn boxed_strs(values: &[String]) -> Box<[Box<str>]> {
    values
        .iter()
        .map(|value| Box::<str>::from(value.as_str()))
        .collect::<Vec<_>>()
        .into_boxed_slice()
}
