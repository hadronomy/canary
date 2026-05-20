use std::fmt::{self, Write};

use crate::parser::DocumentMeta;
use crate::render::writer::{RenderEvent, TreeWriter};
use crate::tree::{Atom, HeadingLevel, SectionKind, Tag, TagEnd};

#[derive(Debug, Clone)]
struct LinkState {
    href: String,
    title: Option<String>,
}

#[derive(Debug, Clone)]
pub enum HeadingMode {
    None,
    Boe { meta: DocumentMeta, fragments: usize },
}

pub struct MarkdownWriter<W> {
    out: W,
    lists: Vec<usize>,
    links: Vec<LinkState>,
    quote: usize,
    brk: bool,
    mode: HeadingMode,
    started: bool,
    sections: Vec<bool>,
    heads: usize,
}

impl<W: Write> MarkdownWriter<W> {
    pub fn new(out: W) -> Self {
        Self::with_heading(out, HeadingMode::None)
    }

    pub fn with_heading(out: W, mode: HeadingMode) -> Self {
        Self {
            out,
            lists: Vec::new(),
            links: Vec::new(),
            quote: 0,
            brk: false,
            mode,
            started: false,
            sections: Vec::new(),
            heads: 0,
        }
    }

    pub fn into_inner(self) -> W {
        self.out
    }

    fn start(&mut self) -> fmt::Result {
        if self.started {
            return Ok(());
        }
        self.started = true;
        let HeadingMode::Boe { meta, fragments } = &self.mode else {
            return Ok(());
        };

        writeln!(self.out, "# {}", meta.title.as_deref().unwrap_or("Documento"))?;
        writeln!(self.out)?;
        if let Some(value) = &meta.identifier {
            writeln!(self.out, "- Identificador: {value}")?;
        }
        if let Some(value) = &meta.rango {
            writeln!(self.out, "- Rango: {value}")?;
        }
        if let Some(value) = &meta.department {
            writeln!(self.out, "- Departamento: {value}")?;
        }
        if let Some(value) = &meta.publication {
            writeln!(self.out, "- Publicación: {value}")?;
        }
        if let Some(value) = &meta.eli {
            writeln!(self.out, "- ELI: {value}")?;
        }
        writeln!(self.out, "- Consulta: /")?;
        writeln!(self.out, "- Fragmentos: {fragments}")?;
        writeln!(self.out)?;
        Ok(())
    }

    fn marker(kind: SectionKind) -> bool {
        matches!(kind, SectionKind::Capitulo | SectionKind::Seccion)
    }

    fn line(&mut self) -> fmt::Result {
        self.start()?;
        if self.brk {
            self.pref()?;
            writeln!(self.out)?;
        }
        self.brk = true;
        Ok(())
    }

    fn pref(&mut self) -> fmt::Result {
        for _ in 0..self.quote {
            write!(self.out, "> ")?;
        }
        Ok(())
    }

    fn indent(&self) -> usize {
        self.lists.len().saturating_sub(1) * 4
    }

    fn start_tag(&mut self, tag: Tag<'_>) -> fmt::Result {
        match tag {
            Tag::Root => Ok(()),
            Tag::Section { level, kind, title, .. } => {
                let boe = matches!(&self.mode, HeadingMode::Boe { .. });
                if boe && Self::marker(kind) {
                    self.sections.push(false);
                    self.line()?;
                    self.pref()?;
                    writeln!(self.out, "{title}")?;
                    self.pref()?;
                    writeln!(self.out, "---")?;
                    self.brk = true;
                    return Ok(());
                }

                if boe {
                    self.sections.push(true);
                    self.heads += 1;
                }
                self.line()?;
                self.pref()?;
                let level = if boe {
                    HeadingLevel::new((self.heads + 1).min(6) as u8)
                        .expect("markdown headings stay within range")
                } else {
                    level
                };
                writeln!(self.out, "{} {title}", "#".repeat(level.get() as usize))?;
                self.brk = true;
                Ok(())
            }
            Tag::Paragraph => {
                self.line()?;
                self.pref()?;
                Ok(())
            }
            Tag::List { style, .. } => {
                if self.lists.is_empty() {
                    self.line()?;
                }
                self.lists.push(match style {
                    crate::tree::ListStyle::Ordered => 1,
                    crate::tree::ListStyle::Unordered => 0,
                });
                Ok(())
            }
            Tag::ListItem => {
                self.pref()?;
                write!(self.out, "{:n$}", "", n = self.indent())?;
                match self.lists.last_mut() {
                    Some(it) if *it > 0 => {
                        write!(self.out, "{}. ", it)?;
                        *it += 1;
                    }
                    _ => write!(self.out, "- ")?,
                }
                Ok(())
            }
            Tag::BlockQuote => {
                self.line()?;
                self.quote += 1;
                self.brk = false;
                Ok(())
            }
            Tag::Table { .. } => {
                self.line()?;
                Ok(())
            }
            Tag::TableRow => {
                self.pref()?;
                write!(self.out, "|")?;
                Ok(())
            }
            Tag::TableCell => {
                write!(self.out, " ")?;
                Ok(())
            }
            Tag::Strong => {
                write!(self.out, "**")?;
                Ok(())
            }
            Tag::Emphasis => {
                write!(self.out, "*")?;
                Ok(())
            }
            Tag::Link { target, title } => {
                self.links
                    .push(LinkState { href: target.to_string(), title: title.map(str::to_owned) });
                write!(self.out, "[")?;
                Ok(())
            }
        }
    }

    fn end_tag(&mut self, tag: TagEnd) -> fmt::Result {
        match tag {
            TagEnd::Root => Ok(()),
            TagEnd::Section => {
                if matches!(&self.mode, HeadingMode::Boe { .. })
                    && let Some(counted) = self.sections.pop()
                    && counted
                {
                    self.heads = self.heads.saturating_sub(1);
                }
                Ok(())
            }
            TagEnd::Paragraph => {
                writeln!(self.out)?;
                self.brk = true;
                Ok(())
            }
            TagEnd::List => {
                self.lists.pop();
                if self.lists.is_empty() {
                    self.brk = true;
                }
                Ok(())
            }
            TagEnd::ListItem => {
                writeln!(self.out)?;
                Ok(())
            }
            TagEnd::BlockQuote => {
                self.quote = self.quote.saturating_sub(1);
                self.brk = true;
                Ok(())
            }
            TagEnd::Table => {
                self.brk = true;
                Ok(())
            }
            TagEnd::TableRow => {
                writeln!(self.out)?;
                Ok(())
            }
            TagEnd::TableCell => {
                write!(self.out, " |")?;
                Ok(())
            }
            TagEnd::Strong => {
                write!(self.out, "**")?;
                Ok(())
            }
            TagEnd::Emphasis => {
                write!(self.out, "*")?;
                Ok(())
            }
            TagEnd::Link => {
                let Some(link) = self.links.pop() else {
                    return Ok(());
                };
                if let Some(title) = link.title {
                    write!(self.out, "]({} \"{title}\")", link.href)?;
                    return Ok(());
                }
                write!(self.out, "]({})", link.href)?;
                Ok(())
            }
        }
    }

    fn atom(&mut self, leaf: Atom<'_>) -> fmt::Result {
        match leaf {
            Atom::Html { html } => {
                self.line()?;
                self.pref()?;
                if let Ok(md) = htmd::convert(html) {
                    let text = md.trim();
                    if !text.is_empty() {
                        for (idx, line) in text.lines().enumerate() {
                            if idx > 0 {
                                self.pref()?;
                            }
                            writeln!(self.out, "{line}")?;
                        }
                        self.brk = true;
                        return Ok(());
                    }
                }
                writeln!(self.out, "{html}")?;
                self.brk = true;
                Ok(())
            }
            Atom::CodeBlock { language, code } => {
                self.line()?;
                self.pref()?;
                writeln!(self.out, "```{}", language.unwrap_or(""))?;
                for line in code.lines() {
                    self.pref()?;
                    writeln!(self.out, "{line}")?;
                }
                self.pref()?;
                writeln!(self.out, "```")?;
                self.brk = true;
                Ok(())
            }
            Atom::Text { text } => {
                write!(self.out, "{text}")?;
                Ok(())
            }
            Atom::Image { url, alt, .. } => {
                write!(self.out, "![{alt}]({url})")?;
                Ok(())
            }
            Atom::ThematicBreak => {
                self.line()?;
                self.pref()?;
                writeln!(self.out, "---")?;
                self.brk = true;
                Ok(())
            }
        }
    }
}

impl<W: Write> TreeWriter for MarkdownWriter<W> {
    type Error = fmt::Error;

    fn event(&mut self, ev: RenderEvent<'_>) -> Result<(), Self::Error> {
        match ev {
            RenderEvent::Start(tag) => self.start_tag(tag),
            RenderEvent::End(tag) => self.end_tag(tag),
            RenderEvent::Atom(atom) => self.atom(atom),
        }
    }
}

#[cfg(test)]
mod tests;
