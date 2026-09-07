//! The product version comes from the `VERSION` file at the repo root,
//! not from Cargo.toml, so one edit moves `--version`, the API, the
//! package and the release tag together.

use std::path::Path;

fn main() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../VERSION");
    let version = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let version = version.trim();
    let well_formed = version.split('.').count() == 3
        && version
            .split('.')
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    assert!(
        well_formed,
        "VERSION must be MAJOR.MINOR.PATCH, got {version:?}"
    );
    println!("cargo:rustc-env=AZALEA_VERSION={version}");
    println!("cargo:rerun-if-changed={}", path.display());
}
