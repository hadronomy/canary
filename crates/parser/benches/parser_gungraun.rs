mod common;

use std::hint::black_box;

use common::{Fixture, QueryCase, parser, resolver};
use gungraun::prelude::*;
use gungraun::{Callgrind, Dhat, FlamegraphConfig, LibraryBenchmarkConfig, main};

fn config() -> LibraryBenchmarkConfig {
    let mut cfg = LibraryBenchmarkConfig::default();
    cfg.tool(Callgrind::default().flamegraph(FlamegraphConfig::default())).tool(Dhat::default());
    cfg
}

#[library_benchmark]
#[benches::fixtures(
    args = [Fixture::Constitution1978, Fixture::Consolidated2021],
    setup = common::parse_input
)]
fn bench_parse_document(bytes: &'static [u8]) -> usize {
    black_box(parser().parse_bytes_document(black_box(bytes)).unwrap().blocks.len())
}

#[library_benchmark]
#[benches::fixtures(
    args = [Fixture::Constitution1978, Fixture::Consolidated2021],
    setup = common::build_input
)]
fn bench_build_tree(doc: document_hierarchy::parser::LegalDocument) -> usize {
    black_box(parser().build_tree(black_box(doc.blocks.as_slice())).unwrap().node_count())
}

#[library_benchmark]
#[benches::fixtures(
    args = [Fixture::Constitution1978, Fixture::Consolidated2021],
    setup = common::parse_input
)]
fn bench_parse_end_to_end(bytes: &'static [u8]) -> usize {
    black_box(parser().parse_bytes(black_box(bytes)).unwrap().node_count())
}

#[library_benchmark]
#[benches::fixtures(
    args = [Fixture::Constitution1978, Fixture::Consolidated2021],
    setup = common::render_input
)]
fn bench_render_markdown_plain(input: common::RenderInput) -> usize {
    black_box(common::render_plain(black_box(&input.tree)).len())
}

#[library_benchmark]
#[benches::fixtures(
    args = [Fixture::Constitution1978, Fixture::Consolidated2021],
    setup = common::render_input
)]
fn bench_render_markdown_boe(input: common::RenderInput) -> usize {
    black_box(common::render_boe(black_box(input)).len())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_find_by_anchor(input: common::QueryInput) -> usize {
    let id = black_box(input.tree.find_by_anchor(black_box(input.anchor)).unwrap());
    black_box(input.tree.path(id).depth())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_find_by_path(input: common::QueryInput) -> usize {
    let id = black_box(input.tree.find_by_path(black_box(&input.path)).unwrap());
    black_box(input.tree.path(id).depth())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_resolve_anchor(input: common::QueryInput) -> usize {
    let path = {
        let r = resolver(&input.tree);
        let id = black_box(r.resolve(black_box(input.anchor_query.as_str())).unwrap());
        input.tree.path(id)
    };
    black_box(path.depth())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_resolve_section(input: common::QueryInput) -> usize {
    let path = {
        let r = resolver(&input.tree);
        let id = black_box(r.resolve(black_box(input.section_query.as_str())).unwrap());
        input.tree.path(id)
    };
    black_box(path.depth())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_resolve_fuzzy(input: common::QueryInput) -> usize {
    let path = {
        let r = resolver(&input.tree);
        let id = black_box(r.resolve(black_box(input.fuzzy)).unwrap());
        input.tree.path(id)
    };
    black_box(path.depth())
}

#[library_benchmark]
#[benches::cases(args = [QueryCase::ALL[0], QueryCase::ALL[1]], setup = common::query_input)]
fn bench_extract_text(input: common::QueryInput) -> usize {
    let id = input.tree.find_by_anchor(input.anchor).unwrap();
    black_box(input.tree.extract_text(black_box(id)).len())
}

library_benchmark_group!(
    name = parse_group,
    benchmarks = [bench_parse_document, bench_build_tree, bench_parse_end_to_end]
);

library_benchmark_group!(
    name = render_group,
    benchmarks = [bench_render_markdown_plain, bench_render_markdown_boe]
);

library_benchmark_group!(
    name = query_group,
    benchmarks = [
        bench_find_by_anchor,
        bench_find_by_path,
        bench_resolve_anchor,
        bench_resolve_section,
        bench_resolve_fuzzy,
        bench_extract_text
    ]
);

main!(config = config(), library_benchmark_groups = [parse_group, render_group, query_group]);
