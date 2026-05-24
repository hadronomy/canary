use document_hierarchy::TreeParser;
use smol_str::SmolStr;

use crate::error::AppError;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParseSummary {
    pub title: Option<SmolStr>,
    pub identifier: Option<SmolStr>,
    pub department: Option<SmolStr>,
    pub node_count: usize,
    pub section_count: usize,
}

#[derive(Clone)]
pub struct ParserService {
    parser: TreeParser,
}

impl ParserService {
    #[must_use]
    pub fn new() -> Self {
        Self { parser: TreeParser::new() }
    }

    pub async fn summarize(&self, bytes: Vec<u8>) -> Result<ParseSummary, AppError> {
        let parser = self.parser.clone();
        tokio::task::spawn_blocking(move || {
            let doc = parser.parse_bytes_document(&bytes).map_err(|_| {
                AppError::validation_code(
                    "invalid_document",
                    "The document payload could not be parsed.",
                )
            })?;
            let tree = parser.build_document(doc.clone()).map_err(|_| {
                AppError::validation_code(
                    "invalid_document",
                    "The document payload is not a valid document.",
                )
            })?;
            Ok(ParseSummary {
                title: doc.meta.title,
                identifier: doc.meta.identifier,
                department: doc.meta.department,
                node_count: tree.node_count(),
                section_count: tree.sections().count(),
            })
        })
        .await
        .map_err(|source| {
            AppError::internal("parser_task_error", "The parser worker failed unexpectedly.")
                .with_source(source)
        })?
    }
}

impl Default for ParserService {
    fn default() -> Self {
        Self::new()
    }
}
