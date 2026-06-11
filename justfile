set shell := ["bash", "-euo", "pipefail", "-c"]
set export := true

root := justfile_directory()
db := root + "/crates/database"
db_compose := db + "/compose.yml"
server := root + "/crates/server"
rustfs_compose := server + "/compose.yml"
portless_bin := root + "/node_modules/.bin/portless"
temporal_pid := root + "/.tmp/temporal.pid"
temporal_log := root + "/.tmp/logs/temporal.log"
temporal_db := root + "/.tmp/temporal/temporal.db"
nats_config := root + "/.tmp/nats.conf"
nats_pid := root + "/.tmp/nats.pid"
nats_log := root + "/.tmp/logs/nats.log"
nats_store := root + "/.tmp/nats/jetstream"

alias b := build
alias d := doctor
alias f := fmt
alias t := test
alias pc := pre-commit

[default]
[group('workflow')]
help:
    @just --list --unsorted --justfile {{ justfile() }} --list-heading $'Canary Recipes\n' --list-prefix '  '

[private]
js-deps:
    @[ -d "{{ root }}/node_modules" ] || mise exec -- bun install --frozen-lockfile

[private]
db-env:
    @[ -f "{{ db }}/.env" ] || cp "{{ db }}/.env.example" "{{ db }}/.env"

[private]
db-ready: db-up
    #!/usr/bin/env bash
    set -euo pipefail

    compose='{{ db_compose }}'
    cid="$(docker compose -f "$compose" ps -q surrealdb)"

    if [[ -z "$cid" ]]; then
      echo "surrealdb container not found" >&2
      exit 1
    fi

    for _ in {1..60}; do
      status="$(docker inspect "$cid" | jq -r '.[0].State.Health.Status // empty')"
      if [[ "$status" == "healthy" ]]; then
        exit 0
      fi
      sleep 1
    done

    echo "surrealdb did not become healthy in time" >&2
    exit 1

# Write the local NATS configuration used by development recipes.
[group('dev')]
nats-config:
    #!/usr/bin/env bash
    set -euo pipefail

    mkdir -p '{{ root }}/.tmp/logs' '{{ nats_store }}'

    cat > '{{ nats_config }}' <<'EOF'
    server_name: "canary-dev"

    host: "127.0.0.1"
    port: 4222

    http: "127.0.0.1:8222"

    jetstream {
      store_dir: "{{ nats_store }}"
    }
    EOF

[private]
nats-ready: nats-up
    #!/usr/bin/env bash
    set -euo pipefail

    log='{{ nats_log }}'

    for _ in {1..50}; do
      if curl -fsS 'http://127.0.0.1:8222/jsz?config=true' >/dev/null 2>&1; then
        exit 0
      fi
      sleep 0.1
    done

    echo "nats-server did not become ready in time" >&2
    tail -n 80 "$log" || true
    exit 1

[private]
rustfs-ready: rustfs-up
    #!/usr/bin/env bash
    set -euo pipefail

    compose='{{ rustfs_compose }}'

    for _ in {1..60}; do
      cid="$(docker compose -f "$compose" ps -aq rustfs-init)"
      if [[ -z "$cid" ]]; then
        sleep 1
        continue
      fi

      status="$(docker inspect "$cid" | jq -r '.[0].State.Status // empty')"
      code="$(docker inspect "$cid" | jq -r '.[0].State.ExitCode // empty')"

      if [[ "$status" == "exited" && "$code" == "0" ]]; then
        exit 0
      fi

      if [[ "$status" == "exited" ]]; then
        docker compose -f "$compose" logs rustfs-init >&2 || true
        exit 1
      fi

      sleep 1
    done

    echo "rustfs did not become ready in time" >&2
    docker compose -f "$compose" logs rustfs rustfs-init >&2 || true
    exit 1

[private]
temporal-ready: temporal-up
    #!/usr/bin/env bash
    set -euo pipefail

    log='{{ temporal_log }}'

    for _ in {1..60}; do
      if temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; then
        exit 0
      fi

      sleep 1
    done

    echo "temporal did not become ready in time" >&2
    tail -n 120 "$log" || true
    exit 1

# Install the repo-managed toolchain and JavaScript dependencies.
[group('workflow')]
install:
    @mise i
    @mise exec -- bun install --frozen-lockfile

# Show the local toolchain this repository expects.
[group('workflow')]
doctor:
    @printf '\033[1mmise\033[0m: '
    @mise --version
    @printf '\033[1mjust\033[0m: '
    @mise exec -- just --version
    @printf '\033[1mbun\033[0m: '
    @mise exec -- bun --version
    @printf '\033[1mnode\033[0m: '
    @mise exec -- node --version
    @printf '\033[1mportless\033[0m: '
    @[ -x "{{ portless_bin }}" ] && mise exec -- "{{ portless_bin }}" --version || echo "not installed"
    @printf '\033[1mtemporal\033[0m: '
    @temporal --version | head -n 1
    @printf '\033[1mcargo\033[0m: '
    @cargo --version
    @printf '\033[1mrustc\033[0m: '
    @rustc --version
    @printf '\033[1mcargo nextest\033[0m: '
    @mise exec -- cargo nextest --version | head -n 1
    @printf '\033[1mtaplo\033[0m: '
    @mise exec -- taplo --version
    @printf '\033[1msurrealkit\033[0m: '
    @mise exec -- surrealkit --version
    @printf '\033[1mdocker\033[0m: '
    @docker --version
    @printf '\033[1mdocker compose\033[0m: '
    @docker compose version

# Format everything that belongs to this repository.
[group('workflow')]
fmt: rust-fmt toml-fmt js-fmt
    @:

# Verify formatting without mutating files.
[group('workflow')]
fmt-check: rust-fmt-check toml-fmt-check js-fmt-check
    @:

# Run the fast quality checks used in day-to-day work.
[group('workflow')]
lint: clippy js-lint
    @:

# Run the full local validation suite.
[group('workflow')]
check: fmt-check lint typecheck test doctest
    @:

# The hook-friendly validation path.
[group('workflow')]
pre-commit: js-deps
    @mise exec -- bunx lint-staged

# Build the Rust workspace with all features enabled.
[group('rust')]
build:
    @cargo build --workspace --all-features

# Format the Rust workspace.
[group('rust')]
rust-fmt:
    @cargo +nightly fmt --all

# Verify Rust formatting.
[group('rust')]
rust-fmt-check:
    @cargo +nightly fmt --all --check

# Run clippy across the Rust workspace.
[group('rust')]
clippy:
    @cargo clippy --workspace --all-targets --all-features -- -D warnings

# Run the fast clippy path used by the pre-commit hook.
[group('rust')]
clippy-fast:
    @cargo clippy --workspace --all-targets -- -D warnings

# Run the Rust test suite.
[group('rust')]
test:
    @mise exec -- cargo nextest run --workspace --all-features

# Run Rust doctests.
[group('rust')]
doctest:
    @cargo test --workspace --doc

# Format TOML files.
[group('workspace')]
toml-fmt:
    @mise exec -- taplo format

# Verify TOML formatting.
[group('workspace')]
toml-fmt-check:
    @mise exec -- taplo format --check

# Format JavaScript and TypeScript files.
[group('workspace')]
js-fmt: js-deps
    @mise exec -- bunx oxfmt --write

# Verify JavaScript and TypeScript formatting.
[group('workspace')]
js-fmt-check: js-deps
    @mise exec -- bunx oxfmt --check

# Lint JavaScript and TypeScript files.
[group('workspace')]
js-lint: js-deps
    @mise exec -- bunx oxlint

# Run the workspace type checks.
[group('workspace')]
typecheck: js-deps
    @mise exec -- bun run check-types

# Start the SurrealDB development instance for the database crate.
[group('database')]
db-up:
    @docker compose -f "{{ db_compose }}" up -d surrealdb

# Stop the SurrealDB development instance.
[group('database')]
db-stop:
    @docker compose -f "{{ db_compose }}" stop surrealdb

# Remove the SurrealDB development stack.
[group('database')]
db-down:
    @docker compose -f "{{ db_compose }}" down --remove-orphans

# Tail the SurrealDB logs.
[group('database')]
db-logs:
    @docker compose -f "{{ db_compose }}" logs -f surrealdb

# Sync the desired schema into the local SurrealDB instance.
[group('database')]
db-sync: db-env db-ready
    @cd "{{ db }}" && mise exec -- surrealkit sync

# Seed the local SurrealDB instance.
[group('database')]
db-seed: db-env db-ready
    @cd "{{ db }}" && mise exec -- surrealkit seed

# Run Surrealkit database suites.
[group('database')]
db-test: db-env db-ready
    @cd "{{ db }}" && mise exec -- surrealkit test

# Show the current rollout and schema state.
[group('database')]
db-status: db-env db-ready
    @cd "{{ db }}" && mise exec -- surrealkit status

# Remove the local SurrealDB data directory.
[group('database')]
db-reset: db-down
    @rm -rf "{{ db }}/.local/surrealdb"

# Start local services used by the Rust server and worker process.
[group('dev')]
dev-up: db-ready rustfs-ready temporal-ready nats-ready portless-up
    @echo "dev services are ready"
    @echo "canary:          https://canary.localhost"
    @echo "surrealdb:       https://db.canary.localhost"
    @echo "rustfs:          https://storage.canary.localhost"
    @echo "rustfs console:  https://storage-console.canary.localhost"
    @echo "temporal ui:     https://temporal.canary.localhost"
    @echo "nats monitor:    https://nats.canary.localhost"
    @echo "temporal grpc:   127.0.0.1:7233"
    @echo "nats client:     nats://127.0.0.1:4222"

# Stop local services started for development.
[group('dev')]
dev-stop: portless-down nats-stop temporal-stop rustfs-stop db-stop
    @echo "dev services stopped"

# Open the guided Canary demo in Ghostty.
[group('dev')]
demo:
    @deno run -A scripts/canary-demo.ts

# Register stable local URLs for the development endpoints.
[group('dev')]
portless-up: js-deps
    #!/usr/bin/env bash
    set -euo pipefail

    portless='{{ portless_bin }}'

    run() {
      mise exec -- "$portless" "$@"
    }

    run proxy start
    run alias canary 8080 --force
    run alias db.canary 8000 --force
    run alias storage.canary 9000 --force
    run alias storage-console.canary 9001 --force
    run alias temporal.canary 8233 --force
    run alias nats.canary 8222 --force
    run list

# Remove Canary's Portless development routes.
[group('dev')]
portless-down: js-deps
    #!/usr/bin/env bash
    set -euo pipefail

    portless='{{ portless_bin }}'

    remove() {
      mise exec -- "$portless" alias --remove "$1" >/dev/null 2>&1 || true
    }

    remove canary
    remove db.canary
    remove storage.canary
    remove storage-console.canary
    remove temporal.canary
    remove nats.canary

# Stop the Portless proxy daemon.
[group('dev')]
portless-stop: portless-down
    @mise exec -- "{{ portless_bin }}" proxy stop

# Show Portless routes currently registered on this machine.
[group('dev')]
portless-status: js-deps
    @mise exec -- "{{ portless_bin }}" list

# Start the local RustFS S3-compatible development instance.
[group('dev')]
rustfs-up:
    @docker compose -f "{{ rustfs_compose }}" up -d rustfs rustfs-init

# Stop the local RustFS development instance.
[group('dev')]
rustfs-stop:
    @docker compose -f "{{ rustfs_compose }}" stop rustfs rustfs-init

# Show the local RustFS compose services.
[group('dev')]
rustfs-status:
    @docker compose -f "{{ rustfs_compose }}" ps rustfs rustfs-init

# Tail the local RustFS logs.
[group('dev')]
rustfs-logs:
    @docker compose -f "{{ rustfs_compose }}" logs -f rustfs rustfs-init

# Start the local Temporal development instance.
[group('dev')]
temporal-up:
    #!/usr/bin/env bash
    set -euo pipefail

    db='{{ temporal_db }}'
    log='{{ temporal_log }}'
    pid='{{ temporal_pid }}'

    if ! command -v temporal >/dev/null; then
      echo "temporal CLI not found. Install it with: brew install temporal" >&2
      exit 1
    fi

    if [[ -f "$pid" ]] && kill -0 "$(cat "$pid")" 2>/dev/null; then
      echo "temporal dev server is already running on pid $(cat "$pid")"
      exit 0
    fi

    rm -f "$pid"

    if lsof -nP -iTCP:7233 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port 7233 is already in use" >&2
      exit 1
    fi

    if lsof -nP -iTCP:8233 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port 8233 is already in use" >&2
      exit 1
    fi

    mkdir -p "$(dirname "$db")" "$(dirname "$log")"

    nohup temporal server start-dev \
      --db-filename "$db" \
      --ip 127.0.0.1 \
      --port 7233 \
      --ui-port 8233 \
      --log-level warn \
      >"$log" 2>&1 &
    echo "$!" > "$pid"

    for _ in {1..60}; do
      if temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; then
        echo "temporal dev server is ready on 127.0.0.1:7233"
        echo "temporal ui is available on http://127.0.0.1:8233"
        exit 0
      fi
      sleep 1
    done

    echo "temporal dev server did not start" >&2
    tail -n 120 "$log" || true
    exit 1

# Stop the local Temporal development instance.
[group('dev')]
temporal-stop:
    #!/usr/bin/env bash
    set -euo pipefail

    pid='{{ temporal_pid }}'

    if [[ ! -f "$pid" ]] || ! kill -0 "$(cat "$pid")" 2>/dev/null; then
      rm -f "$pid"
      echo "temporal dev server is not running"
      exit 0
    fi

    proc="$(cat "$pid")"
    kill "$proc"
    rm -f "$pid"

    for _ in {1..60}; do
      if ! kill -0 "$proc" 2>/dev/null; then
        echo "temporal dev server stopped"
        exit 0
      fi
      sleep 0.5
    done

    echo "temporal dev server did not stop in time" >&2
    exit 1

# Show the local Temporal development server status.
[group('dev')]
temporal-status:
    #!/usr/bin/env bash
    set -euo pipefail

    pid='{{ temporal_pid }}'

    if [[ ! -f "$pid" ]] || ! kill -0 "$(cat "$pid")" 2>/dev/null; then
      echo "temporal dev server is not running" >&2
      exit 1
    fi

    temporal operator cluster health --address 127.0.0.1:7233
    echo "temporal dev server pid $(cat "$pid")"
    echo "temporal ui http://127.0.0.1:8233"

# Tail the local Temporal logs.
[group('dev')]
temporal-logs:
    #!/usr/bin/env bash
    set -euo pipefail

    touch '{{ temporal_log }}'
    tail -f '{{ temporal_log }}'

# Remove local Temporal development state and logs.
[group('dev')]
temporal-reset: temporal-stop
    #!/usr/bin/env bash
    set -euo pipefail

    rm -rf '{{ root }}/.tmp/temporal' '{{ temporal_log }}'

# Start the local NATS JetStream development instance.
[group('dev')]
nats-up: nats-config
    #!/usr/bin/env bash
    set -euo pipefail

    config='{{ nats_config }}'
    log='{{ nats_log }}'
    pid='{{ nats_pid }}'

    if ! command -v nats-server >/dev/null; then
      echo "nats-server not found. Install it with: brew install nats-server" >&2
      exit 1
    fi

    if [[ -f "$pid" ]] && kill -0 "$(cat "$pid")" 2>/dev/null; then
      echo "nats-server is already running on pid $(cat "$pid")"
      exit 0
    fi

    rm -f "$pid"

    if lsof -nP -iTCP:4222 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port 4222 is already in use" >&2
      exit 1
    fi

    nats-server -t -c "$config"
    nohup nats-server -c "$config" -P "$pid" -l "$log" >/dev/null 2>&1 &

    for _ in {1..50}; do
      if [[ -f "$pid" ]] && curl -fsS 'http://127.0.0.1:8222/varz' >/dev/null 2>&1; then
        echo "nats-server is ready on nats://127.0.0.1:4222"
        echo "monitoring is available on http://127.0.0.1:8222"
        exit 0
      fi
      sleep 0.1
    done

    echo "nats-server did not start" >&2
    tail -n 80 "$log" || true
    exit 1

# Stop the local NATS development instance.
[group('dev')]
nats-stop:
    #!/usr/bin/env bash
    set -euo pipefail

    pid='{{ nats_pid }}'

    if [[ ! -f "$pid" ]] || ! kill -0 "$(cat "$pid")" 2>/dev/null; then
      rm -f "$pid"
      echo "nats-server is not running"
      exit 0
    fi

    proc="$(cat "$pid")"
    kill "$proc"
    rm -f "$pid"

    for _ in {1..50}; do
      if ! kill -0 "$proc" 2>/dev/null; then
        echo "nats-server stopped"
        exit 0
      fi
      sleep 0.1
    done

    echo "nats-server did not stop in time" >&2
    exit 1

# Show the local NATS JetStream status.
[group('dev')]
nats-status:
    #!/usr/bin/env bash
    set -euo pipefail

    pid='{{ nats_pid }}'

    if [[ ! -f "$pid" ]] || ! kill -0 "$(cat "$pid")" 2>/dev/null; then
      echo "nats-server is not running" >&2
      exit 1
    fi

    echo "nats-server pid $(cat "$pid")"
    curl -fsS 'http://127.0.0.1:8222/jsz?config=true' \
      | jq '{server_id, now, config: .config, memory, storage, streams, consumers}'

# Tail the local NATS server logs.
[group('dev')]
nats-logs:
    #!/usr/bin/env bash
    set -euo pipefail

    touch '{{ nats_log }}'
    tail -f '{{ nats_log }}'

# Remove local NATS JetStream data and logs.
[group('dev')]
nats-reset: nats-stop
    #!/usr/bin/env bash
    set -euo pipefail

    rm -rf '{{ root }}/.tmp/nats' '{{ nats_log }}'

# Run the local Rust server.
[group('dev')]
server: portless-up
    @cargo run -p canary-server

# Remove Rust build artifacts.
[group('maintenance')]
clean:
    @cargo clean
