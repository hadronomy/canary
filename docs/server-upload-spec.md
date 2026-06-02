# Server Upload Architecture

## Goal

Canary treats files as object-storage assets from the beginning. The app server
owns authorization, upload policy, metadata, and finalization. Object storage
owns the bytes.

The file service is deliberately narrow:

- authenticate before creating an upload intent
- upload directly into S3-compatible object storage
- use storage-native multipart uploads for larger files
- validate staged objects before they become readable
- preserve the RFC 9457 error contract

There is no local-filesystem backend and no server-proxied upload fallback.
Development uses an S3-compatible service such as RustFS.

## Configuration

The server requires S3-compatible storage coordinates under `files.storage`.
There is no `files.root` compatibility setting and no backend selector.

```toml
[files.storage]
bucket = "canary-dev"
region = "us-east-1"
endpoint = "http://127.0.0.1:9000"
addressing_style = "path_style"
transport_security = "allow_http"

[files.storage.credentials]
kind = "static"
access_key_id = "canaryadmin"
secret_access_key = "canarysecret123"
```

Use ambient credentials in deployments that already provide an AWS-compatible
credential chain:

```toml
[files.storage.credentials]
kind = "ambient"
```

## Flow

1. The client asks Canary to create an upload intent.
2. Canary authenticates the actor, validates policy, allocates an upload ID and
   file ID, and creates a staged object key.
3. Canary returns either a presigned single-request `PUT` or a multipart access
   plan.
4. The client uploads bytes directly to object storage.
5. The client completes the upload explicitly.
6. Canary checks the staged object, verifies its size and checksum, inspects a
   bounded byte sample, and applies media policy.
7. Canary promotes the validated object into the ready namespace and persists
   ready-blob metadata.

A staged object is never readable through the normal file API. Uploading bytes
is necessary, but it is not enough to publish a blob.

## HTTP Surface

The canonical upload endpoints are:

- `POST /api/v1/files/uploads`
- `GET /api/v1/files/uploads/{id}`
- `GET /api/v1/files/uploads/{id}/events`
- `GET /api/v1/files/uploads/{id}/ws`
- `POST /api/v1/files/uploads/{id}/access`
- `POST /api/v1/files/uploads/{id}/parts`
- `POST /api/v1/files/uploads/{id}/complete`
- `POST /api/v1/files/uploads/{id}/abort`

Ready files use:

- `GET /api/v1/files`
- `GET /api/v1/files/{id}`
- `GET /api/v1/files/{id}/meta`

The legacy multipart route, raw upload route, and proxy content route are not
part of the API.

## Upload Modes

### Direct PUT

Smaller files use one presigned `PUT`. The request includes the headers the
client must send, including the SHA-256 checksum bound into the signature.

```json
{
  "id": "upl_...",
  "status": "created",
  "expires_at": "2026-06-02T12:34:56Z",
  "upload": {
    "kind": "direct_put",
    "method": "PUT",
    "url": "https://...",
    "headers": [
      {
        "name": "x-amz-checksum-sha256",
        "value": "..."
      }
    ],
    "checksum": {
      "algorithm": "sha256",
      "kind": "full_object",
      "encoding": "base64"
    }
  }
}
```

### Direct Multipart

Larger files use S3-compatible multipart upload. Clients request signed parts
lazily, retry individual parts as needed, and complete or abort explicitly.

Multipart uploads use CRC64/NVME with full-object semantics. Each part carries
its own checksum, and completion succeeds only when object storage reports the
expected checksum for the assembled object.

## Storage Model

Uploads move through two object namespaces:

- `staging/upload/<upload-id>/object`
- `ready/blob/<file-id>/original`

`UploadSession` owns the staged key. `StoredBlob` owns the ready key. Promotion
copies the accepted object into its ready key with Canary's authoritative
`Content-Type`, then removes the staged object.

Ready-blob metadata persists through SurrealDB. Upload-session state is still
process-local and remains a deliberate follow-up.

## Validation

### Authorization

The server authenticates before creating an intent. The current implementation
uses the typed `x-canary-actor-id` principal boundary until the real auth layer
replaces it.

### Size

The server checks size twice:

1. at intent creation, against `files.uploads.max_bytes`
2. at completion, against the staged object's actual size

### Integrity

Single-request uploads require a declared SHA-256 digest. Multipart uploads use
CRC64/NVME. Canary only records integrity metadata that object storage has
actually verified.

### Media Policy

The client-provided MIME type is a hint, not an authority. During completion,
Canary reads a bounded prefix from the staged object, records what the bytes
suggest, and applies the attachment media profile before promotion.

## Serving

Downloads do not pass through the app server. Canary resolves a ready blob,
creates a short-lived presigned `GET`, and redirects the caller. The redirect
uses the validated serving content type and attachment disposition.

## Cleanup

Expired intents are swept both opportunistically during upload operations and
periodically while the server runs. Cleanup deletes staged objects and aborts
incomplete multipart sessions when necessary.

Bucket lifecycle rules should also remove abandoned multipart parts as a second
line of defense.

## Testing

Fast route tests use an inert S3-compatible endpoint because client
construction does not perform network IO. RustFS-backed ignored integration
tests exercise the real storage contract:

- direct `PUT`
- multipart upload
- storage-verified checksums
- staging-to-ready promotion

## Still Pending

- durable upload-session persistence
- real auth/session binding
- retention cleanup and audit events
- browser-style CORS and signed-header integration coverage
- a generic resumable protocol only if product requirements outgrow
  storage-native multipart upload

## Source Notes

This design is informed primarily by:

- Axum request handling documentation
- `object_store` S3 documentation
- AWS presigned URL and multipart upload guidance
- Cloudflare R2 presigned upload and CORS guidance
- OWASP file upload guidance
