#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import io
import json
import os
import urllib.request
import zipfile
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--dest", required=True)
    return p


def request(url: str):
    token = os.environ["GITHUB_TOKEN"]
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def main() -> None:
    args = build_parser().parse_args()
    owner, repo = args.repo.split("/", 1)
    listing = json.loads(
        request(
            f"https://api.github.com/repos/{owner}/{repo}/actions/runs/{args.run_id}/artifacts?per_page=100"
        )
    )
    match = next(
        (
            artifact
            for artifact in listing.get("artifacts", [])
            if artifact.get("name") == args.name and not artifact.get("expired")
        ),
        None,
    )
    if match is None:
        raise SystemExit(f"artifact not found: {args.name}")
    payload = request(
        f"https://api.github.com/repos/{owner}/{repo}/actions/artifacts/{match['id']}/zip"
    )
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(dest)


if __name__ == "__main__":
    main()
