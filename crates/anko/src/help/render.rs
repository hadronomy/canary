//! Help document construction and rendering.

use std::cmp;
use std::fmt::Write as _;
use std::io::Write;

use anstyle::{AnsiColor, Effects, Style};
use terminal_size::{Width, terminal_size};
use textwrap::{Options as WrapOptions, fill, wrap};
use unicode_width::UnicodeWidthStr;

use crate::builder::{ArgActionKind, ArgKind, Arity, GroupRelation, Validator, ValueHint};
use crate::help::error::HelpError;
use crate::help::model::{
    ArgHelp, HelpDoc, HelpEntry, HelpOptions, HelpSection, SubcommandHelp, format_default_value,
};
use crate::schema::{ArgRef, CommandRef, HelpMetaRef, VisibilityRef};

/// Trait for custom help renderers.
pub trait HelpRenderer {
    /// Render a structured help document into a string.
    fn render_doc(&self, doc: &HelpDoc<'_>, options: &HelpOptions) -> Result<String, HelpError>;
}

/// Default human-friendly help renderer.
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultHelpRenderer;

impl HelpRenderer for DefaultHelpRenderer {
    fn render_doc(&self, doc: &HelpDoc<'_>, options: &HelpOptions) -> Result<String, HelpError> {
        Ok(render_default_help(doc, options))
    }
}

/// Build a structured help document for a command.
#[must_use]
pub fn build_help_doc<'a>(command: CommandRef<'a>, options: &HelpOptions) -> HelpDoc<'a> {
    let aliases = if options.show_aliases {
        command.aliases().collect::<Vec<_>>().into_boxed_slice()
    } else {
        Box::new([])
    };

    let description = if options.include_description { command.about() } else { None };

    let usage = if options.include_usage {
        build_usage_lines(command).into_boxed_slice()
    } else {
        Box::new([])
    };

    let sections = build_sections(command, options).into_boxed_slice();

    HelpDoc { command, name: command.name(), description, aliases, usage, sections }
}

fn build_sections<'a>(command: CommandRef<'a>, options: &HelpOptions) -> Vec<HelpSection<'a>> {
    let mut arguments = Vec::<HelpEntry<'a>>::new();
    let mut named_options = Vec::<HelpEntry<'a>>::new();
    let mut custom_sections = Vec::<(Box<str>, Vec<HelpEntry<'a>>)>::new();
    let mut commands = Vec::<HelpEntry<'a>>::new();

    for arg in command.args() {
        if !should_show_arg(arg.visibility(), options) {
            continue;
        }

        let entry = HelpEntry::Arg(build_arg_help(command, arg, options));

        if let Some(heading) = arg.help().heading() {
            push_custom_section(&mut custom_sections, heading.into(), entry);
            continue;
        }

        match arg.kind() {
            ArgKind::Positional => arguments.push(entry),
            ArgKind::Flag | ArgKind::Option => named_options.push(entry),
        }
    }

    for sub in command.subcommands() {
        commands.push(HelpEntry::Subcommand(build_subcommand_help(sub, options)));
    }

    let mut sections = Vec::<HelpSection<'a>>::new();

    if !arguments.is_empty() {
        sections.push(HelpSection {
            heading: options.arguments_heading.clone(),
            entries: arguments.into_boxed_slice(),
        });
    }

    if !named_options.is_empty() {
        sections.push(HelpSection {
            heading: options.options_heading.clone(),
            entries: named_options.into_boxed_slice(),
        });
    }

    for (heading, entries) in custom_sections {
        if !entries.is_empty() {
            sections.push(HelpSection { heading, entries: entries.into_boxed_slice() });
        }
    }

    if !commands.is_empty() {
        sections.push(HelpSection {
            heading: options.commands_heading.clone(),
            entries: commands.into_boxed_slice(),
        });
    }

    sections
}

fn push_custom_section<'a>(
    sections: &mut Vec<(Box<str>, Vec<HelpEntry<'a>>)>,
    heading: Box<str>,
    entry: HelpEntry<'a>,
) {
    if let Some((_, entries)) = sections.iter_mut().find(|(h, _)| h == &heading) {
        entries.push(entry);
    } else {
        sections.push((heading, vec![entry]));
    }
}

fn should_show_arg(visibility: VisibilityRef<'_>, options: &HelpOptions) -> bool {
    match visibility {
        VisibilityRef::Normal => true,
        VisibilityRef::Hidden => options.show_hidden,
        VisibilityRef::Deprecated { .. } => options.show_deprecated,
    }
}

fn build_arg_help<'a>(
    command: CommandRef<'a>,
    arg: ArgRef<'a>,
    options: &HelpOptions,
) -> ArgHelp<'a> {
    let help = arg.help();
    let description =
        choose_help_text(help, options).or_else(|| inferred_arg_description(command, arg));

    let mut metadata = Vec::<Box<str>>::new();

    if let Some(properties) = format_properties(command, arg) {
        metadata.push(properties);
    }

    if options.show_aliases {
        let aliases = arg
            .aliases()
            .filter(|alias| options.show_hidden || !alias.hidden())
            .map(|alias| format!("--{}", alias.name()))
            .collect::<Vec<_>>();

        if !aliases.is_empty() {
            metadata.push(format!("aliases: {}", aliases.join(", ")).into_boxed_str());
        }
    }

    if let Some(spec) = arg.value_spec() {
        if should_show_arity(arg, spec.arity()) {
            metadata.push(format!("takes {}", format_arity(spec.arity())).into_boxed_str());
        }

        if let Some(hint) = format_hint(spec.hint()) {
            metadata.push(format!("hint: {hint}").into_boxed_str());
        }

        if let Some(validation) = format_validation(spec.validators(), spec.custom_validators()) {
            metadata.push(validation);
        }

        if options.show_defaults
            && let Some(default) = spec.default()
        {
            metadata.push(format_default_value(default));
        }

        if options.show_possible_values {
            let possible = spec
                .possible_values()
                .filter(|value| options.show_hidden || !value.hidden())
                .map(|value| match value.help() {
                    Some(help) => format!("{} ({help})", value.value()),
                    None => value.value().to_owned(),
                })
                .collect::<Vec<_>>();

            if !possible.is_empty() {
                metadata.push(format!("possible values: {}", possible.join(", ")).into_boxed_str());
            }
        }
    }

    if options.show_env
        && let Some(env) = arg.env()
    {
        metadata.push(format!("env: {env}").into_boxed_str());
    }

    if let Some(conflicts) = format_conflicts(command, arg) {
        metadata.push(conflicts);
    }

    if let Some(requires) = format_requires(command, arg) {
        metadata.push(requires);
    }

    for group_line in format_groups(command, arg) {
        metadata.push(group_line);
    }

    if let VisibilityRef::Deprecated { note } = arg.visibility() {
        let line = match note {
            Some(note) => format!("deprecated: {note}"),
            None => "deprecated".to_owned(),
        };

        metadata.push(line.into_boxed_str());
    }

    ArgHelp {
        arg,
        label: format_arg_label(arg).into_boxed_str(),
        description,
        metadata: metadata.into_boxed_slice(),
    }
}

fn build_subcommand_help<'a>(command: CommandRef<'a>, options: &HelpOptions) -> SubcommandHelp<'a> {
    let aliases = if options.show_aliases {
        command.aliases().collect::<Vec<_>>().into_boxed_slice()
    } else {
        Box::new([])
    };

    let description = if options.use_long_help {
        command.long_about().or_else(|| command.about())
    } else {
        command.about().or_else(|| command.long_about())
    };

    SubcommandHelp { command, name: command.name(), description, aliases }
}

fn choose_help_text<'a>(help: HelpMetaRef<'a>, options: &HelpOptions) -> Option<&'a str> {
    if options.use_long_help {
        help.long_help().or_else(|| help.help())
    } else {
        help.help().or_else(|| help.long_help())
    }
}

fn build_usage_lines(command: CommandRef<'_>) -> Vec<Box<str>> {
    let mut lines = Vec::<Box<str>>::new();
    lines.push(build_usage_line(command).into_boxed_str());

    for sub in command.subcommands() {
        lines.push(build_usage_line(sub).into_boxed_str());
    }

    lines
}

fn build_usage_line(command: CommandRef<'_>) -> String {
    let mut line = command_display_path(command);

    if command.args().any(|arg| matches!(arg.kind(), ArgKind::Flag | ArgKind::Option)) {
        line.push_str(" [OPTIONS]");
    }

    for arg in command.positionals() {
        line.push(' ');
        line.push_str(&usage_piece_for_positional(arg));
    }

    if command.subcommand_count() > 0 {
        line.push_str(" [COMMAND]");
    }

    line
}

fn command_display_path(command: CommandRef<'_>) -> String {
    let mut parts = Vec::new();
    let mut cursor = Some(command);

    while let Some(cmd) = cursor {
        parts.push(cmd.name());
        cursor = cmd.parent();
    }

    parts.reverse();
    parts.join(" ")
}

fn usage_piece_for_positional(arg: ArgRef<'_>) -> String {
    let name = positional_metavar(arg);

    match arg.value_spec().map(|spec| spec.arity()) {
        Some(Arity::Exact(0)) => format!("[<{name}>]"),
        Some(arity) if arity.max().is_none() => {
            if arity.min() == 0 {
                format!("[<{name}>]...")
            } else {
                format!("<{name}>...")
            }
        }
        Some(Arity::Exact(1)) => format!("<{name}>"),
        Some(Arity::Exact(n)) => repeat_required_metavar(&name, n),
        Some(Arity::Range(0, 1)) => format!("[<{name}>]"),
        Some(Arity::Range(min, max)) => format_ranged_usage_piece(&name, min, max),
        Some(Arity::AtLeast(0)) => format!("[<{name}>]..."),
        Some(Arity::AtLeast(1)) => format!("<{name}>..."),
        Some(Arity::AtLeast(min)) => {
            let mut out = repeat_required_metavar(&name, min);
            out.push_str("...");
            out
        }
        None => format!("<{name}>"),
    }
}

fn repeat_required_metavar(name: &str, count: u16) -> String {
    (0..count).map(|_| format!("<{name}>")).collect::<Vec<_>>().join(" ")
}

fn format_ranged_usage_piece(name: &str, min: u16, max: u16) -> String {
    let mut parts = Vec::new();

    for _ in 0..min {
        parts.push(format!("<{name}>"));
    }

    for _ in min..max {
        parts.push(format!("[<{name}>]"));
    }

    parts.join(" ")
}

fn format_arg_label(arg: ArgRef<'_>) -> String {
    match arg.kind() {
        ArgKind::Positional => positional_usage_label(arg),
        ArgKind::Flag | ArgKind::Option => named_arg_label(arg),
    }
}

fn positional_usage_label(arg: ArgRef<'_>) -> String {
    let name = positional_metavar(arg);

    match arg.value_spec().map(|spec| spec.arity()) {
        Some(Arity::Exact(1)) | None => format!("<{name}>"),
        Some(Arity::Range(0, 1)) => format!("[<{name}>]"),
        Some(arity) => usage_piece_for_positional_with_arity(&name, arity),
    }
}

fn usage_piece_for_positional_with_arity(name: &str, arity: Arity) -> String {
    match arity {
        Arity::Exact(0) => format!("[<{name}>]"),
        Arity::Exact(1) => format!("<{name}>"),
        Arity::Exact(n) => repeat_required_metavar(name, n),
        Arity::Range(0, 1) => format!("[<{name}>]"),
        Arity::Range(min, max) => format_ranged_usage_piece(name, min, max),
        Arity::AtLeast(0) => format!("[<{name}>]..."),
        Arity::AtLeast(1) => format!("<{name}>..."),
        Arity::AtLeast(min) => {
            let mut out = repeat_required_metavar(name, min);
            out.push_str("...");
            out
        }
    }
}

fn named_arg_label(arg: ArgRef<'_>) -> String {
    let mut label = String::new();
    let long_name = arg.long().or_else(|| arg.aliases().next().map(|a| a.name()));

    match (arg.short(), long_name) {
        (Some(short), Some(long)) => {
            let _ = write!(label, "-{short}, --{long}");
        }
        (Some(short), None) => {
            let _ = write!(label, "-{short}");
        }
        (None, Some(long)) => {
            let _ = write!(label, "    --{long}");
        }
        (None, None) => {}
    }

    if arg.kind() == ArgKind::Option {
        let value_name = option_value_label(arg);
        if !label.is_empty() {
            label.push(' ');
        }
        label.push_str(&value_name);
    }

    label
}

fn option_value_label(arg: ArgRef<'_>) -> String {
    let name = option_metavar(arg);

    match arg.value_spec().map(|spec| spec.arity()) {
        Some(Arity::Exact(1)) | None => format!("<{name}>"),
        Some(Arity::Range(0, 1)) => format!("[<{name}>]"),
        Some(Arity::Exact(n)) => (0..n).map(|_| format!("<{name}>")).collect::<Vec<_>>().join(" "),
        Some(Arity::Range(min, max)) => {
            let mut pieces = Vec::new();

            for _ in 0..min {
                pieces.push(format!("<{name}>"));
            }

            for _ in min..max {
                pieces.push(format!("[<{name}>]"));
            }

            pieces.join(" ")
        }
        Some(Arity::AtLeast(0)) => format!("[<{name}>]..."),
        Some(Arity::AtLeast(1)) => format!("<{name}>..."),
        Some(Arity::AtLeast(min)) => {
            let mut out = (0..min).map(|_| format!("<{name}>")).collect::<Vec<_>>().join(" ");
            out.push_str("...");
            out
        }
    }
}

fn format_colored_arg_label(arg: ArgRef<'_>, theme: &Theme) -> String {
    match arg.kind() {
        ArgKind::Positional => theme.metavar_str(&positional_usage_label(arg)),
        ArgKind::Flag | ArgKind::Option => {
            let mut out = String::new();
            let long_name = arg.long().or_else(|| arg.aliases().next().map(|a| a.name()));

            match (arg.short(), long_name) {
                (Some(short), Some(long)) => {
                    out.push_str(&theme.flag_str(&format!("-{short}")));
                    out.push_str(", ");
                    out.push_str(&theme.flag_str(&format!("--{long}")));
                }
                (Some(short), None) => {
                    out.push_str(&theme.flag_str(&format!("-{short}")));
                }
                (None, Some(long)) => {
                    out.push_str("    ");
                    out.push_str(&theme.flag_str(&format!("--{long}")));
                }
                (None, None) => {}
            }

            if arg.kind() == ArgKind::Option {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(&theme.metavar_str(&option_value_label(arg)));
            }

            out
        }
    }
}

fn positional_metavar(arg: ArgRef<'_>) -> String {
    arg.help()
        .value_name()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| arg.id_string().to_ascii_uppercase())
}

fn option_metavar(arg: ArgRef<'_>) -> String {
    arg.help()
        .value_name()
        .map(ToOwned::to_owned)
        .or_else(|| arg.value_spec().map(|spec| spec.expected().to_ascii_uppercase()))
        .unwrap_or_else(|| "VALUE".to_owned())
}

fn format_properties(command: CommandRef<'_>, arg: ArgRef<'_>) -> Option<Box<str>> {
    let mut parts = Vec::<String>::new();

    if arg.required() {
        parts.push("required".to_owned());
    }

    if arg.declared_global() {
        parts.push("global".to_owned());
    }

    if arg.declared_on().id() != command.id() {
        parts.push("inherited".to_owned());
    }

    match arg.action() {
        ArgActionKind::Count => parts.push("counts occurrences".to_owned()),
        ArgActionKind::Append => parts.push("repeatable".to_owned()),
        ArgActionKind::Help => parts.push("show help and exit".to_owned()),
        ArgActionKind::Version => parts.push("show version and exit".to_owned()),
        ArgActionKind::SetTrue | ArgActionKind::SetFalse | ArgActionKind::Set => {}
    }

    if parts.is_empty() { None } else { Some(parts.join(" • ").into_boxed_str()) }
}

fn format_conflicts(command: CommandRef<'_>, arg: ArgRef<'_>) -> Option<Box<str>> {
    let local = command.local_arg_by_id(arg.id())?;
    let entry = command.local_arg_entry(local);

    let conflicts = entry
        .conflicts
        .iter()
        .filter(|other| *other != local)
        .map(|other| local_display_name(command, other))
        .collect::<Vec<_>>();

    if conflicts.is_empty() {
        None
    } else {
        Some(format!("conflicts with: {}", conflicts.join(", ")).into_boxed_str())
    }
}

fn format_requires(command: CommandRef<'_>, arg: ArgRef<'_>) -> Option<Box<str>> {
    let local = command.local_arg_by_id(arg.id())?;
    let entry = command.local_arg_entry(local);

    let required = entry
        .requires
        .iter()
        .filter(|other| *other != local)
        .map(|other| local_display_name(command, other))
        .collect::<Vec<_>>();

    if required.is_empty() {
        None
    } else {
        Some(format!("requires: {}", required.join(", ")).into_boxed_str())
    }
}

fn format_groups(command: CommandRef<'_>, arg: ArgRef<'_>) -> Vec<Box<str>> {
    let Some(local) = command.local_arg_by_id(arg.id()) else {
        return Vec::new();
    };

    let entry = command.local_arg_entry(local);
    let mut lines = Vec::new();

    for group_id in entry.groups.get(&command.schema.command_groups) {
        let group = crate::schema::GroupRef { schema: command.schema, id: *group_id };

        let mut parts = Vec::<String>::new();

        if group.required() {
            parts.push("required".to_owned());
        }

        match group.relation() {
            GroupRelation::Any => {}
            GroupRelation::OneOf => parts.push("choose one".to_owned()),
        }

        if !group.multiple() {
            parts.push("non-repeatable".to_owned());
        }

        let mut line = format!("group: {}", group.id_string());

        if !parts.is_empty() {
            line.push_str(" (");
            line.push_str(&parts.join(", "));
            line.push(')');
        }

        if let Some(help) = group.help() {
            line.push_str(" — ");
            line.push_str(help);
        }

        lines.push(line.into_boxed_str());
    }

    lines
}

fn display_name(arg: ArgRef<'_>) -> String {
    if let Some(long) = arg.long() {
        format!("--{long}")
    } else if let Some(short) = arg.short() {
        format!("-{short}")
    } else {
        format!("<{}>", positional_metavar(arg))
    }
}

fn local_display_name(command: CommandRef<'_>, local: crate::ids::LocalArgIndex) -> String {
    let arg_id = command.local_arg_entry(local).arg;
    let arg = ArgRef { schema: command.schema, id: arg_id };
    display_name(arg)
}

fn should_show_arity(arg: ArgRef<'_>, arity: Arity) -> bool {
    match arg.kind() {
        ArgKind::Flag => false,
        ArgKind::Positional => !matches!(arity, Arity::Exact(1)),
        ArgKind::Option => !matches!(arity, Arity::Exact(1)),
    }
}

fn format_arity(arity: Arity) -> String {
    match arity {
        Arity::Exact(0) => "0 values".to_owned(),
        Arity::Exact(1) => "1 value".to_owned(),
        Arity::Exact(n) => format!("exactly {n} values"),
        Arity::Range(0, 1) => "0 or 1 value".to_owned(),
        Arity::Range(min, max) => format!("{min} to {max} values"),
        Arity::AtLeast(0) => "any number of values".to_owned(),
        Arity::AtLeast(1) => "one or more values".to_owned(),
        Arity::AtLeast(min) => format!("at least {min} values"),
    }
}

fn format_hint(hint: ValueHint) -> Option<&'static str> {
    match hint {
        ValueHint::Unknown => None,
        ValueHint::FilePath => Some("file path"),
        ValueHint::DirPath => Some("directory path"),
        ValueHint::CommandName => Some("command name"),
        ValueHint::EnvVar => Some("environment variable"),
        ValueHint::Url => Some("URL"),
    }
}

fn format_validation(
    validators: &[Validator],
    custom_validators: &[std::sync::Arc<dyn crate::builder::ErasedValueValidator>],
) -> Option<Box<str>> {
    let mut parts = validators
        .iter()
        .map(|validator| match validator {
            Validator::Exists => "must exist".to_owned(),
            Validator::File => "must be a file".to_owned(),
            Validator::Directory => "must be a directory".to_owned(),
        })
        .collect::<Vec<_>>();

    if !custom_validators.is_empty() {
        if custom_validators.len() == 1 {
            parts.push("custom".to_owned());
        } else {
            parts.push(format!("{} custom validators", custom_validators.len()));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(format!("validation: {}", parts.join(", ")).into_boxed_str())
    }
}

fn inferred_arg_description<'a>(command: CommandRef<'a>, arg: ArgRef<'a>) -> Option<&'a str> {
    let local = command.local_arg_by_id(arg.id())?;
    let entry = command.local_arg_entry(local);

    for group_id in entry.groups.get(&command.schema.command_groups) {
        let group = crate::schema::GroupRef { schema: command.schema, id: *group_id };
        if let Some(help) = group.help() {
            return Some(help);
        }
    }

    None
}

/// A zero-configuration theme that provides attractive, robust ANSI colors.
struct Theme {
    command: Style,
    section: Style,
    flag: Style,
    metavar: Style,
    subtle: Style,
    accent: Style,
    key_neutral: Style,
    key_info: Style,
    key_relation: Style,
    key_caution: Style,
    key_warning: Style,
    meta_value: Style,
}

impl Theme {
    fn new() -> Self {
        Self {
            command: Style::new().fg_color(Some(AnsiColor::Green.into())).effects(Effects::BOLD),
            section: Style::new().fg_color(Some(AnsiColor::Blue.into())).effects(Effects::BOLD),
            flag: Style::new().fg_color(Some(AnsiColor::Cyan.into())).effects(Effects::BOLD),
            metavar: Style::new().fg_color(Some(AnsiColor::Yellow.into())).effects(Effects::BOLD),
            subtle: Style::new().fg_color(Some(AnsiColor::BrightBlack.into())),
            accent: Style::new().fg_color(Some(AnsiColor::Magenta.into())).effects(Effects::BOLD),
            key_neutral: Style::new()
                .fg_color(Some(AnsiColor::BrightBlack.into()))
                .effects(Effects::BOLD),
            key_info: Style::new()
                .fg_color(Some(AnsiColor::Blue.into()))
                .effects(Effects::BOLD | Effects::DIMMED),
            key_relation: Style::new()
                .fg_color(Some(AnsiColor::Magenta.into()))
                .effects(Effects::BOLD | Effects::DIMMED),
            key_caution: Style::new()
                .fg_color(Some(AnsiColor::Yellow.into()))
                .effects(Effects::BOLD | Effects::DIMMED),
            key_warning: Style::new()
                .fg_color(Some(AnsiColor::Red.into()))
                .effects(Effects::BOLD | Effects::DIMMED),
            meta_value: Style::new().fg_color(Some(AnsiColor::BrightBlack.into())),
        }
    }

    fn command_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.command, self.command)
    }

    fn section_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.section, self.section)
    }

    fn flag_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.flag, self.flag)
    }

    fn metavar_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.metavar, self.metavar)
    }

    fn subtle_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.subtle, self.subtle)
    }

    fn accent_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.accent, self.accent)
    }

    fn key_neutral_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.key_neutral, self.key_neutral)
    }

    fn key_info_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.key_info, self.key_info)
    }

    fn key_relation_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.key_relation, self.key_relation)
    }

    fn key_caution_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.key_caution, self.key_caution)
    }

    fn key_warning_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.key_warning, self.key_warning)
    }

    fn meta_value_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.meta_value, self.meta_value)
    }

    fn usage_prefix(&self) -> String {
        self.subtle_str("$")
    }
}

fn render_default_help(doc: &HelpDoc<'_>, options: &HelpOptions) -> String {
    let width = help_width(options);
    let theme = Theme::new();
    let mut out = String::new();

    render_header(&mut out, doc, width, &theme);

    if !doc.usage.is_empty() {
        render_usage(&mut out, doc, &theme);
    }

    for (index, section) in doc.sections.iter().enumerate() {
        if index > 0 || !doc.usage.is_empty() {
            out.push('\n');
        }

        out.push_str(&theme.section_str(&section.heading));
        out.push('\n');
        render_section(&mut out, section, width, &theme);
    }

    out
}

fn render_header(out: &mut String, doc: &HelpDoc<'_>, width: usize, theme: &Theme) {
    let title = command_display_path(doc.command);

    out.push_str(&theme.command_str(&title));

    if let Some(description) = doc.description {
        out.push_str(" — ");
        out.push_str(description);
    }

    out.push('\n');

    if !doc.aliases.is_empty() {
        let aliases = format!("aliases: {}", doc.aliases.join(", "));
        let wrapped = fill(&aliases, WrapOptions::new(width));
        out.push_str(&theme.subtle_str(&wrapped));
        out.push('\n');
    }

    if let Some(long_about) = doc.command.long_about()
        && Some(long_about) != doc.description
    {
        out.push('\n');
        out.push_str(&fill(long_about, WrapOptions::new(width)));
        out.push('\n');
    }
}

fn render_usage(out: &mut String, doc: &HelpDoc<'_>, theme: &Theme) {
    out.push('\n');
    out.push_str(&theme.section_str("Usage"));
    out.push('\n');

    for line in &doc.usage {
        out.push_str("  ");
        out.push_str(&theme.usage_prefix());
        out.push(' ');
        out.push_str(&color_usage_line(line, theme));
        out.push('\n');
    }
}

fn color_usage_line(line: &str, theme: &Theme) -> String {
    let mut out = String::new();
    let mut token = String::new();

    for ch in line.chars() {
        if ch.is_whitespace() {
            flush_usage_token(&mut out, &mut token, theme);
            out.push(ch);
        } else {
            token.push(ch);
        }
    }

    flush_usage_token(&mut out, &mut token, theme);
    out
}

fn flush_usage_token(out: &mut String, token: &mut String, theme: &Theme) {
    if token.is_empty() {
        return;
    }

    let styled = if token.starts_with('[') || token.starts_with('<') {
        theme.metavar_str(token)
    } else {
        theme.command_str(token)
    };

    out.push_str(&styled);
    token.clear();
}

fn render_section(out: &mut String, section: &HelpSection<'_>, width: usize, theme: &Theme) {
    let indent = 2usize;
    let gap = 3usize;
    let left_width = compute_left_width(section, width);
    let desc_width = width.saturating_sub(indent + left_width + gap).max(24);

    for (index, entry) in section.entries.iter().enumerate() {
        match entry {
            HelpEntry::Arg(arg) => {
                render_arg_entry(out, arg, indent, left_width, gap, desc_width, theme)
            }
            HelpEntry::Subcommand(sub) => {
                render_subcommand_entry(out, sub, indent, left_width, gap, desc_width, theme)
            }
            HelpEntry::Paragraph(text) => {
                let prefix = " ".repeat(indent);
                let wrapped = fill(
                    text,
                    WrapOptions::new(width.saturating_sub(indent))
                        .initial_indent(&prefix)
                        .subsequent_indent(&prefix),
                );
                out.push_str(&wrapped);
                out.push('\n');
            }
        }

        if index + 1 < section.entries.len() {
            out.push('\n');
        }
    }
}

fn compute_left_width(section: &HelpSection<'_>, total_width: usize) -> usize {
    let widest = section
        .entries
        .iter()
        .filter_map(|entry| match entry {
            HelpEntry::Arg(arg) => Some(UnicodeWidthStr::width(arg.label.as_ref())),
            HelpEntry::Subcommand(sub) => Some(UnicodeWidthStr::width(sub.name)),
            HelpEntry::Paragraph(_) => None,
        })
        .max()
        .unwrap_or(0);

    cmp::min(widest, total_width / 2).max(14)
}

fn render_arg_entry(
    out: &mut String,
    arg: &ArgHelp<'_>,
    indent: usize,
    left_width: usize,
    gap: usize,
    desc_width: usize,
    theme: &Theme,
) {
    let left = arg.label.as_ref();
    let left_width_display = UnicodeWidthStr::width(left);
    let colored_left = format_colored_arg_label(arg.arg, theme);

    let left_indent = " ".repeat(indent);
    let desc_indent = " ".repeat(indent + left_width + gap);

    out.push_str(&left_indent);
    out.push_str(&colored_left);

    let mut body_lines = Vec::<String>::new();

    if let Some(description) = arg.description {
        body_lines.extend(wrap(description, desc_width).into_iter().map(|line| line.into_owned()));
    }

    for line in &arg.metadata {
        let styled = style_metadata_line(line, theme);
        body_lines.extend(wrap(&styled, desc_width).into_iter().map(|line| line.into_owned()));
    }

    if body_lines.is_empty() {
        out.push('\n');
        return;
    }

    if left_width_display > left_width {
        out.push('\n');
        for line in body_lines {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    } else {
        let pad = " ".repeat(left_width - left_width_display + gap);
        out.push_str(&pad);
        out.push_str(&body_lines[0]);
        out.push('\n');

        for line in body_lines.into_iter().skip(1) {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    }
}

fn render_subcommand_entry(
    out: &mut String,
    sub: &SubcommandHelp<'_>,
    indent: usize,
    left_width: usize,
    gap: usize,
    desc_width: usize,
    theme: &Theme,
) {
    let left = sub.name;
    let left_width_display = UnicodeWidthStr::width(left);
    let colored_left = theme.accent_str(left);

    let left_indent = " ".repeat(indent);
    let desc_indent = " ".repeat(indent + left_width + gap);

    out.push_str(&left_indent);
    out.push_str(&colored_left);

    let mut body_lines = Vec::<String>::new();

    if let Some(description) = sub.description {
        body_lines.extend(wrap(description, desc_width).into_iter().map(|line| line.into_owned()));
    }

    if !sub.aliases.is_empty() {
        let aliases = format!("aliases: {}", sub.aliases.join(", "));
        let styled = style_metadata_line(&aliases, theme);
        body_lines.extend(wrap(&styled, desc_width).into_iter().map(|line| line.into_owned()));
    }

    if body_lines.is_empty() {
        out.push('\n');
        return;
    }

    if left_width_display > left_width {
        out.push('\n');
        for line in body_lines {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    } else {
        let pad = " ".repeat(left_width - left_width_display + gap);
        out.push_str(&pad);
        out.push_str(&body_lines[0]);
        out.push('\n');

        for line in body_lines.into_iter().skip(1) {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    }
}

fn style_metadata_line(line: &str, theme: &Theme) -> String {
    if line.contains(" • ") {
        return style_property_line(line, theme);
    }

    let Some((key, value)) = line.split_once(": ") else {
        return theme.subtle_str(line);
    };

    let styled_key = match key {
        "conflicts with" | "deprecated" => theme.key_warning_str(&format!("{key}:")),
        "requires" => theme.key_caution_str(&format!("{key}:")),
        "hint" | "validation" | "env" => theme.key_info_str(&format!("{key}:")),
        "group" => theme.key_relation_str(&format!("{key}:")),
        "aliases" | "default" | "possible values" => theme.key_neutral_str(&format!("{key}:")),
        _ => theme.key_neutral_str(&format!("{key}:")),
    };

    format!("{styled_key} {}", theme.meta_value_str(value))
}

fn style_property_line(line: &str, theme: &Theme) -> String {
    line.split(" • ")
        .map(|part| style_property_token(part, theme))
        .collect::<Vec<_>>()
        .join(&theme.subtle_str(" • "))
}

fn style_property_token(token: &str, theme: &Theme) -> String {
    match token {
        "required" => theme.key_caution_str(token),
        "show help and exit" | "show version and exit" => theme.key_info_str(token),
        "global" | "inherited" | "repeatable" | "counts occurrences" => {
            theme.key_neutral_str(token)
        }
        _ => theme.subtle_str(token),
    }
}

fn help_width(options: &HelpOptions) -> usize {
    if let Some(width) = options.width {
        return width.max(48);
    }

    if let Some((Width(width), _)) = terminal_size() {
        return usize::from(width).max(48);
    }

    100
}

/// Print rendered help to standard output.
///
/// This automatically strips ANSI color codes if stdout is piped to a file
/// or if the terminal does not support colors.
pub fn print_help(text: &str) -> Result<(), HelpError> {
    let mut out = anstream::AutoStream::auto(std::io::stdout());
    out.write_all(text.as_bytes())?;
    Ok(())
}
