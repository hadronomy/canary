use std::ops::Add;

use unicode_width::UnicodeWidthStr;

/// Width measured in terminal display columns.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Columns(usize);

impl Columns {
    #[inline(always)]
    pub(crate) const fn new(value: usize) -> Self {
        Self(value)
    }

    #[inline(always)]
    pub(crate) const fn max(self, rhs: Self) -> Self {
        if self.0 >= rhs.0 { self } else { rhs }
    }

    #[inline(always)]
    pub(crate) const fn saturating_sub(self, rhs: Self) -> Self {
        Self(self.0.saturating_sub(rhs.0))
    }

    #[inline(always)]
    pub(crate) fn spaces(self) -> String {
        " ".repeat(self.0)
    }

    #[inline(always)]
    pub(crate) fn line(self) -> String {
        "─".repeat(self.0)
    }
}

impl Add for Columns {
    type Output = Self;

    #[inline(always)]
    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0.saturating_add(rhs.0))
    }
}

/// Borrowed text measured in terminal display columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CellStr<'a>(&'a str);

impl<'a> CellStr<'a> {
    #[inline(always)]
    pub(crate) const fn new(value: &'a str) -> Self {
        Self(value)
    }

    #[inline(always)]
    pub(crate) fn width(self) -> Columns {
        Columns::new(UnicodeWidthStr::width(self.0))
    }
}
