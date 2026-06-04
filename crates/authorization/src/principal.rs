use std::fmt;

use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use url::Url;

use crate::ConfigError;

macro_rules! text_type {
    ($(#[$meta:meta])* $name:ident, $label:literal) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(SmolStr);

        impl $name {
            /// Creates a value after rejecting empty text and control characters.
            ///
            /// # Errors
            ///
            /// Returns [`ConfigError`] when the value is empty or contains ASCII
            /// control characters.
            pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
                let value = value.into();
                validate_text(value.as_str(), $label)?;
                Ok(Self(value))
            }

            /// Returns the borrowed text.
            #[must_use]
            #[inline(always)]
            pub fn as_str(&self) -> &str {
                self.0.as_str()
            }

            /// Consumes the wrapper and returns owned text.
            #[must_use]
            #[inline(always)]
            pub fn into_string(self) -> String {
                self.0.to_string()
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.debug_tuple(stringify!($name)).field(&self.0).finish()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl TryFrom<String> for $name {
            type Error = ConfigError;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }

        impl TryFrom<&str> for $name {
            type Error = ConfigError;

            fn try_from(value: &str) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }
    };
}

text_type!(
    /// OAuth subject claim identifying the caller at one issuer.
    Subject,
    "subject"
);

text_type!(
    /// OAuth client identifier that requested or received the access token.
    ClientId,
    "client id"
);

text_type!(
    /// Audience claim accepted by a Canary protected resource.
    Audience,
    "audience"
);

/// Authorization server issuer accepted by Canary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Issuer(Url);

impl Issuer {
    /// Creates an issuer URL.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when the URL is not HTTPS or contains a
    /// fragment.
    pub fn new(value: Url) -> Result<Self, ConfigError> {
        if value.scheme() != "https" {
            return Err(ConfigError::invalid("issuer URLs must use https"));
        }
        if value.fragment().is_some() {
            return Err(ConfigError::invalid("issuer URLs must not contain fragments"));
        }
        Ok(Self(value))
    }

    /// Creates an issuer from a string.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when the text is not a valid issuer URL.
    pub fn parse(value: &str) -> Result<Self, ConfigError> {
        Self::new(Url::parse(value).map_err(ConfigError::source)?)
    }

    /// Returns the issuer URL.
    #[must_use]
    #[inline(always)]
    pub fn as_url(&self) -> &Url {
        &self.0
    }

    /// Returns the issuer URL as text.
    #[must_use]
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for Issuer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Issuer").field(&self.as_str()).finish()
    }
}

impl fmt::Display for Issuer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

macro_rules! set_type {
    ($(#[$meta:meta])* $name:ident, $label:literal) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Vec<SmolStr>);

        impl $name {
            /// Creates a sorted set after validating each token.
            ///
            /// # Errors
            ///
            /// Returns [`ConfigError`] when any token is empty or contains ASCII
            /// control characters.
            pub fn new<I, S>(values: I) -> Result<Self, ConfigError>
            where
                I: IntoIterator<Item = S>,
                S: Into<SmolStr>,
            {
                let mut values = values
                    .into_iter()
                    .map(Into::into)
                    .map(|value| {
                        validate_claim_text(value.as_str(), $label)?;
                        Ok(value)
                    })
                    .collect::<Result<Vec<_>, ConfigError>>()?;
                values.sort();
                values.dedup();
                Ok(Self(values))
            }

            /// Creates an empty set.
            #[must_use]
            #[inline(always)]
            pub fn empty() -> Self {
                Self(Vec::new())
            }

            /// Returns the number of values in the set.
            #[must_use]
            #[inline(always)]
            pub fn len(&self) -> usize {
                self.0.len()
            }

            /// Returns whether the set has no values.
            #[must_use]
            #[inline(always)]
            pub fn is_empty(&self) -> bool {
                self.0.is_empty()
            }

            /// Iterates over the set in stable sorted order.
            #[must_use]
            #[inline(always)]
            pub fn iter(&self) -> impl ExactSizeIterator<Item = &str> {
                self.0.iter().map(SmolStr::as_str)
            }

            /// Returns whether this set contains the given value.
            #[must_use]
            pub fn contains(&self, value: &str) -> bool {
                self.0.binary_search_by(|item| item.as_str().cmp(value)).is_ok()
            }

            /// Returns the values as a slice.
            #[must_use]
            #[inline(always)]
            pub fn as_slice(&self) -> &[SmolStr] {
                &self.0
            }
        }

        impl FromIterator<SmolStr> for $name {
            fn from_iter<T: IntoIterator<Item = SmolStr>>(iter: T) -> Self {
                Self::new(iter).expect("smol strings that were already allocated should validate")
            }
        }
    };
}

set_type!(
    /// OAuth scope tokens granted to a principal.
    ScopeSet,
    "scope"
);

set_type!(
    /// Role claim values granted by an authorization server.
    RoleSet,
    "role"
);

set_type!(
    /// Group claim values granted by an authorization server.
    GroupSet,
    "group"
);

set_type!(
    /// Fine-grained entitlement values granted by an authorization server.
    EntitlementSet,
    "entitlement"
);

/// Kind of actor described by a validated access token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalKind {
    /// A token with an end-user subject.
    User,
    /// A token issued directly to an OAuth client, such as `client_credentials`.
    Client,
}

/// Authenticated caller extracted from a validated OAuth access token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Principal {
    kind: PrincipalKind,
    issuer: Issuer,
    subject: Subject,
    client_id: ClientId,
    audiences: Vec<Audience>,
    scopes: ScopeSet,
    roles: RoleSet,
    groups: GroupSet,
    entitlements: EntitlementSet,
}

impl Principal {
    /// Creates a principal from validated claims.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn new(
        issuer: Issuer,
        subject: Subject,
        client_id: ClientId,
        audiences: Vec<Audience>,
        scopes: ScopeSet,
        roles: RoleSet,
        groups: GroupSet,
        entitlements: EntitlementSet,
    ) -> Self {
        Self::new_with_kind(
            PrincipalKind::User,
            issuer,
            subject,
            client_id,
            audiences,
            scopes,
            roles,
            groups,
            entitlements,
        )
    }

    /// Creates a principal with an explicit actor kind.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn new_with_kind(
        kind: PrincipalKind,
        issuer: Issuer,
        subject: Subject,
        client_id: ClientId,
        audiences: Vec<Audience>,
        scopes: ScopeSet,
        roles: RoleSet,
        groups: GroupSet,
        entitlements: EntitlementSet,
    ) -> Self {
        Self { kind, issuer, subject, client_id, audiences, scopes, roles, groups, entitlements }
    }

    /// Returns whether this token represents a user or an OAuth client.
    #[must_use]
    #[inline(always)]
    pub fn kind(&self) -> PrincipalKind {
        self.kind
    }

    /// Returns the token issuer.
    #[must_use]
    #[inline(always)]
    pub fn issuer(&self) -> &Issuer {
        &self.issuer
    }

    /// Returns the token subject.
    #[must_use]
    #[inline(always)]
    pub fn subject(&self) -> &Subject {
        &self.subject
    }

    /// Returns the OAuth client id that received the access token.
    #[must_use]
    #[inline(always)]
    pub fn client_id(&self) -> &ClientId {
        &self.client_id
    }

    /// Returns accepted audiences present in the token.
    #[must_use]
    #[inline(always)]
    pub fn audiences(&self) -> &[Audience] {
        &self.audiences
    }

    /// Returns OAuth scopes granted to this principal.
    #[must_use]
    #[inline(always)]
    pub fn scopes(&self) -> &ScopeSet {
        &self.scopes
    }

    /// Returns role values granted to this principal.
    #[must_use]
    #[inline(always)]
    pub fn roles(&self) -> &RoleSet {
        &self.roles
    }

    /// Returns group values granted to this principal.
    #[must_use]
    #[inline(always)]
    pub fn groups(&self) -> &GroupSet {
        &self.groups
    }

    /// Returns entitlement values granted to this principal.
    #[must_use]
    #[inline(always)]
    pub fn entitlements(&self) -> &EntitlementSet {
        &self.entitlements
    }

    /// Returns whether the principal carries a scope.
    #[must_use]
    #[inline(always)]
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.contains(scope)
    }
}

pub(crate) fn validate_text(value: &str, kind: &str) -> Result<(), ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    if value.chars().any(char::is_control) {
        return Err(ConfigError::invalid(format!("{kind} cannot contain control characters")));
    }
    Ok(())
}

pub(crate) fn validate_claim_text(value: &str, kind: &str) -> Result<(), ConfigError> {
    if kind == "scope" {
        return validate_scope(value);
    }
    validate_text(value, kind)
}

fn validate_scope(value: &str) -> Result<(), ConfigError> {
    if value.is_empty() {
        return Err(ConfigError::invalid("scope cannot be empty"));
    }
    if value
        .bytes()
        .all(|byte| byte == b'!' || (b'#'..=b'[').contains(&byte) || (b']'..=b'~').contains(&byte))
    {
        return Ok(());
    }
    Err(ConfigError::invalid("scope must use RFC 6749 scope-token characters"))
}
