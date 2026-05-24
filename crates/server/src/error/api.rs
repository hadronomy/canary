use std::borrow::Cow;
use std::{fmt, result};

use axum::body::Body;
use axum::extract::rejection::{BytesRejection, JsonRejection, QueryRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum_typed_multipart::TypedMultipartError;
use serde::Serialize;
use serde_json::{Map, Value, json};
use thiserror::Error;
use tower::BoxError;
use tower_http::request_id::RequestId;

use super::{ConfigError, DbError, FileError, SourceError};
use crate::http::context::current_request_id;

pub type AppResult<T> = result::Result<T, AppError>;
type ErrorContext = Map<String, Value>;

const PROBLEM_ROOT: &str = "/problems/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

#[doc(hidden)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiIssue {
    code: &'static str,
    detail: Cow<'static, str>,
    context: ErrorContext,
    errors: Vec<FieldError>,
}

impl ApiIssue {
    fn new(code: &'static str, detail: impl Into<Cow<'static, str>>) -> Self {
        Self { code, detail: detail.into(), context: Map::new(), errors: Vec::new() }
    }
}

impl fmt::Display for ApiIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.detail)
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(Box<ApiIssue>),
    #[error("{0}")]
    Validation(Box<ApiIssue>),
    #[error("{0}")]
    Unauthorized(Box<ApiIssue>),
    #[error("{0}")]
    Forbidden(Box<ApiIssue>),
    #[error("{0}")]
    NotFound(Box<ApiIssue>),
    #[error("{0}")]
    MethodNotAllowed(Box<ApiIssue>),
    #[error("{0}")]
    UnsupportedMediaType(Box<ApiIssue>),
    #[error("{0}")]
    PayloadTooLarge(Box<ApiIssue>),
    #[error("{0}")]
    ServiceUnavailable(Box<ApiIssue>),
    #[error("{issue}")]
    Internal {
        issue: Box<ApiIssue>,
        #[source]
        source: Option<SourceError>,
    },
    #[error("request timed out")]
    RequestTimeout,
}

impl From<ConfigError> for AppError {
    fn from(_: ConfigError) -> Self {
        Self::internal("configuration_error", "The server configuration is invalid.")
    }
}

impl From<DbError> for AppError {
    fn from(_: DbError) -> Self {
        Self::service_unavailable_code("database_error", "The database is currently unavailable.")
    }
}

impl From<FileError> for AppError {
    fn from(source: FileError) -> Self {
        match source {
            FileError::InvalidBlobId => {
                Self::bad_request_code("invalid_blob_id", "The blob id is invalid.")
            }
            FileError::NotFound { id } => {
                Self::not_found_code("blob_not_found", "The requested blob was not found.")
                    .with_context("blob_id", json!(id))
            }
            FileError::InvalidFileName => {
                Self::bad_request_code("invalid_file_name", "The file name is invalid.")
            }
            FileError::InvalidContentType => Self::unsupported_media_type_code(
                "invalid_content_type",
                "The provided content type is not supported.",
            ),
            FileError::CreateDir { .. }
            | FileError::ReadBody { .. }
            | FileError::Multipart { .. }
            | FileError::Open { .. }
            | FileError::Write { .. }
            | FileError::Persist { .. }
            | FileError::ReadFile { .. } => {
                Self::internal("file_error", "The file operation failed.")
            }
        }
    }
}

impl From<QueryRejection> for AppError {
    fn from(source: QueryRejection) -> Self {
        Self::bad_request_code("invalid_query", "The query string is invalid.")
            .with_context("reason", json!(source.body_text()))
    }
}

impl From<BytesRejection> for AppError {
    fn from(source: BytesRejection) -> Self {
        if source.status() == StatusCode::PAYLOAD_TOO_LARGE {
            return Self::payload_too_large_code(
                "payload_too_large",
                "The request body is too large.",
            )
            .with_context("reason", json!(source.body_text()));
        }

        Self::bad_request_code("invalid_body", "The request body is invalid.")
            .with_context("reason", json!(source.body_text()))
    }
}

impl From<JsonRejection> for AppError {
    fn from(source: JsonRejection) -> Self {
        match source.status() {
            StatusCode::UNSUPPORTED_MEDIA_TYPE => Self::unsupported_media_type_code(
                "invalid_content_type",
                "The request content type is not supported.",
            ),
            StatusCode::PAYLOAD_TOO_LARGE => {
                Self::payload_too_large("The request body is too large.")
            }
            StatusCode::UNPROCESSABLE_ENTITY => {
                Self::validation_code("invalid_json", "The JSON payload is invalid.")
            }
            _ => Self::bad_request_code("invalid_json", "The JSON payload is invalid."),
        }
        .with_context("reason", json!(source.body_text()))
    }
}

impl From<TypedMultipartError> for AppError {
    fn from(source: TypedMultipartError) -> Self {
        match source {
            TypedMultipartError::MissingField { field_name } => {
                Self::validation("The multipart form is missing required fields.")
                    .with_field(field_name, "This field is required.")
            }
            TypedMultipartError::WrongFieldType { field_name, wanted_type, .. } => {
                Self::validation("The multipart form contains invalid field values.")
                    .with_field(field_name, format!("Expected a value of type '{wanted_type}'."))
            }
            TypedMultipartError::DuplicateField { field_name } => {
                Self::validation("The multipart form contains duplicate fields.")
                    .with_field(field_name, "This field may only appear once.")
            }
            TypedMultipartError::UnknownField { field_name } => {
                Self::validation("The multipart form contains unknown fields.")
                    .with_field(field_name, "This field is not allowed.")
            }
            TypedMultipartError::InvalidEnumValue { field_name, value } => {
                Self::validation("The multipart form contains invalid field values.")
                    .with_field(field_name, format!("'{value}' is not a valid value."))
            }
            TypedMultipartError::NamelessField => {
                Self::bad_request_code("invalid_multipart", "The multipart form is malformed.")
                    .with_context("reason", json!("field name is empty"))
            }
            TypedMultipartError::FieldTooLarge { field_name, limit_bytes } => {
                Self::payload_too_large("A multipart field is too large.")
                    .with_field(field_name, format!("Field exceeds {limit_bytes} bytes."))
            }
            TypedMultipartError::InvalidRequest { source } => Self::bad_request_code(
                "invalid_multipart",
                "The multipart form request is malformed.",
            )
            .with_context("reason", json!(source.body_text())),
            TypedMultipartError::InvalidRequestBody { source } => {
                if source.status() == StatusCode::PAYLOAD_TOO_LARGE {
                    Self::payload_too_large("The multipart request body is too large.")
                } else {
                    Self::bad_request_code(
                        "invalid_multipart",
                        "The multipart request body is malformed.",
                    )
                }
                .with_context("reason", json!(source.to_string()))
            }
            TypedMultipartError::Other { .. } => {
                Self::internal("multipart_error", "Failed to process the multipart body.")
            }
            _ => Self::internal("multipart_error", "Failed to process the multipart body."),
        }
    }
}

impl AppError {
    #[must_use]
    pub fn bad_request(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::bad_request_code("bad_request", detail)
    }

    #[must_use]
    pub fn bad_request_code(code: &'static str, detail: impl Into<Cow<'static, str>>) -> Self {
        Self::BadRequest(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn validation(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::validation_code("validation_error", detail)
    }

    #[must_use]
    pub fn validation_code(code: &'static str, detail: impl Into<Cow<'static, str>>) -> Self {
        Self::Validation(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn unauthorized(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::Unauthorized(Box::new(ApiIssue::new("unauthorized", detail)))
    }

    #[must_use]
    pub fn forbidden(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::Forbidden(Box::new(ApiIssue::new("forbidden", detail)))
    }

    #[must_use]
    pub fn not_found(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::not_found_code("not_found", detail)
    }

    #[must_use]
    pub fn not_found_code(code: &'static str, detail: impl Into<Cow<'static, str>>) -> Self {
        Self::NotFound(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn method_not_allowed(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::MethodNotAllowed(Box::new(ApiIssue::new("method_not_allowed", detail)))
    }

    #[must_use]
    pub fn unsupported_media_type(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::unsupported_media_type_code("unsupported_media_type", detail)
    }

    #[must_use]
    pub fn unsupported_media_type_code(
        code: &'static str,
        detail: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self::UnsupportedMediaType(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn payload_too_large(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::payload_too_large_code("payload_too_large", detail)
    }

    #[must_use]
    pub fn payload_too_large_code(
        code: &'static str,
        detail: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self::PayloadTooLarge(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn service_unavailable(detail: impl Into<Cow<'static, str>>) -> Self {
        Self::service_unavailable_code("service_unavailable", detail)
    }

    #[must_use]
    pub fn service_unavailable_code(
        code: &'static str,
        detail: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self::ServiceUnavailable(Box::new(ApiIssue::new(code, detail)))
    }

    #[must_use]
    pub fn internal(code: &'static str, detail: impl Into<Cow<'static, str>>) -> Self {
        Self::Internal { issue: Box::new(ApiIssue::new(code, detail)), source: None }
    }

    #[must_use]
    pub fn with_context(mut self, key: impl Into<String>, value: Value) -> Self {
        match &mut self {
            Self::BadRequest(issue)
            | Self::Validation(issue)
            | Self::Unauthorized(issue)
            | Self::Forbidden(issue)
            | Self::NotFound(issue)
            | Self::MethodNotAllowed(issue)
            | Self::UnsupportedMediaType(issue)
            | Self::PayloadTooLarge(issue)
            | Self::ServiceUnavailable(issue) => {
                issue.context.insert(key.into(), value);
            }
            Self::Internal { issue, .. } => {
                issue.context.insert(key.into(), value);
            }
            Self::RequestTimeout => {}
        }
        self
    }

    #[must_use]
    pub fn with_detail(self, key: impl Into<String>, value: Value) -> Self {
        self.with_context(key, value)
    }

    #[must_use]
    pub fn with_field(mut self, field: impl Into<String>, message: impl Into<String>) -> Self {
        match &mut self {
            Self::BadRequest(issue)
            | Self::Validation(issue)
            | Self::Unauthorized(issue)
            | Self::Forbidden(issue)
            | Self::NotFound(issue)
            | Self::MethodNotAllowed(issue)
            | Self::UnsupportedMediaType(issue)
            | Self::PayloadTooLarge(issue)
            | Self::ServiceUnavailable(issue) => {
                issue.errors.push(FieldError { field: field.into(), message: message.into() });
            }
            Self::Internal { issue, .. } => {
                issue.errors.push(FieldError { field: field.into(), message: message.into() });
            }
            Self::RequestTimeout => {}
        }
        self
    }

    #[must_use]
    pub fn with_source<E>(mut self, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        if let Self::Internal { source: inner, .. } = &mut self {
            *inner = Some(Box::new(source));
        }
        self
    }

    #[must_use]
    pub fn code(&self) -> &'static str {
        self.spec().code
    }

    #[must_use]
    pub fn status_code(&self) -> StatusCode {
        self.spec().status
    }

    #[must_use]
    pub fn from_box_error(error: BoxError) -> Self {
        if error.is::<tower::timeout::error::Elapsed>() {
            return Self::RequestTimeout;
        }
        Self::internal("middleware_error", "The request failed inside the HTTP middleware stack.")
            .with_boxed_source(error)
    }

    #[must_use]
    pub fn with_boxed_source(mut self, source: SourceError) -> Self {
        if let Self::Internal { source: inner, .. } = &mut self {
            *inner = Some(source);
        }
        self
    }

    fn spec(&self) -> ErrorSpec {
        match self {
            Self::BadRequest(issue) => {
                ErrorSpec::new(StatusCode::BAD_REQUEST, "Bad request", issue.as_ref().clone())
            }
            Self::Validation(issue) => ErrorSpec::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Request validation failed",
                issue.as_ref().clone(),
            ),
            Self::Unauthorized(issue) => ErrorSpec::new(
                StatusCode::UNAUTHORIZED,
                "Authentication required",
                issue.as_ref().clone(),
            ),
            Self::Forbidden(issue) => {
                ErrorSpec::new(StatusCode::FORBIDDEN, "Forbidden", issue.as_ref().clone())
            }
            Self::NotFound(issue) => {
                ErrorSpec::new(StatusCode::NOT_FOUND, "Resource not found", issue.as_ref().clone())
            }
            Self::MethodNotAllowed(issue) => ErrorSpec::new(
                StatusCode::METHOD_NOT_ALLOWED,
                "Method not allowed",
                issue.as_ref().clone(),
            ),
            Self::UnsupportedMediaType(issue) => ErrorSpec::new(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Unsupported media type",
                issue.as_ref().clone(),
            ),
            Self::PayloadTooLarge(issue) => ErrorSpec::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Payload too large",
                issue.as_ref().clone(),
            ),
            Self::ServiceUnavailable(issue) => ErrorSpec::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service unavailable",
                issue.as_ref().clone(),
            ),
            Self::Internal { issue, .. } => ErrorSpec::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error",
                issue.as_ref().clone(),
            ),
            Self::RequestTimeout => ErrorSpec::new(
                StatusCode::REQUEST_TIMEOUT,
                "Request timed out",
                ApiIssue::new("request_timeout", "The request timed out."),
            ),
        }
    }
}

#[derive(Debug, Clone)]
struct ErrorSpec {
    status: StatusCode,
    code: &'static str,
    title: &'static str,
    detail: String,
    context: ErrorContext,
    errors: Vec<FieldError>,
}

impl ErrorSpec {
    fn new(status: StatusCode, title: &'static str, issue: ApiIssue) -> Self {
        Self {
            status,
            code: issue.code,
            title,
            detail: issue.detail.into_owned(),
            context: issue.context,
            errors: issue.errors,
        }
    }
}

#[derive(Debug, Serialize)]
struct ProblemDetails {
    #[serde(rename = "type")]
    kind: String,
    title: &'static str,
    status: u16,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance: Option<Instance>,
    code: &'static str,
    #[serde(skip_serializing_if = "Map::is_empty")]
    context: ErrorContext,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<FieldError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
struct Instance(String);

impl Instance {
    fn request(id: &RequestId) -> Option<Self> {
        request_id_text(id).map(|id| Self(format!("urn:canary:request:{id}")))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let spec = self.spec();
        let request_id = current_request_id();
        let request_id_text = request_id.as_ref().and_then(request_id_text).map(str::to_owned);
        let instance = request_id.as_ref().and_then(Instance::request);

        if spec.status.is_server_error() {
            tracing::error!(
                error = %self,
                code = spec.code,
                status = spec.status.as_u16(),
                request_id = request_id_text.as_deref().unwrap_or("-"),
                "request failed"
            );
        } else {
            tracing::warn!(
                error = %self,
                code = spec.code,
                status = spec.status.as_u16(),
                request_id = request_id_text.as_deref().unwrap_or("-"),
                "request failed"
            );
        }

        let problem = ProblemDetails {
            kind: format!("{PROBLEM_ROOT}{}", spec.code),
            title: spec.title,
            status: spec.status.as_u16(),
            detail: spec.detail,
            instance,
            code: spec.code,
            context: spec.context,
            errors: spec.errors,
            request_id: request_id_text,
        };
        let body = serde_json::to_vec(&problem).expect("problem details should serialize");
        let mut response = Response::new(Body::from(body));
        *response.status_mut() = spec.status;
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/problem+json"));
        response
    }
}

fn request_id_text(id: &RequestId) -> Option<&str> {
    id.header_value().to_str().ok()
}
