use std::net::SocketAddr;
use std::path::PathBuf;

use usage_rs::Args as UsageArgs;

use crate::config::{
    ConfigInput, ConfigOverrides, ConfigPath, ConfigPathSource, LogFormat, ServerOverrides,
};

/// Parsed CLI values that contribute to the resolved server config.
pub(in crate::cli) trait ConfigArgs {
    fn apply(&self, layer: &mut Layer);
}

pub(in crate::cli) fn input(global: &impl ConfigArgs, command: &impl ConfigArgs) -> ConfigInput {
    let mut layer = Layer::default();
    global.apply(&mut layer);
    command.apply(&mut layer);
    layer.finish()
}

/// Accumulates CLI config patches before handing them to the config loader.
#[derive(Debug, Clone, Default)]
pub(in crate::cli) struct Layer {
    path: ConfigPath,
    overrides: ConfigOverrides,
}

impl Layer {
    #[inline(always)]
    pub(in crate::cli) fn path(&mut self, path: Option<PathBuf>) {
        self.path = path
            .map(|path| ConfigPath::Explicit { source: ConfigPathSource::Cli, path })
            .unwrap_or_default();
    }

    #[inline(always)]
    pub(in crate::cli) fn filter(&mut self, filter: Option<String>) {
        self.overrides.observability.filter = filter;
    }

    #[inline(always)]
    pub(in crate::cli) fn format(&mut self, format: Option<LogFormat>) {
        self.overrides.observability.format = format;
    }

    #[inline(always)]
    fn finish(self) -> ConfigInput {
        ConfigInput::new(self.path, self.overrides)
    }
}

/// Server config flags shared by commands that resolve a server configuration.
#[derive(Debug, Clone, Copy, Default, UsageArgs)]
pub(in crate::cli) struct Server {
    /// Socket address the HTTP and MCP server should bind.
    #[usage(long, value_name = "ADDR")]
    bind: Option<SocketAddr>,

    /// Request timeout, for example 30s or 2m.
    #[usage(long, value_name = "DURATION")]
    request_timeout: Option<humantime::Duration>,

    /// Grace period used during shutdown.
    #[usage(long, value_name = "DURATION")]
    shutdown_grace_period: Option<humantime::Duration>,

    /// Maximum accepted HTTP request body size.
    #[usage(long, value_name = "BYTES")]
    max_body_size_bytes: Option<usize>,
}

impl ConfigArgs for Server {
    fn apply(&self, layer: &mut Layer) {
        layer.overrides.server = ServerOverrides {
            bind: self.bind,
            request_timeout: self.request_timeout.map(Into::into),
            shutdown_grace_period: self.shutdown_grace_period.map(Into::into),
            max_body_size_bytes: self.max_body_size_bytes,
        };
    }
}
