use std::collections::{HashMap, HashSet};

use super::TreeParser;
use super::model::{DocumentMeta, LegalDocument, VersionPolicy, XmlBlock, XmlVersion};
use crate::error::{DocumentError, Result};
use crate::tree::{Anchor, DocumentNode, DocumentTree, DocumentTreeBuilder, HeadingLevel};

/// Anchor uniqueness tracker for generated tree anchors.
#[derive(Debug, Default)]
pub(super) struct Anchors {
    next_suffix: HashMap<Anchor, usize>,
    used: HashSet<Anchor>,
}

impl Anchors {
    /// Produces a deterministic unique anchor with stable suffixing.
    pub(super) fn next(&mut self, title: &str, id: Option<&crate::tree::BlockId>) -> Anchor {
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

pub(super) trait XmlSink {
    type Output;

    fn meta(&mut self, meta: DocumentMeta);

    fn block(&mut self, block: XmlBlock) -> Result<()>;

    fn finish(self) -> Result<Self::Output>;
}

#[derive(Debug, Default)]
pub(super) struct IrSink {
    meta: DocumentMeta,
    blocks: Vec<XmlBlock>,
}

impl XmlSink for IrSink {
    type Output = LegalDocument;

    fn meta(&mut self, meta: DocumentMeta) {
        self.meta = meta;
    }

    fn block(&mut self, block: XmlBlock) -> Result<()> {
        self.blocks.push(block);
        Ok(())
    }

    fn finish(self) -> Result<Self::Output> {
        Ok(LegalDocument { meta: self.meta, blocks: self.blocks })
    }
}

#[derive(Debug)]
pub(super) struct TreeProjector {
    policy: VersionPolicy,
    tree: DocumentTreeBuilder,
    stack: Vec<(u8, crate::NodeId, HeadingLevel)>,
    anchors: Anchors,
}

impl TreeProjector {
    pub(super) fn new(policy: VersionPolicy) -> Self {
        let tree = DocumentTree::builder();
        Self {
            policy,
            stack: vec![(
                0u8,
                tree.root(),
                HeadingLevel::new(1).expect("heading level one is valid"),
            )],
            tree,
            anchors: Anchors::default(),
        }
    }

    fn pick<'a>(&self, versions: &'a [XmlVersion]) -> Option<&'a XmlVersion> {
        if versions.is_empty() {
            return None;
        }
        if self.policy == VersionPolicy::Latest {
            return versions.iter().max_by_key(|it| it.date);
        }
        versions.first()
    }

    pub(super) fn push(&mut self, block: &XmlBlock) -> Result<()> {
        let Some(version) = self.pick(&block.versions) else {
            return Ok(());
        };
        let Some(head) = TreeParser::heading(block, version) else {
            return Ok(());
        };

        let rank = TreeParser::rank(head.kind);
        while self.stack.last().map(|it| it.0 >= rank).unwrap_or(false) {
            self.stack.pop();
        }
        let parent = self.stack.last().map(|it| it.1).unwrap_or(self.tree.root());
        let parent_level = self
            .stack
            .last()
            .map(|it| it.2)
            .unwrap_or_else(|| HeadingLevel::new(1).expect("heading level one is valid"));
        let level = parent_level.child();

        let section =
            DocumentNode::section_with(level, TreeParser::section(head.kind), &head.title)
                .try_with_anchor(self.anchors.next(&head.title, block.id.as_ref()))
                .map_err(DocumentError::from)?;
        let id = self.tree.try_add_child(parent, section)?;
        self.stack.push((rank, id, level));

        if head.start > 0 {
            TreeParser::push_nodes(&mut self.tree, id, &version.nodes[..head.start])?;
        }
        let end = head.start + head.span;
        if end < version.nodes.len() {
            TreeParser::push_nodes(&mut self.tree, id, &version.nodes[end..])?;
        }
        Ok(())
    }

    pub(super) fn finish(self) -> Result<DocumentTree> {
        if self.tree.node_count() == 1 {
            return Err(DocumentError::xml("build: no sections extracted from XML"));
        }
        self.tree.try_freeze().map_err(DocumentError::from)
    }
}

#[derive(Debug)]
pub(super) struct TreeSink {
    projector: TreeProjector,
}

impl TreeSink {
    pub(super) fn new(policy: VersionPolicy) -> Self {
        Self { projector: TreeProjector::new(policy) }
    }
}

impl XmlSink for TreeSink {
    type Output = DocumentTree;

    fn meta(&mut self, _meta: DocumentMeta) {}

    fn block(&mut self, block: XmlBlock) -> Result<()> {
        self.projector.push(&block)
    }

    fn finish(self) -> Result<Self::Output> {
        self.projector.finish()
    }
}
