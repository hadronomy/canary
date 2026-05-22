use std::borrow::Cow;
use std::fmt;
use std::time::Duration;

use tokio::sync::watch;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct ShutdownCoordinator {
    state: watch::Sender<Option<ShutdownReason>>,
    grace_period: Duration,
}

impl ShutdownCoordinator {
    #[must_use]
    pub fn new(grace_period: Duration) -> Self {
        let (state, _) = watch::channel(None);
        Self { state, grace_period }
    }

    #[must_use]
    pub fn grace_period(&self) -> Duration {
        self.grace_period
    }

    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<Option<ShutdownReason>> {
        self.state.subscribe()
    }

    #[must_use]
    pub fn is_requested(&self) -> bool {
        self.state.borrow().is_some()
    }

    pub fn request(&self, reason: ShutdownReason) -> bool {
        if self.is_requested() {
            return false;
        }
        self.state.send_replace(Some(reason));
        true
    }

    pub async fn wait_for_shutdown(&self) {
        let mut rx = self.subscribe();
        if rx.borrow().is_some() {
            return;
        }
        while rx.changed().await.is_ok() {
            if rx.borrow().is_some() {
                return;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShutdownReason {
    Signal(SignalKind),
    TaskFailed(Cow<'static, str>),
    ServerStopped,
}

impl fmt::Display for ShutdownReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Signal(kind) => write!(f, "signal:{kind}"),
            Self::TaskFailed(name) => write!(f, "task_failed:{name}"),
            Self::ServerStopped => f.write_str("server_stopped"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalKind {
    CtrlC,
    Interrupt,
    Quit,
    Terminate,
}

impl fmt::Display for SignalKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CtrlC => f.write_str("ctrl_c"),
            Self::Interrupt => f.write_str("interrupt"),
            Self::Quit => f.write_str("quit"),
            Self::Terminate => f.write_str("terminate"),
        }
    }
}

pub async fn wait_for_shutdown_signal() -> Result<ShutdownReason, AppError> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind as UnixSignalKind, signal};

        let mut interrupt =
            signal(UnixSignalKind::interrupt()).map_err(|source| AppError::Signal { source })?;
        let mut terminate =
            signal(UnixSignalKind::terminate()).map_err(|source| AppError::Signal { source })?;
        let mut quit =
            signal(UnixSignalKind::quit()).map_err(|source| AppError::Signal { source })?;

        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                result.map_err(|source| AppError::Signal { source })?;
                Ok(ShutdownReason::Signal(SignalKind::CtrlC))
            }
            _ = interrupt.recv() => Ok(ShutdownReason::Signal(SignalKind::Interrupt)),
            _ = terminate.recv() => Ok(ShutdownReason::Signal(SignalKind::Terminate)),
            _ = quit.recv() => Ok(ShutdownReason::Signal(SignalKind::Quit)),
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.map_err(|source| AppError::Signal { source })?;

        Ok(ShutdownReason::Signal(SignalKind::CtrlC))
    }
}
