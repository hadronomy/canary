//! Structured help document model.
//!
//! This model sits between the compiled schema and concrete renderers.
//!
//! The default renderer consumes [`HelpDoc`], but users can also inspect or
//! transform it before rendering.

use crate::schema::{ArgRef, CommandRef, DefaultValueRef};

/// Structured help document for one command.
#[derive(Debug, Clone)]
pub struct HelpDoc<'a> {
    /// Command being documented.
    pub command: CommandRef<'a>,
    /// Command display name.
    pub name: &'a str,
    /// Preferred descriptive text.
    pub description: Option<&'a str>,
    /// Command aliases.
    pub aliases: Box<[&'a str]>,
    /// Usage lines.
    pub usage: Box<[Box<str>]>,
    /// Renderable sections.
    pub sections: Box<[HelpSection<'a>]>,
}

/// One help section.
///
/// Typical headings include:
///
/// - `Arguments`
/// - `Options`
/// - `Commands`
/// - custom author-defined headings
#[derive(Debug, Clone)]
pub struct HelpSection<'a> {
    /// Section heading text.
    pub heading: Box<str>,
    /// Section entries in display order.
    pub entries: Box<[HelpEntry<'a>]>,
}

/// One entry within a help section.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum HelpEntry<'a> {
    /// Argument help row.
    Arg(ArgHelp<'a>),
    /// Subcommand help row.
    Subcommand(SubcommandHelp<'a>),
    /// Free-form paragraph.
    Paragraph(Box<str>),
}

/// Render-ready argument help.
#[derive(Debug, Clone)]
pub struct ArgHelp<'a> {
    /// Underlying canonical arg.
    pub arg: ArgRef<'a>,
    /// Left-column display label.
    pub label: Box<str>,
    /// Main help text.
    pub description: Option<&'a str>,
    /// Additional metadata lines.
    pub metadata: Box<[Box<str>]>,
}

/// Render-ready subcommand help.
#[derive(Debug, Clone)]
pub struct SubcommandHelp<'a> {
    /// Underlying subcommand.
    pub command: CommandRef<'a>,
    /// Subcommand display name.
    pub name: &'a str,
    /// One-line description.
    pub description: Option<&'a str>,
    /// Visible aliases.
    pub aliases: Box<[&'a str]>,
}

/// Options controlling help document construction and rendering.
#[derive(Debug, Clone)]
pub struct HelpOptions {
    /// Preferred output width. `None` means auto-detect with fallback.
    pub width: Option<usize>,
    /// Show hidden items.
    pub show_hidden: bool,
    /// Show deprecated items.
    pub show_deprecated: bool,
    /// Show env metadata.
    pub show_env: bool,
    /// Show default values.
    pub show_defaults: bool,
    /// Show possible values.
    pub show_possible_values: bool,
    /// Use long help text when available.
    pub use_long_help: bool,
    /// Include aliases in output.
    pub show_aliases: bool,
    /// Include usage block.
    pub include_usage: bool,
    /// Include description/about block.
    pub include_description: bool,
    /// Label used for the command section.
    pub commands_heading: Box<str>,
    /// Label used for the positional args section.
    pub arguments_heading: Box<str>,
    /// Label used for the named args section.
    pub options_heading: Box<str>,
}

impl Default for HelpOptions {
    fn default() -> Self {
        Self {
            width: None,
            show_hidden: false,
            show_deprecated: true,
            show_env: true,
            show_defaults: true,
            show_possible_values: false,
            use_long_help: false,
            show_aliases: true,
            include_usage: true,
            include_description: true,
            commands_heading: "Commands".into(),
            arguments_heading: "Arguments".into(),
            options_heading: "Options".into(),
        }
    }
}

impl<'a> ArgHelp<'a> {
    /// Return the arg id string.
    #[must_use]
    pub fn id(&self) -> &'a str {
        self.arg.id_string()
    }
}

impl<'a> SubcommandHelp<'a> {
    /// Return the subcommand id/name.
    #[must_use]
    pub fn id(&self) -> &'a str {
        self.command.name()
    }
}

impl<'a> HelpDoc<'a> {
    /// Return `true` if no sections are present.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sections.is_empty()
    }
}

/// Render helper for a default value.
#[must_use]
pub fn format_default_value(value: DefaultValueRef<'_>) -> Box<str> {
    match value {
        DefaultValueRef::String(text) => format!("default: {text}").into_boxed_str(),
        DefaultValueRef::Display(text) => format!("default: {text}").into_boxed_str(),
    }
}
