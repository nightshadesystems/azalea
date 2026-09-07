//! Everything Azalea knows about talking to VyOS.
//!
//! Op mode is read-only and goes through [`OpBackend`]: the real
//! implementation runs VyOS's own op-mode scripts (`--raw` JSON where
//! they have it, `vyatta-op-cmd-wrapper` text otherwise), the mock
//! serves the same typed data off-box. Config mode is a trait stub only.

pub mod config;
pub mod mock;
pub mod op;
pub mod parse;
pub mod real;

pub use config::{ConfigBackend, ConfigError, ConfigSession, NoConfig};
pub use mock::MockOp;
pub use op::{OpBackend, OpError};
pub use real::VyosOp;
