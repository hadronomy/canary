use std::borrow::Cow;
use std::io::{self, Write};

use super::style::{ACCENT, LABEL, TITLE, VALUE};
use super::{CellStr, Columns, Component, Mode};

const LABEL_WIDTH: Columns = Columns::new(22);
const INDENT_WIDTH: usize = 3;

/// Plain section with aligned key/value rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Section<'a> {
    title: Cow<'a, str>,
    rows: Vec<Row<'a>>,
}

impl<'a> Section<'a> {
    /// Creates an empty section with a title.
    #[inline(always)]
    pub(crate) fn new(title: impl Into<Cow<'a, str>>) -> Self {
        Self { title: title.into(), rows: Vec::new() }
    }

    /// Adds a row to the section.
    #[inline(always)]
    #[must_use]
    pub(crate) fn row(mut self, label: &'static str, value: impl Into<Cow<'a, str>>) -> Self {
        self.rows.push(Row::new(None, 0, label, value));
        self
    }

    /// Adds an indented row to the section.
    #[inline(always)]
    #[must_use]
    pub(crate) fn indented_row(
        mut self,
        indent: u8,
        label: &'static str,
        value: impl Into<Cow<'a, str>>,
    ) -> Self {
        self.rows.push(Row::new(None, indent, label, value));
        self
    }

    /// Adds a row with optional presentation metadata.
    #[inline(always)]
    #[must_use]
    pub(crate) fn marked_row(
        mut self,
        marker: Option<String>,
        indent: u8,
        label: &'static str,
        value: impl Into<Cow<'a, str>>,
    ) -> Self {
        self.rows.push(Row::new(marker.map(Cow::Owned), indent, label, value));
        self
    }

    #[inline(always)]
    fn write_to(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()> {
        if mode.is_styled() {
            writeln!(out, "{TITLE}{}{TITLE:#}", self.title)?;
        } else {
            writeln!(out, "{}", self.title)?;
        }
        for row in &self.rows {
            row.write_to(out, mode)?;
        }
        Ok(())
    }
}

impl Component for Section<'_> {
    #[inline(always)]
    fn render(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()> {
        self.write_to(out, mode)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Row<'a> {
    marker: Option<Cow<'a, str>>,
    indent: u8,
    label: &'static str,
    value: Cow<'a, str>,
}

impl<'a> Row<'a> {
    #[inline(always)]
    fn new(
        marker: Option<Cow<'a, str>>,
        indent: u8,
        label: &'static str,
        value: impl Into<Cow<'a, str>>,
    ) -> Self {
        Self { marker, indent, label, value: value.into() }
    }

    fn write_to(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()> {
        let indent = self.indent_width();
        let lead = indent.spaces();
        let marker = self.marker_width();
        let pad =
            LABEL_WIDTH.saturating_sub(indent + marker + CellStr::new(self.label).width()).spaces();
        if mode.is_styled() {
            match &self.marker {
                Some(marker) => writeln!(
                    out,
                    "  {lead}{ACCENT}{marker}{ACCENT:#}  {LABEL}{}{LABEL:#}{pad}{VALUE}{}{VALUE:#}",
                    self.label, self.value
                )?,
                None => writeln!(
                    out,
                    "  {lead}{LABEL}{}{LABEL:#}{pad}{VALUE}{}{VALUE:#}",
                    self.label, self.value
                )?,
            }
            return Ok(());
        }
        match &self.marker {
            Some(marker) => writeln!(out, "  {lead}{marker}  {}{pad}{}", self.label, self.value),
            None => writeln!(out, "  {lead}{}{pad}{}", self.label, self.value),
        }
    }

    #[inline(always)]
    fn indent_width(&self) -> Columns {
        Columns::new(usize::from(self.indent) * INDENT_WIDTH)
    }

    #[inline(always)]
    fn marker_width(&self) -> Columns {
        self.marker
            .as_deref()
            .map(|marker| CellStr::new(marker).width() + Columns::new(2))
            .unwrap_or_default()
    }
}
