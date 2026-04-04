use std::collections::HashSet;
use std::path::PathBuf;

use anko::builder::{ArgAction, ArgBuilder, CommandBuilder, GroupBuilder, GroupRelation};
use anko::{FromMatch, MatchRef};

#[derive(Debug)]
struct GlobalConfig {
    verbose: u64,
    quiet: bool,
    config: Option<PathBuf>,
    format: Option<String>,
}

impl FromMatch for GlobalConfig {
    fn from_match(m: MatchRef<'_>) -> Result<Self, anko::DecodeError> {
        Ok(Self {
            verbose: m.get_count("verbose")?,
            quiet: m.get_flag("quiet")?,
            config: m.value_of("config")?,
            format: m.value_of("format")?,
        })
    }
}

#[derive(Debug)]
struct BuildConfig {
    out_dir: Option<PathBuf>,
    features: HashSet<String>,
    fast: bool,
    slow: bool,
}

impl FromMatch for BuildConfig {
    fn from_match(m: MatchRef<'_>) -> Result<Self, anko::DecodeError> {
        Ok(Self {
            out_dir: m.value_of("out-dir")?,
            features: m.values_of::<String>("features")?.collect(),
            fast: m.get_flag("fast")?,
            slow: m.get_flag("slow")?,
        })
    }
}

#[derive(Debug)]
struct RunConfig {
    script: PathBuf,
    url: Option<String>,
    token: Option<String>,
}

impl FromMatch for RunConfig {
    fn from_match(m: MatchRef<'_>) -> Result<Self, anko::DecodeError> {
        Ok(Self {
            script: m.require("script")?,
            url: m.value_of("url")?,
            token: m.value_of("token")?,
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
        .arg(
            ArgBuilder::option::<PathBuf>("config")
                .short('c')
                .long("config")
                .env("KS_CONFIG")
                .help("Path to the configuration file")
                .value_name("FILE")
                // .validate_file()
                .default_value("config.toml"),
        )
        .arg(
            ArgBuilder::option::<String>("format")
                .short('f')
                .long("format")
                .help("Output format styling")
                .default_value("yaml")
                .validate_with(|val| {
                    let text = val.as_os_str().to_string_lossy();
                    if ["json", "yaml", "xml"].contains(&text.as_ref()) {
                        Ok(())
                    } else {
                        Err(format!("Invalid format: {}", text))
                    }
                }),
        )
        .subcommand(
            CommandBuilder::new("build")
                .about("Compile the project")
                .long_about("The world is for being compiled")
                .arg(
                    ArgBuilder::option::<PathBuf>("out-dir")
                        .long("out-dir")
                        .heading("Paths")
                        .help("Output directory for compiled artifacts")
                        .validate_directory(),
                )
                .arg(
                    ArgBuilder::option::<String>("features")
                        .long("feature")
                        .short('F')
                        .action(ArgAction::Append)
                        .help("List of features to enable")
                        .arity(1..=3)
                        .required(true),
                )
                .arg(ArgBuilder::flag("fast").long("fast").in_group("speed-profile"))
                .arg(ArgBuilder::flag("slow").long("slow").in_group("speed-profile"))
                .subcommand(
                    CommandBuilder::new("hello").about("A subcommand to demonstrate nesting").arg(
                        ArgBuilder::option::<String>("name")
                            .short('n')
                            .long("name")
                            .help("Name to greet")
                            .default_value("world"),
                    ),
                )
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
        .expect("valid schema construction");

    let matches = command.parse_env_or_exit();
    let root = matches.root();

    let globals: GlobalConfig = root.extract_or_exit();

    println!("=== GLOBAL SETTINGS ===");
    println!("Verbosity level: {}", globals.verbose);
    println!("Quiet mode: {}", globals.quiet);
    println!("Config Path: {:?}", globals.config);
    println!("Output Format: {:?}", globals.format);

    println!("\n=== SUBCOMMAND EXECUTION ===");

    let subcommand = root.subcommand();


    match subcommand {
        Some(cmd) => match cmd.command().name() {
            "build" => {
                let cfg: BuildConfig = cmd.extract_or_exit();
                if let Some(sc) = cmd.subcommand()
                    && sc.command().name() == "hello"
                {
                    let name: String = sc.value_of_or_exit("name").unwrap_or(String::from("world"));
                    println!("Hello, {name}!");
                };
                println!("Executing 'build' pipeline...");
                println!("  Output Directory: {:?}", cfg.out_dir);
                println!("  Enabled Features: {:?}", cfg.features);
                println!("  Speed Profile: Fast={}, Slow={}", cfg.fast, cfg.slow);
            }
            "run" => {
                let cfg: RunConfig = cmd.extract_or_exit();
                println!("Executing 'run' pipeline...");
                println!("  Target Script: {:?}", cfg.script);
                if let Some(url) = cfg.url {
                    println!("  Fetching from: {}", url);
                    if let Some(token) = cfg.token {
                        println!("  Using Auth Token: <REDACTED length={}>", token.len());
                    }
                }
            }
            other => {
                println!("Unhandled subcommand: {other}");
            }
        },
        None => {
            println!("No subcommand provided. Use `--help` to see available commands.");
        }
    }
}
