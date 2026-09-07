//! Off-box backend: a plausible small router whose counters tick.

use std::time::Instant;

use azalea_common::types::{
    CounterSample, Disk, Interface, InterfaceCounters, InterfaceDetail, InterfaceKind, LoadAverage,
    Memory, SystemInfo, SystemStatus,
};

use crate::op::{OpBackend, OpError};

pub struct MockOp {
    started: Instant,
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

    fn table(&self) -> Vec<Interface> {
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
                "eth1.100",
                true,
                true,
                "Guest VLAN",
                "52:54:00:a1:b2:02",
                &["192.168.100.1/24"],
                300_000 + t * 40,
            ),
            i(
                "eth1.200",
                true,
                false,
                "IoT VLAN",
                "52:54:00:a1:b2:02",
                &["192.168.200.1/24"],
                12_000,
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

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

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
