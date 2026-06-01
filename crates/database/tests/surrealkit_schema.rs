use std::fs;
use std::path::Path;

use surrealdb::Surreal;
use surrealdb::engine::any::{Any, connect};
use surrealdb::opt::Config;
use surrealdb::opt::capabilities::Capabilities;

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn surql(path: &str) -> String {
    fs::read_to_string(root().join(path)).expect("surql fixture should exist")
}

async fn db() -> Surreal<Any> {
    let cfg = Config::new().capabilities(Capabilities::all());
    let db = connect(("mem://", cfg)).await.expect("mem db should connect");
    db.use_ns("test").use_db("app").await.expect("namespace selection should work");
    db
}

#[tokio::test]
async fn surrealkit_setup_and_schema_apply_cleanly() {
    let db = db().await;

    db.query(surql("database/setup.surql"))
        .await
        .expect("setup query should execute")
        .check()
        .expect("setup query should validate");

    db.query(surql("database/schema/file_blob.surql"))
        .await
        .expect("schema query should execute")
        .check()
        .expect("schema query should validate");

    let info: Option<serde_json::Value> = db
        .query("INFO FOR DB")
        .await
        .expect("info query should execute")
        .take(0)
        .expect("info query should return row zero");

    let tables = info
        .as_ref()
        .and_then(|value| value["tables"].as_object())
        .expect("tables object should be present");

    assert!(tables.contains_key("__entity"));
    assert!(tables.contains_key("__rollout"));
    assert!(tables.contains_key("file_blob"));
}
