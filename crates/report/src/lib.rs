#![forbid(unsafe_code)]

//! Small report documents for configuration and diagnostics.
//!
//! A [`Report`] describes itself as ordered sections and fields. Renderers can
//! turn that document into human terminal output, JSON, TOML, or anything else
//! without learning the shape of the original config type.

use std::fmt;
use std::time::Duration;

use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};

/// A type that can describe itself as a report document.
pub trait Report {
    /// Builds this value's report document.
    fn report(&self) -> Doc;

    /// Builds a standalone report document for this value.
    #[must_use]
    #[inline(always)]
    fn to_doc(&self) -> Doc {
        self.report()
    }
}

/// Fluent document builder used by [`Report`] implementations.
///
/// Call [`section`](Self::section) before adding fields. The returned
/// [`SectionBuilder`] owns field-level methods, so a report cannot accidentally
/// append fields without a section.
#[derive(Debug, Clone)]
pub struct Builder {
    doc: Doc,
}

impl Builder {
    /// Creates an empty report builder.
    #[must_use]
    #[inline(always)]
    pub const fn new() -> Self {
        Self { doc: Doc::new() }
    }

    /// Starts a new section.
    #[must_use]
    #[inline(always)]
    pub fn section(self, key: &'static str, title: &'static str) -> SectionBuilder {
        SectionBuilder {
            doc: self.doc,
            section: Section::new(key, title),
            indent: Indent::NONE,
            numbering: None,
        }
    }

    /// Adds every section from another report.
    #[must_use]
    #[inline(always)]
    pub fn extend(mut self, value: &impl Report) -> Self {
        self.doc.sections.extend(value.report().sections);
        self
    }

    /// Finalizes the builder.
    #[must_use]
    #[inline(always)]
    pub fn build(self) -> Doc {
        self.doc
    }
}

impl Default for Builder {
    #[inline(always)]
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for the section currently being described.
///
/// It keeps field methods close to the open section, and carries label
/// indentation as data instead of making callers hand-write padding into
/// labels.
#[derive(Debug, Clone)]
pub struct SectionBuilder {
    doc: Doc,
    section: Section,
    indent: Indent,
    numbering: Option<Numbering>,
}

impl SectionBuilder {
    /// Adds a field to the current section.
    #[must_use]
    #[inline(always)]
    pub fn field(
        mut self,
        key: &'static str,
        label: &'static str,
        value: impl Into<Value>,
    ) -> Self {
        let marker = self.marker();
        self.section.fields.push(Field::marked(key, label, value, self.indent, marker));
        self
    }

    /// Runs a group of fields one indentation level deeper.
    ///
    /// Nested calls compose, and indentation automatically returns to the
    /// previous level when the closure returns.
    #[must_use]
    #[inline(always)]
    pub fn indent(self, f: impl FnOnce(Self) -> Self) -> Self {
        let parent = self.indent;
        let numbering = self.numbering;
        let mut child = f(Self {
            doc: self.doc,
            section: self.section,
            indent: self.indent.next(),
            numbering: None,
        });
        child.indent = parent;
        child.numbering = numbering;
        child
    }

    /// Runs a group of fields with generated ordinal markers.
    ///
    /// Only direct fields in the closure are numbered. Nested indentation
    /// scopes stay as detail rows unless they start their own enumeration.
    #[must_use]
    #[inline(always)]
    pub fn enumerate(self, f: impl FnOnce(Self) -> Self) -> Self {
        let numbering = self.numbering;
        let mut child = f(Self {
            doc: self.doc,
            section: self.section,
            indent: self.indent,
            numbering: Some(Numbering::default()),
        });
        child.numbering = numbering;
        child
    }

    /// Closes the current section and starts another one.
    #[must_use]
    #[inline(always)]
    pub fn section(mut self, key: &'static str, title: &'static str) -> Self {
        self.flush();
        self.section = Section::new(key, title);
        self.indent = Indent::NONE;
        self.numbering = None;
        self
    }

    /// Closes the current section and adds every section from another report.
    #[must_use]
    #[inline(always)]
    pub fn extend(mut self, value: &impl Report) -> Builder {
        self.flush();
        Builder { doc: self.doc }.extend(value)
    }

    /// Finalizes the builder.
    #[must_use]
    #[inline(always)]
    pub fn build(mut self) -> Doc {
        self.flush();
        self.doc
    }

    #[inline(always)]
    fn flush(&mut self) {
        self.doc.sections.push(std::mem::replace(&mut self.section, Section::empty()));
    }

    #[inline(always)]
    fn marker(&mut self) -> Option<Marker> {
        self.numbering.as_mut().map(Numbering::next)
    }
}

/// Renderer-neutral report document.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Doc {
    sections: Vec<Section>,
}

impl Doc {
    /// Creates a fluent report document builder.
    #[must_use]
    #[inline(always)]
    pub const fn builder() -> Builder {
        Builder::new()
    }

    /// Creates an empty report document.
    #[must_use]
    #[inline(always)]
    pub const fn new() -> Self {
        Self { sections: Vec::new() }
    }

    /// Returns sections in display order.
    #[must_use]
    #[inline(always)]
    pub fn sections(&self) -> &[Section] {
        &self.sections
    }
}

impl Serialize for Doc {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(Some(self.sections.len()))?;
        for section in &self.sections {
            map.serialize_entry(section.key(), section)?;
        }
        map.end()
    }
}

/// One named group in a report document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    key: &'static str,
    title: &'static str,
    fields: Vec<Field>,
}

impl Section {
    /// Creates an empty section.
    #[must_use]
    #[inline(always)]
    pub const fn new(key: &'static str, title: &'static str) -> Self {
        Self { key, title, fields: Vec::new() }
    }

    #[inline(always)]
    const fn empty() -> Self {
        Self::new("", "")
    }

    /// Returns the stable structured-output key.
    #[must_use]
    #[inline(always)]
    pub const fn key(&self) -> &'static str {
        self.key
    }

    /// Returns the human-facing section title.
    #[must_use]
    #[inline(always)]
    pub const fn title(&self) -> &'static str {
        self.title
    }

    /// Returns fields in display order.
    #[must_use]
    #[inline(always)]
    pub fn fields(&self) -> &[Field] {
        &self.fields
    }
}

impl Serialize for Section {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        fields(&self.fields, serializer)
    }
}

/// One value inside a report section or record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    key: &'static str,
    label: &'static str,
    indent: Indent,
    marker: Option<Marker>,
    value: Value,
}

impl Field {
    /// Creates a field from a structured key, display label, and value.
    #[must_use]
    #[inline(always)]
    pub fn new(key: &'static str, label: &'static str, value: impl Into<Value>) -> Self {
        Self::marked(key, label, value, Indent::NONE, None)
    }

    #[inline(always)]
    fn marked(
        key: &'static str,
        label: &'static str,
        value: impl Into<Value>,
        indent: Indent,
        marker: Option<Marker>,
    ) -> Self {
        Self { key, label, indent, marker, value: value.into() }
    }

    /// Returns the stable structured-output key.
    #[must_use]
    #[inline(always)]
    pub const fn key(&self) -> &'static str {
        self.key
    }

    /// Returns the human-facing label.
    #[must_use]
    #[inline(always)]
    pub const fn label(&self) -> &'static str {
        self.label
    }

    /// Returns the label indentation level.
    #[must_use]
    #[inline(always)]
    pub const fn indent(&self) -> Indent {
        self.indent
    }

    /// Returns the presentation marker for the field.
    #[must_use]
    #[inline(always)]
    pub const fn marker(&self) -> Option<Marker> {
        self.marker
    }

    /// Returns the field value.
    #[must_use]
    #[inline(always)]
    pub const fn value(&self) -> &Value {
        &self.value
    }
}

/// Label indentation depth for a report field.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Indent(u8);

impl Indent {
    /// No label indentation.
    pub const NONE: Self = Self(0);

    /// Returns the indentation depth.
    #[must_use]
    #[inline(always)]
    pub const fn level(self) -> u8 {
        self.0
    }

    #[must_use]
    #[inline(always)]
    const fn next(self) -> Self {
        Self(self.0.saturating_add(1))
    }
}

/// Presentation marker shown before a report field label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Marker {
    /// A generated ordinal marker.
    Ordinal(u16),
}

impl Marker {
    /// Returns a displayable marker string.
    #[must_use]
    #[inline(always)]
    pub fn display(self) -> String {
        self.to_string()
    }
}

impl fmt::Display for Marker {
    #[inline(always)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ordinal(value) => write!(f, "{value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Numbering {
    next: u16,
}

impl Numbering {
    #[inline(always)]
    fn next(&mut self) -> Marker {
        let value = self.next;
        self.next = self.next.saturating_add(1);
        Marker::Ordinal(value)
    }
}

impl Default for Numbering {
    #[inline(always)]
    fn default() -> Self {
        Self { next: 1 }
    }
}

/// A nested record used for repeated or grouped values.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Record {
    summary: Option<String>,
    fields: Vec<Field>,
}

impl Record {
    /// Creates an empty record.
    #[must_use]
    #[inline(always)]
    pub const fn new() -> Self {
        Self { summary: None, fields: Vec::new() }
    }

    /// Adds the text renderers should use when the record appears in a row.
    #[must_use]
    #[inline(always)]
    pub fn summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = Some(summary.into());
        self
    }

    /// Adds a field to the record.
    #[must_use]
    #[inline(always)]
    pub fn field(mut self, field: Field) -> Self {
        self.fields.push(field);
        self
    }

    /// Returns the display summary when one was supplied.
    #[must_use]
    #[inline(always)]
    pub fn summary_text(&self) -> Option<&str> {
        self.summary.as_deref()
    }

    /// Returns record fields in display order.
    #[must_use]
    #[inline(always)]
    pub fn fields(&self) -> &[Field] {
        &self.fields
    }
}

impl Serialize for Record {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        fields(&self.fields, serializer)
    }
}

/// Renderer-neutral value stored in a report field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Null,
    Bool(bool),
    I64(i64),
    U64(u64),
    Bytes(u64),
    Text(String),
    List(Vec<Value>),
    Record(Record),
    Records(Vec<Record>),
    Redacted,
}

impl Value {
    /// Creates a value for a duration formatted with `humantime`.
    #[must_use]
    #[inline(always)]
    pub fn duration(value: Duration) -> Self {
        Self::Text(humantime(value))
    }

    /// Creates a value for a byte count.
    #[must_use]
    #[inline(always)]
    pub const fn bytes(value: u64) -> Self {
        Self::Bytes(value)
    }

    /// Creates a list value from items that already know how to become values.
    #[must_use]
    #[inline(always)]
    pub fn list<I, T>(values: I) -> Self
    where
        I: IntoIterator<Item = T>,
        T: Into<Value>,
    {
        Self::List(values.into_iter().map(Into::into).collect())
    }

    /// Returns text suitable for a compact human row.
    #[must_use]
    pub fn display(&self) -> String {
        match self {
            Self::Null => "none".into(),
            Self::Bool(value) => bool_label(*value).into(),
            Self::I64(value) => value.to_string(),
            Self::U64(value) => value.to_string(),
            Self::Bytes(value) => bytes(*value),
            Self::Text(value) => value.clone(),
            Self::List(values) => list(values.iter().map(Self::display)),
            Self::Record(value) => record(value),
            Self::Records(values) => list(values.iter().map(record)),
            Self::Redacted => "<redacted>".into(),
        }
    }
}

impl Serialize for Value {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Null => serializer.serialize_str("none"),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::I64(value) => serializer.serialize_i64(*value),
            Self::U64(value) => serializer.serialize_u64(*value),
            Self::Bytes(value) => serializer.serialize_u64(*value),
            Self::Text(value) => serializer.serialize_str(value),
            Self::List(values) => values.serialize(serializer),
            Self::Record(value) => value.serialize(serializer),
            Self::Records(values) => {
                let mut seq = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    seq.serialize_element(value)?;
                }
                seq.end()
            }
            Self::Redacted => serializer.serialize_str("<redacted>"),
        }
    }
}

impl From<bool> for Value {
    #[inline(always)]
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl From<i64> for Value {
    #[inline(always)]
    fn from(value: i64) -> Self {
        Self::I64(value)
    }
}

impl From<u64> for Value {
    #[inline(always)]
    fn from(value: u64) -> Self {
        Self::U64(value)
    }
}

impl From<usize> for Value {
    #[inline(always)]
    fn from(value: usize) -> Self {
        Self::U64(value as u64)
    }
}

impl From<u32> for Value {
    #[inline(always)]
    fn from(value: u32) -> Self {
        Self::U64(u64::from(value))
    }
}

impl From<u16> for Value {
    #[inline(always)]
    fn from(value: u16) -> Self {
        Self::U64(u64::from(value))
    }
}

impl From<String> for Value {
    #[inline(always)]
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}

impl From<&str> for Value {
    #[inline(always)]
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}

impl From<&String> for Value {
    #[inline(always)]
    fn from(value: &String) -> Self {
        Self::Text(value.clone())
    }
}

impl From<Record> for Value {
    #[inline(always)]
    fn from(value: Record) -> Self {
        Self::Record(value)
    }
}

impl From<Vec<Value>> for Value {
    #[inline(always)]
    fn from(value: Vec<Value>) -> Self {
        Self::List(value)
    }
}

impl From<Vec<Record>> for Value {
    #[inline(always)]
    fn from(value: Vec<Record>) -> Self {
        Self::Records(value)
    }
}

impl<T> From<Option<T>> for Value
where
    T: Into<Value>,
{
    #[inline(always)]
    fn from(value: Option<T>) -> Self {
        value.map_or(Self::Null, Into::into)
    }
}

impl fmt::Display for Value {
    #[inline(always)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.display().as_str())
    }
}

fn fields<S>(items: &[Field], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut map = serializer.serialize_map(Some(items.len()))?;
    for item in items {
        map.serialize_entry(item.key(), item.value())?;
    }
    map.end()
}

fn record(value: &Record) -> String {
    value.summary_text().map_or_else(
        || {
            value
                .fields()
                .iter()
                .map(|field| format!("{}={}", field.key(), field.value().display()))
                .collect::<Vec<_>>()
                .join(", ")
        },
        ToOwned::to_owned,
    )
}

fn list(values: impl Iterator<Item = String>) -> String {
    let values = values.collect::<Vec<_>>();
    if values.is_empty() { "none".into() } else { values.join(", ") }
}

#[inline(always)]
fn bool_label(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

#[inline(always)]
fn humantime(value: Duration) -> String {
    humantime::format_duration(value).to_string()
}

fn bytes(value: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];

    if value == 0 {
        return "0 B".into();
    }
    let unit = ((value.ilog2() / 10) as usize).min(UNITS.len() - 1);
    match unit {
        0 => format!("{value} B"),
        unit => format!("{:.1} {}", value as f64 / (1u64 << (unit * 10)) as f64, UNITS[unit]),
    }
}

#[cfg(test)]
mod tests {
    use super::{Doc, Value};

    #[test]
    fn byte_values_render_without_fake_fractional_bytes() {
        assert_eq!(Value::bytes(0).display(), "0 B");
        assert_eq!(Value::bytes(42).display(), "42 B");
        assert_eq!(Value::bytes(8 * 1024 * 1024).display(), "8.0 MiB");
    }

    #[test]
    fn redacted_values_stay_redacted_when_serialized() {
        assert_eq!(serde_json::to_string(&Value::Redacted).unwrap(), "\"<redacted>\"");
    }

    #[test]
    fn scoped_indent_marks_only_nested_fields() {
        let doc = Doc::builder()
            .section("layers", "Layers")
            .field("cli", "cli", "present")
            .indent(|section| {
                section
                    .field("overrides", "overrides", "none")
                    .indent(|section| section.field("detail", "detail", "inherited"))
            })
            .field("file", "file", "defaults")
            .build();
        let fields = doc.sections()[0].fields();

        assert_eq!(fields[0].indent().level(), 0);
        assert_eq!(fields[1].indent().level(), 1);
        assert_eq!(fields[2].indent().level(), 2);
        assert_eq!(fields[3].indent().level(), 0);
    }

    #[test]
    fn enumeration_marks_direct_fields_only() {
        let doc = Doc::builder()
            .section("layers", "Layers")
            .enumerate(|section| {
                section
                    .field("cli", "cli", "present")
                    .indent(|section| section.field("overrides", "overrides", "none"))
                    .field("environment", "environment", "present")
            })
            .build();
        let fields = doc.sections()[0].fields();

        assert_eq!(fields[0].marker().map(|marker| marker.display()), Some("1".into()));
        assert_eq!(fields[1].marker(), None);
        assert_eq!(fields[2].marker().map(|marker| marker.display()), Some("2".into()));
    }
}
