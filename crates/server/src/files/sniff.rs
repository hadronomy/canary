use std::str::FromStr;

use infer::Type;
use mime::Mime;

use crate::files::meta::{BlobKind, BlobMedia};

#[must_use]
pub fn detect(declared: Option<Mime>, bytes: &[u8]) -> BlobKind {
    let sniffed = infer::get(bytes).and_then(mime_from_infer);
    let effective = sniffed
        .clone()
        .or_else(|| declared.clone())
        .map(BlobMedia::Known)
        .unwrap_or(BlobMedia::Unknown);

    BlobKind { declared, sniffed, effective }
}

fn mime_from_infer(kind: Type) -> Option<Mime> {
    Mime::from_str(kind.mime_type()).ok()
}
