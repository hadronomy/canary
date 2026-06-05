use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::config::{LogFormat, ObservabilityConfig};
use crate::error::{ServerError, ServerResult};

pub fn init(config: &ObservabilityConfig) -> ServerResult<()> {
    let filter = EnvFilter::try_new(&config.filter)
        .map_err(|source| ServerError::Observability { source: Box::new(source) })?;

    match config.format {
        LogFormat::Pretty => tracing_subscriber::registry()
            .with(filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .with_target(config.include_targets)
                    .with_thread_ids(config.include_thread_ids)
                    .with_thread_names(config.include_thread_names)
                    .compact(),
            )
            .try_init()
            .map_err(|source| ServerError::Observability { source: Box::new(source) }),
        LogFormat::Json => tracing_subscriber::registry()
            .with(filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_target(config.include_targets)
                    .with_thread_ids(config.include_thread_ids)
                    .with_thread_names(config.include_thread_names)
                    .flatten_event(true),
            )
            .try_init()
            .map_err(|source| ServerError::Observability { source: Box::new(source) }),
    }
}
