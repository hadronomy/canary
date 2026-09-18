# Modern Docker builds and Varlock integration

Research date: 2026-09-17

Scope: the two Dockerfiles in this repository, the current GitHub Actions workflow, and the boundary between build-time configuration and runtime secrets. This note uses Docker, BuildKit, Buildx, GitHub, Bun, and Varlock primary sources. It separates facts from recommendations.

## Decision summary

The best target design is:

| Concern | Target |
| --- | --- |
| Build input | Run `turbo prune web --docker`. Install from the pruned manifest tree, then copy the pruned source tree and the root Varlock schema. |
| Build cache | Use Buildx with the `docker-container` driver. Import the default-branch cache and export a trusted-branch cache with an image-specific scope. |
| Runtime image | Copy only Nitro `.output`, `.env-flat`, and the pinned standalone Varlock binary into a Node 24 LTS runtime. Do not copy the 1.2 GiB web `node_modules` tree. |
| Varlock build boundary | Resolve only `!@dynamic` items during the build. Mark each server-only value `@dynamic`. Keep only values that the browser bundle needs, such as `VITE_SERVER_URL`, static. |
| Varlock runtime boundary | Keep `varlock run --` as the container entrypoint. Resolve and validate dynamic values when the container starts. |
| Supply chain | Pin base images and the Varlock image by digest. Publish SBOM and provenance attestations on trusted registry pushes. |

Keep the repository root as the web build context because the Bun workspace and imported Varlock schemas span the repository. Pruning reduces the dependency and source inputs without breaking that boundary. Docker's layer cache then remains valid when unrelated source files change.

Keep Varlock in the web builder for schema validation and `flatten`. Keep `varlock run` at runtime because the current image uses runtime environment injection and the Vite integration is configured with `ssrInjectMode: 'init-only'`. Use the standalone Varlock binary in the runtime image instead of retaining the package-local CLI and its dependency tree. Do not place resolved secrets in an image layer, image `ENV`, `ARG`, or provenance metadata. If a build step needs a real credential, pass it through a BuildKit secret mount.

Add a dedicated image workflow. It must use a path build context, the official Buildx actions, a remote cache, explicit platform policy, and pushed SBOM and provenance attestations. Keep the existing environment workflow as schema and image leakage verification. Build the Rust benchmark image with Cargo cache mounts and a separate cache scope.

Treat multi-platform output as a deployment requirement, not as a default. Build `linux/amd64` and `linux/arm64` for the web image when both platforms are supported by the deployment target. Keep the parser benchmark image on the platforms supported by Valgrind and its benchmark runner until that support is tested.

## Proven findings

### Repository state

| Area | Current implementation | Evidence and impact |
| --- | --- | --- |
| Web build | `apps/web/Dockerfile` uses the root context, copies the complete context before `bun install`, mounts Bun's install cache, runs Varlock and the Vite build, flattens the schema, then copies `.output`, `node_modules`, and `.env-flat` into a Node runtime image. | [Web Dockerfile](../apps/web/Dockerfile), [Compose build context](../docker-compose.yml), [web package scripts](../apps/web/package.json) |
| Web runtime | The final image starts `varlock run -- node .output/server/index.mjs`. | [Web Dockerfile](../apps/web/Dockerfile), [Varlock load and run](https://varlock.dev/reference/cli/load-and-run/) |
| Varlock build mode | The Vite plugin uses `ssrInjectMode: 'init-only'`, with a comment that the parent process resolves the schema. | [Vite config](../apps/web/vite.config.ts), [Varlock Vite integration](https://varlock.dev/integrations/vite/) |
| Web secrets in the build | The Dockerfile creates random values for `BETTER_AUTH_SECRET` and `DB_PASSWORD` in one `RUN`, passes them to Varlock and the build, and searches `.output` and `.env-flat` for both values. | [Web Dockerfile](../apps/web/Dockerfile), [image verification script](../scripts/verify-varlock-image.sh) |
| Web environment contract | The root schema imports into the web schema. `DB_PASSWORD` and `BETTER_AUTH_SECRET` are required and sensitive. `VITE_SERVER_URL` is a required URL. | [Root schema](../.env.schema), [web schema](../apps/web/.env.schema) |
| Context filtering | The root `.dockerignore` excludes dependency trees, build output, local environment files, and generated `src/env.ts`, while re-including tracked schemas and `.env.build`. | [Docker ignore file](../.dockerignore) |
| Rust image | `tools/parser-benchcmp/Dockerfile` installs Debian packages, then installs `cargo-criterion` and `gungraun-runner` with Cargo. It has no cache mounts. | [Parser benchmark Dockerfile](../tools/parser-benchcmp/Dockerfile) |
| CI | `.github/workflows/env.yml` validates schemas with random test values and runs `env:verify-image`. It does not use Buildx, export a remote build cache, push an image, or publish attestations. | [Environment workflow](../.github/workflows/env.yml), [root scripts](../package.json) |
| Verification build | `scripts/verify-varlock-image.sh` invokes the classic `docker build`, checks image environment and history for sensitive values, checks for dangling links, and verifies the Varlock binary. | [Verification script](../scripts/verify-varlock-image.sh) |
| Runtime Compose secrets | Compose currently passes `BETTER_AUTH_SECRET` and `DB_PASSWORD` as environment values to the web and database services. | [Compose file](../docker-compose.yml), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Compose environment best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) |
| Local image-size measurement | On 2026-09-17, `apps/web/.output` was 43 MiB and `apps/web/node_modules` was 1.2 GiB. A temporary smoke test started the server from `.output` plus flattened Varlock files through the existing Varlock CLI. The test listened and shut down cleanly. | Local measurement. The generated output is ignored and is not part of this note. |
| Bundled runtime | The generated Nitro server contains Varlock runtime code at `.output/server/_libs/varlock.mjs`. | Local inspection. Verify this path after every Nitro upgrade. |
| Base runtime line | Node 26 is Current on the research date. Node 24 is Active LTS. | [Node.js release status](https://nodejs.org/en/about/previous-releases) |
| Verification limit | A full `docker build` and `docker buildx build --check` did not run because this environment has no Docker daemon. | Re-run the build, checks, and size measurements in a Docker-enabled CI runner. |

### BuildKit and Docker findings

1. BuildKit reuses a layer only when its instruction and dependent inputs remain unchanged. Docker recommends putting expensive, stable steps before frequently changing source. A dependency install after `COPY . .` is therefore invalidated by ordinary source edits. Keep package manifests and the lockfile in an earlier layer, then copy source before the build step. ([Cache optimization](https://docs.docker.com/build/cache/optimize/))

2. A small build context reduces transfer work and avoids cache invalidation from unrelated files. The current root `.dockerignore` already removes the largest generated and local directories. Docker also supports a Dockerfile-specific ignore file named `<Dockerfile>.dockerignore`; it takes precedence over the root ignore file, so it needs a complete allow-list review before use. ([Build context and ignore files](https://docs.docker.com/build/concepts/context/))

3. BuildKit bind mounts make large source inputs available to one `RUN` without copying them into a layer. They are read-only by default, and mounted files do not persist in the final image or the cache. Build output must be written outside the mount. This fits tools that consume source and emit a separate artifact. ([Dockerfile bind mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypebind), [Cache optimization](https://docs.docker.com/build/cache/optimize/))

4. BuildKit cache mounts persist package-manager data across builds without making the cache contents part of the instruction cache key. The current Bun mount targets Bun's documented global install cache, `/root/.bun/install/cache`, and therefore helps downloads across builds. A cache mount must tolerate eviction and stale entries. Use `sharing=locked` only when concurrent writers need exclusive access. ([Dockerfile cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache), [Bun global cache](https://bun.sh/docs/pm/global-cache))

5. External cache import and export is designed for ephemeral CI builders. The registry backend supports `mode=max`, OCI media types, and compression. The GitHub Actions backend requires a non-default Buildx driver, has cache service limits, and needs a distinct scope for each image. ([Cache backends](https://docs.docker.com/build/cache/backends/), [GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/))

6. `COPY --link` creates an independent layer. It can preserve reusable artifact layers when an earlier layer changes and can speed rebases. It does not preserve the old behavior when the source path contains symlinks, so each use needs a symlink check. ([Dockerfile `COPY --link`](https://docs.docker.com/reference/dockerfile/#copy---link))

7. Multi-stage builds let the final image copy only runtime artifacts and leave compilers and build tools in the builder. Named stages also support targeted builds. ([Multi-stage builds](https://docs.docker.com/build/building/multi-stage/))

8. Build contexts can be named and mounted or copied by name. This can separate large, unrelated inputs, but a Bun workspace install and the imported root Varlock schema still need the files that the current root context supplies. ([Build contexts](https://docs.docker.com/build/concepts/context/))

9. Buildx invokes BuildKit. The BuildKit project provides concurrent dependency resolution, instruction caching, cache import and export, multiple outputs, rootless execution, and multi-platform builds. ([BuildKit project](https://github.com/moby/buildkit), [Docker Build overview](https://docs.docker.com/build/concepts/overview/))

10. The official `docker/setup-buildx-action` uses the `docker-container` driver by default. That driver supports cache export and multi-platform output. The official `docker/build-push-action` exposes cache, secret, platform, context, SBOM, and provenance inputs. ([setup-buildx-action](https://github.com/docker/setup-buildx-action), [build-push-action](https://github.com/docker/build-push-action))

11. BuildKit's `RUN --mount=type=secret` provides a temporary file or environment value. The secret is not persisted in the resulting image. Docker's build check flags secrets passed through `ARG` or `ENV`, because those values can remain in image metadata or layers. ([Dockerfile secret mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypesecret), [Build secrets](https://docs.docker.com/build/building/secrets/), [SecretsUsedInArgOrEnv check](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/))

12. Secret contents do not enter the BuildKit cache key. Changing a secret therefore does not invalidate a cached `RUN`. If a secret change must force a rebuild, use a separate non-secret cache-busting value. ([Build cache invalidation](https://docs.docker.com/build/cache/invalidation/))

13. BuildKit can attach in-toto provenance and SPDX SBOM attestations. Provenance defaults to a minimal mode. SBOM generation is opt-in. Registry pushes preserve the attestations, and the `docker-container` driver supports them. The default SBOM scan covers the final stage. Build-time stages can be included with `BUILDKIT_SBOM_SCAN_CONTEXT=true` and `BUILDKIT_SBOM_SCAN_STAGE=true`. ([Attestations](https://docs.docker.com/build/metadata/attestations/), [SBOM attestations](https://docs.docker.com/build/metadata/attestations/sbom/))

14. Build checks run with Buildx and can fail a build. Relevant checks here include `SecretsUsedInArgOrEnv`, `CopyIgnoredFile`, and `JSONArgsRecommended`. The web Dockerfile already opts into error checks with `# check=error=true`; the parser Dockerfile does not have that directive. ([Build checks](https://docs.docker.com/build/checks/), [Build check reference](https://docs.docker.com/reference/build-checks/))

15. Docker recommends digest-pinning base images for reproducibility and supply-chain control. A tag such as `node:26`, `oven/bun:1.4.2`, or `rust:1.89-bookworm` can move. Docker recommends `--pull` when a build must refresh a tag and Dependabot can update Docker base-image digests. ([Build best practices](https://docs.docker.com/build/building/best-practices/))

16. Multi-platform builds publish a manifest list that points to one image manifest per platform. Buildx can use QEMU, multiple native nodes, or cross-compilation. QEMU is simple, but emulated compilation is slower than native builders. ([Multi-platform builds](https://docs.docker.com/build/building/multi-platform/))

17. Docker documents `# syntax=docker/dockerfile:1` as the stable syntax directive that tracks the latest v1 frontend. An explicit frontend tag such as the web Dockerfile's `docker/dockerfile:1.20` gives a different update and reproducibility trade-off. ([Dockerfile syntax](https://docs.docker.com/build/concepts/dockerfile/))

### Varlock and runtime configuration findings

1. Varlock documents three Docker roles: CI-only validation, runtime injection, and build-time integration. The runtime pattern uses `ENTRYPOINT ["varlock", "run", "--"]`. The build-time pattern keeps Varlock in a builder and avoids baking resolved secrets into the final image. The current web image uses the documented runtime-injection pattern. ([Varlock Docker integration](https://varlock.dev/integrations/docker/))

2. `varlock flatten` produces a structural, position-independent configuration layout for a monorepo. It preserves imports and schema structure without resolving secrets by default. It is intended for copying the needed configuration into a container. The current web Dockerfile runs it in the builder and copies `.env-flat` into the runtime image. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Varlock monorepos](https://varlock.dev/guides/monorepos/))

3. `varlock run` resolves configuration, injects it into the child process, and forwards signals as a resident wrapper. A lean resolve-then-`exec` form exists for images that only need injection at startup. ([Varlock load and run](https://varlock.dev/reference/cli/load-and-run/))

4. Varlock distinguishes static and dynamic configuration. `@dynamic` keeps a value out of build-time or client-facing resolution. A build can filter with `!@dynamic`, while runtime can resolve dynamic values. Sensitive and runtime-only are related concerns, but a schema needs an explicit dynamic boundary when a value must never enter a build. ([Varlock dynamic configuration](https://varlock.dev/guides/dynamic-config/))

5. The Vite integration can resolve values during the build, and it can inject runtime values for SSR. Its `ssrInjectMode: 'init-only'` mode expects the parent process to run Varlock. Resolved values used by client code can enter the client bundle, so only public build-time values belong there. ([Varlock Vite integration](https://varlock.dev/integrations/vite/))

6. The official Varlock Docker guide recommends pinning the Varlock image or binary version instead of using `latest`. It documents copying the binary from `ghcr.io/dmno-dev/varlock` in a multi-stage build when a standalone binary is useful. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Varlock source repository](https://github.com/dmno-dev/varlock))

7. Varlock's GitHub Action validates schemas and masks exported sensitive values for the current job. Its cross-job JSON output can expose secrets and needs separate handling. ([Varlock GitHub Action](https://varlock.dev/integrations/github-action/))

### Bun and Rust findings

1. Bun's `--frozen-lockfile` installs the exact lockfile resolution and fails instead of changing the lockfile. Bun documents `bun ci` as the equivalent CI intent. ([Bun install](https://bun.sh/docs/pm/cli/install))

2. Bun workspaces install workspace packages together and link local dependencies. The repository also uses the `selfContained` workspace setting for `apps/web` and then removes local dependency links before the runtime image. Any cache-layer rewrite must preserve that workspace graph. ([Bun workspaces](https://bun.sh/docs/pm/workspaces), [Web Dockerfile](../apps/web/Dockerfile))

3. Bun's official image supports Linux `amd64` and `arm64` variants. This supports a multi-platform web build if the Node runtime and all native dependencies also support the selected platforms. ([Bun installation images](https://bun.sh/docs/installation))

4. Cargo downloads registry and Git sources into Cargo's cache directories. BuildKit cache mounts can persist those directories, and a separate target directory can persist compiled install artifacts. The current parser image has no such mounts. The cache needs a platform-aware scope when one builder serves multiple architectures. ([Cargo home environment](https://doc.rust-lang.org/cargo/reference/environment-variables.html), [Dockerfile cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache))

5. Turborepo's `turbo prune <package> --docker` creates a partial workspace with separate `json` and `full` trees. The `json` tree is intended for the dependency-install layer, and the `full` tree is intended for source and build layers. The command does not copy files listed in `globalDependencies` by default. A local `turbo prune web --docker` run produced about 1.2 MiB of full input and 364 KiB of JSON input, and the pruned lockfile installed with Bun 1.4.2 when install scripts were disabled. The local output omitted the root `.env.schema`, so the Varlock schema must be copied explicitly or included through a tested Turborepo global-file option. ([Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker), [Turborepo prune reference](https://turborepo.dev/docs/reference/prune))

## Recommendations

### Priority 0: change the web cache boundary

1. Keep `context: .` for the web image. The current package manager configuration declares root workspaces and the web package imports the root schema. A narrower context risks breaking workspace resolution and schema flattening. ([Root package manifest](../package.json), [web schema](../apps/web/.env.schema), [Varlock monorepos](https://varlock.dev/guides/monorepos/))

2. Run `turbo prune web --docker` in a prune stage. Copy its `json` tree before `bun install --frozen-lockfile`, keep the existing Bun cache mount, then copy its `full` tree before the build. Copy the root `.env.schema` explicitly because the local prune omitted it. This keeps source edits from invalidating dependency installation. Docker and Turborepo document this cache boundary. ([Cache optimization](https://docs.docker.com/build/cache/optimize/), [Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker), [Bun install](https://bun.sh/docs/pm/cli/install))

3. Validate the pruned lockfile with `bun install --frozen-lockfile` in the image. Do not replace pruning with a hand-written manifest list. Such a list becomes stale when the workspace graph changes. Do not copy local environment files into the build context.

4. Keep schemas and generated Varlock output as explicit inputs. Do not solve the cache problem by excluding `.env.schema` or by copying a resolved environment file. The current `.dockerignore` already re-includes tracked schemas. ([Docker ignore file](../.dockerignore), [Varlock Docker integration](https://varlock.dev/integrations/docker/))

5. Use `COPY --link` for independent runtime artifacts such as `.output` and `.env-flat` after the new image passes the symlink check. Do not copy the runtime dependency tree. The Nitro output smoke test did not need it. ([Dockerfile `COPY --link`](https://docs.docker.com/reference/dockerfile/#copy---link))

6. The local `turbo prune web --docker` run produced about 1.2 MiB of source input and 364 KiB of manifest input. Make the pruned build the target implementation after it passes code generation, Vite, Nitro, `flatten`, and the existing image checks. ([Turborepo Docker guide](https://turborepo.dev/docs/guides/tools/docker), [Turborepo prune reference](https://turborepo.dev/docs/reference/prune))

7. Replace the 1.2 GiB runtime `node_modules` copy with an artifact-only runtime. The local smoke test proved that `.output` plus `.env-flat` can start the application through Varlock. Copy the official Varlock `1.19.0` standalone binary into the final Node image and keep `varlock run` as the entrypoint. Validate native modules, all runtime imports, signal handling, image verification, and each target architecture in a Docker-enabled runner. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Varlock load and run](https://varlock.dev/reference/cli/load-and-run/))

   A local registry inspection found the official `ghcr.io/dmno-dev/varlock:1.19.0` multi-platform image and digest `sha256:0413966c1cf76f27563cd9e7f7dfc5ca5d087240a443e040eb7abb94b7f8a135` on the research date. Treat that digest as an observation. Re-resolve and verify it in the image workflow before pinning it.

8. Keep the current `docker/dockerfile:1.20` frontend while the cache and artifact changes are tested. Then choose one policy: use `docker/dockerfile:1` for the latest stable v1 frontend, or pin the frontend by digest for a fully controlled toolchain. Validate `RUN --mount`, `COPY --link`, and build checks after any frontend update. ([Dockerfile syntax](https://docs.docker.com/build/concepts/dockerfile/))

9. Use `RUN --mount=type=bind` only for a step that consumes a large input and writes its artifact outside the mount. It is a candidate for a future source-to-artifact step, not a replacement for the workspace install layer. ([Dockerfile bind mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypebind))

### Priority 0: use a remote BuildKit cache in CI

Create a dedicated image workflow. Its shape is:

```yaml
steps:
  - uses: actions/checkout@<pinned-sha>
  - uses: docker/setup-buildx-action@<pinned-sha>
  - uses: docker/login-action@<pinned-sha> # push jobs only
  - uses: docker/build-push-action@<pinned-sha>
    with:
      context: .
      file: apps/web/Dockerfile
      cache-from: type=gha,scope=canary-web
      cache-to: type=gha,mode=max,scope=canary-web
      # push: true only for trusted branch or tag jobs
      # provenance: mode=max
      # sbom: true
```

Use the path context shown above. The Buildx action's default Git context ignores filesystem mutations made earlier in the job. A checked-out path context gives the builder the exact workspace and ignore file that the job inspected. ([build-push-action context](https://github.com/docker/build-push-action#context), [GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/))

Use `type=gha` for the simplest GitHub-only setup. Use a registry cache such as `type=registry,ref=ghcr.io/<owner>/<image>:buildcache` when cache reuse across workflows, branches, runners, or local builders matters. Import the default branch cache and the current branch cache when both are available. Use a separate scope or ref for the web and parser images. ([Cache backends](https://docs.docker.com/build/cache/backends/), [GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/))

Pin action SHAs, grant only the permissions needed for the job, and keep pushes out of untrusted pull-request jobs. GitHub documents that fork pull requests do not receive ordinary repository secrets. GitHub also recommends pinning actions to a full-length commit SHA and reviewing action source. ([Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use))

Keep `scripts/verify-varlock-image.sh` as a leakage test. Add a separate Buildx workflow for cache, push, platforms, and attestations. If the verification script later needs remote cache, migrate its build command to `docker buildx build --load` only after confirming that local image inspection still works.

### Priority 0: make the build/runtime secret boundary explicit

1. Classify every value used by the web build. Keep `VITE_SERVER_URL` static only because the client bundle needs it. Mark server-only values `@dynamic`, including public connection settings that can change between deployments. The current sensitive database password and authentication secret are dynamic by inference, but explicit decorators document the runtime contract. ([Root schema](../.env.schema), [Varlock dynamic configuration](https://varlock.dev/guides/dynamic-config/))

2. Build with `varlock load --filter='!@dynamic'` or the equivalent integration filter. Varlock applies this filter to resolution and validation, so required runtime secrets do not need fake build values. Remove the random `BETTER_AUTH_SECRET` and `DB_PASSWORD` generation after the filtered code-generation, Vite, Nitro, and SSR build passes. Keep the image leakage checks. ([Varlock dynamic configuration](https://varlock.dev/guides/dynamic-config/), [Varlock Vite integration](https://varlock.dev/integrations/vite/))

3. If a build truly needs a credential, use a BuildKit secret mount and pass it through the Buildx action's `secrets` or `secret-envs` input. Never move it into a Docker `ARG`, Docker `ENV`, a generated file copied to the runtime stage, or a command that writes it into a persistent layer. ([Build secrets](https://docs.docker.com/build/building/secrets/), [Docker build variables](https://docs.docker.com/build/building/variables/))

4. Remember that secret contents do not invalidate a cached `RUN`. Add a non-secret cache-bust value only when a credential rotation must force a rebuild. ([Build cache invalidation](https://docs.docker.com/build/cache/invalidation/))

5. Keep `varlock flatten` in the builder. It gives the final image the import graph without copying the repository or resolving build secrets. Ensure future Dockerfile-specific ignore rules do not exclude `.env-flat` or the schema files needed to create it. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Varlock monorepos](https://varlock.dev/guides/monorepos/))

6. Use `ENTRYPOINT ["/usr/local/bin/varlock", "run", "--"]` with the pinned standalone binary. This preserves Varlock's runtime schema resolution and injection without retaining `node_modules`. If a future deployment platform performs equivalent validation and injection, compare an image without the CLI as a separate measured change. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Varlock load and run](https://varlock.dev/reference/cli/load-and-run/))

7. For Compose and local development, use Compose secrets only after validating a file-to-environment adapter for the web, Postgres, and Electric services. Compose mounts secrets as files at `/run/secrets/<name>` and grants access per service. The current application contract names environment variables, so a blind switch changes behavior. ([Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Compose environment best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/), [Compose file](../docker-compose.yml))

### Priority 1: publish trusted metadata

For trusted branch and release pushes, set `provenance: mode=max` and `sbom: true` in `docker/build-push-action`. Push to a registry so the attestations remain attached to the image index. Decide whether the SBOM must include the builder stages. If it must, set the documented BuildKit scan variables. ([Attestations](https://docs.docker.com/build/metadata/attestations/), [SBOM attestations](https://docs.docker.com/build/metadata/attestations/sbom/), [build-push-action](https://github.com/docker/build-push-action))

Do not treat provenance as a secret store. Keep secret values out of all build arguments, environment settings, command lines, generated files, and labels. Build variables can appear in image history or provenance metadata. ([Docker build variables](https://docs.docker.com/build/building/variables/), [SecretsUsedInArgOrEnv check](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/))

### Priority 1: use an LTS Node base after compatibility testing

The web Dockerfile uses `node:26` for both build and runtime. Node's official release table lists Node 26 as Current and Node 24 as LTS on 2026-09-17. Test `node:24-bookworm` and `node:24-bookworm-slim` against the current Vite, Nitro, native dependency, and server smoke-test matrix. Move to Node 24 if the application has no Node 26 requirement. Pin the accepted base images by digest after the choice. ([Node.js release status](https://nodejs.org/en/about/previous-releases), [Build best practices](https://docs.docker.com/build/building/best-practices/))

### Priority 1: make platform policy explicit

For the web image, test `linux/amd64` and `linux/arm64` in a Buildx matrix or a single multi-platform build. Use QEMU for occasional builds. Use native builder nodes or a cross-compilation plan when the web build time under emulation is material. ([Multi-platform builds](https://docs.docker.com/build/building/multi-platform/), [setup-buildx-action](https://github.com/docker/setup-buildx-action))

For `tools/parser-benchcmp/Dockerfile`, test Valgrind, `gungraun-runner`, and the benchmark workload on each target before adding it to the platform list. The Dockerfile uses a Rust base and native tooling. Do not infer platform support from the availability of the base image alone. ([Parser benchmark Dockerfile](../tools/parser-benchcmp/Dockerfile), [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/))

### Priority 1: improve the Rust benchmark image cache

Add BuildKit cache mounts for Cargo's registry and Git sources. Consider a cache-mounted `CARGO_TARGET_DIR` for the two `cargo install` commands after measuring the storage cost. Keep `cargo install --locked` and the explicit tool versions. Use an image-specific cache scope and include the target platform in the scope if one cache is shared by multiple architectures. ([Cargo environment variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html), [Dockerfile cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache), [Cache backends](https://docs.docker.com/build/cache/backends/))

Pin `rust:1.89-bookworm` to a digest after choosing the accepted base. Apply the same policy to the Bun and Node bases. Use Dependabot or an equivalent controlled update process for digest refreshes. ([Build best practices](https://docs.docker.com/build/building/best-practices/))

### Priority 2: add repeatable build checks and measurement

Run `docker buildx build --check` for both Dockerfiles in CI. Keep the web Dockerfile's `# check=error=true` and add the same policy to the parser image when its syntax is modernized. Review `CopyIgnoredFile`, `SecretsUsedInArgOrEnv`, and `JSONArgsRecommended` output. ([Build checks](https://docs.docker.com/build/checks/), [Build check reference](https://docs.docker.com/reference/build-checks/))

Record baseline and post-change timings for:

- a source-only web change;
- a root or workspace manifest change;
- a lockfile change;
- a cold CI builder;
- a warm builder with imported cache;
- a Rust tool install with and without Cargo cache mounts;
- each selected target platform.

Use BuildKit's build summary and cache usage output. Compare image size, layer reuse, and startup time. Keep the existing secret-leak and dangling-link checks as release gates. ([Build cache optimization](https://docs.docker.com/build/cache/optimize/), [build-push-action build records](https://github.com/docker/build-push-action))

## Options not selected as the first change

- **Docker Bake:** Bake can build multiple targets in parallel and centralize cache, platform, and attestation settings. It fits a future workflow that builds the web and parser images together. A direct Buildx workflow is smaller while this repository has no image-push workflow. ([Docker Bake](https://docs.docker.com/build/bake/))
- **Named contexts:** Named contexts can reduce unrelated input and allow shared files to be mounted without copying them. The current root workspace and Varlock import graph make a root context the lower-risk first step. Revisit this after cache timing shows context transfer as a bottleneck. ([Build contexts](https://docs.docker.com/build/concepts/context/))
- **Keeping the current Varlock package as the final-image CLI:** Do not keep this design after the artifact-only image passes its runtime checks. The standalone binary removes the reason to copy a 1.2 GiB `node_modules` tree beside a 43 MiB `.output`. ([Varlock Docker integration](https://varlock.dev/integrations/docker/), [Web package manifest](../apps/web/package.json))
- **BuildKit policy files:** Docker now documents experimental Rego build policies for registry allow-lists, digest pinning, provenance, and signed tags. Adopt them after the basic Buildx workflow is stable and the CI runner has the required Buildx and BuildKit versions. ([Build policies](https://docs.docker.com/build/policies/))

## Source set

The source set is limited to official Docker and BuildKit documentation and source, official Docker Buildx and GitHub Action repositories, official GitHub Actions security documentation, official Bun documentation, official Cargo documentation, and the Varlock documentation and source repository.
