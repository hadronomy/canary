use std::str::FromStr;

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::header::CONTENT_LENGTH;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use axum_extra::response::Attachment;
use axum_typed_multipart::{FieldData, TryFromMultipart};
use tempfile::NamedTempFile;
use tokio_util::io::ReaderStream;

use crate::error::{AppError, AppResult};
use crate::files::meta::{BlobId, BlobName, BlobRecord};
use crate::http::extract::{MultipartForm, Pagination, optional_mime};
use crate::http::response::created;
use crate::pagination::{Limit, Page, PagePolicy, PagePolicySource};
use crate::state::{AppState, FileState};

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

type FilePage = Pagination<BlobId, FilesPagePolicy>;

struct FilesPagePolicy;

impl PagePolicySource<AppState> for FilesPagePolicy {
    fn policy(_state: &AppState) -> PagePolicy {
        PagePolicy::bounded(
            Limit::new(100).expect("file page default is valid"),
            Limit::new(1_000).expect("file page max is valid"),
        )
        .expect("file page policy is valid")
    }
}

async fn list(
    State(state): State<FileState>,
    page: FilePage,
) -> AppResult<Json<Page<BlobRecord, BlobId>>> {
    let req = state.files.list(page.limit()).after_opt(page.after().copied());
    let page = req.page().await?;
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
    form: MultipartForm<UploadForm>,
) -> AppResult<(StatusCode, Json<BlobRecord>)> {
    let stored = state.files.put_multipart(form.data.file).await?;
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
