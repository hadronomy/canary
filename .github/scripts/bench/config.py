#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
from pathlib import Path

from lib import load_thresholds


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--format", choices=["json", "github-output"], default="json")
    return p


def main() -> None:
    args = build_parser().parse_args()
    cfg = load_thresholds(args.input)
    data = {
        "criterion_warn_pct": str(cfg["criterion"]["warn_pct"]),
        "gungraun_baseline": cfg["gungraun"]["baseline_name"],
        "gungraun_callgrind_limits": cfg["gungraun"]["callgrind_limits"],
        "gungraun_dhat_limits": cfg["gungraun"]["dhat_limits"],
    }
    if args.format == "json":
        for key, value in data.items():
            print(f'"{key}": "{value}"')
        return

    for key, value in data.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
