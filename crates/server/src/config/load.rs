use std::collections::HashMap;
use std::path::PathBuf;
use std::{env, fmt};

use config::{Config, Environment, File};

use super::defaults::{CONFIG_PATH_ENV, DEFAULT_CONFIG_CANDIDATES, ENV_PREFIX, ENV_SEPARATOR};
use super::raw::RawAppConfig;
use super::types::AppConfig;
use crate::error::ConfigError;

#[derive(Debug, Clone, Default)]
pub struct LoadedConfig {
    pub settings: AppConfig,
    pub origin: ConfigOrigin,
}

impl LoadedConfig {
    pub fn load() -> Result<Self, ConfigError> {
        let origin = ConfigOrigin::discover()?;
        let settings = build_settings(&origin.files, None)?;
        Ok(Self { settings, origin })
    }

    #[doc(hidden)]
    pub fn load_from_environment_map(source: HashMap<String, String>) -> Result<Self, ConfigError> {
        let origin = ConfigOrigin {
            files: config_files(None)?,
            environment: EnvironmentLayer::from_source(&source),
        };
        let settings = build_settings(&origin.files, Some(source))?;
        Ok(Self { settings, origin })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigOrigin {
    pub files: Vec<PathBuf>,
    pub environment: EnvironmentLayer,
}

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

impl ConfigOrigin {
    fn discover() -> Result<Self, ConfigError> {
        let explicit = env::var_os(CONFIG_PATH_ENV).map(PathBuf::from);
        let prefix = env_prefix();
        let environment = if env::vars_os()
            .filter_map(|(key, _)| key.into_string().ok())
            .any(|key| key == CONFIG_PATH_ENV || key.starts_with(&prefix))
        {
            EnvironmentLayer::Present
        } else {
            EnvironmentLayer::Absent
        };
        Ok(Self { files: config_files(explicit)?, environment })
    }
}

impl fmt::Display for ConfigOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.files.as_slice(), self.environment) {
            ([], EnvironmentLayer::Present) => f.write_str("defaults + environment"),
            ([], EnvironmentLayer::Absent) => f.write_str("defaults"),
            ([file], EnvironmentLayer::Present) => write!(f, "{} + environment", file.display()),
            ([file], EnvironmentLayer::Absent) => write!(f, "{}", file.display()),
            (files, environment) => {
                let joined = files
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                if matches!(environment, EnvironmentLayer::Present) {
                    write!(f, "{joined} + environment")
                } else {
                    f.write_str(&joined)
                }
            }
        }
    }
}

fn build_settings(
    files: &[PathBuf],
    source: Option<HashMap<String, String>>,
) -> Result<AppConfig, ConfigError> {
    let mut builder = Config::builder();

    for path in files {
        builder = builder.add_source(File::from(path.clone()));
    }

    builder = builder.add_source(environment_source(source));

    let raw = builder
        .build()
        .map_err(|source| ConfigError::Build { source })?
        .try_deserialize::<RawAppConfig>()
        .map_err(|source| ConfigError::Deserialize { source })?;

    AppConfig::try_from(raw)
}

fn config_files(explicit: Option<PathBuf>) -> Result<Vec<PathBuf>, ConfigError> {
    if let Some(path) = explicit {
        if !path.exists() {
            return Err(ConfigError::MissingExplicitPath { key: CONFIG_PATH_ENV, path });
        }
        return Ok(vec![path]);
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

fn env_prefix() -> String {
    format!("{ENV_PREFIX}{ENV_SEPARATOR}")
}
