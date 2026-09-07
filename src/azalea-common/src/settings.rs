//! `/config/azalea/azalea.toml` — the operator-editable settings.
//!
//! ```toml
//! [listen]
//! bind = "0.0.0.0"
//! https_port = 8443
//! ```
//!
//! Every key is optional; a missing file means defaults.

use std::net::IpAddr;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;

pub const FILE_NAME: &str = "azalea.toml";
pub const DEFAULT_HTTPS_PORT: u16 = 8443;

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub listen: Listen,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Listen {
    #[serde(default = "default_bind")]
    pub bind: IpAddr,
    #[serde(default = "default_https_port")]
    pub https_port: u16,
}

fn default_bind() -> IpAddr {
    IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)
}

fn default_https_port() -> u16 {
    DEFAULT_HTTPS_PORT
}

impl Default for Listen {
    fn default() -> Self {
        Self {
            bind: default_bind(),
            https_port: default_https_port(),
        }
    }
}

impl Settings {
    pub fn parse(text: &str) -> Result<Self> {
        toml::from_str(text).context("parsing settings")
    }

    /// Load `<state_dir>/azalea.toml`; absent file = defaults, a broken
    /// file is an error (silently ignoring it would bind the wrong port).
    pub fn load(state_dir: &Path) -> Result<Self> {
        let path = state_dir.join(FILE_NAME);
        match std::fs::read_to_string(&path) {
            Ok(text) => Self::parse(&text).with_context(|| format!("reading {}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_empty() {
        let s = Settings::parse("").unwrap();
        assert_eq!(s, Settings::default());
        assert_eq!(s.listen.https_port, 8443);
        assert!(s.listen.bind.is_unspecified());
    }

    #[test]
    fn overrides_apply() {
        let s = Settings::parse("[listen]\nbind = \"192.0.2.1\"\nhttps_port = 9443\n").unwrap();
        assert_eq!(s.listen.https_port, 9443);
        assert_eq!(s.listen.bind, "192.0.2.1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn unknown_keys_are_errors() {
        assert!(Settings::parse("[listen]\nport = 1\n").is_err());
    }

    #[test]
    fn missing_file_is_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Settings::load(dir.path()).unwrap(), Settings::default());
        std::fs::write(dir.path().join(FILE_NAME), "[listen]\nhttps_port = 1\n").unwrap();
        assert_eq!(Settings::load(dir.path()).unwrap().listen.https_port, 1);
    }
}
