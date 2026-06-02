use std::collections::HashMap;

use canary_server::LoadedConfig;

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
