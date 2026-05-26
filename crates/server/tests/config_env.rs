use std::collections::HashMap;
use std::path::Path;

use canary_server::LoadedConfig;

#[test]
fn loads_memory_mode_from_overrides() {
    let settings = LoadedConfig::load_from_environment_map(HashMap::from([
        ("CANARY_SERVER__DB__MODE__KIND".into(), "memory".into()),
        ("CANARY_SERVER__FILES__ROOT".into(), "tmp/test-blobs".into()),
    ]))
    .expect("config should load");

    assert!(matches!(settings.settings.db.mode, canary_server::config::SurrealMode::Embedded(_)));
    assert!(matches!(
        &settings.settings.files.backend,
        canary_server::config::FileBackendConfig::Local(local)
            if local.root.as_path() == Path::new("tmp/test-blobs")
    ));
}
