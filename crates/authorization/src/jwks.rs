use std::fmt;

use jsonwebtoken::jwk::JwkSet;
use serde::{Deserialize, Serialize};

/// JSON Web Key Set used to verify JWT access tokens.
///
/// This is Canary's public JWKS shape. It intentionally hides the concrete
/// JOSE crate so callers can provide keys without tying their code to our
/// verifier internals.
#[doc(alias = "JWKS")]
#[doc(alias = "JwkSet")]
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JsonWebKeySet(JwkSet);

impl JsonWebKeySet {
    /// Returns the number of keys in the set.
    #[must_use]
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.0.keys.len()
    }

    /// Returns whether the set contains no keys.
    #[must_use]
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.0.keys.is_empty()
    }

    #[must_use]
    #[inline(always)]
    pub(crate) fn as_inner(&self) -> &JwkSet {
        &self.0
    }
}

impl fmt::Debug for JsonWebKeySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kids =
            self.0.keys.iter().filter_map(|key| key.common.key_id.as_deref()).collect::<Vec<_>>();
        f.debug_struct("JsonWebKeySet")
            .field("len", &self.len())
            .field("kids", &kids)
            .field("material", &"***")
            .finish()
    }
}
