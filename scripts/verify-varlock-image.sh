#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tag="canary-web-varlock-check:${GITHUB_RUN_ID:-local}-$$"

cleanup() {
  docker image rm "$tag" >/dev/null 2>&1 || true
}

trap cleanup EXIT
cd "$root"

auth="$(openssl rand -hex 32)"
db="$(openssl rand -hex 32)"
electric="$(openssl rand -hex 32)"
BETTER_AUTH_SECRET="$auth" DB_PASSWORD="$db" ELECTRIC_SECRET="$electric" docker compose config >/dev/null

docker build --file apps/web/Dockerfile --tag "$tag" .

meta="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$tag")"
if grep -Eq '^(BETTER_AUTH_SECRET|DATABASE_URL|DB_PASSWORD|ELECTRIC_SECRET|OPENROUTER_API_KEY)=' <<<"$meta"; then
  echo 'The image configuration contains a sensitive environment value.' >&2
  exit 1
fi

history="$(docker history --no-trunc --format '{{.CreatedBy}}' "$tag")"
if grep -Fq -e 'build-time-placeholder-secret-not-used-at-runtime' \
  -e 'dev-secret-change-me-change-me-change-me' \
  -e 'postgresql://postgres:password' <<<"$history"; then
  echo 'The image history contains a retired secret placeholder.' >&2
  exit 1
fi

docker run --rm --user root --entrypoint sh "$tag" -eu -c '
  if test -e src/env.ts; then
    echo "The runtime image contains generated src/env.ts." >&2
    exit 1
  fi
  if test -n "$(find -L node_modules -type l -print -quit)"; then
    echo "The runtime image contains a dangling dependency link." >&2
    exit 1
  fi
  if grep -R -F -q \
    -e build-time-placeholder-secret-not-used-at-runtime \
    -e dev-secret-change-me-change-me-change-me \
    -e postgresql://postgres:password \
    .output .env.schema .env.build .env-imports; then
    echo "The application image contains a retired secret placeholder." >&2
    exit 1
  fi
'
docker run --rm --entrypoint ./node_modules/.bin/varlock "$tag" --version >/dev/null

echo 'Varlock image verification passed.'
