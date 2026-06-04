# Canary Authorization

`canary-authorization` is Canary's resource-server authorization crate. It
validates OAuth access tokens, builds a typed `Principal`, and answers whether
that caller may perform an `Action` on a `Resource`.

It does not sign users in, mint tokens, show consent screens, manage browser
sessions, rotate refresh tokens, or expose revocation endpoints. Bring an
authorization server such as Better Auth, Keycloak, Ory Hydra, or another
OAuth/OIDC provider. Canary verifies what that server issues.

## Quick Start

Most server code should stay this small:

```rust
use canary_authorization::{Action, Authorizer, BearerToken, Resource};

# async fn check(auth: Authorizer, raw: String) -> Result<(), canary_authorization::AuthError> {
let token = BearerToken::new(raw)?;
let principal = auth.verify(&token).await?;
let decision = auth.authorize(&principal, Action::Read, &Resource::api());

assert!(decision.is_allowed());
# Ok(())
# }
```

HTTP integration should do five things:

1. read the bearer token from `Authorization`;
2. reject query-string access tokens;
3. call `Authorizer::verify`;
4. call `Authorizer::authorize`;
5. put the `Principal` in request context for handlers that need it.

That is the boundary. MCP session IDs, cookies, request IDs, and transport
sessions are not authentication. Every protected REST or MCP HTTP request needs
its own bearer token.

## Token Modes

JWT access tokens are the normal production path. `Authorizer::from_config`
discovers issuer metadata, fetches JWKS, compiles usable verification keys, and
validates tokens locally with `jsonwebtoken`.

Opaque access tokens are supported behind the `introspection` feature. Non-JWT
bearer tokens go to the issuer's RFC 7662 introspection endpoint, and successful
responses are cached by SHA-256 token digest. Raw tokens are never used as cache
keys.

Do not introspect JWT-shaped tokens as a fallback. If a token looks like a JWT,
it must pass the JWT path.

## Configuration

A minimal JWT-backed server config looks like this:

```toml
[auth]
enabled = true

[auth.resources.api]
resource = "https://api.canary.local/api"
scopes_supported = [
  "canary:api:read",
  "canary:api:create",
  "canary:api:update",
  "canary:api:delete",
  "canary:admin",
]

[auth.resources.mcp]
resource = "https://api.canary.local/mcp"
scopes_supported = [
  "canary:mcp:read",
  "canary:mcp:trigger",
  "canary:admin",
]

[[auth.issuers]]
issuer = "https://auth.canary.local/"
audiences = [
  "https://api.canary.local/api",
  "https://api.canary.local/mcp",
]
algorithms = ["RS256", "EdDSA"]
token_formats = ["jwt"]
clock_skew = "60s"

[auth.issuers.discovery]
mode = "auto"

[auth.issuers.access_token]
max_lifetime = "15m"

[auth.issuers.refresh]
interval = "5m"
```

`discovery.mode = "auto"` tries OAuth authorization-server metadata first and
then OIDC discovery when the `oidc-discovery` feature is enabled. Explicit
`jwks_uri` and introspection endpoints override discovery.

To accept opaque tokens as well:

```toml
[[auth.issuers]]
issuer = "https://auth.canary.local/"
audiences = [
  "https://api.canary.local/api",
  "https://api.canary.local/mcp",
]
algorithms = ["RS256"]
token_formats = ["jwt", "opaque"]
clock_skew = "60s"

[auth.issuers.introspection]
enabled = true
client_id = "canary-resource-server"
client_secret = "dev-resource-secret"
auth_method = "client_secret_basic"

[auth.issuers.introspection.cache]
ttl = "30s"
max_capacity = 10000
```

Resource URIs and issuer endpoints must use HTTPS in normal configuration. Local
HTTP constructors exist for tests and protocol fixtures, not production config.

## What We Validate

For JWT access tokens, Canary checks:

- `typ` is `at+jwt` or `application/at+jwt`;
- `kid` is present;
- the JWS algorithm is explicitly allowed for the issuer;
- `iss`, `sub`, `aud`, and `exp` are present and valid;
- RFC 9068 profile claims `client_id`, `iat`, and `jti` are present;
- missing `nbf` is allowed, but a future `nbf` is rejected;
- `exp >= iat`;
- `exp - iat` does not exceed `access_token.max_lifetime`.

For opaque tokens, Canary requires the introspection response to provide enough
information to build the same typed `Principal`:

- `active = true`;
- accepted audience;
- matching issuer when `iss` is present;
- `client_id`;
- `exp`;
- `iat`;
- RFC 6749-valid scopes;
- issuer-created lifetime at or below `access_token.max_lifetime`.

Clock skew decides whether a token is usable right now. It does not extend the
maximum lifetime Canary accepts from an issuer.

## Feature Flags

| Feature | What it enables |
| --- | --- |
| `default` | The `jwt-rust-crypto` backend. |
| `jwt-rust-crypto` | `jsonwebtoken` with the RustCrypto backend. |
| `jwt-aws-lc-rs` | `jsonwebtoken` with the AWS-LC backend. |
| `axum` | Axum integration helpers. |
| `introspection` | RFC 7662 opaque-token verification and digest-keyed caching. |
| `oidc-discovery` | Typed OpenID Connect discovery parsing. |
| `better-auth` | `introspection` and `oidc-discovery` together. |
| `ec` | Reserved. Do not advertise behavior here until it does something real. |

Do not add placeholder features that sound production-ready. If a feature exists,
it should either work end to end or be plainly reserved.

## Policy Model

The policy stage is intentionally small. It currently allows:

- `canary:admin`;
- broad action scopes such as `canary:read`;
- resource/action scopes such as `canary:api:read`.

Handlers pass typed `Resource` and `ResourceKey` values into policy instead of
raw strings. Database-backed containment checks still need to run beside scope
checks once the resource services exist. Nested URL paths alone are not
authorization.

## Protected Metadata

The server publishes RFC 9728 protected-resource metadata for REST and MCP.
Challenges should point at metadata routes that actually exist, and metadata
should only advertise capabilities Canary implements:

- bearer tokens in the `Authorization` header;
- supported scopes;
- authorization servers;
- the protected resource URI.

Do not advertise DPoP, mTLS-bound tokens, token introspection, or signed
metadata unless the behavior is implemented end to end.

## Development Issuers

Prefer testing with authorization enabled. A good dev issuer is either Better
Auth running locally with the OAuth Provider plugin, or a small in-repo issuer
that exposes metadata, JWKS, and a deterministic `client_credentials` token
endpoint.

Dev JWTs should be short-lived RFC 9068 access tokens with:

- `typ = at+jwt`;
- `iss`;
- `aud` matching Canary's API or MCP resource URI;
- `sub`;
- `client_id`;
- `scope`;
- `iat`;
- `exp`;
- `jti`.

> [!WARNING]
> The ability to run Canary with authorization disabled is temporary. It exists
> only to keep early local development moving while the authorization surface is
> being wired in. Expect this escape hatch to be removed soon. New tests and dev
> workflows should use a real dev issuer instead.

## Key Handling

`JsonWebKeySet` is the public JWKS wrapper. Its `Debug` output is redacted
because test HMAC fixtures and future symmetric keys are secret material.

JWKS compilation selects verification keys by `(kid, alg)`:

- `kid` is required;
- duplicate usable `(kid, alg)` pairs are rejected;
- JWK `alg`, when present, must match the selected algorithm;
- `use = sig` and `key_ops = verify` are respected when present;
- supported key families are RSA, P-256 EC, Ed25519 OKP, and octet HMAC.

Refresh is atomic: a failed refresh leaves the previous key ring active. The
server owns scheduling and cancellation through `ShutdownCoordinator`; this
crate only exposes `Authorizer::refresh` and `Authorizer::refresh_interval`.

## Protocols

The code follows these documents:

| Area | Source |
| --- | --- |
| Bearer token transport and `WWW-Authenticate` errors | RFC 6750 |
| Token introspection for opaque tokens | RFC 7662 |
| Authorization-server metadata | RFC 8414 |
| Resource indicators and audience binding | RFC 8707 |
| JWT access-token profile | RFC 9068 |
| Protected resource metadata | RFC 9728 |
| MCP HTTP authorization behavior | MCP authorization spec |

When behavior changes, keep the resource-server line clear: Canary validates
bearer tokens and applies local resource policy. It does not become the
authorization server.

## Maintainer Notes

Keep public types Canary-owned. `jsonwebtoken`, `oauth2`, `openidconnect`, and
other protocol crates are implementation details unless there is a strong reason
to expose one.

Before landing authorization changes, check the boring things that matter:

- bearer tokens only come from headers;
- query-string tokens are rejected;
- `WWW-Authenticate` responses stay RFC 6750/RFC 9728 compatible;
- MCP authorization runs on every HTTP request;
- token lifetime checks still reject overlong tokens;
- secrets and raw tokens are absent from logs and `Debug` output;
- one-line utility functions use `#[inline(always)]` where this crate expects it;
- structs stay close to their impls;
- tests cover the failure path being changed, not only the happy path.
