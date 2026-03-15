_default:
  @just -l -u

alias b := build
# Build with all features
build:
  cargo build --all-features

alias t := test
# Run tests
test:
  cargo nextest r --all-features

# Check all things
check:
  taplo format
  bun check
  cargo clippy --all-features
