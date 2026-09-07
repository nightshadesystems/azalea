//! The read-only view of a router.

use azalea_common::types::{CounterSample, Interface, InterfaceDetail, SystemInfo, SystemStatus};

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    #[error("cannot run {command}: {source}")]
    Spawn {
        command: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{command} failed (status {status}): {stderr}")]
    Command {
        command: String,
        status: i32,
        stderr: String,
    },
    #[error("unexpected output from {command}: {reason}")]
    Parse { command: String, reason: String },
    #[error("no such interface: {0}")]
    NoSuchInterface(String),
}

#[async_trait::async_trait]
pub trait OpBackend: Send + Sync + 'static {
    /// Hostname and VyOS version/build (`version.py show --raw`).
    async fn system_info(&self) -> Result<SystemInfo, OpError>;

    /// Uptime, load, memory, disks (`uptime.py`, `memory.py`, `storage.py`).
    async fn system_status(&self) -> Result<SystemStatus, OpError>;

    /// Every interface with state, addresses and counters.
    async fn interfaces(&self) -> Result<Vec<Interface>, OpError>;

    /// Counters only — polled for `/api/stream`.
    async fn interface_counters(&self) -> Result<Vec<CounterSample>, OpError>;

    /// `show interfaces <type> <name>`: parsed fields plus the raw text.
    async fn interface_detail(&self, name: &str) -> Result<InterfaceDetail, OpError>;
}
