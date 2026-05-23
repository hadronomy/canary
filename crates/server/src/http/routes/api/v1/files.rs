use std::str::FromStr;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::header::CONTENT_LENGTH;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use axum_extra::response::Attachment;
use axum_typed_multipart::{FieldData, TryFromMultipart, TypedMultipart};
use serde::Deserialize;
use tempfile::NamedTempFile;
use tokio_util::io::ReaderStream;

use crate::error::{AppError, AppResult};
use crate::files::meta::{BlobId, BlobName, BlobRecord};
use crate::http::extract::optional_mime;
use crate::http::response::created;
use crate::pagination::{Page, PageWindow, PaginationError};
use crate::state::{AppState, FileState};

const DEFAULT_LIMIT: usize = 100;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/files", get(list).post(upload_multipart))
        .route("/files/raw", put(upload_raw).layer(DefaultBodyLimit::disable()))
        .route("/files/{id}", get(download))
        .route("/files/{id}/meta", get(meta))
}

#[derive(TryFromMultipart)]
struct UploadForm {
    #[form_data(limit = "unlimited")]
    file: FieldData<NamedTempFile>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<usize>,
    after: Option<String>,
}

async fn list(
    State(state): State<FileState>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Page<BlobRecord, BlobId>>> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).try_into().map_err(invalid_limit)?;
    let after = query.after.as_deref().map(BlobId::from_str).transpose()?;
    let page = state.files.list_page(PageWindow::from_parts(after, limit)).await?;
    Ok(Json(page))
}

async fn meta(
    State(state): State<FileState>,
    Path(id): Path<String>,
) -> AppResult<Json<BlobRecord>> {
    let id = BlobId::from_str(&id)?;
    let meta = state.files.head(id).await?;
    Ok(Json(BlobRecord::from(&meta)))
}

async fn upload_multipart(
    State(state): State<FileState>,
    TypedMultipart(form): TypedMultipart<UploadForm>,
) -> AppResult<(StatusCode, Json<BlobRecord>)> {
    let stored = state.files.put_multipart(form.file).await?;
    Ok(created(BlobRecord::from(&stored)))
}

async fn upload_raw(
    State(state): State<FileState>,
    headers: HeaderMap,
    request: Request,
) -> AppResult<(StatusCode, Json<BlobRecord>)> {
    let declared = optional_mime(&headers);
    let name = headers
        .get(axum::http::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_filename)
        .map(BlobName::new)
        .transpose()?;
    let stored = state.files.put_body(name, declared, request.into_body()).await?;
    Ok(created(BlobRecord::from(&stored)))
}

async fn download(State(state): State<FileState>, Path(id): Path<String>) -> AppResult<Response> {
    let id = BlobId::from_str(&id)?;
    let (meta, file) = state.files.get(id).await?;
    let stream = ReaderStream::with_capacity(file, state.files.chunk_size());
    let body = Body::from_stream(stream);
    let file_name = meta
        .name
        .as_ref()
        .map(|name| name.as_str().to_owned())
        .unwrap_or_else(|| format!("{id}.bin"));
    let response = Attachment::new(body)
        .filename(file_name)
        .content_type(meta.kind.effective.as_str())
        .into_response();
    let mut response = response;
    response.headers_mut().insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&meta.size.get().to_string()).map_err(|source| {
            AppError::internal("invalid_content_length", "failed to encode content length")
                .with_source(source)
        })?,
    );
    Ok(response)
}

fn parse_filename(value: &str) -> Option<String> {
    value
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("filename=").map(trim_quotes))
        .map(str::to_owned)
}

fn trim_quotes(value: &str) -> &str {
    value.trim_matches('"')
}

fn invalid_limit(error: PaginationError) -> AppError {
    AppError::bad_request(error.to_string())
}
