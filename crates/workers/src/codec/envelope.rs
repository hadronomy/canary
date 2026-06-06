use super::generated::claim_generated::canary::temporal::codec::{
    ClaimEnvelope, ClaimEnvelopeArgs, root_as_claim_envelope,
};
use crate::ClaimDigest;
use crate::codec::CodecError;

/// Decoded claim-check envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub version: u16,
    pub bucket: String,
    pub key: String,
    pub digest: ClaimDigest,
    pub size: u64,
    pub created_unix_ms: u64,
}

/// Encodes an envelope as a FlatBuffer.
pub fn encode(value: Envelope) -> Result<Vec<u8>, CodecError> {
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let bucket = builder.create_string(&value.bucket);
    let key = builder.create_string(&value.key);
    let digest = builder.create_vector(value.digest.as_bytes());
    let envelope = ClaimEnvelope::create(
        &mut builder,
        &ClaimEnvelopeArgs {
            version: value.version,
            bucket: Some(bucket),
            key: Some(key),
            sha256: Some(digest),
            size: value.size,
            created_unix_ms: value.created_unix_ms,
        },
    );
    builder.finish(envelope, None);
    Ok(builder.finished_data().to_vec())
}

/// Decodes an envelope from a FlatBuffer.
pub fn decode(bytes: &[u8]) -> Result<Envelope, CodecError> {
    let envelope =
        root_as_claim_envelope(bytes).map_err(|err| CodecError::Envelope(err.to_string()))?;
    let digest =
        envelope.sha256().ok_or_else(|| CodecError::Envelope("missing sha256".to_owned()))?;
    let digest = ClaimDigest::try_from(digest.bytes().to_vec())
        .map_err(|err| CodecError::Envelope(err.to_string()))?;
    Ok(Envelope {
        version: envelope.version(),
        bucket: envelope
            .bucket()
            .ok_or_else(|| CodecError::Envelope("missing bucket".to_owned()))?
            .to_owned(),
        key: envelope
            .key()
            .ok_or_else(|| CodecError::Envelope("missing key".to_owned()))?
            .to_owned(),
        digest,
        size: envelope.size(),
        created_unix_ms: envelope.created_unix_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_roundtrips() {
        let input = Envelope {
            version: 1,
            bucket: "bucket".to_owned(),
            key: "payloads/abc".to_owned(),
            digest: ClaimDigest::from_bytes(b"payload"),
            size: 123,
            created_unix_ms: 456,
        };
        assert_eq!(decode(&encode(input.clone()).unwrap()).unwrap(), input);
    }
}
