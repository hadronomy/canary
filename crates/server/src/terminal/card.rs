use std::borrow::Cow;
use std::io::{self, Write};

use super::style::{ACCENT, BORDER, LABEL, OK, VALUE, WARN};
use super::{CellStr, Columns, Component, Mode};

const LABEL_WIDTH: Columns = Columns::new(12);
const MIN_WIDTH: Columns = Columns::new(50);
const RIGHT_GUTTER: Columns = Columns::new(2);

/// Bordered status card for short terminal summaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Card<'a> {
    title: Cow<'a, str>,
    status: Cow<'a, str>,
    min: Columns,
    rows: Vec<Row<'a>>,
}

impl<'a> Card<'a> {
    /// Creates a card with a title and right-aligned status label.
    #[inline(always)]
    pub(crate) fn new(title: impl Into<Cow<'a, str>>, status: impl Into<Cow<'a, str>>) -> Self {
        Self { title: title.into(), status: status.into(), min: MIN_WIDTH, rows: Vec::new() }
    }

    /// Sets the minimum content width used by the card.
    #[inline(always)]
    #[must_use]
    pub(crate) fn min(mut self, width: Columns) -> Self {
        self.min = width;
        self
    }

    /// Adds a labeled row.
    #[inline(always)]
    #[must_use]
    pub(crate) fn row(
        mut self,
        symbol: &'static str,
        label: &'static str,
        value: impl Into<Cow<'a, str>>,
    ) -> Self {
        self.rows.push(Row::new(symbol, label, value));
        self
    }

    /// Adds a free-form text row.
    #[inline(always)]
    #[must_use]
    pub(crate) fn text(mut self, value: impl Into<Cow<'a, str>>) -> Self {
        self.rows.push(Row::text(value));
        self
    }

    #[inline(always)]
    fn write_to(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()> {
        let width = self.width();
        self.top(out, width, mode)?;
        self.empty(out, width, mode)?;
        for row in &self.rows {
            row.write_to(out, width, mode)?;
        }
        self.empty(out, width, mode)?;
        self.bottom(out, width, mode)
    }

    #[inline(always)]
    fn width(&self) -> Columns {
        self.rows.iter().map(Row::width).fold(self.header_width().max(self.min), Columns::max)
            + RIGHT_GUTTER
    }

    #[inline(always)]
    fn header_width(&self) -> Columns {
        CellStr::new("─ ").width()
            + CellStr::new(&self.title).width()
            + Columns::new(1)
            + Columns::new(1)
            + CellStr::new(&self.status).width()
            + CellStr::new(" ─").width()
    }

    fn top(&self, out: &mut dyn Write, width: Columns, mode: Mode) -> io::Result<()> {
        let lead = format!("╭─ {} ", self.title);
        let tail = format!(" {} ─╮", self.status);
        let fill = (width + Columns::new(2))
            .saturating_sub(CellStr::new(&lead).width() + CellStr::new(&tail).width())
            .line();
        if mode.is_styled() {
            writeln!(
                out,
                "{BORDER}╭─ {OK}{}{OK:#}{BORDER} {fill} {OK}{}{OK:#}{BORDER} ─╮{BORDER:#}",
                self.title, self.status,
            )?;
            return Ok(());
        }
        writeln!(out, "{lead}{fill}{tail}")
    }

    fn empty(&self, out: &mut dyn Write, width: Columns, mode: Mode) -> io::Result<()> {
        let pad = width.spaces();
        if mode.is_styled() {
            writeln!(out, "{BORDER}│{BORDER:#}{pad}{BORDER}│{BORDER:#}")?;
            return Ok(());
        }
        writeln!(out, "│{pad}│")
    }

    fn bottom(&self, out: &mut dyn Write, width: Columns, mode: Mode) -> io::Result<()> {
        let fill = width.line();
        if mode.is_styled() {
            writeln!(out, "{BORDER}╰{fill}╯{BORDER:#}")?;
            return Ok(());
        }
        writeln!(out, "╰{fill}╯")
    }
}

impl Component for Card<'_> {
    #[inline(always)]
    fn render(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()> {
        self.write_to(out, mode)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Row<'a> {
    symbol: Option<&'static str>,
    label: Option<&'static str>,
    value: Cow<'a, str>,
}

impl<'a> Row<'a> {
    #[inline(always)]
    fn new(symbol: &'static str, label: &'static str, value: impl Into<Cow<'a, str>>) -> Self {
        Self { symbol: Some(symbol), label: Some(label), value: value.into() }
    }

    #[inline(always)]
    fn text(value: impl Into<Cow<'a, str>>) -> Self {
        Self { symbol: None, label: None, value: value.into() }
    }

    #[inline(always)]
    fn width(&self) -> Columns {
        match (self.symbol, self.label) {
            (Some(symbol), Some(label)) => {
                Columns::new(2)
                    + CellStr::new(symbol).width()
                    + Columns::new(1)
                    + LABEL_WIDTH.max(CellStr::new(label).width())
                    + Columns::new(1)
                    + CellStr::new(&self.value).width()
            }
            _ => Columns::new(4) + CellStr::new(&self.value).width(),
        }
    }

    fn write_to(&self, out: &mut dyn Write, width: Columns, mode: Mode) -> io::Result<()> {
        match (self.symbol, self.label) {
            (Some(symbol), Some(label)) => self.write_labeled_to(out, width, mode, symbol, label),
            _ => self.write_text_to(out, width, mode),
        }
    }

    fn write_labeled_to(
        &self,
        out: &mut dyn Write,
        width: Columns,
        mode: Mode,
        symbol: &str,
        label: &str,
    ) -> io::Result<()> {
        let pad = LABEL_WIDTH.saturating_sub(CellStr::new(label).width()).spaces();
        let content = format!("  {symbol} {label}{pad} {}", self.value);
        let tail = width.saturating_sub(CellStr::new(&content).width()).spaces();
        let symbol_style = if symbol == "!" { WARN } else { ACCENT };
        if mode.is_styled() {
            writeln!(
                out,
                "{BORDER}│{BORDER:#}  {symbol_style}{symbol}{symbol_style:#} {LABEL}{label}{LABEL:#}{pad} {VALUE}{}{VALUE:#}{tail}{BORDER}│{BORDER:#}",
                self.value
            )?;
            return Ok(());
        }
        writeln!(out, "│{content}{tail}│")
    }

    fn write_text_to(&self, out: &mut dyn Write, width: Columns, mode: Mode) -> io::Result<()> {
        let content = format!("    {}", self.value);
        let tail = width.saturating_sub(CellStr::new(&content).width()).spaces();
        if mode.is_styled() {
            writeln!(out, "{BORDER}│{BORDER:#}{content}{tail}{BORDER}│{BORDER:#}")?;
            return Ok(());
        }
        writeln!(out, "│{content}{tail}│")
    }
}
