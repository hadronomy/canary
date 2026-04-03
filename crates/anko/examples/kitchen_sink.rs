use std::collections::HashSet;
use std::path::PathBuf;

use anko::builder::{ArgAction, ArgBuilder, CommandBuilder, GroupBuilder, GroupRelation};
use anko::{FromMatches, Matches};

#[derive(Debug)]
struct GlobalConfig {
    verbose: u64,
    quiet: bool,
    config: Option<PathBuf>,
    format: Option<String>,
}

impl FromMatches for GlobalConfig {
    fn from_matches(matches: &Matches) -> Result<Self, anko::DecodeError> {
        Ok(Self {
            verbose: matches.get_count("verbose")?,
            quiet: matches.get_flag("quiet")?,
            config: matches.get_one("config")?,
            format: matches.get_one("format")?,
        })
    }
}

fn main() {
    let command = CommandBuilder::new("kitchen-sink")
        .about("A massive CLI showcasing every feature of the library")
        .long_about(
            "Demonstrates inline closure validators, generic builders, and typed extraction.",
        )
        .alias("ks")
        .arg(
            ArgBuilder::flag("verbose")
                .short('v')
                .long("verbose")
                .action(ArgAction::Count)
                .global(true)
                .help("Increase logging verbosity"),
        )
        .arg(
            ArgBuilder::flag("quiet")
                .short('q')
                .long("quiet")
                .global(true)
                .conflicts_with("verbose")
                .help("Suppress all output"),
        )
        // --------------------------------------------------------------------
        // AWESOME DX: Type Inference & Fluent Chaining!
        // --------------------------------------------------------------------
        .arg(
            ArgBuilder::option::<PathBuf>("config") // Inferred as PathBuf parser!
                .short('c')
                .long("config")
                .env("KS_CONFIG")
                .help("Path to the configuration file")
                .value_name("FILE")
                .validate_file() // Type-safe: Only available because T = PathBuf!
                .default_value("config.toml"), // No more ValueSpecBuilder boilerplate!
        )
        .arg(
            ArgBuilder::option::<String>("format")
                .short('f')
                .long("format")
                .help("Output format styling")
                .default_value("yaml")
                .validate_with(|val| {
                    // Fast, inline semantic closures!
                    let text = val.as_os_str().to_string_lossy();
                    if ["json", "yaml", "xml"].contains(&text.as_ref()) {
                        Ok(())
                    } else {
                        Err(format!("Invalid format: {}", text))
                    }
                }),
        )
        // --------------------------------------------------------------------
        // SUBCOMMANDS
        // --------------------------------------------------------------------
        .subcommand(
            CommandBuilder::new("build")
                .about("Compile the project")
                .arg(
                    ArgBuilder::option::<PathBuf>("out-dir")
                        .long("out-dir")
                        .heading("Paths")
                        .help("Output directory for compiled artifacts")
                        .validate_directory(), // Built-in type-safe validator
                )
                .arg(
                    ArgBuilder::option::<String>("features") // Auto arity ZERO_OR_MORE!
                        .long("feature")
                        .short('F')
                        .action(ArgAction::Append) // TODO: You shouldnt be able to chain action twice and and then it does ArgBuilder<Vec<String>> and then ArgBuilder<Vec<Vec<String>>>
                        .help("List of features to enable")
                        .arity(1..=3)
                        .required(true),
                )
                .arg(ArgBuilder::flag("fast").long("fast").in_group("speed-profile"))
                .arg(ArgBuilder::flag("slow").long("slow").in_group("speed-profile"))
                .group(
                    GroupBuilder::new("speed-profile")
                        .member("fast")
                        .member("slow")
                        .relation(GroupRelation::OneOf)
                        .help("Optimization level overrides"),
                ),
        )
        .subcommand(
            CommandBuilder::new("run")
                .about("Execute a script")
                .arg(
                    ArgBuilder::positional::<PathBuf>("script")
                        .help("The script to execute (.sh or .py)")
                        .position(0)
                        .validate_file()
                        .validate_with(|val| {
                            // Double validation!
                            let text = val.as_os_str().to_string_lossy();
                            if text.ends_with(".sh") || text.ends_with(".py") {
                                Ok(())
                            } else {
                                Err("Script must be a .sh or .py file".into())
                            }
                        }),
                )
                .arg(ArgBuilder::option::<String>("url").long("url").help("Remote URL"))
                .arg(
                    ArgBuilder::option::<String>("token")
                        .long("token")
                        .requires("url")
                        .env("TOKEN")
                        .help("Auth token"),
                ),
        )
        .build()
        .expect("Valid schema construction");

    // ========================================================================
    // RUNTIME EXECUTION
    // ========================================================================

    let matches = command.parse_env_or_exit();
    let globals: GlobalConfig = matches.extract_or_exit();

    println!("=== GLOBAL SETTINGS ===");
    println!("Verbosity level: {}", globals.verbose);
    println!("Quiet mode: {}", globals.quiet);
    println!("Config Path: {:?}", globals.config.unwrap());
    println!("Output Format: {:?}", globals.format.unwrap());

    println!("\n=== SUBCOMMAND EXECUTION ===");

    if let Some(build) = matches.subcommand().filter(|m| m.command().name() == "build") {
        println!("Executing 'build' pipeline...");
        println!("  Output Directory: {:?}", build.get_one_or_exit::<PathBuf>("out-dir"));
        println!(
            "  Enabled Features: {:?}",
            build.get_many_or_exit::<HashSet<String>, String>("features")
        );
        println!(
            "  Speed Profile: Fast={}, Slow={}",
            build.get_flag_or_exit("fast"),
            build.get_flag_or_exit("slow")
        );
    } else if let Some(run) = matches.subcommand().filter(|m| m.command().name() == "run") {
        println!("Executing 'run' pipeline...");
        println!("  Target Script: {:?}", run.get_one_or_exit::<PathBuf>("script").unwrap());
        if let Some(url) = run.get_one_or_exit::<String>("url") {
            println!("  Fetching from: {}", url);
            if let Some(token) = run.get_one_or_exit::<String>("token") {
                println!("  Using Auth Token: <REDACTED length={}>", token.len());
            }
        }
    } else {
        println!("No subcommand provided. Use `--help` to see available commands.");
    }
}
