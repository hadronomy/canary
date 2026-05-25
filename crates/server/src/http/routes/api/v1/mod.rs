pub mod files;
pub mod parse;

use axum::Router;

use crate::state::AppState;

pub fn router(state: &AppState) -> Router<AppState> {
    Router::new().merge(parse::router()).merge(files::router(state))
}
