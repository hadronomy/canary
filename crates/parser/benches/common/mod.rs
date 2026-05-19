#![allow(dead_code)]

use std::sync::OnceLock;

use document_hierarchy::parser::{DocumentMeta, LegalDocument};
use document_hierarchy::{
    CrossRefResolver, DocumentTree, HeadingMode, MarkdownWriter, NodeId, SectionPath, TreeParser,
    render,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fixture {
    Constitution1978,
    Consolidated2021,
}

impl Fixture {
    pub const ALL: [Self; 2] = [Self::Constitution1978, Self::Consolidated2021];

    pub fn name(self) -> &'static str {
        match self {
            Self::Constitution1978 => "boe-a-1978-31229",
            Self::Consolidated2021 => "boe-a-2021-13171",
        }
    }

    pub fn bytes(self) -> &'static [u8] {
        match self {
            Self::Constitution1978 => {
                include_bytes!("../../examples/assets/boe-a-1978-31229-full.xml")
            }
            Self::Consolidated2021 => {
                include_bytes!("../../examples/assets/boe-a-2021-13171-full.xml")
            }
        }
    }

    pub fn len(self) -> usize {
        self.bytes().len()
    }

    pub fn document(self) -> &'static LegalDocument {
        match self {
            Self::Constitution1978 => constitution_doc(),
            Self::Consolidated2021 => consolidated_doc(),
        }
    }

    pub fn tree(self) -> &'static DocumentTree {
        match self {
            Self::Constitution1978 => constitution_tree(),
            Self::Consolidated2021 => consolidated_tree(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct QueryCase {
    pub fixture: Fixture,
    pub anchor: &'static str,
    pub path: &'static str,
    pub fuzzy: &'static str,
}

impl QueryCase {
    pub const ALL: [Self; 2] = [
        Self {
            fixture: Fixture::Constitution1978,
            anchor: "título-i-de-los-derechos-y-deberes-fundamentales",
            path: "3",
            fuzzy: "TÍTULO I De los derechos y deberes fundamentales",
        },
        Self {
            fixture: Fixture::Consolidated2021,
            anchor: "introducción",
            path: "4",
            fuzzy: "Introducción",
        },
    ];

    pub fn name(self) -> &'static str {
        self.fixture.name()
    }

    pub fn path_value(self) -> SectionPath {
        self.path.parse().unwrap()
    }

    pub fn anchor_query(self) -> String {
        format!("#{}", self.anchor)
    }

    pub fn section_query(self) -> String {
        format!("Section {}", self.path)
    }
}

#[derive(Debug, Clone)]
pub struct RenderInput {
    pub tree: DocumentTree,
    pub meta: DocumentMeta,
    pub fragments: usize,
}

#[derive(Debug, Clone)]
pub struct QueryInput {
    pub tree: DocumentTree,
    pub anchor: &'static str,
    pub path: SectionPath,
    pub anchor_query: String,
    pub section_query: String,
    pub fuzzy: &'static str,
}

pub fn parser() -> TreeParser {
    TreeParser::new()
}

pub fn parse_input(fixture: Fixture) -> &'static [u8] {
    fixture.bytes()
}

pub fn build_input(fixture: Fixture) -> LegalDocument {
    fixture.document().clone()
}

pub fn render_input(fixture: Fixture) -> RenderInput {
    let tree = fixture.tree().clone();
    RenderInput {
        fragments: tree.descendants(tree.root()).count(),
        meta: fixture.document().meta.clone(),
        tree,
    }
}

pub fn query_input(case: QueryCase) -> QueryInput {
    QueryInput {
        tree: case.fixture.tree().clone(),
        anchor: case.anchor,
        path: case.path_value(),
        anchor_query: case.anchor_query(),
        section_query: case.section_query(),
        fuzzy: case.fuzzy,
    }
}

pub fn extract_id(tree: &DocumentTree, anchor: &str) -> NodeId {
    tree.find_by_anchor(anchor).unwrap()
}

pub fn resolver(tree: &DocumentTree) -> CrossRefResolver<'_> {
    CrossRefResolver::new(tree)
}

pub fn render_plain(tree: &DocumentTree) -> String {
    let mut out = String::new();
    let mut writer = MarkdownWriter::new(&mut out);
    render::render(tree, tree.root(), &mut writer).unwrap();
    out
}

pub fn render_boe(input: RenderInput) -> String {
    let mut out = String::new();
    let mut writer = MarkdownWriter::with_heading(
        &mut out,
        HeadingMode::Boe { meta: input.meta, fragments: input.fragments },
    );
    render::render(&input.tree, input.tree.root(), &mut writer).unwrap();
    out
}

fn constitution_doc() -> &'static LegalDocument {
    static DOC: OnceLock<LegalDocument> = OnceLock::new();
    DOC.get_or_init(|| parser().parse_bytes_document(Fixture::Constitution1978.bytes()).unwrap())
}

fn consolidated_doc() -> &'static LegalDocument {
    static DOC: OnceLock<LegalDocument> = OnceLock::new();
    DOC.get_or_init(|| parser().parse_bytes_document(Fixture::Consolidated2021.bytes()).unwrap())
}

fn constitution_tree() -> &'static DocumentTree {
    static TREE: OnceLock<DocumentTree> = OnceLock::new();
    TREE.get_or_init(|| parser().build_tree(&constitution_doc().blocks).unwrap())
}

fn consolidated_tree() -> &'static DocumentTree {
    static TREE: OnceLock<DocumentTree> = OnceLock::new();
    TREE.get_or_init(|| parser().build_tree(&consolidated_doc().blocks).unwrap())
}
