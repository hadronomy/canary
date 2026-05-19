## Parser Benchmarks

This crate ships two complementary benchmark harnesses:

- `parser_criterion`: wall-clock benchmarking with statistical analysis and HTML reports
- `parser_gungraun`: one-shot Valgrind-backed profiling for instruction counts, heap behavior, and flamegraphs

### Criterion

Run the full suite:

```bash
cargo bench -p document-hierarchy --bench parser_criterion
```

Save or compare a baseline:

```bash
cargo bench -p document-hierarchy --bench parser_criterion -- --save-baseline main
cargo bench -p document-hierarchy --bench parser_criterion -- --baseline main
```

Reports are written under `target/criterion`.

### Gungraun

Install the runner first:

```bash
cargo install gungraun-runner
```

Then run:

```bash
cargo bench -p document-hierarchy --bench parser_gungraun
```

Profiles and flamegraphs are written under `target/gungraun`.

### Fixtures

Both harnesses benchmark the bundled BOE XML fixtures in `examples/assets` and cover:

- XML to `LegalDocument`
- `LegalDocument` to `DocumentTree`
- end-to-end parse
- markdown rendering
- anchor and path lookup
- cross-reference resolution
- subtree text extraction

### Platform note

Criterion runs well locally on macOS and Linux. Gungraun depends on Valgrind tooling, so Linux is the expected execution environment for the full profiling workflow and CI regression checks.
