//! Shared foundations: API types, settings, logging, passwords, TLS.

pub mod cert;
pub mod logging;
pub mod passwd;
pub mod role;
pub mod settings;
pub mod types;

/// Product version, from the workspace Cargo.toml.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Where runtime state lives on a router. `/config` is the only path
/// that survives `add system image`.
pub const STATE_DIR: &str = "/config/azalea";
