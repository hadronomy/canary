use canary_server::{BANNER, LoadedConfig, ServerBuilder, build_runtime, init_observability};
use miette::{IntoDiagnostic, MietteHandlerOpts, Result, WrapErr};

fn main() -> Result<()> {
    human_panic::setup_panic!();
    install_diagnostics()?;
    let loaded = LoadedConfig::load().wrap_err("Failed to load server configuration.")?;
    BANNER.print().into_diagnostic().wrap_err("Failed to print banner.")?;
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

fn install_diagnostics() -> Result<()> {
    miette::set_hook(Box::new(|_| {
        Box::new(MietteHandlerOpts::new().terminal_links(true).context_lines(2).build())
    }))
    .into_diagnostic()
    .wrap_err("Failed to install the miette report handler.")
}
