#![forbid(unsafe_code)]

//! Authorization primitives for Canary resource servers.
//!
//! `canary-authorization` validates OAuth access tokens and turns them into a
//! typed [`Principal`]. It does **not** implement login flows, browser
//! sessions, consent screens, or token issuance. Those belong to an external
//! authorization server. Canary acts as a resource server and asks this crate
//! two questions:
//!
//! 1. does this bearer token describe a valid caller?
//! 2. may that caller perform this [`Action`] on this [`Resource`]?
//!
//! The public API deliberately wraps the JOSE implementation details. Canary
//! currently uses `jsonwebtoken` internally for JWT signature verification and
//! JWK parsing, while call sites interact with domain types such as
//! [`BearerToken`], [`JsonWebKeySet`], [`ScopeSet`], [`Challenge`], and
//! [`Decision`].
//!
//! # Example
//!
//! ```no_run
//! # async fn run(cfg: canary_authorization::EnabledConfig) -> Result<(), canary_authorization::AuthError> {
//! use canary_authorization::{Action, Authorizer, BearerToken, Resource};
//!
//! let auth = Authorizer::from_config(cfg).await?;
//! let token = BearerToken::new("eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9.payload.sig")?;
//! let principal = auth.verify(&token).await?;
//! let decision = auth.authorize(&principal, Action::Read, &Resource::api());
//!
//! assert!(decision.is_allowed());
//! # Ok(())
//! # }
//! ```

#[cfg(not(any(feature = "jwt-rust-crypto", feature = "jwt-aws-lc-rs")))]
compile_error!(
    "canary-authorization needs one JWT crypto backend: enable jwt-rust-crypto or jwt-aws-lc-rs"
);

mod authorizer;
mod challenge;
mod config;
mod error;
mod jwks;
mod metadata;
mod principal;
mod resource;
mod token;

#[cfg(feature = "axum")]
pub mod axum;

pub use authorizer::Authorizer;
pub use challenge::{Challenge, ChallengeError, ChallengeKind};
pub use config::{
    AccessTokenConfig, Algorithm, Config, DiscoveryConfig, DiscoveryMode, EnabledConfig,
    IntrospectionAuthMethod, IntrospectionCacheConfig, IntrospectionConfig, IssuerConfig,
    ProtectedResourceConfig, RawAccessTokenConfig, RawConfig, RawDiscoveryConfig,
    RawIntrospectionCacheConfig, RawIntrospectionConfig, RawIssuerConfig,
    RawProtectedResourceConfig, RawResourceConfig, RefreshConfig, ResourceConfig, TokenFormat,
    TokenFormatSet,
};
pub use error::{AuthError, ConfigError};
pub use jwks::JsonWebKeySet;
pub use metadata::{ProtectedResourceMetadata, ResourceUri};
pub use principal::{
    Audience, ClientId, EntitlementSet, GroupSet, Issuer, Principal, PrincipalKind, RoleSet,
    ScopeSet, Subject,
};
pub use resource::{Action, Decision, Denial, Resource, ResourceKey, ResourceKind};
pub use token::{BearerToken, BearerTokenError};
