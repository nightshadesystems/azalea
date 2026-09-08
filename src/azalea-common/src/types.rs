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
#[serde(rename_all = "kebab-case")]
pub enum InterfaceKind {
    Bonding,
    Bridge,
    Dummy,
    Ethernet,
    Geneve,
    L2tpv3,
    Loopback,
    Macsec,
    Openvpn,
    Wireguard,
    Pppoe,
    PseudoEthernet,
    Sstpc,
    Tunnel,
    VirtualEthernet,
    Vti,
    Vxlan,
    Wireless,
    Wwan,
    /// A VIF (`eth0.100`, `bond0.10.20`) on any parent.
    Vlan,
    #[default]
    Other,
}

/// The kinds with a `vif` tag node, and those with `vif-s` (QinQ).
const VIF_PARENTS: &[InterfaceKind] = &[
    InterfaceKind::Ethernet,
    InterfaceKind::Bonding,
    InterfaceKind::Bridge,
    InterfaceKind::PseudoEthernet,
    InterfaceKind::VirtualEthernet,
    InterfaceKind::Wireless,
];
const VIF_S_PARENTS: &[InterfaceKind] = &[
    InterfaceKind::Ethernet,
    InterfaceKind::Bonding,
    InterfaceKind::PseudoEthernet,
    InterfaceKind::VirtualEthernet,
    InterfaceKind::Wireless,
];

impl InterfaceKind {
    /// Every kind with an `interfaces <type>` node, in the order the UI
    /// lists them.
    pub const CONFIGURABLE: &'static [InterfaceKind] = &[
        Self::Bonding,
        Self::Bridge,
        Self::Dummy,
        Self::Ethernet,
        Self::Geneve,
        Self::L2tpv3,
        Self::Loopback,
        Self::Macsec,
        Self::Openvpn,
        Self::Wireguard,
        Self::Pppoe,
        Self::PseudoEthernet,
        Self::Sstpc,
        Self::Tunnel,
        Self::VirtualEthernet,
        Self::Vti,
        Self::Vxlan,
        Self::Wireless,
        Self::Wwan,
    ];

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
            "bond" => Self::Bonding,
            "br" => Self::Bridge,
            "dum" => Self::Dummy,
            "eth" => Self::Ethernet,
            "gnv" => Self::Geneve,
            "l" if name.starts_with("l2tpeth") => Self::L2tpv3,
            "lo" => Self::Loopback,
            "macsec" => Self::Macsec,
            "vtun" => Self::Openvpn,
            "wg" => Self::Wireguard,
            "pppoe" => Self::Pppoe,
            "peth" => Self::PseudoEthernet,
            "sstpc" => Self::Sstpc,
            "tun" => Self::Tunnel,
            "veth" => Self::VirtualEthernet,
            "vti" => Self::Vti,
            "vxlan" => Self::Vxlan,
            "wlan" => Self::Wireless,
            "wwan" => Self::Wwan,
            _ => Self::Other,
        }
    }

    /// The `interfaces <type>` word.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bonding => "bonding",
            Self::Bridge => "bridge",
            Self::Dummy => "dummy",
            Self::Ethernet => "ethernet",
            Self::Geneve => "geneve",
            Self::L2tpv3 => "l2tpv3",
            Self::Loopback => "loopback",
            Self::Macsec => "macsec",
            Self::Openvpn => "openvpn",
            Self::Wireguard => "wireguard",
            Self::Pppoe => "pppoe",
            Self::PseudoEthernet => "pseudo-ethernet",
            Self::Sstpc => "sstpc",
            Self::Tunnel => "tunnel",
            Self::VirtualEthernet => "virtual-ethernet",
            Self::Vti => "vti",
            Self::Vxlan => "vxlan",
            Self::Wireless => "wireless",
            Self::Wwan => "wwan",
            Self::Vlan => "vlan",
            Self::Other => "other",
        }
    }

    /// Where an interface lives in the config tree: `interfaces <type>
    /// <name>` for every configurable kind; for a VIF `interfaces <parent
    /// type> <parent> vif <id>`, and for QinQ (`eth0.100.200`)
    /// `... vif-s 100 vif-c 200`. Other names return `None`.
    pub fn config_path(name: &str) -> Option<Vec<String>> {
        let words = |w: &[&str]| -> Vec<String> { w.iter().map(|s| s.to_string()).collect() };
        let vlan_id = |vid: &str| -> Option<u16> {
            let id: u16 = vid.parse().ok()?;
            ((0..=4094).contains(&id) && vid == id.to_string()).then_some(id)
        };
        let parts: Vec<&str> = name.split('.').collect();
        match parts.as_slice() {
            [plain] => {
                let kind = Self::from_name(plain);
                Self::CONFIGURABLE
                    .contains(&kind)
                    .then(|| words(&["interfaces", kind.as_str(), plain]))
            }
            [parent, vid] => {
                let kind = Self::from_name(parent);
                vlan_id(vid)?;
                VIF_PARENTS
                    .contains(&kind)
                    .then(|| words(&["interfaces", kind.as_str(), parent, "vif", vid]))
            }
            [parent, svid, cvid] => {
                let kind = Self::from_name(parent);
                vlan_id(svid)?;
                vlan_id(cvid)?;
                VIF_S_PARENTS.contains(&kind).then(|| {
                    words(&[
                        "interfaces",
                        kind.as_str(),
                        parent,
                        "vif-s",
                        svid,
                        "vif-c",
                        cvid,
                    ])
                })
            }
            _ => None,
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

/// One `/api/stream` WebSocket message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamFrame {
    /// Unix time, milliseconds.
    pub t: u64,
    pub samples: Vec<CounterSample>,
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

/// `GET /api/config/interfaces/<name>` — one interface's configuration
/// subtree as VyOS renders it to JSON: a leaf is a string or a list of
/// strings, a valueless node is `{}`, a container is an object.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceConfig {
    pub name: String,
    pub kind: InterfaceKind,
    /// The node's config path, e.g. `["interfaces", "ethernet", "eth0"]`.
    pub path: Vec<String>,
    pub config: serde_json::Value,
}

/// `POST /api/config/interfaces` — set/delete paths relative to the
/// interface node; webd prefixes the interface path itself so a request
/// can only ever touch that one subtree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceConfigChange {
    pub interface: String,
    #[serde(default)]
    pub set: Vec<Vec<String>>,
    #[serde(default)]
    pub delete: Vec<Vec<String>>,
}

/// `GET /api/config/nat/<scope>` or `/api/config/routing/<scope>` — one
/// config subtree (`nat`, `nat cgnat`, `nat64`, `protocols bgp`, …) in
/// VyOS's JSON rendering.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeConfig {
    pub scope: String,
    pub path: Vec<String>,
    pub config: serde_json::Value,
}

/// `POST /api/config/nat` or `/api/config/routing` — set/delete paths
/// relative to the scope's node; webd prefixes the path, so only that
/// subtree is reachable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeConfigChange {
    pub scope: String,
    #[serde(default)]
    pub set: Vec<Vec<String>>,
    #[serde(default)]
    pub delete: Vec<Vec<String>>,
}

/// What a successful commit + save printed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigApplied {
    pub output: String,
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
#[allow(clippy::unwrap_used)]
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
        assert_eq!(InterfaceKind::from_name("vti0"), InterfaceKind::Vti);
        assert_eq!(InterfaceKind::from_name("lo"), InterfaceKind::Loopback);
        assert_eq!(InterfaceKind::from_name("dum0"), InterfaceKind::Dummy);
        assert_eq!(InterfaceKind::from_name("l2tpeth0"), InterfaceKind::L2tpv3);
        assert_eq!(InterfaceKind::from_name("vtun0"), InterfaceKind::Openvpn);
        assert_eq!(
            InterfaceKind::from_name("peth0"),
            InterfaceKind::PseudoEthernet
        );
        assert_eq!(
            InterfaceKind::from_name("veth0"),
            InterfaceKind::VirtualEthernet
        );
        assert_eq!(InterfaceKind::from_name("sstpc0"), InterfaceKind::Sstpc);
        assert_eq!(InterfaceKind::from_name("wwan0"), InterfaceKind::Wwan);
        assert_eq!(InterfaceKind::from_name("pppoe0"), InterfaceKind::Pppoe);
        assert_eq!(InterfaceKind::from_name("gre0"), InterfaceKind::Other);
        assert_eq!(
            serde_json::to_string(&InterfaceKind::PseudoEthernet).unwrap(),
            "\"pseudo-ethernet\""
        );
    }

    #[test]
    fn config_paths_for_every_kind() {
        let p = |n: &str| InterfaceKind::config_path(n).map(|w| w.join(" "));
        assert_eq!(p("eth0").as_deref(), Some("interfaces ethernet eth0"));
        assert_eq!(p("wg0").as_deref(), Some("interfaces wireguard wg0"));
        assert_eq!(
            p("peth0").as_deref(),
            Some("interfaces pseudo-ethernet peth0")
        );
        assert_eq!(p("lo").as_deref(), Some("interfaces loopback lo"));
        assert_eq!(
            p("eth1.100").as_deref(),
            Some("interfaces ethernet eth1 vif 100")
        );
        assert_eq!(
            p("bond0.10").as_deref(),
            Some("interfaces bonding bond0 vif 10")
        );
        assert_eq!(p("br0.5").as_deref(), Some("interfaces bridge br0 vif 5"));
        assert_eq!(
            p("eth0.100.200").as_deref(),
            Some("interfaces ethernet eth0 vif-s 100 vif-c 200")
        );
        assert_eq!(p("br0.100.200"), None);
        assert_eq!(p("eth0.4095"), None);
        assert_eq!(p("eth0.0100"), None);
        assert_eq!(p("wg0.1"), None);
        assert_eq!(p("gre0"), None);
        assert_eq!(p("eth0.1.2.3"), None);
        for kind in InterfaceKind::CONFIGURABLE {
            assert_ne!(kind.as_str(), "other");
        }
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
