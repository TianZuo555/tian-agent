use std::{env, fs, path::PathBuf};

fn main() {
    let source = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../src/shared/service-paths.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(source).expect("read service protocol source");
    let number = text
        .lines()
        .find_map(|line| line.strip_prefix("export const SERVICE_PROTOCOL = "))
        .and_then(|value| value.strip_suffix(';'))
        .and_then(|value| value.parse::<u64>().ok())
        .expect("SERVICE_PROTOCOL must be an integer constant");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("protocol.rs"),
        format!("pub(crate) const SERVICE_PROTOCOL: u64 = {number};\n"),
    )
    .unwrap();
}
