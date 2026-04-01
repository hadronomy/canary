use std::path::PathBuf;

use orbit::builder::{
    ArgAction, ArgBuilder, CommandBuilder, Validator, ValueHint,
};

fn main() {
    let command = CommandBuilder::new("demo")
        .arg(
            ArgBuilder::flag("verbose")
                .short('v')
                .long("verbose")
                .action(ArgAction::Count)
                .help("Whaaat"),
        )
        .arg(
            ArgBuilder::option::<PathBuf>("dir")
                .long("dir")
                .hint(ValueHint::DirPath)
                .validate(Validator::Directory),
        )
        .build()
        .expect("valid schema");

    let matches = command.parse_env_or_exit();

    let verbose = matches.get_count_or_exit("verbose");
    let dir: Option<std::path::PathBuf> = matches.get_one_or_exit("dir");

    println!("verbose={verbose}");
    println!("dir={dir:?}");
}
