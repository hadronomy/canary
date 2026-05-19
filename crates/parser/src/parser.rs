//! XML parser and tree builder for BOE-like legal documents.
//!
//! This module intentionally separates parsing into two phases:
//! - `LegalDocument::from_xml` decodes XML into an intermediate representation.
//! - `TreeParser::build_tree` projects that representation into `DocumentTree`.
//!
//! The split keeps XML parsing reusable and makes policy-driven tree construction
//! explicit.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::Path;

use chrono::NaiveDate;
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;

use crate::error::{DocumentError, Result};
use crate::tree::{
    Anchor, BlockId, DocumentNode, DocumentTree, DocumentTreeBuilder, LinkTarget, SectionKind,
};

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
    pub id: Option<BlockId>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum XmlInline {
    Text(String),
    Link { target: LinkTarget, label: String },
}

/// Paragraph-like content extracted from XML.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct XmlPara {
    pub class: String,
    pub kind: ParaKind,
    pub body: XmlParaBody,
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum XmlParaBody {
    Plain(String),
    Rich { text: String, inline: Vec<XmlInline> },
}

impl XmlPara {
    #[must_use]
    pub fn text(&self) -> &str {
        match &self.body {
            XmlParaBody::Plain(text) | XmlParaBody::Rich { text, .. } => text,
        }
    }

    #[must_use]
    pub fn inline(&self) -> Option<&[XmlInline]> {
        match &self.body {
            XmlParaBody::Plain(_) => None,
            XmlParaBody::Rich { inline, .. } => Some(inline),
        }
    }
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

fn attr_value<'a>(
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

fn attr_string(tag: &BytesStart<'_>, key: &[u8], phase: &str) -> Result<Option<String>> {
    attr_value(tag, key, phase).map(|it| it.map(|it| it.into_owned()))
}

fn require_attr<'a>(tag: &'a BytesStart<'a>, key: &[u8], phase: &str) -> Result<Cow<'a, str>> {
    attr_value(tag, key, phase)?.ok_or_else(|| {
        DocumentError::xml(format!("{phase}: missing `{}` attribute", String::from_utf8_lossy(key)))
    })
}

/// Anchor uniqueness tracker for generated tree anchors.
#[derive(Debug, Default)]
struct Anchors {
    next_suffix: HashMap<Anchor, usize>,
    used: HashSet<Anchor>,
}

impl Anchors {
    /// Produces a deterministic unique anchor with stable suffixing.
    fn next(&mut self, title: &str, id: Option<&BlockId>) -> Anchor {
        let base = Anchor::slug(title);

        if self.used.insert(base.clone()) {
            self.next_suffix.entry(base.clone()).or_insert(2);
            return base;
        }

        if let Some(id) = id {
            let alt = Anchor::from(format!("{}-{}", base, DocumentNode::slugify(id.as_str())));
            if self.used.insert(alt.clone()) {
                return alt;
            }
        }

        let next = self.next_suffix.entry(base.clone()).or_insert(2);
        loop {
            let candidate = Anchor::from(format!("{}-{}", base, *next));
            *next += 1;
            if self.used.insert(candidate.clone()) {
                return candidate;
            }
        }
    }
}

struct BoeBufReader<R> {
    inner: Reader<R>,
    buf: Vec<u8>,
}

impl<R: BufRead> BoeBufReader<R> {
    fn new(reader: R) -> Self {
        let mut inner = Reader::from_reader(reader);
        inner.config_mut().trim_text(true);
        Self { inner, buf: Vec::new() }
    }
}

struct BoeSliceReader<'a> {
    inner: Reader<&'a [u8]>,
}

impl<'a> BoeSliceReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        let mut inner = Reader::from_reader(bytes);
        inner.config_mut().trim_text(true);
        Self { inner }
    }
}

trait BoeStream {
    fn next_event<'a>(&'a mut self) -> Result<Event<'a>>;

    fn skip_to_end(&mut self, end: QName<'_>) -> Result<()>;

    fn decode_text<E: std::fmt::Display>(
        raw: std::result::Result<std::borrow::Cow<'_, str>, E>,
        phase: &str,
    ) -> Result<String> {
        raw.map(|it| it.into_owned())
            .map_err(|e| DocumentError::xml(format!("{phase}: invalid node: {e}")))
    }

    fn parse_date(value: &str, phase: &str) -> Result<NaiveDate> {
        NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|e| {
            DocumentError::xml(format!("{phase}: invalid fecha_vigencia '{value}': {e}"))
        })
    }

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

    fn push_inline_text(inline: &mut Vec<XmlInline>, text: String) {
        if text.is_empty() {
            return;
        }
        if let Some(XmlInline::Text(prev)) = inline.last_mut() {
            prev.push_str(&text);
            return;
        }
        inline.push(XmlInline::Text(text));
    }

    fn normalize_inline(inline: Vec<XmlInline>) -> Vec<XmlInline> {
        let mut out = Vec::new();
        let mut gap = false;

        for part in inline {
            match part {
                XmlInline::Text(text) => {
                    let mut buf = String::new();
                    let lead = text.chars().next().is_some_and(char::is_whitespace);
                    for word in text.split_whitespace() {
                        if !buf.is_empty() || gap || (lead && !out.is_empty()) {
                            buf.push(' ');
                        }
                        buf.push_str(word);
                        gap = false;
                    }
                    if buf.is_empty() {
                        gap |= text.chars().any(char::is_whitespace);
                        continue;
                    }
                    gap = text.chars().last().is_some_and(char::is_whitespace);
                    Self::push_inline_text(&mut out, buf);
                }
                XmlInline::Link { target, label } => {
                    if let Some(XmlInline::Text(text)) = out.last_mut() {
                        while text.ends_with(' ') {
                            text.pop();
                        }
                    }
                    out.push(XmlInline::Link { target, label });
                    gap = false;
                }
            }
        }

        out.retain(|part| !matches!(part, XmlInline::Text(text) if text.is_empty()));
        out
    }

    fn trim_trailing_link_dot(inline: &mut Vec<XmlInline>) {
        let mut idx = inline.len();
        while idx > 0 {
            idx -= 1;
            let XmlInline::Text(text) = &mut inline[idx] else {
                continue;
            };
            if text.ends_with('.') {
                text.pop();
                while text.ends_with(' ') {
                    text.pop();
                }
            }
            break;
        }
        inline.retain(|part| !matches!(part, XmlInline::Text(text) if text.is_empty()));
    }

    fn skip_element(&mut self, start: &BytesStart<'_>) -> Result<()> {
        self.skip_to_end(start.to_end().name())
    }

    fn read_text_until(&mut self, closing: &[u8]) -> Result<String> {
        let mut depth = 0usize;
        let mut out = String::new();
        loop {
            match self.next_event()? {
                Event::Text(value) => {
                    out.push_str(&Self::decode_text(value.xml_content(), "text")?)
                }
                Event::CData(value) => {
                    out.push_str(&Self::decode_text(value.xml_content(), "cdata")?)
                }
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
            match self.next_event()? {
                Event::Start(tag) => {
                    depth += 1;
                    w.write_event(Event::Start(tag.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::End(tag) => {
                    let close = tag.name().as_ref() == closing.as_slice();
                    w.write_event(Event::End(tag.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                    if close && depth == 0 {
                        break;
                    }
                    if depth == 0 {
                        return Err(DocumentError::xml("raw: unbalanced close tag"));
                    }
                    depth -= 1;
                }
                Event::Text(value) => {
                    w.write_event(Event::Text(value.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::CData(value) => {
                    w.write_event(Event::CData(value.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::Comment(value) => {
                    w.write_event(Event::Comment(value.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::Empty(tag) => {
                    w.write_event(Event::Empty(tag.into_owned()))
                        .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
                }
                Event::Eof => return Err(DocumentError::xml("raw: unexpected EOF")),
                _ => {}
            }
        }
        Ok(String::from_utf8_lossy(&w.into_inner()).into_owned())
    }

    fn each_child<F>(&mut self, closing: &[u8], phase: &str, mut f: F) -> Result<()>
    where
        F: FnMut(&BytesStart<'static>, &mut Self) -> Result<ChildAction>,
    {
        loop {
            match self.next_event()? {
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    match f(&tag, self)? {
                        ChildAction::Skip => self.skip_element(&tag)?,
                        ChildAction::Consumed => {}
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

    fn read_anchor(&mut self, start: &BytesStart<'static>) -> Result<(String, Option<LinkTarget>)> {
        let class = attr_value(start, b"class", "a")?;
        let text = self.read_text_until(b"a")?;
        if class.as_deref() == Some("refPost") {
            let value = text.trim().to_string();
            if !value.is_empty() {
                return Ok((text, Some(LinkTarget::reference(value))));
            }
        }
        Ok((text, None))
    }

    fn read_paragraph(&mut self, start: &BytesStart<'static>) -> Result<XmlPara> {
        let class = attr_string(start, b"class", "p")?.unwrap_or_default();
        let mut text = String::new();
        let mut inline = Vec::new();
        let mut rich = false;
        let mut depth = 0usize;

        loop {
            match self.next_event()? {
                Event::Text(value) => {
                    let value = Self::decode_text(value.xml_content(), "text")?;
                    text.push_str(&value);
                    Self::push_inline_text(&mut inline, value);
                }
                Event::CData(value) => {
                    let value = Self::decode_text(value.xml_content(), "cdata")?;
                    text.push_str(&value);
                    Self::push_inline_text(&mut inline, value);
                }
                Event::Start(tag) if tag.name().as_ref() == b"a" => {
                    rich = true;
                    let tag = tag.into_owned();
                    let (value, reference) = self.read_anchor(&tag)?;
                    if let Some(target) = reference {
                        inline.push(XmlInline::Link { target, label: value.trim().to_string() });
                    } else {
                        text.push_str(&value);
                        Self::push_inline_text(&mut inline, value);
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
        let body = if rich {
            let mut inline = Self::normalize_inline(inline);
            while text.ends_with("..") {
                text.pop();
                Self::trim_trailing_link_dot(&mut inline);
            }
            XmlParaBody::Rich { text, inline }
        } else {
            XmlParaBody::Plain(text)
        };

        Ok(XmlPara { kind: ParaKind::from(class.as_str()), class, body })
    }

    fn raw_empty(start: &BytesStart<'_>) -> Result<String> {
        let mut w = quick_xml::Writer::new(Vec::new());
        w.write_event(Event::Empty(start.clone()))
            .map_err(|e| DocumentError::xml(format!("raw: {e}")))?;
        Ok(String::from_utf8_lossy(&w.into_inner()).into_owned())
    }

    fn read_blockquote(&mut self) -> Result<XmlNode> {
        let mut nodes = Vec::new();
        loop {
            match self.next_event()? {
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    nodes.push(self.read_version_child(&tag)?);
                }
                Event::Empty(tag) => {
                    let tag = tag.into_owned();
                    nodes.push(XmlNode::Html(Self::raw_empty(&tag)?));
                }
                Event::End(tag) if tag.name().as_ref() == b"blockquote" => break,
                Event::Eof => return Err(DocumentError::xml("blockquote: unexpected EOF")),
                _ => {}
            }
        }
        Ok(XmlNode::BlockQuote(nodes))
    }

    fn read_version_child(&mut self, start: &BytesStart<'static>) -> Result<XmlNode> {
        if start.name().as_ref() == b"p" {
            return self.read_paragraph(start).map(XmlNode::Paragraph);
        }
        if start.name().as_ref() == b"blockquote" {
            return self.read_blockquote();
        }
        self.raw(start).map(XmlNode::Html)
    }

    fn read_version(&mut self, start: &BytesStart<'static>) -> Result<XmlVersion> {
        let date =
            Self::parse_date(&require_attr(start, b"fecha_vigencia", "version")?, "version")?;
        let mut version = XmlVersion { date, nodes: Vec::new() };
        loop {
            match self.next_event()? {
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    version.nodes.push(self.read_version_child(&tag)?);
                }
                Event::Empty(tag) => {
                    let tag = tag.into_owned();
                    version.nodes.push(XmlNode::Html(Self::raw_empty(&tag)?));
                }
                Event::End(tag) if tag.name().as_ref() == b"version" => break,
                Event::Eof => return Err(DocumentError::xml("version: unexpected EOF")),
                _ => {}
            }
        }

        Ok(version)
    }

    fn read_block(&mut self, start: &BytesStart<'static>) -> Result<XmlBlock> {
        let mut block = XmlBlock {
            id: attr_value(start, b"id", "bloque")?.as_deref().and_then(BlockId::new),
            kind: BlockKind::from(
                attr_value(start, b"tipo", "bloque")?.as_deref().unwrap_or_default(),
            ),
            title: attr_value(start, b"titulo", "bloque")?
                .as_deref()
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
            let value = Self::normalize(&reader.read_text_until(tag.name().as_ref())?);
            if value.is_empty() {
                return Ok(ChildAction::Consumed);
            }
            match tag.name().as_ref() {
                b"identificador" => meta.identifier = Some(value),
                b"titulo" => meta.title = Some(value),
                b"departamento" => meta.department = Some(value),
                b"rango" => meta.rango = Some(value),
                b"fecha_publicacion" => meta.publication = Some(value),
                b"url_eli" => meta.eli = Some(value),
                _ => {}
            }
            Ok(ChildAction::Consumed)
        })?;
        Ok(meta)
    }

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

    fn read_document(&mut self) -> Result<LegalDocument> {
        loop {
            match self.next_event()? {
                Event::Start(tag) if tag.name().as_ref() == b"response" => {
                    if let Some(doc) = self.read_response()? {
                        return Ok(doc);
                    }
                    break;
                }
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    self.skip_element(&tag)?;
                }
                Event::Eof => break,
                _ => {}
            }
        }
        Err(DocumentError::MissingElement { path: "response/data/texto" })
    }
}

impl<R: BufRead> BoeStream for BoeBufReader<R> {
    fn next_event<'a>(&'a mut self) -> Result<Event<'a>> {
        self.buf.clear();
        self.inner.read_event_into(&mut self.buf).map_err(|e| {
            DocumentError::xml_at(
                self.inner.buffer_position() as usize,
                format!("parse: XML error at byte {}: {e}", self.inner.buffer_position()),
            )
        })
    }

    fn skip_to_end(&mut self, end: QName<'_>) -> Result<()> {
        self.buf.clear();
        self.inner.read_to_end_into(end, &mut self.buf).map(|_| ()).map_err(|e| {
            DocumentError::xml_at(
                self.inner.buffer_position() as usize,
                format!("parse: XML error at byte {}: {e}", self.inner.buffer_position()),
            )
        })
    }
}

impl<'a> BoeStream for BoeSliceReader<'a> {
    fn next_event<'b>(&'b mut self) -> Result<Event<'b>> {
        self.inner.read_event().map_err(|e| {
            DocumentError::xml_at(
                self.inner.buffer_position() as usize,
                format!("parse: XML error at byte {}: {e}", self.inner.buffer_position()),
            )
        })
    }

    fn skip_to_end(&mut self, end: QName<'_>) -> Result<()> {
        self.inner.read_to_end(end).map(|_| ()).map_err(|e| {
            DocumentError::xml_at(
                self.inner.buffer_position() as usize,
                format!("parse: XML error at byte {}: {e}", self.inner.buffer_position()),
            )
        })
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
        let mut reader = BoeBufReader::new(reader);
        reader.read_document()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let mut reader = BoeSliceReader::new(bytes);
        reader.read_document()
    }

    /// Parses XML into a `LegalDocument` IR.
    ///
    /// This function is intentionally stateless and independent of
    /// `TreeParser` policy.
    pub fn from_xml(xml: &str) -> Result<Self> {
        Self::from_bytes(xml.as_bytes())
    }
}

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
    fn heading<'a>(&self, block: &'a XmlBlock, version: &'a XmlVersion) -> Option<HeadingMatch> {
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

    fn push_para(tree: &mut DocumentTreeBuilder, parent: crate::NodeId, para: &XmlPara) {
        match &para.body {
            XmlParaBody::Plain(text) => {
                let text = text.trim();
                if !text.is_empty() {
                    let pid = tree.add_child(parent, DocumentNode::paragraph());
                    tree.add_child(pid, DocumentNode::text(text.to_string()));
                }
            }
            XmlParaBody::Rich { inline, .. } => {
                if !inline.is_empty() {
                    let pid = tree.add_child(parent, DocumentNode::paragraph());
                    for part in inline {
                        match part {
                            XmlInline::Text(text) => {
                                if !text.is_empty() {
                                    tree.add_child(pid, DocumentNode::text(text.clone()));
                                }
                            }
                            XmlInline::Link { target, label } => {
                                let lid =
                                    tree.add_child(pid, DocumentNode::link(target.clone(), None));
                                tree.add_child(lid, DocumentNode::text(label.clone()));
                            }
                        }
                    }
                }
            }
        }

        if para.kind.divider() {
            tree.add_child(parent, DocumentNode::thematic_break());
        }
    }

    fn push_html(tree: &mut DocumentTreeBuilder, parent: crate::NodeId, html: &mut String) {
        let value = html.trim();
        if value.is_empty() {
            html.clear();
            return;
        }
        tree.add_child(parent, DocumentNode::html(value.to_string()));
        html.clear();
    }

    fn push_nodes(tree: &mut DocumentTreeBuilder, parent: crate::NodeId, nodes: &[XmlNode]) {
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
                    let bid = tree.add_child(parent, DocumentNode::block_quote());
                    Self::push_nodes(tree, bid, items);
                }
            }
        }
        Self::push_html(tree, parent, &mut html);
    }

    /// Builds a `DocumentTree` from pre-parsed XML blocks.
    pub fn build_tree(&self, blocks: &[XmlBlock]) -> Result<DocumentTree> {
        let mut tree = DocumentTree::builder();
        let mut stack = vec![(0u8, tree.root(), 1u8)];
        let mut anchors = Anchors::default();

        for block in blocks {
            let Some(version) = self.pick(&block.versions) else {
                continue;
            };
            let Some(head) = self.heading(block, version) else {
                continue;
            };

            let rank = Self::rank(head.kind);
            while stack.last().map(|it| it.0 >= rank).unwrap_or(false) {
                stack.pop();
            }
            let parent = stack.last().map(|it| it.1).unwrap_or(tree.root());
            let parent_level = stack.last().map(|it| it.2).unwrap_or(1);
            let level = (parent_level + 1).min(6);

            let section = DocumentNode::section_with(level, Self::section(head.kind), &head.title)
                .with_anchor(anchors.next(&head.title, block.id.as_ref()));
            let id = tree.add_child(parent, section);
            stack.push((rank, id, level));

            if head.start > 0 {
                Self::push_nodes(&mut tree, id, &version.nodes[..head.start]);
            }
            let end = head.start + head.span;
            if end < version.nodes.len() {
                Self::push_nodes(&mut tree, id, &version.nodes[end..]);
            }
        }

        if tree.node_count() == 1 {
            return Err(DocumentError::xml("build: no sections extracted from XML"));
        }

        Ok(tree.freeze())
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
            .filter_map(|it| match it.data() {
                DocumentNode::Html(html) => Some(html),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(html.len(), 1);
        assert!(html[0].contains("<table>"));
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
        let para = tree
            .descendants(id)
            .find(|it| {
                matches!(it.data(), DocumentNode::Paragraph) && it.text().contains("Texto nota")
            })
            .unwrap();

        let parts = para
            .children()
            .map(|node| match node.data() {
                DocumentNode::Text(text) => format!("text:{text}"),
                DocumentNode::Link { target, .. } => format!("link:{}", target.key()),
                other => format!("other:{:?}", other.kind()),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            parts,
            vec!["text:Texto nota".to_string(), "link:Ref. BOE-A-1992-20403".to_string()]
        );
    }

    #[test]
    fn preserves_inline_reference_order_inside_paragraphs() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="20110927">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Antes <a class="refPost">Ref. BOE-A-2011-15210</a> después</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

        let tree = TreeParser::new().parse_xml(xml).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();
        let para =
            tree.children(id).find(|it| matches!(it.data(), DocumentNode::Paragraph)).unwrap();

        let parts = para
            .children()
            .map(|node| match node.data() {
                DocumentNode::Text(text) => format!("text:{text}"),
                DocumentNode::Link { target, .. } => format!("link:{}", target.key()),
                other => format!("other:{:?}", other.kind()),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            parts,
            vec![
                "text:Antes".to_string(),
                "link:Ref. BOE-A-2011-15210".to_string(),
                "text:después".to_string()
            ]
        );
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
            if matches!(child.data(), DocumentNode::ThematicBreak) {
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
            .filter(|id| matches!(id.data(), DocumentNode::BlockQuote))
            .collect::<Vec<_>>();

        assert_eq!(quotes.len(), 1);
        let paras =
            quotes[0].children().filter(|id| matches!(id.data(), DocumentNode::Paragraph)).count();
        assert_eq!(paras, 2);
    }

    #[test]
    fn combines_adjacent_heading_paragraphs() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("título-i-derechos").unwrap();
        let section = tree.get(id).unwrap();
        assert_eq!(section.section_title(), Some("TÍTULO I Derechos"));
    }

    #[test]
    fn skips_heading_paragraphs_in_section_body() {
        let tree = TreeParser::new().parse_xml(sample()).unwrap();
        let id = tree.find_by_anchor("artículo-1").unwrap();
        let values = tree
            .children(id)
            .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
            .map(|it| it.text())
            .collect::<Vec<_>>();

        assert!(values.iter().all(|it| it != "Artículo 1"));
        assert!(values.contains(&"Uno actualizado.".to_string()));
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
            .filter_map(|it| match it.data() {
                DocumentNode::Html(html) => Some(html),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(html.len(), 1);
        assert!(html[0].contains("<table>"));
        assert!(html[0].contains("<foo>"));
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
        assert_eq!(section.section_title(), Some("ANEXO Modelos de cuentas anuales consolidadas"));

        let body = tree
            .children(id)
            .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
            .map(|it| it.text())
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
        assert_eq!(section.section_title(), Some("MEMORIA CONSOLIDADA"));

        let body = tree
            .children(id)
            .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
            .map(|it| it.text())
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
