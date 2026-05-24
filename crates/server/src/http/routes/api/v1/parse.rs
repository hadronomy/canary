use axum::extract::{DefaultBodyLimit, State};
use axum::routing::post;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::http::extract::RequestBytes;
use crate::services::parser::ParseSummary;
use crate::state::{AppState, ParserState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/parse/document", post(parse).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
}

async fn parse(
    State(state): State<ParserState>,
    body: RequestBytes,
) -> AppResult<Json<ParseSummary>> {
    let summary = state.parser.summarize(body.into_vec()).await?;
    Ok(Json(summary))
}
