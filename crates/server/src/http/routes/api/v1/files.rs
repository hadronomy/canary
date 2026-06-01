use std::convert::Infallible;
use std::str::FromStr;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, Stream, StreamExt};
use public_id::PublicId;
use serde::{Deserialize, Serialize};

use crate::Pagination;
use crate::error::{AppError, AppResult};
use crate::files::id::{FileId, UploadId};
use crate::files::meta::{BlobName, BlobRecord, BlobSize, Sha256Digest};
use crate::files::service::CreatedIntent;
use crate::files::upload::{
    CompleteInput, CompletedUploadPart, PartRequest, SignedUploadPart, UploadAccess,
    UploadChecksum, UploadDraft, UploadEventKind, UploadHeader, UploadMode, UploadNotice,
    UploadPurpose, UploadSession, UploadState,
};
use crate::http::extract::UploadActor;
use crate::http::response::created;
use crate::pagination::{Limit, Page, PagePolicy, PagePolicySource};
use crate::state::{AppState, FileState};

pub fn router(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/files", get(list))
        .route("/files/uploads", post(create_upload))
        .route("/files/uploads/{id}", get(upload_status))
        .route("/files/uploads/{id}/access", post(refresh_access))
        .route("/files/uploads/{id}/parts", post(upload_parts))
        .route("/files/uploads/{id}/ws", get(upload_socket))
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
    checksum: Option<String>,
    #[serde(default)]
    parts: Vec<CompletedUploadPart>,
}

#[derive(Serialize)]
struct CreatedUpload {
    id: PublicId<UploadId>,
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
    id: PublicId<UploadId>,
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
    DirectPut {
        method: &'static str,
        url: String,
        headers: Vec<UploadHeader>,
        checksum: UploadChecksum,
    },
    DirectMultipart {
        part_size_bytes: u64,
        max_parts: u16,
        checksum: UploadChecksum,
        parts_url: String,
        complete_url: String,
        abort_url: String,
    },
}

type FilePage = Pagination<FileId, FilesPagePolicy, PublicId<FileId>>;

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
) -> AppResult<Json<Page<BlobRecord, PublicId<FileId>>>> {
    let page = state.files.list(page.limit()).after_opt(page.after().copied()).page().await?;
    Ok(Json(Page::new(page.items, page.next.map(PublicId::from))))
}

async fn meta(
    State(state): State<FileState>,
    Path(id): Path<String>,
) -> AppResult<Json<BlobRecord>> {
    let id = file(&id)?;
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
        .create_intent(UploadDraft {
            actor: actor.into_inner(),
            purpose: body
                .purpose
                .map(UploadPurpose::new)
                .transpose()?
                .unwrap_or_else(UploadPurpose::attachment),
            name: body.name.map(BlobName::new).transpose()?,
            declared_type: parse_mime(body.content_type)?,
            declared_size: BlobSize::new(body.size_bytes),
            sha256: body.sha256.as_deref().map(Sha256Digest::from_hex).transpose()?,
        })
        .await?;
    Ok(created(upload(intent)))
}

async fn upload_status(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Json<UploadRecord>> {
    let id = upl(&id)?;
    let session = state.files.uploads().get(actor.as_ref(), id).await?;
    Ok(Json(record(&session)))
}

async fn refresh_access(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Json<UploadTarget>> {
    let id = upl(&id)?;
    let access = state.files.uploads().refresh_access(actor.as_ref(), id).await?;
    Ok(Json(target(id, access)))
}

async fn upload_events(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let id = upl(&id)?;
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
    let id = upl(&id)?;
    let (current, rx) = state.files.uploads().subscribe(actor.as_ref(), id).await?;
    Ok(ws.on_upgrade(move |socket| stream_socket(socket, current, rx)).into_response())
}

async fn upload_parts(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    Json(body): Json<PartRequest>,
) -> AppResult<Json<SignedUploadParts>> {
    let id = upl(&id)?;
    let parts = state.files.uploads().sign_parts(actor.as_ref(), id, body).await?;
    Ok(Json(SignedUploadParts { parts }))
}

async fn complete_upload(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
    Json(body): Json<CompleteUploadBody>,
) -> AppResult<Json<BlobRecord>> {
    let id = upl(&id)?;
    let blob = state
        .files
        .uploads()
        .complete(
            actor.as_ref(),
            id,
            CompleteInput { etag: body.etag, checksum: body.checksum, parts: body.parts },
        )
        .await?;
    Ok(Json(BlobRecord::from(&blob)))
}

async fn abort_upload(
    State(state): State<FileState>,
    actor: UploadActor,
    Path(id): Path<String>,
) -> AppResult<(StatusCode, Json<UploadRecord>)> {
    let id = upl(&id)?;
    let session = state.files.uploads().abort(actor.as_ref(), id).await?;
    Ok((StatusCode::ACCEPTED, Json(record(&session))))
}

async fn download(State(state): State<FileState>, Path(id): Path<String>) -> AppResult<Redirect> {
    let id = file(&id)?;
    let access = state.files.blobs().access(id).await?;
    Ok(Redirect::temporary(&access.url))
}

fn upload(created: CreatedIntent) -> CreatedUpload {
    CreatedUpload {
        id: created.session.id().public(),
        status: created.session.state(),
        expires_at: created.session.expires_at(),
        upload: target(created.session.id(), created.access),
    }
}

fn record(session: &UploadSession) -> UploadRecord {
    UploadRecord {
        id: session.id().public(),
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

fn target(id: UploadId, access: UploadAccess) -> UploadTarget {
    match access {
        UploadAccess::DirectPut(access) => UploadTarget::DirectPut {
            method: "PUT",
            url: access.url,
            headers: access.headers,
            checksum: access.checksum,
        },
        UploadAccess::Multipart(access) => UploadTarget::DirectMultipart {
            part_size_bytes: access.part_size_bytes,
            max_parts: access.max_parts,
            checksum: access.checksum,
            parts_url: parts_url(id),
            complete_url: complete_url(id),
            abort_url: abort_url(id),
        },
    }
}

#[inline(always)]
fn parts_url(id: UploadId) -> String {
    format!("/api/v1/files/uploads/{id}/parts")
}

#[inline(always)]
fn complete_url(id: UploadId) -> String {
    format!("/api/v1/files/uploads/{id}/complete")
}

#[inline(always)]
fn abort_url(id: UploadId) -> String {
    format!("/api/v1/files/uploads/{id}/abort")
}

#[inline(always)]
fn file(id: &str) -> AppResult<FileId> {
    FileId::from_str(id).map_err(|_| AppError::from(crate::error::FileError::InvalidFileId))
}

#[inline(always)]
fn upl(id: &str) -> AppResult<UploadId> {
    UploadId::from_str(id).map_err(|_| AppError::from(crate::error::FileError::InvalidUploadId))
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
    mut rx: tokio::sync::watch::Receiver<UploadNotice>,
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

fn parse_mime(value: Option<String>) -> Result<Option<mime::Mime>, AppError> {
    match value {
        Some(value) => value.parse::<mime::Mime>().map(Some).map_err(|_| {
            AppError::validation_code("invalid_file_type", "The declared content type is invalid.")
        }),
        None => Ok(None),
    }
}
