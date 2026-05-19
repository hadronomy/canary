#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


MARKER = "<!-- parser-benchmark-report -->"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--pr", required=True, type=int)
    p.add_argument("--body-file", required=True)
    return p


def api(method: str, url: str, body: dict | None = None):
    token = os.environ["GITHUB_TOKEN"]
    data = None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read() or b"{}")


def comments(repo: str, pr: int) -> list[dict]:
    owner, name = repo.split("/", 1)
    page = 1
    rows: list[dict] = []
    while True:
        url = (
            f"https://api.github.com/repos/{owner}/{name}/issues/{pr}/comments"
            f"?per_page=100&page={page}"
        )
        batch = api("GET", url)
        if not batch:
            return rows
        rows.extend(batch)
        if len(batch) < 100:
            return rows
        page += 1


def main() -> None:
    args = build_parser().parse_args()
    body = Path(args.body_file).read_text(encoding="utf-8")
    owner, repo = args.repo.split("/", 1)
    match = next((item for item in comments(args.repo, args.pr) if MARKER in item.get("body", "")), None)
    if match is None:
        api(
            "POST",
            f"https://api.github.com/repos/{owner}/{repo}/issues/{args.pr}/comments",
            {"body": body},
        )
        return
    api(
        "PATCH",
        f"https://api.github.com/repos/{owner}/{repo}/issues/comments/{match['id']}",
        {"body": body},
    )


if __name__ == "__main__":
    main()
