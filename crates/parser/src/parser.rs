//! XML parser and tree builder for BOE-like legal documents.
//!
//! This module intentionally separates parsing into two phases:
//! - `LegalDocument::from_xml` decodes XML into an intermediate representation.
//! - `TreeParser::build_tree` projects that representation into `DocumentTree`.
//!
//! The split keeps XML parsing reusable and makes policy-driven tree construction
//! explicit.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::NaiveDate;
use quick_xml::Reader;
use quick_xml::events::attributes::Attribute;
use quick_xml::events::{BytesStart, Event};

use crate::error::{DocumentError, Result};
use crate::tree::{DocumentNode, DocumentTree, NodeKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum VersionPolicy {
    #[default]
    Latest,
    First,
}

/// A parsed XML block under `<texto>`.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlBlock {
    /// Source block identifier (`id` attribute).
    pub id: String,
    /// Block semantic kind parsed from `tipo`.
    pub kind: BlockKind,
    /// Optional title from `titulo`.
    pub title: Option<String>,
    /// All temporal versions found in the block.
    pub versions: Vec<XmlVersion>,
}

/// A single temporal version of a block.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlVersion {
    /// Effective date (`fecha_vigencia`).
    pub date: NaiveDate,
    /// Paragraph-level nodes captured for this version.
    pub paras: Vec<XmlPara>,
}

/// Paragraph-like content extracted from XML.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlPara {
    /// Paragraph semantic kind from class name.
    pub kind: ParaKind,
    /// Normalized paragraph text.
    pub text: String,
    /// Inline references captured from `<a class="refPost">...`.
    pub refs: Vec<String>,
    /// Whether this paragraph is nested inside a blockquote element.
    pub quote: bool,
}

/// Paragraph classification used by XML extraction and tree projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ParaKind {
    Titulo,
    Capitulo,
    Seccion,
    Articulo,
    Parrafo,
    Nota,
    Centro,
    Other,
}

impl ParaKind {
    /// Returns `true` if this kind represents a structural heading.
    fn heading(self) -> bool {
        matches!(self, Self::Titulo | Self::Capitulo | Self::Seccion | Self::Articulo)
    }

    /// Returns `true` if this kind should become body text.
    fn body(self) -> bool {
        matches!(self, Self::Parrafo | Self::Nota)
    }

    /// Returns `true` when this paragraph kind acts as an in-section divider.
    fn divider(self) -> bool {
        matches!(self, Self::Centro)
    }

    /// Maps heading kind to tree section level.
    fn level(self) -> Option<u8> {
        match self {
            Self::Titulo => Some(1),
            Self::Capitulo => Some(2),
            Self::Seccion => Some(3),
            Self::Articulo => Some(4),
            _ => None,
        }
    }
}

/// Converts BOE paragraph class names into `ParaKind`.
impl From<&str> for ParaKind {
    fn from(value: &str) -> Self {
        match value {
            "articulo" => Self::Articulo,
            "nota_pie" => Self::Nota,
            s if s.starts_with("titulo") => Self::Titulo,
            s if s.starts_with("capitulo") => Self::Capitulo,
            s if s.starts_with("seccion") => Self::Seccion,
            s if s.starts_with("parrafo") => Self::Parrafo,
            s if s.starts_with("centro") => Self::Centro,
            _ => Self::Other,
        }
    }
}

/// Top-level block classification from `bloque@tipo`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BlockKind {
    Preambulo,
    Encabezado,
    Precepto,
    Other,
}

/// Converts `bloque@tipo` values into `BlockKind`.
impl From<&str> for BlockKind {
    fn from(value: &str) -> Self {
        match value {
            "preambulo" => Self::Preambulo,
            "encabezado" => Self::Encabezado,
            "precepto" => Self::Precepto,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildAction {
    Consumed,
    Skip,
}

/// Lightweight decoded attribute container for one XML start tag.
struct Attrs(Vec<(String, String)>);

impl Attrs {
    /// Decodes and collects all attributes from a start tag.
    fn from_tag(tag: &BytesStart<'_>, phase: &str) -> Result<Self> {
        let mut values = Vec::new();
        for attr in tag.attributes().with_checks(false).flatten() {
            values.push((
                String::from_utf8_lossy(attr.key.as_ref()).to_string(),
                BoeReader::decode_attr(&attr, tag, phase)?,
            ));
        }
        Ok(Self(values))
    }

    /// Returns the optional value for a byte key.
    fn get(&self, key: &str) -> Option<&str> {
        self.0.iter().find_map(|(k, v)| if k == key { Some(v.as_str()) } else { None })
    }

    /// Returns a required attribute or a phase-tagged error.
    fn require(&self, key: &str, phase: &str) -> Result<&str> {
        self.get(key)
            .ok_or_else(|| DocumentError::xml(format!("{phase}: missing `{key}` attribute")))
    }
}

/// Anchor uniqueness tracker for generated tree anchors.
#[derive(Debug, Default)]
struct Anchor {
    next_suffix: HashMap<String, usize>,
    used: HashSet<String>,
}

impl Anchor {
    /// Produces a deterministic unique anchor with stable suffixing.
    fn next(&mut self, title: &str, id: &str) -> String {
        let base = DocumentNode::slugify(title);

        if self.used.insert(base.clone()) {
            self.next_suffix.entry(base.clone()).or_insert(2);
            return base;
        }

        if !id.is_empty() {
            let alt = format!("{}-{}", base, DocumentNode::slugify(id));
            if self.used.insert(alt.clone()) {
                return alt;
            }
        }

        let next = self.next_suffix.entry(base.clone()).or_insert(2);
        loop {
            let candidate = format!("{}-{}", base, *next);
            *next += 1;
            if self.used.insert(candidate.clone()) {
                return candidate;
            }
        }
    }
}

/// Thin XML reader wrapper with centralized error mapping and traversal helpers.
struct BoeReader<'a> {
    inner: Reader<&'a [u8]>,
}

impl<'a> BoeReader<'a> {
    /// Creates a trimmed XML event reader.
    fn new(xml: &'a str) -> Self {
        let mut inner = Reader::from_str(xml);
        inner.config_mut().trim_text(true);
        Self { inner }
    }

    /// Reads the next XML event, mapping errors once.
    fn next(&mut self) -> Result<Event<'a>> {
        self.inner.read_event().map_err(|e| {
            DocumentError::xml_at(
                self.inner.buffer_position() as usize,
                format!("parse: XML error at byte {}: {e}", self.inner.buffer_position()),
            )
        })
    }

    /// Decodes text-like nodes with phase context.
    fn text<E: std::fmt::Display>(
        raw: std::result::Result<std::borrow::Cow<'_, str>, E>,
        phase: &str,
    ) -> Result<String> {
        raw.map(|it| it.into_owned())
            .map_err(|e| DocumentError::xml(format!("{phase}: invalid node: {e}")))
    }

    /// Decodes a single attribute value with phase context.
    fn decode_attr(attr: &Attribute<'_>, tag: &BytesStart<'_>, phase: &str) -> Result<String> {
        attr.decode_and_unescape_value(tag.decoder())
            .map(|it| it.into_owned())
            .map_err(|e| DocumentError::xml(format!("{phase}: invalid attribute: {e}")))
    }

    /// Parses dates in `YYYYMMDD` BOE format.
    fn parse_date(value: &str, phase: &str) -> Result<NaiveDate> {
        NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|e| {
            DocumentError::xml(format!("{phase}: invalid fecha_vigencia '{value}': {e}"))
        })
    }

    /// Collapses all whitespace runs into single spaces.
    fn normalize(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        for word in text.split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(word);
        }
        out
    }

    /// Skips a full element subtree until its matching closing tag.
    fn skip_element(&mut self, closing: &[u8]) -> Result<()> {
        let mut depth = 0usize;
        loop {
            match self.next()? {
                Event::Start(_) => depth += 1,
                Event::End(tag) if tag.name().as_ref() == closing && depth == 0 => break,
                Event::End(_) => {
                    if depth == 0 {
                        return Err(DocumentError::xml("skip: unbalanced close tag"));
                    }
                    depth -= 1;
                }
                Event::Eof => {
                    return Err(DocumentError::xml(format!(
                        "skip: unexpected EOF before closing {}",
                        String::from_utf8_lossy(closing)
                    )));
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Reads plain text content until a matching closing tag.
    ///
    /// Nested elements are traversed depth-safely; their textual content is
    /// flattened into the resulting string.
    fn read_text_until(&mut self, closing: &[u8]) -> Result<String> {
        let mut depth = 0usize;
        let mut out = String::new();
        loop {
            match self.next()? {
                Event::Text(value) => out.push_str(&Self::text(value.xml_content(), "text")?),
                Event::CData(value) => out.push_str(&Self::text(value.xml_content(), "cdata")?),
                Event::Start(_) => depth += 1,
                Event::End(tag) if tag.name().as_ref() == closing && depth == 0 => break,
                Event::End(_) => {
                    if depth == 0 {
                        return Err(DocumentError::xml("text: unbalanced close tag"));
                    }
                    depth -= 1;
                }
                Event::Eof => {
                    return Err(DocumentError::xml(format!(
                        "text: unexpected EOF before closing {}",
                        String::from_utf8_lossy(closing)
                    )));
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// Iterates direct children for a parent closing tag.
    ///
    /// The callback returns `ChildAction::Consumed` when it fully consumed the child
    /// element. Returning `ChildAction::Skip` delegates traversal to `skip_element`.
    fn each_child<F>(&mut self, closing: &[u8], phase: &str, mut f: F) -> Result<()>
    where
        F: FnMut(&BytesStart<'_>, &mut Self) -> Result<ChildAction>,
    {
        loop {
            match self.next()? {
                Event::Start(tag) => {
                    if f(&tag, self)? == ChildAction::Skip {
                        self.skip_element(tag.name().as_ref())?;
                    }
                }
                Event::End(tag) if tag.name().as_ref() == closing => break,
                Event::Eof => {
                    return Err(DocumentError::xml(format!(
                        "{phase}: unexpected EOF before closing {}",
                        String::from_utf8_lossy(closing)
                    )));
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Reads an anchor element and extracts an optional `refPost` reference.
    fn read_anchor(&mut self, start: &BytesStart<'_>) -> Result<(String, Option<String>)> {
        let attrs = Attrs::from_tag(start, "a")?;
        let class = attrs.get("class").unwrap_or_default();
        let text = self.read_text_until(b"a")?;
        if class == "refPost" {
            let value = text.trim().to_string();
            if !value.is_empty() {
                return Ok((text, Some(value)));
            }
        }
        Ok((text, None))
    }

    /// Reads one paragraph element and captures inline reference anchors.
    fn read_paragraph(&mut self, start: &BytesStart<'_>, quote: bool) -> Result<XmlPara> {
        let attrs = Attrs::from_tag(start, "p")?;
        let class = attrs.get("class").unwrap_or_default().to_string();
        let mut text = String::new();
        let mut refs = Vec::new();
        let mut depth = 0usize;

        loop {
            match self.next()? {
                Event::Text(value) => text.push_str(&Self::text(value.xml_content(), "text")?),
                Event::CData(value) => text.push_str(&Self::text(value.xml_content(), "cdata")?),
                Event::Start(tag) if tag.name().as_ref() == b"a" => {
                    let (value, reference) = self.read_anchor(&tag)?;
                    if let Some(reference) = reference {
                        refs.push(reference);
                    } else {
                        text.push_str(&value);
                    }
                }
                Event::Start(_) => {
                    depth += 1;
                }
                Event::End(tag) if tag.name().as_ref() == b"p" && depth == 0 => break,
                Event::End(_) => {
                    if depth == 0 {
                        return Err(DocumentError::xml("p: unbalanced close tag"));
                    }
                    depth -= 1;
                }
                Event::Eof => return Err(DocumentError::xml("p: unexpected EOF before closing p")),
                _ => {}
            }
        }

        let mut text = Self::normalize(&text);
        if !refs.is_empty() {
            while text.ends_with("..") {
                text.pop();
            }
        }

        Ok(XmlPara { kind: ParaKind::from(class.as_str()), text, refs, quote })
    }

    /// Processes a node under `<version>`, recursively flattening wrappers.
    fn read_version_node(
        &mut self,
        start: &BytesStart<'_>,
        version: &mut XmlVersion,
        quote: bool,
    ) -> Result<()> {
        if start.name().as_ref() == b"p" {
            let para = self.read_paragraph(start, quote)?;
            if !para.text.is_empty() {
                version.paras.push(para);
            }
            return Ok(());
        }

        let closing = start.name().as_ref().to_vec();
        let quote = quote || start.name().as_ref() == b"blockquote";
        self.each_child(&closing, "version", |tag, reader| {
            reader.read_version_node(tag, version, quote)?;
            Ok(ChildAction::Consumed)
        })
    }

    /// Reads a `<version>` node and all paragraph content under it.
    fn read_version(&mut self, start: &BytesStart<'_>) -> Result<XmlVersion> {
        let attrs = Attrs::from_tag(start, "version")?;
        let date = Self::parse_date(attrs.require("fecha_vigencia", "version")?, "version")?;
        let mut version = XmlVersion { date, paras: Vec::new() };

        self.each_child(b"version", "version", |tag, reader| {
            reader.read_version_node(tag, &mut version, false)?;
            Ok(ChildAction::Consumed)
        })?;

        Ok(version)
    }

    /// Reads a `<bloque>` node and all enclosed versions.
    fn read_block(&mut self, start: &BytesStart<'_>) -> Result<XmlBlock> {
        let attrs = Attrs::from_tag(start, "bloque")?;
        let mut block = XmlBlock {
            id: attrs.get("id").unwrap_or_default().to_string(),
            kind: BlockKind::from(attrs.get("tipo").unwrap_or_default()),
            title: attrs.get("titulo").map(str::to_string),
            versions: Vec::new(),
        };

        self.each_child(b"bloque", "bloque", |tag, reader| {
            if tag.name().as_ref() == b"version" {
                block.versions.push(reader.read_version(tag)?);
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;

        Ok(block)
    }

    /// Reads the legal text section (`<texto>`).
    fn read_texto(&mut self) -> Result<LegalDocument> {
        let mut blocks = Vec::new();
        self.each_child(b"texto", "texto", |tag, reader| {
            if tag.name().as_ref() == b"bloque" {
                blocks.push(reader.read_block(tag)?);
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;

        if !blocks.is_empty() {
            return Ok(LegalDocument { blocks });
        }

        Err(DocumentError::MissingElement { path: "response/data/texto/bloque" })
    }

    /// Reads `<data>` and returns the first parsed `<texto>` payload.
    fn read_data(&mut self) -> Result<Option<LegalDocument>> {
        let mut out = None;
        self.each_child(b"data", "data", |tag, reader| {
            if tag.name().as_ref() == b"texto" {
                out = Some(reader.read_texto()?);
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;
        Ok(out)
    }

    /// Reads `<response>` and resolves its `<data>` payload.
    fn read_response(&mut self) -> Result<Option<LegalDocument>> {
        let mut out = None;
        self.each_child(b"response", "response", |tag, reader| {
            if tag.name().as_ref() == b"data" {
                if let Some(doc) = reader.read_data()? {
                    out = Some(doc);
                }
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;
        Ok(out)
    }
}

/// Parsed legal XML intermediate representation.
#[derive(Debug, Clone)]
pub struct LegalDocument {
    pub blocks: Vec<XmlBlock>,
}

impl LegalDocument {
    /// Parses XML into a `LegalDocument` IR.
    ///
    /// This function is intentionally stateless and independent of
    /// `TreeParser` policy.
    pub fn from_xml(xml: &str) -> Result<Self> {
        let mut reader = BoeReader::new(xml);
        loop {
            match reader.next()? {
                Event::Start(tag) if tag.name().as_ref() == b"response" => {
                    if let Some(doc) = reader.read_response()? {
                        return Ok(doc);
                    }
                    break;
                }
                Event::Start(tag) => reader.skip_element(tag.name().as_ref())?,
                Event::Eof => break,
                _ => {}
            }
        }
        Err(DocumentError::MissingElement { path: "response/data/texto" })
    }
}

/// Configurable projector from XML IR into `DocumentTree`.
#[derive(Debug, Clone)]
pub struct TreeParser {
    policy: VersionPolicy,
}

impl TreeParser {
    /// Decodes UTF-8 bytes into XML text.
    fn decode(bytes: &[u8]) -> Result<&str> {
        std::str::from_utf8(bytes)
            .map_err(|e| DocumentError::xml(format!("decode: invalid UTF-8 bytes: {e}")))
    }

    /// Chooses one version based on parser policy.
    fn pick<'a>(&self, versions: &'a [XmlVersion]) -> Option<&'a XmlVersion> {
        if versions.is_empty() {
            return None;
        }
        if self.policy == VersionPolicy::Latest {
            return versions.iter().max_by_key(|it| it.date);
        }
        versions.first()
    }

    /// Resolves tree level from block and heading semantics.
    fn level(&self, kind: BlockKind, heading: ParaKind) -> u8 {
        match kind {
            BlockKind::Preambulo => 1,
            BlockKind::Precepto => 4,
            _ => heading.level().unwrap_or(2),
        }
    }

    /// Determines the heading title for a block/version pair.
    fn heading<'a>(
        &self,
        block: &'a XmlBlock,
        version: &'a XmlVersion,
    ) -> Option<(ParaKind, String)> {
        if block.kind == BlockKind::Preambulo {
            return Some((ParaKind::Titulo, "Preámbulo".to_string()));
        }
        for para in &version.paras {
            if para.kind.heading() && !para.text.trim().is_empty() {
                return Some((para.kind, para.text.trim().to_string()));
            }
        }
        if let Some(title) = &block.title {
            let value = title.trim();
            if !value.is_empty() {
                return Some((ParaKind::Titulo, value.to_string()));
            }
        }
        None
    }

    /// Builds a `DocumentTree` from pre-parsed XML blocks.
    pub fn build_tree(&self, blocks: &[XmlBlock]) -> Result<DocumentTree> {
        let mut tree = DocumentTree::new();
        let mut stack = vec![(0u8, tree.root())];
        let mut anchor = Anchor::default();

        for block in blocks {
            let Some(version) = self.pick(&block.versions) else {
                continue;
            };
            let Some((heading, title)) = self.heading(block, version) else {
                continue;
            };

            let level = self.level(block.kind, heading);
            while stack.last().map(|it| it.0 >= level).unwrap_or(false) {
                stack.pop();
            }
            let parent = stack.last().map(|it| it.1).unwrap_or(tree.root());

            let mut section = DocumentNode::section(level, &title);
            section.anchor = Some(anchor.next(&title, &block.id));
            let id = tree.add_child(parent, section);
            stack.push((level, id));

            for para in &version.paras {
                let parent = if para.quote {
                    tree.add_child(id, DocumentNode::new(NodeKind::BlockQuote, String::new()))
                } else {
                    id
                };

                if para.kind.divider() {
                    let value = para.text.trim();
                    if !value.is_empty() {
                        let pid = tree.add_child(
                            parent,
                            DocumentNode::new(NodeKind::Paragraph, value.to_string()),
                        );
                        for reference in &para.refs {
                            tree.add_child(
                                pid,
                                DocumentNode::link(reference.clone(), None, reference),
                            );
                        }
                    }
                    tree.add_child(
                        parent,
                        DocumentNode::new(NodeKind::ThematicBreak, String::new()),
                    );
                    continue;
                }
                if !para.kind.body() {
                    continue;
                }
                let value = para.text.trim();
                if value.is_empty() {
                    continue;
                }
                let pid = tree
                    .add_child(parent, DocumentNode::new(NodeKind::Paragraph, value.to_string()));
                for reference in &para.refs {
                    tree.add_child(pid, DocumentNode::link(reference.clone(), None, reference));
                }
            }
        }

        if tree.children(tree.root()).next().is_none() {
            return Err(DocumentError::xml("build: no sections extracted from XML"));
        }

        Ok(tree)
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
        let bytes = std::fs::read(path)?;
        self.parse_bytes(&bytes)
    }

    /// Parses XML bytes into the intermediate representation.
    pub fn parse_bytes_document(&self, bytes: &[u8]) -> Result<LegalDocument> {
        let xml = Self::decode(bytes)?;
        LegalDocument::from_xml(xml)
    }

    /// Parses XML bytes and returns a projected tree.
    pub fn parse_bytes(&self, bytes: &[u8]) -> Result<DocumentTree> {
        self.parse_bytes_document(bytes).and_then(|doc| self.build_tree(&doc.blocks))
    }

    /// Parses XML text and returns a projected tree.
    pub fn parse_xml(&self, xml: &str) -> Result<DocumentTree> {
        LegalDocument::from_xml(xml).and_then(|doc| self.build_tree(&doc.blocks))
    }
}

impl Default for TreeParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> &'static str {
        r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="ti" tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
          <p class="titulo_tit">Derechos</p>
        </version>
      </bloque>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno.</p>
        </version>
        <version fecha_vigencia="19920101">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno actualizado.</p>
          <blockquote>
            <p class="nota_pie">Texto nota <a class="refPost">Ref. BOE-A-1992-20403</a></p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#
    }

    #[test]
    fn parses_xml_text() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let canon = tree.find_by_anchor("artículo-1").unwrap();
        let alias = tree.find_by_anchor("articulo-1").unwrap();
        assert_eq!(canon, alias);
    }

    #[test]
    fn parses_bytes() {
        let tree = TreeParser::new().parse_bytes(sample().as_bytes()).unwrap();
        assert!(tree.find_by_anchor("artículo-1").is_some());
    }

    #[test]
    fn picks_latest_version() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();
        assert!(tree.extract_text(id).contains("actualizado"));
    }

    #[test]
    fn picks_first_version() {
        let tree = TreeParser::new().policy(VersionPolicy::First).parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();
        assert!(tree.extract_text(id).contains("Uno."));
        assert!(!tree.extract_text(id).contains("actualizado"));
    }

    #[test]
    fn validates_root_path() {
        let err = TreeParser::new().parse_xml("<root><x/></root>").unwrap_err();
        assert!(err.to_string().contains("response/data/texto"));
    }

    #[test]
    fn does_not_duplicate_refpost_text() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();

        let mut found = false;
        for desc in tree.descendants(id).skip(1) {
            let Some(node) = tree.get(desc) else {
                continue;
            };
            if !matches!(node.kind, NodeKind::Paragraph) {
                continue;
            }
            if !node.content.contains("Texto nota") {
                continue;
            }
            found = true;
            assert!(!node.content.contains("Ref. BOE-A-1992-20403"));
        }

        assert!(found);
    }

    #[test]
    fn compacts_double_dot_before_ref_link() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="20110927">
          <p class="articulo">Artículo 1</p>
          <blockquote>
            <p class="nota_pie">Se modifica por el art. único de la Reforma de 27 de septiembre de 2011. <a class="refPost">Ref. BOE-A-2011-15210</a>.</p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let mut out = String::new();
        let mut md = crate::MarkdownWriter::new(&mut out);
        crate::render::render(&tree, tree.root(), &mut md).unwrap();

        assert!(out.contains("2011.[Ref. BOE-A-2011-15210](Ref. BOE-A-2011-15210)"));
        assert!(!out.contains("2011..[Ref. BOE-A-2011-15210](Ref. BOE-A-2011-15210)"));
    }

    #[test]
    fn renders_blockquote_notes() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let mut out = String::new();
        let mut md = crate::MarkdownWriter::new(&mut out);
        crate::render::render(&tree, tree.root(), &mut md).unwrap();

        assert!(out.contains("> Texto nota"));
        assert!(out.contains("[Ref. BOE-A-1992-20403](Ref. BOE-A-1992-20403)"));
    }

    #[test]
    fn keeps_centro_as_in_section_divider() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="centro_negrita">CONSTITUCIÓN</p>
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno.</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let art = tree.find_by_anchor("artículo-1").unwrap();
        let mut found_divider = false;
        for child in tree.children(art) {
            if let Some(node) = tree.get(child)
                && matches!(node.kind, NodeKind::ThematicBreak)
            {
                found_divider = true;
            }
        }
        assert!(found_divider);
        assert!(tree.extract_text(art).contains("CONSTITUCIÓN"));
        assert!(tree.extract_text(art).contains("Uno."));
    }
}
