use std::collections::HashMap;
use std::path::Path;

use canary_server::LoadedConfig;

#[test]
fn loads_memory_mode_from_overrides() {
    let settings = LoadedConfig::load_from_environment_map(HashMap::from([
        ("db.mode.kind".into(), "memory".into()),
        ("files.root".into(), "tmp/test-blobs".into()),
    ]))
    .expect("config should load");

    assert!(matches!(settings.settings.db.mode, canary_server::config::SurrealMode::Embedded(_)));
    assert_eq!(settings.settings.files.root.as_path(), Path::new("tmp/test-blobs"));
}
