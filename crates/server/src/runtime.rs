use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::runtime::Runtime;

use crate::config::RuntimeConfig;
use crate::error::{ServerError, ServerResult};

pub fn build_runtime(config: &RuntimeConfig) -> ServerResult<Runtime> {
    let mut builder = tokio::runtime::Builder::new_multi_thread();

    builder
        .enable_all()
        .worker_threads(config.worker_threads())
        .max_blocking_threads(config.max_blocking_threads)
        .thread_stack_size(config.thread_stack_size_bytes)
        .thread_keep_alive(config.thread_keep_alive)
        .event_interval(config.event_interval)
        .global_queue_interval(config.global_queue_interval)
        .thread_name_fn(runtime_thread_name);

    builder.build().map_err(|source| ServerError::RuntimeBuild { source })
}

fn runtime_thread_name() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let next = NEXT.fetch_add(1, Ordering::Relaxed);
    format!("canary-server-{next:02}")
}
