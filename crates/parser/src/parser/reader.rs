use std::io::BufRead;

use chrono::NaiveDate;
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;

use super::attrs::{ChildAction, attr_string, attr_value, require_attr};
use super::model::{
    BlockKind, DocumentMeta, ParaKind, XmlBlock, XmlInline, XmlNode, XmlPara, XmlParaBody, XmlRow,
    XmlTable, XmlVersion,
};
use super::sink::XmlSink;
use crate::error::{DocumentError, Result};
use crate::tree::{BlockId, LinkTarget};

pub(super) struct BoeBufReader<R> {
    inner: Reader<R>,
    buf: Vec<u8>,
}

impl<R: BufRead> BoeBufReader<R> {
    pub(super) fn new(reader: R) -> Self {
        let mut inner = Reader::from_reader(reader);
        inner.config_mut().trim_text(true);
        Self { inner, buf: Vec::new() }
    }
}

pub(super) struct BoeSliceReader<'a> {
    inner: Reader<&'a [u8]>,
}

impl<'a> BoeSliceReader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        let mut inner = Reader::from_reader(bytes);
        inner.config_mut().trim_text(true);
        Self { inner }
    }
}

pub(super) trait BoeStream {
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

    fn read_table_cell(&mut self, closing: &[u8], phase: &str) -> Result<String> {
        let mut depth = 0usize;
        let mut out = String::new();
        loop {
            match self.next_event()? {
                Event::Text(value) => out.push_str(&Self::decode_text(value.xml_content(), phase)?),
                Event::CData(value) => {
                    out.push_str(&Self::decode_text(value.xml_content(), phase)?)
                }
                Event::Empty(tag) if tag.name().as_ref() == b"br" => out.push(' '),
                Event::Start(_) => depth += 1,
                Event::End(tag) if tag.name().as_ref() == closing && depth == 0 => break,
                Event::End(_) => {
                    if depth == 0 {
                        return Err(DocumentError::xml(format!("{phase}: unbalanced close tag")));
                    }
                    depth -= 1;
                }
                Event::Eof => {
                    return Err(DocumentError::xml(format!(
                        "{phase}: unexpected EOF before closing {}",
                        String::from_utf8_lossy(closing)
                    )));
                }
                _ => {}
            }
        }
        Ok(Self::normalize(&out))
    }

    fn read_table_row(&mut self) -> Result<XmlRow> {
        let mut cells = Vec::new();
        loop {
            match self.next_event()? {
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    if matches!(tag.name().as_ref(), b"td" | b"th") {
                        cells.push(self.read_table_cell(tag.name().as_ref(), "table/cell")?);
                        continue;
                    }
                    self.skip_element(&tag)?;
                }
                Event::Empty(tag) if matches!(tag.name().as_ref(), b"td" | b"th") => {
                    cells.push(String::new());
                }
                Event::End(tag) if tag.name().as_ref() == b"tr" => break,
                Event::Eof => return Err(DocumentError::xml("table/row: unexpected EOF")),
                _ => {}
            }
        }
        Ok(XmlRow { cells })
    }

    fn read_table_rows(&mut self, closing: &[u8], rows: &mut Vec<XmlRow>) -> Result<()> {
        loop {
            match self.next_event()? {
                Event::Start(tag) => {
                    let tag = tag.into_owned();
                    if tag.name().as_ref() == b"tr" {
                        rows.push(self.read_table_row()?);
                        continue;
                    }
                    if matches!(tag.name().as_ref(), b"thead" | b"tbody" | b"tfoot") {
                        let name = tag.name().as_ref().to_vec();
                        self.read_table_rows(&name, rows)?;
                        continue;
                    }
                    self.skip_element(&tag)?;
                }
                Event::End(tag) if tag.name().as_ref() == closing => break,
                Event::Eof => {
                    return Err(DocumentError::xml(format!(
                        "table/body: unexpected EOF before closing {}",
                        String::from_utf8_lossy(closing)
                    )));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn read_table(&mut self) -> Result<XmlNode> {
        let mut rows = Vec::new();
        self.read_table_rows(b"table", &mut rows)?;
        Ok(XmlNode::Table(XmlTable { rows }))
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
                    if tag.name().as_ref() == b"table" {
                        nodes.push(XmlNode::Table(XmlTable::default()));
                    } else {
                        nodes.push(XmlNode::Html(Self::raw_empty(&tag)?));
                    }
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
        if start.name().as_ref() == b"table" {
            return self.read_table();
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
                    if tag.name().as_ref() == b"table" {
                        version.nodes.push(XmlNode::Table(XmlTable::default()));
                    } else {
                        version.nodes.push(XmlNode::Html(Self::raw_empty(&tag)?));
                    }
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

    fn read_texto<S: XmlSink>(&mut self, sink: &mut S) -> Result<()> {
        let mut found = false;
        self.each_child(b"texto", "texto", |tag, reader| {
            if tag.name().as_ref() == b"bloque" {
                found = true;
                sink.block(reader.read_block(tag)?)?;
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;

        if found {
            return Ok(());
        }

        Err(DocumentError::MissingElement { path: "response/data/texto/bloque" })
    }

    fn read_data<S: XmlSink>(&mut self, sink: &mut S) -> Result<()> {
        let mut meta = DocumentMeta::default();
        let mut found = false;
        self.each_child(b"data", "data", |tag, reader| {
            if tag.name().as_ref() == b"metadatos" {
                meta = reader.read_metadatos()?;
                sink.meta(meta.clone());
                return Ok(ChildAction::Consumed);
            }
            if tag.name().as_ref() == b"texto" {
                found = true;
                sink.meta(meta.clone());
                reader.read_texto(sink)?;
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;
        if found {
            return Ok(());
        }
        Err(DocumentError::MissingElement { path: "response/data/texto" })
    }

    fn read_response<S: XmlSink>(&mut self, sink: &mut S) -> Result<()> {
        let mut found = false;
        self.each_child(b"response", "response", |tag, reader| {
            if tag.name().as_ref() == b"data" {
                found = true;
                reader.read_data(sink)?;
                return Ok(ChildAction::Consumed);
            }
            Ok(ChildAction::Skip)
        })?;
        if found {
            return Ok(());
        }
        Err(DocumentError::MissingElement { path: "response/data/texto" })
    }

    fn read_document<S: XmlSink>(&mut self, sink: &mut S) -> Result<()> {
        loop {
            match self.next_event()? {
                Event::Start(tag) if tag.name().as_ref() == b"response" => {
                    return self.read_response(sink);
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
