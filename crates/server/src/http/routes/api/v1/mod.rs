pub mod collections;
pub mod documents;
pub mod files;
pub mod ingestions;
pub mod operations;
pub mod parse;
pub mod retrieval;
pub mod schedules;
pub mod sources;

use axum::Router;

use crate::state::AppState;

pub fn router(state: &AppState) -> Router<AppState> {
    Router::new()
        .merge(collections::router())
        .merge(documents::router())
        .merge(files::router(state))
        .merge(ingestions::router())
        .merge(operations::router())
        .merge(parse::router())
        .merge(retrieval::router())
        .merge(schedules::router())
        .merge(sources::router())
}
