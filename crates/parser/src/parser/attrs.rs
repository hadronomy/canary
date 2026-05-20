use std::borrow::Cow;

use quick_xml::events::BytesStart;

use crate::error::{DocumentError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChildAction {
    Consumed,
    Skip,
}

pub(super) fn attr_value<'a>(
    tag: &'a BytesStart<'a>,
    key: &[u8],
    phase: &str,
) -> Result<Option<Cow<'a, str>>> {
    for attr in tag.attributes().with_checks(false).flatten() {
        if attr.key.as_ref() == key {
            return attr
                .decode_and_unescape_value(tag.decoder())
                .map(Some)
                .map_err(|e| DocumentError::xml(format!("{phase}: invalid attribute: {e}")));
        }
    }
    Ok(None)
}

pub(super) fn attr_string(tag: &BytesStart<'_>, key: &[u8], phase: &str) -> Result<Option<String>> {
    attr_value(tag, key, phase).map(|it| it.map(|it| it.into_owned()))
}

pub(super) fn require_attr<'a>(
    tag: &'a BytesStart<'a>,
    key: &[u8],
    phase: &str,
) -> Result<Cow<'a, str>> {
    attr_value(tag, key, phase)?.ok_or_else(|| {
        DocumentError::xml(format!("{phase}: missing `{}` attribute", String::from_utf8_lossy(key)))
    })
}
