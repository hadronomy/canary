//! Typed file-domain identifiers exposed through [`public_id::PublicId`].

use public_id::resource_id;

resource_id!(
    /// Identifies a durable file/blob resource.
    #[doc(alias = "blob_id")]
    pub FileId,
    "file"
);

resource_id!(
    /// Identifies an upload session.
    pub UploadId,
    "upl"
);
