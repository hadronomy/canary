from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: str | Path):
    with Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(path: str | Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def load_thresholds(path: str | Path):
    return load_json(path)


def pct(old: float | int | None, new: float | int | None) -> float | None:
    if old in (None, 0) or new is None:
        return None
    return ((float(new) - float(old)) / float(old)) * 100.0


def parse_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    if text in {"inf", "+inf", "Infinity", "+Infinity"}:
        return float("inf")
    if text in {"-inf", "-Infinity"}:
        return float("-inf")
    return float(text)


def parse_either(value):
    if value is None:
        return (None, None)
    if "Both" in value:
        new, old = value["Both"]
        return (new, old)
    if "Left" in value:
        return (value["Left"], None)
    if "Right" in value:
        return (None, value["Right"])
    return (None, None)


def short_sha(sha: str | None) -> str:
    if not sha:
        return "none"
    return sha[:8]


def fmt_pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    if value == float("inf"):
        return "+inf"
    if value == float("-inf"):
        return "-inf"
    return f"{value:+.2f}%"


def fmt_num(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, int):
        return f"{value:,}"
    return f"{value:,.3f}"


def fmt_duration_ns(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    value = float(value)
    units = [
        ("ns", 1.0),
        ("us", 1_000.0),
        ("ms", 1_000_000.0),
        ("s", 1_000_000_000.0),
    ]
    unit = "ns"
    scale = 1.0
    for candidate, candidate_scale in units:
        unit = candidate
        scale = candidate_scale
        if value < candidate_scale * 1000.0 or candidate == "s":
            break
    return f"{value / scale:,.3f} {unit}"


def verdict_rank(status: str) -> int:
    order = {
        "fail": 0,
        "error": 1,
        "warn": 2,
        "ok": 3,
        "improved": 4,
        "new": 5,
        "missing": 6,
    }
    return order.get(status, 99)


def status_label(status: str) -> str:
    labels = {
        "fail": "FAIL",
        "error": "ERROR",
        "warn": "WARN",
        "ok": "OK",
        "improved": "IMPROVED",
        "new": "NEW",
        "missing": "NO BASELINE",
    }
    return labels.get(status, status.upper())
