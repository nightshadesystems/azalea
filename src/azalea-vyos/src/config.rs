//! Config mode: trait only. No implementation and no UI this session.
//!
//! The eventual implementation wraps `/opt/vyatta/sbin/my_set`,
//! `my_delete`, `my_commit`, `my_discard` inside a session set up with
//! `my_cli_shell_api`.

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("configuration editing is not implemented")]
    NotImplemented,
    #[error("{0}")]
    Failed(String),
}

/// An open config session (the `my_cli_shell_api` environment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigSession {
    pub id: String,
}

#[async_trait::async_trait]
pub trait ConfigBackend: Send + Sync + 'static {
    async fn begin(&self) -> Result<ConfigSession, ConfigError>;
    async fn set(&self, session: &ConfigSession, path: &[&str]) -> Result<(), ConfigError>;
    async fn delete(&self, session: &ConfigSession, path: &[&str]) -> Result<(), ConfigError>;
    async fn commit(
        &self,
        session: &ConfigSession,
        comment: Option<&str>,
    ) -> Result<(), ConfigError>;
    async fn discard(&self, session: &ConfigSession) -> Result<(), ConfigError>;
}

/// The stub in use until config editing lands.
pub struct NoConfig;

#[async_trait::async_trait]
impl ConfigBackend for NoConfig {
    async fn begin(&self) -> Result<ConfigSession, ConfigError> {
        Err(ConfigError::NotImplemented)
    }
    async fn set(&self, _: &ConfigSession, _: &[&str]) -> Result<(), ConfigError> {
        Err(ConfigError::NotImplemented)
    }
    async fn delete(&self, _: &ConfigSession, _: &[&str]) -> Result<(), ConfigError> {
        Err(ConfigError::NotImplemented)
    }
    async fn commit(&self, _: &ConfigSession, _: Option<&str>) -> Result<(), ConfigError> {
        Err(ConfigError::NotImplemented)
    }
    async fn discard(&self, _: &ConfigSession) -> Result<(), ConfigError> {
        Err(ConfigError::NotImplemented)
    }
}
