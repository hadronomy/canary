#![forbid(unsafe_code)]

//! Typed public identifiers backed by UUIDv7.
//!
//! This crate separates three concerns that often get blurred together:
//!
//! - the *domain identifier* that the application reasons about
//! - the raw [`Uuid`] value that the database stores
//! - the compact public string that the API exposes
//!
//! The central type is [`PublicId<T>`], a typed API wrapper around a
//! [`ResourceId`]. The public form is a short, prefixed Base58 string such as
//! `file_5xRjRsF7urU6Y3tTJNh9Kt`, while the underlying stored primitive remains
//! a UUIDv7.
//!
//! # Why this crate exists
//!
//! Raw UUIDs are excellent storage keys, but they are not always the best
//! public API shape. A typed public ID gives you:
//!
//! - a compact, copy-friendly external representation
//! - a resource prefix that makes logs and payloads easier to scan
//! - strong typing at the API boundary instead of passing around plain strings
//!
//! Just as importantly, it avoids lying about what the identifier is. A
//! `PublicId<FileId>` is meaningfully different from a `PublicId<UploadId>`,
//! even though both ultimately wrap a UUID.
//!
//! # Example
//!
//! The usual workflow is:
//!
//! 1. define a strongly typed resource identifier with [`resource_id!`]
//! 2. create domain values as UUIDv7-backed IDs
//! 3. convert them into [`PublicId<T>`] values for API input and output
//!
//! ```rust
//! use public_id::{PublicId, ResourceId, resource_id};
//!
//! resource_id!(
//!     /// Identifies a file in the public API.
//!     pub FileId,
//!     "file"
//! );
//!
//! let file = FileId::new();
//! let public = PublicId::from(file);
//!
//! assert_eq!(public.prefix(), "file");
//! assert_eq!(PublicId::<FileId>::decode(&public.to_string()).unwrap(), public);
//! assert_eq!(file, public.into_inner());
//! ```
//!
//! # Design notes
//!
//! - [`ResourceId`] stays focused on *identity*, not transport. It knows how to
//!   move between the domain wrapper and a [`Uuid`].
//! - [`PublicId<T>`] owns the API encoding and decoding rules.
//! - Domain IDs generated through [`resource_id!`] default to [`Uuid::now_v7`]
//!   so inserts stay time-ordered without giving up global uniqueness.
//!
//! The public string is deliberately an *encoding layer*, not a storage format.
//! Databases should still store native UUID values, and domain types should
//! continue to reason about the typed identifier rather than about prefixed
//! strings.

use std::fmt;
use std::hash::Hash;
use std::marker::PhantomData;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;
pub use uuid::Uuid;

const SEP: char = '_';

/// Error returned when a public ID string cannot be decoded.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PublicIdError {
    /// The string does not have the expected `<prefix>_<body>` shape.
    #[error("invalid id format")]
    InvalidFormat,

    /// The string uses the wrong resource prefix.
    #[error("invalid id prefix: expected `{expected}`, got `{actual}`")]
    InvalidPrefix { expected: &'static str, actual: String },

    /// The encoded body is not valid Base58 UUID data.
    #[error("invalid id body")]
    InvalidBody,
}

/// Domain identity that can be exposed as a [`PublicId<T>`].
///
/// This trait intentionally stays narrow. It does **not** know how to encode or
/// decode public strings; it only knows the resource prefix and how to move to
/// and from the underlying [`Uuid`].
pub trait ResourceId: Sized + Copy + Eq + Ord + Hash + fmt::Debug + 'static {
    /// Prefix used in the public string form, such as `file` or `upl`.
    const PREFIX: &'static str;

    /// Builds the domain ID from a raw UUID.
    fn from_uuid(uuid: Uuid) -> Self;

    /// Returns the raw UUID stored by the domain ID.
    fn as_uuid(self) -> Uuid;

    /// Creates a new time-ordered UUIDv7-backed domain ID.
    #[must_use]
    #[inline(always)]
    fn new() -> Self {
        Self::from_uuid(Uuid::now_v7())
    }
}

/// Public ID wrapper for a [`ResourceId`].
///
/// `PublicId<FileId>` and `PublicId<UploadId>` both serialize as strings, but
/// Rust still treats them as different types. This prevents mixing resource IDs
/// that look the same in API payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(transparent)]
pub struct PublicId<T: ResourceId> {
    inner: T,
    _marker: PhantomData<T>,
}

impl<T: ResourceId> PublicId<T> {
    /// Wraps a domain identifier for API use.
    #[must_use]
    #[inline(always)]
    pub fn new(inner: T) -> Self {
        Self { inner, _marker: PhantomData }
    }

    /// Returns the resource prefix for this public ID type.
    #[must_use]
    #[inline(always)]
    pub const fn prefix(&self) -> &'static str {
        T::PREFIX
    }

    /// Returns the wrapped domain ID.
    #[must_use]
    #[inline(always)]
    pub fn into_inner(self) -> T {
        self.inner
    }

    /// Borrows the wrapped domain ID.
    #[must_use]
    #[inline(always)]
    pub fn inner(&self) -> &T {
        &self.inner
    }

    /// Returns the raw UUID stored by the wrapped domain ID.
    #[must_use]
    #[inline(always)]
    pub fn as_uuid(self) -> Uuid {
        self.inner.as_uuid()
    }

    /// Encodes the ID into its `<prefix>_<body>` public string form.
    #[must_use]
    pub fn encode(self) -> String {
        let body = bs58::encode(self.as_uuid().into_bytes()).into_string();
        format!("{}{}{}", T::PREFIX, SEP, body)
    }

    /// Decodes a public ID string into its typed representation.
    ///
    /// # Errors
    ///
    /// Returns [`PublicIdError`] if the format, prefix, or encoded body is
    /// invalid.
    pub fn decode(input: &str) -> Result<Self, PublicIdError> {
        let Some((prefix, body)) = input.split_once(SEP) else {
            return Err(PublicIdError::InvalidFormat);
        };

        if prefix != T::PREFIX {
            return Err(PublicIdError::InvalidPrefix {
                expected: T::PREFIX,
                actual: prefix.to_owned(),
            });
        }

        let bytes = bs58::decode(body).into_vec().map_err(|_| PublicIdError::InvalidBody)?;
        let bytes: [u8; 16] = bytes.try_into().map_err(|_| PublicIdError::InvalidBody)?;

        Ok(Self::new(T::from_uuid(Uuid::from_bytes(bytes))))
    }
}

impl<T: ResourceId> From<T> for PublicId<T> {
    #[inline(always)]
    fn from(inner: T) -> Self {
        Self::new(inner)
    }
}

impl<T: ResourceId> fmt::Display for PublicId<T> {
    #[inline(always)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.encode())
    }
}

impl<T: ResourceId> FromStr for PublicId<T> {
    type Err = PublicIdError;

    #[inline(always)]
    fn from_str(input: &str) -> Result<Self, Self::Err> {
        Self::decode(input)
    }
}

impl<T: ResourceId> TryFrom<&str> for PublicId<T> {
    type Error = PublicIdError;

    #[inline(always)]
    fn try_from(input: &str) -> Result<Self, Self::Error> {
        Self::decode(input)
    }
}

impl<T: ResourceId> TryFrom<String> for PublicId<T> {
    type Error = PublicIdError;

    #[inline(always)]
    fn try_from(input: String) -> Result<Self, Self::Error> {
        Self::decode(&input)
    }
}

impl<T: ResourceId> Serialize for PublicId<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.encode())
    }
}

impl<'de, T: ResourceId> Deserialize<'de> for PublicId<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::decode(&value).map_err(serde::de::Error::custom)
    }
}

/// Defines a UUIDv7-backed domain ID that can be exposed as a [`PublicId<T>`].
///
/// The generated type:
///
/// - is a transparent newtype over [`Uuid`]
/// - implements [`ResourceId`]
/// - generates fresh IDs with [`Uuid::now_v7`]
/// - parses and displays in its public string form
///
/// # Examples
///
/// ```
/// use public_id::{PublicId, resource_id};
///
/// resource_id!(
///     /// Identifies a collection.
///     pub CollectionId,
///     "col"
/// );
///
/// let id = CollectionId::new();
/// let public = id.public();
///
/// assert_eq!(PublicId::<CollectionId>::decode(&public.to_string()).unwrap(), public);
/// assert_eq!("col", CollectionId::PREFIX);
/// ```
#[macro_export]
macro_rules! resource_id {
    ($(#[$meta:meta])* $vis:vis $name:ident, $prefix:literal $(,)?) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[repr(transparent)]
        $vis struct $name($crate::Uuid);

        impl $name {
            /// Prefix used in the public string form of this ID.
            pub const PREFIX: &'static str = $prefix;

            /// Creates a new UUIDv7-backed identifier.
            #[must_use]
            #[inline(always)]
            pub fn new() -> Self {
                <Self as $crate::ResourceId>::new()
            }

            /// Builds the identifier from a raw UUID.
            #[must_use]
            #[inline(always)]
            pub fn from_uuid(uuid: $crate::Uuid) -> Self {
                Self(uuid)
            }

            /// Returns the raw UUID stored by this identifier.
            #[must_use]
            #[inline(always)]
            pub fn as_uuid(self) -> $crate::Uuid {
                self.0
            }

            /// Wraps the identifier in its typed public representation.
            #[must_use]
            #[inline(always)]
            pub fn public(self) -> $crate::PublicId<Self> {
                $crate::PublicId::from(self)
            }
        }

        impl Default for $name {
            #[inline(always)]
            fn default() -> Self {
                Self::new()
            }
        }

        impl $crate::ResourceId for $name {
            const PREFIX: &'static str = $prefix;

            #[inline(always)]
            fn from_uuid(uuid: $crate::Uuid) -> Self {
                Self(uuid)
            }

            #[inline(always)]
            fn as_uuid(self) -> $crate::Uuid {
                self.0
            }
        }

        impl From<$name> for $crate::Uuid {
            #[inline(always)]
            fn from(id: $name) -> Self {
                id.0
            }
        }

        impl From<$crate::Uuid> for $name {
            #[inline(always)]
            fn from(uuid: $crate::Uuid) -> Self {
                Self(uuid)
            }
        }

        impl ::std::fmt::Display for $name {
            #[inline(always)]
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                self.public().fmt(f)
            }
        }

        impl ::std::str::FromStr for $name {
            type Err = $crate::PublicIdError;

            #[inline(always)]
            fn from_str(input: &str) -> Result<Self, Self::Err> {
                $crate::PublicId::<Self>::decode(input).map($crate::PublicId::into_inner)
            }
        }

        impl ::std::convert::TryFrom<&str> for $name {
            type Error = $crate::PublicIdError;

            #[inline(always)]
            fn try_from(input: &str) -> Result<Self, Self::Error> {
                input.parse()
            }
        }

        impl ::std::convert::TryFrom<String> for $name {
            type Error = $crate::PublicIdError;

            #[inline(always)]
            fn try_from(input: String) -> Result<Self, Self::Error> {
                input.parse()
            }
        }
    };
}

#[cfg(test)]
#[allow(dead_code)]
mod tests {
    use super::{PublicId, PublicIdError};

    resource_id!(
        /// File identifier used in tests.
        TestFileId,
        "file"
    );

    resource_id!(
        /// Upload identifier used in tests.
        TestUploadId,
        "upl"
    );

    #[test]
    fn creates_v7_ids() {
        let id = TestFileId::new();
        assert_eq!(id.as_uuid().get_version_num(), 7);
    }

    #[test]
    fn roundtrips_public_ids() {
        let id = TestFileId::new();
        let public = PublicId::from(id);
        let parsed = PublicId::<TestFileId>::decode(&public.to_string()).unwrap();

        assert_eq!(parsed, public);
        assert_eq!(parsed.into_inner(), id);
    }

    #[test]
    fn rejects_wrong_prefix() {
        let id = TestFileId::new();
        let bad = id.public().to_string().replacen("file_", "upl_", 1);

        assert_eq!(
            PublicId::<TestFileId>::decode(&bad),
            Err(PublicIdError::InvalidPrefix { expected: "file", actual: "upl".to_owned() }),
        );
    }

    #[test]
    fn serializes_as_a_string() {
        let id = TestFileId::new().public();
        let json = serde_json::to_string(&id).unwrap();
        let parsed: PublicId<TestFileId> = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed, id);
        assert!(json.starts_with("\"file_"));
    }

    #[test]
    fn concrete_ids_parse_from_public_form() {
        let id = TestUploadId::new();
        let parsed: TestUploadId = id.to_string().parse().unwrap();

        assert_eq!(parsed, id);
    }
}
