use canary_server::{AppError, LoadedConfig, ServerBuilder, build_runtime, init_observability};

fn main() -> Result<(), AppError> {
    human_panic::setup_panic!();
    let loaded = LoadedConfig::load()?;
    init_observability(&loaded.settings.observability)?;

    tracing::info!(component = "startup", config_origin = %loaded.origin, "configuration loaded");

    let runtime = build_runtime(&loaded.settings.runtime)?;

    runtime.block_on(
        async move { ServerBuilder::new().with_config(loaded).build().await?.run().await },
    )
}
