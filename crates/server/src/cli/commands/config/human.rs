use std::io::{self, Write};

use canary_report::{Doc, Report, Value};
use miette::{IntoDiagnostic, Result};

use super::report;
use crate::config::defaults::{DEFAULT_CONFIG_CANDIDATES, ENV_PREFIX, ENV_SEPARATOR};
use crate::terminal::{Card, Component, Mode, Section};
use crate::{CliLayer, EnvironmentLayer, LoadedConfig};

pub(super) fn check(loaded: &LoadedConfig) -> Result<()> {
    let mut out = anstream::stdout().lock();
    write_check(&mut out, loaded, Mode::Styled).into_diagnostic()
}

pub(super) fn show(loaded: &LoadedConfig) -> Result<()> {
    let mut out = anstream::stdout().lock();
    write_show(&mut out, loaded, Mode::Styled).into_diagnostic()
}

pub(super) fn sources(loaded: &LoadedConfig) -> Result<()> {
    let mut out = anstream::stdout().lock();
    write_sources(&mut out, loaded, Mode::Styled).into_diagnostic()
}

fn write_check(out: &mut dyn Write, loaded: &LoadedConfig, mode: Mode) -> io::Result<()> {
    Card::new("canary config", "valid")
        .row("✓", "loaded", loaded.origin.selected_label())
        .row("◇", "layers", loaded.origin.overlay_label())
        .row("⊙", "listener", format!("http://{}", loaded.settings.server.bind))
        .row("◆", "storage", storage(loaded))
        .row("◌", "database", database(loaded))
        .render(out, mode)?;

    if !loaded.settings.auth.is_enabled() {
        writeln!(out)?;
        auth_warning().render(out, mode)?;
    }
    Ok(())
}

fn write_show(out: &mut dyn Write, loaded: &LoadedConfig, mode: Mode) -> io::Result<()> {
    Card::new("canary config", "effective")
        .row("◇", "source", loaded.origin.selected_label())
        .row("└", "overlays", loaded.origin.overlay_label())
        .render(out, mode)?;

    write_doc(out, mode, &report::config(loaded), &["origin", "runtime"])?;

    if !loaded.settings.auth.is_enabled() {
        writeln!(out)?;
        auth_warning().render(out, mode)?;
    }
    Ok(())
}

fn write_sources(out: &mut dyn Write, loaded: &LoadedConfig, mode: Mode) -> io::Result<()> {
    Card::new("canary config", "sources")
        .row("⇡", "precedence", "cli > environment > file > defaults")
        .row("◇", "selected", loaded.origin.selected_label())
        .render(out, mode)?;

    write_doc(out, mode, &sources_doc(loaded), &[])
}

fn write_doc(out: &mut dyn Write, mode: Mode, doc: &Doc, skip: &[&str]) -> io::Result<()> {
    for section in doc.sections().iter().filter(|section| !skip.contains(&section.key())) {
        writeln!(out)?;
        terminal_section(section).render(out, mode)?;
    }
    Ok(())
}

fn terminal_section(section: &canary_report::Section) -> Section<'static> {
    section.fields().iter().fold(Section::new(section.title()), |section, field| {
        let value = display(field.value());
        match (field.marker(), field.indent().level()) {
            (None, 0) => section.row(field.label(), value),
            (None, indent) => section.indented_row(indent, field.label(), value),
            (marker, indent) => section.marked_row(
                marker.map(canary_report::Marker::display),
                indent,
                field.label(),
                value,
            ),
        }
    })
}

fn sources_doc(loaded: &LoadedConfig) -> Doc {
    Doc::builder()
        .section("layers", "Layers")
        .enumerate(|section| {
            section
                .field("cli", "cli", cli(loaded.origin.cli))
                .indent(|section| section.field("overrides", "overrides", overrides(loaded)))
                .field("environment", "environment", env(loaded.origin.environment))
                .indent(|section| {
                    section
                        .field("prefix", "prefix", format!("{ENV_PREFIX}{ENV_SEPARATOR}"))
                        .field("separator", "separator", ENV_SEPARATOR)
                        .field("alias", "alias", "RUST_LOG -> observability.filter")
                })
                .field("file", "file", loaded.origin.selected_label())
                .field("defaults", "defaults", "built in")
        })
        .section("discovery", "Discovery")
        .field(
            "file_source",
            "file source",
            loaded.origin.file_source.map(|source| source.to_string()),
        )
        .field("selected_files", "selected files", files(loaded))
        .field(
            "default_candidates",
            "default candidates",
            DEFAULT_CONFIG_CANDIDATES.iter().copied().map(Value::from).collect::<Vec<_>>(),
        )
        .build()
}

fn display(value: &Value) -> String {
    match value {
        Value::Null => "none".into(),
        Value::Record(value) => value.summary_text().map_or_else(
            || {
                value
                    .fields()
                    .iter()
                    .map(|field| display(field.value()))
                    .collect::<Vec<_>>()
                    .join(", ")
            },
            ToOwned::to_owned,
        ),
        Value::Records(values) => {
            if values.is_empty() {
                return "none".into();
            }
            values
                .iter()
                .map(|value| value.summary_text().unwrap_or("record").to_owned())
                .collect::<Vec<_>>()
                .join(", ")
        }
        value => value.display(),
    }
}

fn auth_warning() -> Card<'static> {
    Card::new("authorization", "disabled")
        .row("!", "warning", "protected routes are not validating bearer tokens")
        .text("configure auth.enabled = true before exposing this server")
}

fn storage(loaded: &LoadedConfig) -> String {
    match &loaded.settings.files.storage.prefix {
        Some(prefix) => {
            format!("s3://{}/{}", loaded.settings.files.storage.bucket, prefix.as_str())
        }
        None => format!("s3://{}", loaded.settings.files.storage.bucket),
    }
}

fn database(loaded: &LoadedConfig) -> String {
    let doc = loaded.settings.db.to_doc();
    let Some(section) = doc.sections().first() else {
        return "unknown".into();
    };
    let engine = section
        .fields()
        .iter()
        .find(|field| field.key() == "engine")
        .map(|field| display(field.value()))
        .unwrap_or_else(|| "unknown".into());
    format!(
        "{}/{}/{}",
        engine,
        loaded.settings.db.namespace().as_str(),
        loaded.settings.db.database().as_str()
    )
}

fn overrides(loaded: &LoadedConfig) -> String {
    if loaded.origin.cli_overrides.is_empty() {
        return "none".into();
    }
    loaded.origin.cli_overrides.join(", ")
}

#[inline(always)]
fn files(loaded: &LoadedConfig) -> Value {
    Value::list(loaded.origin.files.iter().map(|path| path.display().to_string()))
}

#[inline(always)]
fn cli(value: CliLayer) -> &'static str {
    if matches!(value, CliLayer::Present) { "present" } else { "absent" }
}

#[inline(always)]
fn env(value: EnvironmentLayer) -> &'static str {
    if matches!(value, EnvironmentLayer::Present) { "present" } else { "absent" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_output_uses_shared_card_shape() {
        let loaded = LoadedConfig::default();
        let mut out = Vec::new();

        write_check(&mut out, &loaded, Mode::Plain).unwrap();
        let out = String::from_utf8(out).unwrap();

        assert!(out.contains("canary config"));
        assert!(out.contains("valid"));
        assert!(out.contains("authorization"));
    }
}
