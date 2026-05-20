use std::fmt;

use crate::tree::{Atom, Tag, TagEnd};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderEvent<'a> {
    Start(Tag<'a>),
    End(TagEnd),
    Atom(Atom<'a>),
}

pub trait TreeWriter {
    type Error: From<fmt::Error>;

    fn event(&mut self, ev: RenderEvent<'_>) -> Result<(), Self::Error>;

    fn with<R>(
        &mut self,
        tag: Tag<'_>,
        f: impl FnOnce(&mut Self) -> Result<R, Self::Error>,
    ) -> Result<R, Self::Error>
    where
        Self: Sized,
    {
        self.event(RenderEvent::Start(tag))?;
        let out = f(self)?;
        self.event(RenderEvent::End(tag.end()))?;
        Ok(out)
    }
}
