//! Parsers over op-mode and /proc output, pinned to `fixtures/`. Shared
//! by the real backend and the tests; the mock does not need them.

use azalea_common::types::{Disk, LoadAverage, Memory, SystemInfo};

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
            let mem = memory_raw(&serde_json::from_str(text).unwrap()).unwrap();
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
        let full =
            version_raw(&serde_json::from_str(fixture!("sagitta/version-show-raw.json")).unwrap());
        assert_eq!(full.version, "1.4.1");
        assert_eq!(full.release_train, "sagitta");
        assert_eq!(full.architecture, "x86_64");
        assert_eq!(full.boot_via, "livecd");
        assert_eq!(full.system_type, "bare metal");
        assert_eq!(full.hardware_vendor, "Unknown");
        // Without version.json the version fields are simply empty.
        let bare =
            version_raw(&serde_json::from_str(fixture!("circinus/version-show-raw.json")).unwrap());
        assert_eq!(bare.version, "");
        assert_eq!(bare.architecture, "x86_64");
        let rolling =
            version_raw(&serde_json::from_str(fixture!("rolling/version-show-raw.json")).unwrap());
        assert_eq!(rolling.system_type, "container");
    }

    #[test]
    fn splits_key_value_lines() {
        let kv =
            key_values("eth0: <UP>\n    link/ether 00:11\n  MTU: 1500\n  Description: uplink\n");
        assert_eq!(kv[0], ("eth0".to_string(), "<UP>".to_string()));
        assert_eq!(kv[1], ("MTU".to_string(), "1500".to_string()));
        assert_eq!(kv[2], ("Description".to_string(), "uplink".to_string()));
        assert_eq!(kv.len(), 3);
    }
}
