use std::fmt;

use super::*;
use crate::TreeMutationError;
use crate::error::AnchorError;

fn lvl(value: u8) -> HeadingLevel {
    HeadingLevel::new(value).expect("test heading level must be valid")
}

fn build(f: impl FnOnce(&mut DocumentTreeBuilder)) -> DocumentTree {
    let mut tree = DocumentTree::builder();
    f(&mut tree);
    tree.freeze()
}

#[test]
fn slugify() {
    assert_eq!(DocumentNode::slugify("Hello World"), "hello-world");
    assert_eq!(DocumentNode::slugify("Section 1.2.3"), "section-1-2-3");
    assert_eq!(DocumentNode::slugify("  Trim  Me  "), "trim-me");
    assert_eq!(DocumentNode::slugify("UPPERCASE"), "uppercase");
    assert_eq!(DocumentNode::slugify("TÍTULO PRELIMINAR"), "título-preliminar");
    assert_eq!(DocumentNode::slugify_ascii("TÍTULO PRELIMINAR"), "titulo-preliminar");
}

#[test]
fn section_creation() {
    let sec = DocumentNode::section(lvl(2), "Getting Started");
    assert!(sec.is_section());
    assert_eq!(sec.section_level(), Some(lvl(2)));
    assert_eq!(sec.anchor(), Some("getting-started"));
    assert_eq!(sec.section_title(), Some("Getting Started"));
}

#[test]
fn tree_construction() {
    let tree = build(|tree| {
        let root = tree.root();
        let _ = tree.add_child(root, DocumentNode::section(lvl(1), "Introduction"));
        let sec2 = tree.add_child(root, DocumentNode::section(lvl(1), "Methods"));
        let _ = tree.add_child(sec2, DocumentNode::section(lvl(2), "Participants"));
    });

    let sections = tree.sections().collect::<Vec<_>>();
    assert_eq!(sections[0].path.to_string(), "1");
    assert_eq!(sections[1].path.to_string(), "2");
    assert_eq!(sections[2].path.to_string(), "2.1");
}

#[test]
fn anchor_lookup() {
    let tree = build(|tree| {
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Introduction"));
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Results"));
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "TÍTULO PRELIMINAR"));
    });

    assert!(tree.find_by_anchor("introduction").is_some());
    assert!(tree.find_by_anchor("results").is_some());
    assert!(tree.find_by_anchor("título-preliminar").is_some());
    assert!(tree.find_by_anchor("titulo-preliminar").is_some());
    assert!(tree.find_by_anchor("nonexistent").is_none());
}

#[test]
fn path_navigation() {
    let tree = build(|tree| {
        let sec1 = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
        let _ = tree.add_child(sec1, DocumentNode::section(lvl(2), "B"));
    });
    let sec1 = tree.find_by_anchor("a").unwrap();
    let sec2 = tree.find_by_anchor("b").unwrap();
    let path1 = tree.path(sec1);
    let path2 = tree.path(sec2);

    assert_eq!(tree.find_by_path(&path1).unwrap(), sec1);
    assert_eq!(tree.find_by_path(&path2).unwrap(), sec2);
    assert!(path2.is_descendant_of(&path1));
    assert!(!path1.is_descendant_of(&path2));
    assert_eq!(path2.parent().unwrap(), path1);

    let err = tree.find_by_path(&"1.2".parse().unwrap()).unwrap_err();
    assert!(err.to_string().contains("out of bounds"));

    let err = "invalid".parse::<SectionPath>().unwrap_err();
    assert!(err.to_string().contains("not a number"));
}

#[test]
fn parent_section() {
    let tree = build(|tree| {
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Parent"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        let _ = tree.add_child(para, DocumentNode::text("text"));
    });
    let sec = tree.find_by_anchor("parent").unwrap();
    let text = tree.descendants(sec).find(|node| node.display_text() == Some("text")).unwrap();

    assert_eq!(tree.parent_section(text.id()).map(NodeRef::id), Some(sec));
    assert!(tree.parent_section(sec).is_none());
}

#[test]
fn text_extraction_respects_options() {
    let tree = build(|tree| {
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Parent"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("body"));
        tree.add_child(sec, DocumentNode::image("image.png", "caption"));
        tree.add_child(sec, DocumentNode::html("<b>raw</b>"));
    });
    let sec = tree.find_by_anchor("parent").unwrap();
    let text = tree.extract_text_with(
        sec,
        TextExtractOptions {
            include_section_titles: false,
            include_image_alt: false,
            include_code_blocks: true,
            include_html: false,
            separator: SeparatorPolicy::Space,
        },
    );
    let spans = tree
        .text_spans_with(
            sec,
            TextExtractOptions {
                include_section_titles: false,
                include_image_alt: true,
                include_code_blocks: true,
                include_html: false,
                separator: SeparatorPolicy::Newline,
            },
        )
        .collect::<Vec<_>>();

    assert_eq!(text, "body");
    assert_eq!(
        spans,
        vec![
            TextSpan { kind: TextSpanKind::Text, text: "body" },
            TextSpan { kind: TextSpanKind::ImageAlt, text: "caption" },
        ]
    );
}

#[test]
fn sections_are_preordered() {
    let tree = build(|tree| {
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "First"));
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Second"));
        tree.add_child(sec, DocumentNode::section(lvl(2), "Nested"));
    });

    let sections = tree.sections().collect::<Vec<_>>();
    assert_eq!(sections.len(), 3);
    assert_eq!(sections[0].anchor.as_str(), "first");
    assert_eq!(sections[1].anchor.as_str(), "second");
    assert_eq!(sections[2].anchor.as_str(), "nested");
    assert_eq!(sections[2].path.to_string(), "2.1");
}

#[test]
fn path_ignores_non_section_siblings() {
    let tree = build(|tree| {
        let a = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
        let para = tree.add_child(a, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("x"));
        tree.add_child(a, DocumentNode::html("<table><tr><td>x</td></tr></table>"));
        tree.add_child(a, DocumentNode::section(lvl(2), "B"));
    });
    let b = tree.find_by_anchor("b").unwrap();

    assert_eq!(tree.path(b).to_string(), "1.1");
    assert_eq!(tree.find_by_path(&"1.1".parse().unwrap()).unwrap(), b);
}

#[test]
fn update_keeps_anchor_index_in_sync() {
    let mut tree = DocumentTree::builder();
    let id = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Old"));

    let _ = tree.update(id, |node| {
        *node = DocumentNode::section(lvl(1), "New");
    });

    let tree = tree.freeze();
    assert!(tree.find_by_anchor("old").is_none());
    assert_eq!(tree.find_by_anchor("new"), Some(id));
}

#[test]
fn set_anchor_rejects_unanchorable_nodes() {
    let mut tree = DocumentTree::builder();
    let id = tree.add_child(tree.root(), DocumentNode::paragraph());
    let err = tree.set_anchor(id, Some(Anchor::from("x"))).unwrap_err();
    assert!(matches!(err, TreeMutationError::NotAnchorable { .. }));
}

#[test]
fn set_anchor_rejects_removing_section_anchor() {
    let mut tree = DocumentTree::builder();
    let id = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
    let err = tree.set_anchor(id, None).unwrap_err();
    assert!(matches!(err, TreeMutationError::RequiredAnchor { .. }));
}

#[test]
fn try_with_anchor_rejects_non_anchorable_nodes() {
    let err = DocumentNode::paragraph().try_with_anchor("intro").unwrap_err();
    assert!(matches!(err, AnchorError::NotAnchorable { kind: NodeKind::Paragraph }));
}

#[test]
fn duplicate_anchor_lookup_keeps_remaining_nodes_reachable() {
    let mut tree = DocumentTree::builder();
    let first = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Same"));
    let second = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Same"));

    tree.update(first, |node| {
        *node = DocumentNode::section(lvl(1), "Other");
    })
    .unwrap();

    let tree = tree.freeze();
    assert_eq!(tree.find_by_anchor("same"), Some(second));
    assert_eq!(tree.find_all_by_anchor("same").collect::<Vec<_>>(), vec![second]);
}

#[test]
fn duplicate_alias_lookup_returns_all_matches() {
    let tree = build(|tree| {
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Artículo"));
        tree.add_child(tree.root(), DocumentNode::section(lvl(1), "Articulo"));
    });

    let ids = tree.find_all_by_anchor("articulo").collect::<Vec<_>>();
    assert_eq!(ids.len(), 2);
    assert_eq!(tree.find_by_anchor("articulo"), Some(ids[0]));
}

#[test]
fn reference_index_tracks_anchor_links() {
    let mut tree = DocumentTree::builder();
    let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
    let para = tree.add_child(sec, DocumentNode::paragraph());
    let link = tree.add_child(para, DocumentNode::link_anchor("a", None));
    tree.add_child(link, DocumentNode::text("ref"));

    let _ = tree.update(link, |node| {
        *node = DocumentNode::link_anchor("b", None);
    });

    let tree = tree.freeze();
    assert!(tree.find_references_to("a").is_empty());
    assert_eq!(tree.find_references_to("b"), vec![link]);
}

#[test]
fn visitor_reports_structural_events() {
    struct Probe(Vec<String>);

    impl Visit for Probe {
        type Error = fmt::Error;

        fn enter_tag(
            &mut self,
            _node: NodeRef<'_>,
            tag: Tag<'_>,
        ) -> std::result::Result<VisitFlow, Self::Error> {
            self.0.push(format!("enter:{:?}", tag.kind()));
            Ok(VisitFlow::Continue)
        }

        fn leave_tag(
            &mut self,
            _node: NodeRef<'_>,
            tag: TagEnd,
        ) -> std::result::Result<VisitFlow, Self::Error> {
            self.0.push(format!("exit:{:?}", tag.kind()));
            Ok(VisitFlow::Continue)
        }

        fn visit_atom(
            &mut self,
            _node: NodeRef<'_>,
            atom: Atom<'_>,
        ) -> std::result::Result<VisitFlow, Self::Error> {
            self.0.push(format!("atom:{:?}", atom.kind()));
            Ok(VisitFlow::Continue)
        }
    }

    let tree = build(|tree| {
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("x"));
    });

    let mut probe = Probe(Vec::new());
    tree.visit(tree.root(), &mut probe).unwrap();

    assert_eq!(
        probe.0,
        vec![
            "enter:Root".to_string(),
            "enter:Section".to_string(),
            "enter:Paragraph".to_string(),
            "atom:Text".to_string(),
            "exit:Paragraph".to_string(),
            "exit:Section".to_string(),
            "exit:Root".to_string(),
        ]
    );
}

#[test]
fn visitor_can_skip_children() {
    struct Probe(Vec<String>);

    impl Visit for Probe {
        type Error = fmt::Error;

        fn enter_tag(
            &mut self,
            _node: NodeRef<'_>,
            tag: Tag<'_>,
        ) -> std::result::Result<VisitFlow, Self::Error> {
            self.0.push(format!("enter:{:?}", tag.kind()));
            Ok(match tag {
                Tag::Section { .. } => VisitFlow::SkipChildren,
                _ => VisitFlow::Continue,
            })
        }
    }

    let tree = build(|tree| {
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(1), "A"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("x"));
    });

    let mut probe = Probe(Vec::new());
    tree.visit(tree.root(), &mut probe).unwrap();

    assert_eq!(probe.0, vec!["enter:Root".to_string(), "enter:Section".to_string()]);
}
