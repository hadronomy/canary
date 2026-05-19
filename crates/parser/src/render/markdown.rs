use std::fmt::{self, Write};

use crate::parser::DocumentMeta;
use crate::render::writer::{NodeContext, TreeWriter};
use crate::tree::{ColumnAlignment, LinkTarget, ListSpacing, ListStyle, SectionKind};

#[derive(Debug, Clone)]
pub enum HeadingMode {
    None,
    Boe { meta: DocumentMeta, fragments: usize },
}

pub struct MarkdownWriter<W> {
    out: W,
    lists: Vec<usize>,
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
}

impl<W: Write> TreeWriter for MarkdownWriter<W> {
    type Error = fmt::Error;

    fn enter_section(
        &mut self,
        level: u8,
        kind: SectionKind,
        title: &str,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
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
        let level = if boe { (self.heads + 1).min(6) as u8 } else { level.min(6) };
        writeln!(self.out, "{} {title}", "#".repeat(level as usize))?;
        self.brk = true;
        Ok(())
    }

    fn leave_section(
        &mut self,
        _level: u8,
        _kind: SectionKind,
        _title: &str,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        if matches!(&self.mode, HeadingMode::Boe { .. })
            && let Some(counted) = self.sections.pop()
            && counted
        {
            self.heads = self.heads.saturating_sub(1);
        }
        Ok(())
    }

    fn enter_paragraph(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        self.line()?;
        self.pref()?;
        Ok(())
    }

    fn leave_paragraph(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        writeln!(self.out)?;
        self.brk = true;
        Ok(())
    }

    fn enter_blockquote(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        self.line()?;
        self.quote += 1;
        self.brk = false;
        Ok(())
    }

    fn leave_blockquote(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        self.quote = self.quote.saturating_sub(1);
        self.brk = true;
        Ok(())
    }

    fn enter_list(
        &mut self,
        style: ListStyle,
        _spacing: ListSpacing,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        if self.lists.is_empty() {
            self.line()?;
        }
        self.lists.push(match style {
            ListStyle::Ordered => 1,
            ListStyle::Unordered => 0,
        });
        Ok(())
    }

    fn leave_list(
        &mut self,
        _style: ListStyle,
        _spacing: ListSpacing,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        self.lists.pop();
        if self.lists.is_empty() {
            self.brk = true;
        }
        Ok(())
    }

    fn enter_list_item(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
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

    fn leave_list_item(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        writeln!(self.out)?;
        Ok(())
    }

    fn enter_table(
        &mut self,
        _aligns: &[ColumnAlignment],
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        self.line()?;
        Ok(())
    }

    fn leave_table(
        &mut self,
        _aligns: &[ColumnAlignment],
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        self.brk = true;
        Ok(())
    }

    fn enter_table_row(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        self.pref()?;
        write!(self.out, "|")?;
        Ok(())
    }

    fn leave_table_row(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        writeln!(self.out)?;
        Ok(())
    }

    fn enter_table_cell(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, " ")?;
        Ok(())
    }

    fn leave_table_cell(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, " |")?;
        Ok(())
    }

    fn write_code_block(
        &mut self,
        lang: Option<&str>,
        code: &str,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        self.line()?;
        self.pref()?;
        writeln!(self.out, "```{}", lang.unwrap_or(""))?;
        for line in code.lines() {
            self.pref()?;
            writeln!(self.out, "{line}")?;
        }
        self.pref()?;
        writeln!(self.out, "```")?;
        self.brk = true;
        Ok(())
    }

    fn enter_strong(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "**")?;
        Ok(())
    }

    fn leave_strong(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "**")?;
        Ok(())
    }

    fn enter_emphasis(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "*")?;
        Ok(())
    }

    fn leave_emphasis(&mut self, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "*")?;
        Ok(())
    }

    fn write_text(&mut self, text: &str, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "{text}")?;
        Ok(())
    }

    fn enter_link(
        &mut self,
        _target: &LinkTarget,
        _title: Option<&str>,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        write!(self.out, "[")?;
        Ok(())
    }

    fn leave_link(
        &mut self,
        target: &LinkTarget,
        title: Option<&str>,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        let href = target.to_string();
        if let Some(title) = title {
            write!(self.out, "]({href} \"{title}\")")?;
            return Ok(());
        }
        write!(self.out, "]({href})")?;
        Ok(())
    }

    fn write_image(
        &mut self,
        url: &str,
        alt: &str,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        write!(self.out, "![{alt}]({url})")?;
        Ok(())
    }

    fn write_html(&mut self, html: &str, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
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

    fn write_thematic_break(&mut self) -> Result<(), Self::Error> {
        self.line()?;
        self.pref()?;
        writeln!(self.out, "---")?;
        self.brk = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::parser::DocumentMeta;
    use crate::render;
    use crate::render::markdown::{HeadingMode, MarkdownWriter};
    use crate::tree::{DocumentNode, DocumentTree, DocumentTreeBuilder, SectionKind};

    fn build(f: impl FnOnce(&mut DocumentTreeBuilder)) -> DocumentTree {
        let mut tree = DocumentTree::builder();
        f(&mut tree);
        tree.freeze()
    }

    #[test]
    fn renders_markdown_section_and_paragraph() {
        let tree = build(|tree| {
            let sec = tree.add_child(tree.root(), DocumentNode::section(2, "Intro"));
            let para = tree.add_child(sec, DocumentNode::paragraph());
            tree.add_child(para, DocumentNode::text("Hello world"));
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("## Intro"));
        assert!(out.contains("Hello world"));
    }

    #[test]
    fn renders_markdown_inline_nodes() {
        let tree = build(|tree| {
            let para = tree.add_child(tree.root(), DocumentNode::paragraph());
            let strong = tree.add_child(para, DocumentNode::strong());
            tree.add_child(strong, DocumentNode::text("bold"));
            let em = tree.add_child(para, DocumentNode::emphasis());
            tree.add_child(em, DocumentNode::text("soft"));
            let link = tree.add_child(para, DocumentNode::link_external("https://x.test", None));
            tree.add_child(link, DocumentNode::text("ref"));
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("**bold**"));
        assert!(out.contains("*soft*"));
        assert!(out.contains("[ref](https://x.test)"));
    }

    #[test]
    fn does_not_emit_empty_quote_line_before_content() {
        let tree = build(|tree| {
            let quote = tree.add_child(tree.root(), DocumentNode::block_quote());
            let para = tree.add_child(quote, DocumentNode::paragraph());
            tree.add_child(para, DocumentNode::text("Texto nota"));
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("> Texto nota"));
        assert!(!out.contains("\n>\n> Texto nota"));
    }

    #[test]
    fn renders_html_fallback_as_markdown() {
        let tree = build(|tree| {
            tree.add_child(
                tree.root(),
                DocumentNode::html("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>"),
            );
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("| A |"));
        assert!(out.contains("| 1 |"));
    }

    #[test]
    fn renders_boe_heading_when_enabled() {
        let tree = build(|tree| {
            tree.add_child(tree.root(), DocumentNode::section(2, "Intro"));
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::with_heading(
            &mut out,
            HeadingMode::Boe {
                meta: DocumentMeta {
                    identifier: Some("BOE-A-1978-31229".to_string()),
                    title: Some("Constitución Española.".to_string()),
                    department: Some("Cortes Generales".to_string()),
                    rango: Some("Constitución".to_string()),
                    publication: Some("19781229".to_string()),
                    eli: Some("https://www.boe.es/eli/es/c/1978/12/27/(1)".to_string()),
                },
                fragments: 800,
            },
        );
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("# Constitución Española."));
        assert!(out.contains("- Identificador: BOE-A-1978-31229"));
        assert!(out.contains("- Fragmentos: 800"));
        assert!(out.contains("## Intro"));
    }

    #[test]
    fn forces_article_sections_to_h3() {
        let tree = build(|tree| {
            let title = tree.add_child(
                tree.root(),
                DocumentNode::section_with(2, SectionKind::Titulo, "TÍTULO I"),
            );
            let chap = tree.add_child(
                title,
                DocumentNode::section_with(3, SectionKind::Capitulo, "CAPÍTULO PRIMERO"),
            );
            tree.add_child(
                chap,
                DocumentNode::section_with(4, SectionKind::Articulo, "Artículo 15"),
            );
        });

        let mut out = String::new();
        let mut w = MarkdownWriter::with_heading(
            &mut out,
            HeadingMode::Boe { meta: DocumentMeta::default(), fragments: 0 },
        );
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("CAPÍTULO PRIMERO\n---"));
        assert!(out.contains("### Artículo 15"));
        assert!(!out.contains("##### Artículo 15"));
    }
}
