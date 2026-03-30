use std::path::PathBuf;

use orbit::builder::{
    ArgAction, ArgBuilder, Arity, CommandBuilder, DefaultValue, ErasedValueValidator, GroupBuilder,
    GroupRelation, ParserKind, PossibleValue, Validator, ValueHint, ValueSpecBuilder,
    ValueValidationError, Visibility,
};
use orbit::parse::RawValue;

/// A custom validator that ensures a file ends with a specific extension.
#[derive(Debug)]
struct ScriptValidator;

impl ErasedValueValidator for ScriptValidator {
    fn name(&self) -> &'static str {
        "script-extension-validator"
    }

    fn validate(&self, value: &RawValue) -> Result<(), ValueValidationError> {
        let text = value.as_os_str().to_string_lossy();
        if text.ends_with(".sh") || text.ends_with(".py") {
            Ok(())
        } else {
            Err(ValueValidationError::new("Script must be a .sh or .py file"))
        }
    }
}

fn main() {
    let command = CommandBuilder::new("kitchen-sink")
        .about("A massive CLI showcasing every feature of the library")
        .long_about(
            "This is a comprehensive example. It demonstrates validators, hints, groups, \
             global args, arity, default values, env fallbacks, possible values, custom \
             validators, and beautiful help rendering.",
        )
        .alias("ks")
        // --------------------------------------------------------------------
        // GLOBAL FLAGS
        // --------------------------------------------------------------------
        .arg(
            ArgBuilder::flag("verbose")
                .short('v')
                .long("verbose")
                .action(ArgAction::Count) // Can be passed multiple times (-vvv)
                .global(true) // Inherited by all subcommands
                .help("Increase logging verbosity"),
        )
        .arg(
            ArgBuilder::flag("quiet")
                .short('q')
                .long("quiet")
                .global(true)
                .conflicts_with("verbose") // Cannot be used with --verbose
                .help("Suppress all output"),
        )
        // --------------------------------------------------------------------
        // HIDDEN & DEPRECATED METADATA
        // --------------------------------------------------------------------
        .arg(
            ArgBuilder::flag("internal-debug")
                .long("internal-debug")
                .visibility(Visibility::Hidden) // Will not show up in --help
                .help("Enable internal AST debug traces"),
        )
        .arg(
            ArgBuilder::flag("legacy-mode")
                .long("legacy")
                .visibility(Visibility::Deprecated {
                    note: Some("use the modern execution engine instead".into()),
                })
                .help("Run using the v1 engine"),
        )
        // --------------------------------------------------------------------
        // OPTIONS WITH ENV VARS, DEFAULTS & POSSIBLE VALUES
        // --------------------------------------------------------------------
        .arg(
            ArgBuilder::option("config")
                .short('c')
                .long("config")
                .env("KS_CONFIG") // Fallback to this environment variable
                .help("Path to the configuration file")
                .value_name("FILE")
                .value(
                    ValueSpecBuilder::new(ParserKind::PathBuf)
                        .hint(ValueHint::FilePath)
                        .validate(Validator::File)
                        .default_value(DefaultValue::String("config.toml".into())),
                ),
        )
        .arg(
            ArgBuilder::option("format")
                .short('f')
                .long("format")
                .help("Output format styling")
                .value(
                    ValueSpecBuilder::new(ParserKind::String)
                        .possible_values([
                            PossibleValue::new("json").help("Machine readable JSON"),
                            PossibleValue::new("yaml").help("Human readable YAML"),
                            PossibleValue::new("xml").hidden(true), // Easter egg format
                        ])
                        .default_value(DefaultValue::String("yaml".into())),
                ),
        )
        // --------------------------------------------------------------------
        // SUBCOMMAND 1: BUILD (Showcasing Groups, Validators & Arity)
        // --------------------------------------------------------------------
        .subcommand(
            CommandBuilder::new("build")
                .about("Compile the project")
                .alias("b")
                .alias("make")
                .arg(
                    ArgBuilder::option("out-dir")
                        .long("out-dir")
                        .heading("Paths") // Groups under a custom heading in help
                        .help("Output directory for compiled artifacts")
                        .value(
                            ValueSpecBuilder::new(ParserKind::PathBuf)
                                .hint(ValueHint::DirPath)
                                .validate(Validator::Directory), // Must be an existing directory
                        ),
                )
                .arg(
                    ArgBuilder::option("features")
                        .long("feature")
                        .short('F')
                        .action(ArgAction::Append) // Can be used multiple times (--feature a --feature b)
                        .help("List of features to enable")
                        .value(
                            ValueSpecBuilder::new(ParserKind::String).arity(Arity::ONE_OR_MORE), // Takes at least 1 value
                        ),
                )
                // Mutually exclusive speed profiling group
                .arg(ArgBuilder::flag("fast").long("fast").in_group("speed-profile"))
                .arg(ArgBuilder::flag("slow").long("slow").in_group("speed-profile"))
                .group(
                    GroupBuilder::new("speed-profile")
                        // FIX: Explicitly declare the members of the group here!
                        .member("fast")
                        .member("slow")
                        .relation(GroupRelation::OneOf) // You can pick exactly one
                        .help("Optimization level overrides"),
                ),
        )
        // --------------------------------------------------------------------
        // SUBCOMMAND 2: RUN (Showcasing Custom Validators & Dependencies)
        // --------------------------------------------------------------------
        .subcommand(
            CommandBuilder::new("run")
                .about("Execute a script")
                .alias("exec")
                .arg(
                    ArgBuilder::positional("script")
                        .help("The script to execute (.sh or .py)")
                        .position(0) // Positional index 0
                        .value(
                            ValueSpecBuilder::new(ParserKind::PathBuf)
                                .hint(ValueHint::FilePath)
                                .validate(Validator::File) // Must be an existing file
                                .custom_validator(ScriptValidator), // Custom extension check
                        ),
                )
                .arg(
                    ArgBuilder::option("url")
                        .long("url")
                        .help("Remote URL to fetch data from before running")
                        .value(ValueSpecBuilder::new(ParserKind::String).hint(ValueHint::Url)),
                )
                .arg(
                    ArgBuilder::option("token")
                        .long("token")
                        .requires("url") // This argument is ILLEGAL unless --url is also passed
                        .help("Authentication token for the remote URL")
                        .value(ValueSpecBuilder::new(ParserKind::String).hint(ValueHint::EnvVar)),
                ),
        )
        .build()
        .expect("Valid schema construction");

    // ========================================================================
    // RUNTIME EXECUTION & EXTRACTION
    // ========================================================================

    let matches = command.parse_env_or_exit();

    println!("=== GLOBAL SETTINGS ===");

    let verbose = matches.get_count_or_exit("verbose");
    let quiet = matches.get_flag_or_exit("quiet");
    println!("Verbosity level: {}", verbose);
    println!("Quiet mode: {}", quiet);

    let config: Option<PathBuf> = matches.get_one_or_exit("config");
    let format: Option<String> = matches.get_one_or_exit("format");
    println!("Config Path: {:?}", config.unwrap());
    println!("Output Format: {:?}", format.unwrap());

    println!("\n=== SUBCOMMAND EXECUTION ===");

    if let Some(build) = matches.subcommand().filter(|m| m.command().name() == "build") {
        println!("Executing 'build' pipeline...");

        let out_dir: Option<PathBuf> = build.get_one_or_exit("out-dir");
        let features: Vec<String> = build.get_many_or_exit("features");

        let fast = build.get_flag_or_exit("fast");
        let slow = build.get_flag_or_exit("slow");

        println!("  Output Directory: {:?}", out_dir);
        println!("  Enabled Features: {:?}", features);
        println!("  Speed Profile: Fast={}, Slow={}", fast, slow);
    } else if let Some(run) = matches.subcommand().filter(|m| m.command().name() == "run") {
        println!("Executing 'run' pipeline...");

        let script: Option<PathBuf> = run.get_one_or_exit("script");
        let url: Option<String> = run.get_one_or_exit("url");
        let token: Option<String> = run.get_one_or_exit("token");

        println!("  Target Script: {:?}", script.unwrap());
        if let Some(url) = url {
            println!("  Fetching from: {}", url);
            if let Some(token) = token {
                println!("  Using Auth Token: <REDACTED length={}>", token.len());
            }
        }
    } else {
        println!("No subcommand provided. Use `--help` to see available commands.");
    }
}
