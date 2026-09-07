//! Verification against `/etc/shadow` crypt strings.

/// Verify `plaintext` against a stored crypt string. Locked (`!`, `*`)
/// and empty fields never match; unknown schemes never match.
pub fn verify(plaintext: &str, hash: &str) -> bool {
    if hash.is_empty() || hash.starts_with('!') || hash.starts_with('*') {
        return false;
    }
    if hash.starts_with("$y$") {
        use yescrypt::PasswordVerifier as _;
        yescrypt::Yescrypt::default()
            .verify_password(plaintext.as_bytes(), hash)
            .is_ok()
    } else if hash.starts_with("$6$") || hash.starts_with("$5$") {
        use sha_crypt::PasswordVerifier as _;
        sha_crypt::ShaCrypt::default()
            .verify_password(plaintext.as_bytes(), hash)
            .is_ok()
    } else {
        false
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn yescrypt_hashes_verify() {
        use yescrypt::PasswordHasher as _;
        let hash = yescrypt::Yescrypt::default()
            .hash_password(b"password")
            .unwrap();
        let hash = hash.as_str();
        assert!(hash.starts_with("$y$"));
        assert!(verify("password", hash));
        assert!(!verify("not-the-password", hash));
    }

    #[test]
    fn sha512_crypt_hashes_verify() {
        use sha_crypt::PasswordHasher as _;
        let hash = sha_crypt::ShaCrypt::default()
            .hash_password(b"password")
            .unwrap();
        let hash = hash.as_str();
        assert!(hash.starts_with("$6$") || hash.starts_with("$5$"));
        assert!(verify("password", hash));
        assert!(!verify("not-the-password", hash));
    }

    #[test]
    fn locked_hashes_never_verify() {
        assert!(!verify("anything", ""));
        assert!(!verify("anything", "!"));
        assert!(!verify("anything", "*"));
        assert!(!verify("anything", "$1$md5$hash"));
    }
}
