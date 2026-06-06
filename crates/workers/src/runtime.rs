//! Runtime wiring for Temporal worker processes.
//!
//! The runtime opens Temporal and NATS connections, registers the stub
//! workflows and activities, and drives the selected worker set until
//! cancellation.

use std::sync::Arc;
use std::time::Duration;

use temporalio_client::{Client, ClientOptions, Connection, ConnectionOptions};
use temporalio_common::data_converters::{
    DataConverter, DefaultFailureConverter, PayloadConverter,
};
use temporalio_common::worker::WorkerTaskTypes;
use temporalio_sdk::{Worker, WorkerOptions};
use temporalio_sdk_core::{CoreRuntime, RuntimeOptions};
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::activities::DocumentActivities;
use crate::codec::{ClaimCheckCodec, NatsClaimStore};
use crate::workflows::{DocumentBatchWorkflow, DocumentFanoutWorkflow};
use crate::{Result, TaskQueue, WorkerConfig, WorkerError, WorkerKind};

/// Runtime options provided by the CLI or supervising process.
#[derive(Debug, Clone, Default)]
pub struct WorkerRuntimeOptions {
    /// Worker kind to launch.
    pub kind: WorkerKind,
    /// Optional task queue override for the selected worker process.
    pub task_queue: Option<TaskQueue>,
    /// Optional concurrency hint reserved for the final worker tuner.
    pub concurrency: Option<usize>,
}

/// Prepared Temporal worker runtime.
pub struct WorkerRuntime {
    cfg: WorkerConfig,
    opts: WorkerRuntimeOptions,
    core: CoreRuntime,
    client: Client,
}

impl WorkerRuntime {
    /// Builds the runtime and validates the selected worker kind.
    pub async fn build(cfg: WorkerConfig) -> Result<Self> {
        Self::build_with(cfg, WorkerRuntimeOptions::default()).await
    }

    /// Builds the runtime with command-specific launch options.
    pub async fn build_with(cfg: WorkerConfig, opts: WorkerRuntimeOptions) -> Result<Self> {
        cfg.validate()?;
        reject_reserved(opts.kind)?;

        let codec = payload_codec(&cfg).await?;
        let data = DataConverter::new(PayloadConverter::default(), DefaultFailureConverter, codec);
        let conn = Connection::connect(connection_options(&cfg)?)
            .await
            .map_err(|err| WorkerError::TemporalConnect(err.to_string()))?;
        let client = Client::new(
            conn,
            ClientOptions::new(cfg.temporal.namespace.as_str().to_owned())
                .data_converter(data)
                .build(),
        )
        .map_err(|err| WorkerError::TemporalConnect(err.to_string()))?;
        let core = CoreRuntime::new_assume_tokio(
            RuntimeOptions::builder().build().map_err(WorkerError::Config)?,
        )
        .map_err(|err| WorkerError::TemporalWorker(err.to_string()))?;

        Ok(Self { cfg, opts, core, client })
    }

    /// Runs the selected workers until they stop or the cancellation token fires.
    pub async fn run(self, token: CancellationToken) -> Result<()> {
        let mut workers = self.workers()?;
        if workers.is_empty() {
            return Ok(());
        }

        let stops = workers.iter().map(Worker::shutdown_handle).collect::<Vec<_>>();
        for worker in &workers {
            info!(task_queue = worker.task_queue(), "starting Temporal worker");
        }

        tokio::select! {
            result = run_all(&mut workers) => result,
            () = token.cancelled() => {
                for stop in stops {
                    stop();
                }
                run_all(&mut workers).await
            }
        }
    }

    fn workers(&self) -> Result<Vec<Worker>> {
        match self.opts.kind {
            WorkerKind::All => Ok(vec![self.workflow_worker()?, self.rust_activity_worker()?]),
            WorkerKind::Workflow => Ok(vec![self.workflow_worker()?]),
            WorkerKind::RustActivities => Ok(vec![self.rust_activity_worker()?]),
            WorkerKind::Parser
            | WorkerKind::Ingestion
            | WorkerKind::Source
            | WorkerKind::Embedding => unreachable!("reserved worker kinds are rejected at build"),
        }
    }

    fn workflow_worker(&self) -> Result<Worker> {
        let queue = self.opts.task_queue.as_ref().unwrap_or(&self.cfg.task_queues.workflow);
        let opts = WorkerOptions::new(queue.as_str().to_owned())
            .register_workflow::<DocumentFanoutWorkflow>()
            .register_workflow::<DocumentBatchWorkflow>()
            .task_types(WorkerTaskTypes::workflow_only())
            .graceful_shutdown_period(Duration::from_secs(30))
            .build();
        Worker::new(&self.core, self.client.clone(), opts)
            .map_err(|err| WorkerError::TemporalWorker(err.to_string()))
    }

    fn rust_activity_worker(&self) -> Result<Worker> {
        let queue = self.opts.task_queue.as_ref().unwrap_or(&self.cfg.task_queues.rust_activities);
        let opts = WorkerOptions::new(queue.as_str().to_owned())
            .register_activities(DocumentActivities)
            .task_types(WorkerTaskTypes::activity_only())
            .graceful_shutdown_period(Duration::from_secs(30))
            .build();
        Worker::new(&self.core, self.client.clone(), opts)
            .map_err(|err| WorkerError::TemporalWorker(err.to_string()))
    }
}

async fn run_all(workers: &mut [Worker]) -> Result<()> {
    futures_util::future::try_join_all(workers.iter_mut().map(|worker| async {
        worker.run().await.map_err(|err| WorkerError::TemporalRun(err.to_string()))
    }))
    .await?;
    Ok(())
}

async fn payload_codec(cfg: &WorkerConfig) -> Result<ClaimCheckCodec> {
    let client = async_nats::connect(cfg.nats.url.as_str())
        .await
        .map_err(|err| WorkerError::NatsConnect(err.to_string()))?;
    let jetstream = cfg.nats.jetstream_domain.as_ref().map_or_else(
        || async_nats::jetstream::new(client.clone()),
        |domain| async_nats::jetstream::with_domain(client.clone(), domain.as_str()),
    );
    let bucket = match jetstream.get_object_store(cfg.nats.object_store.as_str()).await {
        Ok(bucket) => bucket,
        Err(_) => jetstream
            .create_object_store(async_nats::jetstream::object_store::Config {
                bucket: cfg.nats.object_store.to_string(),
                ..Default::default()
            })
            .await
            .map_err(|err| WorkerError::ObjectStore(err.to_string()))?,
    };
    Ok(ClaimCheckCodec::new(
        cfg.nats.object_store.to_string(),
        cfg.codec.claim_check_threshold_bytes,
        Arc::new(NatsClaimStore::new(bucket)),
    ))
}

fn connection_options(cfg: &WorkerConfig) -> Result<ConnectionOptions> {
    let mut opts = ConnectionOptions::new(cfg.temporal.target_url.clone()).build();
    if let Some(identity) = &cfg.temporal.identity {
        opts.identity = identity.to_string();
    }
    Ok(opts)
}

fn reject_reserved(kind: WorkerKind) -> Result<()> {
    match kind {
        WorkerKind::Parser => Err(WorkerError::Todo("parser")),
        WorkerKind::Ingestion => Err(WorkerError::Todo("ingestion")),
        WorkerKind::Source => Err(WorkerError::Todo("source")),
        WorkerKind::Embedding => Err(WorkerError::Todo("embedding")),
        WorkerKind::All | WorkerKind::Workflow | WorkerKind::RustActivities => Ok(()),
    }
}
