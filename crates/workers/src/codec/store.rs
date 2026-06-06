use async_trait::async_trait;
use bytes::Bytes;
use tokio::io::AsyncReadExt;

use crate::ClaimKey;
use crate::codec::CodecError;

/// Storage boundary used by the claim-check codec.
#[async_trait]
pub trait ClaimStore: Send + Sync {
    /// Stores a Temporal payload proto under a deterministic claim key.
    async fn put(&self, key: &ClaimKey, bytes: Bytes) -> Result<(), CodecError>;

    /// Loads a previously claimed Temporal payload proto.
    async fn get(&self, key: &ClaimKey) -> Result<Bytes, CodecError>;
}

/// NATS JetStream Object Store implementation of [`ClaimStore`].
#[derive(Clone)]
pub struct NatsClaimStore {
    bucket: async_nats::jetstream::object_store::ObjectStore,
}

impl NatsClaimStore {
    /// Wraps an opened JetStream Object Store bucket.
    pub fn new(bucket: async_nats::jetstream::object_store::ObjectStore) -> Self {
        Self { bucket }
    }
}

#[async_trait]
impl ClaimStore for NatsClaimStore {
    async fn put(&self, key: &ClaimKey, bytes: Bytes) -> Result<(), CodecError> {
        let mut data = std::io::Cursor::new(bytes);
        self.bucket
            .put(key.as_str(), &mut data)
            .await
            .map_err(|err| CodecError::Store(err.to_string()))?;
        Ok(())
    }

    async fn get(&self, key: &ClaimKey) -> Result<Bytes, CodecError> {
        let mut object = self
            .bucket
            .get(key.as_str())
            .await
            .map_err(|err| CodecError::Store(err.to_string()))?;
        let mut bytes = Vec::new();
        object.read_to_end(&mut bytes).await.map_err(|err| CodecError::Store(err.to_string()))?;
        Ok(Bytes::from(bytes))
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryClaimStore {
    map: tokio::sync::RwLock<std::collections::HashMap<ClaimKey, Bytes>>,
}

#[cfg(test)]
#[async_trait]
impl ClaimStore for MemoryClaimStore {
    async fn put(&self, key: &ClaimKey, bytes: Bytes) -> Result<(), CodecError> {
        self.map.write().await.insert(key.clone(), bytes);
        Ok(())
    }

    async fn get(&self, key: &ClaimKey) -> Result<Bytes, CodecError> {
        self.map
            .read()
            .await
            .get(key)
            .cloned()
            .ok_or_else(|| CodecError::Store(format!("{} was not found", key.as_str())))
    }
}
