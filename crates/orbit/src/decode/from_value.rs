//! Typed conversion from raw values.

use std::ffi::OsString;
use std::path::PathBuf;
use std::str::FromStr;

use crate::decode::{DecodeError, DecodeErrorKind};
use crate::parse::RawValue;

/// Convert a raw parsed value into a typed Rust value.
///
/// This trait is the low-level conversion hook used by [`crate::decode::MatchRef`].
///
/// Implementations should be pure and should not depend on schema-global state.
pub trait FromRawValue: Sized {
    /// Convert one raw value into `Self`.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if conversion fails.
    fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError>;
}

impl FromRawValue for RawValue {
    fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError> {
        Ok(value.clone())
    }
}

impl FromRawValue for OsString {
    fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError> {
        Ok(value.as_os_str().to_os_string())
    }
}

impl FromRawValue for String {
    fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError> {
        value.try_as_str().map(ToOwned::to_owned).map_err(|_| {
            DecodeError::new(
                DecodeErrorKind::NonUtf8,
                Option::<Box<str>>::None,
                None,
                "value is not valid UTF-8",
            )
        })
    }
}

impl FromRawValue for PathBuf {
    fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError> {
        Ok(PathBuf::from(value.as_os_str()))
    }
}

macro_rules! impl_from_value_via_from_str {
    ($($ty:ty),* $(,)?) => {
        $(
            impl FromRawValue for $ty {
                fn from_raw_value(value: &RawValue) -> Result<Self, DecodeError> {
                    let text = value.try_as_str().map_err(|_| {
                        DecodeError::new(
                            DecodeErrorKind::NonUtf8,
                            Option::<Box<str>>::None,
                            None,
                            "value is not valid UTF-8",
                        )
                    })?;

                    <$ty>::from_str(text).map_err(|_| {
                        DecodeError::new(
                            DecodeErrorKind::InvalidValue,
                            Option::<Box<str>>::None,
                            None,
                            format!(
                                "failed to parse `{}` as {}",
                                value.display(),
                                stringify!($ty),
                            ),
                        )
                    })
                }
            }
        )*
    };
}

impl_from_value_via_from_str!(
    bool, i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_decode_works() {
        let value = RawValue::from("hello");
        let decoded = String::from_raw_value(&value).expect("string should decode");
        assert_eq!(decoded, "hello");
    }

    #[test]
    fn integer_decode_works() {
        let value = RawValue::from("42");
        let decoded = u32::from_raw_value(&value).expect("u32 should decode");
        assert_eq!(decoded, 42);
    }

    #[test]
    fn pathbuf_decode_works() {
        let value = RawValue::from("Cargo.toml");
        let decoded = PathBuf::from_raw_value(&value).expect("path should decode");
        assert_eq!(decoded, PathBuf::from("Cargo.toml"));
    }
}
