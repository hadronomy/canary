use serde::{Deserialize, Serialize};
use smol_str::SmolStr;

use super::{
    Anchor, Atom, ColumnAlignment, ExternalLink, HeadingLevel, Language, LinkTarget, ListSpacing,
    ListStyle, SectionKind, Tag,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Section {
    level: HeadingLevel,
    kind: SectionKind,
    anchor: Anchor,
    title: SmolStr,
}

impl Section {
    #[must_use]
    pub fn new(level: HeadingLevel, kind: SectionKind, title: impl Into<SmolStr>) -> Self {
        let title = title.into();
        let anchor = Anchor::slug(title.as_str());
        Self { level, kind, anchor, title }
    }

    pub(crate) fn anchored(
        level: HeadingLevel,
        kind: SectionKind,
        anchor: Anchor,
        title: impl Into<SmolStr>,
    ) -> Self {
        Self { level, kind, anchor, title: title.into() }
    }

    #[must_use]
    pub fn with_anchor(mut self, anchor: Anchor) -> Self {
        self.anchor = anchor;
        self
    }

    pub(super) fn set_anchor(&mut self, anchor: Anchor) {
        self.anchor = anchor;
    }

    #[must_use]
    pub fn level(&self) -> HeadingLevel {
        self.level
    }

    #[must_use]
    pub fn kind(&self) -> SectionKind {
        self.kind
    }

    #[must_use]
    pub fn anchor(&self) -> &Anchor {
        &self.anchor
    }

    #[must_use]
    pub fn title(&self) -> &str {
        self.title.as_str()
    }

    #[must_use]
    pub(crate) fn as_tag(&self) -> Tag<'_> {
        Tag::Section(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct List {
    style: ListStyle,
    spacing: ListSpacing,
}

impl List {
    #[must_use]
    pub fn new(style: ListStyle, spacing: ListSpacing) -> Self {
        Self { style, spacing }
    }

    #[must_use]
    pub fn style(&self) -> ListStyle {
        self.style
    }

    #[must_use]
    pub fn spacing(&self) -> ListSpacing {
        self.spacing
    }

    #[must_use]
    pub(crate) fn as_tag(&self) -> Tag<'_> {
        Tag::List(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    alignments: Vec<ColumnAlignment>,
}

impl Table {
    #[must_use]
    pub fn new(alignments: Vec<ColumnAlignment>) -> Self {
        Self { alignments }
    }

    #[must_use]
    pub fn alignments(&self) -> &[ColumnAlignment] {
        &self.alignments
    }

    #[must_use]
    pub(crate) fn as_tag(&self) -> Tag<'_> {
        Tag::Table(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    target: LinkTarget,
    title: Option<SmolStr>,
}

impl Link {
    #[must_use]
    pub fn new(target: LinkTarget, title: Option<SmolStr>) -> Self {
        Self { target, title }
    }

    #[must_use]
    pub fn target(&self) -> &LinkTarget {
        &self.target
    }

    #[must_use]
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    #[must_use]
    pub(crate) fn as_tag(&self) -> Tag<'_> {
        Tag::Link(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Html {
    html: String,
}

impl Html {
    #[must_use]
    pub fn new(html: impl Into<String>) -> Self {
        Self { html: html.into() }
    }

    #[must_use]
    pub fn html(&self) -> &str {
        &self.html
    }

    #[must_use]
    pub(crate) fn as_atom(&self) -> Atom<'_> {
        Atom::Html(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeBlock {
    language: Option<Language>,
    code: String,
}

impl CodeBlock {
    #[must_use]
    pub fn new(language: Option<Language>, code: impl Into<String>) -> Self {
        Self { language, code: code.into() }
    }

    #[must_use]
    pub fn language(&self) -> Option<&str> {
        self.language.as_ref().map(Language::as_str)
    }

    #[must_use]
    pub fn code(&self) -> &str {
        &self.code
    }

    #[must_use]
    pub(crate) fn as_atom(&self) -> Atom<'_> {
        Atom::CodeBlock(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Text {
    text: String,
}

impl Text {
    #[must_use]
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    #[must_use]
    pub(crate) fn as_atom(&self) -> Atom<'_> {
        Atom::Text(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Image {
    anchor: Option<Anchor>,
    url: ExternalLink,
    alt: SmolStr,
}

impl Image {
    #[must_use]
    pub fn new(url: ExternalLink, alt: impl Into<SmolStr>) -> Self {
        Self { anchor: None, url, alt: alt.into() }
    }

    #[must_use]
    pub fn with_anchor(mut self, anchor: Anchor) -> Self {
        self.anchor = Some(anchor);
        self
    }

    pub(super) fn set_anchor(&mut self, anchor: Option<Anchor>) {
        self.anchor = anchor;
    }

    #[must_use]
    pub fn anchor(&self) -> Option<&Anchor> {
        self.anchor.as_ref()
    }

    #[must_use]
    pub fn url(&self) -> &str {
        self.url.as_str()
    }

    #[must_use]
    pub fn alt(&self) -> &str {
        self.alt.as_str()
    }

    #[must_use]
    pub(crate) fn as_atom(&self) -> Atom<'_> {
        Atom::Image(self)
    }
}
