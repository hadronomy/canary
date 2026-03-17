//! XML parser and tree builder for BOE-like legal documents.
//!
//! This module intentionally separates parsing into two phases:
//! - `LegalDocument::from_xml` decodes XML into an intermediate representation.
//! - `TreeParser::build_tree` projects that representation into `DocumentTree`.
//!
//! The split keeps XML parsing reusable and makes policy-driven tree construction
//! explicit.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Cursor};
use std::path::Path;

use chrono::NaiveDate;
use quick_xml::Reader;
use quick_xml::events::attributes::Attribute;
use quick_xml::events::{BytesStart, Event};

use crate::error::{DocumentError, Result};
use crate::tree::{DocumentNode, DocumentTree, NodeKind, SectionKind};

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
    pub id: Option<String>,
    /// Block semantic kind parsed from `tipo`.
    pub kind: BlockKind,
    /// Optional title from `titulo`.
    pub title: Option<String>,
    /// All temporal versions found in the block.
    pub versions: Vec<XmlVersion>,
}

#[derive(Debug, Clone, Default)]
#[non_exhaustive]
pub struct DocumentMeta {
    pub identifier: Option<String>,
    pub title: Option<String>,
    pub department: Option<String>,
    pub rango: Option<String>,
    pub publication: Option<String>,
    pub eli: Option<String>,
}

/// A single temporal version of a block.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlVersion {
    /// Effective date (`fecha_vigencia`).
    pub date: NaiveDate,
    pub nodes: Vec<XmlNode>,
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum XmlNode {
    Paragraph(XmlPara),
    BlockQuote(Vec<XmlNode>),
    Html(String),
}

/// Paragraph-like content extracted from XML.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlPara {
    pub class: String,
    pub kind: ParaKind,
    pub text: String,
    pub refs: Vec<String>,
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

    /// Returns `true` when this paragraph kind acts as an in-section divider.
    fn divider(self) -> bool {
        matches!(self, Self::Centro)
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
    fn decode_attr(attr: &Attribute<'_>, tag: &BytesStart<'_>, phase: &str) -> Result<String> {
        attr.decode_and_unescape_value(tag.decoder())
            .map(|it| it.into_owned())
            .map_err(|e| DocumentError::xml(format!("{phase}: invalid attribute: {e}")))
    }

    /// Decodes and collects all attributes from a start tag.
    fn from_tag(tag: &BytesStart<'_>, phase: &str) -> Result<Self> {
        let mut values = Vec::new();
        for attr in tag.attributes().with_checks(false).flatten() {
            values.push((
                String::from_utf8_lossy(attr.key.as_ref()).to_string(),
                Self::decode_attr(&attr, tag, phase)?,
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
    fn next(&mut self, title: &str, id: Option<&str>) -> String {
        let base = DocumentNode::slugify(title);

        if self.used.insert(base.clone()) {
            self.next_suffix.entry(base.clone()).or_insert(2);
            return base;
        }

        if let Some(id) = id.filter(|it| !it.is_empty()) {
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
struct BoeReader<R> {
    inner: Reader<R>,
    buf: Vec<u8>,
}

impl<R: BufRead> BoeReader<R> {
    fn new(reader: R) -> Self {
        let mut inner = Reader::from_reader(reader);
        inner.config_mut().trim_text(true);
        Self { inner, buf: Vec::new() }
    }

    /// Reads the next XML event, mapping errors once.
    fn next(&mut self) -> Result<Event<'static>> {
        self.buf.clear();
        self.inner.read_event_into(&mut self.buf).map(|it| it.into_owned()).map_err(|e| {
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

    fn raw(&mut self, start: &BytesStart<'_>) -> Result<String> {
        let mut w = quick_xml::Writer::new(Vec::new());
        w.write_event(Event::Start(start.clone()))
            .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;

        let closing = start.name().as_ref().to_vec();
        let mut depth = 0usize;
        loop {
            let ev = self.next()?;
            match &ev {
                Event::Start(_) => {
                    depth += 1;
                    w.write_event(ev.clone())
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::End(tag) => {
                    w.write_event(ev.clone())
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                    if tag.name().as_ref() == closing && depth == 0 {
                        break;
                    }
                    if depth == 0 {
                        return Err(DocumentError::xml("raw: unbalanced close tag"));
                    }
                    depth -= 1;
                }
                Event::Text(_) | Event::CData(_) | Event::Comment(_) | Event::Empty(_) => {
                    w.write_event(ev.clone())
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::Eof => return Err(DocumentError::xml("raw: unexpected EOF")),
                _ => {}
            }
        }
        Ok(String::from_utf8_lossy(&w.into_inner()).into_owned())
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
    fn read_paragraph(&mut self, start: &BytesStart<'_>) -> Result<XmlPara> {
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

        Ok(XmlPara { class: class.clone(), kind: ParaKind::from(class.as_str()), text, refs })
    }

    fn raw_empty(start: &BytesStart<'_>) -> Result<String> {
        let mut w = quick_xml::Writer::new(Vec::new());
        w.write_event(Event::Empty(start.clone()))
            .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
        Ok(String::from_utf8_lossy(&w.into_inner()).into_owned())
    }

    fn read_blockquote(&mut self, _start: &BytesStart<'_>) -> Result<XmlNode> {
        let mut nodes = Vec::new();
        loop {
            match self.next()? {
                Event::Start(tag) => nodes.push(self.read_version_child(&tag)?),
                Event::Empty(tag) => nodes.push(XmlNode::Html(Self::raw_empty(&tag)?)),
                Event::End(tag) if tag.name().as_ref() == b"blockquote" => break,
                Event::Eof => return Err(DocumentError::xml("blockquote: unexpected EOF")),
                _ => {}
            }
        }
        Ok(XmlNode::BlockQuote(nodes))
    }

    fn read_version_child(&mut self, start: &BytesStart<'_>) -> Result<XmlNode> {
        if start.name().as_ref() == b"p" {
            return self.read_paragraph(start).map(XmlNode::Paragraph);
        }
        if start.name().as_ref() == b"blockquote" {
            return self.read_blockquote(start);
        }
        self.raw(start).map(XmlNode::Html)
    }

    /// Reads a `<version>` node and all paragraph content under it.
    fn read_version(&mut self, start: &BytesStart<'_>) -> Result<XmlVersion> {
        let attrs = Attrs::from_tag(start, "version")?;
        let date = Self::parse_date(attrs.require("fecha_vigencia", "version")?, "version")?;
        let mut version = XmlVersion { date, nodes: Vec::new() };
        loop {
            match self.next()? {
                Event::Start(tag) => version.nodes.push(self.read_version_child(&tag)?),
                Event::Empty(tag) => version.nodes.push(XmlNode::Html(Self::raw_empty(&tag)?)),
                Event::End(tag) if tag.name().as_ref() == b"version" => break,
                Event::Eof => return Err(DocumentError::xml("version: unexpected EOF")),
                _ => {}
            }
        }

        Ok(version)
    }

    /// Reads a `<bloque>` node and all enclosed versions.
    fn read_block(&mut self, start: &BytesStart<'_>) -> Result<XmlBlock> {
        let attrs = Attrs::from_tag(start, "bloque")?;
        let mut block = XmlBlock {
            id: attrs.get("id").map(str::trim).filter(|it| !it.is_empty()).map(str::to_string),
            kind: BlockKind::from(attrs.get("tipo").unwrap_or_default()),
            title: attrs
                .get("titulo")
                .map(str::trim)
                .filter(|it| !it.is_empty())
                .map(str::to_string),
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

    fn read_metadatos(&mut self) -> Result<DocumentMeta> {
        let mut meta = DocumentMeta::default();
        self.each_child(b"metadatos", "metadatos", |tag, reader| {
            let key = String::from_utf8_lossy(tag.name().as_ref()).to_string();
            let value = reader.read_text_until(tag.name().as_ref())?;
            let value = Self::normalize(&value);
            if value.is_empty() {
                return Ok(ChildAction::Consumed);
            }
            if key == "identificador" {
                meta.identifier = Some(value);
                return Ok(ChildAction::Consumed);
            }
            if key == "titulo" {
                meta.title = Some(value);
                return Ok(ChildAction::Consumed);
            }
            if key == "departamento" {
                meta.department = Some(value);
                return Ok(ChildAction::Consumed);
            }
            if key == "rango" {
                meta.rango = Some(value);
                return Ok(ChildAction::Consumed);
            }
            if key == "fecha_publicacion" {
                meta.publication = Some(value);
                return Ok(ChildAction::Consumed);
            }
            if key == "url_eli" {
                meta.eli = Some(value);
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Consumed)
        })?;
        Ok(meta)
    }

    /// Reads the legal text section (`<texto>`).
    fn read_texto(&mut self) -> Result<Vec<XmlBlock>> {
        let mut blocks = Vec::new();
        self.each_child(b"texto", "texto", |tag, reader| {
            if tag.name().as_ref() == b"bloque" {
                blocks.push(reader.read_block(tag)?);
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;

        if !blocks.is_empty() {
            return Ok(blocks);
        }

        Err(DocumentError::MissingElement { path: "response/data/texto/bloque" })
    }

    /// Reads `<data>` and returns the first parsed `<texto>` payload.
    fn read_data(&mut self) -> Result<Option<LegalDocument>> {
        let mut meta = DocumentMeta::default();
        let mut out = None;
        self.each_child(b"data", "data", |tag, reader| {
            if tag.name().as_ref() == b"metadatos" {
                meta = reader.read_metadatos()?;
                return Ok(ChildAction::Consumed);
            }
            if tag.name().as_ref() == b"texto" {
                out = Some(LegalDocument { meta: meta.clone(), blocks: reader.read_texto()? });
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
    pub meta: DocumentMeta,
    pub blocks: Vec<XmlBlock>,
}

impl LegalDocument {
    pub fn from_reader<R: BufRead>(reader: R) -> Result<Self> {
        let mut reader = BoeReader::new(reader);
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

    /// Parses XML into a `LegalDocument` IR.
    ///
    /// This function is intentionally stateless and independent of
    /// `TreeParser` policy.
    pub fn from_xml(xml: &str) -> Result<Self> {
        Self::from_reader(Cursor::new(xml.as_bytes()))
    }
}

/// Configurable projector from XML IR into `DocumentTree`.
#[derive(Debug, Clone)]
pub struct TreeParser {
    policy: VersionPolicy,
}

impl TreeParser {
    fn head(para: &XmlPara) -> Option<ParaKind> {
        if para.class == "anexo" || para.class.starts_with("anexo_") {
            return Some(ParaKind::Titulo);
        }
        para.kind.heading().then_some(para.kind)
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
    fn heading<'a>(
        &self,
        block: &'a XmlBlock,
        version: &'a XmlVersion,
    ) -> Option<(ParaKind, String, usize, usize)> {
        if block.kind == BlockKind::Preambulo {
            return Some((ParaKind::Titulo, "Preámbulo".to_string(), 0, 0));
        }
        for (idx, node) in version.nodes.iter().enumerate() {
            let XmlNode::Paragraph(para) = node else {
                continue;
            };
            let Some(kind) = Self::head(para) else {
                continue;
            };
            let text = para.text.trim();
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
                let text = next.text.trim();
                if text.is_empty() {
                    continue;
                }
                parts.push(text.to_string());
                span += 1;
            }
            return Some((kind, parts.join(" "), idx, span));
        }
        if let Some(title) = &block.title {
            let value = title.trim();
            if !value.is_empty() {
                return Some((ParaKind::Titulo, value.to_string(), 0, 0));
            }
        }
        None
    }

    fn push_para(tree: &mut DocumentTree, parent: crate::NodeId, para: &XmlPara) {
        let value = para.text.trim();
        if value.is_empty() {
            if para.kind.divider() {
                tree.add_child(parent, DocumentNode::new(NodeKind::ThematicBreak, String::new()));
            }
            return;
        }

        let pid = tree.add_child(parent, DocumentNode::new(NodeKind::Paragraph, value.to_string()));
        for reference in &para.refs {
            tree.add_child(pid, DocumentNode::link(reference.clone(), None, reference));
        }

        if para.kind.divider() {
            tree.add_child(parent, DocumentNode::new(NodeKind::ThematicBreak, String::new()));
        }
    }

    fn push_html(tree: &mut DocumentTree, parent: crate::NodeId, html: &mut String) {
        let value = html.trim();
        if value.is_empty() {
            html.clear();
            return;
        }
        tree.add_child(parent, DocumentNode::html(value.to_string()));
        html.clear();
    }

    fn push_nodes(tree: &mut DocumentTree, parent: crate::NodeId, nodes: &[XmlNode]) {
        let mut html = String::new();
        for node in nodes {
            match node {
                XmlNode::Paragraph(para) => {
                    Self::push_html(tree, parent, &mut html);
                    Self::push_para(tree, parent, para);
                }
                XmlNode::Html(raw) => {
                    if !html.is_empty() {
                        html.push('\n');
                    }
                    html.push_str(raw);
                }
                XmlNode::BlockQuote(items) => {
                    Self::push_html(tree, parent, &mut html);
                    let bid = tree
                        .add_child(parent, DocumentNode::new(NodeKind::BlockQuote, String::new()));
                    Self::push_nodes(tree, bid, items);
                }
            }
        }
        Self::push_html(tree, parent, &mut html);
    }

    /// Builds a `DocumentTree` from pre-parsed XML blocks.
    pub fn build_tree(&self, blocks: &[XmlBlock]) -> Result<DocumentTree> {
        let mut tree = DocumentTree::new();
        let mut stack = vec![(0u8, tree.root(), 1u8)];
        let mut anchor = Anchor::default();

        for block in blocks {
            let Some(version) = self.pick(&block.versions) else {
                continue;
            };
            let Some((heading, title, start, span)) = self.heading(block, version) else {
                continue;
            };

            let rank = Self::rank(heading);
            while stack.last().map(|it| it.0 >= rank).unwrap_or(false) {
                stack.pop();
            }
            let parent = stack.last().map(|it| it.1).unwrap_or(tree.root());
            let parent_level = stack.last().map(|it| it.2).unwrap_or(1);
            let level = (parent_level + 1).min(6);

            let mut section = DocumentNode::section_with(level, Self::section(heading), &title);
            section.anchor = Some(anchor.next(&title, block.id.as_deref()));
            let id = tree.add_child(parent, section);
            stack.push((rank, id, level));

            let nodes = version
                .nodes
                .iter()
                .enumerate()
                .filter_map(|(idx, node)| {
                    if span > 0 && idx >= start && idx < start + span {
                        return None;
                    }
                    Some(node.clone())
                })
                .collect::<Vec<_>>();

            if !nodes.is_empty() {
                Self::push_nodes(&mut tree, id, &nodes);
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
        let file = std::fs::File::open(path)?;
        let reader = BufReader::new(file);
        self.parse_reader(reader)
    }

    pub fn parse_reader_document<R: BufRead>(&self, reader: R) -> Result<LegalDocument> {
        LegalDocument::from_reader(reader)
    }

    /// Parses XML bytes into the intermediate representation.
    pub fn parse_bytes_document(&self, bytes: &[u8]) -> Result<LegalDocument> {
        LegalDocument::from_reader(Cursor::new(bytes))
    }

    pub fn parse_reader<R: BufRead>(&self, reader: R) -> Result<DocumentTree> {
        self.parse_reader_document(reader).and_then(|doc| self.build_tree(&doc.blocks))
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
    fn preserves_unsupported_html_as_html_node() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20210906">
          <p class="titulo_tit">ANEXO</p>
          <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let id = tree.find_by_anchor("anexo").unwrap();
        let html = tree
            .children(id)
            .filter_map(|it| tree.get(it))
            .filter(|it| matches!(it.kind, NodeKind::Html))
            .collect::<Vec<_>>();
        assert_eq!(html.len(), 1);
        assert!(html[0].content.contains("<table>"));
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

    #[test]
    fn groups_consecutive_quote_paragraphs_under_one_blockquote() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="articulo">Artículo 1</p>
          <blockquote>
            <p class="nota_pie">Nota uno.</p>
            <p class="nota_pie">Nota dos.</p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let art = tree.find_by_anchor("artículo-1").unwrap();
        let quotes = tree
            .children(art)
            .filter(|id| {
                tree.get(*id).map(|node| matches!(node.kind, NodeKind::BlockQuote)).unwrap_or(false)
            })
            .collect::<Vec<_>>();

        assert_eq!(quotes.len(), 1);
        let paras = tree
            .children(quotes[0])
            .filter(|id| {
                tree.get(*id).map(|node| matches!(node.kind, NodeKind::Paragraph)).unwrap_or(false)
            })
            .count();
        assert_eq!(paras, 2);
    }

    #[test]
    fn combines_adjacent_heading_paragraphs() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("título-i-derechos").unwrap();
        let section = tree.get(id).unwrap();
        assert_eq!(section.content, "TÍTULO I Derechos");
    }

    #[test]
    fn skips_heading_paragraphs_in_section_body() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();
        let values = tree
            .children(id)
            .filter_map(|it| tree.get(it))
            .filter(|it| matches!(it.kind, NodeKind::Paragraph))
            .map(|it| it.content.as_str())
            .collect::<Vec<_>>();

        assert!(values.iter().all(|it| *it != "Artículo 1"));
        assert!(values.contains(&"Uno actualizado."));
    }

    #[test]
    fn merges_adjacent_html_fragments() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20210906">
          <p class="titulo_tit">ANEXO</p>
          <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
          <foo><bar>z</bar></foo>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let id = tree.find_by_anchor("anexo").unwrap();
        let html = tree
            .children(id)
            .filter_map(|it| tree.get(it))
            .filter(|it| matches!(it.kind, NodeKind::Html))
            .collect::<Vec<_>>();

        assert_eq!(html.len(), 1);
        assert!(html[0].content.contains("<table>"));
        assert!(html[0].content.contains("<foo>"));
    }

    #[test]
    fn consumes_anexo_heading_paragraphs() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20220101">
          <p class="anexo_num">ANEXO</p>
          <p class="anexo_tit">Modelos de cuentas anuales consolidadas</p>
          <p class="centro_cursiva">Balance consolidado</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let id = tree.find_by_anchor("anexo-modelos-de-cuentas-anuales-consolidadas").unwrap();
        let section = tree.get(id).unwrap();
        assert_eq!(section.content, "ANEXO Modelos de cuentas anuales consolidadas");

        let body = tree
            .children(id)
            .filter_map(|it| tree.get(it))
            .filter(|it| matches!(it.kind, NodeKind::Paragraph))
            .map(|it| it.content.clone())
            .collect::<Vec<_>>();
        assert_eq!(body, vec!["Balance consolidado".to_string()]);
    }

    #[test]
    fn consumes_plain_anexo_heading_paragraph() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="mc" tipo="encabezado" titulo="MEMORIA CONSOLIDADA">
        <version fecha_vigencia="20220101">
          <p class="anexo">MEMORIA CONSOLIDADA</p>
          <p class="centro_redonda">Contenido de la memoria consolidada</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let id = tree.find_by_anchor("memoria-consolidada").unwrap();
        let section = tree.get(id).unwrap();
        assert_eq!(section.content, "MEMORIA CONSOLIDADA");

        let body = tree
            .children(id)
            .filter_map(|it| tree.get(it))
            .filter(|it| matches!(it.kind, NodeKind::Paragraph))
            .map(|it| it.content.clone())
            .collect::<Vec<_>>();
        assert_eq!(body, vec!["Contenido de la memoria consolidada".to_string()]);
    }

    #[test]
    fn keeps_missing_block_id_as_none() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
        assert_eq!(doc.blocks.len(), 1);
        assert_eq!(doc.blocks[0].id, None);
    }

    #[test]
    fn trims_blank_block_id_to_none() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="   " tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
        assert_eq!(doc.blocks.len(), 1);
        assert_eq!(doc.blocks[0].id, None);
    }

    #[test]
    fn trims_blank_block_title_to_none() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="encabezado" titulo="   ">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
        assert_eq!(doc.blocks.len(), 1);
        assert_eq!(doc.blocks[0].title, None);
    }

    #[test]
    fn parses_from_streaming_reader() {
        let reader =
            std::io::BufReader::with_capacity(1, std::io::Cursor::new(sample().as_bytes()));

        let tree = TreeParser::new().parse_reader(reader).unwrap();
        assert!(tree.find_by_anchor("artículo-1").is_some());
    }
}
