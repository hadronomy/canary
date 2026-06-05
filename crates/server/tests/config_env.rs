use std::collections::HashMap;
use std::net::SocketAddr;

use canary_server::{
    ConfigInput, ConfigOverrides, ConfigPath, ConfigPathSource, LoadedConfig,
    ObservabilityOverrides, ServerOverrides,
};

#[test]
fn loads_memory_mode_from_overrides() {
    let settings = LoadedConfig::load_from_environment_map(HashMap::from([
        ("CANARY_SERVER__DB__MODE__KIND".into(), "memory".into()),
        ("CANARY_SERVER__FILES__STORAGE__BUCKET".into(), "canary-test".into()),
        ("CANARY_SERVER__FILES__STORAGE__REGION".into(), "us-east-1".into()),
    ]))
    .expect("config should load");

    assert!(matches!(settings.settings.db.engine(), database::Engine::Memory));
    assert_eq!(settings.settings.files.storage.bucket, "canary-test");
    assert_eq!(settings.settings.files.storage.region, "us-east-1");
}

#[test]
fn rejects_removed_local_storage_setting() {
    let err = LoadedConfig::load_from_environment_map(HashMap::from([
        ("CANARY_SERVER__FILES__ROOT".into(), "tmp/test-blobs".into()),
        ("CANARY_SERVER__FILES__STORAGE__BUCKET".into(), "canary-test".into()),
        ("CANARY_SERVER__FILES__STORAGE__REGION".into(), "us-east-1".into()),
    ]))
    .expect_err("local storage setting should be rejected");

    assert!(matches!(err, canary_server::ConfigError::Deserialize { .. }));
}

#[test]
fn cli_overrides_environment_values() {
    let settings = LoadedConfig::load_with_environment_map(
        ConfigInput::new(
            ConfigPath::Auto,
            ConfigOverrides {
                server: ServerOverrides {
                    bind: Some("127.0.0.1:2222".parse().unwrap()),
                    ..ServerOverrides::default()
                },
                ..ConfigOverrides::default()
            },
        ),
        base_env_with([
            ("CANARY_SERVER__SERVER__BIND", "127.0.0.1:1111"),
            ("CANARY_SERVER__OBSERVABILITY__FILTER", "warn"),
        ]),
    )
    .expect("config should load");

    assert_eq!(settings.settings.server.bind, "127.0.0.1:2222".parse::<SocketAddr>().unwrap());
    assert_eq!(settings.settings.observability.filter, "warn");
}

#[test]
fn rust_log_is_below_canonical_environment_and_cli() {
    let settings = LoadedConfig::load_with_environment_map(
        ConfigInput::default(),
        base_env_with([("RUST_LOG", "trace"), ("CANARY_SERVER__OBSERVABILITY__FILTER", "info")]),
    )
    .expect("config should load");

    assert_eq!(settings.settings.observability.filter, "info");

    let settings = LoadedConfig::load_with_environment_map(
        ConfigInput::new(
            ConfigPath::Auto,
            ConfigOverrides {
                observability: ObservabilityOverrides {
                    filter: Some("error".to_owned()),
                    ..ObservabilityOverrides::default()
                },
                ..ConfigOverrides::default()
            },
        ),
        base_env_with([("RUST_LOG", "trace")]),
    )
    .expect("config should load");

    assert_eq!(settings.settings.observability.filter, "error");
}

#[test]
fn missing_cli_config_path_reports_cli_key() {
    let err = LoadedConfig::load_with_environment_map(
        ConfigInput::new(
            ConfigPath::Explicit {
                source: ConfigPathSource::Cli,
                path: "does-not-exist.toml".into(),
            },
            ConfigOverrides::default(),
        ),
        base_env_with([]),
    )
    .expect_err("missing cli config path should fail");

    assert!(matches!(err, canary_server::ConfigError::MissingExplicitPath { key: "--config", .. }));
}

fn base_env_with<const N: usize>(values: [(&str, &str); N]) -> HashMap<String, String> {
    HashMap::from_iter(
        [
            ("CANARY_SERVER__DB__MODE__KIND", "memory"),
            ("CANARY_SERVER__FILES__STORAGE__BUCKET", "canary-test"),
            ("CANARY_SERVER__FILES__STORAGE__REGION", "us-east-1"),
        ]
        .into_iter()
        .chain(values)
        .map(|(key, value)| (key.to_owned(), value.to_owned())),
    )
}
