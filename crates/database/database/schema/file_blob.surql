DEFINE TABLE file_blob SCHEMAFULL;

DEFINE FIELD cursor ON TABLE file_blob TYPE string;
DEFINE FIELD key ON TABLE file_blob TYPE string;
DEFINE FIELD name ON TABLE file_blob TYPE option<string>;
DEFINE FIELD size_bytes ON TABLE file_blob TYPE int ASSERT $value >= 0;

DEFINE FIELD checksum ON TABLE file_blob TYPE option<object>;
DEFINE FIELD checksum.algorithm ON TABLE file_blob TYPE string;
DEFINE FIELD checksum.value ON TABLE file_blob TYPE string;
DEFINE FIELD checksum.kind ON TABLE file_blob TYPE string;
DEFINE FIELD checksum.verifier ON TABLE file_blob TYPE string;

DEFINE FIELD media_profile ON TABLE file_blob TYPE string;
DEFINE FIELD media_type ON TABLE file_blob TYPE string;
DEFINE FIELD declared_media_type ON TABLE file_blob TYPE option<string>;
DEFINE FIELD sniffed_media_type ON TABLE file_blob TYPE option<string>;
DEFINE FIELD sniffed_state ON TABLE file_blob TYPE option<string>;
DEFINE FIELD sniffed_source ON TABLE file_blob TYPE option<string>;
DEFINE FIELD sniffed_confidence ON TABLE file_blob TYPE option<string>;
DEFINE FIELD sample_kind ON TABLE file_blob TYPE string;
DEFINE FIELD validation_state ON TABLE file_blob TYPE string;

DEFINE FIELD etag ON TABLE file_blob TYPE option<string>;
DEFINE FIELD version ON TABLE file_blob TYPE option<string>;
