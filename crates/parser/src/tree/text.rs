use std::iter::FusedIterator;

use super::{Atom, DocumentNode, DocumentTree, NodeView, Tag};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeparatorPolicy {
    None,
    Space,
    Newline,
}

impl SeparatorPolicy {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Space => " ",
            Self::Newline => "\n",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextExtractOptions {
    pub include_section_titles: bool,
    pub include_image_alt: bool,
    pub include_code_blocks: bool,
    pub include_html: bool,
    pub separator: SeparatorPolicy,
}

impl Default for TextExtractOptions {
    fn default() -> Self {
        Self {
            include_section_titles: true,
            include_image_alt: true,
            include_code_blocks: true,
            include_html: true,
            separator: SeparatorPolicy::Space,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextSpanKind {
    SectionTitle,
    Html,
    CodeBlock,
    Text,
    ImageAlt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextSpan<'a> {
    pub kind: TextSpanKind,
    pub text: &'a str,
}

pub struct TextSpans<'a> {
    pub(super) inner: Option<indextree::Descendants<'a, DocumentNode>>,
    pub(super) opts: TextExtractOptions,
    pub(super) tree: &'a DocumentTree,
}

impl<'a> Iterator for TextSpans<'a> {
    type Item = TextSpan<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let inner = self.inner.as_mut()?;
        for raw in inner.by_ref() {
            match self.tree.arena[raw].get().view() {
                NodeView::Tag(Tag::Section { title, .. })
                    if self.opts.include_section_titles && !title.is_empty() =>
                {
                    return Some(TextSpan { kind: TextSpanKind::SectionTitle, text: title });
                }
                NodeView::Atom(Atom::Html { html })
                    if self.opts.include_html && !html.is_empty() =>
                {
                    return Some(TextSpan { kind: TextSpanKind::Html, text: html });
                }
                NodeView::Atom(Atom::CodeBlock { code, .. })
                    if self.opts.include_code_blocks && !code.is_empty() =>
                {
                    return Some(TextSpan { kind: TextSpanKind::CodeBlock, text: code });
                }
                NodeView::Atom(Atom::Text { text }) if !text.is_empty() => {
                    return Some(TextSpan { kind: TextSpanKind::Text, text });
                }
                NodeView::Atom(Atom::Image { alt, .. })
                    if self.opts.include_image_alt && !alt.is_empty() =>
                {
                    return Some(TextSpan { kind: TextSpanKind::ImageAlt, text: alt });
                }
                _ => {}
            }
        }
        None
    }
}

impl FusedIterator for TextSpans<'_> {}
