FROM rust:1.89-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates pkg-config valgrind \
 && rm -rf /var/lib/apt/lists/*

RUN cargo install --locked cargo-criterion --version 1.1.0 \
 && cargo install --locked gungraun-runner --version 0.19.0

RUN tool="$(dirname "$(find /usr/local/rustup/toolchains -path '*/bin/rustc' -type f | head -n1)")" \
 && mkdir -p /opt \
 && ln -s "$tool" /opt/rust-bin

ENV PATH="/opt/rust-bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    CARGO_HOME="/usr/local/cargo" \
    CARGO_NET_GIT_FETCH_WITH_CLI="true" \
    CARGO_TERM_COLOR="always" \
    RUSTUP_HOME="/usr/local/rustup"

RUN /opt/rust-bin/rustc --version \
 && /opt/rust-bin/cargo --version \
 && cargo-criterion --version \
 && gungraun-runner --version \
 && valgrind --version

WORKDIR /work
