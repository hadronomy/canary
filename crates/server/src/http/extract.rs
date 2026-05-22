use axum::body::Body;
use axum::http::HeaderMap;

pub fn optional_mime(headers: &HeaderMap) -> Option<mime::Mime> {
    headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<mime::Mime>().ok())
}

pub fn into_body_stream(body: Body) -> Body {
    body
}
