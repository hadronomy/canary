//! Temporal payload codec backed by a JetStream claim check.
//!
//! Payloads below the configured threshold pass through untouched. Larger
//! payloads are written to JetStream Object Store and replaced with a small
//! FlatBuffer envelope that points back to the stored bytes.

mod envelope;
pub mod generated;
mod store;

use std::sync::Arc;
use std::time::SystemTime;

use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use prost::Message;
#[cfg(test)]
pub use store::MemoryClaimStore;
pub use store::{ClaimStore, NatsClaimStore};
use temporalio_common::data_converters::{PayloadCodec, SerializationContextData};
use temporalio_common::protos::temporal::api::common::v1::Payload;
use thiserror::Error;
use tracing::warn;

use crate::{ClaimDigest, ClaimKey};

const ENCODING_KEY: &str = "encoding";
const CLAIM_ENCODING: &[u8] = b"canary/claim-check+flatbuffers";

/// Errors raised by the claim-check codec.
#[derive(Debug, Error, miette::Diagnostic)]
pub enum CodecError {
    /// Storing or loading a claim-check object failed.
    #[error("claim-check store failed: {0}")]
    #[diagnostic(code(canary_workers::codec::store))]
    Store(String),

    /// The claim envelope was not valid FlatBuffers data.
    #[error("invalid claim-check envelope: {0}")]
    #[diagnostic(code(canary_workers::codec::envelope))]
    Envelope(String),

    /// The restored object size did not match the envelope.
    #[error("claim-check object has size {actual} bytes, expected {expected} bytes")]
    #[diagnostic(code(canary_workers::codec::size))]
    Size { expected: usize, actual: usize },

    /// The restored object digest did not match the envelope.
    #[error("claim-check object digest did not match the envelope")]
    #[diagnostic(code(canary_workers::codec::digest))]
    Digest,

    /// Temporal payload proto bytes could not be decoded.
    #[error("failed to decode Temporal payload proto: {0}")]
    #[diagnostic(code(canary_workers::codec::payload))]
    Payload(String),
}

/// Temporal payload codec that applies the claim-check pattern.
#[derive(Clone)]
pub struct ClaimCheckCodec {
    bucket: String,
    threshold: usize,
    store: Arc<dyn ClaimStore>,
}

impl ClaimCheckCodec {
    /// Creates a codec using the configured object-store bucket.
    pub fn new(bucket: impl Into<String>, threshold: usize, store: Arc<dyn ClaimStore>) -> Self {
        Self { bucket: bucket.into(), threshold, store }
    }

    /// Encodes payloads and reports claim-check failures to the caller.
    pub async fn encode_checked(&self, payloads: Vec<Payload>) -> Result<Vec<Payload>, CodecError> {
        let mut out = Vec::with_capacity(payloads.len());
        for payload in payloads {
            out.push(self.encode_payload(payload).await?);
        }
        Ok(out)
    }

    /// Decodes payloads and reports claim-check failures to the caller.
    pub async fn decode_checked(&self, payloads: Vec<Payload>) -> Result<Vec<Payload>, CodecError> {
        let mut out = Vec::with_capacity(payloads.len());
        for payload in payloads {
            out.push(self.decode_payload(payload).await?);
        }
        Ok(out)
    }

    async fn encode_payload(&self, payload: Payload) -> Result<Payload, CodecError> {
        if payload.encoded_len() < self.threshold || is_claim_payload(&payload) {
            return Ok(payload);
        }

        let raw = payload.encode_to_vec();
        let digest = ClaimDigest::from_bytes(&raw);
        let key = ClaimKey::from_digest(&digest);
        self.store.put(&key, raw.clone().into()).await?;

        Ok(Payload {
            metadata: claim_metadata(),
            data: envelope::encode(envelope::Envelope {
                version: 1,
                bucket: self.bucket.clone(),
                key: key.as_str().to_owned(),
                digest,
                size: raw.len() as u64,
                created_unix_ms: now_ms(),
            })?,
            ..Default::default()
        })
    }

    async fn decode_payload(&self, payload: Payload) -> Result<Payload, CodecError> {
        if !is_claim_payload(&payload) {
            return Ok(payload);
        }

        let envelope = envelope::decode(&payload.data)?;
        let key =
            ClaimKey::new(envelope.key).map_err(|err| CodecError::Envelope(err.to_string()))?;
        let raw = self.store.get(&key).await?;
        if raw.len() != envelope.size as usize {
            return Err(CodecError::Size { expected: envelope.size as usize, actual: raw.len() });
        }
        if ClaimDigest::from_bytes(&raw) != envelope.digest {
            return Err(CodecError::Digest);
        }
        Payload::decode(raw.as_ref()).map_err(|err| CodecError::Payload(err.to_string()))
    }
}

impl PayloadCodec for ClaimCheckCodec {
    fn encode(
        &self,
        _: &SerializationContextData,
        payloads: Vec<Payload>,
    ) -> BoxFuture<'static, Vec<Payload>> {
        let codec = self.clone();
        async move {
            match codec.encode_checked(payloads).await {
                Ok(payloads) => payloads,
                Err(err) => {
                    warn!(error = %err, "claim-check payload encoding failed");
                    Vec::new()
                }
            }
        }
        .boxed()
    }

    fn decode(
        &self,
        _: &SerializationContextData,
        payloads: Vec<Payload>,
    ) -> BoxFuture<'static, Vec<Payload>> {
        let codec = self.clone();
        async move {
            match codec.decode_checked(payloads).await {
                Ok(payloads) => payloads,
                Err(err) => {
                    warn!(error = %err, "claim-check payload decoding failed");
                    Vec::new()
                }
            }
        }
        .boxed()
    }
}

#[inline(always)]
fn is_claim_payload(payload: &Payload) -> bool {
    payload.metadata.get(ENCODING_KEY).is_some_and(|value| value.as_slice() == CLAIM_ENCODING)
}

#[inline(always)]
fn claim_metadata() -> std::collections::HashMap<String, Vec<u8>> {
    std::collections::HashMap::from([(ENCODING_KEY.to_owned(), CLAIM_ENCODING.to_vec())])
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn payload(data: &[u8]) -> Payload {
        Payload {
            metadata: HashMap::from([("encoding".to_owned(), b"binary/plain".to_vec())]),
            data: data.to_vec(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn small_payloads_pass_through() {
        let store = Arc::new(MemoryClaimStore::default());
        let codec = ClaimCheckCodec::new("bucket", 1024, store);
        let input = payload(b"small");
        let output = codec.encode_checked(vec![input.clone()]).await.unwrap();
        assert_eq!(output, vec![input]);
    }

    #[tokio::test]
    async fn large_payloads_roundtrip_through_claim_store() {
        let store = Arc::new(MemoryClaimStore::default());
        let codec = ClaimCheckCodec::new("bucket", 1, store);
        let input = payload(b"large-enough");
        let encoded = codec.encode_checked(vec![input.clone()]).await.unwrap();
        assert!(is_claim_payload(&encoded[0]));
        let decoded = codec.decode_checked(encoded).await.unwrap();
        assert_eq!(decoded, vec![input]);
    }
}
