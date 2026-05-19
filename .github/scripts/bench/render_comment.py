#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
from pathlib import Path

from lib import fmt_duration_ns, fmt_num, fmt_pct, load_json, short_sha, status_label


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--run-url")
    p.add_argument("--report-url")
    p.add_argument("--criterion-url")
    p.add_argument("--gungraun-url")
    p.add_argument("--title", default="Parser benchmarks")
    return p


def fmt_value(row: dict, which: str) -> str:
    value = row[f"{which}_value"]
    if row["suite"] == "criterion":
        return fmt_duration_ns(value)
    return fmt_num(value)


def row_line(row: dict) -> str:
    return (
        f"| {row['suite']} | {row['benchmark']} | {row['tool'] or '-'} | {row['metric']} | "
        f"{fmt_value(row, 'baseline')} | {fmt_value(row, 'current')} | {fmt_pct(row['delta_pct'])} | "
        f"{status_label(row['status'])} |"
    )


def section(title: str, rows: list[dict]) -> list[str]:
    if not rows:
        return [f"### {title}", "", "None.", ""]
    lines = [
        f"### {title}",
        "",
        "| Suite | Benchmark | Tool | Metric | Base | New | Delta | Verdict |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    lines.extend(row_line(row) for row in rows)
    lines.append("")
    return lines


def links(args) -> str:
    items = []
    if args.run_url:
        items.append(f"[workflow run]({args.run_url})")
    if args.report_url:
        items.append(f"[report artifact]({args.report_url})")
    if args.criterion_url:
        items.append(f"[criterion artifact]({args.criterion_url})")
    if args.gungraun_url:
        items.append(f"[gungraun artifact]({args.gungraun_url})")
    if not items:
        return ""
    return "Artifacts: " + ", ".join(items)


def main() -> None:
    args = build_parser().parse_args()
    data = load_json(args.input)
    baseline = data["baseline"]
    lines = [
        "<!-- parser-benchmark-report -->",
        f"## {args.title}",
        "",
        f"Verdict: **{data['verdict'].upper()}**",
        "",
        f"Baseline: `{baseline['name']}` from `{short_sha(baseline['sha'])}` ({baseline['source']})",
        "",
        f"Current: `{short_sha(data['head_sha'])}`",
        "",
    ]
    extra = links(args)
    if extra:
        lines.extend([extra, ""])
    lines.extend(
        [
            "| Bucket | Count |",
            "| --- | ---: |",
            f"| Blocking regressions | {data['totals']['blocking']} |",
            f"| Warnings | {data['totals']['warnings']} |",
            f"| Improvements | {data['totals']['improvements']} |",
            "",
        ]
    )

    suite_errors = [
        item for item in data["suite_status"].values() if item.get("status") == "error"
    ]
    if suite_errors:
        lines.extend(["### Suite errors", ""])
        for item in suite_errors:
            lines.append(f"- `{item['suite']}`: {item['error']}")
        lines.append("")

    lines.extend(section("Blocking regressions", data["blocking"]))
    lines.extend(section("Warnings", data["warnings"]))

    lines.extend(["<details>", "<summary>Full benchmark table</summary>", ""])
    lines.extend(
        [
            "| Suite | Benchmark | Tool | Metric | Base | New | Delta | Verdict |",
            "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
        ]
    )
    lines.extend(row_line(row) for row in data["rows"])
    lines.extend(["", "</details>", ""])

    Path(args.output).write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
