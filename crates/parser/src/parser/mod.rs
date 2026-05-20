//! XML parser and tree builder for BOE-like legal documents.
//!
//! This module intentionally separates parsing into two phases:
//! - `LegalDocument::from_xml` decodes XML into an intermediate representation.
//! - `TreeParser::build_tree` projects that representation into `DocumentTree`.
//!
//! The split keeps XML parsing reusable and makes policy-driven tree construction
//! explicit.

mod attrs;
mod model;
mod reader;
mod sink;

#[cfg(test)]
mod tests;

use std::io::{BufRead, BufReader};
use std::path::Path;

pub use model::{
    BlockKind, DocumentMeta, LegalDocument, ParaKind, VersionPolicy, XmlBlock, XmlInline, XmlNode,
    XmlPara, XmlParaBody, XmlRow, XmlTable, XmlVersion,
};
use reader::{BoeBufReader, BoeSliceReader, BoeStream};
use sink::{TreeProjector, TreeSink, XmlSink};

use crate::error::Result;
use crate::tree::{DocumentNode, DocumentTree, DocumentTreeBuilder, SectionKind};

/// Configurable projector from XML IR into `DocumentTree`.
#[derive(Debug, Clone)]
pub struct TreeParser {
    policy: VersionPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HeadingMatch {
    kind: ParaKind,
    title: String,
    start: usize,
    span: usize,
}

impl TreeParser {
    fn head(para: &XmlPara) -> Option<ParaKind> {
        if para.class == "anexo" || para.class.starts_with("anexo_") {
            return Some(ParaKind::Titulo);
        }
        para.kind.heading().then_some(para.kind)
    }

    fn rank(kind: ParaKind) -> u8 {
        match kind {
            ParaKind::Titulo => 1,
            ParaKind::Capitulo => 2,
            ParaKind::Seccion => 3,
            ParaKind::Articulo => 4,
            _ => 2,
        }
    }

    fn section(kind: ParaKind) -> SectionKind {
        match kind {
            ParaKind::Titulo => SectionKind::Titulo,
            ParaKind::Capitulo => SectionKind::Capitulo,
            ParaKind::Seccion => SectionKind::Seccion,
            ParaKind::Articulo => SectionKind::Articulo,
            _ => SectionKind::Other,
        }
    }

    /// Determines the heading title for a block/version pair.
    fn heading(block: &XmlBlock, version: &XmlVersion) -> Option<HeadingMatch> {
        if block.kind == BlockKind::Preambulo {
            return Some(HeadingMatch {
                kind: ParaKind::Titulo,
                title: "Preámbulo".to_string(),
                start: 0,
                span: 0,
            });
        }
        for (idx, node) in version.nodes.iter().enumerate() {
            let XmlNode::Paragraph(para) = node else {
                continue;
            };
            let Some(kind) = Self::head(para) else {
                continue;
            };
            let text = para.text().trim();
            if text.is_empty() {
                continue;
            }

            let mut parts = vec![text.to_string()];
            let mut span = 1usize;
            for next in &version.nodes[idx + 1..] {
                let XmlNode::Paragraph(next) = next else {
                    break;
                };
                let Some(next_kind) = Self::head(next) else {
                    break;
                };
                if next_kind != kind {
                    break;
                }
                let text = next.text().trim();
                if text.is_empty() {
                    continue;
                }
                parts.push(text.to_string());
                span += 1;
            }
            return Some(HeadingMatch { kind, title: parts.join(" "), start: idx, span });
        }
        if let Some(title) = &block.title {
            let value = title.trim();
            if !value.is_empty() {
                return Some(HeadingMatch {
                    kind: ParaKind::Titulo,
                    title: value.to_string(),
                    start: 0,
                    span: 0,
                });
            }
        }
        None
    }

    fn push_para(
        tree: &mut DocumentTreeBuilder,
        parent: crate::NodeId,
        para: &XmlPara,
    ) -> Result<()> {
        match &para.body {
            XmlParaBody::Plain(text) => {
                let text = text.trim();
                if !text.is_empty() {
                    let pid = tree.try_add_child(parent, DocumentNode::paragraph())?;
                    tree.try_add_child(pid, DocumentNode::text(text.to_string()))?;
                }
            }
            XmlParaBody::Rich { inline, .. } => {
                if !inline.is_empty() {
                    let pid = tree.try_add_child(parent, DocumentNode::paragraph())?;
                    for part in inline {
                        match part {
                            XmlInline::Text(text) => {
                                if !text.is_empty() {
                                    tree.try_add_child(pid, DocumentNode::text(text.clone()))?;
                                }
                            }
                            XmlInline::Link { target, label } => {
                                let lid = tree
                                    .try_add_child(pid, DocumentNode::link(target.clone(), None))?;
                                tree.try_add_child(lid, DocumentNode::text(label.clone()))?;
                            }
                        }
                    }
                }
            }
        }

        if para.kind.divider() {
            tree.try_add_child(parent, DocumentNode::thematic_break())?;
        }
        Ok(())
    }

    fn push_html(
        tree: &mut DocumentTreeBuilder,
        parent: crate::NodeId,
        html: &mut String,
    ) -> Result<()> {
        let value = html.trim();
        if value.is_empty() {
            html.clear();
            return Ok(());
        }
        tree.try_add_child(parent, DocumentNode::html(value.to_string()))?;
        html.clear();
        Ok(())
    }

    fn push_table(
        tree: &mut DocumentTreeBuilder,
        parent: crate::NodeId,
        table: &XmlTable,
    ) -> Result<()> {
        let cols = table.rows.iter().map(|it| it.cells.len()).max().unwrap_or(0);
        let tid = tree.try_add_child(parent, DocumentNode::table(vec![None; cols]))?;
        for row in &table.rows {
            let rid = tree.try_add_child(tid, DocumentNode::table_row())?;
            for cell in &row.cells {
                let cid = tree.try_add_child(rid, DocumentNode::table_cell())?;
                if !cell.is_empty() {
                    tree.try_add_child(cid, DocumentNode::text(cell.clone()))?;
                }
            }
        }
        Ok(())
    }

    fn push_nodes(
        tree: &mut DocumentTreeBuilder,
        parent: crate::NodeId,
        nodes: &[XmlNode],
    ) -> Result<()> {
        let mut html = String::new();
        for node in nodes {
            match node {
                XmlNode::Paragraph(para) => {
                    Self::push_html(tree, parent, &mut html)?;
                    Self::push_para(tree, parent, para)?;
                }
                XmlNode::Table(table) => {
                    Self::push_html(tree, parent, &mut html)?;
                    Self::push_table(tree, parent, table)?;
                }
                XmlNode::Html(raw) => {
                    if !html.is_empty() {
                        html.push('\n');
                    }
                    html.push_str(raw);
                }
                XmlNode::BlockQuote(items) => {
                    Self::push_html(tree, parent, &mut html)?;
                    let bid = tree.try_add_child(parent, DocumentNode::block_quote())?;
                    Self::push_nodes(tree, bid, items)?;
                }
            }
        }
        Self::push_html(tree, parent, &mut html)?;
        Ok(())
    }

    /// Builds a `DocumentTree` from pre-parsed XML blocks.
    pub fn build_tree(&self, blocks: &[XmlBlock]) -> Result<DocumentTree> {
        let mut out = TreeProjector::new(self.policy);
        for block in blocks {
            out.push(block)?;
        }
        out.finish()
    }

    #[must_use]
    /// Creates a parser with default version-selection behavior.
    pub fn new() -> Self {
        Self { policy: VersionPolicy::default() }
    }

    #[must_use]
    /// Sets version-selection behavior with an explicit policy.
    pub fn policy(mut self, policy: VersionPolicy) -> Self {
        self.policy = policy;
        self
    }

    /// Parses an XML file and returns a projected tree.
    pub fn parse_xml_file<P: AsRef<Path>>(&self, path: P) -> Result<DocumentTree> {
        let file = std::fs::File::open(path)?;
        let reader = BufReader::new(file);
        self.parse_reader(reader)
    }

    pub fn parse_reader_document<R: BufRead>(&self, reader: R) -> Result<LegalDocument> {
        LegalDocument::from_reader(reader)
    }

    /// Parses XML bytes into the intermediate representation.
    pub fn parse_bytes_document(&self, bytes: &[u8]) -> Result<LegalDocument> {
        LegalDocument::from_bytes(bytes)
    }

    pub fn parse_reader<R: BufRead>(&self, reader: R) -> Result<DocumentTree> {
        let mut reader = BoeBufReader::new(reader);
        let mut sink = TreeSink::new(self.policy);
        reader.read_document(&mut sink)?;
        sink.finish()
    }

    /// Parses XML bytes and returns a projected tree.
    pub fn parse_bytes(&self, bytes: &[u8]) -> Result<DocumentTree> {
        let mut reader = BoeSliceReader::new(bytes);
        let mut sink = TreeSink::new(self.policy);
        reader.read_document(&mut sink)?;
        sink.finish()
    }

    /// Parses XML text and returns a projected tree.
    pub fn parse_xml(&self, xml: &str) -> Result<DocumentTree> {
        self.parse_bytes(xml.as_bytes())
    }
}

impl Default for TreeParser {
    fn default() -> Self {
        Self::new()
    }
}
