use std::fmt;

use crate::tree::{ColumnAlignment, LinkTarget, ListSpacing, ListStyle, SectionKind};

pub trait TreeWriter {
    type Error: From<fmt::Error>;

    fn enter_section(
        &mut self,
        level: u8,
        kind: SectionKind,
        title: &str,
    ) -> Result<(), Self::Error>;
    fn leave_section(
        &mut self,
        _level: u8,
        _kind: SectionKind,
        _title: &str,
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    fn enter_paragraph(&mut self) -> Result<(), Self::Error>;
    fn leave_paragraph(&mut self) -> Result<(), Self::Error>;

    fn enter_blockquote(&mut self) -> Result<(), Self::Error>;
    fn leave_blockquote(&mut self) -> Result<(), Self::Error>;

    fn enter_list(&mut self, style: ListStyle, spacing: ListSpacing) -> Result<(), Self::Error>;
    fn leave_list(&mut self, style: ListStyle, spacing: ListSpacing) -> Result<(), Self::Error>;

    fn enter_list_item(&mut self) -> Result<(), Self::Error>;
    fn leave_list_item(&mut self) -> Result<(), Self::Error>;

    fn enter_table(&mut self, aligns: &[ColumnAlignment]) -> Result<(), Self::Error>;
    fn leave_table(&mut self, aligns: &[ColumnAlignment]) -> Result<(), Self::Error>;

    fn enter_table_row(&mut self) -> Result<(), Self::Error>;
    fn leave_table_row(&mut self) -> Result<(), Self::Error>;

    fn enter_table_cell(&mut self) -> Result<(), Self::Error>;
    fn leave_table_cell(&mut self) -> Result<(), Self::Error>;

    fn write_code_block(&mut self, lang: Option<&str>, code: &str) -> Result<(), Self::Error>;

    fn enter_strong(&mut self) -> Result<(), Self::Error>;
    fn leave_strong(&mut self) -> Result<(), Self::Error>;

    fn enter_emphasis(&mut self) -> Result<(), Self::Error>;
    fn leave_emphasis(&mut self) -> Result<(), Self::Error>;

    fn write_text(&mut self, text: &str) -> Result<(), Self::Error>;

    fn enter_link(&mut self, target: &LinkTarget, title: Option<&str>) -> Result<(), Self::Error>;
    fn leave_link(&mut self, target: &LinkTarget, title: Option<&str>) -> Result<(), Self::Error>;

    fn write_image(&mut self, url: &str, alt: &str) -> Result<(), Self::Error>;

    fn write_html(&mut self, html: &str) -> Result<(), Self::Error>;

    fn write_thematic_break(&mut self) -> Result<(), Self::Error>;
}
