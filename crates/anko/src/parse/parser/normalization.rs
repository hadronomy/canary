//! Token normalization.
//!
//! Raw lexical argv entries are normalized against the active command schema
//! into a stream of parser-friendly tokens. Normalization is schema-aware so
//! short-option clusters and attached values can be interpreted correctly.

use std::ffi::{OsStr, OsString};

use super::{Parser, span_with_part};
use crate::parse::error::{ParseError, ParseErrorKind};
use crate::parse::model::{NormalizedToken, RawValue, Span, SpanPart, ValueId};
use crate::parse::token::RawToken;
use crate::schema::CommandRef;

impl<'a, E, S> Parser<'a, E, S>
where
    E: super::env::EnvProvider,
    S: super::suggest::SuggestionProvider,
{
    /// Consume the next normalized token under the current command schema.
    pub(super) fn next_token(&mut self, current_cmd: CommandRef<'a>) -> Option<NormalizedToken> {
        self.fill_buffer(current_cmd);
        self.normalized_buffer.pop_front()
    }

    /// Consume the next normalized token only if it is a value.
    ///
    /// This avoids cloning the front token on the hot path for value-taking
    /// options.
    pub(super) fn next_value_token(
        &mut self,
        current_cmd: CommandRef<'a>,
    ) -> Option<(ValueId, Span)> {
        self.fill_buffer(current_cmd);

        match self.normalized_buffer.front() {
            Some(NormalizedToken::Value { value, span }) => {
                let value = *value;
                let span = *span;
                self.normalized_buffer.pop_front();
                Some((value, span))
            }
            _ => None,
        }
    }

    /// Push a normalized short option token into the buffer.
    fn push_short_token(&mut self, name: char, span: Span) {
        self.normalized_buffer.push_back(NormalizedToken::Short {
            name,
            span: span_with_part(span, SpanPart::ShortName),
        });
    }

    /// Push a normalized long option token into the buffer.
    fn push_long_token<SName>(&mut self, name: SName, span: Span)
    where
        SName: Into<Box<str>>,
    {
        self.normalized_buffer.push_back(NormalizedToken::Long {
            name: name.into(),
            span: span_with_part(span, SpanPart::LongName),
        });
    }

    /// Push a normalized value token into the buffer.
    fn push_value_token(&mut self, value: ValueId, span: Span, part: SpanPart) {
        self.normalized_buffer
            .push_back(NormalizedToken::Value { value, span: span_with_part(span, part) });
    }

    /// Fill the normalized buffer until one token is available or input is
    /// exhausted.
    fn fill_buffer(&mut self, current_cmd: CommandRef<'a>) {
        while self.normalized_buffer.is_empty() && self.cursor < self.raw_tokens.len() {
            let token = self.raw_tokens[self.cursor];
            self.cursor += 1;

            match token {
                RawToken::Terminator { span } => {
                    self.after_terminator = true;
                    self.normalized_buffer.push_back(NormalizedToken::Terminator { span });
                }
                RawToken::Value { value, span } => {
                    self.normalized_buffer.push_back(NormalizedToken::Value { value, span });
                }
                RawToken::OptionLike { value, span } => {
                    if self.after_terminator {
                        self.push_value_token(value, span, SpanPart::BareValue);
                    } else if let Err(error) = self.normalize_option_like(current_cmd, value, span)
                    {
                        self.errors.push(error);
                    }
                }
            }
        }
    }

    /// Normalize an option-like argv entry under the active command schema.
    ///
    /// Examples:
    ///
    /// - `-v`
    /// - `-abc`
    /// - `-ofile.txt`
    /// - `--config=file`
    fn normalize_option_like(
        &mut self,
        cmd: CommandRef<'a>,
        value_id: ValueId,
        span: Span,
    ) -> Result<(), ParseError> {
        #[cfg(any(unix, windows))]
        {
            enum ParsedOptionLike {
                Long { name: String, attached: Option<OsString> },
                Short(OsString),
                Bare,
            }

            let parsed = {
                let raw = self.values.get(value_id);
                let input = raw.as_os_str();

                match option_style(input) {
                    Some(OptionStyle::Long) => {
                        let (name, attached) = split_long_os(input).map_err(|()| {
                            ParseError::new(
                                ParseErrorKind::NonUtf8OptionLike,
                                Some(span),
                                "option-like argv entry must have a valid UTF-8 option name",
                            )
                        })?;

                        ParsedOptionLike::Long { name, attached }
                    }
                    Some(OptionStyle::Short) => ParsedOptionLike::Short(input.to_os_string()),
                    None => ParsedOptionLike::Bare,
                }
            };

            match parsed {
                ParsedOptionLike::Long { name, attached } => {
                    self.push_long_normalized(span, name, attached)
                }
                ParsedOptionLike::Short(input) => self.normalize_short_os(cmd, span, &input),
                ParsedOptionLike::Bare => {
                    self.push_value_token(value_id, span, SpanPart::BareValue);
                    Ok(())
                }
            }
        }

        #[cfg(not(any(unix, windows)))]
        {
            enum OptionLikeTail {
                Long(Box<str>),
                Short(Box<str>),
                Bare,
            }

            let tail = {
                let raw = self.values.get(value_id);
                let text = raw.try_as_str().map_err(|err| {
                    ParseError::new(
                        ParseErrorKind::NonUtf8OptionLike,
                        Some(span),
                        format!("option-like argv entry must be valid UTF-8: {err}"),
                    )
                })?;

                if let Some(rest) = text.strip_prefix("--") {
                    OptionLikeTail::Long(rest.into())
                } else if let Some(rest) = text.strip_prefix('-') {
                    OptionLikeTail::Short(rest.into())
                } else {
                    OptionLikeTail::Bare
                }
            };

            match tail {
                OptionLikeTail::Long(rest) => self.normalize_long_utf8(span, &rest),
                OptionLikeTail::Short(rest) => self.normalize_short_cluster_utf8(cmd, span, &rest),
                OptionLikeTail::Bare => {
                    self.push_value_token(value_id, span, SpanPart::BareValue);
                    Ok(())
                }
            }
        }
    }

    /// Normalize a short option cluster from an `OsStr`.
    ///
    /// Short names must decode as Unicode scalar values because the schema
    /// models them as `char`. Once a value-taking short option is found, the
    /// remainder of the original argument is preserved as an opaque `OsString`
    /// attached value.
    #[cfg(any(unix, windows))]
    fn normalize_short_os(
        &mut self,
        cmd: CommandRef<'a>,
        span: Span,
        input: &OsStr,
    ) -> Result<(), ParseError> {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::{OsStrExt, OsStringExt};

            let bytes = input.as_bytes();
            let mut rest = bytes.get(1..).ok_or_else(|| empty_short_cluster_error(span))?;

            if rest.is_empty() {
                return Err(empty_short_cluster_error(span));
            }

            while !rest.is_empty() {
                use crate::parse::parser::CommandLookupExt;

                let (short, consumed) =
                    decode_next_utf8_char(rest).map_err(|()| non_utf8_option_name_error(span))?;

                let arg = cmd.resolve_short_arg(short, span)?;
                self.push_short_token(short, span);

                rest = &rest[consumed..];

                if arg.takes_value() {
                    if !rest.is_empty() {
                        let value =
                            self.values.push(RawValue::from(OsString::from_vec(rest.to_vec())));
                        self.push_value_token(value, span, SpanPart::AttachedValue);
                    }
                    break;
                }
            }

            Ok(())
        }

        #[cfg(windows)]
        {
            use std::os::windows::ffi::{OsStrExt, OsStringExt};

            let units = input.encode_wide().collect::<Vec<_>>();
            let mut offset = 1usize;

            if units.len() <= offset {
                return Err(empty_short_cluster_error(span));
            }

            while offset < units.len() {
                let (short, consumed) = decode_next_utf16_char(&units[offset..])
                    .map_err(|()| non_utf8_option_name_error(span))?;

                let arg = cmd.resolve_short_arg(short, span)?;
                self.push_short_token(short, span);

                offset += consumed;

                if arg.takes_value() {
                    if offset < units.len() {
                        let value =
                            self.values.push(RawValue::from(OsString::from_wide(&units[offset..])));
                        self.push_value_token(value, span, SpanPart::AttachedValue);
                    }
                    break;
                }
            }

            Ok(())
        }
    }

    /// Normalize and enqueue a long option plus any attached value.
    #[cfg(any(unix, windows))]
    fn push_long_normalized(
        &mut self,
        span: Span,
        name: String,
        attached: Option<OsString>,
    ) -> Result<(), ParseError> {
        if name.is_empty() {
            return Err(ParseError::new(
                ParseErrorKind::InvalidLongSyntax,
                Some(span),
                "long option name must not be empty",
            ));
        }

        self.push_long_token(name, span);

        if let Some(attached) = attached {
            let value = self.values.push(RawValue::from(attached));
            self.push_value_token(value, span, SpanPart::AttachedValue);
        }

        Ok(())
    }

    /// Normalize a long option from UTF-8.
    ///
    /// This path is used only on targets where direct `OsStr` decomposition is
    /// not available.
    #[cfg(not(any(unix, windows)))]
    fn normalize_long_utf8(&mut self, span: Span, rest: &str) -> Result<(), ParseError> {
        if rest.is_empty() {
            return Err(ParseError::new(
                ParseErrorKind::InvalidLongSyntax,
                Some(span),
                "long option name must not be empty",
            ));
        }

        match rest.split_once('=') {
            Some((name, attached)) => {
                if name.is_empty() {
                    return Err(ParseError::new(
                        ParseErrorKind::InvalidLongSyntax,
                        Some(span),
                        "long option name must not be empty",
                    ));
                }

                self.push_long_token(name, span);

                let value = self.values.push(RawValue::from(attached));
                self.push_value_token(value, span, SpanPart::AttachedValue);

                Ok(())
            }
            None => {
                self.push_long_token(rest, span);
                Ok(())
            }
        }
    }

    /// Normalize a UTF-8 short option cluster.
    ///
    /// This path is used only on targets where direct `OsStr` decomposition is
    /// not available.
    #[cfg(not(any(unix, windows)))]
    fn normalize_short_cluster_utf8(
        &mut self,
        cmd: CommandRef<'a>,
        span: Span,
        rest: &str,
    ) -> Result<(), ParseError> {
        if rest.is_empty() {
            return Err(empty_short_cluster_error(span));
        }

        for (byte_offset, short) in rest.char_indices() {
            let arg = cmd.resolve_short_arg(short, span)?;
            self.push_short_token(short, span);

            if arg.takes_value() {
                let value_start = byte_offset + short.len_utf8();
                if value_start < rest.len() {
                    let attached = &rest[value_start..];
                    let value = self.values.push(RawValue::from(attached));
                    self.push_value_token(value, span, SpanPart::AttachedValue);

                    // The remainder of the cluster becomes the attached value.
                    break;
                }
            }
        }

        Ok(())
    }
}

#[cfg(any(unix, windows))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OptionStyle {
    Short,
    Long,
}

/// Determine whether an `OsStr` looks like a short or long option.
#[cfg(any(unix, windows))]
fn option_style(input: &OsStr) -> Option<OptionStyle> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;

        let bytes = input.as_bytes();
        match bytes {
            [b'-', b'-', ..] => Some(OptionStyle::Long),
            [b'-', ..] => Some(OptionStyle::Short),
            _ => None,
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        const DASH: u16 = b'-' as u16;

        let mut it = input.encode_wide();
        match (it.next(), it.next()) {
            (Some(DASH), Some(DASH)) => Some(OptionStyle::Long),
            (Some(DASH), _) => Some(OptionStyle::Short),
            _ => None,
        }
    }
}

/// Split a long option into its UTF-8 name and any attached opaque value.
#[cfg(any(unix, windows))]
fn split_long_os(input: &OsStr) -> Result<(String, Option<OsString>), ()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::{OsStrExt, OsStringExt};

        let bytes = input.as_bytes();
        let body = bytes.get(2..).ok_or(())?;

        let (name, attached) = match body.iter().position(|&b| b == b'=') {
            Some(eq) => (&body[..eq], Some(OsString::from_vec(body[eq + 1..].to_vec()))),
            None => (body, None),
        };

        let name = std::str::from_utf8(name).map_err(|_| ())?.to_owned();
        Ok((name, attached))
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};

        const EQUALS: u16 = b'=' as u16;

        let units = input.encode_wide().collect::<Vec<_>>();
        let body = units.get(2..).ok_or(())?;

        let (name, attached) = match body.iter().position(|&u| u == EQUALS) {
            Some(eq) => (&body[..eq], Some(OsString::from_wide(&body[eq + 1..]))),
            None => (body, None),
        };

        let name = String::from_utf16(name).map_err(|_| ())?;
        Ok((name, attached))
    }
}

/// Construct the standard empty-short-cluster diagnostic.
fn empty_short_cluster_error(span: Span) -> ParseError {
    ParseError::new(
        ParseErrorKind::UnknownShort,
        Some(span),
        "short option cluster must not be empty",
    )
}

/// Construct the standard invalid-option-name encoding diagnostic.
fn non_utf8_option_name_error(span: Span) -> ParseError {
    ParseError::new(
        ParseErrorKind::NonUtf8OptionLike,
        Some(span),
        "option-like argv entry must have a valid UTF-8 option name",
    )
}

/// Decode exactly one UTF-8 scalar value from the front of a byte slice.
#[cfg(unix)]
fn decode_next_utf8_char(input: &[u8]) -> Result<(char, usize), ()> {
    for len in 1..=input.len().min(4) {
        let slice = &input[..len];
        if let Ok(s) = std::str::from_utf8(slice) {
            let mut chars = s.chars();
            if let Some(ch) = chars.next()
                && chars.next().is_none()
            {
                return Ok((ch, len));
            }
        }
    }

    Err(())
}

/// Decode exactly one UTF-16 scalar value from the front of a unit slice.
#[cfg(windows)]
fn decode_next_utf16_char(input: &[u16]) -> Result<(char, usize), ()> {
    let Some(&first) = input.first() else {
        return Err(());
    };

    match first {
        0xD800..=0xDBFF => {
            let Some(&second) = input.get(1) else {
                return Err(());
            };

            if !(0xDC00..=0xDFFF).contains(&second) {
                return Err(());
            }

            match std::char::decode_utf16([first, second]).next() {
                Some(Ok(ch)) => Ok((ch, 2)),
                _ => Err(()),
            }
        }
        0xDC00..=0xDFFF => Err(()),
        unit => char::from_u32(unit as u32).map(|ch| (ch, 1)).ok_or(()),
    }
}
