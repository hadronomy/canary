#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
from pathlib import Path

from lib import dump_json, load_json, load_thresholds, now, parse_float, pct, verdict_rank


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--thresholds", required=True)
    p.add_argument("--current-criterion")
    p.add_argument("--baseline-criterion")
    p.add_argument("--criterion-exit-code", type=int, default=0)
    p.add_argument("--current-gungraun")
    p.add_argument("--baseline-gungraun")
    p.add_argument("--gungraun-exit-code", type=int, default=0)
    p.add_argument("--repo", required=True)
    p.add_argument("--head-sha", required=True)
    p.add_argument("--base-sha")
    p.add_argument("--pr", type=int)
    p.add_argument("--baseline-sha")
    p.add_argument("--baseline-source", default="none")
    p.add_argument("--output", required=True)
    return p


def maybe(path: str | None):
    if not path:
        return None
    file = Path(path)
    if not file.exists():
        return None
    return load_json(file)


def criterion_rows(current: dict | None, baseline: dict | None, cfg: dict) -> tuple[list[dict], dict]:
    warn_pct = float(cfg["criterion"]["warn_pct"])
    rows: list[dict] = []
    status = {"suite": "criterion", "status": "ok", "error": None}
    if current is None:
        if baseline is None:
            status["status"] = "missing"
            return (rows, status)
        status["status"] = "error"
        status["error"] = "criterion summary missing"
        return (rows, status)

    current_benches = current.get("benchmarks", {})
    baseline_benches = (baseline or {}).get("benchmarks", {})
    for bench, item in sorted(current_benches.items()):
        current_value = parse_float(item.get("typical", {}).get("estimate"))
        baseline_value = parse_float(
            baseline_benches.get(bench, {}).get("typical", {}).get("estimate")
        )
        delta = pct(baseline_value, current_value)
        row = {
            "suite": "criterion",
            "benchmark": bench,
            "metric": "typical",
            "tool": None,
            "unit": item.get("typical", {}).get("unit") or item.get("unit"),
            "baseline_value": baseline_value,
            "current_value": current_value,
            "delta_pct": delta,
            "blocking": False,
            "note": None,
        }
        if baseline_value is None:
            row["status"] = "missing"
        elif delta is not None and delta >= warn_pct:
            row["status"] = "warn"
        elif delta is not None and delta <= -warn_pct:
            row["status"] = "improved"
        else:
            row["status"] = "ok"
        rows.append(row)

    if any(row["status"] == "warn" for row in rows):
        status["status"] = "warn"
    return (rows, status)


def benchmark_fallback(
    baseline: dict | None, key: str, tool: str, metric: str
) -> tuple[int | float | None, int | float | None, float | None]:
    if baseline is None:
        return (None, None, None)
    bench = baseline.get("benchmarks", {}).get(key)
    if bench is None:
        return (None, None, None)
    tool_data = bench.get("tools", {}).get(tool)
    if tool_data is None:
        return (None, None, None)
    metric_data = tool_data.get("metrics", {}).get(metric)
    if metric_data is None:
        return (None, None, None)
    old = metric_data.get("new")
    return (None, old, None)


def gungraun_rows(current: dict | None, baseline: dict | None, cfg: dict) -> tuple[list[dict], dict]:
    tracked = cfg["gungraun"]["tracked_metrics"]
    rows: list[dict] = []
    status = {"suite": "gungraun", "status": "ok", "error": None}
    if current is None:
        if baseline is None:
            status["status"] = "missing"
            return (rows, status)
        status["status"] = "error"
        status["error"] = "gungraun summary missing"
        return (rows, status)

    for key, item in sorted(current.get("benchmarks", {}).items()):
        for tool, metrics_cfg in tracked.items():
            tool_data = item.get("tools", {}).get(tool)
            if tool_data is None:
                continue
            regressions = {
                reg.get("metric"): reg for reg in tool_data.get("regressions", []) if reg.get("metric")
            }
            for metric, threshold in metrics_cfg.items():
                metric_data = tool_data.get("metrics", {}).get(metric)
                if metric_data is None:
                    rows.append(
                        {
                            "suite": "gungraun",
                            "benchmark": item["label"],
                            "metric": metric,
                            "tool": tool,
                            "unit": "events" if tool == "Callgrind" else "bytes",
                            "baseline_value": None,
                            "current_value": None,
                            "delta_pct": None,
                            "blocking": False,
                            "status": "missing",
                            "note": "metric missing from summary",
                        }
                    )
                    continue
                current_value = metric_data.get("new")
                baseline_value = metric_data.get("old")
                delta = metric_data.get("diff_pct")
                if baseline_value is None:
                    _, baseline_value, _ = benchmark_fallback(baseline, key, tool, metric)
                    delta = pct(baseline_value, current_value)
                row = {
                    "suite": "gungraun",
                    "benchmark": item["label"],
                    "metric": metric,
                    "tool": tool,
                    "unit": "events" if tool == "Callgrind" else "bytes",
                    "baseline_value": baseline_value,
                    "current_value": current_value,
                    "delta_pct": delta,
                    "blocking": False,
                    "note": None,
                }
                if metric in regressions:
                    row["status"] = "fail"
                    row["blocking"] = True
                    row["note"] = f"{regressions[metric]['level']} limit exceeded"
                elif baseline_value is None:
                    row["status"] = "missing"
                elif delta is not None and delta >= float(threshold["warn_pct"]):
                    row["status"] = "warn"
                elif delta is not None and delta <= -float(threshold["warn_pct"]):
                    row["status"] = "improved"
                else:
                    row["status"] = "ok"
                rows.append(row)

    if any(row["status"] == "fail" for row in rows):
        status["status"] = "fail"
    elif any(row["status"] == "warn" for row in rows):
        status["status"] = "warn"
    return (rows, status)


def suite_error(status: dict, exit_code: int) -> dict:
    if exit_code in {0, 3}:
        return status
    status = dict(status)
    status["status"] = "error"
    status["error"] = f"command exited with code {exit_code}"
    return status


def overall_verdict(statuses: list[dict]) -> str:
    kinds = [item["status"] for item in statuses]
    if "fail" in kinds or "error" in kinds:
        return "fail"
    if "warn" in kinds:
        return "warn"
    return "pass"


def main() -> None:
    args = build_parser().parse_args()
    cfg = load_thresholds(args.thresholds)
    current_criterion = maybe(args.current_criterion)
    baseline_criterion = maybe(args.baseline_criterion)
    current_gungraun = maybe(args.current_gungraun)
    baseline_gungraun = maybe(args.baseline_gungraun)

    criterion_data, criterion_status = criterion_rows(current_criterion, baseline_criterion, cfg)
    gungraun_data, gungraun_status = gungraun_rows(current_gungraun, baseline_gungraun, cfg)
    criterion_status = suite_error(criterion_status, args.criterion_exit_code)
    gungraun_status = suite_error(gungraun_status, args.gungraun_exit_code)

    rows = sorted(criterion_data + gungraun_data, key=lambda row: (verdict_rank(row["status"]), row["suite"], row["benchmark"], row["metric"]))
    blocking = [row for row in rows if row["blocking"]]
    warnings = [row for row in rows if row["status"] == "warn"]
    improvements = [row for row in rows if row["status"] == "improved"]
    statuses = [criterion_status, gungraun_status]
    data = {
        "schema_version": 1,
        "generated_at": now(),
        "repo": args.repo,
        "pr": args.pr,
        "head_sha": args.head_sha,
        "base_sha": args.base_sha,
        "baseline": {
            "sha": args.baseline_sha,
            "source": args.baseline_source,
            "name": cfg["gungraun"]["baseline_name"],
        },
        "suite_status": {
            "criterion": criterion_status,
            "gungraun": gungraun_status,
        },
        "criterion_exit_code": args.criterion_exit_code,
        "gungraun_exit_code": args.gungraun_exit_code,
        "verdict": overall_verdict(statuses),
        "totals": {
            "rows": len(rows),
            "blocking": len(blocking),
            "warnings": len(warnings),
            "improvements": len(improvements),
        },
        "blocking": blocking,
        "warnings": warnings,
        "improvements": improvements,
        "rows": rows,
    }
    dump_json(args.output, data)


if __name__ == "__main__":
    main()
