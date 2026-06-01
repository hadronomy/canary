set shell := ["bash", "-euo", "pipefail", "-c"]
set export := true

root := justfile_directory()
db := root + "/crates/database"
compose := db + "/compose.yml"

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
    [ -d "{{ root }}/node_modules" ] || mise exec -- bun install --frozen-lockfile

[private]
db-env:
    [ -f "{{ db }}/.env" ] || cp "{{ db }}/.env.example" "{{ db }}/.env"

[private]
db-ready: db-up
    cid="$(docker compose -f "{{ compose }}" ps -q surrealdb)"; \
    if [ -z "$cid" ]; then \
    echo "surrealdb container not found"; \
    exit 1; \
    fi; \
    for _ in $(seq 1 60); do \
    status="$(docker inspect "$cid" | jq -r '.[0].State.Health.Status // empty')"; \
    if [ "$status" = "healthy" ]; then \
    exit 0; \
    fi; \
    sleep 1; \
    done; \
    echo "surrealdb did not become healthy in time"; \
    exit 1

# Install the repo-managed toolchain and JavaScript dependencies.
[group('workflow')]
install:
    mise i
    mise exec -- bun install --frozen-lockfile

# Show the local toolchain this repository expects.
[group('workflow')]
doctor:
    @printf '\033[1mmise\033[0m: '
    @mise --version
    @printf '\033[1mjust\033[0m: '
    @mise exec -- just --version
    @printf '\033[1mbun\033[0m: '
    @mise exec -- bun --version
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
    mise exec -- bunx lint-staged

# Build the Rust workspace with all features enabled.
[group('rust')]
build:
    cargo build --workspace --all-features

# Format the Rust workspace.
[group('rust')]
rust-fmt:
    cargo +nightly fmt --all

# Verify Rust formatting.
[group('rust')]
rust-fmt-check:
    cargo +nightly fmt --all --check

# Run clippy across the Rust workspace.
[group('rust')]
clippy:
    cargo clippy --workspace --all-targets --all-features -- -D warnings

# Run the fast clippy path used by the pre-commit hook.
[group('rust')]
clippy-fast:
    cargo clippy --workspace --all-targets -- -D warnings

# Run the Rust test suite.
[group('rust')]
test:
    mise exec -- cargo nextest run --workspace --all-features

# Run Rust doctests.
[group('rust')]
doctest:
    cargo test --workspace --doc

# Format TOML files.
[group('workspace')]
toml-fmt:
    mise exec -- taplo format

# Verify TOML formatting.
[group('workspace')]
toml-fmt-check:
    mise exec -- taplo format --check

# Format JavaScript and TypeScript files.
[group('workspace')]
js-fmt: js-deps
    mise exec -- bunx oxfmt --write

# Verify JavaScript and TypeScript formatting.
[group('workspace')]
js-fmt-check: js-deps
    mise exec -- bunx oxfmt --check

# Lint JavaScript and TypeScript files.
[group('workspace')]
js-lint: js-deps
    mise exec -- bunx oxlint

# Run the workspace type checks.
[group('workspace')]
typecheck: js-deps
    mise exec -- bun run check-types

# Start the SurrealDB development instance for the database crate.
[group('database')]
db-up:
    docker compose -f "{{ compose }}" up -d surrealdb

# Stop the SurrealDB development instance.
[group('database')]
db-stop:
    docker compose -f "{{ compose }}" stop surrealdb

# Remove the SurrealDB development stack.
[group('database')]
db-down:
    docker compose -f "{{ compose }}" down --remove-orphans

# Tail the SurrealDB logs.
[group('database')]
db-logs:
    docker compose -f "{{ compose }}" logs -f surrealdb

# Sync the desired schema into the local SurrealDB instance.
[group('database')]
db-sync: db-env db-ready
    cd "{{ db }}" && mise exec -- surrealkit sync

# Seed the local SurrealDB instance.
[group('database')]
db-seed: db-env db-ready
    cd "{{ db }}" && mise exec -- surrealkit seed

# Run Surrealkit database suites.
[group('database')]
db-test: db-env db-ready
    cd "{{ db }}" && mise exec -- surrealkit test

# Show the current rollout and schema state.
[group('database')]
db-status: db-env db-ready
    cd "{{ db }}" && mise exec -- surrealkit status

# Remove the local SurrealDB data directory.
[group('database')]
db-reset: db-down
    rm -rf "{{ db }}/.local/surrealdb"

# Run the local Rust server.
[group('dev')]
server:
    cargo run -p canary-server

# Remove Rust build artifacts.
[group('maintenance')]
clean:
    cargo clean
