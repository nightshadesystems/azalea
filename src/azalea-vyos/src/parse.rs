//! Parsers over op-mode output. Pinned to real captures in `fixtures/`
//! as those arrive (M2); shared by the real and mock backends.

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
mod tests {
    use super::*;

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
