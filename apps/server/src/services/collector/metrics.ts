import { Metric, MetricBoundaries } from "effect";

const durationBuckets = MetricBoundaries.exponential({
  start: 10,
  factor: 2,
  count: 13,
});

const batchSizeBuckets = MetricBoundaries.linear({
  start: 0,
  width: 10,
  count: 26,
});

export const collectorRunsStartedTotal = Metric.counter("collector_runs_started_total", {
  description: "Total number of collector runs that started",
});

export const collectorRunsCompletedTotal = Metric.counter("collector_runs_completed_total", {
  description: "Total number of collector runs that completed successfully",
});

export const collectorRunsFailedTotal = Metric.counter("collector_runs_failed_total", {
  description: "Total number of collector runs that failed",
});

export const collectorRunsCancelledTotal = Metric.counter("collector_runs_cancelled_total", {
  description: "Total number of collector runs that were cancelled",
});

export const collectorRunDurationMs = Metric.histogram(
  "collector_run_duration_ms",
  durationBuckets,
  "Collector run duration in milliseconds",
);

export const collectorActiveRuns = Metric.gauge("collector_active_runs", {
  description: "Number of currently active collector runs",
});

export const collectorQueueDepth = Metric.gauge("collector_queue_depth", {
  description: "Number of queued collector jobs",
});

export const collectorQueueOfferTimeoutTotal = Metric.counter(
  "collector_queue_offer_timeout_total",
  {
    description: "Number of queue offer timeouts caused by backpressure",
  },
);

export const collectorProgressUpdatesTotal = Metric.counter("collector_progress_updates_total", {
  description: "Total number of collector progress updates",
});

export const collectorBatchSize = Metric.histogram(
  "collector_batch_size",
  batchSizeBuckets,
  "Distribution of collected batch sizes",
);

export const collectorDocumentsProcessedTotal = Metric.counter(
  "collector_documents_processed_total",
  {
    description: "Total number of processed documents",
  },
);

export const collectorDocumentsInsertedTotal = Metric.counter(
  "collector_documents_inserted_total",
  {
    description: "Total number of inserted documents",
  },
);

export const collectorDocumentsUpdatedTotal = Metric.counter("collector_documents_updated_total", {
  description: "Total number of updated documents",
});

export const collectorDocumentsSkippedTotal = Metric.counter("collector_documents_skipped_total", {
  description: "Total number of skipped documents",
});

export const collectorRunErrorsTotal = Metric.counter("collector_run_errors_total", {
  description: "Total number of collector errors by type",
});

export const collectorScheduleTriggersTotal = Metric.counter("collector_schedule_triggers_total", {
  description: "Total number of scheduler-triggered collector runs",
});

export const collectorScheduleErrorsTotal = Metric.counter("collector_schedule_errors_total", {
  description: "Total number of collector scheduling errors",
});

export const collectorScheduledTotal = Metric.gauge("collector_scheduled_total", {
  description: "Number of collectors with active schedules",
});

export const rssFetchDurationMs = Metric.histogram(
  "rss_fetch_duration_ms",
  durationBuckets,
  "RSS feed fetch duration in milliseconds",
);

export const rssParseDurationMs = Metric.histogram(
  "rss_parse_duration_ms",
  durationBuckets,
  "RSS feed parse duration in milliseconds",
);

export const rssFetchErrorsTotal = Metric.counter("rss_fetch_errors_total", {
  description: "Total number of RSS fetch failures",
});

export const rssItemsParsedTotal = Metric.counter("rss_items_parsed_total", {
  description: "Total number of RSS items parsed",
});
