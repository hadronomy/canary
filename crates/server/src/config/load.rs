use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use std::{env, fmt};

use canary_report::{Doc, Report, Value};
use config::builder::{ConfigBuilder, DefaultState};
use config::{Config, Environment, File};

use super::defaults::{CONFIG_PATH_ENV, DEFAULT_CONFIG_CANDIDATES, ENV_PREFIX, ENV_SEPARATOR};
use super::raw::{RawAppConfig, RawWorkerProcessConfig};
use super::types::{AppConfig, LogFormat, WorkerProcessConfig};
use crate::error::ConfigError;

const CLI_CONFIG_KEY: &str = "--config";
const RUST_LOG_ENV: &str = "RUST_LOG";
const OBSERVABILITY_FILTER_ENV: &str = "CANARY_SERVER__OBSERVABILITY__FILTER";

/// Fully resolved server configuration and where it came from.
#[derive(Debug, Clone, Default)]
pub struct LoadedConfig {
    pub settings: AppConfig,
    pub origin: ConfigOrigin,
}

/// Fully resolved worker process configuration and where it came from.
#[derive(Debug, Clone, Default)]
pub struct LoadedWorkerConfig {
    pub settings: WorkerProcessConfig,
    pub origin: ConfigOrigin,
}

impl LoadedConfig {
    /// Loads configuration from defaults, file, environment, and CLI overrides.
    ///
    /// [`ConfigInput::default`] discovers a config file from
    /// `CANARY_SERVER_CONFIG` or the default candidate paths and applies no CLI
    /// overrides.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when a selected file is missing, the layered
    /// configuration cannot be built, or validation fails.
    pub fn load() -> Result<Self, ConfigError> {
        Self::load_with(ConfigInput::default())
    }

    /// Loads configuration with explicit CLI input applied as the last layer.
    ///
    /// CLI values have the highest precedence:
    ///
    /// ```text
    /// cli > environment > file config > defaults
    /// ```
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when a selected file is missing, the layered
    /// configuration cannot be built, or validation fails.
    pub fn load_with(input: ConfigInput) -> Result<Self, ConfigError> {
        load_with_source(input, None)
    }

    #[doc(hidden)]
    pub fn load_from_environment_map(source: HashMap<String, String>) -> Result<Self, ConfigError> {
        load_with_source(ConfigInput::default(), Some(source))
    }

    #[doc(hidden)]
    pub fn load_with_environment_map(
        input: ConfigInput,
        source: HashMap<String, String>,
    ) -> Result<Self, ConfigError> {
        load_with_source(input, Some(source))
    }
}

impl LoadedWorkerConfig {
    /// Loads worker configuration from defaults, file, environment, and CLI overrides.
    ///
    /// This resolves only the settings a worker process uses: runtime,
    /// observability, and `workers`. Server-only settings such as object
    /// storage, database, HTTP, MCP, and authorization are left alone.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when a selected file is missing, the layered
    /// configuration cannot be built, or worker validation fails.
    #[inline(always)]
    pub fn load_with(input: ConfigInput) -> Result<Self, ConfigError> {
        load_worker_with_source(input, None)
    }

    #[doc(hidden)]
    #[inline(always)]
    pub fn load_with_environment_map(
        input: ConfigInput,
        source: HashMap<String, String>,
    ) -> Result<Self, ConfigError> {
        load_worker_with_source(input, Some(source))
    }
}

impl Report for LoadedConfig {
    fn report(&self) -> Doc {
        Doc::builder().extend(&self.origin).extend(&self.settings).build()
    }
}

impl Report for LoadedWorkerConfig {
    fn report(&self) -> Doc {
        Doc::builder().extend(&self.origin).extend(&self.settings).build()
    }
}

/// Inputs supplied by the process command line before configuration is loaded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigInput {
    pub path: ConfigPath,
    pub overrides: ConfigOverrides,
}

impl ConfigInput {
    /// Creates config input from a path and typed override set.
    #[inline(always)]
    #[must_use]
    pub const fn new(path: ConfigPath, overrides: ConfigOverrides) -> Self {
        Self { path, overrides }
    }
}

/// Config file selection requested by the CLI.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ConfigPath {
    #[default]
    Auto,
    Explicit {
        source: ConfigPathSource,
        path: PathBuf,
    },
}

/// The source that selected an explicit config file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigPathSource {
    Cli,
    Environment,
}

impl ConfigPathSource {
    #[inline(always)]
    const fn key(self) -> &'static str {
        match self {
            Self::Cli => CLI_CONFIG_KEY,
            Self::Environment => CONFIG_PATH_ENV,
        }
    }
}

impl ConfigPath {
    #[inline(always)]
    const fn is_cli_explicit(&self) -> bool {
        matches!(self, Self::Explicit { source: ConfigPathSource::Cli, .. })
    }
}

impl fmt::Display for ConfigPathSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cli => f.write_str("cli"),
            Self::Environment => f.write_str("environment"),
        }
    }
}

/// Typed CLI overrides applied after every other configuration layer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigOverrides {
    pub server: ServerOverrides,
    pub observability: ObservabilityOverrides,
}

impl ConfigOverrides {
    /// Returns whether any CLI override is present.
    #[inline(always)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.server.is_empty() && self.observability.is_empty()
    }

    /// Returns the config keys changed by CLI overrides.
    #[must_use]
    pub fn keys(&self) -> Vec<&'static str> {
        let mut keys = Vec::new();
        self.server.keys(&mut keys);
        self.observability.keys(&mut keys);
        keys
    }

    fn apply(
        &self,
        mut builder: ConfigBuilder<DefaultState>,
    ) -> Result<ConfigBuilder<DefaultState>, ConfigError> {
        builder = builder
            .set_override_option("server.bind", self.server.bind.map(|value| value.to_string()))
            .map_err(|source| ConfigError::Build { source })?;
        builder = builder
            .set_override_option(
                "server.request_timeout",
                self.server.request_timeout.map(duration),
            )
            .map_err(|source| ConfigError::Build { source })?;
        builder = builder
            .set_override_option(
                "server.shutdown_grace_period",
                self.server.shutdown_grace_period.map(duration),
            )
            .map_err(|source| ConfigError::Build { source })?;
        builder = builder
            .set_override_option(
                "server.max_body_size_bytes",
                self.server.max_body_size_bytes.map(|value| value as i128),
            )
            .map_err(|source| ConfigError::Build { source })?;
        builder = builder
            .set_override_option("observability.filter", self.observability.filter.clone())
            .map_err(|source| ConfigError::Build { source })?;
        builder = builder
            .set_override_option(
                "observability.format",
                self.observability.format.map(|value| value.as_str()),
            )
            .map_err(|source| ConfigError::Build { source })?;
        Ok(builder)
    }
}

/// Server process settings that can be changed from the CLI.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ServerOverrides {
    pub bind: Option<SocketAddr>,
    pub request_timeout: Option<Duration>,
    pub shutdown_grace_period: Option<Duration>,
    pub max_body_size_bytes: Option<usize>,
}

impl ServerOverrides {
    #[inline(always)]
    const fn is_empty(&self) -> bool {
        self.bind.is_none()
            && self.request_timeout.is_none()
            && self.shutdown_grace_period.is_none()
            && self.max_body_size_bytes.is_none()
    }

    fn keys(self, keys: &mut Vec<&'static str>) {
        if self.bind.is_some() {
            keys.push("server.bind");
        }
        if self.request_timeout.is_some() {
            keys.push("server.request_timeout");
        }
        if self.shutdown_grace_period.is_some() {
            keys.push("server.shutdown_grace_period");
        }
        if self.max_body_size_bytes.is_some() {
            keys.push("server.max_body_size_bytes");
        }
    }
}

/// Observability settings that can be changed from the CLI.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ObservabilityOverrides {
    pub filter: Option<String>,
    pub format: Option<LogFormat>,
}

impl ObservabilityOverrides {
    #[inline(always)]
    fn is_empty(&self) -> bool {
        self.filter.is_none() && self.format.is_none()
    }

    fn keys(&self, keys: &mut Vec<&'static str>) {
        if self.filter.is_some() {
            keys.push("observability.filter");
        }
        if self.format.is_some() {
            keys.push("observability.format");
        }
    }
}

/// Describes the configuration layers used for this process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigOrigin {
    pub files: Vec<PathBuf>,
    pub file_source: Option<ConfigPathSource>,
    pub environment: EnvironmentLayer,
    pub cli: CliLayer,
    pub cli_overrides: Vec<&'static str>,
}

/// Whether an environment layer contributed configuration.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum EnvironmentLayer {
    Present,
    #[default]
    Absent,
}

impl EnvironmentLayer {
    fn from_source(source: &HashMap<String, String>) -> Self {
        if source.is_empty() {
            return Self::Absent;
        }
        Self::Present
    }
}

/// Whether CLI overrides contributed configuration.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CliLayer {
    Present,
    #[default]
    Absent,
}

impl CliLayer {
    #[inline(always)]
    fn from_input(input: &ConfigInput) -> Self {
        if input.path.is_cli_explicit() || !input.overrides.is_empty() {
            Self::Present
        } else {
            Self::Absent
        }
    }
}

impl ConfigOrigin {
    fn discover(
        input: &ConfigInput,
        source: Option<&HashMap<String, String>>,
    ) -> Result<Self, ConfigError> {
        let path = explicit_path(&input.path, source);
        let environment = environment_layer(source);
        let cli = CliLayer::from_input(input);
        let mut cli_overrides = input.overrides.keys();
        if input.path.is_cli_explicit() {
            cli_overrides.insert(0, "--config");
        }
        let files = config_files(path.clone())?;
        let file_source = path.map(|path| path.source);
        Ok(Self { files, file_source, environment, cli, cli_overrides })
    }

    /// Returns the selected configuration file label.
    #[must_use]
    pub fn selected_label(&self) -> String {
        match self.files.as_slice() {
            [] => "defaults".into(),
            [file] => file.display().to_string(),
            files => {
                files.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
            }
        }
    }

    /// Returns the overlay label for environment and CLI layers.
    #[must_use]
    pub const fn overlay_label(&self) -> &'static str {
        match (self.environment, self.cli) {
            (EnvironmentLayer::Absent, CliLayer::Absent) => "none",
            (EnvironmentLayer::Present, CliLayer::Absent) => "environment",
            (EnvironmentLayer::Absent, CliLayer::Present) => "cli",
            (EnvironmentLayer::Present, CliLayer::Present) => "environment + cli",
        }
    }
}

impl Report for ConfigOrigin {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("origin", "Origin")
            .field("selected", "selected", self.selected_label())
            .field("files", "files", paths(&self.files))
            .field("file_source", "file source", self.file_source.map(|source| source.to_string()))
            .field(
                "environment",
                "environment",
                matches!(self.environment, EnvironmentLayer::Present),
            )
            .field("cli", "cli", matches!(self.cli, CliLayer::Present))
            .field(
                "cli_overrides",
                "cli overrides",
                self.cli_overrides.iter().copied().map(Value::from).collect::<Vec<_>>(),
            )
            .build()
    }
}

impl fmt::Display for ConfigOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let config = self.selected_label();
        let mut layers = Vec::new();
        if matches!(self.environment, EnvironmentLayer::Present) {
            layers.push("environment");
        }
        if matches!(self.cli, CliLayer::Present) {
            layers.push("cli");
        }
        if layers.is_empty() {
            return f.write_str(&config);
        }
        write!(f, "{} + {}", config, layers.join(" + "))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExplicitPath {
    source: ConfigPathSource,
    path: PathBuf,
}

fn load_with_source(
    input: ConfigInput,
    source: Option<HashMap<String, String>>,
) -> Result<LoadedConfig, ConfigError> {
    let origin = ConfigOrigin::discover(&input, source.as_ref())?;
    let settings = build_settings(&origin.files, source, &input.overrides)?;
    Ok(LoadedConfig { settings, origin })
}

fn load_worker_with_source(
    input: ConfigInput,
    source: Option<HashMap<String, String>>,
) -> Result<LoadedWorkerConfig, ConfigError> {
    let origin = ConfigOrigin::discover(&input, source.as_ref())?;
    let settings = build_worker_settings(&origin.files, source, &input.overrides)?;
    Ok(LoadedWorkerConfig { settings, origin })
}

fn build_settings(
    files: &[PathBuf],
    source: Option<HashMap<String, String>>,
    overrides: &ConfigOverrides,
) -> Result<AppConfig, ConfigError> {
    let raw = layered_config(files, source, overrides)?
        .try_deserialize::<RawAppConfig>()
        .map_err(|source| ConfigError::Deserialize { source })?;

    AppConfig::try_from(raw)
}

fn build_worker_settings(
    files: &[PathBuf],
    source: Option<HashMap<String, String>>,
    overrides: &ConfigOverrides,
) -> Result<WorkerProcessConfig, ConfigError> {
    let raw = layered_config(files, source, overrides)?
        .try_deserialize::<RawWorkerProcessConfig>()
        .map_err(|source| ConfigError::Deserialize { source })?;

    WorkerProcessConfig::try_from(raw)
}

fn layered_config(
    files: &[PathBuf],
    source: Option<HashMap<String, String>>,
    overrides: &ConfigOverrides,
) -> Result<Config, ConfigError> {
    let mut builder = Config::builder();

    for path in files {
        builder = builder.add_source(File::from(path.clone()));
    }

    builder = builder.add_source(environment_source(source.clone()));

    if overrides.observability.filter.is_none()
        && let Some(filter) = rust_log_filter(source.as_ref())
    {
        builder = builder
            .set_override("observability.filter", filter)
            .map_err(|source| ConfigError::Build { source })?;
    }

    builder = overrides.apply(builder)?;

    builder.build().map_err(|source| ConfigError::Build { source })
}

fn config_files(explicit: Option<ExplicitPath>) -> Result<Vec<PathBuf>, ConfigError> {
    if let Some(explicit) = explicit {
        if !explicit.path.exists() {
            return Err(ConfigError::MissingExplicitPath {
                key: explicit.source.key(),
                path: explicit.path,
            });
        }
        return Ok(vec![explicit.path]);
    }

    Ok(DEFAULT_CONFIG_CANDIDATES.iter().map(PathBuf::from).filter(|path| path.exists()).collect())
}

fn environment_source(source: Option<HashMap<String, String>>) -> Environment {
    let env = Environment::with_prefix(ENV_PREFIX)
        .prefix_separator(ENV_SEPARATOR)
        .separator(ENV_SEPARATOR)
        .ignore_empty(true)
        .try_parsing(true);

    match source {
        Some(source) => env.source(Some(source.into_iter().collect())),
        None => env,
    }
}

fn explicit_path(
    path: &ConfigPath,
    source: Option<&HashMap<String, String>>,
) -> Option<ExplicitPath> {
    match path {
        ConfigPath::Auto => env_value(source, CONFIG_PATH_ENV).map(|path| ExplicitPath {
            source: ConfigPathSource::Environment,
            path: PathBuf::from(path),
        }),
        ConfigPath::Explicit { source, path } => {
            Some(ExplicitPath { source: *source, path: path.clone() })
        }
    }
}

fn environment_layer(source: Option<&HashMap<String, String>>) -> EnvironmentLayer {
    match source {
        Some(source) => EnvironmentLayer::from_source(source),
        None => {
            let prefix = env_prefix();
            if env::vars_os().filter_map(|(key, _)| key.into_string().ok()).any(|key| {
                key == CONFIG_PATH_ENV || key == RUST_LOG_ENV || key.starts_with(&prefix)
            }) {
                EnvironmentLayer::Present
            } else {
                EnvironmentLayer::Absent
            }
        }
    }
}

fn rust_log_filter(source: Option<&HashMap<String, String>>) -> Option<String> {
    if env_key_present(source, OBSERVABILITY_FILTER_ENV) {
        return None;
    }
    env_value(source, RUST_LOG_ENV)
}

fn env_key_present(source: Option<&HashMap<String, String>>, key: &str) -> bool {
    match source {
        Some(source) => source.contains_key(key),
        None => env::var_os(key).is_some(),
    }
}

fn env_value(source: Option<&HashMap<String, String>>, key: &str) -> Option<String> {
    match source {
        Some(source) => source.get(key).cloned(),
        None => env::var_os(key).map(|value| value.to_string_lossy().into_owned()),
    }
}

#[inline(always)]
fn env_prefix() -> String {
    format!("{ENV_PREFIX}{ENV_SEPARATOR}")
}

#[inline(always)]
fn duration(value: Duration) -> String {
    humantime::format_duration(value).to_string()
}

fn paths(paths: &[PathBuf]) -> Vec<Value> {
    paths.iter().map(|path| Value::from(path.display().to_string())).collect()
}
