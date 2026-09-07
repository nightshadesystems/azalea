//! Off-box backend: a plausible small router whose counters tick and
//! whose interface configuration can be edited (in memory).

use std::sync::Mutex;
use std::time::Instant;

use azalea_common::types::{
    CounterSample, Disk, Interface, InterfaceCounters, InterfaceDetail, InterfaceKind, LoadAverage,
    Memory, SystemInfo, SystemStatus,
};
use serde_json::{json, Value};

use crate::config::{tree, ConfigBackend, ConfigBatch, ConfigError};
use crate::op::{OpBackend, OpError};

/// Leaves under an ethernet or VLAN node that take a value; VyOS knows
/// from its schema, the mock from this list. Anything else the UI sets
/// is a valueless node (`disable`, `offload gro`).
const VALUE_LEAVES: &[&str] = &[
    "description",
    "mtu",
    "mac",
    "hw-id",
    "speed",
    "duplex",
    "vrf",
    "redirect",
    "arp-cache-timeout",
    "adjust-mss",
    "source-validation",
    "client-id",
    "host-name",
    "vendor-class-id",
    "default-route-distance",
    "duid",
    "dup-addr-detect-transmits",
    "accept-dad",
    "egress-qos",
    "ingress-qos",
    "ingress",
    "egress",
    "route",
    "route6",
    "rx",
    "tx",
];
/// ... and the ones VyOS declares multi-valued, so a second `set`
/// appends rather than replaces.
const MULTI_LEAVES: &[&str] = &["address", "eui64", "reject", "user-class"];

pub struct MockOp {
    started: Instant,
    /// The `interfaces` subtree, in VyOS's JSON rendering.
    config: Mutex<Value>,
}

impl Default for MockOp {
    fn default() -> Self {
        Self::new()
    }
}

impl MockOp {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            config: Mutex::new(Self::initial_config()),
        }
    }

    /// `interfaces { ... }` for the mock router.
    fn initial_config() -> Value {
        json!({
            "ethernet": {
                "eth0": {
                    "address": ["203.0.113.10/24", "2001:db8::10/64"],
                    "description": "WAN",
                    "hw-id": "52:54:00:a1:b2:01",
                    "ip": { "source-validation": "strict" },
                    "offload": { "gro": {}, "gso": {}, "sg": {}, "tso": {} }
                },
                "eth1": {
                    "address": "192.168.1.1/24",
                    "description": "LAN",
                    "hw-id": "52:54:00:a1:b2:02",
                    "vif": {
                        "100": {
                            "address": "192.168.100.1/24",
                            "description": "Guest VLAN",
                            "ip": { "enable-proxy-arp": {} }
                        },
                        "200": {
                            "address": "192.168.200.1/24",
                            "description": "IoT VLAN",
                            "mtu": "1400"
                        }
                    }
                },
                "eth2": { "hw-id": "52:54:00:a1:b2:03" },
                "eth3": { "description": "spare", "disable": {}, "hw-id": "52:54:00:a1:b2:04" },
                "eth4": { "hw-id": "52:54:00:a1:b2:05", "speed": "1000", "duplex": "full" },
                "eth5": { "hw-id": "52:54:00:a1:b2:05" }
            },
            "bridge": { "br0": { "address": "10.10.0.1/24", "description": "Servers",
                "member": { "interface": { "eth2": {}, "eth3": {} } } } },
            "bonding": { "bond0": { "address": "10.20.0.1/30", "description": "Uplink LAG",
                "member": { "interface": ["eth4", "eth5"] } } }
        })
    }

    fn config(&self) -> std::sync::MutexGuard<'_, Value> {
        self.config
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Strings of a leaf: one value or a list.
    fn values(node: Option<&Value>) -> Vec<String> {
        match node {
            Some(Value::String(s)) => vec![s.clone()],
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
            _ => vec![],
        }
    }

    fn iface(
        name: &str,
        admin_up: bool,
        oper_up: bool,
        description: &str,
        mac: &str,
        addresses: &[&str],
        base: u64,
    ) -> Interface {
        let kind = InterfaceKind::from_name(name);
        let (parent, vlan_id) = match name.split_once('.') {
            Some((p, v)) => (Some(p.to_string()), v.parse().ok()),
            None => (None, None),
        };
        Interface {
            name: name.to_string(),
            kind,
            admin_up,
            oper_up,
            description: description.to_string(),
            mtu: if kind == InterfaceKind::Loopback {
                65536
            } else {
                1500
            },
            mac: mac.to_string(),
            addresses: addresses.iter().map(|a| a.to_string()).collect(),
            parent,
            vlan_id,
            members: match name {
                "br0" => vec!["eth2".into(), "eth3".into()],
                "bond0" => vec!["eth4".into(), "eth5".into()],
                _ => vec![],
            },
            counters: InterfaceCounters {
                rx_bytes: base * 1024,
                tx_bytes: base * 512,
                rx_packets: base,
                tx_packets: base / 2,
                rx_errors: 0,
                tx_errors: 0,
                rx_dropped: if name == "eth1" { 3 } else { 0 },
                tx_dropped: 0,
            },
        }
    }

    /// The static rows plus one per configured `vif`, with description,
    /// addresses, MTU, MAC and admin state taken from the config tree so
    /// edits, additions and removals show up in the grid.
    fn table(&self) -> Vec<Interface> {
        let config = self.config().clone();
        let mut rows = self.base_table();
        let t = self.started.elapsed().as_secs();
        let mut vlans = Vec::new();
        for parent in &rows {
            let Some(path) = InterfaceKind::config_path(&parent.name) else {
                continue;
            };
            let Some(Value::Object(vifs)) =
                tree::get(&config, &path[1..]).and_then(|n| n.get("vif"))
            else {
                continue;
            };
            for id in vifs.keys() {
                let name = format!("{}.{id}", parent.name);
                let seed: u64 = id.parse().unwrap_or(1);
                vlans.push(Self::iface(
                    &name,
                    true,
                    parent.oper_up,
                    "",
                    &parent.mac,
                    &[],
                    seed * 3_000 + t * (seed % 50),
                ));
            }
        }
        rows.extend(vlans);
        for row in &mut rows {
            let Some(path) = InterfaceKind::config_path(&row.name) else {
                continue;
            };
            let Some(node) = tree::get(&config, &path[1..]) else {
                continue;
            };
            row.description = Self::values(node.get("description"))
                .pop()
                .unwrap_or_default();
            row.admin_up = node.get("disable").is_none();
            row.oper_up = row.oper_up && row.admin_up;
            if let Some(mtu) = Self::values(node.get("mtu"))
                .pop()
                .and_then(|m| m.parse().ok())
            {
                row.mtu = mtu;
            }
            if let Some(mac) = Self::values(node.get("mac")).pop() {
                row.mac = mac;
            }
            row.addresses = Self::values(node.get("address"))
                .into_iter()
                .map(|a| match a.as_str() {
                    "dhcp" => "198.51.100.23/24 (dhcp)".to_string(),
                    "dhcpv6" => "2001:db8:1::23/64 (dhcpv6)".to_string(),
                    _ => a,
                })
                .collect();
        }
        rows
    }

    fn base_table(&self) -> Vec<Interface> {
        let t = self.started.elapsed().as_secs();
        let i = Self::iface;
        vec![
            i(
                "eth0",
                true,
                true,
                "WAN",
                "52:54:00:a1:b2:01",
                &["203.0.113.10/24", "2001:db8::10/64"],
                8_400_000 + t * 1200,
            ),
            i(
                "eth1",
                true,
                true,
                "LAN",
                "52:54:00:a1:b2:02",
                &["192.168.1.1/24"],
                5_100_000 + t * 900,
            ),
            i(
                "eth2",
                true,
                true,
                "",
                "52:54:00:a1:b2:03",
                &[],
                900_000 + t * 100,
            ),
            i("eth3", false, false, "spare", "52:54:00:a1:b2:04", &[], 0),
            i(
                "eth4",
                true,
                true,
                "",
                "52:54:00:a1:b2:05",
                &[],
                2_000_000 + t * 300,
            ),
            i(
                "eth5",
                true,
                true,
                "",
                "52:54:00:a1:b2:05",
                &[],
                2_000_000 + t * 300,
            ),
            i(
                "br0",
                true,
                true,
                "Servers",
                "52:54:00:a1:b2:03",
                &["10.10.0.1/24"],
                900_000 + t * 100,
            ),
            i(
                "bond0",
                true,
                true,
                "Uplink LAG",
                "52:54:00:a1:b2:05",
                &["10.20.0.1/30"],
                4_000_000 + t * 600,
            ),
            i(
                "wg0",
                true,
                true,
                "Site-to-site",
                "",
                &["10.255.0.1/24"],
                700_000 + t * 80,
            ),
            i(
                "tun0",
                true,
                false,
                "GRE to dc2",
                "",
                &["10.254.0.1/30"],
                1_000,
            ),
            i(
                "lo",
                true,
                true,
                "",
                "",
                &["127.0.0.1/8", "10.0.0.1/32", "::1/128"],
                42_000 + t,
            ),
            i("dum0", true, true, "Anycast", "", &["10.0.0.2/32"], 0),
        ]
    }
}

#[async_trait::async_trait]
impl OpBackend for MockOp {
    async fn system_info(&self) -> Result<SystemInfo, OpError> {
        Ok(SystemInfo {
            hostname: "vyos-mock".into(),
            version: "1.4.1".into(),
            release_train: "sagitta".into(),
            built_on: "Thu 01 Aug 2024 12:00 UTC".into(),
            architecture: "x86_64".into(),
            boot_via: "installed image".into(),
            system_type: "KVM guest".into(),
            hardware_vendor: "QEMU".into(),
            hardware_model: "Standard PC (Q35 + ICH9, 2009)".into(),
            azalea_version: azalea_common::VERSION.to_string(),
        })
    }

    async fn system_status(&self) -> Result<SystemStatus, OpError> {
        let t = self.started.elapsed().as_secs();
        Ok(SystemStatus {
            uptime_secs: 3 * 86400 + 4 * 3600 + 17 * 60 + t,
            load: LoadAverage {
                one: 0.12 + (t % 7) as f64 / 100.0,
                five: 0.09,
                fifteen: 0.05,
            },
            memory: Memory {
                total: 4_100_000_000,
                used: 900_000_000,
                free: 2_600_000_000,
                buffers: 100_000_000,
                cached: 500_000_000,
            },
            disks: vec![Disk {
                mount: "/usr/lib/live/mount/persistence".into(),
                filesystem: "/dev/sda1".into(),
                total: 16_000_000_000,
                used: 3_200_000_000,
                available: 12_000_000_000,
            }],
        })
    }

    async fn interfaces(&self) -> Result<Vec<Interface>, OpError> {
        Ok(self.table())
    }

    async fn interface_counters(&self) -> Result<Vec<CounterSample>, OpError> {
        Ok(self
            .table()
            .into_iter()
            .map(|i| CounterSample {
                name: i.name,
                oper_up: i.oper_up,
                counters: i.counters,
            })
            .collect())
    }

    async fn interface_detail(&self, name: &str) -> Result<InterfaceDetail, OpError> {
        let iface = self
            .table()
            .into_iter()
            .find(|i| i.name == name)
            .ok_or_else(|| OpError::NoSuchInterface(name.to_string()))?;
        let state = if !iface.admin_up {
            "<BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN"
        } else if iface.oper_up {
            "<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP"
        } else {
            "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc fq_codel state DOWN"
        };
        let mut raw = format!("{}: {} group default qlen 1000\n", iface.name, state);
        if !iface.mac.is_empty() {
            raw.push_str(&format!(
                "    link/ether {} brd ff:ff:ff:ff:ff:ff\n",
                iface.mac
            ));
        }
        for a in &iface.addresses {
            let fam = if a.contains(':') { "inet6" } else { "inet" };
            raw.push_str(&format!("    {fam} {a} scope global {}\n", iface.name));
        }
        if !iface.description.is_empty() {
            raw.push_str(&format!("    Description: {}\n", iface.description));
        }
        let c = &iface.counters;
        raw.push_str(&format!(
            "\n    RX:  bytes  packets  errors  dropped  overrun  mcast\n    {:>10} {:>8} {:>7} {:>8} {:>8} {:>6}\n",
            c.rx_bytes, c.rx_packets, c.rx_errors, c.rx_dropped, 0, 0
        ));
        raw.push_str(&format!(
            "    TX:  bytes  packets  errors  dropped  carrier  collisions\n    {:>10} {:>8} {:>7} {:>8} {:>8} {:>10}\n",
            c.tx_bytes, c.tx_packets, c.tx_errors, c.tx_dropped, 0, 0
        ));
        Ok(InterfaceDetail {
            name: iface.name.clone(),
            kind: iface.kind,
            fields: crate::parse::key_values(&raw),
            raw,
        })
    }
}

#[async_trait::async_trait]
impl ConfigBackend for MockOp {
    async fn subtree(&self, path: &[String]) -> Result<Value, ConfigError> {
        if path.first().map(String::as_str) != Some("interfaces") {
            return Ok(json!({}));
        }
        Ok(tree::get(&self.config(), &path[1..])
            .cloned()
            .unwrap_or_else(|| json!({})))
    }

    /// Deletes then sets, with the little validation the UI relies on
    /// VyOS for: an MTU range and address syntax, so a bad edit is
    /// refused the way a commit would refuse it.
    async fn apply(&self, batch: &ConfigBatch) -> Result<String, ConfigError> {
        let strip = |p: &Vec<String>| -> Result<Vec<String>, ConfigError> {
            match p.first().map(String::as_str) {
                Some("interfaces") if p.len() > 1 => Ok(p[1..].to_vec()),
                _ => Err(ConfigError::Rejected(format!(
                    "Configuration path: [{}] is not valid",
                    p.join(" ")
                ))),
            }
        };
        for p in &batch.set {
            validate_mock(p)?;
            // `set interfaces ethernet eth9 vif 1` commits fine on VyOS
            // until the device is looked up; the mock knows now.
            if p.len() >= 5 && p[3] == "vif" && tree::get(&self.config(), &p[1..3]).is_none() {
                return Err(ConfigError::Rejected(format!(
                    "Interface \"{}\" does not exist!

Commit failed",
                    p[2]
                )));
            }
        }
        let mut config = self.config().clone();
        for p in &batch.delete {
            tree::delete(&mut config, &strip(p)?);
        }
        for p in &batch.set {
            let p = strip(p)?;
            let parent = p.len().checked_sub(2).map(|i| p[i].as_str());
            let leaf = match parent {
                Some(k) if MULTI_LEAVES.contains(&k) => tree::Leaf::Multi,
                Some(k) if VALUE_LEAVES.contains(&k) => tree::Leaf::Single,
                _ => tree::Leaf::Node,
            };
            tree::set(&mut config, &p, leaf);
        }
        *self.config() = config;
        Ok(String::new())
    }
}

/// A taste of VyOS's validators so the mock refuses what a router would.
fn validate_mock(path: &[String]) -> Result<(), ConfigError> {
    let refuse = |why: String| {
        Err(ConfigError::Rejected(format!(
            "{why}\n\nValue validation failed\nSet failed"
        )))
    };
    let Some((value, rest)) = path.split_last() else {
        return Ok(());
    };
    let Some(key) = rest.last() else {
        return Ok(());
    };
    match key.as_str() {
        "mtu" => match value.parse::<u32>() {
            Ok(68..=16000) => Ok(()),
            _ => refuse(format!("MTU {value} must be between 68 and 16000")),
        },
        "address" if rest.len() >= 3 && rest[rest.len() - 2] != "eui64" => {
            let ok = matches!(value.as_str(), "dhcp" | "dhcpv6")
                || value
                    .split_once('/')
                    .and_then(|(ip, len)| {
                        let ip: std::net::IpAddr = ip.parse().ok()?;
                        let len: u8 = len.parse().ok()?;
                        Some(if ip.is_ipv4() { len <= 32 } else { len <= 128 })
                    })
                    .unwrap_or(false);
            if ok {
                Ok(())
            } else {
                refuse(format!("Invalid IPv4/IPv6 address/prefix {value:?}"))
            }
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn config_edits_reach_the_table() {
        let m = MockOp::new();
        let path = InterfaceKind::config_path("eth1.100").unwrap();
        let before = m.subtree(&path).await.unwrap();
        assert_eq!(before["description"], "Guest VLAN");

        let word = |p: &str| p.split(' ').map(String::from).collect::<Vec<_>>();
        let set = vec![
            word("interfaces ethernet eth1 vif 100 description Guests"),
            word("interfaces ethernet eth1 vif 100 address 10.9.0.1/24"),
            word("interfaces ethernet eth1 vif 100 disable"),
        ];
        let delete = vec![word("interfaces ethernet eth1 vif 100 ip enable-proxy-arp")];
        m.apply(&ConfigBatch { set, delete }).await.unwrap();

        let after = m.subtree(&path).await.unwrap();
        assert_eq!(after["description"], "Guests");
        assert_eq!(after["address"], json!(["192.168.100.1/24", "10.9.0.1/24"]));
        assert_eq!(after["disable"], json!({}));
        assert_eq!(after["ip"], json!({}));
        let row = m
            .interfaces()
            .await
            .unwrap()
            .into_iter()
            .find(|i| i.name == "eth1.100")
            .unwrap();
        assert_eq!(row.description, "Guests");
        assert!(!row.admin_up);
        assert_eq!(row.addresses.len(), 2);

        // A flag under a container, then a replaced single value.
        m.apply(&ConfigBatch {
            set: vec![
                word("interfaces ethernet eth2 offload gro"),
                word("interfaces ethernet eth2 mtu 9000"),
                word("interfaces ethernet eth2 mtu 1500"),
            ],
            delete: vec![],
        })
        .await
        .unwrap();
        let eth2 = m.subtree(&word("interfaces ethernet eth2")).await.unwrap();
        assert_eq!(eth2["offload"], json!({ "gro": {} }));
        assert_eq!(eth2["mtu"], "1500");

        let bad = ConfigBatch {
            set: vec![word("interfaces ethernet eth0 mtu 9")],
            delete: vec![],
        };
        assert!(matches!(m.apply(&bad).await, Err(ConfigError::Rejected(_))));
        let bad = ConfigBatch {
            set: vec![word("interfaces ethernet eth0 address nonsense")],
            delete: vec![],
        };
        assert!(matches!(m.apply(&bad).await, Err(ConfigError::Rejected(_))));
        // A new VLAN appears; a removed one goes.
        m.apply(&ConfigBatch {
            set: vec![
                word("interfaces ethernet eth2 vif 300"),
                word("interfaces ethernet eth2 vif 300 description Cameras"),
            ],
            delete: vec![word("interfaces ethernet eth1 vif 200")],
        })
        .await
        .unwrap();
        let names: Vec<String> = m
            .interfaces()
            .await
            .unwrap()
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert!(names.contains(&"eth2.300".to_string()));
        assert!(!names.contains(&"eth1.200".to_string()));
        assert!(matches!(
            m.apply(&ConfigBatch {
                set: vec![word("interfaces ethernet eth9 vif 1")],
                delete: vec![],
            })
            .await,
            Err(ConfigError::Rejected(_))
        ));
        // Unrelated subtrees are refused rather than edited.
        let bad = ConfigBatch {
            set: vec![word("system host-name evil")],
            delete: vec![],
        };
        assert!(matches!(m.apply(&bad).await, Err(ConfigError::Rejected(_))));
    }

    #[tokio::test]
    async fn mock_is_internally_consistent() {
        let m = MockOp::new();
        let all = m.interfaces().await.unwrap();
        assert!(all
            .iter()
            .any(|i| i.kind == InterfaceKind::Vlan && i.parent.as_deref() == Some("eth1")));
        let counters = m.interface_counters().await.unwrap();
        assert_eq!(counters.len(), all.len());
        let d = m.interface_detail("eth0").await.unwrap();
        assert!(d.raw.contains("203.0.113.10/24"));
        assert!(matches!(
            m.interface_detail("nope").await,
            Err(OpError::NoSuchInterface(_))
        ));
        assert_eq!(m.system_info().await.unwrap().release_train, "sagitta");
    }
}
