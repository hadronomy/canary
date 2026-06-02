//! Compile-time generated terminal wordmark for the Canary server.
//!
//! [`BANNER`] is ready to print when the process starts. FIGfont parsing stays
//! in the build script, leaving startup with static text and a small terminal
//! write.

use std::fmt;
use std::io::{self, Write};

use anstyle::AnsiColor;

use crate::build;

const LAYOUT: (usize, usize) = include!(concat!(env!("OUT_DIR"), "/banner-layout.rs"));
const STYLE: anstyle::Style = AnsiColor::Green.on_default();

/// A compile-time embedded terminal banner.
///
/// `Banner` keeps terminal output details out of startup code. Use [`BANNER`]
/// for the Canary server's generated wordmark.
///
/// # Examples
///
/// ```no_run
/// use canary_server::BANNER;
///
/// BANNER.print()?;
///
/// # Ok::<(), std::io::Error>(())
/// ```
#[doc(alias = "figlet")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Banner {
    art: &'static str,
    version: &'static str,
    width: usize,
    row: usize,
}

impl Banner {
    #[inline(always)]
    const fn new(art: &'static str, version: &'static str, width: usize, row: usize) -> Self {
        Self { art, version, width, row }
    }

    /// Returns the raw embedded FIGlet art before the version is overlaid.
    #[inline(always)]
    #[must_use]
    pub const fn art(&self) -> &'static str {
        self.art
    }

    /// Returns the package version displayed inside the FIGlet art.
    #[inline(always)]
    #[must_use]
    pub const fn version(&self) -> &'static str {
        self.version
    }

    /// Returns the width of the widest FIGlet row.
    #[inline(always)]
    #[must_use]
    pub const fn width(&self) -> usize {
        self.width
    }

    /// Writes a plain-text banner to `out` without flushing it.
    ///
    /// Use [`Self::print`] for the server startup path. Use this method when
    /// composing the banner with another writer or buffer that should never
    /// receive terminal styling.
    ///
    /// # Errors
    ///
    /// Returns an error when `out` cannot accept the complete banner.
    #[inline(always)]
    pub fn write_to(&self, out: &mut impl Write) -> io::Result<()> {
        write!(out, "{self}")
    }

    /// Prints the banner with an adaptive green version and flushes it.
    ///
    /// The version is green on capable terminals. Redirected output remains
    /// plain text so process supervisors and container logs do not receive
    /// ANSI escape codes. The explicit flush keeps the wordmark visible
    /// immediately.
    ///
    /// # Errors
    ///
    /// Returns an error when standard output cannot accept or flush the
    /// complete banner.
    pub fn print(&self) -> io::Result<()> {
        let mut out = anstream::stdout().lock();
        self.write_styled_to(&mut out)?;
        out.flush()
    }

    #[inline(always)]
    fn padding(&self) -> usize {
        self.width().saturating_sub(self.version().len() + 1)
    }

    #[inline(always)]
    fn prefix<'a>(&self, line: &'a str) -> &'a str {
        &line[..line.len().min(self.padding())]
    }

    fn write_styled_to(&self, out: &mut impl Write) -> io::Result<()> {
        for (row, line) in self.art().lines().enumerate() {
            if row == self.row {
                writeln!(out, "{}{STYLE}v{}{STYLE:#}", self.prefix(line), self.version())?;
                continue;
            }
            writeln!(out, "{line}")?;
        }
        Ok(())
    }
}

impl fmt::Display for Banner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (row, line) in self.art().lines().enumerate() {
            if row == self.row {
                writeln!(f, "{}v{}", self.prefix(line), self.version())?;
                continue;
            }
            writeln!(f, "{line}")?;
        }
        Ok(())
    }
}

/// The Canary server wordmark generated during compilation.
///
/// The server binary embeds the generated text directly. Printing this value
/// performs no font parsing and reads no files at startup.
pub const BANNER: Banner = Banner::new(
    include_str!(concat!(env!("OUT_DIR"), "/banner.txt")),
    build::info::PKG_VERSION,
    LAYOUT.0,
    LAYOUT.1,
);

#[cfg(test)]
mod tests {
    use super::Banner;

    #[test]
    fn overlays_version_inside_requested_row() {
        assert_eq!(Banner::new("----\ntail\n", "1", 4, 0).to_string(), "--v1\ntail\n");
    }
}
