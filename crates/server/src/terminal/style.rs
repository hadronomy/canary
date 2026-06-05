use anstyle::{AnsiColor, Effects};

pub(super) const ACCENT: anstyle::Style = AnsiColor::Green.on_default();
pub(super) const BORDER: anstyle::Style = AnsiColor::Green.on_default().effects(Effects::DIMMED);
pub(super) const LABEL: anstyle::Style = AnsiColor::BrightBlack.on_default();
pub(super) const OK: anstyle::Style = AnsiColor::BrightGreen.on_default().effects(Effects::BOLD);
pub(super) const WARN: anstyle::Style = AnsiColor::Yellow.on_default().effects(Effects::BOLD);
pub(super) const TITLE: anstyle::Style = AnsiColor::Green.on_default().effects(Effects::BOLD);
pub(super) const VALUE: anstyle::Style = anstyle::Style::new();
