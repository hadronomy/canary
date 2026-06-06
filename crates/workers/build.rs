use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=schema/claim.fbs");
    println!("cargo:rustc-check-cfg=cfg(canary_generated_flatbuffers)");

    let Some(flatc) = find_flatc() else {
        println!(
            "cargo:warning=flatc was not found; using checked-in FlatBuffers bindings for claim.fbs"
        );
        return;
    };

    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    if let Err(err) = flatc_rust::Flatc::from_path(flatc).run(flatc_rust::Args {
        inputs: &[Path::new("schema/claim.fbs")],
        out_dir: &out,
        ..Default::default()
    }) {
        panic!("failed to generate FlatBuffers bindings for claim.fbs: {err}");
    }
    println!("cargo:rustc-cfg=canary_generated_flatbuffers");
}

fn find_flatc() -> Option<PathBuf> {
    ["/opt/homebrew/bin/flatc", "/usr/local/bin/flatc", "flatc"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| flatc_version(path).is_ok())
}

#[inline(always)]
fn flatc_version(path: &Path) -> std::io::Result<flatc_rust::Version> {
    flatc_rust::Flatc::from_path(path).version()
}
