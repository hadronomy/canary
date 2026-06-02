use std::collections::BTreeSet;
use std::path::PathBuf;
use std::{env, fs};

use rusty_figlet::FigletBuilder;
use shadow_rs::{CARGO_MANIFEST_DIR, CARGO_METADATA, CARGO_TREE, ShadowBuilder};

const FONT: &[u8] = include_bytes!("assets/fonts/3d-diagonal.flf");

fn main() {
    println!("cargo::rerun-if-changed=assets/fonts/3d-diagonal.flf");
    ShadowBuilder::builder()
        .deny_const(BTreeSet::from([CARGO_MANIFEST_DIR, CARGO_METADATA, CARGO_TREE]))
        .build()
        .expect("the server build metadata should be generated");

    let banner = FigletBuilder::new()
        .font_bytes(FONT)
        .build()
        .expect("the bundled banner font should be valid")
        .render("canary")
        .expect("the server banner should render")
        .to_string();
    assert!(banner.is_ascii(), "the generated server banner should contain ASCII art");
    let lines = banner.lines().skip_while(|line| line.trim().is_empty()).collect::<Vec<_>>();
    let width = lines.iter().map(|line| line.len()).max().unwrap_or_default();
    let row = lines.len().saturating_sub(2);
    let banner = format!("{}\n", lines.join("\n"));
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should provide OUT_DIR"));

    fs::write(out.join("banner.txt"), banner)
        .expect("the generated server banner should be written");
    fs::write(out.join("banner-layout.rs"), format!("({width}usize, {row}usize)"))
        .expect("the generated server banner layout should be written");
}
