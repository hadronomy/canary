//! Coordinated server shutdown for HTTP and long-lived subsystem tasks.

use std::borrow::Cow;
use std::fmt;
use std::time::Duration;

use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::error::{ServerError, ServerResult};

/// Broadcasts a shutdown reason and cancels registered subsystem tokens.
///
/// A subsystem registers by requesting a child [`CancellationToken`]. Child
/// tokens propagate coordinator shutdown without allowing one subsystem to
/// cancel its siblings.
#[derive(Debug, Clone)]
pub struct ShutdownCoordinator {
    state: watch::Sender<Option<ShutdownReason>>,
    token: CancellationToken,
    grace_period: Duration,
}

impl ShutdownCoordinator {
    /// Creates a coordinator with the amount of time allowed for graceful shutdown.
    #[must_use]
    pub fn new(grace_period: Duration) -> Self {
        let (state, _) = watch::channel(None);
        Self { state, token: CancellationToken::new(), grace_period }
    }

    /// Returns the amount of time allowed for graceful shutdown.
    #[must_use]
    #[inline(always)]
    pub fn grace_period(&self) -> Duration {
        self.grace_period
    }

    /// Registers a subsystem for coordinated cancellation.
    ///
    /// Tokens registered after shutdown has been requested are cancelled
    /// immediately.
    #[must_use]
    #[inline(always)]
    pub fn register(&self) -> CancellationToken {
        self.token.child_token()
    }

    /// Subscribes to shutdown reason changes.
    #[must_use]
    #[inline(always)]
    pub fn subscribe(&self) -> watch::Receiver<Option<ShutdownReason>> {
        self.state.subscribe()
    }

    /// Returns whether shutdown has already been requested.
    #[must_use]
    #[inline(always)]
    pub fn is_requested(&self) -> bool {
        self.state.borrow().is_some()
    }

    /// Requests shutdown and cancels all registered subsystem tokens.
    ///
    /// The first request wins so observers always see one stable shutdown
    /// reason.
    pub fn request(&self, reason: ShutdownReason) -> bool {
        let changed = self.state.send_if_modified(|state| {
            if state.is_some() {
                return false;
            }
            *state = Some(reason);
            true
        });
        if changed {
            self.token.cancel();
        }
        changed
    }

    /// Waits until shutdown is requested or all reason senders are dropped.
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

/// Why a coordinated server shutdown began.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShutdownReason {
    /// The operating system delivered a termination signal.
    Signal(SignalKind),
    /// A supervised task failed.
    TaskFailed(Cow<'static, str>),
    /// A supervised server task stopped without an error.
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

/// A termination signal recognized by the server runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalKind {
    /// The process received an interactive Ctrl-C notification.
    CtrlC,
    /// The process received `SIGINT`.
    Interrupt,
    /// The process received `SIGQUIT`.
    Quit,
    /// The process received `SIGTERM`.
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

/// Waits for the first operating-system shutdown signal.
pub async fn wait_for_shutdown_signal() -> ServerResult<ShutdownReason> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind as UnixSignalKind, signal};

        let mut interrupt =
            signal(UnixSignalKind::interrupt()).map_err(|source| ServerError::Signal { source })?;
        let mut terminate =
            signal(UnixSignalKind::terminate()).map_err(|source| ServerError::Signal { source })?;
        let mut quit =
            signal(UnixSignalKind::quit()).map_err(|source| ServerError::Signal { source })?;

        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                result.map_err(|source| ServerError::Signal { source })?;
                Ok(ShutdownReason::Signal(SignalKind::CtrlC))
            }
            _ = interrupt.recv() => Ok(ShutdownReason::Signal(SignalKind::Interrupt)),
            _ = terminate.recv() => Ok(ShutdownReason::Signal(SignalKind::Terminate)),
            _ = quit.recv() => Ok(ShutdownReason::Signal(SignalKind::Quit)),
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.map_err(|source| ServerError::Signal { source })?;

        Ok(ShutdownReason::Signal(SignalKind::CtrlC))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_cancels_registered_and_future_tokens_once() {
        let shutdown = ShutdownCoordinator::new(Duration::from_secs(1));
        let token = shutdown.register();

        assert!(!token.is_cancelled());
        assert!(shutdown.request(ShutdownReason::ServerStopped));
        assert!(token.is_cancelled());
        assert!(shutdown.register().is_cancelled());
        assert!(!shutdown.request(ShutdownReason::TaskFailed("late".into())));
        assert_eq!(*shutdown.state.borrow(), Some(ShutdownReason::ServerStopped));
    }
}
