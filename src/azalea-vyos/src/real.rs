//! The on-box backend. Op-mode scripts answer JSON with `--raw`; the
//! per-interface detail comes from the op-mode wrapper as text.
//!
//! Uptime and load come from `/proc` rather than `uptime.py`: rolling
//! dropped `uptime_seconds`, and every train divides the load averages
//! by the core count. Interface listing lands in M2.

use azalea_common::types::{
    CounterSample, Interface, InterfaceDetail, InterfaceKind, SystemInfo, SystemStatus,
};

use crate::op::{OpBackend, OpError};
use crate::parse;

pub const OP_MODE_DIR: &str = "/usr/libexec/vyos/op_mode";
pub const OP_WRAPPER: &str = "/opt/vyatta/bin/vyatta-op-cmd-wrapper";

pub struct VyosOp;

impl VyosOp {
    /// `<OP_MODE_DIR>/<script> <function> --raw [args]` as text.
    pub async fn raw_text(script: &str, function: &str, args: &[&str]) -> Result<String, OpError> {
        let path = format!("{OP_MODE_DIR}/{script}");
        let mut argv: Vec<&str> = vec![function, "--raw"];
        argv.extend_from_slice(args);
        run(&path, &argv).await
    }

    /// Same, parsed as JSON.
    pub async fn raw(
        script: &str,
        function: &str,
        args: &[&str],
    ) -> Result<serde_json::Value, OpError> {
        let text = Self::raw_text(script, function, args).await?;
        serde_json::from_str(&text).map_err(|e| OpError::Parse {
            command: format!("{script} {function}"),
            reason: e.to_string(),
        })
    }

    /// `vyatta-op-cmd-wrapper <words...>` text.
    pub async fn wrapper(words: &[&str]) -> Result<String, OpError> {
        run(OP_WRAPPER, words).await
    }
}

async fn run(program: &str, args: &[&str]) -> Result<String, OpError> {
    let command = std::iter::once(program)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ");
    let output = tokio::process::Command::new(program)
        .args(args)
        .output()
        .await
        .map_err(|source| OpError::Spawn {
            command: command.clone(),
            source,
        })?;
    if !output.status.success() {
        return Err(OpError::Command {
            command,
            status: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_err(command: &str, e: parse::ParseError) -> OpError {
    OpError::Parse {
        command: command.into(),
        reason: e.to_string(),
    }
}

async fn proc_file(path: &str) -> Result<String, OpError> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|source| OpError::Spawn {
            command: format!("read {path}"),
            source,
        })
}

fn not_yet(command: &str, milestone: &str) -> OpError {
    OpError::Parse {
        command: command.into(),
        reason: format!("not implemented until {milestone}"),
    }
}

#[async_trait::async_trait]
impl OpBackend for VyosOp {
    async fn system_info(&self) -> Result<SystemInfo, OpError> {
        let v = Self::raw("version.py", "show", &[]).await?;
        let mut info = parse::version_raw(&v);
        info.hostname = hostname();
        info.azalea_version = azalea_common::VERSION.to_string();
        Ok(info)
    }

    async fn system_status(&self) -> Result<SystemStatus, OpError> {
        let uptime_secs = parse::proc_uptime(&proc_file("/proc/uptime").await?)
            .map_err(|e| parse_err("/proc/uptime", e))?;
        let load = parse::proc_loadavg(&proc_file("/proc/loadavg").await?)
            .map_err(|e| parse_err("/proc/loadavg", e))?;
        // memory.py is the op-mode answer; /proc/meminfo is the same
        // arithmetic and covers a train where the script changes shape.
        let memory = match Self::raw("memory.py", "show", &[]).await {
            Ok(v) => parse::memory_raw(&v).map_err(|e| parse_err("memory.py show", e))?,
            Err(e) => {
                tracing::warn!(err = %e, "memory.py failed; reading /proc/meminfo");
                parse::proc_meminfo(&proc_file("/proc/meminfo").await?)
                    .map_err(|e| parse_err("/proc/meminfo", e))?
            }
        };
        let disks = match Self::raw_text("storage.py", "show", &[]).await {
            Ok(text) => parse::storage_raw(&text).map_err(|e| parse_err("storage.py show", e))?,
            Err(e) => {
                tracing::warn!(err = %e, "storage.py failed; no disk figures");
                vec![]
            }
        };
        Ok(SystemStatus {
            uptime_secs,
            load,
            memory,
            disks,
        })
    }

    async fn interfaces(&self) -> Result<Vec<Interface>, OpError> {
        Err(not_yet("interfaces.py show", "M2"))
    }

    async fn interface_counters(&self) -> Result<Vec<CounterSample>, OpError> {
        Err(not_yet("interfaces.py show_counters", "M2"))
    }

    async fn interface_detail(&self, name: &str) -> Result<InterfaceDetail, OpError> {
        let kind = InterfaceKind::from_name(name);
        let raw = Self::wrapper(&["show", "interfaces", kind.as_str(), name]).await?;
        Ok(InterfaceDetail {
            name: name.to_string(),
            kind,
            fields: parse::key_values(&raw),
            raw,
        })
    }
}

pub fn hostname() -> String {
    if let Ok(name) = std::fs::read_to_string("/etc/hostname") {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "vyos".to_string())
}
