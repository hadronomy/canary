use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::Builder as S3ConfigBuilder;
use aws_sdk_s3::operation::list_parts::ListPartsOutput;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart, MetadataDirective};
use aws_types::region::Region;
use mime::Mime;
use object_store::aws::AmazonS3Builder;
use url::Url;

use crate::config::{S3AddressingStyle, S3Credentials, S3FileConfig, TransportSecurity};
use crate::error::FileError;
use crate::files::upload::{
    CompletedUploadPart, DirectPutAccess, MultipartUploadId, PartNumber, SignedUploadPart,
    UploadHeader,
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
            .with_allow_http(self.transport_security.allows_http())
            .with_virtual_hosted_style_request(!self.addressing_style.is_path_style());
        if let Some(endpoint) = &self.endpoint {
            builder = builder.with_endpoint(endpoint.as_str());
        }
        if let S3Credentials::Static { access_key_id, secret_access_key, session_token } =
            &self.credentials
        {
            builder = builder
                .with_access_key_id(access_key_id.as_str())
                .with_secret_access_key(secret_access_key.reveal());
            if let Some(token) = session_token {
                builder = builder.with_token(token.reveal());
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
                let creds = Credentials::new(
                    access_key_id.as_str(),
                    secret_access_key.reveal().to_owned(),
                    session_token.as_ref().map(|token| token.reveal().to_owned()),
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
            builder.force_path_style(self.addressing_style.is_path_style()).build(),
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
        expires: Duration,
    ) -> Result<DirectPutAccess, FileError> {
        let mut req = self.cli.put_object().bucket(&self.bucket).key(key);
        if let Some(ty) = ty {
            req = req.content_type(ty.as_ref());
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
        })
    }

    pub async fn create_multipart(
        &self,
        key: &str,
        ty: Option<&Mime>,
    ) -> Result<MultipartSession, FileError> {
        let mut req = self.cli.create_multipart_upload().bucket(&self.bucket).key(key);
        if let Some(ty) = ty {
            req = req.content_type(ty.as_ref());
        }
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
        parts: &[PartNumber],
        expires: Duration,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        let mut out = Vec::with_capacity(parts.len());
        for &part in parts {
            let req = self
                .cli
                .upload_part()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id.as_str())
                .part_number(i32::from(part.get()))
                .presigned(pcfg(expires)?)
                .await
                .map_err(|source| FileError::Store { source: Box::new(source) })?;
            out.push(SignedUploadPart {
                number: part,
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
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        let parts = parts
            .iter()
            .map(|part| {
                CompletedPart::builder()
                    .part_number(i32::from(part.number.get()))
                    .e_tag(part.etag.clone())
                    .build()
            })
            .collect::<Vec<_>>();
        let upload = CompletedMultipartUpload::builder().set_parts(Some(parts)).build();
        self.cli
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id.as_str())
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
