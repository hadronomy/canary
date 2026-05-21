#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tool="$root/tools/parser-benchcmp"
img="${IMG:-canary-parser-bench:latest}"
base_ref="9fc16fd"
base_dir="/private/tmp/canary-9fc16fd"
head_dir="$root"
head_sha="$(git -C "$root" rev-parse --short HEAD)"
out="$root/target/parser-benchcmp/${base_ref}-vs-${head_sha}"
report="$root/crates/parser/benches/reports/${base_ref}-vs-${head_sha}.md"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline-ref) base_ref="$2"; shift 2 ;;
    --baseline-dir) base_dir="$2"; shift 2 ;;
    --current-dir) head_dir="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --report) report="$2"; shift 2 ;;
    --image) img="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

function bench() {
  local name="$1"
  local dir="$2"
  local dst="$out/$name"
  rm -rf "$dst"
  mkdir -p "$dst"

  docker run --rm \
    --mount "type=bind,source=$dir,target=/state,readonly" \
    --mount "type=bind,source=$tool/harness,target=/harness,readonly" \
    --mount "type=bind,source=$dst,target=/out" \
    --mount "type=volume,source=canary-parser-bench-registry,target=/usr/local/cargo/registry" \
    --mount "type=volume,source=canary-parser-bench-git,target=/usr/local/cargo/git" \
    "$img" \
    bash -c '
      set -euo pipefail
      cp -R /harness /tmp/harness
      chmod -R u+w /tmp/harness
      cd /tmp/harness
      export CARGO_TARGET_DIR=/out/target
      cargo criterion --bench criterion_compare --message-format=json > /out/criterion-messages.jsonl
      cargo bench --bench gungraun_compare -- \
        --allow-aslr=true \
        --save-summary=pretty-json \
        --home /out/gungraun
    '
}

if [[ ! -e "$base_dir/.git" ]]; then
  git -C "$root" worktree add --detach "$base_dir" "$base_ref"
fi

docker build --progress=plain -t "$img" "$tool"

mkdir -p "$out"
bench baseline "$base_dir"
bench current "$head_dir"

uv run "$root/.github/scripts/bench/normalize_criterion.py" \
  --input "$out/baseline/criterion-messages.jsonl" \
  --output "$out/baseline/criterion.json"
uv run "$root/.github/scripts/bench/normalize_criterion.py" \
  --input "$out/current/criterion-messages.jsonl" \
  --output "$out/current/criterion.json"

uv run "$root/.github/scripts/bench/normalize_gungraun.py" \
  --input-dir "$out/baseline/gungraun" \
  --output "$out/baseline/gungraun.json"
uv run "$root/.github/scripts/bench/normalize_gungraun.py" \
  --input-dir "$out/current/gungraun" \
  --output "$out/current/gungraun.json"

uv run "$tool/report.py" \
  --baseline-criterion "$out/baseline/criterion.json" \
  --current-criterion "$out/current/criterion.json" \
  --baseline-gungraun "$out/baseline/gungraun.json" \
  --current-gungraun "$out/current/gungraun.json" \
  --baseline-sha "$base_ref" \
  --current-sha "$head_sha" \
  --output "$report"

echo "Artifacts: $out"
echo "Report: $report"
