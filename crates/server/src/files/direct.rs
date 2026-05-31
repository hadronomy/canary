use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::Builder as S3ConfigBuilder;
use aws_sdk_s3::operation::head_object::HeadObjectOutput;
use aws_sdk_s3::operation::list_parts::ListPartsOutput;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::types::{
    ChecksumAlgorithm as AwsChecksumAlgorithm, ChecksumMode, ChecksumType,
    CompletedMultipartUpload, CompletedPart, MetadataDirective,
};
use aws_types::region::Region;
use mime::Mime;
use object_store::aws::AmazonS3Builder;
use secrecy::ExposeSecret;
use url::Url;
use zeroize::Zeroizing;

use crate::config::{S3AddressingStyle, S3Credentials, S3FileConfig, TransportSecurity};
use crate::error::FileError;
use crate::files::meta::{
    BlobChecksum, ChecksumAlgorithm, ChecksumKind, ChecksumVerifier, Sha256Digest,
};
use crate::files::store::BlobHead;
use crate::files::upload::{
    ChecksumEncoding, CompletedUploadPart, DirectPutAccess, MultipartUploadId, PartNumber,
    RequestedUploadPart, SignedUploadPart, UploadChecksum, UploadHeader,
};

#[derive(Debug, Clone)]
pub struct MultipartSession {
    pub id: MultipartUploadId,
}

#[derive(Debug, Clone)]
pub struct S3RuntimeConfig {
    bucket: String,
    endpoint: Option<Url>,
    prefix: Option<String>,
    region: String,
    addressing_style: S3AddressingStyle,
    transport_security: TransportSecurity,
    credentials: S3Credentials,
}

impl S3RuntimeConfig {
    #[must_use]
    pub fn from_file(cfg: &S3FileConfig) -> Self {
        Self {
            bucket: cfg.bucket.as_str().to_owned(),
            endpoint: cfg.endpoint.clone(),
            prefix: cfg.prefix.as_ref().map(|value| value.as_str().to_owned()),
            region: cfg.region.as_str().to_owned(),
            addressing_style: cfg.addressing_style,
            transport_security: cfg.transport_security,
            credentials: cfg.credentials.clone(),
        }
    }

    #[must_use]
    pub fn bucket(&self) -> &str {
        self.bucket.as_str()
    }

    #[must_use]
    pub fn prefix(&self) -> Option<&str> {
        self.prefix.as_deref()
    }

    #[must_use]
    pub fn object_store_builder(&self) -> AmazonS3Builder {
        let mut builder = AmazonS3Builder::from_env()
            .with_bucket_name(self.bucket())
            .with_region(self.region.as_str())
            .with_allow_http(matches!(self.transport_security, TransportSecurity::AllowHttp))
            .with_virtual_hosted_style_request(!matches!(
                self.addressing_style,
                S3AddressingStyle::PathStyle
            ));
        if let Some(endpoint) = &self.endpoint {
            builder = builder.with_endpoint(endpoint.as_str());
        }
        if let S3Credentials::Static { access_key_id, secret_access_key, session_token } =
            &self.credentials
        {
            builder = builder
                .with_access_key_id(access_key_id.as_str())
                .with_secret_access_key(secret_access_key.expose_secret());
            if let Some(token) = session_token {
                builder = builder.with_token(token.expose_secret());
            }
        }
        builder
    }

    pub async fn sdk_client(&self) -> Result<Client, FileError> {
        let builder = match &self.credentials {
            S3Credentials::Ambient => {
                let mut loader = aws_config::defaults(BehaviorVersion::latest())
                    .region(Region::new(self.region.clone()));
                if let Some(endpoint) = &self.endpoint {
                    loader = loader.endpoint_url(endpoint.as_str());
                }
                let shared = loader.load().await;
                S3ConfigBuilder::from(&shared)
            }
            S3Credentials::Static { access_key_id, secret_access_key, session_token } => {
                let key = Zeroizing::new(secret_access_key.expose_secret().to_owned());
                let tok = session_token
                    .as_ref()
                    .map(|token| Zeroizing::new(token.expose_secret().to_owned()));
                let creds = Credentials::new(
                    access_key_id.as_str(),
                    key.as_str(),
                    tok.as_deref().cloned(),
                    None,
                    "canary-server",
                );
                let mut builder = S3ConfigBuilder::new()
                    .behavior_version(BehaviorVersion::latest())
                    .region(Region::new(self.region.clone()))
                    .credentials_provider(creds);
                if let Some(endpoint) = &self.endpoint {
                    builder = builder.endpoint_url(endpoint.as_str());
                }
                builder
            }
        };
        Ok(Client::from_conf(
            builder
                .force_path_style(matches!(self.addressing_style, S3AddressingStyle::PathStyle))
                .build(),
        ))
    }
}

#[derive(Debug, Clone)]
pub struct S3DirectBackend {
    bucket: String,
    cli: Client,
}

impl S3DirectBackend {
    pub async fn new(cfg: &S3RuntimeConfig) -> Result<Self, FileError> {
        Ok(Self { bucket: cfg.bucket().to_owned(), cli: cfg.sdk_client().await? })
    }

    pub async fn sign_put(
        &self,
        key: &str,
        ty: Option<&Mime>,
        sha256: Option<&Sha256Digest>,
        expires: Duration,
    ) -> Result<DirectPutAccess, FileError> {
        let mut req = self.cli.put_object().bucket(&self.bucket).key(key);
        if let Some(ty) = ty {
            req = req.content_type(ty.as_ref());
        }
        if let Some(sha256) = sha256 {
            req = req.checksum_sha256(sha256.to_base64());
        }
        let req = req
            .presigned(pcfg(expires)?)
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(DirectPutAccess {
            url: req.uri().to_string(),
            headers: req
                .headers()
                .map(|(name, value)| UploadHeader {
                    name: name.to_owned(),
                    value: value.to_owned(),
                })
                .collect(),
            checksum: UploadChecksum {
                algorithm: ChecksumAlgorithm::Sha256,
                kind: ChecksumKind::FullObject,
                encoding: ChecksumEncoding::Base64,
            },
        })
    }

    pub async fn sign_get(
        &self,
        key: &str,
        ty: &str,
        name: &str,
        expires: Duration,
    ) -> Result<String, FileError> {
        let req = self
            .cli
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .response_content_type(ty)
            .response_content_disposition(disposition(name))
            .presigned(pcfg(expires)?)
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(req.uri().to_string())
    }

    pub async fn head(&self, key: &str) -> Result<BlobHead, FileError> {
        let out = self
            .cli
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(BlobHead {
            size: out.content_length().unwrap_or_default().max(0) as u64,
            etag: out.e_tag().map(str::to_owned),
            version: out.version_id().map(str::to_owned),
            checksum: checksum(&out),
        })
    }

    pub async fn create_multipart(
        &self,
        key: &str,
        ty: Option<&Mime>,
        checksum: UploadChecksum,
    ) -> Result<MultipartSession, FileError> {
        let mut req = self.cli.create_multipart_upload().bucket(&self.bucket).key(key);
        if let Some(ty) = ty {
            req = req.content_type(ty.as_ref());
        }
        req = req.checksum_algorithm(alg(checksum.algorithm)).checksum_type(kind(checksum.kind));
        let out =
            req.send().await.map_err(|source| FileError::Store { source: Box::new(source) })?;
        let Some(upload_id) = out.upload_id() else {
            return Err(FileError::UploadIncomplete);
        };
        Ok(MultipartSession { id: MultipartUploadId::new(upload_id)? })
    }

    pub async fn sign_parts(
        &self,
        key: &str,
        upload_id: &MultipartUploadId,
        parts: &[RequestedUploadPart],
        expires: Duration,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        let mut out = Vec::with_capacity(parts.len());
        for part in parts {
            let req = self
                .cli
                .upload_part()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id.as_str())
                .part_number(i32::from(part.number.get()))
                .checksum_crc64_nvme(part.checksum.clone())
                .presigned(pcfg(expires)?)
                .await
                .map_err(|source| FileError::Store { source: Box::new(source) })?;
            out.push(SignedUploadPart {
                number: part.number,
                method: "PUT",
                url: req.uri().to_string(),
                headers: req
                    .headers()
                    .map(|(name, value)| UploadHeader {
                        name: name.to_owned(),
                        value: value.to_owned(),
                    })
                    .collect(),
            });
        }
        Ok(out)
    }

    pub async fn list_parts(
        &self,
        key: &str,
        upload_id: &MultipartUploadId,
    ) -> Result<Vec<PartNumber>, FileError> {
        let mut token = None::<String>;
        let mut parts = Vec::new();
        loop {
            let mut req =
                self.cli.list_parts().bucket(&self.bucket).key(key).upload_id(upload_id.as_str());
            if let Some(value) = token.as_deref() {
                req = req.part_number_marker(value);
            }
            let out =
                req.send().await.map_err(|source| FileError::Store { source: Box::new(source) })?;
            for part in out.parts().iter().filter_map(|part| part.part_number()) {
                parts.push(PartNumber::new(part as u16)?);
            }
            match next_token(&out) {
                Some(next) => token = Some(next),
                None => break,
            }
        }
        Ok(parts)
    }

    pub async fn complete_multipart(
        &self,
        key: &str,
        upload_id: &MultipartUploadId,
        checksum: &str,
        size: u64,
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        let parts = parts
            .iter()
            .map(|part| {
                CompletedPart::builder()
                    .part_number(i32::from(part.number.get()))
                    .e_tag(part.etag.clone())
                    .checksum_crc64_nvme(part.checksum.clone())
                    .build()
            })
            .collect::<Vec<_>>();
        let upload = CompletedMultipartUpload::builder().set_parts(Some(parts)).build();
        self.cli
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id.as_str())
            .checksum_crc64_nvme(checksum)
            .checksum_type(ChecksumType::FullObject)
            .mpu_object_size(size as i64)
            .multipart_upload(upload)
            .send()
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(())
    }

    pub async fn abort_multipart(
        &self,
        key: &str,
        upload_id: &MultipartUploadId,
    ) -> Result<(), FileError> {
        self.cli
            .abort_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id.as_str())
            .send()
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(())
    }

    /// Copies a validated staging object into its ready key with canonical metadata.
    ///
    /// Direct uploads land in staging first. After Canary validates the object,
    /// promotion copies it into the ready namespace with the authoritative
    /// `Content-Type`, then deletes the staging object. This keeps staging
    /// private and ensures only ready keys are ever served.
    pub async fn promote(&self, from: &str, to: &str, ty: &str) -> Result<(), FileError> {
        self.cli
            .copy_object()
            .bucket(&self.bucket)
            .key(to)
            .copy_source(format!("{}/{}", self.bucket, from))
            .metadata_directive(MetadataDirective::Replace)
            .content_type(ty)
            .send()
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        if let Err(source) = self.cli.delete_object().bucket(&self.bucket).key(from).send().await {
            tracing::warn!(%source, from, to, "failed to delete staging object after promotion");
        }
        Ok(())
    }
}

fn checksum(out: &HeadObjectOutput) -> Option<BlobChecksum> {
    if let Some(value) = out.checksum_sha256() {
        return Some(BlobChecksum::new(
            ChecksumAlgorithm::Sha256,
            value,
            head_kind(out.checksum_type(), ChecksumAlgorithm::Sha256),
            ChecksumVerifier::Storage,
        ));
    }
    if let Some(value) = out.checksum_crc64_nvme() {
        return Some(BlobChecksum::new(
            ChecksumAlgorithm::Crc64Nvme,
            value,
            head_kind(out.checksum_type(), ChecksumAlgorithm::Crc64Nvme),
            ChecksumVerifier::Storage,
        ));
    }
    if let Some(value) = out.checksum_crc32_c() {
        return Some(BlobChecksum::new(
            ChecksumAlgorithm::Crc32c,
            value,
            head_kind(out.checksum_type(), ChecksumAlgorithm::Crc32c),
            ChecksumVerifier::Storage,
        ));
    }
    None
}

fn head_kind(value: Option<&ChecksumType>, alg: ChecksumAlgorithm) -> ChecksumKind {
    match value {
        Some(ChecksumType::Composite) => ChecksumKind::Composite,
        Some(ChecksumType::FullObject) => ChecksumKind::FullObject,
        Some(_) => ChecksumKind::FullObject,
        None if matches!(alg, ChecksumAlgorithm::Crc64Nvme) => ChecksumKind::FullObject,
        None => ChecksumKind::FullObject,
    }
}

fn kind(value: ChecksumKind) -> ChecksumType {
    match value {
        ChecksumKind::FullObject => ChecksumType::FullObject,
        ChecksumKind::Composite => ChecksumType::Composite,
    }
}

fn alg(value: ChecksumAlgorithm) -> AwsChecksumAlgorithm {
    match value {
        ChecksumAlgorithm::Sha256 => AwsChecksumAlgorithm::Sha256,
        ChecksumAlgorithm::Crc32c => AwsChecksumAlgorithm::Crc32C,
        ChecksumAlgorithm::Crc64Nvme => AwsChecksumAlgorithm::Crc64Nvme,
    }
}

fn disposition(name: &str) -> String {
    format!("attachment; filename=\"{}\"", name.replace('\"', ""))
}

fn pcfg(expires: Duration) -> Result<PresigningConfig, FileError> {
    PresigningConfig::builder()
        .expires_in(expires)
        .build()
        .map_err(|source| FileError::Store { source: Box::new(source) })
}

fn next_token(out: &ListPartsOutput) -> Option<String> {
    if out.is_truncated() == Some(true) {
        return out.next_part_number_marker().map(str::to_owned);
    }
    None
}

#[cfg(test)]
mod tests {
    use aws_sdk_s3::operation::list_parts::ListPartsOutput;

    use super::next_token;

    #[test]
    fn ignores_marker_when_page_is_not_truncated() {
        let out =
            ListPartsOutput::builder().is_truncated(false).next_part_number_marker("2").build();
        assert_eq!(next_token(&out), None);
    }

    #[test]
    fn returns_marker_when_page_is_truncated() {
        let out =
            ListPartsOutput::builder().is_truncated(true).next_part_number_marker("2").build();
        assert_eq!(next_token(&out), Some("2".to_owned()));
    }
}
