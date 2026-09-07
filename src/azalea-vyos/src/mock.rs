//! Off-box backend: a plausible small router with one of every interface
//! type, whose counters tick and whose configuration can be edited (in
//! memory). Rows are derived from the config tree, so creating, editing
//! and deleting interfaces shows up in the grid the way it would on a
//! router.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use azalea_common::types::{
    CounterSample, Disk, Interface, InterfaceCounters, InterfaceDetail, InterfaceKind, LoadAverage,
    Memory, SystemInfo, SystemStatus,
};
use serde_json::{json, Value};

use crate::config::{tree, ConfigBackend, ConfigBatch, ConfigError};
use crate::op::{OpBackend, OpError};

/// Node kinds of every `interfaces <type>` tree, generated from vyos-1x
/// by scripts/gen-vyos-schema.py: `k` node/tag/leaf, `m` multi, `v`
/// valueless, `c` children.
const SCHEMA_JSON: &str = include_str!("../schema/interfaces.json");

fn schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| serde_json::from_str(SCHEMA_JSON).expect("generated schema parses"))
}

/// What `set <path>` means, per the schema: the leaf kind of the last
/// word, or why VyOS would refuse the path. `path` is the full config
/// path (`interfaces ethernet eth0 mtu 1500`, `nat source rule 10 …`).
pub fn classify(path: &[String]) -> Result<tree::Leaf, String> {
    let bad = || format!("Configuration path: [{}] is not valid", path.join(" "));
    let mut words = path.iter();
    let root = words.next().ok_or_else(bad)?;
    let mut node = schema()["roots"].get(root).ok_or_else(bad)?;
    let mut leaf = tree::Leaf::Node;
    while let Some(word) = words.next() {
        let child = node.get("c").and_then(|c| c.get(word)).ok_or_else(bad)?;
        node = child;
        match child["k"].as_str() {
            Some("t") => {
                // Tag: the next word is the key; nothing else changes.
                if words.next().is_none() {
                    return Err(format!(
                        "Configuration path: [{}] requires a value",
                        path.join(" ")
                    ));
                }
                leaf = tree::Leaf::Node;
            }
            Some("l") => {
                if child.get("v").is_some() {
                    if words.next().is_some() {
                        return Err(bad());
                    }
                    return Ok(tree::Leaf::Node);
                }
                if words.next().is_none() {
                    return Err(format!(
                        "Configuration path: [{}] requires a value",
                        path.join(" ")
                    ));
                }
                if words.next().is_some() {
                    return Err(bad());
                }
                return Ok(if child.get("m").is_some() {
                    tree::Leaf::Multi
                } else {
                    tree::Leaf::Single
                });
            }
            _ => leaf = tree::Leaf::Node,
        }
    }
    Ok(leaf)
}

/// Every key in `cfg` exists in the schema under `node` (tag keys are
/// skipped). Keeps the sample config honest.
#[cfg(test)]
fn check_against_schema(node: &Value, cfg: &Value, at: &str) -> Result<(), String> {
    let Value::Object(map) = cfg else {
        return Ok(());
    };
    for (key, child_cfg) in map {
        let child = node
            .get("c")
            .and_then(|c| c.get(key))
            .ok_or_else(|| format!("{at} {key}: not in schema"))?;
        match child["k"].as_str() {
            Some("t") => {
                if let Value::Object(entries) = child_cfg {
                    for (tag, entry) in entries {
                        check_against_schema(child, entry, &format!("{at} {key} {tag}"))?;
                    }
                }
            }
            Some("n") => check_against_schema(child, child_cfg, &format!("{at} {key}"))?,
            _ => {}
        }
    }
    Ok(())
}

pub struct MockOp {
    started: Instant,
    /// The whole config tree Azalea edits (`interfaces`, `nat`, `nat64`,
    /// `nat66`), in VyOS's JSON rendering.
    config: Mutex<Value>,
}

impl Default for MockOp {
    fn default() -> Self {
        Self::new()
    }
}

/// Static traits per name the config does not carry: link state, MAC
/// and a counter seed. Anything else gets defaults.
const TRAITS: &[(&str, bool, &str, u64)] = &[
    ("eth0", true, "52:54:00:a1:b2:01", 8_400_000),
    ("eth1", true, "52:54:00:a1:b2:02", 5_100_000),
    ("eth2", true, "52:54:00:a1:b2:03", 900_000),
    ("eth3", false, "52:54:00:a1:b2:04", 0),
    ("eth4", true, "52:54:00:a1:b2:05", 2_000_000),
    ("eth5", true, "52:54:00:a1:b2:05", 2_000_000),
    ("bond0", true, "52:54:00:a1:b2:05", 4_000_000),
    ("br0", true, "52:54:00:a1:b2:03", 900_000),
    ("wg0", true, "", 700_000),
    ("tun0", false, "", 1_000),
    ("lo", true, "", 42_000),
    ("l2tpeth0", false, "3a:9e:44:10:20:01", 0),
    ("wwan0", false, "", 0),
    ("sstpc0", false, "", 0),
];

impl MockOp {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            config: Mutex::new(Self::initial_config()),
        }
    }

    /// The mock router's config: one of every interface, and a little NAT.
    fn initial_config() -> Value {
        json!({
            "interfaces": Self::initial_interfaces(),
            "nat": {
                "source": { "rule": { "100": {
                    "description": "Masquerade LAN", "outbound-interface": { "name": "eth0" },
                    "source": { "address": "192.168.1.0/24" }, "translation": { "address": "masquerade" }
                } } },
                "destination": { "rule": { "10": {
                    "description": "Web server", "inbound-interface": { "name": "eth0" }, "protocol": "tcp",
                    "destination": { "port": "80,443" }, "translation": { "address": "192.168.1.10" }
                } } },
                "cgnat": {
                    "pool": {
                        "external": { "ext-pool": { "external-port-range": "1024-65535", "range": { "203.0.113.128/25": { "seq": "1" } } } },
                        "internal": { "lan": { "range": "100.64.0.0/22" } }
                    },
                    "rule": { "10": { "source": { "pool": "lan" }, "translation": { "pool": "ext-pool" } } }
                }
            },
            "nat64": { "source": { "rule": { "1": {
                "description": "IPv6-only clients", "source": { "prefix": "64:ff9b::/96" },
                "translation": { "pool": { "10": { "address": "203.0.113.10", "port": "1-65535" } } }
            } } } },
            "nat66": { "source": { "rule": { "1": {
                "description": "NPTv6 to ISP prefix", "outbound-interface": { "name": "eth0" },
                "source": { "prefix": "fc00:1::/64" }, "translation": { "address": "2001:db8:1::/64" }
            } } } }
        })
    }

    /// `interfaces { ... }`: one of everything.
    fn initial_interfaces() -> Value {
        json!({
            "bonding": {
                "bond0": {
                    "address": "10.20.0.1/30", "description": "Uplink LAG",
                    "hash-policy": "layer3+4", "lacp-rate": "fast", "mode": "802.3ad",
                    "member": { "interface": ["eth4", "eth5"] }
                }
            },
            "bridge": {
                "br0": {
                    "address": "10.10.0.1/24", "description": "Servers", "stp": {},
                    "member": { "interface": { "eth2": {}, "eth3": { "cost": "10" } } }
                }
            },
            "dummy": { "dum0": { "address": "10.0.0.2/32", "description": "Anycast" } },
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
            "geneve": {
                "gnv0": { "address": "10.40.0.1/24", "description": "Overlay to dc2", "remote": "203.0.113.99", "vni": "100" }
            },
            "l2tpv3": {
                "l2tpeth0": {
                    "address": "10.41.0.1/30", "description": "L2 to branch", "encapsulation": "udp",
                    "source-address": "203.0.113.10", "remote": "203.0.113.50",
                    "tunnel-id": "100", "peer-tunnel-id": "200", "session-id": "10", "peer-session-id": "20",
                    "source-port": "5000", "destination-port": "5000"
                }
            },
            "loopback": { "lo": { "address": "10.0.0.1/32" } },
            "macsec": {
                "macsec0": {
                    "address": "10.42.0.1/24", "description": "Secured link", "source-interface": "eth2",
                    "security": {
                        "cipher": "gcm-aes-128", "encrypt": {},
                        "mka": { "cak": "232e44b7fda6f8e2d88a339eaa41e9bf", "ckn": "40916f4b23e3d548ad27eedd2d10c6f8" }
                    }
                }
            },
            "openvpn": {
                "vtun0": {
                    "description": "Branch VPN", "mode": "site-to-site",
                    "local-address": { "10.43.0.1": {} }, "remote-address": "10.43.0.2",
                    "remote-host": "203.0.113.60", "protocol": "udp",
                    "local-port": "1194", "remote-port": "1194", "shared-secret-key": "ovpn-branch"
                }
            },
            "wireguard": {
                "wg0": {
                    "address": "10.255.0.1/24", "description": "Site-to-site", "port": "51820",
                    "private-key": "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=",
                    "peer": {
                        "branch": {
                            "public-key": "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=",
                            "allowed-ips": ["10.255.0.2/32", "192.168.50.0/24"],
                            "address": "203.0.113.70", "port": "51820", "persistent-keepalive": "25"
                        }
                    }
                }
            },
            "pppoe": {
                "pppoe0": {
                    "description": "ISP", "source-interface": "eth0",
                    "authentication": { "username": "vyos@isp", "password": "secret" },
                    "default-route-distance": "10"
                }
            },
            "pseudo-ethernet": {
                "peth0": { "address": "10.44.0.1/24", "description": "Second MAC on LAN", "source-interface": "eth1", "mode": "private" }
            },
            "sstpc": {
                "sstpc0": {
                    "description": "HQ SSTP", "server": "sstp.example.net",
                    "authentication": { "username": "vyos", "password": "secret" },
                    "ssl": { "ca-certificate": "hq-ca" }
                }
            },
            "tunnel": {
                "tun0": {
                    "address": "10.254.0.1/30", "description": "GRE to dc2", "encapsulation": "gre",
                    "source-address": "203.0.113.10", "remote": "198.51.100.7",
                    "parameters": { "ip": { "ttl": "64" } }
                }
            },
            "virtual-ethernet": {
                "veth0": { "address": "10.45.0.1/24", "description": "Container link", "peer-name": "veth1" },
                "veth1": { "peer-name": "veth0" }
            },
            "vti": { "vti0": { "address": "10.46.0.1/30", "description": "IPsec to dc3" } },
            "vxlan": {
                "vxlan0": {
                    "address": "10.47.0.1/24", "description": "Overlay", "source-address": "203.0.113.10",
                    "remote": "203.0.113.99", "vni": "4200", "port": "4789"
                }
            },
            "wireless": {
                "wlan0": {
                    "address": "192.168.9.1/24", "description": "Office Wi-Fi", "channel": "36", "mode": "ac",
                    "physical-device": "phy0", "ssid": "Azalea", "type": "access-point",
                    "security": { "wpa": { "mode": "wpa2", "passphrase": "correct-horse-battery", "cipher": "CCMP" } }
                }
            },
            "wwan": {
                "wwan0": { "description": "LTE backup", "apn": "internet", "authentication": { "username": "lte", "password": "lte" } }
            }
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

    fn seed(name: &str) -> u64 {
        name.bytes()
            .fold(7u64, |h, b| h.wrapping_mul(31).wrapping_add(u64::from(b)))
    }

    /// One row from its config node plus static traits.
    fn row(&self, name: &str, node: &Value, parent: Option<&Interface>) -> Interface {
        let t = self.started.elapsed().as_secs();
        let kind = InterfaceKind::from_name(name);
        let traits = TRAITS.iter().find(|(n, ..)| *n == name);
        let (mut oper_up, mac, base) = match (traits, parent) {
            (Some(&(_, up, mac, base)), _) => (up, mac.to_string(), base),
            (None, Some(p)) => (p.oper_up, p.mac.clone(), Self::seed(name) % 900_000),
            (None, None) => (true, String::new(), Self::seed(name) % 3_000_000),
        };
        let admin_up = node.get("disable").is_none();
        oper_up = oper_up && admin_up;
        let rate = if base == 0 {
            0
        } else {
            40 + Self::seed(name) % 1200
        };
        let base = base + t * rate;
        let (parent_name, vlan_id) = match name.rsplit_once('.') {
            Some((p, v)) => (Some(p.to_string()), v.parse().ok()),
            None => (None, None),
        };
        let members = match node.get("member").and_then(|m| m.get("interface")) {
            Some(Value::Object(o)) => o.keys().cloned().collect(),
            other => Self::values(other),
        };
        Interface {
            name: name.to_string(),
            kind,
            admin_up,
            oper_up,
            description: Self::values(node.get("description"))
                .pop()
                .unwrap_or_default(),
            mtu: Self::values(node.get("mtu"))
                .pop()
                .and_then(|m| m.parse().ok())
                .unwrap_or(if kind == InterfaceKind::Loopback {
                    65536
                } else {
                    1500
                }),
            mac: Self::values(node.get("mac")).pop().unwrap_or(mac),
            addresses: Self::values(node.get("address"))
                .into_iter()
                .map(|a| match a.as_str() {
                    "dhcp" => "198.51.100.23/24 (dhcp)".to_string(),
                    "dhcpv6" => "2001:db8:1::23/64 (dhcpv6)".to_string(),
                    _ => a,
                })
                .collect(),
            parent: parent_name,
            vlan_id,
            members,
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

    /// Every configured interface, in the UI's kind order, with VIFs
    /// (`vif`, `vif-s`/`vif-c`) after their parent.
    fn table(&self) -> Vec<Interface> {
        let config = self.config()["interfaces"].clone();
        let mut rows = Vec::new();
        for kind in InterfaceKind::CONFIGURABLE {
            let Some(Value::Object(ifaces)) = config.get(kind.as_str()) else {
                continue;
            };
            let mut names: Vec<&String> = ifaces.keys().collect();
            names.sort();
            for name in names {
                let node = &ifaces[name];
                let parent = self.row(name, node, None);
                let mut vlans = Vec::new();
                if let Some(Value::Object(vifs)) = node.get("vif") {
                    for (id, vnode) in vifs {
                        vlans.push(self.row(&format!("{name}.{id}"), vnode, Some(&parent)));
                    }
                }
                if let Some(Value::Object(svifs)) = node.get("vif-s") {
                    for (sid, snode) in svifs {
                        let svlan = self.row(&format!("{name}.{sid}"), snode, Some(&parent));
                        if let Some(Value::Object(cvifs)) = snode.get("vif-c") {
                            for (cid, cnode) in cvifs {
                                vlans.push(self.row(
                                    &format!("{name}.{sid}.{cid}"),
                                    cnode,
                                    Some(&svlan),
                                ));
                            }
                        }
                        vlans.push(svlan);
                    }
                }
                rows.push(parent);
                rows.extend(vlans);
            }
        }
        rows
    }
}

#[async_trait::async_trait]
impl OpBackend for MockOp {
    async fn system_info(&self) -> Result<SystemInfo, OpError> {
        Ok(SystemInfo {
            hostname: "vyos-mock".into(),
            version: "1.5.0".into(),
            release_train: "circinus".into(),
            built_on: "Thu 28 May 2026 12:00 UTC".into(),
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
        Ok(tree::get(&self.config(), path)
            .cloned()
            .unwrap_or_else(|| json!({})))
    }

    /// Deletes then sets. Paths are checked against the schema so an
    /// unknown node is refused, and a little of VyOS's value validation
    /// (MTU range, address syntax) is imitated so a bad edit is refused
    /// the way a commit would refuse it.
    async fn apply(&self, batch: &ConfigBatch) -> Result<String, ConfigError> {
        let mut sets = Vec::new();
        for p in &batch.set {
            validate_mock(p)?;
            let leaf = classify(p).map_err(ConfigError::Rejected)?;
            // `set interfaces ethernet eth9 vif 1` commits fine on VyOS
            // until the device is looked up; the mock knows now.
            if p.len() >= 5
                && p[0] == "interfaces"
                && p[3] == "vif"
                && tree::get(&self.config(), &p[..3]).is_none()
            {
                return Err(ConfigError::Rejected(format!(
                    "Interface \"{}\" does not exist!\n\nCommit failed",
                    p[2]
                )));
            }
            sets.push((p.clone(), leaf));
        }
        let mut config = self.config().clone();
        for p in &batch.delete {
            if p.len() < 2 || schema()["roots"].get(&p[0]).is_none() {
                return Err(ConfigError::Rejected(format!(
                    "Configuration path: [{}] is not valid",
                    p.join(" ")
                )));
            }
            tree::delete(&mut config, p);
        }
        for (p, leaf) in sets {
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
    // `address` directly under an interface or VIF node takes a prefix.
    let on_interface = rest.len() == 4
        || (rest.len() == 6 && rest[3] == "vif")
        || (rest.len() == 8 && rest[3] == "vif-s");
    match key.as_str() {
        "mtu" => match value.parse::<u32>() {
            Ok(68..=16000) => Ok(()),
            _ => refuse(format!("MTU {value} must be between 68 and 16000")),
        },
        "address" if on_interface => {
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

    fn word(p: &str) -> Vec<String> {
        p.split(' ').map(String::from).collect()
    }

    #[test]
    fn sample_config_matches_the_schema() {
        let cfg = MockOp::initial_config();
        for (root, subtree) in cfg.as_object().unwrap() {
            let node = &schema()["roots"][root];
            assert!(!node.is_null(), "{root}: no schema");
            check_against_schema(node, subtree, root).unwrap();
        }
        // One row per configurable kind, at least.
        let names: Vec<String> = MockOp::new().table().into_iter().map(|i| i.name).collect();
        for kind in InterfaceKind::CONFIGURABLE {
            assert!(
                names.iter().any(|n| InterfaceKind::from_name(n) == *kind),
                "no {} row",
                kind.as_str()
            );
        }
        assert!(names.contains(&"eth1.100".to_string()));
    }

    #[test]
    fn paths_are_classified_by_the_schema() {
        let c = |p: &str| classify(&word(p));
        let single = tree::Leaf::Single;
        let multi = tree::Leaf::Multi;
        let node = tree::Leaf::Node;
        assert_eq!(
            c("interfaces ethernet eth0 description WAN").unwrap(),
            single
        );
        assert_eq!(
            c("interfaces ethernet eth0 address 10.0.0.1/24").unwrap(),
            multi
        );
        assert_eq!(c("interfaces ethernet eth0 disable").unwrap(), node);
        assert_eq!(c("interfaces ethernet eth0 offload gro").unwrap(), node);
        assert_eq!(c("interfaces ethernet eth0 vif 100").unwrap(), node);
        assert_eq!(
            c("interfaces ethernet eth0 vif 100 address 10.0.0.1/24").unwrap(),
            multi
        );
        assert_eq!(c("interfaces wireguard wg0 peer hq").unwrap(), node);
        assert_eq!(
            c("interfaces wireguard wg0 peer hq allowed-ips 0.0.0.0/0").unwrap(),
            multi
        );
        assert_eq!(
            c("interfaces bridge br0 member interface eth2 cost 5").unwrap(),
            single
        );
        assert_eq!(
            c("interfaces bonding bond0 member interface eth2").unwrap(),
            multi
        );
        assert_eq!(c("interfaces wireguard wg0").unwrap(), node);
        assert_eq!(c("nat source rule 10").unwrap(), node);
        assert_eq!(
            c("nat source rule 10 translation address masquerade").unwrap(),
            single
        );
        assert_eq!(c("nat cgnat rule 10 source pool lan").unwrap(), single);
        assert_eq!(
            c("nat64 source rule 1 translation pool 10 address 1.2.3.4").unwrap(),
            single
        );
        assert_eq!(c("nat66 destination rule 1 log").unwrap(), node);
        assert!(c("interfaces ethernet eth0 nonsense x").is_err());
        assert!(c("interfaces ethernet eth0 description").is_err());
        assert!(c("interfaces ethernet eth0 disable yes").is_err());
        assert!(c("interfaces ethernet eth0 mtu 1500 extra").is_err());
        assert!(c("interfaces gre gre0 remote x").is_err());
        assert!(c("system host-name x").is_err());
    }

    #[tokio::test]
    async fn nat_edits_round_trip() {
        let m = MockOp::new();
        let nat = m.subtree(&word("nat")).await.unwrap();
        assert_eq!(
            nat["source"]["rule"]["100"]["translation"]["address"],
            "masquerade"
        );
        m.apply(&ConfigBatch {
            set: vec![
                word("nat source rule 200"),
                word("nat source rule 200 outbound-interface name eth1"),
                word("nat source rule 200 translation address masquerade"),
                word("nat cgnat log-allocation"),
            ],
            delete: vec![word("nat destination rule 10")],
        })
        .await
        .unwrap();
        let nat = m.subtree(&word("nat")).await.unwrap();
        assert_eq!(
            nat["source"]["rule"]["200"]["outbound-interface"]["name"],
            "eth1"
        );
        assert!(nat["destination"]["rule"].get("10").is_none());
        assert_eq!(nat["cgnat"]["log-allocation"], json!({}));
        assert_eq!(
            m.subtree(&word("nat cgnat")).await.unwrap()["rule"]["10"]["source"]["pool"],
            "lan"
        );
        assert!(matches!(
            m.apply(&ConfigBatch {
                set: vec![],
                delete: vec![word("nat")]
            })
            .await,
            Err(ConfigError::Rejected(_))
        ));
    }

    #[tokio::test]
    async fn config_edits_reach_the_table() {
        let m = MockOp::new();
        let path = InterfaceKind::config_path("eth1.100").unwrap();
        let before = m.subtree(&path).await.unwrap();
        assert_eq!(before["description"], "Guest VLAN");

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

        // A new VLAN and a new WireGuard peer appear; a removed VLAN goes.
        m.apply(&ConfigBatch {
            set: vec![
                word("interfaces ethernet eth2 vif 300"),
                word("interfaces ethernet eth2 vif 300 description Cameras"),
                word("interfaces wireguard wg0 peer hq"),
                word("interfaces wireguard wg0 peer hq allowed-ips 10.99.0.0/16"),
                word("interfaces bridge br0 member interface eth4 cost 20"),
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
        let wg = m.subtree(&word("interfaces wireguard wg0")).await.unwrap();
        assert_eq!(wg["peer"]["hq"]["allowed-ips"], json!(["10.99.0.0/16"]));
        let br = m
            .interfaces()
            .await
            .unwrap()
            .into_iter()
            .find(|i| i.name == "br0")
            .unwrap();
        assert_eq!(br.members, vec!["eth2", "eth3", "eth4"]);

        // Creating and deleting a whole interface.
        m.apply(&ConfigBatch {
            set: vec![
                word("interfaces dummy dum1"),
                word("interfaces dummy dum1 address 10.0.0.9/32"),
            ],
            delete: vec![word("interfaces vti vti0")],
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
        assert!(names.contains(&"dum1".to_string()));
        assert!(!names.contains(&"vti0".to_string()));

        let refused = |set: &str| ConfigBatch {
            set: vec![word(set)],
            delete: vec![],
        };
        for bad in [
            "interfaces ethernet eth0 mtu 9",
            "interfaces ethernet eth0 address nonsense",
            "interfaces ethernet eth9 vif 1",
            "interfaces ethernet eth0 no-such-node 1",
            "system host-name evil",
        ] {
            assert!(
                matches!(m.apply(&refused(bad)).await, Err(ConfigError::Rejected(_))),
                "{bad} was accepted"
            );
        }
        // A plain peer address is not a prefix; it must still be accepted.
        m.apply(&refused(
            "interfaces wireguard wg0 peer hq address 203.0.113.9",
        ))
        .await
        .unwrap();
    }
}
