use serde::{Deserialize, Serialize};

use super::{
    Anchor, ColumnAlignment, ExternalLink, HeadingLevel, Language, LinkTarget, ListSpacing,
    ListStyle, NodeRef, ReferenceId, SectionKind, VisitFlow, visit_children,
};
use crate::error::AnchorError;

macro_rules! schema_pat {
    ($enum:ident::$name:ident) => {
        $enum::$name
    };
    ($enum:ident::$name:ident { $($field:ident),* $(,)? }) => {
        $enum::$name { .. }
    };
}

macro_rules! node_schema {
    (
        tags {
            $(
                $tag:ident $( {
                    $( $tfield:ident : $town:ty => $tborrow:ty = $tproj:expr ),* $(,)?
                } )? => $tfn:ident, $tvisit:ident
            ),* $(,)?
        }
        atoms {
            $(
                $atom:ident $( {
                    $( $afield:ident : $aown:ty => $aborrow:ty = $aproj:expr ),* $(,)?
                } )? => $afn:ident, $avisit:ident
            ),* $(,)?
        }
    ) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
        pub enum NodeKind {
            $( $tag, )*
            $( $atom, )*
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Tag<'a> {
            $( $tag $( { $($tfield : $tborrow),* } )?, )*
        }

        impl<'a> Tag<'a> {
            #[must_use]
            #[inline]
            pub fn kind(self) -> NodeKind {
                match self {
                    $( schema_pat!(Tag::$tag $( { $($tfield),* } )?) => NodeKind::$tag, )*
                }
            }

            #[must_use]
            #[inline]
            pub fn end(self) -> TagEnd {
                match self {
                    $( schema_pat!(Tag::$tag $( { $($tfield),* } )?) => TagEnd::$tag, )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum TagEnd {
            $( $tag, )*
        }

        impl TagEnd {
            #[must_use]
            #[inline]
            pub fn kind(self) -> NodeKind {
                match self {
                    $( Self::$tag => NodeKind::$tag, )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Atom<'a> {
            $( $atom $( { $($afield : $aborrow),* } )?, )*
        }

        impl<'a> Atom<'a> {
            #[must_use]
            #[inline]
            pub fn kind(self) -> NodeKind {
                match self {
                    $( schema_pat!(Atom::$atom $( { $($afield),* } )?) => NodeKind::$atom, )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum NodeView<'a> {
            Tag(Tag<'a>),
            Atom(Atom<'a>),
        }

        impl<'a> NodeView<'a> {
            #[must_use]
            #[inline]
            pub fn kind(self) -> NodeKind {
                match self {
                    Self::Tag(tag) => tag.kind(),
                    Self::Atom(atom) => atom.kind(),
                }
            }
        }

        /// A typed document node.
        ///
        /// Block containers no longer carry generic text payloads. Text lives in
        /// atomic leaves, and inline structure is preserved by child order.
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[non_exhaustive]
        pub enum DocumentNode {
            $( $tag $( { $($tfield : $town),* } )?, )*
            $( $atom $( { $($afield : $aown),* } )?, )*
        }

        impl DocumentNode {
            $(
                #[allow(dead_code)]
                fn $tfn($($( $tfield : $town ),*)?) -> Self {
                    Self::$tag $( { $($tfield),* } )?
                }
            )*

            $(
                #[allow(dead_code)]
                fn $afn($($( $afield : $aown ),*)?) -> Self {
                    Self::$atom $( { $($afield),* } )?
                }
            )*

            #[must_use]
            #[inline]
            pub fn kind(&self) -> NodeKind {
                self.view().kind()
            }

            #[must_use]
            #[inline]
            pub fn view(&self) -> NodeView<'_> {
                match self {
                    $(
                        Self::$tag $( { $($tfield),* } )? => NodeView::Tag(
                            Tag::$tag $( { $($tfield : $tproj),* } )?
                        ),
                    )*
                    $(
                        Self::$atom $( { $($afield),* } )? => NodeView::Atom(
                            Atom::$atom $( { $($afield : $aproj),* } )?
                        ),
                    )*
                }
            }
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

            fn visit_node(
                &mut self,
                node: NodeRef<'_>,
            ) -> std::result::Result<VisitFlow, Self::Error> {
                match node.view() {
                    $( NodeView::Tag(schema_pat!(Tag::$tag $( { $($tfield),* } )?)) => {
                        self.$tvisit(node)
                    } )*
                    $( NodeView::Atom(schema_pat!(Atom::$atom $( { $($afield),* } )?)) => {
                        self.$avisit(node)
                    } )*
                }
            }

            $(
                fn $tvisit(
                    &mut self,
                    node: NodeRef<'_>,
                ) -> std::result::Result<VisitFlow, Self::Error> {
                    let NodeView::Tag(tag) = node.view() else {
                        unreachable!("tag visitor called for atom");
                    };
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
            )*

            $(
                fn $avisit(
                    &mut self,
                    node: NodeRef<'_>,
                ) -> std::result::Result<VisitFlow, Self::Error> {
                    let NodeView::Atom(atom) = node.view() else {
                        unreachable!("atom visitor called for tag");
                    };
                    self.visit_atom(node, atom)
                }
            )*
        }
    };
}

node_schema! {
    tags {
        Root => root_raw, visit_root,
        Section {
            level: HeadingLevel => HeadingLevel = *level,
            kind: SectionKind => SectionKind = *kind,
            anchor: Anchor => &'a Anchor = anchor,
            title: String => &'a str = title,
        } => section_node, visit_section,
        Paragraph => paragraph_raw, visit_paragraph,
        List {
            style: ListStyle => ListStyle = *style,
            spacing: ListSpacing => ListSpacing = *spacing,
        } => list_raw, visit_list,
        ListItem => list_item_raw, visit_list_item,
        BlockQuote => block_quote_raw, visit_block_quote,
        Table {
            alignments: Vec<ColumnAlignment> => &'a [ColumnAlignment] = alignments,
        } => table_raw, visit_table,
        TableRow => table_row_raw, visit_table_row,
        TableCell => table_cell_raw, visit_table_cell,
        Strong => strong_raw, visit_strong,
        Emphasis => emphasis_raw, visit_emphasis,
        Link {
            target: LinkTarget => &'a LinkTarget = target,
            title: Option<String> => Option<&'a str> = title.as_deref(),
        } => link_node, visit_link
    }
    atoms {
        Html {
            html: String => &'a str = html,
        } => html_node, visit_html,
        CodeBlock {
            language: Option<Language> => Option<&'a str> = language.as_ref().map(Language::as_str),
            code: String => &'a str = code,
        } => code_block_node, visit_code_block,
        Text {
            text: String => &'a str = text,
        } => text_node, visit_text,
        Image {
            anchor: Option<Anchor> => Option<&'a Anchor> = anchor.as_ref(),
            url: ExternalLink => &'a str = url.as_str(),
            alt: String => &'a str = alt,
        } => image_node, visit_image,
        ThematicBreak => thematic_break_raw, visit_thematic_break
    }
}

impl<'a> Tag<'a> {
    #[must_use]
    pub fn anchor(self) -> Option<&'a Anchor> {
        match self {
            Self::Section { anchor, .. } => Some(anchor),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_title(self) -> Option<&'a str> {
        match self {
            Self::Section { title, .. } => Some(title),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_level(self) -> Option<HeadingLevel> {
        match self {
            Self::Section { level, .. } => Some(level),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_kind(self) -> Option<SectionKind> {
        match self {
            Self::Section { kind, .. } => Some(kind),
            _ => None,
        }
    }

    #[must_use]
    pub fn link_target(self) -> Option<&'a LinkTarget> {
        match self {
            Self::Link { target, .. } => Some(target),
            _ => None,
        }
    }
}

impl<'a> Atom<'a> {
    #[must_use]
    pub fn anchor(self) -> Option<&'a Anchor> {
        match self {
            Self::Image { anchor, .. } => anchor,
            _ => None,
        }
    }

    #[must_use]
    pub fn image_url(self) -> Option<&'a str> {
        match self {
            Self::Image { url, .. } => Some(url),
            _ => None,
        }
    }

    #[must_use]
    pub fn display_text(self) -> Option<&'a str> {
        match self {
            Self::Html { html } => Some(html),
            Self::CodeBlock { code, .. } => Some(code),
            Self::Text { text } => Some(text),
            Self::Image { alt, .. } => Some(alt),
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
            Self::Tag(Tag::Section { title, .. }) => Some(title),
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
        Self::List { style, spacing }
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
    pub fn table(alignments: Vec<ColumnAlignment>) -> Self {
        Self::Table { alignments }
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
        Self::code_block_node(language, code.into())
    }

    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self::text_node(text.into())
    }

    #[must_use]
    pub fn link(target: impl Into<LinkTarget>, title: Option<String>) -> Self {
        Self::link_node(target.into(), title)
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
        Self::image_node(None, url.into(), alt.into())
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
        Self::html_node(content.into())
    }

    #[must_use]
    pub fn thematic_break() -> Self {
        Self::ThematicBreak
    }

    #[must_use]
    pub fn section(level: HeadingLevel, title: impl AsRef<str>) -> Self {
        Self::section_with(level, SectionKind::Other, title)
    }

    #[must_use]
    pub fn section_with(level: HeadingLevel, kind: SectionKind, title: impl AsRef<str>) -> Self {
        let title = title.as_ref();
        Self::section_node(level, kind, Anchor::slug(title), title.to_string())
    }

    pub fn try_with_anchor(
        mut self,
        anchor: impl Into<Anchor>,
    ) -> std::result::Result<Self, AnchorError> {
        let anchor = anchor.into();
        match &mut self {
            Self::Section { anchor: slot, .. } => *slot = anchor,
            Self::Image { anchor: slot, .. } => *slot = Some(anchor),
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
        matches!(self.view(), NodeView::Tag(Tag::Section { .. }))
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
            Self::Section { anchor: slot, .. } => {
                let Some(anchor) = anchor else {
                    return Err(AnchorError::RequiredAnchor);
                };
                *slot = anchor;
                Ok(())
            }
            Self::Image { anchor: slot, .. } => {
                *slot = anchor;
                Ok(())
            }
            _ => Err(AnchorError::NotAnchorable { kind: self.kind() }),
        }
    }
}
