//! Help generation.
//!
//! This module provides a structured help document model plus a beautiful
//! default renderer.
//!
//! Most users will call:
//!
//! - [`crate::Command::render_help`]
//! - [`crate::Command::render_help_with`]
//! - [`crate::Command::print_help`]
//!
//! Advanced users can:
//!
//! - inspect or transform a [`HelpDoc`]
//! - implement [`HelpRenderer`] for custom output
//! - render with custom [`HelpOptions`]

mod error;
mod model;
mod render;

pub use error::HelpError;
pub use model::{
    format_default_value, ArgHelp, HelpDoc, HelpEntry, HelpOptions, HelpSection,
    SubcommandHelp,
};
pub use render::{
    build_help_doc, print_help, DefaultHelpRenderer, HelpRenderer,
};

use crate::schema::Command;

impl Command {
    /// Build a structured help document for the root command using default
    /// options.
    #[must_use]
    pub fn help_doc(&self) -> HelpDoc<'_> {
        self.help_doc_with(&HelpOptions::default())
    }

    /// Build a structured help document for the root command with custom
    /// options.
    #[must_use]
    pub fn help_doc_with(&self, options: &HelpOptions) -> HelpDoc<'_> {
        build_help_doc(self.as_ref(), options)
    }

    /// Render beautiful default help for the root command.
    pub fn render_help(&self) -> Result<String, HelpError> {
        self.render_help_with(&HelpOptions::default())
    }

    /// Render beautiful default help for the root command with custom options.
    pub fn render_help_with(
        &self,
        options: &HelpOptions,
    ) -> Result<String, HelpError> {
        let doc = self.help_doc_with(options);
        DefaultHelpRenderer.render_doc(&doc, options)
    }

    /// Render help using a custom renderer.
    pub fn render_help_with_renderer<R: HelpRenderer>(
        &self,
        renderer: &R,
        options: &HelpOptions,
    ) -> Result<String, HelpError> {
        let doc = self.help_doc_with(options);
        renderer.render_doc(&doc, options)
    }

    /// Print beautiful default help to stdout.
    pub fn print_help(&self) -> Result<(), HelpError> {
        let text = self.render_help()?;
        print_help(&text)
    }

    /// Print beautiful default help to stdout with custom options.
    pub fn print_help_with(
        &self,
        options: &HelpOptions,
    ) -> Result<(), HelpError> {
        let text = self.render_help_with(options)?;
        print_help(&text)
    }
}