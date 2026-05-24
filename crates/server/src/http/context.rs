use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use tower_http::request_id::RequestId;

tokio::task_local! {
    static CURRENT_REQUEST_ID: Option<RequestId>;
}

pub async fn bind_request_context(request: Request, next: Next) -> Response {
    let request_id = request.extensions().get::<RequestId>().cloned();

    CURRENT_REQUEST_ID.scope(request_id, next.run(request)).await
}

pub fn current_request_id() -> Option<RequestId> {
    CURRENT_REQUEST_ID.try_with(Clone::clone).ok().flatten()
}
