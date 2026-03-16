use std::fmt::{self, Write};

use crate::render::writer::{NodeContext, TreeWriter};
use crate::tree::ColumnAlignment;

pub struct MarkdownWriter<W> {
    out: W,
    lists: Vec<usize>,
    quote: usize,
    brk: bool,
}

impl<W: Write> MarkdownWriter<W> {
    pub fn new(out: W) -> Self {
        Self { out, lists: Vec::new(), quote: 0, brk: false }
    }

    pub fn into_inner(self) -> W {
        self.out
    }

    fn line(&mut self) -> fmt::Result {
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

    fn enter_section(&mut self, level: u8, ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        self.line()?;
        self.pref()?;
        let h = "#".repeat(level.min(6) as usize);
        writeln!(self.out, "{h} {}", ctx.content)?;
        self.brk = true;
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
        ordered: bool,
        _tight: bool,
        _ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        if self.lists.is_empty() {
            self.line()?;
        }
        self.lists.push(if ordered { 1 } else { 0 });
        Ok(())
    }

    fn leave_list(
        &mut self,
        _ordered: bool,
        _tight: bool,
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
        let n = self.indent();
        write!(self.out, "{:n$}", "", n = n)?;
        match self.lists.last_mut() {
            Some(it) if *it > 0 => {
                write!(self.out, "{}. ", it)?;
                *it += 1;
            }
            _ => {
                write!(self.out, "- ")?;
            }
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
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        self.line()?;
        self.pref()?;
        writeln!(self.out, "```{}", lang.unwrap_or(""))?;
        for line in ctx.content.lines() {
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

    fn write_text(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        write!(self.out, "{}", ctx.content)?;
        Ok(())
    }

    fn write_link(
        &mut self,
        url: &str,
        title: Option<&str>,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error> {
        if let Some(title) = title {
            write!(self.out, "[{}]({url} \"{title}\")", ctx.content)?;
            return Ok(());
        }
        write!(self.out, "[{}]({url})", ctx.content)?;
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
    use crate::render;
    use crate::render::markdown::MarkdownWriter;
    use crate::tree::{DocumentNode, DocumentTree, NodeKind};

    #[test]
    fn renders_markdown_section_and_paragraph() {
        let mut tree = DocumentTree::new();
        let sec = tree.add_child(tree.root(), DocumentNode::section(2, "Intro"));
        tree.add_child(sec, DocumentNode::new(NodeKind::Paragraph, "Hello world"));

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("## Intro"));
        assert!(out.contains("Hello world"));
    }

    #[test]
    fn renders_markdown_inline_nodes() {
        let mut tree = DocumentTree::new();
        let para = tree.add_child(tree.root(), DocumentNode::new(NodeKind::Paragraph, ""));
        tree.add_child(para, DocumentNode::new(NodeKind::Strong, "bold"));
        tree.add_child(para, DocumentNode::new(NodeKind::Emphasis, "soft"));
        tree.add_child(para, DocumentNode::link("https://x.test", None, "ref"));

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("**bold**"));
        assert!(out.contains("*soft*"));
        assert!(out.contains("[ref](https://x.test)"));
    }

    #[test]
    fn does_not_emit_empty_quote_line_before_content() {
        let mut tree = DocumentTree::new();
        let quote = tree.add_child(tree.root(), DocumentNode::new(NodeKind::BlockQuote, ""));
        tree.add_child(quote, DocumentNode::new(NodeKind::Paragraph, "Texto nota"));

        let mut out = String::new();
        let mut w = MarkdownWriter::new(&mut out);
        render::render(&tree, tree.root(), &mut w).unwrap();

        assert!(out.contains("> Texto nota"));
        assert!(!out.contains("\n>\n> Texto nota"));
    }
}
