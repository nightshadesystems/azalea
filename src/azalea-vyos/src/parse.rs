//! Parsers over op-mode and /proc output, pinned to `fixtures/`. Shared
//! by the real backend and the tests; the mock does not need them.

use std::collections::BTreeMap;

use azalea_common::types::{
    CounterSample, Disk, Interface, InterfaceCounters, InterfaceKind, LoadAverage, Memory,
    SystemInfo,
};

/// A parse failure names what was expected; the caller adds the command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn err(what: &str) -> ParseError {
    ParseError(what.to_string())
}

/// `/proc/uptime`: `<uptime> <idle>` seconds.
pub fn proc_uptime(text: &str) -> Result<u64, ParseError> {
    text.split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|s| s as u64)
        .ok_or_else(|| err("first field of /proc/uptime is not a number"))
}

/// `/proc/loadavg`: `<1> <5> <15> <running/total> <lastpid>`.
pub fn proc_loadavg(text: &str) -> Result<LoadAverage, ParseError> {
    let mut fields = text.split_whitespace().map(|f| f.parse::<f64>().ok());
    let mut next = || fields.next().flatten();
    match (next(), next(), next()) {
        (Some(one), Some(five), Some(fifteen)) => Ok(LoadAverage { one, five, fifteen }),
        _ => Err(err("/proc/loadavg does not start with three numbers")),
    }
}

/// `/proc/meminfo` in bytes; `free` is `MemAvailable`, as VyOS reports it.
pub fn proc_meminfo(text: &str) -> Result<Memory, ParseError> {
    let field = |name: &str| -> Result<u64, ParseError> {
        text.lines()
            .find_map(|line| {
                let (k, v) = line.split_once(':')?;
                (k.trim() == name).then(|| v.split_whitespace().next()?.parse::<u64>().ok())?
            })
            .map(|kb| kb * 1024)
            .ok_or_else(|| err(&format!("no {name} in /proc/meminfo")))
    };
    let total = field("MemTotal")?;
    let free = field("MemAvailable")?;
    Ok(Memory {
        total,
        used: total.saturating_sub(free),
        free,
        buffers: field("Buffers")?,
        cached: field("Cached")?,
    })
}

fn u64_of(v: &serde_json::Value, key: &str) -> Option<u64> {
    let v = v.get(key)?;
    v.as_u64()
        .or_else(|| v.as_f64().map(|f| f as u64))
        .or_else(|| v.as_str()?.trim().parse().ok())
}

fn str_of(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn has_flag(v: &serde_json::Value, flag: &str) -> bool {
    v.get("flags")
        .and_then(|f| f.as_array())
        .map(|f| f.iter().any(|x| x.as_str() == Some(flag)))
        .unwrap_or(false)
}

/// `ip` reports `UNKNOWN` for interfaces without carrier detection
/// (loopback, dummy, wireguard, tunnels); VyOS counts those as up.
fn oper_up(v: &serde_json::Value) -> bool {
    has_flag(v, "UP") && matches!(str_of(v, "operstate").as_str(), "UP" | "UNKNOWN")
}

/// `memory.py show --raw`: bytes.
pub fn memory_raw(v: &serde_json::Value) -> Result<Memory, ParseError> {
    let f = |k: &str| u64_of(v, k).ok_or_else(|| err(&format!("memory: missing {k}")));
    Ok(Memory {
        total: f("total")?,
        used: f("used")?,
        free: f("free")?,
        buffers: f("buffers")?,
        cached: f("cached")?,
    })
}

/// `storage.py show --raw`: the persistence filesystem. The text is
/// passed rather than a Value because rolling prints a sentence when
/// there is no ext4 filesystem, which is an empty answer, not an error.
pub fn storage_raw(text: &str) -> Result<Vec<Disk>, ParseError> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return Ok(vec![]);
    };
    let entries: Vec<&serde_json::Value> = match &v {
        serde_json::Value::Array(items) => items.iter().collect(),
        other => vec![other],
    };
    entries
        .into_iter()
        .map(|e| {
            let f = |k: &str| u64_of(e, k).ok_or_else(|| err(&format!("storage: missing {k}")));
            Ok(Disk {
                mount: str_of(e, "mounted_on"),
                filesystem: str_of(e, "filesystem"),
                total: f("size")?,
                used: f("used")?,
                available: f("avail")?,
            })
        })
        .collect()
}

/// `version.py show --raw`; `hostname` and `azalea_version` are filled
/// by the caller.
pub fn version_raw(v: &serde_json::Value) -> SystemInfo {
    SystemInfo {
        hostname: String::new(),
        version: str_of(v, "version"),
        release_train: str_of(v, "release_train"),
        built_on: str_of(v, "built_on"),
        architecture: str_of(v, "system_arch"),
        boot_via: str_of(v, "boot_via"),
        system_type: str_of(v, "system_type"),
        hardware_vendor: str_of(v, "hardware_vendor"),
        hardware_model: str_of(v, "hardware_model"),
        azalea_version: String::new(),
    }
}

/// Natural order: alphabetic prefix, then number, then VIF number
/// (eth2 before eth10, eth1 before eth1.100).
pub fn name_key(name: &str) -> (String, u64, u64) {
    let (base, vif) = match name.split_once('.') {
        Some((b, v)) => (b, v.parse().unwrap_or(0)),
        None => (name, 0),
    };
    let split = base
        .find(|c: char| c.is_ascii_digit())
        .unwrap_or(base.len());
    let (prefix, number) = base.split_at(split);
    (prefix.to_string(), number.parse().unwrap_or(0), vif)
}

/// `interfaces.py show --raw`: `ip -json addr show` per interface plus
/// `description` and `stats`. Bridge and bond membership is derived
/// from each member's `master`.
pub fn interfaces_raw(v: &serde_json::Value) -> Result<Vec<Interface>, ParseError> {
    let entries = v
        .as_array()
        .ok_or_else(|| err("interfaces: expected a JSON array"))?;
    let mut members: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut out = Vec::new();
    for e in entries {
        let name = str_of(e, "ifname");
        // pppoe placeholders (`unhandled`) have a name and nothing else.
        if name.is_empty() || e.get("flags").is_none() {
            continue;
        }
        let kind = InterfaceKind::from_name(&name);
        let master = str_of(e, "master");
        if !master.is_empty() {
            members.entry(master).or_default().push(name.clone());
        }
        let addresses = e
            .get("addr_info")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter(|x| str_of(x, "scope") != "link")
                    .filter_map(|x| {
                        let local = str_of(x, "local");
                        (!local.is_empty()).then(|| match u64_of(x, "prefixlen") {
                            Some(p) => format!("{local}/{p}"),
                            None => local,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let (parent, vlan_id) = if kind == InterfaceKind::Vlan {
            let link = str_of(e, "link");
            let (base, vif) = name.split_once('.').unwrap_or((&name, ""));
            (
                Some(if link.is_empty() {
                    base.to_string()
                } else {
                    link
                }),
                vif.parse().ok(),
            )
        } else {
            (None, None)
        };
        let stats = e.get("stats").cloned().unwrap_or_default();
        let c = |k: &str| u64_of(&stats, k).unwrap_or(0);
        out.push(Interface {
            name,
            kind,
            admin_up: has_flag(e, "UP"),
            oper_up: oper_up(e),
            description: str_of(e, "description"),
            mtu: u64_of(e, "mtu").unwrap_or(0) as u32,
            mac: if str_of(e, "link_type") == "ether" {
                str_of(e, "address")
            } else {
                String::new()
            },
            addresses,
            parent,
            vlan_id,
            members: vec![],
            counters: InterfaceCounters {
                rx_bytes: c("rx_bytes"),
                tx_bytes: c("tx_bytes"),
                rx_packets: c("rx_packets"),
                tx_packets: c("tx_packets"),
                rx_errors: c("rx_errors"),
                tx_errors: c("tx_errors"),
                rx_dropped: c("rx_dropped"),
                tx_dropped: c("tx_dropped"),
            },
        });
    }
    for iface in &mut out {
        if matches!(iface.kind, InterfaceKind::Bridge | InterfaceKind::Bonding) {
            if let Some(m) = members.remove(&iface.name) {
                iface.members = m;
                iface.members.sort_by_key(|n| name_key(n));
            }
        }
    }
    out.sort_by_key(|i| name_key(&i.name));
    Ok(out)
}

/// `ip -json -s link show`: the live counter feed. One `ip` spawn per
/// tick, kernel counters (not offset by `clear interfaces counters`).
pub fn ip_link_stats(v: &serde_json::Value) -> Result<Vec<CounterSample>, ParseError> {
    let entries = v
        .as_array()
        .ok_or_else(|| err("ip -s link: expected a JSON array"))?;
    let mut out: Vec<CounterSample> = entries
        .iter()
        .filter_map(|e| {
            let name = str_of(e, "ifname");
            if name.is_empty() {
                return None;
            }
            let stats = e.get("stats64").or_else(|| e.get("stats"))?;
            let rx = stats.get("rx")?;
            let tx = stats.get("tx")?;
            let g = |s: &serde_json::Value, k: &str| u64_of(s, k).unwrap_or(0);
            Some(CounterSample {
                name,
                oper_up: oper_up(e),
                counters: InterfaceCounters {
                    rx_bytes: g(rx, "bytes"),
                    tx_bytes: g(tx, "bytes"),
                    rx_packets: g(rx, "packets"),
                    tx_packets: g(tx, "packets"),
                    rx_errors: g(rx, "errors"),
                    tx_errors: g(tx, "errors"),
                    rx_dropped: g(rx, "dropped"),
                    tx_dropped: g(tx, "dropped"),
                },
            })
        })
        .collect();
    out.sort_by_key(|s| name_key(&s.name));
    Ok(out)
}

/// `show interfaces <type> <name>` prints `ip addr`-style lines and then
/// `key: value` lines; keep the `key: value` ones in order.
pub fn key_values(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (k, v) = line.split_once(':')?;
            let k = k.trim();
            if k.is_empty() || k.contains(' ') {
                return None;
            }
            Some((k.to_string(), v.trim().to_string()))
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    macro_rules! fixture {
        ($path:expr) => {
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/", $path))
        };
    }

    fn json(text: &str) -> serde_json::Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn proc_files() {
        assert_eq!(proc_uptime(fixture!("linux/proc-uptime")).unwrap(), 720);
        let load = proc_loadavg(fixture!("linux/proc-loadavg")).unwrap();
        assert_eq!((load.one, load.five, load.fifteen), (0.61, 1.01, 0.89));
        let mem = proc_meminfo(fixture!("linux/proc-meminfo")).unwrap();
        assert_eq!(mem.total, 16_264_888 * 1024);
        assert_eq!(mem.free, 14_576_908 * 1024);
        assert_eq!(mem.used, mem.total - mem.free);
        assert_eq!(mem.buffers, 132_340 * 1024);
        assert!(proc_uptime("garbage").is_err());
        assert!(proc_loadavg("1.0").is_err());
        assert!(proc_meminfo("MemTotal: 1 kB\n").is_err());
    }

    #[test]
    fn memory_show_raw_every_train() {
        for text in [
            fixture!("sagitta/memory-show-raw.json"),
            fixture!("circinus/memory-show-raw.json"),
            fixture!("rolling/memory-show-raw.json"),
        ] {
            let mem = memory_raw(&json(text)).unwrap();
            assert_eq!(mem.total, 16_655_245_312);
            assert_eq!(mem.used + mem.free, mem.total);
            assert_eq!(mem.buffers, 135_516_160);
        }
    }

    #[test]
    fn storage_show_raw() {
        for text in [
            fixture!("sagitta/storage-show-raw.json"),
            fixture!("circinus/storage-show-raw.json"),
        ] {
            let disks = storage_raw(text).unwrap();
            assert_eq!(disks.len(), 1);
            assert_eq!(disks[0].filesystem, "/dev/sde");
            assert_eq!(disks[0].total, 1_081_258_016_768);
            assert_eq!(disks[0].used, 4_617_089_843);
            assert_eq!(disks[0].available, 1_022_202_216_448);
        }
        // Rolling with no ext4 filesystem prints a sentence.
        assert_eq!(
            storage_raw(fixture!("rolling/storage-show-raw.txt")).unwrap(),
            vec![]
        );
        assert!(storage_raw(r#"{"filesystem":"/dev/sda1","size":"x"}"#).is_err());
    }

    #[test]
    fn version_show_raw() {
        let full = version_raw(&json(fixture!("sagitta/version-show-raw.json")));
        assert_eq!(full.version, "1.4.1");
        assert_eq!(full.release_train, "sagitta");
        assert_eq!(full.architecture, "x86_64");
        assert_eq!(full.boot_via, "livecd");
        assert_eq!(full.system_type, "bare metal");
        assert_eq!(full.hardware_vendor, "Unknown");
        // Without version.json the version fields are simply empty.
        let bare = version_raw(&json(fixture!("circinus/version-show-raw.json")));
        assert_eq!(bare.version, "");
        assert_eq!(bare.architecture, "x86_64");
        let rolling = version_raw(&json(fixture!("rolling/version-show-raw.json")));
        assert_eq!(rolling.system_type, "container");
    }

    #[test]
    fn names_sort_naturally() {
        let mut names = vec!["eth10", "eth1.100", "eth2", "br0", "eth1", "lo", "eth1.20"];
        names.sort_by_key(|n| name_key(n));
        assert_eq!(
            names,
            ["br0", "eth1", "eth1.20", "eth1.100", "eth2", "eth10", "lo"]
        );
    }

    #[test]
    fn interfaces_show_raw_every_train() {
        for text in [
            fixture!("sagitta/interfaces-show-raw.json"),
            fixture!("circinus/interfaces-show-raw.json"),
            fixture!("rolling/interfaces-show-raw.json"),
        ] {
            let all = interfaces_raw(&json(text)).unwrap();
            let names: Vec<&str> = all.iter().map(|i| i.name.as_str()).collect();
            assert_eq!(names, ["br0", "dum0", "eth0", "eth0.100", "lo"]);

            let eth0 = &all[2];
            assert_eq!(eth0.kind, InterfaceKind::Ethernet);
            assert!(eth0.admin_up && eth0.oper_up);
            assert_eq!(eth0.description, "uplink to lab");
            // The MAC differs per container the capture ran in.
            assert_eq!(eth0.mac.len(), 17);
            assert_eq!(eth0.mtu, 1500);
            assert_eq!(eth0.addresses, ["172.17.0.2/16"]);
            assert!(eth0.counters.rx_bytes > 0 && eth0.counters.tx_packets > 0);

            let vif = &all[3];
            assert_eq!(vif.kind, InterfaceKind::Vlan);
            assert_eq!(vif.parent.as_deref(), Some("eth0"));
            assert_eq!(vif.vlan_id, Some(100));
            // Link-local addresses are left out, as `show interfaces` does.
            assert_eq!(vif.addresses, ["192.0.2.1/24"]);

            let br0 = &all[0];
            assert_eq!(br0.kind, InterfaceKind::Bridge);
            assert_eq!(br0.members, ["dum0"]);
            assert!(br0.oper_up);

            // dummy and loopback report UNKNOWN operstate: up.
            let dum0 = &all[1];
            assert_eq!(dum0.kind, InterfaceKind::Dummy);
            assert!(dum0.oper_up);
            assert_eq!(dum0.addresses, ["10.9.9.1/24"]);
            let lo = &all[4];
            assert_eq!(lo.kind, InterfaceKind::Loopback);
            assert_eq!(lo.mtu, 65536);
            assert_eq!(lo.mac, "");
            assert_eq!(lo.addresses, ["127.0.0.1/8", "::1/128"]);
        }
        assert!(interfaces_raw(&json("{}")).is_err());
    }

    #[test]
    fn ip_link_stats_feed() {
        let samples = ip_link_stats(&json(fixture!("linux/ip-json-s-link.json"))).unwrap();
        let names: Vec<&str> = samples.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["br0", "dum0", "dum1", "eth0", "eth0.100", "lo"]);
        let eth0 = samples.iter().find(|s| s.name == "eth0").unwrap();
        assert!(eth0.oper_up);
        assert_eq!(eth0.counters.rx_bytes, 46_269_678);
        assert_eq!(eth0.counters.tx_packets, 31_718);
        // dum1 was created but never brought up.
        let dum1 = samples.iter().find(|s| s.name == "dum1").unwrap();
        assert!(!dum1.oper_up);
    }

    #[test]
    fn show_interface_text_key_values() {
        let kv = key_values(fixture!("sagitta/interfaces-show-eth0.txt"));
        assert!(kv
            .iter()
            .any(|(k, v)| k == "Description" && v == "uplink to lab"));
        assert!(kv.iter().any(|(k, _)| k == "RX"));
        assert!(kv.iter().any(|(k, _)| k == "TX"));
        let kv = key_values("eth0: <UP>\n    link/ether 00:11\n  MTU: 1500\n");
        assert_eq!(kv[0], ("eth0".to_string(), "<UP>".to_string()));
        assert_eq!(kv[1], ("MTU".to_string(), "1500".to_string()));
        assert_eq!(kv.len(), 2);
    }
}
