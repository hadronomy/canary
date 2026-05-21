use std::iter::FusedIterator;

use super::{DocumentNode, DocumentTree};

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
            if let Some(span) = span(self.opts, self.tree.arena[raw].get()) {
                return Some(span);
            }
        }
        None
    }
}

impl FusedIterator for TextSpans<'_> {}

pub(super) fn span<'a>(opts: TextExtractOptions, node: &'a DocumentNode) -> Option<TextSpan<'a>> {
    match node {
        DocumentNode::Section(section)
            if opts.include_section_titles && !section.title().is_empty() =>
        {
            Some(TextSpan { kind: TextSpanKind::SectionTitle, text: section.title() })
        }
        DocumentNode::Html(html) if opts.include_html && !html.html().is_empty() => {
            Some(TextSpan { kind: TextSpanKind::Html, text: html.html() })
        }
        DocumentNode::CodeBlock(code) if opts.include_code_blocks && !code.code().is_empty() => {
            Some(TextSpan { kind: TextSpanKind::CodeBlock, text: code.code() })
        }
        DocumentNode::Text(text) if !text.text().is_empty() => {
            Some(TextSpan { kind: TextSpanKind::Text, text: text.text() })
        }
        DocumentNode::Image(image) if opts.include_image_alt && !image.alt().is_empty() => {
            Some(TextSpan { kind: TextSpanKind::ImageAlt, text: image.alt() })
        }
        _ => None,
    }
}

pub(super) fn default_span(node: &DocumentNode) -> Option<&str> {
    match node {
        DocumentNode::Section(section) if !section.title().is_empty() => Some(section.title()),
        DocumentNode::Html(html) if !html.html().is_empty() => Some(html.html()),
        DocumentNode::CodeBlock(code) if !code.code().is_empty() => Some(code.code()),
        DocumentNode::Text(text) if !text.text().is_empty() => Some(text.text()),
        DocumentNode::Image(image) if !image.alt().is_empty() => Some(image.alt()),
        _ => None,
    }
}
