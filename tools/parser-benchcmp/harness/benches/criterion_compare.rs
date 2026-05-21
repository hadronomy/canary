mod common;

use std::hint::black_box;
use std::time::Duration;

use common::{
    Fixture, QueryCase, extract_id, parser, render_boe, render_input, render_plain, resolver,
};
use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};

fn config() -> Criterion {
    Criterion::default()
        .configure_from_args()
        .measurement_time(Duration::from_secs(8))
        .sample_size(20)
}

fn bench_parse_document(c: &mut Criterion) {
    let parser = parser();
    let mut group = c.benchmark_group("parse_document");
    for fixture in Fixture::ALL {
        group.throughput(Throughput::Bytes(fixture.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.name()),
            &fixture,
            |b, fixture| {
                let bytes = fixture.bytes();
                b.iter_with_large_drop(|| {
                    black_box(parser.parse_bytes_document(black_box(bytes)).unwrap())
                });
            },
        );
    }
    group.finish();
}

fn bench_build_tree(c: &mut Criterion) {
    let parser = parser();
    let mut group = c.benchmark_group("build_tree");
    for fixture in Fixture::ALL {
        group.throughput(Throughput::Bytes(fixture.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.name()),
            &fixture,
            |b, fixture| {
                let doc = fixture.document();
                b.iter_with_large_drop(|| {
                    black_box(parser.build_tree(black_box(doc.blocks.as_slice())).unwrap())
                });
            },
        );
    }
    group.finish();
}

fn bench_parse_end_to_end(c: &mut Criterion) {
    let parser = parser();
    let mut group = c.benchmark_group("parse_end_to_end");
    for fixture in Fixture::ALL {
        group.throughput(Throughput::Bytes(fixture.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.name()),
            &fixture,
            |b, fixture| {
                let bytes = fixture.bytes();
                b.iter_with_large_drop(|| black_box(parser.parse_bytes(black_box(bytes)).unwrap()));
            },
        );
    }
    group.finish();
}

fn bench_render_markdown(c: &mut Criterion) {
    let mut plain = c.benchmark_group("render_markdown/plain");
    for fixture in Fixture::ALL {
        plain.throughput(Throughput::Bytes(fixture.len() as u64));
        plain.bench_with_input(
            BenchmarkId::from_parameter(fixture.name()),
            &fixture,
            |b, fixture| {
                let tree = fixture.tree();
                b.iter_with_large_drop(|| black_box(render_plain(black_box(tree))));
            },
        );
    }
    plain.finish();

    let mut boe = c.benchmark_group("render_markdown/boe");
    for fixture in Fixture::ALL {
        boe.throughput(Throughput::Bytes(fixture.len() as u64));
        boe.bench_with_input(
            BenchmarkId::from_parameter(fixture.name()),
            &fixture,
            |b, fixture| {
                b.iter_batched(
                    || render_input(*fixture),
                    |input| black_box(render_boe(input)),
                    BatchSize::LargeInput,
                );
            },
        );
    }
    boe.finish();
}

fn bench_lookup_anchor(c: &mut Criterion) {
    let mut group = c.benchmark_group("lookup_anchor");
    for case in QueryCase::ALL {
        group.bench_with_input(BenchmarkId::from_parameter(case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            b.iter(|| black_box(tree.find_by_anchor(black_box(case.anchor)).unwrap()));
        });
    }
    group.finish();
}

fn bench_lookup_path(c: &mut Criterion) {
    let mut group = c.benchmark_group("lookup_path");
    for case in QueryCase::ALL {
        group.bench_with_input(BenchmarkId::from_parameter(case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            let path = case.path_value();
            b.iter(|| black_box(tree.find_by_path(black_box(&path)).unwrap()));
        });
    }
    group.finish();
}

fn bench_resolve_reference(c: &mut Criterion) {
    let mut group = c.benchmark_group("resolve_reference");
    for case in QueryCase::ALL {
        group.bench_with_input(BenchmarkId::new("anchor", case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            let resolver = resolver(tree);
            let query = case.anchor_query();
            b.iter(|| black_box(resolver.resolve(black_box(query.as_str())).unwrap()));
        });
        group.bench_with_input(BenchmarkId::new("section", case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            let resolver = resolver(tree);
            let query = case.section_query();
            b.iter(|| black_box(resolver.resolve(black_box(query.as_str())).unwrap()));
        });
        group.bench_with_input(BenchmarkId::new("fuzzy", case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            let resolver = resolver(tree);
            b.iter(|| black_box(resolver.resolve(black_box(case.fuzzy)).unwrap()));
        });
    }
    group.finish();
}

fn bench_extract_text(c: &mut Criterion) {
    let mut group = c.benchmark_group("extract_text");
    for case in QueryCase::ALL {
        group.bench_with_input(BenchmarkId::from_parameter(case.name()), &case, |b, case| {
            let tree = case.fixture.tree();
            let id = extract_id(tree, case.anchor);
            b.iter_with_large_drop(|| black_box(tree.extract_text(black_box(id))));
        });
    }
    group.finish();
}

criterion_group!(
    name = benches;
    config = config();
    targets =
        bench_parse_document,
        bench_build_tree,
        bench_parse_end_to_end,
        bench_render_markdown,
        bench_lookup_anchor,
        bench_lookup_path,
        bench_resolve_reference,
        bench_extract_text
);
criterion_main!(benches);
