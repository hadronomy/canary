use std::fmt;

use crate::tree::ColumnAlignment;

#[derive(Debug, Clone)]
pub struct NodeContext<'a> {
    pub depth: usize,
    pub anchor: Option<&'a str>,
    pub content: &'a str,
    pub path: String,
    pub last: bool,
}

pub trait TreeWriter {
    type Error: From<fmt::Error>;

    fn enter_section(&mut self, level: u8, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_section(&mut self, _level: u8, _ctx: &NodeContext<'_>) -> Result<(), Self::Error> {
        Ok(())
    }

    fn enter_paragraph(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_paragraph(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn enter_blockquote(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_blockquote(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn enter_list(
        &mut self,
        ordered: bool,
        tight: bool,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;
    fn leave_list(
        &mut self,
        ordered: bool,
        tight: bool,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;

    fn enter_list_item(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_list_item(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn enter_table(
        &mut self,
        aligns: &[ColumnAlignment],
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;
    fn leave_table(
        &mut self,
        aligns: &[ColumnAlignment],
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;

    fn enter_table_row(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_table_row(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn enter_table_cell(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_table_cell(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn write_code_block(
        &mut self,
        lang: Option<&str>,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;

    fn enter_strong(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_strong(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn enter_emphasis(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;
    fn leave_emphasis(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn write_text(&mut self, ctx: &NodeContext<'_>) -> Result<(), Self::Error>;

    fn write_link(
        &mut self,
        url: &str,
        title: Option<&str>,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;

    fn write_image(
        &mut self,
        url: &str,
        alt: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<(), Self::Error>;

    fn write_thematic_break(&mut self) -> Result<(), Self::Error>;
}
