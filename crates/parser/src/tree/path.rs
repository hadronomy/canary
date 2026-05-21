use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use smallvec::SmallVec;

use super::{Anchor, HeadingLevel, SectionIndex};
use crate::NodeId;
use crate::error::{DocumentError, Result};

/// A typed section path such as `1.2.3`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct SectionPath(SmallVec<[SectionIndex; 6]>);

impl SectionPath {
    #[must_use]
    pub fn root() -> Self {
        Self(SmallVec::new())
    }

    #[must_use]
    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    #[must_use]
    pub fn depth(&self) -> usize {
        self.0.len()
    }

    #[must_use]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = SectionIndex> + Clone + '_ {
        self.0.iter().copied()
    }

    #[must_use]
    pub fn segments(&self) -> impl ExactSizeIterator<Item = usize> + Clone + '_ {
        self.iter().map(SectionIndex::get)
    }

    #[must_use]
    pub fn parent(&self) -> Option<Self> {
        (!self.is_root()).then(|| Self(self.0[..self.0.len() - 1].iter().copied().collect()))
    }

    #[must_use]
    pub fn join(&self, part: SectionIndex) -> Self {
        let mut out = self.0.clone();
        out.push(part);
        Self(out)
    }

    pub(super) fn from_parts(parts: &[SectionIndex]) -> Self {
        Self(parts.iter().copied().collect())
    }

    #[must_use]
    pub fn is_descendant_or_self_of(&self, other: &Self) -> bool {
        self.0.starts_with(&other.0)
    }

    #[must_use]
    pub fn is_descendant_of(&self, other: &Self) -> bool {
        self.depth() > other.depth() && self.is_descendant_or_self_of(other)
    }
}

impl fmt::Display for SectionPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_root() {
            return f.write_str("root");
        }
        for (idx, part) in self.0.iter().enumerate() {
            if idx > 0 {
                f.write_str(".")?;
            }
            write!(f, "{part}")?;
        }
        Ok(())
    }
}

impl FromStr for SectionPath {
    type Err = DocumentError;

    fn from_str(path: &str) -> Result<Self> {
        if path == "root" {
            return Ok(Self::root());
        }
        if path.is_empty() {
            return Err(DocumentError::InvalidPath {
                path: path.to_string(),
                reason: "path is empty".to_string(),
            });
        }

        let mut out = SmallVec::<[SectionIndex; 6]>::new();
        for part in path.split('.') {
            let value = part.parse::<u16>().map_err(|_| DocumentError::InvalidPath {
                path: path.to_string(),
                reason: format!("`{part}` is not a number"),
            })?;
            let idx = SectionIndex::new(value).ok_or_else(|| DocumentError::InvalidPath {
                path: path.to_string(),
                reason: "path indices are 1-based".to_string(),
            })?;
            out.push(idx);
        }
        Ok(Self(out))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionEntry {
    pub id: NodeId,
    pub anchor: Anchor,
    pub path: SectionPath,
    pub level: HeadingLevel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SectionMeta {
    pub(super) path: SectionPath,
}
