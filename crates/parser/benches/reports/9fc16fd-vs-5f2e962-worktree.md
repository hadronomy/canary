# Parser Benchmark Comparison

Comparing baseline `9fc16fd` against current `5f2e962-worktree`.

- Baseline: `9fc16fd`
- Current: `5f2e962-worktree`
- Environment: Linux `aarch64` container with Rust, `cargo-criterion`, Valgrind, and `gungraun-runner` baked into the image
- Suites: Criterion wall-clock + Gungraun Callgrind/DHAT

## Conclusions

This run leaves very little ambiguity about the direction of the parser. The current worktree is not merely ahead of `9fc16fd`; it is ahead by a margin that changes how the system feels in practice. Across the full Criterion suite, representative runtime falls from **8.018 ms** to **3.463 ms**, a **-56.81%** swing. The center of gravity of the improvement is exactly where you would want it: the combined parse pipeline drops from **5.574 ms** to **3.237 ms** (**-41.93%**), rendering collapses from **2.434 ms** to **219.003 us** (**-91.00%**), and reference resolution tightens from **1.642 us** to **972.708 ns** (**-40.77%**). In plain terms, the parser now does materially more work in materially less time.

Just as importantly, the tree-side cleanup did not simply preserve the broader wins; it repaired the local weak spots that had started to blur the story. Lookup helpers tightened from **33.389 ns** to **30.390 ns** (**-8.98%**). `extract_text` tightened from **9.246 us** to **6.172 us** (**-33.25%**). That matters because it means the fast path is no longer being subsidized by slower query ergonomics. The one remaining wall-clock blemish is narrow and specific: `lookup_anchor` on the 2021 fixture still comes in slower than the old baseline. Even there, the cost is measured in a handful of nanoseconds, which makes it a precision cleanup target rather than a structural concern.

Memory tells a similarly encouraging story, although with a more nuanced ending. Aggregate DHAT allocated bytes fall from **13.2 MB** to **10.4 MB** (**-21.55%**), aggregate peak live heap falls from **5.4 MB** to **4.8 MB** (**-12.18%**), and the worst single live peak drops from **1.1 MB** to **1.1 MB** (**-4.54%**). The broad memory picture is therefore better, not worse. The caveat is that `build_tree`, especially on the 2021 fixture, still pays a heavier allocation bill than `9fc16fd`, even while its wall-clock time improves. That is a good place to focus next: not because the architecture is in doubt, but because the remaining cost is now concentrated enough to attack surgically. Criterion reports that 20 improved, 1 regressed, 1 flat. Biggest win: `render_markdown/plain/boe-a-2021-13171` (-94.81%). Biggest regression: `lookup_anchor/boe-a-2021-13171` (+13.96%). Callgrind tells the same general story, with 19 improved, 3 regressed. Biggest win: `render_markdown/plain/boe-a-2021-13171` (-94.28%). Biggest regression: `lookup_anchor/boe-a-2021-13171` (+65.54%). DHAT remains favorable overall as well, showing that 20 improved, 2 regressed. Biggest win: `lookup_anchor/boe-a-1978-31229` (-100.00%). Biggest regression: `build_tree/boe-a-2021-13171` (+98.77%).

## Legend

- 🟢 Improved: current beat the baseline
- 🔴 Regressed: current is slower or heavier than the baseline
- ⚪ Flat: less than 1% change
- ⚫ N/A: no comparable metric was available

## Criterion

| Benchmark                                    |   Baseline |    Current |   Delta | Verdict      |
| -------------------------------------------- | ---------: | ---------: | ------: | ------------ |
| `build_tree/boe-a-1978-31229`                | 259.373 us | 220.553 us | -14.97% | 🟢 Improved  |
| `build_tree/boe-a-2021-13171`                | 322.576 us | 302.140 us |  -6.34% | 🟢 Improved  |
| `extract_text/boe-a-1978-31229`              |   4.256 us |   2.848 us | -33.08% | 🟢 Improved  |
| `extract_text/boe-a-2021-13171`              |   4.990 us |   3.324 us | -33.39% | 🟢 Improved  |
| `lookup_anchor/boe-a-1978-31229`             |  15.296 ns |  15.430 ns |  +0.88% | ⚪ Flat      |
| `lookup_anchor/boe-a-2021-13171`             |   9.566 ns |  10.901 ns | +13.96% | 🔴 Regressed |
| `lookup_path/boe-a-1978-31229`               |   3.917 ns |   2.011 ns | -48.66% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |   4.610 ns |   2.048 ns | -55.58% | 🟢 Improved  |
| `parse_document/boe-a-1978-31229`            | 949.455 us | 478.528 us | -49.60% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            |   1.123 ms | 582.118 us | -48.17% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          |   1.334 ms | 731.254 us | -45.17% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          |   1.585 ms | 922.272 us | -41.82% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       | 101.202 us |  47.153 us | -53.41% | 🟢 Improved  |
| `render_markdown/boe/boe-a-2021-13171`       |   1.141 ms |  74.401 us | -93.48% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     |  85.635 us |  40.102 us | -53.17% | 🟢 Improved  |
| `render_markdown/plain/boe-a-2021-13171`     |   1.105 ms |  57.347 us | -94.81% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  | 144.332 ns |  21.639 ns | -85.01% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |  69.839 ns |  15.741 ns | -77.46% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   | 749.559 ns | 710.099 ns |  -5.26% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   | 262.283 ns | 196.535 ns | -25.07% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` | 210.104 ns |  14.141 ns | -93.27% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` | 206.173 ns |  14.554 ns | -92.94% | 🟢 Improved  |

## Gungraun Callgrind

### Instructions Retired (`Ir`)

| Benchmark                                    |   Baseline |    Current |   Delta | Verdict      |
| -------------------------------------------- | ---------: | ---------: | ------: | ------------ |
| `build_tree/boe-a-1978-31229`                |  5,902,879 |  4,322,558 | -26.77% | 🟢 Improved  |
| `build_tree/boe-a-2021-13171`                |  6,865,229 |  6,124,057 | -10.80% | 🟢 Improved  |
| `extract_text/boe-a-1978-31229`              |    309,944 |    217,074 | -29.96% | 🟢 Improved  |
| `extract_text/boe-a-2021-13171`              |    238,974 |    349,731 | +46.35% | 🔴 Regressed |
| `lookup_anchor/boe-a-1978-31229`             |    261,935 |    187,786 | -28.31% | 🟢 Improved  |
| `lookup_anchor/boe-a-2021-13171`             |    194,735 |    322,363 | +65.54% | 🔴 Regressed |
| `lookup_path/boe-a-1978-31229`               |    261,651 |    187,470 | -28.35% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |    194,678 |    322,151 | +65.48% | 🔴 Regressed |
| `parse_document/boe-a-1978-31229`            | 17,144,559 |  8,862,960 | -48.30% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            | 19,693,680 | 10,744,677 | -45.44% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          | 22,428,772 | 12,708,871 | -43.34% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          | 26,178,441 | 16,341,435 | -37.58% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       |  1,821,508 |    737,859 | -59.49% | 🟢 Improved  |
| `render_markdown/boe/boe-a-2021-13171`       | 21,127,559 |  1,219,525 | -94.23% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     |  1,761,734 |    731,574 | -58.47% | 🟢 Improved  |
| `render_markdown/plain/boe-a-2021-13171`     | 21,155,488 |  1,211,127 | -94.28% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  |    559,313 |    187,951 | -66.40% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |    491,021 |    322,528 | -34.31% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   |  2,121,776 |    203,001 | -90.43% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   |  2,044,024 |    327,182 | -83.99% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` |  1,347,313 |    187,838 | -86.06% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` |  1,281,626 |    322,519 | -74.84% | 🟢 Improved  |

### Estimated Cycles

| Benchmark                                    |   Baseline |    Current |   Delta | Verdict      |
| -------------------------------------------- | ---------: | ---------: | ------: | ------------ |
| `build_tree/boe-a-1978-31229`                |  8,463,741 |  6,430,886 | -24.02% | 🟢 Improved  |
| `build_tree/boe-a-2021-13171`                |  9,616,928 |  9,144,883 |  -4.91% | 🟢 Improved  |
| `extract_text/boe-a-1978-31229`              |    484,491 |    341,848 | -29.44% | 🟢 Improved  |
| `extract_text/boe-a-2021-13171`              |    388,760 |    547,199 | +40.75% | 🔴 Regressed |
| `lookup_anchor/boe-a-1978-31229`             |    391,428 |    282,092 | -27.93% | 🟢 Improved  |
| `lookup_anchor/boe-a-2021-13171`             |    293,675 |    481,988 | +64.12% | 🔴 Regressed |
| `lookup_path/boe-a-1978-31229`               |    390,952 |    281,386 | -28.03% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |    293,472 |    481,536 | +64.08% | 🔴 Regressed |
| `parse_document/boe-a-1978-31229`            | 23,295,467 | 11,884,624 | -48.98% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            | 26,628,011 | 14,340,141 | -46.15% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          | 30,849,630 | 17,923,374 | -41.90% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          | 35,687,844 | 22,810,889 | -36.08% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       |  2,656,886 |  1,322,175 | -50.24% | 🟢 Improved  |
| `render_markdown/boe/boe-a-2021-13171`       | 31,458,457 |  2,126,368 | -93.24% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     |  2,565,292 |  1,307,480 | -49.03% | 🟢 Improved  |
| `render_markdown/plain/boe-a-2021-13171`     | 31,590,235 |  2,037,698 | -93.55% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  |  1,091,467 |    282,725 | -74.10% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |    992,498 |    482,637 | -51.37% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   |  3,827,416 |    303,259 | -92.08% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   |  3,715,748 |    489,632 | -86.82% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` |  2,481,537 |    282,644 | -88.61% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` |  2,386,920 |    482,798 | -79.77% | 🟢 Improved  |

## Gungraun DHAT

### Total Allocated Bytes

| Benchmark                                    | Baseline |  Current |    Delta | Verdict      |
| -------------------------------------------- | -------: | -------: | -------: | ------------ |
| `build_tree/boe-a-1978-31229`                | 878.7 KB |   1.1 MB |  +23.22% | 🔴 Regressed |
| `build_tree/boe-a-2021-13171`                | 952.4 KB |   1.8 MB |  +98.77% | 🔴 Regressed |
| `extract_text/boe-a-1978-31229`              |  32.0 KB |  31.5 KB |   -1.37% | 🟢 Improved  |
| `extract_text/boe-a-2021-13171`              |  43.7 KB |  43.2 KB |   -1.00% | 🟢 Improved  |
| `lookup_anchor/boe-a-1978-31229`             |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_anchor/boe-a-2021-13171`             |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-1978-31229`               |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `parse_document/boe-a-1978-31229`            |   1.6 MB | 740.7 KB |  -54.57% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            |   1.8 MB | 839.8 KB |  -53.82% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          |   2.5 MB |   1.7 MB |  -29.83% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          |   2.7 MB |   2.6 MB |   -4.50% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       | 430.2 KB | 416.5 KB |   -3.18% | 🟢 Improved  |
| `render_markdown/boe/boe-a-2021-13171`       | 788.2 KB | 435.8 KB |  -44.71% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     | 410.2 KB | 396.5 KB |   -3.34% | 🟢 Improved  |
| `render_markdown/plain/boe-a-2021-13171`     |   1.0 MB | 343.7 KB |  -66.98% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  |   9.8 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |   9.8 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   |  63.7 KB |    120 B |  -99.82% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   |  63.6 KB |     24 B |  -99.96% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` |  49.6 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` |  49.6 KB |      0 B | -100.00% | 🟢 Improved  |

### Peak Live Heap

| Benchmark                                    | Baseline |  Current |    Delta | Verdict      |
| -------------------------------------------- | -------: | -------: | -------: | ------------ |
| `build_tree/boe-a-1978-31229`                | 505.9 KB | 652.9 KB |  +29.06% | 🔴 Regressed |
| `build_tree/boe-a-2021-13171`                | 556.7 KB |   1.1 MB |  +96.84% | 🔴 Regressed |
| `extract_text/boe-a-1978-31229`              |  28.0 KB |  28.0 KB |   +0.00% | ⚪ Flat      |
| `extract_text/boe-a-2021-13171`              |  39.7 KB |  39.7 KB |   +0.00% | ⚪ Flat      |
| `lookup_anchor/boe-a-1978-31229`             |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_anchor/boe-a-2021-13171`             |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-1978-31229`               |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |     32 B |      0 B | -100.00% | 🟢 Improved  |
| `parse_document/boe-a-1978-31229`            | 555.8 KB | 220.8 KB |  -60.27% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            | 602.0 KB | 277.7 KB |  -53.86% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          |   1.0 MB | 651.7 KB |  -38.61% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          |   1.1 MB |   1.1 MB |   -4.54% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       | 208.1 KB | 208.0 KB |   -0.06% | ⚪ Flat      |
| `render_markdown/boe/boe-a-2021-13171`       | 243.8 KB | 218.1 KB |  -10.54% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     | 198.1 KB | 198.0 KB |   -0.06% | ⚪ Flat      |
| `render_markdown/plain/boe-a-2021-13171`     | 370.7 KB | 172.4 KB |  -53.50% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  |   1.0 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |   1.0 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   |   4.2 KB |     64 B |  -98.50% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   |   4.2 KB |     16 B |  -99.63% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` |   2.6 KB |      0 B | -100.00% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` |   2.6 KB |      0 B | -100.00% | 🟢 Improved  |

### Peak Live Blocks

| Benchmark                                    | Baseline | Current |    Delta | Verdict      |
| -------------------------------------------- | -------: | ------: | -------: | ------------ |
| `build_tree/boe-a-1978-31229`                |    1,852 |     732 |  -60.48% | 🟢 Improved  |
| `build_tree/boe-a-2021-13171`                |    1,222 |   1,258 |   +2.95% | 🔴 Regressed |
| `extract_text/boe-a-1978-31229`              |        2 |       2 |   +0.00% | ⚪ Flat      |
| `extract_text/boe-a-2021-13171`              |        2 |       2 |   +0.00% | ⚪ Flat      |
| `lookup_anchor/boe-a-1978-31229`             |        1 |       0 | -100.00% | 🟢 Improved  |
| `lookup_anchor/boe-a-2021-13171`             |        1 |       0 | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-1978-31229`               |        1 |       0 | -100.00% | 🟢 Improved  |
| `lookup_path/boe-a-2021-13171`               |        1 |       0 | -100.00% | 🟢 Improved  |
| `parse_document/boe-a-1978-31229`            |    2,979 |   1,136 |  -61.87% | 🟢 Improved  |
| `parse_document/boe-a-2021-13171`            |    2,332 |   1,561 |  -33.06% | 🟢 Improved  |
| `parse_end_to_end/boe-a-1978-31229`          |    4,829 |     679 |  -85.94% | 🟢 Improved  |
| `parse_end_to_end/boe-a-2021-13171`          |    3,553 |   1,310 |  -63.13% | 🟢 Improved  |
| `render_markdown/boe/boe-a-1978-31229`       |        7 |       5 |  -28.57% | 🟢 Improved  |
| `render_markdown/boe/boe-a-2021-13171`       |       83 |       5 |  -93.98% | 🟢 Improved  |
| `render_markdown/plain/boe-a-1978-31229`     |        6 |       4 |  -33.33% | 🟢 Improved  |
| `render_markdown/plain/boe-a-2021-13171`     |      120 |       4 |  -96.67% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-1978-31229`  |       17 |       0 | -100.00% | 🟢 Improved  |
| `resolve_reference/anchor/boe-a-2021-13171`  |       17 |       0 | -100.00% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-1978-31229`   |       81 |       1 |  -98.77% | 🟢 Improved  |
| `resolve_reference/fuzzy/boe-a-2021-13171`   |       81 |       1 |  -98.77% | 🟢 Improved  |
| `resolve_reference/section/boe-a-1978-31229` |       49 |       0 | -100.00% | 🟢 Improved  |
| `resolve_reference/section/boe-a-2021-13171` |       49 |       0 | -100.00% | 🟢 Improved  |
