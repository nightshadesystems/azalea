//! Tracing setup shared by every Azalea binary.

use tracing_subscriber::{fmt, EnvFilter};

/// `AZALEA_LOG` overrides `default_filter`. Logs go to stderr.
pub fn init(default_filter: &str) {
    let filter =
        EnvFilter::try_from_env("AZALEA_LOG").unwrap_or_else(|_| EnvFilter::new(default_filter));
    fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .init();
}
