use std::io::BufRead;

use chrono::NaiveDate;

use super::reader::{BoeBufReader, BoeSliceReader, BoeStream};
use super::sink::{IrSink, XmlSink};
use crate::error::Result;
use crate::tree::{BlockId, LinkTarget};

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
    Table(XmlTable),
    Html(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct XmlTable {
    pub rows: Vec<XmlRow>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct XmlRow {
    pub cells: Vec<String>,
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
    pub(super) fn heading(self) -> bool {
        matches!(self, Self::Titulo | Self::Capitulo | Self::Seccion | Self::Articulo)
    }

    /// Returns `true` when this paragraph kind acts as an in-section divider.
    pub(super) fn divider(self) -> bool {
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

/// Parsed legal XML intermediate representation.
#[derive(Debug, Clone)]
pub struct LegalDocument {
    pub meta: DocumentMeta,
    pub blocks: Vec<XmlBlock>,
}

impl LegalDocument {
    pub fn from_reader<R: BufRead>(reader: R) -> Result<Self> {
        let mut reader = BoeBufReader::new(reader);
        let mut sink = IrSink::default();
        reader.read_document(&mut sink)?;
        sink.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let mut reader = BoeSliceReader::new(bytes);
        let mut sink = IrSink::default();
        reader.read_document(&mut sink)?;
        sink.finish()
    }

    /// Parses XML into a `LegalDocument` IR.
    ///
    /// This function is intentionally stateless and independent of
    /// `TreeParser` policy.
    pub fn from_xml(xml: &str) -> Result<Self> {
        Self::from_bytes(xml.as_bytes())
    }
}
