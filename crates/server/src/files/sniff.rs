use std::str::FromStr;

use mime::Mime;

use crate::error::FileError;
use crate::files::meta::{
    BlobKind, BlobMedia, BlobObservation, DetectedMedia, DetectionConfidence, DetectionSource,
    DetectionState, MediaProfile, MediaRisk, SampleCompleteness, UploadDecision, ValidationNeed,
    ValidationState,
};

pub struct MediaPolicy {
    active: ActiveContentPolicy,
    passive: PassiveMismatchPolicy,
    unknown: UnknownContentPolicy,
    uncertain: UncertainContentPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveContentPolicy {
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassiveMismatchPolicy {
    NormalizeDetected,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnknownContentPolicy {
    KeepBinary,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UncertainContentPolicy {
    Review,
    Reject,
}

impl MediaProfile {
    #[must_use]
    pub fn policy(self) -> MediaPolicy {
        match self {
            Self::Attachment => MediaPolicy {
                active: ActiveContentPolicy::Reject,
                passive: PassiveMismatchPolicy::NormalizeDetected,
                unknown: UnknownContentPolicy::KeepBinary,
                uncertain: UncertainContentPolicy::Review,
            },
        }
    }
}

pub fn inspect(
    declared: Option<Mime>,
    bytes: &[u8],
    sample: SampleCompleteness,
) -> BlobObservation {
    BlobObservation { declared, detection: detected(bytes, sample), sample }
}

pub fn classify(
    profile: MediaProfile,
    declared: Option<Mime>,
    bytes: &[u8],
    sample: SampleCompleteness,
) -> UploadDecision {
    decide(profile.policy(), inspect(declared, bytes, sample), profile)
}

pub fn decide(
    policy: MediaPolicy,
    observed: BlobObservation,
    profile: MediaProfile,
) -> UploadDecision {
    match observed.detection.clone() {
        DetectionState::Known(detected) => evaluate_known(policy, profile, observed, &detected),
        DetectionState::Possible(detected) => {
            evaluate_possible(policy, profile, observed, &detected)
        }
        DetectionState::Missing => evaluate_missing(policy, profile, observed),
    }
}

fn evaluate_known(
    policy: MediaPolicy,
    profile: MediaProfile,
    observed: BlobObservation,
    detected: &DetectedMedia,
) -> UploadDecision {
    let effective = BlobMedia::Known(detected.mime.clone());
    let kind = BlobKind { profile, observed, effective, validation: ValidationState::Verified };

    let Some(declared) = kind.observed.declared.as_ref() else {
        return match (policy.active, detected.risk()) {
            (ActiveContentPolicy::Reject, MediaRisk::Active) => {
                UploadDecision::Reject(FileError::ActiveContentDisallowed {
                    declared: None,
                    detected: Some(detected.mime.to_string()),
                })
            }
            (ActiveContentPolicy::Reject, MediaRisk::Passive | MediaRisk::Unknown) => {
                UploadDecision::Accept(kind)
            }
        };
    };

    if same_media_type(declared, &detected.mime) {
        return UploadDecision::Accept(kind);
    }

    if is_generic(declared) {
        return match detected.risk() {
            MediaRisk::Active => UploadDecision::Reject(FileError::ContentTypeMismatch {
                declared: Some(declared.to_string()),
                detected: detected.mime.to_string(),
            }),
            MediaRisk::Passive | MediaRisk::Unknown => UploadDecision::Accept(kind),
        };
    }

    let declared_risk = MediaRisk::of(declared);
    if matches!(declared_risk, MediaRisk::Active) || matches!(detected.risk(), MediaRisk::Active) {
        return UploadDecision::Reject(FileError::ContentTypeMismatch {
            declared: Some(declared.to_string()),
            detected: detected.mime.to_string(),
        });
    }

    match policy.passive {
        PassiveMismatchPolicy::NormalizeDetected => UploadDecision::Accept(kind),
        PassiveMismatchPolicy::Reject => UploadDecision::Reject(FileError::ContentTypeMismatch {
            declared: Some(declared.to_string()),
            detected: detected.mime.to_string(),
        }),
    }
}

fn evaluate_possible(
    policy: MediaPolicy,
    profile: MediaProfile,
    observed: BlobObservation,
    detected: &DetectedMedia,
) -> UploadDecision {
    if matches!(detected.risk(), MediaRisk::Active) {
        return UploadDecision::Reject(FileError::ActiveContentDisallowed {
            declared: observed.declared.as_ref().map(ToString::to_string),
            detected: Some(detected.mime.to_string()),
        });
    }

    let kind = BlobKind {
        profile,
        observed,
        effective: BlobMedia::Known(detected.mime.clone()),
        validation: ValidationState::NeedsInspection(ValidationNeed::PrefixInspection),
    };

    let Some(declared) = kind.observed.declared.as_ref() else {
        return match policy.uncertain {
            UncertainContentPolicy::Review => UploadDecision::Review(kind),
            UncertainContentPolicy::Reject => {
                UploadDecision::Reject(FileError::ContentTypeMismatch {
                    declared: None,
                    detected: detected.mime.to_string(),
                })
            }
        };
    };

    if same_media_type(declared, &detected.mime) || is_generic(declared) {
        return match policy.uncertain {
            UncertainContentPolicy::Review => UploadDecision::Review(kind),
            UncertainContentPolicy::Reject => {
                UploadDecision::Reject(FileError::ContentTypeMismatch {
                    declared: Some(declared.to_string()),
                    detected: detected.mime.to_string(),
                })
            }
        };
    }

    if matches!(MediaRisk::of(declared), MediaRisk::Active) {
        return UploadDecision::Reject(FileError::ContentTypeMismatch {
            declared: Some(declared.to_string()),
            detected: detected.mime.to_string(),
        });
    }

    match policy.uncertain {
        UncertainContentPolicy::Review => UploadDecision::Review(kind),
        UncertainContentPolicy::Reject => UploadDecision::Reject(FileError::ContentTypeMismatch {
            declared: Some(declared.to_string()),
            detected: detected.mime.to_string(),
        }),
    }
}

fn evaluate_missing(
    policy: MediaPolicy,
    profile: MediaProfile,
    observed: BlobObservation,
) -> UploadDecision {
    let kind = BlobKind {
        profile,
        observed,
        effective: BlobMedia::Unknown,
        validation: ValidationState::Verified,
    };

    let Some(declared) = kind.observed.declared.as_ref() else {
        return match policy.unknown {
            UnknownContentPolicy::KeepBinary => UploadDecision::Accept(kind),
            UnknownContentPolicy::Reject => UploadDecision::Reject(FileError::InvalidContentType),
        };
    };

    if matches!(MediaRisk::of(declared), MediaRisk::Active) {
        return UploadDecision::Reject(FileError::ActiveContentDisallowed {
            declared: Some(declared.to_string()),
            detected: None,
        });
    }

    match policy.unknown {
        UnknownContentPolicy::KeepBinary => UploadDecision::Accept(kind),
        UnknownContentPolicy::Reject => UploadDecision::Reject(FileError::InvalidContentType),
    }
}

fn detected(bytes: &[u8], sample: SampleCompleteness) -> DetectionState {
    magic(bytes).or_else(|| text(bytes, sample)).unwrap_or(DetectionState::Missing)
}

fn magic(bytes: &[u8]) -> Option<DetectionState> {
    let kind = infer::get(bytes)?;
    let mime = Mime::from_str(kind.mime_type()).ok()?;
    Some(DetectionState::Known(DetectedMedia::new(
        mime,
        DetectionSource::MagicBytes,
        DetectionConfidence::Strong,
    )))
}

fn text(bytes: &[u8], sample: SampleCompleteness) -> Option<DetectionState> {
    let text = std::str::from_utf8(bytes).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    let text = skip_trivia(text);
    if text.is_empty() || !plain(text) {
        return None;
    }

    if let Some(media) = html(text) {
        return Some(DetectionState::Known(media));
    }

    if let Some(media) = svg(text) {
        return Some(DetectionState::Known(media));
    }

    if let Some(media) = xml(text) {
        return Some(DetectionState::Known(media));
    }

    if let Some(media) = json(text, sample) {
        return Some(media);
    }

    let media = DetectedMedia::new(
        mime::TEXT_PLAIN,
        DetectionSource::Utf8Text,
        DetectionConfidence::Heuristic,
    );
    Some(match sample {
        SampleCompleteness::Complete | SampleCompleteness::Empty => DetectionState::Known(media),
        SampleCompleteness::Prefix => DetectionState::Possible(media),
    })
}

fn plain(text: &str) -> bool {
    text.chars().all(|ch| match ch {
        '\0' => false,
        '\t' | '\n' | '\r' => true,
        ch => !ch.is_control(),
    })
}

fn skip_trivia(mut text: &str) -> &str {
    loop {
        text = text.trim_start();
        if let Some(rest) = text.strip_prefix("<!--")
            && let Some(idx) = rest.find("-->")
        {
            text = &rest[idx + 3..];
            continue;
        }
        return text;
    }
}

fn html(text: &str) -> Option<DetectedMedia> {
    let head = head(text);
    if head.starts_with("<!doctype html") || head.starts_with("<html") {
        return Some(DetectedMedia::new(
            mime::TEXT_HTML,
            DetectionSource::HtmlHeuristic,
            DetectionConfidence::Heuristic,
        ));
    }
    None
}

fn svg(text: &str) -> Option<DetectedMedia> {
    let head = head(text);
    if head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg")) {
        return Some(DetectedMedia::new(
            "image/svg+xml".parse().ok()?,
            DetectionSource::SvgHeuristic,
            DetectionConfidence::Heuristic,
        ));
    }
    None
}

fn xml(text: &str) -> Option<DetectedMedia> {
    let head = head(text);
    if head.starts_with("<?xml") {
        return Some(DetectedMedia::new(
            "application/xml".parse().ok()?,
            DetectionSource::XmlHeuristic,
            DetectionConfidence::Heuristic,
        ));
    }
    None
}

fn json(text: &str, sample: SampleCompleteness) -> Option<DetectionState> {
    let head = text.trim_start();
    if !(head.starts_with('{') || head.starts_with('[')) {
        return None;
    }

    let media = DetectedMedia::new(
        mime::APPLICATION_JSON,
        DetectionSource::JsonHeuristic,
        DetectionConfidence::Heuristic,
    );

    if serde_json::from_str::<serde_json::Value>(head).is_ok() {
        return Some(DetectionState::Known(media));
    }

    match sample {
        SampleCompleteness::Prefix => Some(DetectionState::Possible(media)),
        SampleCompleteness::Empty | SampleCompleteness::Complete => None,
    }
}

fn head(text: &str) -> String {
    text.chars().take(1024).collect::<String>().to_ascii_lowercase()
}

fn same_media_type(a: &Mime, b: &Mime) -> bool {
    a.essence_str().eq_ignore_ascii_case(b.essence_str())
}

fn is_generic(mime: &Mime) -> bool {
    mime.essence_str().eq_ignore_ascii_case(mime::APPLICATION_OCTET_STREAM.as_ref())
}

#[cfg(test)]
mod tests {
    use mime::Mime;

    use super::{classify, inspect};
    use crate::error::FileError;
    use crate::files::meta::{
        DetectionSource, DetectionState, MediaProfile, MediaRisk, SampleCompleteness,
        ServingContent, ServingDisposition, UploadDecision, ValidationNeed, ValidationState,
    };

    fn parse(value: &str) -> Mime {
        value.parse().expect("mime should parse")
    }

    #[test]
    fn trusts_sniffed_png_over_generic_declared_type() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("application/octet-stream")),
            b"\x89PNG\r\n\x1a\nrest",
            SampleCompleteness::Prefix,
        );
        let UploadDecision::Accept(kind) = decision else {
            panic!("png should classify");
        };
        assert_eq!(
            kind.observed.declared.as_ref().map(Mime::essence_str),
            Some("application/octet-stream")
        );
        assert_eq!(kind.detected().map(|detected| detected.mime.essence_str()), Some("image/png"));
        assert_eq!(kind.effective.as_str(), "image/png");
        assert_eq!(kind.risk(), MediaRisk::Passive);
        assert_eq!(kind.validation, ValidationState::Verified);
        assert_eq!(kind.serving().disposition, ServingDisposition::Attachment);
        assert_eq!(kind.serving().content, ServingContent::Effective);
    }

    #[test]
    fn rejects_active_mismatch() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("application/octet-stream")),
            b"<!doctype html><html><body>x</body></html>",
            SampleCompleteness::Complete,
        );
        let UploadDecision::Reject(err) = decision else {
            panic!("html mismatch should fail");
        };
        assert!(matches!(
            err,
            FileError::ContentTypeMismatch {
                declared: Some(ref declared),
                ref detected,
            } if declared == "application/octet-stream" && detected == "text/html"
        ));
    }

    #[test]
    fn rejects_declared_active_content_without_detection() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("text/html")),
            b"\x00\xff\x00\xff",
            SampleCompleteness::Complete,
        );
        let UploadDecision::Reject(err) = decision else {
            panic!("declared active content should require verification");
        };
        assert!(matches!(
            err,
            FileError::ActiveContentDisallowed {
                declared: Some(ref declared),
                detected: None,
            } if declared == "text/html"
        ));
    }

    #[test]
    fn accepts_same_essence_with_parameters() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("text/plain; charset=utf-8")),
            b"hello world",
            SampleCompleteness::Complete,
        );
        let UploadDecision::Accept(kind) = decision else {
            panic!("same essence should classify");
        };
        assert_eq!(kind.effective.as_str(), "text/plain");
    }

    #[test]
    fn detects_uppercase_html_after_comments() {
        let observed = inspect(
            None,
            b"<!-- comment --><!DOCTYPE HTML><HTML><BODY>ok</BODY></HTML>",
            SampleCompleteness::Complete,
        );
        let detected = observed.detection.media().expect("html should detect");
        assert_eq!(detected.mime.essence_str(), "text/html");
        assert!(matches!(
            detected.source,
            DetectionSource::MagicBytes | DetectionSource::HtmlHeuristic
        ));
    }

    #[test]
    fn detects_plain_text_prefix_as_review() {
        let decision =
            classify(MediaProfile::Attachment, None, b"hello\n", SampleCompleteness::Prefix);
        let UploadDecision::Review(kind) = decision else {
            panic!("plain text prefix should be reviewed");
        };
        assert_eq!(kind.detected().map(|detected| detected.mime.essence_str()), Some("text/plain"));
        assert_eq!(
            kind.validation,
            ValidationState::NeedsInspection(ValidationNeed::PrefixInspection)
        );
    }

    #[test]
    fn detects_json_as_json() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("application/json")),
            br#"{"hello":"world"}"#,
            SampleCompleteness::Complete,
        );
        let UploadDecision::Accept(kind) = decision else {
            panic!("json should classify");
        };
        assert_eq!(kind.effective.as_str(), "application/json");
    }

    #[test]
    fn keeps_large_json_prefix_out_of_plain_text() {
        let sample = br#"{"hello":"world","nested":{"ok":"still open""#;
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("application/json")),
            sample,
            SampleCompleteness::Prefix,
        );
        let UploadDecision::Review(kind) = decision else {
            panic!("incomplete json prefix should be reviewed");
        };
        assert_eq!(kind.effective.as_str(), "application/json");
        assert!(matches!(kind.observed.detection, DetectionState::Possible(_)));
    }

    #[test]
    fn falls_back_to_octet_stream_when_type_is_unknown() {
        let decision = classify(
            MediaProfile::Attachment,
            Some(parse("image/png")),
            b"\xff\xd8\x00\xff",
            SampleCompleteness::Complete,
        );
        let UploadDecision::Accept(kind) = decision else {
            panic!("unknown binary should still classify");
        };
        assert!(matches!(kind.observed.detection, DetectionState::Missing));
        assert_eq!(kind.effective.as_str(), "application/octet-stream");
    }

    #[test]
    fn marks_empty_samples_explicitly() {
        let observed = inspect(None, b"", SampleCompleteness::Empty);
        assert_eq!(observed.sample, SampleCompleteness::Empty);
        assert!(matches!(observed.detection, DetectionState::Missing));
    }
}
