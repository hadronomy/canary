use axum::Json;
use axum::http::StatusCode;
use serde::Serialize;

pub fn created<T: Serialize>(value: T) -> (StatusCode, Json<T>) {
    (StatusCode::CREATED, Json(value))
}
