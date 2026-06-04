//! Compile-time generated terminal wordmark for the Canary server.
//!
//! [`BANNER`] is ready to print when the process starts. FIGfont parsing stays
//! in the build script, leaving startup with static text and a small terminal
//! write.

use std::fmt;
use std::io::{self, Write};
use std::net::SocketAddr;

use anstyle::{AnsiColor, Effects};

use crate::{ConfigOrigin, EnvironmentLayer, LoadedConfig, build};

const LAYOUT: (usize, usize) = include!(concat!(env!("OUT_DIR"), "/banner-layout.rs"));
const ACCENT: anstyle::Style = AnsiColor::Green.on_default();
const BORDER: anstyle::Style = AnsiColor::Green.on_default().effects(Effects::DIMMED);
const LABEL: anstyle::Style = AnsiColor::BrightBlack.on_default();
const READY: anstyle::Style = AnsiColor::BrightGreen.on_default().effects(Effects::BOLD);
const VALUE: anstyle::Style = anstyle::Style::new();
const LABEL_WIDTH: usize = 8;
const MIN_CARD_WIDTH: usize = 46;

/// A compile-time embedded terminal banner.
///
/// `Banner` keeps terminal output details out of startup code. Use [`BANNER`]
/// for the Canary server's generated wordmark.
///
/// # Examples
///
/// ```no_run
/// use canary_server::{BANNER, LoadedConfig};
///
/// let config = LoadedConfig::default();
/// let listener = ([127, 0, 0, 1], 8080).into();
///
/// BANNER.print(&config, listener)?;
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

    /// Writes a plain-text startup banner to `out` without flushing it.
    ///
    /// Use [`Self::print`] for the server startup path. Use this method when
    /// composing the banner with another writer or buffer that should never
    /// receive terminal styling.
    ///
    /// # Errors
    ///
    /// Returns an error when `out` cannot accept the complete banner.
    #[inline(always)]
    pub fn write_to(
        &self,
        out: &mut impl Write,
        config: &LoadedConfig,
        listener: SocketAddr,
    ) -> io::Result<()> {
        self.write_plain_wordmark_to(out)?;
        BannerStatus::new(&config.origin, listener).write_plain_to(out, self.width())
    }

    /// Prints the startup banner with adaptive terminal styling and flushes it.
    ///
    /// The version and readiness card are green on capable terminals.
    /// Redirected output remains plain text so process supervisors and
    /// container logs do not receive ANSI escape codes. The explicit flush
    /// keeps the startup state visible immediately.
    ///
    /// # Errors
    ///
    /// Returns an error when standard output cannot accept or flush the
    /// complete banner.
    pub fn print(&self, config: &LoadedConfig, listener: SocketAddr) -> io::Result<()> {
        let mut out = anstream::stdout().lock();
        self.write_styled_to(&mut out, config, listener)?;
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

    #[inline(always)]
    fn write_plain_wordmark_to(&self, out: &mut impl Write) -> io::Result<()> {
        write!(out, "{self}")
    }

    fn write_styled_to(
        &self,
        out: &mut impl Write,
        config: &LoadedConfig,
        listener: SocketAddr,
    ) -> io::Result<()> {
        for (row, line) in self.art().lines().enumerate() {
            if row == self.row {
                writeln!(out, "{}{ACCENT}v{}{ACCENT:#}", self.prefix(line), self.version())?;
                continue;
            }
            writeln!(out, "{line}")?;
        }
        BannerStatus::new(&config.origin, listener).write_styled_to(out, self.width())
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

/// Startup details rendered below the generated wordmark.
///
/// The status card keeps the config source and bound listener near the banner,
/// where operators naturally look first when a server starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BannerStatus<'a> {
    origin: &'a ConfigOrigin,
    listener: SocketAddr,
}

impl<'a> BannerStatus<'a> {
    /// Creates a status card for the loaded config and final listener address.
    #[inline(always)]
    #[must_use]
    pub(crate) const fn new(origin: &'a ConfigOrigin, listener: SocketAddr) -> Self {
        Self { origin, listener }
    }

    fn write_plain_to(&self, out: &mut impl Write, width: usize) -> io::Result<()> {
        let config = self.config();
        let overlay = self.overlay();
        let listener = self.listener();
        let width = card_width(width, [&config, overlay, &listener]);
        writeln!(out)?;
        write_top(out, width, false)?;
        write_empty(out, width, false)?;
        write_row(out, width, "◇", "config", &config, false)?;
        write_row(out, width, "└", "overlay", overlay, false)?;
        write_row(out, width, "⊙", "listener", &listener, false)?;
        write_empty(out, width, false)?;
        write_bottom(out, width, false)
    }

    fn write_styled_to(&self, out: &mut impl Write, width: usize) -> io::Result<()> {
        let config = self.config();
        let overlay = self.overlay();
        let listener = self.listener();
        let width = card_width(width, [&config, overlay, &listener]);
        writeln!(out)?;
        write_top(out, width, true)?;
        write_empty(out, width, true)?;
        write_row(out, width, "◇", "config", &config, true)?;
        write_row(out, width, "└", "overlay", overlay, true)?;
        write_row(out, width, "⊙", "listener", &listener, true)?;
        write_empty(out, width, true)?;
        write_bottom(out, width, true)
    }

    fn config(&self) -> String {
        match self.origin.files.as_slice() {
            [] => "defaults".into(),
            [file] => file.display().to_string(),
            files => {
                files.iter().map(|file| file.display().to_string()).collect::<Vec<_>>().join(", ")
            }
        }
    }

    #[inline(always)]
    fn overlay(&self) -> &'static str {
        match self.origin.environment {
            EnvironmentLayer::Present => "environment",
            EnvironmentLayer::Absent => "none",
        }
    }

    #[inline(always)]
    fn listener(&self) -> String {
        format!("http://{}", self.listener)
    }
}

fn write_top(out: &mut impl Write, width: usize, styled: bool) -> io::Result<()> {
    let left = "╭─ canary ";
    let right = " ready ─╮";
    let fill = "─".repeat((width + 2).saturating_sub(chars(left) + chars(right)));
    if styled {
        writeln!(
            out,
            "{BORDER}╭─ {READY}canary{READY:#}{BORDER} {fill} {READY}ready{READY:#}{BORDER} ─╮{BORDER:#}"
        )?;
        return Ok(());
    }
    writeln!(out, "{left}{fill}{right}")
}

fn write_empty(out: &mut impl Write, width: usize, styled: bool) -> io::Result<()> {
    let pad = " ".repeat(width);
    if styled {
        writeln!(out, "{BORDER}│{BORDER:#}{pad}{BORDER}│{BORDER:#}")?;
        return Ok(());
    }
    writeln!(out, "│{pad}│")
}

fn write_row(
    out: &mut impl Write,
    width: usize,
    symbol: &str,
    label: &str,
    value: &str,
    styled: bool,
) -> io::Result<()> {
    let label_pad = " ".repeat(LABEL_WIDTH.saturating_sub(label.len()));
    let content = format!("  {symbol} {label}{label_pad} {value}");
    let pad = " ".repeat(width.saturating_sub(chars(&content)));
    if styled {
        writeln!(
            out,
            "{BORDER}│{BORDER:#}  {ACCENT}{symbol}{ACCENT:#} {LABEL}{label}{LABEL:#}{label_pad} {VALUE}{value}{VALUE:#}{pad}{BORDER}│{BORDER:#}"
        )?;
        return Ok(());
    }
    writeln!(out, "│{content}{pad}│")
}

fn write_bottom(out: &mut impl Write, width: usize, styled: bool) -> io::Result<()> {
    let fill = "─".repeat(width);
    if styled {
        writeln!(out, "{BORDER}╰{fill}╯{BORDER:#}")?;
        return Ok(());
    }
    writeln!(out, "╰{fill}╯")
}

#[inline(always)]
fn card_width(wordmark: usize, values: [&str; 3]) -> usize {
    values.into_iter().map(row_width).fold(wordmark.max(MIN_CARD_WIDTH), usize::max)
}

#[inline(always)]
fn row_width(value: &str) -> usize {
    2 + 1 + 1 + LABEL_WIDTH + 1 + chars(value)
}

#[inline(always)]
fn chars(value: &str) -> usize {
    value.chars().count()
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
    use std::path::PathBuf;

    use super::Banner;
    use crate::{ConfigOrigin, EnvironmentLayer, LoadedConfig};

    #[test]
    fn overlays_version_inside_requested_row() {
        assert_eq!(Banner::new("----\ntail\n", "1", 4, 0).to_string(), "--v1\ntail\n");
    }

    #[test]
    fn renders_startup_status_under_wordmark() {
        let config = LoadedConfig {
            origin: ConfigOrigin {
                files: vec![PathBuf::from("./.tmp/canary-rustfs.toml")],
                environment: EnvironmentLayer::Present,
            },
            ..LoadedConfig::default()
        };
        let mut out = Vec::new();
        Banner::new("----\ntail\n", "1", 4, 0)
            .write_to(&mut out, &config, ([127, 0, 0, 1], 8080).into())
            .unwrap();
        let out = String::from_utf8(out).unwrap();

        assert!(out.contains("◇ config"));
        assert!(out.contains("./.tmp/canary-rustfs.toml"));
        assert!(out.contains("└ overlay"));
        assert!(out.contains("environment"));
        assert!(out.contains("⊙ listener"));
        assert!(out.contains("http://127.0.0.1:8080"));
    }
}
