use std::fmt;
use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use axum::extract::{FromRef, Request};
use database::Database;
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tower::ServiceBuilder;
use tower_http::normalize_path::NormalizePathLayer;

use crate::config::LoadedConfig;
use crate::error::{ServerError, ServerResult};
use crate::files::service::FileService;
use crate::http;
use crate::services::parser::ParserService;
use crate::shutdown::{ShutdownCoordinator, ShutdownReason, wait_for_shutdown_signal};
use crate::state::{AppState, FileState};

#[derive(Debug, Clone, Copy, Default)]
pub struct MissingConfig;

#[derive(Debug, Clone)]
pub struct WithConfig {
    loaded: LoadedConfig,
}

pub struct ServerBuilder<State = MissingConfig> {
    state: State,
}

impl Default for ServerBuilder<MissingConfig> {
    fn default() -> Self {
        Self { state: MissingConfig }
    }
}

impl ServerBuilder<MissingConfig> {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_config(self, loaded: LoadedConfig) -> ServerBuilder<WithConfig> {
        ServerBuilder { state: WithConfig { loaded } }
    }
}

impl ServerBuilder<WithConfig> {
    pub async fn build(self) -> ServerResult<ServerApplication> {
        let loaded = self.state.loaded;
        let shutdown = ShutdownCoordinator::new(loaded.settings.server.shutdown_grace_period);
        let db = Database::connect(&loaded.settings.db).await?;
        db.health().await?;
        let parser = ParserService::new();
        let files = FileService::new(loaded.settings.files.clone(), db.clone()).await?;
        let state = AppState::new(loaded, db, parser, files);
        state.update_db_ready();
        let router = http::router(&state).with_state(state.clone());
        Ok(ServerApplication { state, router, shutdown })
    }
}

pub struct ServerApplication {
    state: AppState,
    router: Router,
    shutdown: ShutdownCoordinator,
}

impl fmt::Debug for ServerApplication {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServerApplication")
            .field("origin", &self.state.loaded_config().origin)
            .field("readiness", &self.state.readiness_snapshot())
            .finish_non_exhaustive()
    }
}

impl ServerApplication {
    pub fn router(&self) -> Router {
        self.router.clone()
    }

    pub async fn run(self) -> ServerResult<()> {
        let Self { state, router, shutdown } = self;
        let loaded_config = state.loaded_config();
        let bind_address = loaded_config.settings.server.bind;
        let request_timeout = loaded_config.settings.server.request_timeout;
        let shutdown_grace_period = loaded_config.settings.server.shutdown_grace_period;

        let listener = TcpListener::bind(bind_address)
            .await
            .map_err(|source| ServerError::Bind { address: bind_address, source })?;
        let local_address = listener
            .local_addr()
            .map_err(|source| ServerError::ListenerIntrospection { source })?;
        state.update_http_ready();
        log_http_listener_ready(
            bind_address,
            local_address,
            request_timeout,
            shutdown_grace_period,
        );

        let service =
            ServiceBuilder::new().layer(NormalizePathLayer::trim_trailing_slash()).service(router);

        let service =
            axum::ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(service);

        let mut tasks = JoinSet::new();
        let uploads = FileState::from_ref(&state).files.uploads();
        let upload_shutdown = shutdown.clone();
        tasks.spawn(async move {
            let mut tick = tokio::time::interval(uploads.sweep_interval());
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = upload_shutdown.wait_for_shutdown() => return Ok::<_, ServerError>(()),
                    _ = tick.tick() => {
                        if let Err(err) = uploads.sweep_expired().await {
                            tracing::warn!(error = %err, "upload cleanup sweep failed");
                        }
                    }
                }
            }
        });
        let signal_shutdown = shutdown.clone();
        tasks.spawn(async move {
            let reason = wait_for_shutdown_signal().await?;
            signal_shutdown.request(reason);
            Ok::<_, ServerError>(())
        });

        let http_shutdown = shutdown.clone();
        tasks.spawn(async move {
            let signal = async move {
                http_shutdown.wait_for_shutdown().await;
            };
            axum::serve(listener, service)
                .with_graceful_shutdown(signal)
                .await
                .map_err(|source| ServerError::Serve { source })
        });

        supervise_tasks(&mut tasks, &shutdown).await
    }
}

fn log_http_listener_ready(
    bind_address: SocketAddr,
    local_address: SocketAddr,
    request_timeout: Duration,
    shutdown_grace_period: Duration,
) {
    tracing::info!(
        component = "http",
        bind_address = %bind_address,
        local_address = %local_address,
        request_timeout = ?request_timeout,
        shutdown_grace_period = ?shutdown_grace_period,
        "http listener ready"
    );
}

async fn supervise_tasks(
    tasks: &mut JoinSet<Result<(), ServerError>>,
    shutdown: &ShutdownCoordinator,
) -> ServerResult<()> {
    while let Some(result) = tasks.join_next().await {
        match result {
            Ok(Ok(())) => {
                shutdown.request(ShutdownReason::ServerStopped);
            }
            Ok(Err(error)) => {
                shutdown.request(ShutdownReason::TaskFailed("server-task".into()));
                return Err(error);
            }
            Err(source) => {
                shutdown.request(ShutdownReason::TaskFailed("server-task".into()));
                return Err(ServerError::TaskJoin { source });
            }
        }
    }
    Ok(())
}
