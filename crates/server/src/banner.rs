//! Compile-time generated terminal wordmark for the Canary server.
//!
//! [`BANNER`] is ready to print when the process starts. FIGfont parsing stays
//! in the build script, leaving startup with static text and a small terminal
//! write.

use std::fmt;
use std::io::{self, Write};
use std::net::SocketAddr;

use anstyle::AnsiColor;

use crate::terminal::{Card, Columns, Component, Mode};
use crate::{ConfigOrigin, LoadedConfig, VERSION, Version};

const LAYOUT: (usize, usize) = include!(concat!(env!("OUT_DIR"), "/banner-layout.rs"));
const ACCENT: anstyle::Style = AnsiColor::Green.on_default();

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
    version: Version,
    width: usize,
    row: usize,
}

impl Banner {
    #[inline(always)]
    const fn new(art: &'static str, version: Version, width: usize, row: usize) -> Self {
        Self { art, version, width, row }
    }

    /// Returns the raw embedded FIGlet art before the version is overlaid.
    #[inline(always)]
    #[must_use]
    pub const fn art(&self) -> &'static str {
        self.art
    }

    /// Returns the build version displayed inside the FIGlet art.
    #[inline(always)]
    #[must_use]
    pub const fn version(&self) -> Version {
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
        self.width().saturating_sub(self.version().banner_label().len())
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
                writeln!(
                    out,
                    "{}{ACCENT}{}{ACCENT:#}",
                    self.prefix(line),
                    self.version().banner_label()
                )?;
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
                writeln!(f, "{}{}", self.prefix(line), self.version().banner_label())?;
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
        writeln!(out)?;
        self.card(Columns::new(width)).render(out, Mode::Plain)
    }

    fn write_styled_to(&self, out: &mut impl Write, width: usize) -> io::Result<()> {
        writeln!(out)?;
        self.card(Columns::new(width)).render(out, Mode::Styled)
    }

    fn card(&self, width: Columns) -> Card<'static> {
        Card::new("canary", "ready")
            .min(width)
            .row("◇", "config", self.config())
            .row("└", "overlay", self.overlay())
            .row("⊙", "listener", self.listener())
    }

    fn config(&self) -> String {
        self.origin.selected_label()
    }

    #[inline(always)]
    fn overlay(&self) -> String {
        self.origin.overlay_label().into()
    }

    #[inline(always)]
    fn listener(&self) -> String {
        format!("http://{}", self.listener)
    }
}

/// The Canary server wordmark generated during compilation.
///
/// The server binary embeds the generated text directly. Printing this value
/// performs no font parsing and reads no files at startup.
pub const BANNER: Banner =
    Banner::new(include_str!(concat!(env!("OUT_DIR"), "/banner.txt")), VERSION, LAYOUT.0, LAYOUT.1);

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::Banner;
    use crate::{ConfigOrigin, EnvironmentLayer, LoadedConfig, VERSION};

    #[test]
    fn overlays_version_inside_requested_row() {
        assert_eq!(
            Banner::new("----\ntail\n", VERSION, 4, 0).to_string(),
            format!("{}\ntail\n", VERSION.banner_label())
        );
    }

    #[test]
    fn renders_startup_status_under_wordmark() {
        let config = LoadedConfig {
            origin: ConfigOrigin {
                files: vec![PathBuf::from("./.tmp/canary-rustfs.toml")],
                environment: EnvironmentLayer::Present,
                ..ConfigOrigin::default()
            },
            ..LoadedConfig::default()
        };
        let mut out = Vec::new();
        Banner::new("----\ntail\n", VERSION, 4, 0)
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
