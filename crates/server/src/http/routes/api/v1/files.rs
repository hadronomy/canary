use std::convert::Infallible;
use std::str::FromStr;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRef, Path, Request, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use axum_extra::response::Attachment;
use futures_util::stream::{self, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use tower_http::limit::RequestBodyLimitLayer;

use crate::Pagination;
use crate::error::{AppError, AppResult};
use crate::files::meta::{BlobHash, BlobId, BlobName, BlobRecord};
use crate::files::service::CreatedIntent;
use crate::files::upload::{
    CompleteInput, CompletedUploadPart, PartRequest, SignedUploadPart, UploadAccess,
    UploadEventKind, UploadHeader, UploadMode, UploadSession, UploadState,
};
use crate::http::extract::UploadActor;
use crate::http::response::created;
use crate::pagination::{Limit, Page, PagePolicy, PagePolicySource};
use crate::state::{AppState, FileState};

pub fn router(state: &AppState) -> Router<AppState> {
    let raw_limit = cap(state.loaded_config().settings.files.uploads.max_bytes);
    Router::new()
        .route("/files", get(list))
        .route("/files/uploads", post(create_upload))
        .route("/files/uploads/{id}", get(upload_status))
        .route("/files/uploads/{id}/access", post(refresh_access))
        .route("/files/uploads/{id}/parts", post(upload_parts))
        .route("/files/uploads/{id}/ws", get(upload_socket))
        .route(
            "/files/uploads/{id}/content",
            put(upload_content).layer(RequestBodyLimitLayer::new(raw_limit)),
        )
        .route("/files/uploads/{id}/events", get(upload_events))
        .route("/files/uploads/{id}/complete", post(complete_upload))
        .route("/files/uploads/{id}/abort", post(abort_upload))
        .route("/files/{id}", get(download))
        .route("/files/{id}/meta", get(meta))
}

#[derive(Deserialize)]
struct CreateUploadBody {
    name: Option<String>,
    content_type: Option<String>,
    size_bytes: u64,
    sha256: Option<String>,
    purpose: Option<String>,
}

#[derive(Deserialize, Default)]
struct CompleteUploadBody {
    etag: Option<String>,
    sha256: Option<String>,
    #[serde(default)]
    parts: Vec<CompletedUploadPart>,
}

#[derive(Serialize)]
struct CreatedUpload {
    id: String,
    status: UploadState,
    expires_at: chrono::DateTime<chrono::Utc>,
    upload: UploadTarget,
}

#[derive(Serialize)]
struct SignedUploadParts {
    parts: Vec<SignedUploadPart>,
}

#[derive(Serialize)]
struct UploadRecord {
    id: String,
    status: UploadState,
    strategy: UploadMode,
    purpose: String,
    size_bytes: u64,
    uploaded_parts: Vec<u16>,
    expires_at: chrono::DateTime<chrono::Utc>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    blob: Option<BlobRecord>,
}

#[derive(Serialize)]
struct UploadEvent {
    event: &'static str,
    upload: UploadRecord,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum UploadTarget {
    ProxyPut {
        method: &'static str,
        url: String,
        max_bytes: u64,
    },
    DirectPut {
        method: &'static str,
        url: String,
        headers: Vec<UploadHeader>,
    },
    DirectMultipart {
        part_size_bytes: u64,
        max_parts: u16,
        parts_url: String,
        complete_url: String,
        abort_url: String,
    },
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
    Ok(Json(req.page().await?))
}

async fn meta(
    State(state): State<FileState>,
    Path(id): Path<String>,
) -> AppResult<Json<BlobRecord>> {
    let id = BlobId::from_str(&id)?;
    let meta = state.files.blobs().head(id).await?;
    Ok(Json(BlobRecord::from(&meta)))
}

async fn create_upload(
    State(state): State<AppState>,
    actor: UploadActor,
    Json(body): Json<CreateUploadBody>,
) -> AppResult<(StatusCode, Json<CreatedUpload>)> {
    let files = FileState::from_ref(&state);
    let intent = files
        .files
        .uploads()
        .create_intent(crate::files::upload::UploadDraft {
            actor: actor.into_inner(),
            purpose: body
                .purpose
                .map(crate::files::upload::UploadPurpose::new)
                .transpose()?
                .unwrap_or_else(crate::files::upload::UploadPurpose::attachment),
            name: body.name.map(BlobName::new).transpose()?,
            declared_type: parse_mime(body.content_type)?,
            declared_size: crate::files::meta::BlobSize::new(body.size_bytes),
            declared_hash: body.sha256.as_deref().map(BlobHash::from_hex).transpose()?,
        })
        .await?;
    Ok(created(upload(intent)))
}

async fn upload_status(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Json<UploadRecord>> {
    let id = BlobId::from_str(&id)?;
    let session = state.files.uploads().get(actor.as_ref(), id).await?;
    Ok(Json(record(&session)))
}

async fn refresh_access(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Json<UploadTarget>> {
    let id = BlobId::from_str(&id)?;
    let access = state.files.uploads().refresh_access(actor.as_ref(), id).await?;
    Ok(Json(target(id, access)))
}

async fn upload_events(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let id = BlobId::from_str(&id)?;
    let (current, rx) = state.files.uploads().subscribe(actor.as_ref(), id).await?;
    let first = stream::once(async move {
        Ok::<_, Infallible>(encode(UploadEventKind::Snapshot, record(&current)))
    });
    let rest = stream::unfold(rx, |mut rx| async move {
        match rx.changed().await {
            Ok(()) => {
                let notice = rx.borrow().clone();
                Some((Ok::<_, Infallible>(encode(notice.kind, record(&notice.session))), rx))
            }
            Err(_) => None,
        }
    });
    Ok(Sse::new(first.chain(rest)).keep_alive(KeepAlive::default()))
}

async fn upload_socket(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> AppResult<Response> {
    let id = BlobId::from_str(&id)?;
    let (current, rx) = state.files.uploads().subscribe(actor.as_ref(), id).await?;
    Ok(ws.on_upgrade(move |socket| stream_socket(socket, current, rx)).into_response())
}

async fn upload_content(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    request: Request,
) -> AppResult<(StatusCode, Json<UploadRecord>)> {
    let id = BlobId::from_str(&id)?;
    let session = state.files.uploads().put_body(actor.as_ref(), id, request.into_body()).await?;
    Ok((StatusCode::ACCEPTED, Json(record(&session))))
}

async fn upload_parts(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    Json(body): Json<PartRequest>,
) -> AppResult<Json<SignedUploadParts>> {
    let id = BlobId::from_str(&id)?;
    let parts = state.files.uploads().sign_parts(actor.as_ref(), id, body).await?;
    Ok(Json(SignedUploadParts { parts }))
}

async fn complete_upload(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    Json(body): Json<CompleteUploadBody>,
) -> AppResult<Json<BlobRecord>> {
    let id = BlobId::from_str(&id)?;
    let blob = state
        .files
        .uploads()
        .complete(
            actor.as_ref(),
            id,
            CompleteInput {
                etag: body.etag,
                hash: body.sha256.as_deref().map(BlobHash::from_hex).transpose()?,
                parts: body.parts,
            },
        )
        .await?;
    Ok(Json(BlobRecord::from(&blob)))
}

async fn abort_upload(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<(StatusCode, Json<UploadRecord>)> {
    let id = BlobId::from_str(&id)?;
    let session = state.files.uploads().abort(actor.as_ref(), id).await?;
    Ok((StatusCode::ACCEPTED, Json(record(&session))))
}

async fn download(State(state): State<FileState>, Path(id): Path<String>) -> AppResult<Response> {
    let id = BlobId::from_str(&id)?;
    let (meta, body) = state.files.blobs().get(id).await?;
    let body = Body::from_stream(body);
    let file_name = meta
        .name
        .as_ref()
        .map(|name| name.as_str().to_owned())
        .unwrap_or_else(|| format!("{id}.bin"));
    let response = Attachment::new(body)
        .filename(file_name)
        .content_type(meta.kind.effective.as_str())
        .into_response();
    Ok(with_length(response, meta.size.get()))
}

fn upload(created: CreatedIntent) -> CreatedUpload {
    CreatedUpload {
        id: created.session.id().to_string(),
        status: created.session.state(),
        expires_at: created.session.expires_at(),
        upload: target(created.session.id(), created.access),
    }
}

fn record(session: &UploadSession) -> UploadRecord {
    UploadRecord {
        id: session.id().to_string(),
        status: session.state(),
        strategy: session.mode(),
        purpose: session.purpose().as_str().to_owned(),
        size_bytes: session.size_bytes(),
        uploaded_parts: session.uploaded_parts().into_iter().map(|part| part.get()).collect(),
        expires_at: session.expires_at(),
        completed_at: session.completed_at(),
        blob: session.actual().map(BlobRecord::from),
    }
}

fn target(id: BlobId, access: UploadAccess) -> UploadTarget {
    match access {
        UploadAccess::Proxy(access) => UploadTarget::ProxyPut {
            method: "PUT",
            url: content_url(id),
            max_bytes: access.max_bytes,
        },
        UploadAccess::DirectPut(access) => {
            UploadTarget::DirectPut { method: "PUT", url: access.url, headers: access.headers }
        }
        UploadAccess::Multipart(access) => UploadTarget::DirectMultipart {
            part_size_bytes: access.part_size_bytes,
            max_parts: access.max_parts,
            parts_url: parts_url(id),
            complete_url: complete_url(id),
            abort_url: abort_url(id),
        },
    }
}

fn content_url(id: BlobId) -> String {
    format!("/api/v1/files/uploads/{id}/content")
}

fn parts_url(id: BlobId) -> String {
    format!("/api/v1/files/uploads/{id}/parts")
}

fn complete_url(id: BlobId) -> String {
    format!("/api/v1/files/uploads/{id}/complete")
}

fn abort_url(id: BlobId) -> String {
    format!("/api/v1/files/uploads/{id}/abort")
}

fn encode(kind: UploadEventKind, record: UploadRecord) -> Event {
    Event::default()
        .event(kind.as_str())
        .json_data(event(kind, record))
        .expect("upload event should serialize")
}

fn event(kind: UploadEventKind, record: UploadRecord) -> UploadEvent {
    UploadEvent { event: kind.as_str(), upload: record }
}

async fn stream_socket(
    mut socket: WebSocket,
    current: UploadSession,
    mut rx: tokio::sync::watch::Receiver<crate::files::upload::UploadNotice>,
) {
    if send_socket(&mut socket, UploadEventKind::Snapshot, record(&current)).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            changed = rx.changed() => {
                if changed.is_err() {
                    return;
                }
                let notice = rx.borrow().clone();
                if send_socket(&mut socket, notice.kind, record(&notice.session)).await.is_err() {
                    return;
                }
            }
            frame = socket.recv() => {
                match frame {
                    Some(Ok(Message::Ping(body))) => {
                        let pong = Message::Pong(body);
                        if socket.send(pong).await.is_err() {
                            return;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                    _ => {}
                }
            }
        }
    }
}

async fn send_socket(
    socket: &mut WebSocket,
    kind: UploadEventKind,
    record: UploadRecord,
) -> Result<(), axum::Error> {
    let body = serde_json::to_string(&event(kind, record)).expect("upload event should serialize");
    socket.send(Message::Text(body.into())).await
}

fn cap(limit: u64) -> usize {
    limit.min(usize::MAX as u64) as usize
}

fn parse_mime(value: Option<String>) -> Result<Option<mime::Mime>, AppError> {
    match value {
        Some(value) => value.parse::<mime::Mime>().map(Some).map_err(|_| {
            AppError::validation_code("invalid_file_type", "The declared content type is invalid.")
        }),
        None => Ok(None),
    }
}

fn with_length(mut response: Response, len: u64) -> Response {
    let header = HeaderValue::from_str(&len.to_string()).expect("content length should be valid");
    response.headers_mut().insert(axum::http::header::CONTENT_LENGTH, header);
    response
}
