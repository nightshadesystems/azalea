//! Login verification and session tracking.
//!
//! Credentials are VyOS local users: /etc/shadow (yescrypt or
//! sha-crypt, pure Rust, no PAM), gated on `vyattacfg` (admin) or
//! `vyattaop` (operator) membership. The role rides in the session for
//! later RBAC.
//!
//! Sessions are in-memory bearer tokens in an HttpOnly cookie; a webd
//! restart signs everyone out.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use azalea_common::role::Role;

use crate::users::{AccountDb, ADMIN_GROUP, OPERATOR_GROUP};

/// Idle timeout, minutes.
pub const SESSION_TIMEOUT_MINS: u32 = 30;
/// Failed logins stall this long — brute force at 1.25 guesses/second.
const FAILURE_DELAY: Duration = Duration::from_millis(800);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    pub username: String,
    pub role: Role,
}

struct Session {
    info: SessionInfo,
    ttl: Duration,
    expires: Instant,
}

pub struct Sessions(Mutex<HashMap<String, Session>>);

impl Default for Sessions {
    fn default() -> Self {
        Self::new()
    }
}

impl Sessions {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn create(&self, info: SessionInfo, timeout_mins: u32) -> String {
        let token = random_token();
        let ttl = Duration::from_secs(u64::from(timeout_mins.max(1)) * 60);
        let mut sessions = self.lock();
        let now = Instant::now();
        sessions.retain(|_, s| s.expires > now);
        sessions.insert(
            token.clone(),
            Session {
                info,
                ttl,
                expires: now + ttl,
            },
        );
        token
    }

    /// Resolve a token, sliding the expiry forward.
    pub fn touch(&self, token: &str) -> Option<SessionInfo> {
        let mut sessions = self.lock();
        let now = Instant::now();
        match sessions.get_mut(token) {
            Some(session) if session.expires > now => {
                session.expires = now + session.ttl;
                Some(session.info.clone())
            }
            Some(_) => {
                sessions.remove(token);
                None
            }
            None => None,
        }
    }

    pub fn remove(&self, token: &str) {
        self.lock().remove(token);
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    // A broken OS RNG must not degrade into guessable tokens.
    getrandom::fill(&mut bytes).expect("OS random number generator failed");
    let mut out = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    out
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid username or password")]
    Invalid,
}

/// Verify a login. Failures pay `FAILURE_DELAY` and never say which
/// part was wrong. Success returns the role.
pub async fn verify(
    dev_auth: Option<&(String, String)>,
    username: &str,
    password: &str,
) -> Result<Role, AuthError> {
    let role = if let Some((user, _)) = dev_auth.filter(|(u, p)| u == username && p == password) {
        tracing::debug!(user, "dev-auth login");
        Some(Role::Admin)
    } else {
        // Hashing is CPU-bound (yescrypt is meant to be slow).
        let username = username.to_string();
        let password = password.to_string();
        tokio::task::spawn_blocking(move || system_check(&AccountDb::read(), &username, &password))
            .await
            .unwrap_or(None)
    };
    match role {
        Some(role) => Ok(role),
        None => {
            tokio::time::sleep(FAILURE_DELAY).await;
            Err(AuthError::Invalid)
        }
    }
}

/// Verify against the account database; the role comes from group
/// membership and accounts in neither group are refused.
pub fn system_check(db: &AccountDb, username: &str, password: &str) -> Option<Role> {
    if username.is_empty() || username.contains(':') {
        return None;
    }
    let role = if db.is_member(username, ADMIN_GROUP) {
        Role::Admin
    } else if db.is_member(username, OPERATOR_GROUP) {
        Role::Operator
    } else {
        tracing::info!(username, "login refused: not a VyOS login user");
        return None;
    };
    let hash = db.hash(username)?;
    azalea_common::passwd::verify(password, &hash).then_some(role)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn info(username: &str, role: Role) -> SessionInfo {
        SessionInfo {
            username: username.to_string(),
            role,
        }
    }

    #[test]
    fn sessions_round_trip() {
        let sessions = Sessions::new();
        let token = sessions.create(info("vyos", Role::Admin), 30);
        assert_eq!(token.len(), 64);
        let live = sessions.touch(&token).unwrap();
        assert_eq!(live.username, "vyos");
        assert_eq!(live.role, Role::Admin);
        sessions.remove(&token);
        assert_eq!(sessions.touch(&token), None);
        assert_eq!(sessions.touch("nonsense"), None);
        assert_ne!(
            sessions.create(info("a", Role::Admin), 30),
            sessions.create(info("a", Role::Admin), 30)
        );
    }

    #[tokio::test]
    async fn dev_auth_verifies() {
        let dev = ("admin".to_string(), "secret".to_string());
        assert_eq!(
            verify(Some(&dev), "admin", "secret").await.ok(),
            Some(Role::Admin)
        );
        assert!(verify(Some(&dev), "admin", "wrong").await.is_err());
        assert!(verify(Some(&dev), "other", "secret").await.is_err());
    }

    #[test]
    fn system_check_derives_roles_from_groups() {
        use sha_crypt_hash as hash;
        let db = AccountDb {
            group: "vyattacfg:x:1000:vyos\nvyattaop:x:1001:ro\n".into(),
            passwd: "vyos:x:1000:1000::/home/vyos:/bin/vbash\n\
                     ro:x:1003:1001::/home/ro:/bin/vbash\n\
                     svc:x:1004:1004::/home/svc:/bin/sh\n"
                .into(),
            shadow: format!(
                "vyos:{}:1::::::\nro:{}:1::::::\nsvc:{}:1::::::\n",
                hash("hunter22"),
                hash("readonly"),
                hash("svcpass1")
            ),
        };
        assert_eq!(system_check(&db, "vyos", "hunter22"), Some(Role::Admin));
        assert_eq!(system_check(&db, "vyos", "wrong"), None);
        assert_eq!(system_check(&db, "ro", "readonly"), Some(Role::Operator));
        // Right password, but not a VyOS login user.
        assert_eq!(system_check(&db, "svc", "svcpass1"), None);
        assert_eq!(system_check(&db, "", ""), None);
    }

    fn sha_crypt_hash(password: &str) -> String {
        use sha_crypt::PasswordHasher as _;
        sha_crypt::ShaCrypt::default()
            .hash_password(password.as_bytes())
            .unwrap()
            .as_str()
            .to_string()
    }
}
