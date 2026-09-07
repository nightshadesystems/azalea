//! JSON API types. `web/lib/types.ts` mirrors these by hand — change
//! both together.

use serde::{Deserialize, Serialize};

/// `GET /api/system` — identity and versions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    /// VyOS version, e.g. `1.4.1` or `1.5-rolling-202409070000`.
    pub version: String,
    /// `sagitta`, `circinus`, ...
    pub release_train: String,
    pub built_on: String,
    pub architecture: String,
    /// `installed image` or `livecd`.
    pub boot_via: String,
    /// `bare metal` or `<hypervisor> guest`.
    pub system_type: String,
    pub hardware_vendor: String,
    pub hardware_model: String,
    /// Azalea's own version.
    pub azalea_version: String,
}

/// `GET /api/system/status` — the dashboard cards.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SystemStatus {
    pub uptime_secs: u64,
    pub load: LoadAverage,
    pub memory: Memory,
    pub disks: Vec<Disk>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

/// Bytes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Memory {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub buffers: u64,
    pub cached: u64,
}

/// Bytes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disk {
    pub mount: String,
    pub filesystem: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceKind {
    Ethernet,
    Vlan,
    Bridge,
    Bonding,
    Tunnel,
    Wireguard,
    Loopback,
    Dummy,
    #[default]
    Other,
}

impl InterfaceKind {
    /// Classify a VyOS interface by name. VIFs (`eth0.100`, `bond0.10`)
    /// are VLANs whatever their parent.
    pub fn from_name(name: &str) -> Self {
        if name.contains('.') {
            return Self::Vlan;
        }
        let prefix: String = name
            .chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect();
        match prefix.as_str() {
            "eth" => Self::Ethernet,
            "br" => Self::Bridge,
            "bond" => Self::Bonding,
            "tun" | "gre" | "vti" | "vxlan" | "geneve" | "l2tpeth" | "erspan" | "ip" | "sit" => {
                Self::Tunnel
            }
            "wg" => Self::Wireguard,
            "lo" => Self::Loopback,
            "dum" => Self::Dummy,
            _ => Self::Other,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ethernet => "ethernet",
            Self::Vlan => "vlan",
            Self::Bridge => "bridge",
            Self::Bonding => "bonding",
            Self::Tunnel => "tunnel",
            Self::Wireguard => "wireguard",
            Self::Loopback => "loopback",
            Self::Dummy => "dummy",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceCounters {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_packets: u64,
    pub tx_packets: u64,
    pub rx_errors: u64,
    pub tx_errors: u64,
    pub rx_dropped: u64,
    pub tx_dropped: u64,
}

/// One row of `/api/interfaces`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interface {
    pub name: String,
    pub kind: InterfaceKind,
    pub admin_up: bool,
    pub oper_up: bool,
    pub description: String,
    pub mtu: u32,
    pub mac: String,
    pub addresses: Vec<String>,
    /// Parent of a VIF (`eth0` for `eth0.100`).
    pub parent: Option<String>,
    pub vlan_id: Option<u16>,
    /// Bridge or bond members.
    pub members: Vec<String>,
    pub counters: InterfaceCounters,
}

/// `/api/stream` frame: counters for every interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CounterSample {
    pub name: String,
    pub oper_up: bool,
    pub counters: InterfaceCounters,
}

/// `GET /api/interfaces/<name>` — `show interfaces <type> <name>`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceDetail {
    pub name: String,
    pub kind: InterfaceKind,
    /// Parsed `key: value` lines, in display order.
    pub fields: Vec<(String, String)>,
    /// The command output verbatim.
    pub raw: String,
}

/// Interface summary for the dashboard.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceSummary {
    pub total: usize,
    pub up: usize,
    pub down: usize,
    pub admin_down: usize,
}

impl InterfaceSummary {
    pub fn of(interfaces: &[Interface]) -> Self {
        let mut s = Self {
            total: interfaces.len(),
            ..Self::default()
        };
        for i in interfaces {
            if !i.admin_up {
                s.admin_down += 1;
            } else if i.oper_up {
                s.up += 1;
            } else {
                s.down += 1;
            }
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_name() {
        assert_eq!(InterfaceKind::from_name("eth0"), InterfaceKind::Ethernet);
        assert_eq!(InterfaceKind::from_name("eth0.100"), InterfaceKind::Vlan);
        assert_eq!(InterfaceKind::from_name("bond0.10"), InterfaceKind::Vlan);
        assert_eq!(InterfaceKind::from_name("br0"), InterfaceKind::Bridge);
        assert_eq!(InterfaceKind::from_name("bond0"), InterfaceKind::Bonding);
        assert_eq!(InterfaceKind::from_name("wg0"), InterfaceKind::Wireguard);
        assert_eq!(InterfaceKind::from_name("tun0"), InterfaceKind::Tunnel);
        assert_eq!(InterfaceKind::from_name("vti0"), InterfaceKind::Tunnel);
        assert_eq!(InterfaceKind::from_name("lo"), InterfaceKind::Loopback);
        assert_eq!(InterfaceKind::from_name("dum0"), InterfaceKind::Dummy);
        assert_eq!(InterfaceKind::from_name("pppoe0"), InterfaceKind::Other);
    }

    #[test]
    fn summarises_states() {
        let mk = |admin, oper| Interface {
            name: "x".into(),
            kind: InterfaceKind::Ethernet,
            admin_up: admin,
            oper_up: oper,
            description: String::new(),
            mtu: 1500,
            mac: String::new(),
            addresses: vec![],
            parent: None,
            vlan_id: None,
            members: vec![],
            counters: InterfaceCounters::default(),
        };
        let s = InterfaceSummary::of(&[mk(true, true), mk(true, false), mk(false, false)]);
        assert_eq!((s.total, s.up, s.down, s.admin_down), (3, 1, 1, 1));
    }
}
