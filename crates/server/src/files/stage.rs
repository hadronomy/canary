use std::path::Path;

use axum::body::Body;
use axum_typed_multipart::FieldData;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::config::BlobConfig;
use crate::error::FileError;
use crate::files::meta::{BlobHash, BlobId, BlobName, BlobSize, StagedBlob};
use crate::files::sniff::detect;

pub async fn stage_body(
    dir: &Path,
    cfg: &BlobConfig,
    name: Option<BlobName>,
    declared: Option<mime::Mime>,
    body: Body,
) -> Result<StagedBlob, FileError> {
    fs::create_dir_all(dir).await.map_err(|source| FileError::CreateDir { source })?;

    let id = BlobId::new();
    let path = dir.join(format!("{id}.part"));
    let mut out = fs::File::create(&path).await.map_err(|source| FileError::Write { source })?;
    let mut hasher = Sha256::new();
    let mut sniff = Vec::with_capacity(cfg.sniff_bytes);
    let mut size = 0u64;
    let mut stream = body.into_data_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|source| FileError::ReadBody { source: Box::new(source) })?;
        if sniff.len() < cfg.sniff_bytes {
            let take = (cfg.sniff_bytes - sniff.len()).min(chunk.len());
            sniff.extend_from_slice(&chunk[..take]);
        }
        size += chunk.len() as u64;
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|source| FileError::Write { source })?;
    }

    out.flush().await.map_err(|source| FileError::Write { source })?;

    Ok(StagedBlob {
        id,
        name,
        size: BlobSize::new(size),
        hash: BlobHash::new(hasher.finalize().into()),
        kind: detect(declared, &sniff),
        path,
    })
}

pub async fn stage_multipart(
    dir: &Path,
    cfg: &BlobConfig,
    field: FieldData<NamedTempFile>,
) -> Result<StagedBlob, FileError> {
    fs::create_dir_all(dir).await.map_err(|source| FileError::CreateDir { source })?;

    let id = BlobId::new();
    let name = field.metadata.file_name.map(BlobName::new).transpose()?;
    let declared = field.metadata.content_type.and_then(|value| value.parse::<mime::Mime>().ok());
    let src = field.contents.into_temp_path();
    let path = dir.join(format!("{id}.part"));
    src.persist(&path).map_err(|source| FileError::Persist { source: source.error })?;
    let data = fs::read(&path).await.map_err(|source| FileError::ReadFile { source })?;
    let sniff_len = cfg.sniff_bytes.min(data.len());
    let mut hasher = Sha256::new();
    hasher.update(&data);

    Ok(StagedBlob {
        id,
        name,
        size: BlobSize::new(data.len() as u64),
        hash: BlobHash::new(hasher.finalize().into()),
        kind: detect(declared, &data[..sniff_len]),
        path,
    })
}
