//! Build and revision metadata embedded in the server binary.
//!
//! Canary uses [`shadow-rs`](https://docs.rs/shadow-rs) at compile time. This
//! module turns those generated constants into one small typed value so CLI
//! output, HTTP health responses, MCP metadata, and the startup banner all talk
//! about the same build.

use serde::Serialize;
use shadow_rs::formatcp;

use crate::build;

const REVISION_LABEL: &str = if build::info::GIT_CLEAN {
    build::info::SHORT_COMMIT
} else {
    formatcp!("{}+", build::info::SHORT_COMMIT)
};
const CLI_LABEL: &str = formatcp!("{} ({})", build::info::PKG_VERSION, REVISION_LABEL);
const BANNER_LABEL: &str = formatcp!("v{} ({})", build::info::PKG_VERSION, REVISION_LABEL);

/// Version metadata for the running Canary binary.
///
/// Use [`VERSION`] rather than reading `env!("CARGO_PKG_VERSION")` directly.
/// The package version is only one part of the build identity; the git revision
/// is what lets operators tie a running process back to a source snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Version {
    package: &'static str,
    labels: VersionLabels,
    revision: GitRevision,
    build: BuildMetadata,
}

impl Version {
    /// Returns the semantic package version from Cargo.
    #[inline(always)]
    #[must_use]
    pub const fn package(&self) -> &'static str {
        self.package
    }

    /// Returns the label used by Clap's concise `--version` output.
    #[inline(always)]
    #[must_use]
    pub const fn cli_label(&self) -> &'static str {
        self.labels.cli
    }

    /// Returns the label overlaid into the startup banner.
    #[inline(always)]
    #[must_use]
    pub const fn banner_label(&self) -> &'static str {
        self.labels.banner
    }

    /// Returns git revision metadata captured at compile time.
    #[inline(always)]
    #[must_use]
    pub const fn revision(&self) -> GitRevision {
        self.revision
    }

    /// Returns Rust and build-time metadata captured at compile time.
    #[inline(always)]
    #[must_use]
    pub const fn build(&self) -> BuildMetadata {
        self.build
    }

    /// Returns a serializable report for `canary version`.
    #[inline(always)]
    #[must_use]
    pub const fn report(&self) -> VersionReport<'_> {
        VersionReport {
            version: self.package,
            revision: self.revision.short,
            commit: self.revision.full,
            branch: self.revision.branch,
            tag: self.revision.tag,
            dirty: !self.revision.clean,
            build_time: self.build.time,
            rust_version: self.build.rust,
            rust_channel: self.build.rust_channel,
            build_channel: self.build.build_channel,
        }
    }
}

/// Human-facing version labels derived from the same metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VersionLabels {
    cli: &'static str,
    banner: &'static str,
}

impl VersionLabels {
    #[inline(always)]
    const fn new(cli: &'static str, banner: &'static str) -> Self {
        Self { cli, banner }
    }
}

/// Git revision captured when the binary was compiled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GitRevision {
    short: &'static str,
    full: &'static str,
    branch: &'static str,
    tag: &'static str,
    clean: bool,
}

impl GitRevision {
    /// Returns the short commit hash, with no dirty marker.
    #[inline(always)]
    #[must_use]
    pub const fn short(&self) -> &'static str {
        self.short
    }

    /// Returns the full commit hash.
    #[inline(always)]
    #[must_use]
    pub const fn full(&self) -> &'static str {
        self.full
    }

    /// Returns the branch recorded by `shadow-rs`.
    #[inline(always)]
    #[must_use]
    pub const fn branch(&self) -> &'static str {
        self.branch
    }

    /// Returns the tag recorded by `shadow-rs`, if any.
    #[inline(always)]
    #[must_use]
    pub const fn tag(&self) -> &'static str {
        self.tag
    }

    /// Returns whether the repository was clean at build time.
    #[inline(always)]
    #[must_use]
    pub const fn is_clean(&self) -> bool {
        self.clean
    }

    /// Returns whether the repository had uncommitted changes at build time.
    #[inline(always)]
    #[must_use]
    pub const fn is_dirty(&self) -> bool {
        !self.clean
    }
}

/// Rust compiler and build-time metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildMetadata {
    time: &'static str,
    rust: &'static str,
    rust_channel: &'static str,
    build_channel: &'static str,
}

impl BuildMetadata {
    /// Returns the build timestamp recorded by `shadow-rs`.
    #[inline(always)]
    #[must_use]
    pub const fn time(&self) -> &'static str {
        self.time
    }

    /// Returns the `rustc` version used for the build.
    #[inline(always)]
    #[must_use]
    pub const fn rust(&self) -> &'static str {
        self.rust
    }

    /// Returns the Rust toolchain channel.
    #[inline(always)]
    #[must_use]
    pub const fn rust_channel(&self) -> &'static str {
        self.rust_channel
    }

    /// Returns the Cargo build profile channel.
    #[inline(always)]
    #[must_use]
    pub const fn build_channel(&self) -> &'static str {
        self.build_channel
    }
}

/// Serializable build report printed by `canary version`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct VersionReport<'a> {
    pub version: &'a str,
    pub revision: &'a str,
    pub commit: &'a str,
    pub branch: &'a str,
    pub tag: &'a str,
    pub dirty: bool,
    pub build_time: &'a str,
    pub rust_version: &'a str,
    pub rust_channel: &'a str,
    pub build_channel: &'a str,
}

/// Version metadata for the running binary.
pub const VERSION: Version = Version {
    package: build::info::PKG_VERSION,
    labels: VersionLabels::new(CLI_LABEL, BANNER_LABEL),
    revision: GitRevision {
        short: build::info::SHORT_COMMIT,
        full: build::info::COMMIT_HASH,
        branch: build::info::BRANCH,
        tag: build::info::TAG,
        clean: build::info::GIT_CLEAN,
    },
    build: BuildMetadata {
        time: build::info::BUILD_TIME_3339,
        rust: build::info::RUST_VERSION,
        rust_channel: build::info::RUST_CHANNEL,
        build_channel: build::info::BUILD_RUST_CHANNEL,
    },
};

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn concise_label_contains_version_and_revision() {
        assert!(VERSION.cli_label().contains(VERSION.package()));
        assert!(VERSION.cli_label().contains(VERSION.revision().short()));
    }

    #[test]
    fn banner_label_is_prefixed_for_the_wordmark() {
        assert!(VERSION.banner_label().starts_with('v'));
        assert!(VERSION.banner_label().contains(VERSION.revision().short()));
    }
}
