//! Help document construction and rendering.

use std::cmp;
use std::io::Write;

use anstyle::{AnsiColor, Effects, Style};
use terminal_size::{Width, terminal_size};
use textwrap::{Options as WrapOptions, fill, wrap};
use unicode_width::UnicodeWidthStr;

use crate::builder::ArgKind;
use crate::help::error::HelpError;
use crate::help::model::{
    ArgHelp, HelpDoc, HelpEntry, HelpOptions, HelpSection, SubcommandHelp, format_default_value,
};
use crate::schema::{CommandRef, HelpMetaRef, VisibilityRef};

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

/// A zero-configuration theme that provides stunning, robust ANSI colors.
///
/// Powered by `anstream` and `anstyle`, this perfectly detects terminal capabilities,
/// respects `NO_COLOR`, and handles Windows API translation flawlessly.
struct Theme {
    heading: Style,
    title: Style,
    flag: Style,
    metavar: Style,
}

impl Theme {
    fn new() -> Self {
        Self {
            heading: Style::new().fg_color(Some(AnsiColor::Green.into())).effects(Effects::BOLD),
            title: Style::new().fg_color(Some(AnsiColor::Green.into())).effects(Effects::BOLD),
            flag: Style::new().fg_color(Some(AnsiColor::Cyan.into())).effects(Effects::BOLD),
            metavar: Style::new().fg_color(Some(AnsiColor::Cyan.into())),
        }
    }

    fn heading_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.heading, self.heading)
    }
    fn title_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.title, self.title)
    }
    fn flag_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.flag, self.flag)
    }
    fn metavar_str(&self, text: &str) -> String {
        format!("{}{text}{:#}", self.metavar, self.metavar)
    }

    fn usage_line(&self, line: &str) -> String {
        let mut parts = line.splitn(2, ' ');
        let cmd = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");

        let mut colored = format!("{}{cmd}{:#}", self.title, self.title);
        if !rest.is_empty() {
            colored.push(' ');
            let c_rest = rest
                .replace("[OPTIONS]", &format!("{}[OPTIONS]{:#}", self.metavar, self.metavar))
                .replace("[COMMAND]", &format!("{}[COMMAND]{:#}", self.metavar, self.metavar))
                .replace("<", &format!("{}<", self.metavar))
                .replace(">", &format!(">{:#}", self.metavar));
            colored.push_str(&c_rest);
        }
        colored
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

    let description = if options.include_description {
        if options.use_long_help {
            command.long_about().or_else(|| command.about())
        } else {
            command.about().or_else(|| command.long_about())
        }
    } else {
        None
    };

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
    let mut options_section = Vec::<HelpEntry<'a>>::new();
    let mut custom_sections = Vec::<(Box<str>, Vec<HelpEntry<'a>>)>::new();
    let mut commands = Vec::<HelpEntry<'a>>::new();

    for arg in command.args() {
        if !should_show_arg(arg.visibility(), options) {
            continue;
        }

        let entry = HelpEntry::Arg(build_arg_help(arg, options));

        if let Some(heading) = arg.help().heading() {
            push_custom_section(&mut custom_sections, heading.into(), entry);
            continue;
        }

        match arg.kind() {
            ArgKind::Positional => arguments.push(entry),
            ArgKind::Flag | ArgKind::Option => options_section.push(entry),
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

    if !options_section.is_empty() {
        sections.push(HelpSection {
            heading: options.options_heading.clone(),
            entries: options_section.into_boxed_slice(),
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

fn build_arg_help<'a>(arg: crate::schema::ArgRef<'a>, options: &HelpOptions) -> ArgHelp<'a> {
    let help = arg.help();
    let description = choose_help_text(help, options);

    let mut metadata = Vec::<Box<str>>::new();

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

    if options.show_env
        && let Some(env) = arg.env()
    {
        metadata.push(format!("env: {env}").into_boxed_str());
    }

    if options.show_defaults
        && let Some(default) = arg.value_spec().and_then(|spec| spec.default())
    {
        metadata.push(format_default_value(default));
    }

    if options.show_possible_values
        && let Some(spec) = arg.value_spec()
    {
        let values = spec
            .possible_values()
            .filter(|value| options.show_hidden || !value.hidden())
            .map(|value| value.value().to_owned())
            .collect::<Vec<_>>();

        if !values.is_empty() {
            metadata.push(format!("possible values: {}", values.join(", ")).into_boxed_str());
        }
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

    let has_named = command.args().any(|arg| matches!(arg.kind(), ArgKind::Flag | ArgKind::Option));

    let mut root = String::new();
    root.push_str(command.name());

    if has_named {
        root.push_str(" [OPTIONS]");
    }

    for arg in command.positionals() {
        root.push(' ');
        root.push_str(&usage_piece_for_positional(arg));
    }

    if command.subcommand_count() > 0 {
        root.push_str(" [COMMAND]");
    }

    lines.push(root.into_boxed_str());

    for sub in command.subcommands() {
        let mut line = String::new();
        line.push_str(command.name());
        line.push(' ');
        line.push_str(sub.name());

        let has_named = sub.args().any(|arg| matches!(arg.kind(), ArgKind::Flag | ArgKind::Option));

        if has_named {
            line.push_str(" [OPTIONS]");
        }

        for arg in sub.positionals() {
            line.push(' ');
            line.push_str(&usage_piece_for_positional(arg));
        }

        if sub.subcommand_count() > 0 {
            line.push_str("[COMMAND]");
        }

        lines.push(line.into_boxed_str());
    }

    lines
}

fn usage_piece_for_positional(arg: crate::schema::ArgRef<'_>) -> String {
    let name = positional_metavar(arg);

    match arg.value_spec().map(|spec| spec.arity()) {
        Some(arity) if arity.max.is_none() || arity.max.map(|m| m > 1).unwrap_or(false) => {
            if arity.min == 0 { format!("[<{name}>]...") } else { format!("<{name}>...") }
        }
        Some(arity) if arity.min == 0 => format!("[<{name}>]"),
        _ => format!("<{name}>"),
    }
}

fn format_arg_label(arg: crate::schema::ArgRef<'_>) -> String {
    match arg.kind() {
        ArgKind::Positional => {
            let name = positional_metavar(arg);
            format!("<{name}>")
        }
        ArgKind::Flag | ArgKind::Option => {
            let mut label = String::new();
            let long_name = arg.long().or_else(|| arg.aliases().next().map(|a| a.name()));

            if let Some(c) = arg.short() {
                label.push_str(&format!("-{c}"));
                if long_name.is_some() {
                    label.push_str(", ");
                }
            } else {
                label.push_str("    ");
            }

            if let Some(long) = long_name {
                label.push_str(&format!("--{long}"));
            }

            if arg.kind() == ArgKind::Option {
                let value_name = option_metavar(arg);
                if long_name.is_none() && arg.short().is_some() {
                    label = format!("-{} <{value_name}>", arg.short().unwrap());
                } else {
                    label.push_str(&format!(" <{value_name}>"));
                }
            }

            label
        }
    }
}

fn format_colored_arg_label(arg: crate::schema::ArgRef<'_>, theme: &Theme) -> String {
    match arg.kind() {
        ArgKind::Positional => {
            let name = positional_metavar(arg);
            theme.metavar_str(&format!("<{name}>"))
        }
        ArgKind::Flag | ArgKind::Option => {
            let mut label = String::new();
            let long_name = arg.long().or_else(|| arg.aliases().next().map(|a| a.name()));

            if let Some(c) = arg.short() {
                label.push_str(&theme.flag_str(&format!("-{c}")));
                if long_name.is_some() {
                    label.push_str(", ");
                }
            } else {
                label.push_str("    ");
            }

            if let Some(long) = long_name {
                label.push_str(&theme.flag_str(&format!("--{long}")));
            }

            if arg.kind() == ArgKind::Option {
                let value_name = option_metavar(arg);
                let value_colored = theme.metavar_str(&format!("<{value_name}>"));
                if long_name.is_none() && arg.short().is_some() {
                    label = format!(
                        "{} {value_colored}",
                        theme.flag_str(&format!("-{}", arg.short().unwrap()))
                    );
                } else {
                    label.push(' ');
                    label.push_str(&value_colored);
                }
            }

            label
        }
    }
}

fn positional_metavar(arg: crate::schema::ArgRef<'_>) -> String {
    arg.help()
        .value_name()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| arg.id_string().to_ascii_uppercase())
}

fn option_metavar(arg: crate::schema::ArgRef<'_>) -> String {
    arg.help()
        .value_name()
        .map(ToOwned::to_owned)
        .or_else(|| arg.value_spec().map(|spec| spec.expected().to_ascii_uppercase()))
        .unwrap_or_else(|| "VALUE".to_owned())
}

fn render_default_help(doc: &HelpDoc<'_>, options: &HelpOptions) -> String {
    let width = help_width(options);
    let theme = Theme::new();
    let mut out = String::new();

    // Title / Description
    if let Some(desc) = doc.description {
        out.push_str(&theme.title_str(doc.name));
        if !doc.aliases.is_empty() {
            out.push_str(" (aliases: ");
            out.push_str(&doc.aliases.join(", "));
            out.push(')');
        }
        out.push('\n');

        out.push('\n');
        out.push_str(&fill(desc, WrapOptions::new(width)));
        out.push_str("\n\n");
    }

    // Usage
    if !doc.usage.is_empty() {
        if doc.usage.len() == 1 {
            out.push_str(&theme.heading_str("Usage:"));
            out.push(' ');
            out.push_str(&theme.usage_line(&doc.usage[0]));
            out.push_str("\n\n");
        } else {
            out.push_str(&theme.heading_str("Usage:\n"));
            for line in &doc.usage {
                out.push_str("  ");
                out.push_str(&theme.usage_line(line));
                out.push('\n');
            }
            out.push('\n');
        }
    }

    for (i, section) in doc.sections.iter().enumerate() {
        out.push_str(&theme.heading_str(&section.heading));
        out.push_str(":\n");

        render_section(&mut out, section, width, &theme);

        if i < doc.sections.len() - 1 {
            out.push('\n');
        }
    }

    out
}

fn render_section(out: &mut String, section: &HelpSection<'_>, width: usize, theme: &Theme) {
    let indent = 2usize;
    let gap = 2usize;

    let left_width = compute_left_width(section, width);
    let desc_width = width.saturating_sub(indent + left_width + gap).max(20);

    for entry in &section.entries {
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

    // Don't let the left side consume more than a third of the screen, minimum 12 chars
    cmp::min(widest, total_width / 3).max(12)
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
    let left_display_width = UnicodeWidthStr::width(left);
    let colored_left = format_colored_arg_label(arg.arg, theme);

    let base_indent = " ".repeat(indent);
    let desc_indent = " ".repeat(indent + left_width + gap);

    out.push_str(&base_indent);
    out.push_str(&colored_left);

    let mut has_desc = false;
    let mut lines = Vec::new();

    if let Some(description) = arg.description {
        lines.extend(wrap(description, desc_width).into_iter().map(|c| c.into_owned()));
        has_desc = true;
    }

    for meta in &arg.metadata {
        let meta_str = format!("[{meta}]");
        lines.extend(wrap(&meta_str, desc_width).into_iter().map(|c| c.into_owned()));
        has_desc = true;
    }

    if !has_desc {
        out.push('\n');
        return;
    }

    if left_display_width > left_width {
        out.push('\n');
        for line in lines {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    } else {
        let pad = " ".repeat(left_width - left_display_width + gap);
        out.push_str(&pad);
        out.push_str(&lines[0]);
        out.push('\n');

        for line in lines.into_iter().skip(1) {
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
    let left_display_width = UnicodeWidthStr::width(left);
    let colored_left = theme.title_str(left);

    let base_indent = " ".repeat(indent);
    let desc_indent = " ".repeat(indent + left_width + gap);

    out.push_str(&base_indent);
    out.push_str(&colored_left);

    let mut lines = Vec::new();
    if let Some(description) = sub.description {
        lines.extend(wrap(description, desc_width).into_iter().map(|c| c.into_owned()));
    }

    if !sub.aliases.is_empty() {
        let meta = format!("[aliases: {}]", sub.aliases.join(", "));
        lines.extend(wrap(&meta, desc_width).into_iter().map(|c| c.into_owned()));
    }

    if lines.is_empty() {
        out.push('\n');
        return;
    }

    if left_display_width > left_width {
        out.push('\n');
        for line in lines {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    } else {
        let pad = " ".repeat(left_width - left_display_width + gap);
        out.push_str(&pad);
        out.push_str(&lines[0]);
        out.push('\n');

        for line in lines.into_iter().skip(1) {
            out.push_str(&desc_indent);
            out.push_str(&line);
            out.push('\n');
        }
    }
}

fn help_width(options: &HelpOptions) -> usize {
    if let Some(width) = options.width {
        return width.max(40);
    }

    if let Some((Width(width), _)) = terminal_size() {
        return usize::from(width).max(40);
    }

    100
}

/// Print rendered help to standard output.
///
/// This automatically strips ANSI color codes if stdout is piped to a file
/// or if the terminal does not support colors (powered by `anstream`).
pub fn print_help(text: &str) -> Result<(), HelpError> {
    let mut out = anstream::AutoStream::auto(std::io::stdout());
    out.write_all(text.as_bytes())?;
    Ok(())
}
