use std::io;

use miette::Diagnostic;
use thiserror::Error;

use super::SourceError;
use crate::files::id::{FileId, UploadId};
use crate::files::meta::{ChecksumAlgorithm, ChecksumKind};
use crate::files::upload::UploadState;

#[derive(Debug, Error, Diagnostic)]
pub enum FileError {
    #[error("invalid file id")]
    #[diagnostic(code(canary_server::files::invalid_file_id))]
    InvalidFileId,
    #[error("invalid upload id")]
    #[diagnostic(code(canary_server::files::invalid_upload_id))]
    InvalidUploadId,
    #[error("invalid actor id")]
    #[diagnostic(code(canary_server::files::invalid_actor_id))]
    InvalidActorId,
    #[error("file {id} not found")]
    #[diagnostic(code(canary_server::files::not_found))]
    NotFound { id: FileId },
    #[error("upload {id} not found")]
    #[diagnostic(code(canary_server::files::upload_not_found))]
    UploadNotFound { id: UploadId },
    #[error("upload {id} is forbidden")]
    #[diagnostic(code(canary_server::files::upload_forbidden))]
    UploadForbidden { id: UploadId },
    #[error("upload {id} has expired")]
    #[diagnostic(code(canary_server::files::upload_expired))]
    UploadExpired { id: UploadId },
    #[error("upload {id} is in invalid state `{state}`")]
    #[diagnostic(code(canary_server::files::upload_invalid_state))]
    UploadInvalidState { id: UploadId, state: UploadState },
    #[error("invalid file name")]
    #[diagnostic(code(canary_server::files::invalid_file_name))]
    InvalidFileName,
    #[error("invalid upload purpose")]
    #[diagnostic(code(canary_server::files::invalid_upload_purpose))]
    InvalidUploadPurpose,
    #[error("invalid content type")]
    #[diagnostic(code(canary_server::files::invalid_content_type))]
    InvalidContentType,
    #[error("upload content type does not match the file contents")]
    #[diagnostic(code(canary_server::files::content_type_mismatch))]
    ContentTypeMismatch { declared: Option<String>, detected: String },
    #[error("browser-active content is not allowed for this upload")]
    #[diagnostic(code(canary_server::files::active_content_disallowed))]
    ActiveContentDisallowed { declared: Option<String>, detected: Option<String> },
    #[error("invalid checksum")]
    #[diagnostic(code(canary_server::files::invalid_checksum))]
    InvalidChecksum,
    #[error("upload checksum is required")]
    #[diagnostic(code(canary_server::files::upload_checksum_required))]
    UploadChecksumRequired { algorithm: ChecksumAlgorithm, kind: ChecksumKind },
    #[error("upload parts are invalid")]
    #[diagnostic(code(canary_server::files::invalid_upload_parts))]
    InvalidUploadParts,
    #[error("upload checksum does not match")]
    #[diagnostic(code(canary_server::files::checksum_mismatch))]
    ChecksumMismatch,
    #[error("upload size does not match the declared size")]
    #[diagnostic(code(canary_server::files::size_mismatch))]
    SizeMismatch,
    #[error("direct upload is not available for this backend")]
    #[diagnostic(code(canary_server::files::direct_upload_unavailable))]
    DirectUploadUnavailable,
    #[error("upload size exceeds the declared limit")]
    #[diagnostic(code(canary_server::files::upload_too_large))]
    UploadTooLarge,
    #[error("stored upload metadata is incomplete")]
    #[diagnostic(code(canary_server::files::upload_incomplete))]
    UploadIncomplete,
    #[error("failed to create staging directory")]
    #[diagnostic(code(canary_server::files::create_dir))]
    CreateDir {
        #[source]
        source: io::Error,
    },
    #[error("object storage operation failed")]
    #[diagnostic(code(canary_server::files::store))]
    Store {
        #[source]
        source: SourceError,
    },
    #[error("file metadata operation failed")]
    #[diagnostic(code(canary_server::files::metadata))]
    Metadata {
        #[source]
        source: SourceError,
    },
}
