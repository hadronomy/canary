use std::borrow::Borrow;
use std::fmt;
use std::num::{NonZeroU8, NonZeroU16};

use deunicode::deunicode;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use unicode_normalization::UnicodeNormalization;

/// Alignment for table columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ColumnAlign {
    Left,
    Center,
    Right,
}

pub type ColumnAlignment = Option<ColumnAlign>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum SectionKind {
    Titulo,
    Capitulo,
    Seccion,
    Articulo,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ListStyle {
    Ordered,
    Unordered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ListSpacing {
    Tight,
    Loose,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct Anchor(SmolStr);

impl Anchor {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn slug(text: &str) -> Self {
        Self(SmolStr::from(slugify(text)))
    }

    #[must_use]
    pub fn ascii_slug(text: &str) -> Self {
        Self(SmolStr::from(slugify_ascii(text)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for Anchor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for Anchor {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for Anchor {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl From<&str> for Anchor {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for Anchor {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<SmolStr> for Anchor {
    fn from(value: SmolStr) -> Self {
        Self::new(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct BlockId(SmolStr);

impl BlockId {
    #[must_use]
    pub fn new(value: impl AsRef<str>) -> Option<Self> {
        let value = value.as_ref().trim();
        (!value.is_empty()).then(|| Self(SmolStr::from(value)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for BlockId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for BlockId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct SectionIndex(NonZeroU16);

impl SectionIndex {
    #[must_use]
    pub fn new(value: u16) -> Option<Self> {
        NonZeroU16::new(value).map(Self)
    }

    #[must_use]
    pub fn from_usize(value: usize) -> Option<Self> {
        u16::try_from(value).ok().and_then(Self::new)
    }

    #[must_use]
    pub fn get(self) -> usize {
        self.0.get() as usize
    }
}

impl fmt::Display for SectionIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.get())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct HeadingLevel(NonZeroU8);

impl HeadingLevel {
    pub const MAX: u8 = 6;

    #[must_use]
    pub fn new(value: u8) -> Option<Self> {
        NonZeroU8::new(value).filter(|it| it.get() <= Self::MAX).map(Self)
    }

    #[must_use]
    pub fn get(self) -> u8 {
        self.0.get()
    }

    #[must_use]
    pub fn child(self) -> Self {
        Self::new((self.get() + 1).min(Self::MAX)).expect("valid heading level")
    }
}

impl fmt::Display for HeadingLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.get())
    }
}

impl From<HeadingLevel> for u8 {
    fn from(value: HeadingLevel) -> Self {
        value.get()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct ReferenceId(SmolStr);

impl ReferenceId {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for ReferenceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for ReferenceId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<&str> for ReferenceId {
    fn from(value: &str) -> Self {
        Self::new(SmolStr::from(value))
    }
}

impl From<String> for ReferenceId {
    fn from(value: String) -> Self {
        Self::new(SmolStr::from(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct ExternalLink(SmolStr);

impl ExternalLink {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for ExternalLink {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for ExternalLink {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<&str> for ExternalLink {
    fn from(value: &str) -> Self {
        Self::new(SmolStr::from(value))
    }
}

impl From<String> for ExternalLink {
    fn from(value: String) -> Self {
        Self::new(SmolStr::from(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct Language(SmolStr);

impl Language {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for Language {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for Language {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<&str> for Language {
    fn from(value: &str) -> Self {
        Self::new(SmolStr::from(value))
    }
}

impl From<String> for Language {
    fn from(value: String) -> Self {
        Self::new(SmolStr::from(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkTarget {
    Anchor(Anchor),
    Reference(ReferenceId),
    External(ExternalLink),
}

impl LinkTarget {
    #[must_use]
    pub fn anchor(value: impl Into<Anchor>) -> Self {
        Self::Anchor(value.into())
    }

    #[must_use]
    pub fn reference(value: impl Into<ReferenceId>) -> Self {
        Self::Reference(value.into())
    }

    #[must_use]
    pub fn external(value: impl Into<ExternalLink>) -> Self {
        Self::External(value.into())
    }

    #[must_use]
    pub fn classify(value: impl AsRef<str>) -> Self {
        let value = value.as_ref().trim();
        if let Some(value) = value.strip_prefix('#') {
            return Self::anchor(Anchor::from(value.to_string()));
        }
        if value.contains("://")
            || value.starts_with("mailto:")
            || value.starts_with("tel:")
            || value.starts_with('/')
        {
            return Self::external(value.to_string());
        }
        Self::reference(value.to_string())
    }

    #[must_use]
    pub fn key(&self) -> &str {
        match self {
            Self::Anchor(anchor) => anchor.as_str(),
            Self::Reference(value) => value.as_str(),
            Self::External(value) => value.as_str(),
        }
    }

    #[must_use]
    pub fn anchor_ref(&self) -> Option<&Anchor> {
        match self {
            Self::Anchor(anchor) => Some(anchor),
            Self::Reference(_) | Self::External(_) => None,
        }
    }
}

impl fmt::Display for LinkTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Anchor(anchor) => write!(f, "#{}", anchor.as_str()),
            Self::Reference(value) => f.write_str(value.as_str()),
            Self::External(value) => f.write_str(value.as_str()),
        }
    }
}

impl From<&str> for LinkTarget {
    fn from(value: &str) -> Self {
        Self::classify(value)
    }
}

impl From<String> for LinkTarget {
    fn from(value: String) -> Self {
        Self::classify(value)
    }
}

impl From<Anchor> for LinkTarget {
    fn from(value: Anchor) -> Self {
        Self::Anchor(value)
    }
}

impl From<ReferenceId> for LinkTarget {
    fn from(value: ReferenceId) -> Self {
        Self::Reference(value)
    }
}

impl From<ExternalLink> for LinkTarget {
    fn from(value: ExternalLink) -> Self {
        Self::External(value)
    }
}

pub(super) fn slugify(text: &str) -> String {
    slug(text.nfkc().flat_map(char::to_lowercase))
}

pub(super) fn slugify_ascii(text: &str) -> String {
    slug(deunicode(text).chars().flat_map(char::to_lowercase))
}

fn slug(iter: impl Iterator<Item = char>) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in iter {
        if ch.is_alphanumeric() {
            out.push(ch);
            dash = false;
            continue;
        }
        if out.is_empty() || dash {
            continue;
        }
        out.push('-');
        dash = true;
    }
    if out.ends_with('-') {
        out.pop();
    }
    out
}
