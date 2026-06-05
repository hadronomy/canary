use canary_report::{Doc, Report, Value};

use crate::config::defaults::{
    CONFIG_PATH_ENV, DEFAULT_CONFIG_CANDIDATES, ENV_PREFIX, ENV_SEPARATOR,
};
use crate::{CliLayer, EnvironmentLayer, LoadedConfig};

pub(super) fn check(loaded: &LoadedConfig) -> Doc {
    Doc::builder()
        .section("check", "Check")
        .field("valid", "valid", true)
        .field("origin", "origin", loaded.origin.to_string())
        .field("listener", "listener", format!("http://{}", loaded.settings.server.bind))
        .field("authorization", "authorization", auth(&loaded.settings.auth))
        .field("storage", "storage", storage(&loaded.settings.files))
        .build()
}

#[inline(always)]
pub(super) fn config(loaded: &LoadedConfig) -> Doc {
    loaded.to_doc()
}

pub(super) fn sources(loaded: &LoadedConfig) -> Doc {
    let origin = &loaded.origin;
    Doc::builder()
        .section("sources", "Sources")
        .field("selected", "selected", origin.selected_label())
        .field("files", "files", files(loaded))
        .field("file_source", "file source", origin.file_source.map(|source| source.to_string()))
        .field(
            "default_candidates",
            "default candidates",
            DEFAULT_CONFIG_CANDIDATES.iter().copied().map(Value::from).collect::<Vec<_>>(),
        )
        .field("config_path_env", "config path env", CONFIG_PATH_ENV)
        .field("env_prefix", "env prefix", ENV_PREFIX)
        .field("env_separator", "env separator", ENV_SEPARATOR)
        .field("rust_log_alias", "rust log alias", "RUST_LOG -> observability.filter")
        .field(
            "environment_layer",
            "environment layer",
            matches!(origin.environment, EnvironmentLayer::Present),
        )
        .field("cli_layer", "cli layer", matches!(origin.cli, CliLayer::Present))
        .field(
            "cli_overrides",
            "cli overrides",
            origin.cli_overrides.iter().copied().map(Value::from).collect::<Vec<_>>(),
        )
        .build()
}

#[inline(always)]
fn auth(value: &canary_authorization::Config) -> &'static str {
    if value.is_enabled() { "enabled" } else { "disabled" }
}

fn storage(value: &crate::FilesConfig) -> String {
    match &value.storage.prefix {
        Some(prefix) => format!("s3://{}/{}", value.storage.bucket, prefix.as_str()),
        None => format!("s3://{}", value.storage.bucket),
    }
}

fn files(loaded: &LoadedConfig) -> Vec<Value> {
    loaded.origin.files.iter().map(|path| Value::from(path.display().to_string())).collect()
}
