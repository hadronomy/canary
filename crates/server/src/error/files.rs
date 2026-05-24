use std::io;

use miette::Diagnostic;
use thiserror::Error;

use super::SourceError;
use crate::files::meta::BlobId;

#[derive(Debug, Error, Diagnostic)]
pub enum FileError {
    #[error("invalid blob id")]
    #[diagnostic(code(canary_server::files::invalid_blob_id))]
    InvalidBlobId,
    #[error("blob {id} not found")]
    #[diagnostic(code(canary_server::files::not_found))]
    NotFound { id: BlobId },
    #[error("invalid file name")]
    #[diagnostic(code(canary_server::files::invalid_file_name))]
    InvalidFileName,
    #[error("invalid content type")]
    #[diagnostic(code(canary_server::files::invalid_content_type))]
    InvalidContentType,
    #[error("failed to create staging directory")]
    #[diagnostic(code(canary_server::files::create_dir))]
    CreateDir {
        #[source]
        source: io::Error,
    },
    #[error("failed to read upload body")]
    #[diagnostic(code(canary_server::files::read_body))]
    ReadBody {
        #[source]
        source: SourceError,
    },
    #[error("failed to read multipart body")]
    #[diagnostic(code(canary_server::files::multipart))]
    Multipart {
        #[source]
        source: SourceError,
    },
    #[error("failed to open staged file")]
    #[diagnostic(code(canary_server::files::open))]
    Open {
        #[source]
        source: io::Error,
    },
    #[error("failed to write staged file")]
    #[diagnostic(code(canary_server::files::write))]
    Write {
        #[source]
        source: io::Error,
    },
    #[error("failed to persist staged file")]
    #[diagnostic(code(canary_server::files::persist))]
    Persist {
        #[source]
        source: io::Error,
    },
    #[error("failed to read persisted file")]
    #[diagnostic(code(canary_server::files::read_file))]
    ReadFile {
        #[source]
        source: io::Error,
    },
}
