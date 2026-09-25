use miette::{IntoDiagnostic, Result, WrapErr};
use usage_rs::Args as UsageArgs;

use crate::cli::args::GlobalArgs;
use crate::cli::layer::{self, ConfigArgs};
use crate::{LoadedConfig, ServerBuilder, build_runtime, init_observability};

/// Arguments for `canary serve`.
#[derive(Debug, Clone, Default, UsageArgs)]
pub(in crate::cli) struct Args {
    #[usage(flatten)]
    server: layer::Server,
}

impl ConfigArgs for Args {
    #[inline(always)]
    fn apply(&self, layer: &mut layer::Layer) {
        self.server.apply(layer);
    }
}

pub(in crate::cli) fn run(global: GlobalArgs, args: Args) -> Result<()> {
    let loaded = LoadedConfig::load_with(layer::input(&global, &args))
        .wrap_err("Failed to load server configuration.")?;
    init_observability(&loaded.settings.observability)
        .into_diagnostic()
        .wrap_err("Failed to initialize observability.")?;

    tracing::info!(component = "startup", config_origin = %loaded.origin, "configuration loaded");

    let runtime = build_runtime(&loaded.settings.runtime)
        .into_diagnostic()
        .wrap_err("Failed to build the Tokio runtime.")?;

    runtime
        .block_on(
            async move { ServerBuilder::new().with_config(loaded).build().await?.run().await },
        )
        .into_diagnostic()
        .wrap_err("The server terminated unexpectedly.")
}
