#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lib import dump_json, now


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    return p


def normalize(path: Path) -> dict:
    benches: dict[str, dict] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        msg = json.loads(line)
        if msg.get("reason") != "benchmark-complete":
            continue
        benches[msg["id"]] = {
            "id": msg["id"],
            "report_directory": msg.get("report_directory"),
            "unit": msg.get("unit"),
            "sample_count": len(msg.get("measured_values", [])),
            "typical": msg.get("typical"),
            "mean": msg.get("mean"),
            "median": msg.get("median"),
            "slope": msg.get("slope"),
            "throughput": msg.get("throughput", []),
        }
    return {
        "schema_version": 1,
        "suite": "criterion",
        "generated_at": now(),
        "benchmarks": benches,
    }


def main() -> None:
    args = build_parser().parse_args()
    dump_json(args.output, normalize(Path(args.input)))


if __name__ == "__main__":
    main()
