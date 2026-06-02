//! Idempotency keys supplied by callers starting asynchronous work.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize};
use smol_str::SmolStr;
use thiserror::Error;

/// Opaque caller-provided key that prevents duplicate mutating operations.
///
/// The server stores this value alongside a request fingerprint. Reusing the
/// key for the same request returns the original operation. Reusing it for a
/// different request is a conflict.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct IdempotencyKey(SmolStr);

impl IdempotencyKey {
    /// Creates a non-empty idempotency key.
    ///
    /// The key is intentionally opaque. Callers decide its format and Canary
    /// only rejects empty or whitespace-only values.
    ///
    /// # Errors
    ///
    /// Returns [`IdempotencyKeyError::Empty`] when `value` contains no
    /// non-whitespace characters.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, IdempotencyKeyError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(IdempotencyKeyError::Empty);
        }
        Ok(Self(value))
    }

    /// Returns the opaque key as text.
    #[must_use]
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for IdempotencyKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for IdempotencyKey {
    type Err = IdempotencyKeyError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for IdempotencyKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(SmolStr::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// Error returned when an idempotency key is not valid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum IdempotencyKeyError {
    /// The key contains no non-whitespace characters.
    #[error("idempotency key cannot be empty")]
    Empty,
}
