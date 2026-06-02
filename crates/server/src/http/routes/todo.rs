use crate::error::AppError;

#[inline(always)]
pub async fn todo() -> AppError {
    AppError::not_implemented("This API operation has not been implemented yet.")
}
