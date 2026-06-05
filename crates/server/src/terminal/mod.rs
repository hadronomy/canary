//! Small terminal rendering pieces shared by Canary commands.
//!
//! The module keeps cards, sections, symbols, and styling in one place so CLI
//! commands can describe their output without rebuilding the same borders and
//! spacing each time.

mod card;
mod layout;
mod section;
mod style;

use std::io::{self, Write};

pub(crate) use card::Card;
pub(crate) use layout::{CellStr, Columns};
pub(crate) use section::Section;

/// Terminal styling mode for a rendered component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Plain,
    Styled,
}

impl Mode {
    #[inline(always)]
    pub(crate) const fn is_styled(self) -> bool {
        matches!(self, Self::Styled)
    }
}

/// A terminal component that knows how to render itself.
pub(crate) trait Component {
    /// Writes the component to `out`.
    ///
    /// # Errors
    ///
    /// Returns an error when the output stream cannot accept the complete
    /// component.
    fn render(&self, out: &mut dyn Write, mode: Mode) -> io::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::{Card, CellStr, Component, Mode, Section};

    #[test]
    fn components_render_through_the_shared_trait() {
        let card = Card::new("canary", "ready").row("✓", "state", "ok");
        let section = Section::new("Details").row("listener", "http://127.0.0.1:8080");
        let mut out = Vec::new();

        for component in [&card as &dyn Component, &section as &dyn Component] {
            component.render(&mut out, Mode::Plain).unwrap();
        }
        let out = String::from_utf8(out).unwrap();

        assert!(out.contains("canary"));
        assert!(out.contains("Details"));
    }

    #[test]
    fn cards_align_by_terminal_columns() {
        let card = Card::new("canary config", "effective")
            .row("◇", "source", "./.tmp/canary-rustfs.toml")
            .row("└", "overlays", "environment");
        let mut out = Vec::new();

        card.render(&mut out, Mode::Plain).unwrap();
        let out = String::from_utf8(out).unwrap();
        let widths = out.lines().map(|line| CellStr::new(line).width()).collect::<Vec<_>>();

        assert!(widths.windows(2).all(|pair| pair[0] == pair[1]), "{out}");
    }
}
