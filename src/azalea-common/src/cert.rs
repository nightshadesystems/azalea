//! Self-signed TLS material, generated on first start into
//! `<state_dir>/tls/` and kept so the browser fingerprint stays stable.
//! Replacing the files with a real certificate and key works too.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tracing::info;

/// Ten years: a management-network cert, not a public site.
const VALIDITY_DAYS: u64 = 3650;

pub fn tls_dir(state_dir: &Path) -> PathBuf {
    state_dir.join("tls")
}

pub fn ensure_cert(state_dir: &Path, hostname: &str) -> Result<(PathBuf, PathBuf)> {
    let dir = tls_dir(state_dir);
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    if cert_path.exists() && key_path.exists() {
        return Ok((cert_path, key_path));
    }
    generate(&dir, hostname)
}

fn generate(dir: &Path, hostname: &str) -> Result<(PathBuf, PathBuf)> {
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;

    let mut names = vec![hostname.to_string()];
    if hostname != "azalea" {
        names.push("azalea".to_string());
    }
    let mut params =
        rcgen::CertificateParams::new(names).context("building certificate parameters")?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, hostname);
    let now = std::time::SystemTime::now();
    params.not_before = now.into();
    params.not_after = (now + std::time::Duration::from_secs(VALIDITY_DAYS * 86400)).into();

    let key_pair = rcgen::KeyPair::generate().context("generating TLS key")?;
    let cert = params
        .self_signed(&key_pair)
        .context("self-signing certificate")?;

    std::fs::write(&cert_path, cert.pem())
        .with_context(|| format!("writing {}", cert_path.display()))?;
    write_private(&key_path, key_pair.serialize_pem().as_bytes())?;
    info!(cert = %cert_path.display(), hostname, "generated self-signed TLS certificate");
    Ok((cert_path, key_path))
}

/// SHA-256 fingerprint as browsers show it: `AA:BB:...`.
pub fn fingerprint(cert_pem: &str) -> Result<String> {
    let der = pem_body(cert_pem).context("certificate is not PEM")?;
    use sha2::Digest as _;
    let digest = sha2::Sha256::digest(&der);
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

/// The fingerprint of the pair on disk, if any.
pub fn current_fingerprint(state_dir: &Path) -> Option<String> {
    let pem = std::fs::read_to_string(tls_dir(state_dir).join("cert.pem")).ok()?;
    fingerprint(&pem).ok()
}

fn pem_body(pem: &str) -> Option<Vec<u8>> {
    let base64: String = pem
        .lines()
        .skip_while(|line| !line.starts_with("-----BEGIN"))
        .skip(1)
        .take_while(|line| !line.starts_with("-----END"))
        .flat_map(|line| line.trim().chars())
        .collect();
    if base64.is_empty() {
        return None;
    }
    decode_base64(&base64)
}

fn decode_base64(text: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut accumulator: u32 = 0;
    let mut bits = 0;
    for byte in text.bytes() {
        if byte == b'=' {
            break;
        }
        let value = ALPHABET.iter().position(|c| *c == byte)? as u32;
        accumulator = (accumulator << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((accumulator >> bits) as u8);
        }
    }
    Some(out)
}

/// Owner-only key file (the daemon runs as root).
fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write as _;
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .with_context(|| format!("writing {}", path.display()))?;
        file.write_all(contents)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents).with_context(|| format!("writing {}", path.display()))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_reuses_cert() {
        let dir = tempfile::tempdir().unwrap();
        let (cert, key) = ensure_cert(dir.path(), "r1").unwrap();
        assert!(cert.starts_with(dir.path().join("tls")));
        let pem = std::fs::read_to_string(&cert).unwrap();
        assert!(pem.contains("BEGIN CERTIFICATE"));
        assert!(std::fs::read_to_string(&key)
            .unwrap()
            .contains("PRIVATE KEY"));
        let before = std::fs::read(&cert).unwrap();
        let (cert2, _) = ensure_cert(dir.path(), "r1").unwrap();
        assert_eq!(cert, cert2);
        assert_eq!(before, std::fs::read(&cert2).unwrap());
        let print = current_fingerprint(dir.path()).unwrap();
        assert_eq!(print.len(), 32 * 3 - 1);
        assert_eq!(print, print.to_uppercase());
    }

    #[test]
    fn non_pem_is_refused() {
        assert!(fingerprint("not a certificate").is_err());
    }
}
