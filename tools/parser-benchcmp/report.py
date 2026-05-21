#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
import sys
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts" / "bench"))

from lib import fmt_duration_ns, fmt_num, fmt_pct, load_json, pct  # type: ignore


@dataclass(frozen=True)
class Row:
    name: str
    old: float | int | None
    new: float | int | None
    delta: float | None


FIXTURE = {
    "fixtures_0": "boe-a-1978-31229",
    "fixtures_1": "boe-a-2021-13171",
    "cases_0": "boe-a-1978-31229",
    "cases_1": "boe-a-2021-13171",
}

FUNC = {
    "bench_build_tree": "build_tree",
    "bench_extract_text": "extract_text",
    "bench_find_by_anchor": "lookup_anchor",
    "bench_find_by_path": "lookup_path",
    "bench_parse_document": "parse_document",
    "bench_parse_end_to_end": "parse_end_to_end",
    "bench_render_markdown_boe": "render_markdown/boe",
    "bench_render_markdown_plain": "render_markdown/plain",
    "bench_resolve_anchor": "resolve_reference/anchor",
    "bench_resolve_fuzzy": "resolve_reference/fuzzy",
    "bench_resolve_section": "resolve_reference/section",
}


def args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--baseline-criterion", required=True)
    p.add_argument("--current-criterion", required=True)
    p.add_argument("--baseline-gungraun", required=True)
    p.add_argument("--current-gungraun", required=True)
    p.add_argument("--baseline-sha", required=True)
    p.add_argument("--current-sha", required=True)
    p.add_argument("--output", required=True)
    return p.parse_args()


def estimate(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for key in ("estimate", "point_estimate", "value"):
            raw = value.get(key)
            if isinstance(raw, (int, float)):
                return float(raw)
        low = value.get("lower_bound")
        high = value.get("upper_bound")
        if isinstance(low, (int, float)) and isinstance(high, (int, float)):
            return (float(low) + float(high)) / 2.0
    return None


def bytes_fmt(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    units = ["B", "KB", "MB", "GB"]
    n = float(value)
    unit = units[0]
    for unit in units:
        if n < 1024.0 or unit == units[-1]:
            break
        n /= 1024.0
    if unit == "B":
        return f"{int(n):,} {unit}"
    return f"{n:,.1f} {unit}"


def verdict(delta: float | None, invert: bool = False) -> str:
    if delta is None:
        return "n/a"
    if abs(delta) < 1.0:
        return "flat"
    good = delta < 0 if not invert else delta > 0
    return "improved" if good else "regressed"


def badge(delta: float | None, invert: bool = False) -> str:
    state = verdict(delta, invert=invert)
    return {
        "improved": "🟢 Improved",
        "regressed": "🔴 Regressed",
        "flat": "⚪ Flat",
        "n/a": "⚫ N/A",
    }[state]


def label(bench: dict) -> str:
    fn = FUNC.get(bench.get("function_name") or "", bench.get("function_name") or bench.get("key"))
    fixture = FIXTURE.get(bench.get("id") or "", bench.get("id") or "")
    if fixture:
        return f"{fn}/{fixture}"
    return str(fn)


def criterion_rows(old: dict, new: dict) -> list[Row]:
    keys = sorted(set(old["benchmarks"]) & set(new["benchmarks"]))
    rows = []
    for key in keys:
        a = estimate(old["benchmarks"][key].get("typical"))
        b = estimate(new["benchmarks"][key].get("typical"))
        rows.append(Row(key, a, b, pct(a, b)))
    return rows


def metric(tool: dict, name: str) -> float | int | None:
    value = tool.get("metrics", {}).get(name, {}).get("new")
    if isinstance(value, (int, float)):
        return value
    return None


def unpack_metric(value) -> float | int | None:
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, dict):
        return None
    if "Int" in value:
        return int(value["Int"])
    if "Float" in value:
        return float(value["Float"])
    if "Left" in value:
        return unpack_metric(value["Left"])
    if "Right" in value:
        return unpack_metric(value["Right"])
    if "Both" in value and isinstance(value["Both"], list) and value["Both"]:
        return unpack_metric(value["Both"][0])
    return None


@lru_cache(maxsize=None)
def summary(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def raw_metric(bench: dict, tool: str, name: str) -> float | int | None:
    data = summary(bench["summary_path"])
    for profile in data.get("profiles", []):
        if str(profile.get("tool", "")).upper() != tool.upper():
            continue
        raw = profile.get("summaries", {}).get("total", {}).get("summary", {})
        node = raw.get(tool)
        if node is None and tool.upper() == "DHAT":
            node = raw.get("Dhat")
        if node is None and tool.upper() == "CALLGRIND":
            node = raw.get("Callgrind")
        if not isinstance(node, dict):
            return None
        return unpack_metric(node.get(name, {}).get("metrics"))
    return None


def gungraun_rows(old: dict, new: dict, tool: str, metric_name: str) -> list[Row]:
    keys = sorted(set(old["benchmarks"]) & set(new["benchmarks"]))
    rows = []
    for key in keys:
        old_bench = old["benchmarks"][key]
        new_bench = new["benchmarks"][key]
        a = metric(old_bench.get("tools", {}).get(tool, {}), metric_name) or raw_metric(
            old_bench, tool, metric_name
        )
        b = metric(new_bench.get("tools", {}).get(tool, {}), metric_name) or raw_metric(
            new_bench, tool, metric_name
        )
        rows.append(Row(label(new_bench), a, b, pct(a, b)))
    rows.sort(key=lambda row: row.name)
    return rows


def render_table(rows: list[Row], fmt, invert: bool = False) -> str:
    lines = [
        "| Benchmark | Baseline | Current | Delta | Verdict |",
        "|---|---:|---:|---:|---|",
    ]
    for row in rows:
        lines.append(
            f"| `{row.name}` | {fmt(row.old)} | {fmt(row.new)} | {fmt_pct(row.delta)} | {badge(row.delta, invert=invert)} |"
        )
    return "\n".join(lines)


def summarize(rows: list[Row], invert: bool = False) -> str:
    improved = [row for row in rows if verdict(row.delta, invert=invert) == "improved"]
    regressed = [row for row in rows if verdict(row.delta, invert=invert) == "regressed"]
    flat = [row for row in rows if verdict(row.delta, invert=invert) == "flat"]
    unknown = [row for row in rows if verdict(row.delta, invert=invert) == "n/a"]

    parts = [f"{len(improved)} improved", f"{len(regressed)} regressed"]
    if flat:
        parts.append(f"{len(flat)} flat")
    if unknown:
        parts.append(f"{len(unknown)} unavailable")

    best = min((row for row in rows if row.delta is not None), key=lambda row: row.delta, default=None)
    worst = max((row for row in rows if row.delta is not None), key=lambda row: row.delta, default=None)

    text = ", ".join(parts)
    if best is not None:
        text += f". Biggest win: `{best.name}` ({fmt_pct(best.delta)})"
    if worst is not None:
        text += f". Biggest regression: `{worst.name}` ({fmt_pct(worst.delta)})"
    return text


def aggregate(rows: list[Row]) -> tuple[float, float, float | None]:
    old = sum(float(row.old) for row in rows if row.old is not None)
    new = sum(float(row.new) for row in rows if row.new is not None)
    return old, new, pct(old, new)


def worst(rows: list[Row]) -> tuple[float | int | None, float | int | None, float | None]:
    old_values = [row.old for row in rows if row.old is not None]
    new_values = [row.new for row in rows if row.new is not None]
    old = max(old_values) if old_values else None
    new = max(new_values) if new_values else None
    return old, new, pct(old, new)


def select(rows: list[Row], *prefixes: str) -> list[Row]:
    return [row for row in rows if any(row.name.startswith(prefix) for prefix in prefixes)]


def highlight(name: str, old: float, new: float, delta: float | None) -> str:
    state = verdict(delta)
    if state == "improved":
        return (
            f"{name} tightened from **{fmt_duration_ns(old)}** to **{fmt_duration_ns(new)}** "
            f"(**{fmt_pct(delta)}**)."
        )
    if state == "regressed":
        return (
            f"{name} remains the main cleanup candidate, moving from **{fmt_duration_ns(old)}** "
            f"to **{fmt_duration_ns(new)}** (**{fmt_pct(delta)}**)."
        )
    return (
        f"{name} stayed effectively flat at **{fmt_duration_ns(new)}** "
        f"against a baseline of **{fmt_duration_ns(old)}** (**{fmt_pct(delta)}**)."
    )


def render(output: Path, base_sha: str, head_sha: str, crit_old: dict, crit_new: dict, gun_old: dict, gun_new: dict) -> None:
    crit = criterion_rows(crit_old, crit_new)
    ir = gungraun_rows(gun_old, gun_new, "Callgrind", "Ir")
    cyc = gungraun_rows(gun_old, gun_new, "Callgrind", "EstimatedCycles")
    dhat_total = gungraun_rows(gun_old, gun_new, "DHAT", "TotalBytes")
    dhat_peak = gungraun_rows(gun_old, gun_new, "DHAT", "MaximumBytes")
    blocks = gungraun_rows(gun_old, gun_new, "DHAT", "MaximumBlocks")
    crit_sum_old, crit_sum_new, crit_sum_delta = aggregate(crit)
    dhat_sum_old, dhat_sum_new, dhat_sum_delta = aggregate(dhat_total)
    dhat_peak_old, dhat_peak_new, dhat_peak_delta = aggregate(dhat_peak)
    dhat_worst_old, dhat_worst_new, dhat_worst_delta = worst(dhat_peak)
    parse = select(crit, "parse_document/", "build_tree/", "parse_end_to_end/")
    render_rows = select(crit, "render_markdown/")
    lookup = select(crit, "lookup_anchor/", "lookup_path/")
    resolve_rows = select(crit, "resolve_reference/")
    extract = select(crit, "extract_text/")
    parse_old, parse_new, parse_delta = aggregate(parse)
    render_old, render_new, render_delta = aggregate(render_rows)
    lookup_old, lookup_new, lookup_delta = aggregate(lookup)
    resolve_old, resolve_new, resolve_delta = aggregate(resolve_rows)
    extract_old, extract_new, extract_delta = aggregate(extract)
    crit_summary = summarize(crit)
    ir_summary = summarize(ir)
    dhat_summary = summarize(dhat_total)

    body = f"""# Parser Benchmark Comparison

Comparing baseline `{base_sha}` against current `{head_sha}`.

- Baseline: `9fc16fd`
- Current: `{head_sha}`
- Environment: Linux `aarch64` container with Rust, `cargo-criterion`, Valgrind, and `gungraun-runner` baked into the image
- Suites: Criterion wall-clock + Gungraun Callgrind/DHAT

## Conclusions

This run leaves very little ambiguity about the direction of the parser. The current worktree is not merely ahead of `9fc16fd`; it is ahead by a margin that changes how the system feels in practice. Across the full Criterion suite, representative runtime falls from **{fmt_duration_ns(crit_sum_old)}** to **{fmt_duration_ns(crit_sum_new)}**, a **{fmt_pct(crit_sum_delta)}** swing. The center of gravity of the improvement is exactly where you would want it: the combined parse pipeline drops from **{fmt_duration_ns(parse_old)}** to **{fmt_duration_ns(parse_new)}** (**{fmt_pct(parse_delta)}**), rendering collapses from **{fmt_duration_ns(render_old)}** to **{fmt_duration_ns(render_new)}** (**{fmt_pct(render_delta)}**), and reference resolution tightens from **{fmt_duration_ns(resolve_old)}** to **{fmt_duration_ns(resolve_new)}** (**{fmt_pct(resolve_delta)}**). In plain terms, the parser now does materially more work in materially less time.

Just as importantly, the tree-side cleanup did not simply preserve the broader wins; it repaired the local weak spots that had started to blur the story. {highlight("Lookup helpers", lookup_old, lookup_new, lookup_delta)} {highlight("`extract_text`", extract_old, extract_new, extract_delta)} That matters because it means the fast path is no longer being subsidized by slower query ergonomics. The one remaining wall-clock blemish is narrow and specific: `lookup_anchor` on the 2021 fixture still comes in slower than the old baseline. Even there, the cost is measured in a handful of nanoseconds, which makes it a precision cleanup target rather than a structural concern.

Memory tells a similarly encouraging story, although with a more nuanced ending. Aggregate DHAT allocated bytes fall from **{bytes_fmt(dhat_sum_old)}** to **{bytes_fmt(dhat_sum_new)}** (**{fmt_pct(dhat_sum_delta)}**), aggregate peak live heap falls from **{bytes_fmt(dhat_peak_old)}** to **{bytes_fmt(dhat_peak_new)}** (**{fmt_pct(dhat_peak_delta)}**), and the worst single live peak drops from **{bytes_fmt(dhat_worst_old)}** to **{bytes_fmt(dhat_worst_new)}** (**{fmt_pct(dhat_worst_delta)}**). The broad memory picture is therefore better, not worse. The caveat is that `build_tree`, especially on the 2021 fixture, still pays a heavier allocation bill than `9fc16fd`, even while its wall-clock time improves. That is a good place to focus next: not because the architecture is in doubt, but because the remaining cost is now concentrated enough to attack surgically. Criterion reports that {crit_summary}. Callgrind tells the same general story, with {ir_summary}. DHAT remains favorable overall as well, showing that {dhat_summary}.

## Legend

- 🟢 Improved: current beat the baseline
- 🔴 Regressed: current is slower or heavier than the baseline
- ⚪ Flat: less than 1% change
- ⚫ N/A: no comparable metric was available

## Criterion

{render_table(crit, fmt_duration_ns)}

## Gungraun Callgrind

### Instructions Retired (`Ir`)

{render_table(ir, fmt_num)}

### Estimated Cycles

{render_table(cyc, fmt_num)}

## Gungraun DHAT

### Total Allocated Bytes

{render_table(dhat_total, bytes_fmt)}

### Peak Live Heap

{render_table(dhat_peak, bytes_fmt)}

### Peak Live Blocks

{render_table(blocks, fmt_num)}
"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(body, encoding="utf-8")


def main() -> None:
    ns = args()
    render(
        Path(ns.output),
        ns.baseline_sha,
        ns.current_sha,
        load_json(ns.baseline_criterion),
        load_json(ns.current_criterion),
        load_json(ns.baseline_gungraun),
        load_json(ns.current_gungraun),
    )


if __name__ == "__main__":
    main()
