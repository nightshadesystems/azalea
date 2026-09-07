//! The on-box backend. Op-mode scripts answer JSON with `--raw`; the
//! per-interface detail comes from the op-mode wrapper as text.
//!
//! Parsing of the `--raw` shapes lands in M1/M2 against captured
//! fixtures; today only the plumbing and `system_info` exist.

use azalea_common::types::{CounterSample, Interface, InterfaceDetail, SystemInfo, SystemStatus};

use crate::op::{OpBackend, OpError};

pub const OP_MODE_DIR: &str = "/usr/libexec/vyos/op_mode";
pub const OP_WRAPPER: &str = "/opt/vyatta/bin/vyatta-op-cmd-wrapper";

pub struct VyosOp;

impl VyosOp {
    /// Run `<OP_MODE_DIR>/<script> <function> --raw [args]` and parse
    /// the JSON it prints.
    pub async fn raw(
        script: &str,
        function: &str,
        args: &[&str],
    ) -> Result<serde_json::Value, OpError> {
        let path = format!("{OP_MODE_DIR}/{script}");
        let mut argv: Vec<&str> = vec![function, "--raw"];
        argv.extend_from_slice(args);
        let text = run(&path, &argv).await?;
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
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        Ok(SystemInfo {
            hostname: hostname(),
            version: s("version"),
            release_train: s("release_train"),
            built_on: s("built_on"),
            architecture: s("architecture"),
            boot_via: s("boot_via"),
            hardware_vendor: s("hardware_vendor"),
            hardware_model: s("hardware_model"),
            azalea_version: azalea_common::VERSION.to_string(),
        })
    }

    async fn system_status(&self) -> Result<SystemStatus, OpError> {
        Err(not_yet("uptime.py show", "M1"))
    }

    async fn interfaces(&self) -> Result<Vec<Interface>, OpError> {
        Err(not_yet("interfaces.py show", "M2"))
    }

    async fn interface_counters(&self) -> Result<Vec<CounterSample>, OpError> {
        Err(not_yet("interfaces.py show_counters", "M2"))
    }

    async fn interface_detail(&self, name: &str) -> Result<InterfaceDetail, OpError> {
        let kind = azalea_common::types::InterfaceKind::from_name(name);
        let raw = Self::wrapper(&["show", "interfaces", kind.as_str(), name]).await?;
        Ok(InterfaceDetail {
            name: name.to_string(),
            kind,
            fields: crate::parse::key_values(&raw),
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
