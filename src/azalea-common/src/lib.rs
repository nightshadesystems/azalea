//! Shared foundations: API types, settings, logging, passwords, TLS.

pub mod cert;
pub mod logging;
pub mod passwd;
pub mod role;
pub mod settings;
pub mod types;

/// Product version, from the `VERSION` file at the repo root (build.rs).
pub const VERSION: &str = env!("AZALEA_VERSION");

/// Where runtime state lives on a router. `/config` is the only path
/// that survives `add system image`.
pub const STATE_DIR: &str = "/config/azalea";

#[cfg(test)]
mod tests {
    #[test]
    fn version_comes_from_the_version_file() {
        let file = include_str!("../../../VERSION");
        assert_eq!(super::VERSION, file.trim());
        assert_ne!(
            super::VERSION,
            env!("CARGO_PKG_VERSION"),
            "Cargo.toml is a placeholder"
        );
    }
}
