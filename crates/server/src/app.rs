use std::fmt;
use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use axum::extract::Request;
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tower::ServiceBuilder;
use tower_http::normalize_path::NormalizePathLayer;

use crate::config::LoadedConfig;
use crate::db::service::DatabaseService;
use crate::error::{AppError, AppResult};
use crate::files::service::FileService;
use crate::http;
use crate::services::parser::ParserService;
use crate::shutdown::{ShutdownCoordinator, ShutdownReason, wait_for_shutdown_signal};
use crate::state::AppState;

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
    pub async fn build(self) -> AppResult<ServerApplication> {
        let loaded = self.state.loaded;
        let shutdown = ShutdownCoordinator::new(loaded.settings.server.shutdown_grace_period);
        let db = DatabaseService::connect(&loaded.settings.db).await?;
        db.health().await?;
        let parser = ParserService::new();
        let files = FileService::new(loaded.settings.files.clone()).await?;
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

    pub async fn run(self) -> AppResult<()> {
        let Self { state, router, shutdown } = self;
        let bind_address = state.loaded_config().settings.server.bind;
        let request_timeout = state.loaded_config().settings.server.request_timeout;
        let shutdown_grace_period = state.loaded_config().settings.server.shutdown_grace_period;

        let listener = TcpListener::bind(bind_address)
            .await
            .map_err(|source| AppError::Bind { address: bind_address, source })?;
        let local_address = listener.local_addr().map_err(|source| {
            AppError::internal("listener_introspection_error", "failed to inspect bound listener")
                .with_source(source)
        })?;
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
        let signal_shutdown = shutdown.clone();
        tasks.spawn(async move {
            let reason = wait_for_shutdown_signal().await?;
            signal_shutdown.request(reason);
            Ok::<_, AppError>(())
        });

        let http_shutdown = shutdown.clone();
        tasks.spawn(async move {
            let signal = async move {
                http_shutdown.wait_for_shutdown().await;
            };
            axum::serve(listener, service)
                .with_graceful_shutdown(signal)
                .await
                .map_err(|source| AppError::Serve { source })
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
    tasks: &mut JoinSet<Result<(), AppError>>,
    shutdown: &ShutdownCoordinator,
) -> AppResult<()> {
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
                return Err(AppError::TaskJoin { source });
            }
        }
    }
    Ok(())
}
