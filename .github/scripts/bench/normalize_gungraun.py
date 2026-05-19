#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lib import dump_json, now, parse_either, parse_float


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True)
    p.add_argument("--output", required=True)
    return p


def parse_tool_summary(summary: dict) -> tuple[str | None, dict[str, dict]]:
    if not isinstance(summary, dict):
        return (None, {})
    for kind, metrics in summary.items():
        if kind not in {"CallgrindSummary", "DhatSummary", "ErrorSummary"}:
            continue
        rows: dict[str, dict] = {}
        for metric, value in metrics.items():
            current, old = parse_either(value.get("metrics"))
            diffs = value.get("diffs") or {}
            rows[metric] = {
                "new": current,
                "old": old,
                "diff_pct": parse_float(diffs.get("diff_pct")),
                "factor": parse_float(diffs.get("factor")),
            }
        return (kind, rows)
    return (None, {})


def parse_regressions(items: list[dict]) -> list[dict]:
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if "Soft" in item:
            value = item["Soft"]
            rows.append(
                {
                    "level": "soft",
                    "metric": value.get("metric"),
                    "new": value.get("new"),
                    "old": value.get("old"),
                    "diff_pct": parse_float(value.get("diff_pct")),
                    "limit": parse_float(value.get("limit")),
                }
            )
            continue
        if "Hard" in item:
            value = item["Hard"]
            rows.append(
                {
                    "level": "hard",
                    "metric": value.get("metric"),
                    "new": value.get("new"),
                    "diff": value.get("diff"),
                    "limit": value.get("limit"),
                }
            )
    return rows


def normalize(root: Path) -> dict:
    benches: dict[str, dict] = {}
    for path in sorted(root.rglob("summary.json")):
        summary = json.loads(path.read_text(encoding="utf-8"))
        module_path = summary.get("module_path", "unknown")
        bench_id = summary.get("id")
        key = f"{module_path}::{bench_id}" if bench_id else module_path
        label = f"{module_path} [{bench_id}]" if bench_id else module_path
        tools: dict[str, dict] = {}
        for profile in summary.get("profiles", []):
            tool = profile.get("tool")
            total = profile.get("summaries", {}).get("total", {})
            kind, metrics = parse_tool_summary(total.get("summary"))
            tools[tool] = {
                "summary_kind": kind,
                "metrics": metrics,
                "regressions": parse_regressions(total.get("regressions", [])),
            }
        benches[key] = {
            "key": key,
            "label": label,
            "module_path": module_path,
            "function_name": summary.get("function_name"),
            "id": bench_id,
            "baselines": summary.get("baselines"),
            "summary_path": str(path),
            "tools": tools,
        }
    return {
        "schema_version": 1,
        "suite": "gungraun",
        "generated_at": now(),
        "benchmarks": benches,
    }


def main() -> None:
    args = build_parser().parse_args()
    dump_json(args.output, normalize(Path(args.input_dir)))


if __name__ == "__main__":
    main()
