use super::{NodeRef, Visit};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisitFlow {
    Continue,
    SkipChildren,
    Break,
}

pub fn visit_children<V: Visit + ?Sized>(
    v: &mut V,
    node: NodeRef<'_>,
) -> std::result::Result<VisitFlow, V::Error> {
    for child in node.children() {
        if matches!(v.visit_node(child)?, VisitFlow::Break) {
            return Ok(VisitFlow::Break);
        }
    }
    Ok(VisitFlow::Continue)
}
