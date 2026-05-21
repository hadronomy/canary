use parser_macros::document_nodes;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;

use super::payload::{CodeBlock, Html, Image, Link, List, Section, Table, Text};
use super::{
    Anchor, ExternalLink, HeadingLevel, Language, LinkTarget, ListSpacing, ListStyle, NodeRef,
    ReferenceId, SectionKind, VisitFlow, visit_children,
};
use crate::error::AnchorError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
#[document_nodes]
pub enum DocumentNode {
    #[tag]
    Root,
    #[tag]
    Section(Section),
    #[tag]
    Paragraph,
    #[tag]
    List(List),
    #[tag]
    ListItem,
    #[tag]
    BlockQuote,
    #[tag]
    Table(Table),
    #[tag]
    TableRow,
    #[tag]
    TableCell,
    #[tag]
    Strong,
    #[tag]
    Emphasis,
    #[tag]
    Link(Link),
    #[atom]
    Html(Html),
    #[atom]
    CodeBlock(CodeBlock),
    #[atom]
    Text(Text),
    #[atom]
    Image(Image),
    #[atom]
    ThematicBreak,
}

pub trait Visit {
    type Error;

    fn enter_tag(
        &mut self,
        _node: NodeRef<'_>,
        _tag: Tag<'_>,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        Ok(VisitFlow::Continue)
    }

    fn leave_tag(
        &mut self,
        _node: NodeRef<'_>,
        _tag: TagEnd,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        Ok(VisitFlow::Continue)
    }

    fn visit_atom(
        &mut self,
        _node: NodeRef<'_>,
        _atom: Atom<'_>,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        Ok(VisitFlow::Continue)
    }

    fn visit_node(&mut self, node: NodeRef<'_>) -> std::result::Result<VisitFlow, Self::Error> {
        match node.view() {
            NodeView::Tag(tag) => {
                match self.enter_tag(node, tag)? {
                    VisitFlow::Continue => {}
                    VisitFlow::SkipChildren => return self.leave_tag(node, tag.end()),
                    VisitFlow::Break => return Ok(VisitFlow::Break),
                }
                if matches!(visit_children(self, node)?, VisitFlow::Break) {
                    return Ok(VisitFlow::Break);
                }
                self.leave_tag(node, tag.end())
            }
            NodeView::Atom(atom) => self.visit_atom(node, atom),
        }
    }
}

impl<'a> Tag<'a> {
    #[must_use]
    pub fn anchor(self) -> Option<&'a Anchor> {
        match self {
            Self::Section(section) => Some(section.anchor()),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_title(self) -> Option<&'a str> {
        match self {
            Self::Section(section) => Some(section.title()),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_level(self) -> Option<HeadingLevel> {
        match self {
            Self::Section(section) => Some(section.level()),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_kind(self) -> Option<SectionKind> {
        match self {
            Self::Section(section) => Some(section.kind()),
            _ => None,
        }
    }

    #[must_use]
    pub fn link_target(self) -> Option<&'a LinkTarget> {
        match self {
            Self::Link(link) => Some(link.target()),
            _ => None,
        }
    }
}

impl<'a> Atom<'a> {
    #[must_use]
    pub fn anchor(self) -> Option<&'a Anchor> {
        match self {
            Self::Image(image) => image.anchor(),
            _ => None,
        }
    }

    #[must_use]
    pub fn image_url(self) -> Option<&'a str> {
        match self {
            Self::Image(image) => Some(image.url()),
            _ => None,
        }
    }

    #[must_use]
    pub fn display_text(self) -> Option<&'a str> {
        match self {
            Self::Html(html) => Some(html.html()),
            Self::CodeBlock(code) => Some(code.code()),
            Self::Text(text) => Some(text.text()),
            Self::Image(image) => Some(image.alt()),
            Self::ThematicBreak => None,
        }
    }
}

impl<'a> NodeView<'a> {
    #[must_use]
    pub fn anchor(self) -> Option<&'a Anchor> {
        match self {
            Self::Tag(tag) => tag.anchor(),
            Self::Atom(atom) => atom.anchor(),
        }
    }

    #[must_use]
    pub fn section_title(self) -> Option<&'a str> {
        match self {
            Self::Tag(tag) => tag.section_title(),
            Self::Atom(_) => None,
        }
    }

    #[must_use]
    pub fn section_level(self) -> Option<HeadingLevel> {
        match self {
            Self::Tag(tag) => tag.section_level(),
            Self::Atom(_) => None,
        }
    }

    #[must_use]
    pub fn section_kind(self) -> Option<SectionKind> {
        match self {
            Self::Tag(tag) => tag.section_kind(),
            Self::Atom(_) => None,
        }
    }

    #[must_use]
    pub fn link_target(self) -> Option<&'a LinkTarget> {
        match self {
            Self::Tag(tag) => tag.link_target(),
            Self::Atom(_) => None,
        }
    }

    #[must_use]
    pub fn image_url(self) -> Option<&'a str> {
        match self {
            Self::Tag(_) => None,
            Self::Atom(atom) => atom.image_url(),
        }
    }

    #[must_use]
    pub fn display_text(self) -> Option<&'a str> {
        match self {
            Self::Tag(Tag::Section(section)) => Some(section.title()),
            Self::Tag(_) => None,
            Self::Atom(atom) => atom.display_text(),
        }
    }
}

impl DocumentNode {
    #[must_use]
    pub fn root() -> Self {
        Self::Root
    }

    #[must_use]
    pub fn paragraph() -> Self {
        Self::Paragraph
    }

    #[must_use]
    pub fn list(style: ListStyle, spacing: ListSpacing) -> Self {
        Self::List(List::new(style, spacing))
    }

    #[must_use]
    pub fn list_item() -> Self {
        Self::ListItem
    }

    #[must_use]
    pub fn block_quote() -> Self {
        Self::BlockQuote
    }

    #[must_use]
    pub fn table(alignments: Vec<super::ColumnAlignment>) -> Self {
        Self::Table(Table::new(alignments))
    }

    #[must_use]
    pub fn table_row() -> Self {
        Self::TableRow
    }

    #[must_use]
    pub fn table_cell() -> Self {
        Self::TableCell
    }

    #[must_use]
    pub fn code_block(language: Option<Language>, code: impl Into<String>) -> Self {
        Self::CodeBlock(CodeBlock::new(language, code))
    }

    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text(Text::new(text))
    }

    #[must_use]
    pub fn link(target: impl Into<LinkTarget>, title: Option<String>) -> Self {
        Self::Link(Link::new(target.into(), title.map(Into::into)))
    }

    #[must_use]
    pub fn link_anchor(anchor: impl Into<Anchor>, title: Option<String>) -> Self {
        Self::link(LinkTarget::anchor(anchor), title)
    }

    #[must_use]
    pub fn link_reference(value: impl Into<ReferenceId>, title: Option<String>) -> Self {
        Self::link(value.into(), title)
    }

    #[must_use]
    pub fn link_external(url: impl Into<ExternalLink>, title: Option<String>) -> Self {
        Self::link(url.into(), title)
    }

    #[must_use]
    pub fn image(url: impl Into<ExternalLink>, alt: impl Into<String>) -> Self {
        Self::Image(Image::new(url.into(), alt.into()))
    }

    #[must_use]
    pub fn strong() -> Self {
        Self::Strong
    }

    #[must_use]
    pub fn emphasis() -> Self {
        Self::Emphasis
    }

    #[must_use]
    pub fn html(content: impl Into<String>) -> Self {
        Self::Html(Html::new(content))
    }

    #[must_use]
    pub fn thematic_break() -> Self {
        Self::ThematicBreak
    }

    #[must_use]
    pub fn section(level: HeadingLevel, title: impl Into<SmolStr>) -> Self {
        Self::Section(Section::new(level, SectionKind::Other, title))
    }

    #[must_use]
    pub fn section_with(level: HeadingLevel, kind: SectionKind, title: impl Into<SmolStr>) -> Self {
        Self::Section(Section::new(level, kind, title))
    }

    pub(crate) fn section_anchored(
        level: HeadingLevel,
        kind: SectionKind,
        anchor: Anchor,
        title: impl Into<SmolStr>,
    ) -> Self {
        Self::Section(Section::anchored(level, kind, anchor, title))
    }

    pub fn try_with_anchor(
        mut self,
        anchor: impl Into<Anchor>,
    ) -> std::result::Result<Self, AnchorError> {
        let anchor = anchor.into();
        match &mut self {
            Self::Section(section) => section.set_anchor(anchor),
            Self::Image(image) => image.set_anchor(Some(anchor)),
            _ => {
                return Err(AnchorError::NotAnchorable { kind: self.kind() });
            }
        }
        Ok(self)
    }

    #[must_use]
    pub fn slugify(text: &str) -> String {
        super::value::slugify(text)
    }

    #[must_use]
    pub fn slugify_ascii(text: &str) -> String {
        super::value::slugify_ascii(text)
    }

    #[must_use]
    pub fn is_section(&self) -> bool {
        matches!(self, Self::Section(_))
    }

    #[must_use]
    pub fn anchor(&self) -> Option<&str> {
        self.anchor_value().map(Anchor::as_str)
    }

    #[must_use]
    pub fn anchor_value(&self) -> Option<&Anchor> {
        self.view().anchor()
    }

    #[must_use]
    pub fn section_title(&self) -> Option<&str> {
        self.view().section_title()
    }

    #[must_use]
    pub fn section_level(&self) -> Option<HeadingLevel> {
        self.view().section_level()
    }

    #[must_use]
    pub fn section_kind(&self) -> Option<SectionKind> {
        self.view().section_kind()
    }

    #[must_use]
    pub fn link_target(&self) -> Option<&LinkTarget> {
        self.view().link_target()
    }

    #[must_use]
    pub fn image_url(&self) -> Option<&str> {
        self.view().image_url()
    }

    #[must_use]
    pub fn display_text(&self) -> Option<&str> {
        self.view().display_text()
    }

    pub(super) fn reference_target(&self) -> Option<&Anchor> {
        self.link_target().and_then(LinkTarget::anchor_ref)
    }

    pub(super) fn try_set_anchor(
        &mut self,
        anchor: Option<Anchor>,
    ) -> std::result::Result<(), AnchorError> {
        match self {
            Self::Section(section) => {
                let Some(anchor) = anchor else {
                    return Err(AnchorError::RequiredAnchor);
                };
                section.set_anchor(anchor);
                Ok(())
            }
            Self::Image(image) => {
                image.set_anchor(anchor);
                Ok(())
            }
            _ => Err(AnchorError::NotAnchorable { kind: self.kind() }),
        }
    }
}
