use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::FromRef;
use chrono::{DateTime, Utc};
use database::Database;
use serde::Serialize;
use tokio::sync::watch;

use crate::config::LoadedConfig;
use crate::files::service::FileService;
use crate::services::parser::ParserService;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    loaded: LoadedConfig,
    started_at: DateTime<Utc>,
    started_at_instant: Instant,
    readiness: Readiness,
    db: Database,
    parser: ParserService,
    files: FileService,
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AppState")
            .field("origin", &self.inner.loaded.origin)
            .field("started_at", &self.inner.started_at)
            .field("readiness", &self.readiness_snapshot())
            .finish_non_exhaustive()
    }
}

impl AppState {
    pub fn new(
        loaded: LoadedConfig,
        db: Database,
        parser: ParserService,
        files: FileService,
    ) -> Self {
        let readiness = Readiness::new(ReadinessSnapshot {
            overall: ReadinessLevel::Starting,
            http: ComponentReadiness::starting(),
            db: ComponentReadiness::starting(),
        });
        Self {
            inner: Arc::new(AppStateInner {
                loaded,
                started_at: Utc::now(),
                started_at_instant: Instant::now(),
                readiness,
                db,
                parser,
                files,
            }),
        }
    }

    #[must_use]
    pub fn loaded_config(&self) -> &LoadedConfig {
        &self.inner.loaded
    }

    #[must_use]
    pub fn started_at(&self) -> DateTime<Utc> {
        self.inner.started_at
    }

    #[must_use]
    pub fn uptime(&self) -> Duration {
        self.inner.started_at_instant.elapsed()
    }

    #[must_use]
    pub fn readiness_snapshot(&self) -> ReadinessSnapshot {
        self.inner.readiness.snapshot()
    }

    pub fn update_http_ready(&self) {
        self.inner.readiness.update_http(ComponentReadiness::ready("listening"));
    }

    pub fn update_db_ready(&self) {
        self.inner.readiness.update_db(ComponentReadiness::ready("connected"));
    }
}

#[derive(Debug, Clone)]
struct Readiness {
    sender: watch::Sender<ReadinessSnapshot>,
}

impl Readiness {
    fn new(snapshot: ReadinessSnapshot) -> Self {
        let (sender, _) = watch::channel(snapshot);
        Self { sender }
    }

    fn snapshot(&self) -> ReadinessSnapshot {
        self.sender.borrow().clone()
    }

    fn update_http(&self, readiness: ComponentReadiness) {
        self.sender.send_modify(|snapshot| {
            snapshot.http = readiness;
            snapshot.recompute();
        });
    }

    fn update_db(&self, readiness: ComponentReadiness) {
        self.sender.send_modify(|snapshot| {
            snapshot.db = readiness;
            snapshot.recompute();
        });
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessLevel {
    Ready,
    Starting,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentReadiness {
    pub level: ReadinessLevel,
    pub summary: String,
}

impl ComponentReadiness {
    #[must_use]
    pub fn ready(summary: impl Into<String>) -> Self {
        Self { level: ReadinessLevel::Ready, summary: summary.into() }
    }

    #[must_use]
    pub fn starting() -> Self {
        Self { level: ReadinessLevel::Starting, summary: "starting".into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReadinessSnapshot {
    pub overall: ReadinessLevel,
    pub http: ComponentReadiness,
    pub db: ComponentReadiness,
}

impl ReadinessSnapshot {
    #[must_use]
    pub fn is_ready(&self) -> bool {
        matches!(self.overall, ReadinessLevel::Ready)
    }

    fn recompute(&mut self) {
        self.overall = if matches!(self.http.level, ReadinessLevel::Ready)
            && matches!(self.db.level, ReadinessLevel::Ready)
        {
            ReadinessLevel::Ready
        } else if matches!(self.http.level, ReadinessLevel::Ready)
            || matches!(self.db.level, ReadinessLevel::Ready)
        {
            ReadinessLevel::Degraded
        } else {
            ReadinessLevel::Starting
        };
    }
}

#[derive(Clone)]
pub struct ParserState {
    pub parser: ParserService,
}

#[derive(Clone)]
pub struct FileState {
    pub files: FileService,
}

#[derive(Clone)]
pub struct DbState {
    pub db: Database,
}

impl FromRef<AppState> for ParserState {
    fn from_ref(state: &AppState) -> Self {
        Self { parser: state.inner.parser.clone() }
    }
}

impl FromRef<AppState> for FileState {
    fn from_ref(state: &AppState) -> Self {
        Self { files: state.inner.files.clone() }
    }
}

impl FromRef<AppState> for DbState {
    fn from_ref(state: &AppState) -> Self {
        Self { db: state.inner.db.clone() }
    }
}
