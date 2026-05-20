use parser_macros::document_nodes;

#[derive(Debug, PartialEq, Eq)]
struct Section;
#[derive(Debug, PartialEq, Eq)]
struct Text;

#[document_nodes]
enum DocumentNode {
    #[tag]
    Root,
    #[tag]
    Section(Section),
    #[atom]
    Text(Text),
}

impl Section {
    fn as_tag(&self) -> Tag<'_> {
        Tag::Section(self)
    }
}

impl Text {
    fn as_atom(&self) -> Atom<'_> {
        Atom::Text(self)
    }
}

fn main() {
    let node = DocumentNode::Section(Section);
    let text = DocumentNode::Text(Text);
    assert!(matches!(node.kind(), NodeKind::Section));
    assert!(matches!(text.view(), NodeView::Atom(Atom::Text(_))));
}
