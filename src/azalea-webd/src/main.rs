//! azalea-webd — the Azalea daemon.
//!
//! Serves the exported Next.js UI (static files) and a JSON API from one
//! origin, entirely in Rust (axum + rustls). Router state comes from the
//! `azalea-vyos` op-mode backend; interface edits go through its config
//! backend (VyOS's own config session).
//!
//! On a router it listens on HTTPS only (`/config/azalea/azalea.toml`
//! decides bind/port, default 0.0.0.0:8443) with a self-signed
//! certificate generated on first start. `--dev-listen` and `--mock`
//! run the whole thing off-box.

mod api;
mod auth;
mod tls;
mod users;

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use axum_server::tls_rustls::RustlsConfig;
use azalea_common::settings::Settings;
use azalea_vyos::{ConfigBackend, MockOp, OpBackend, VyosConfig, VyosOp};
use clap::Parser;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

#[derive(Parser)]
#[command(name = "azalea-webd", version = azalea_common::VERSION, about)]
struct Args {
    /// Directory holding the exported web UI (Next.js static export).
    #[arg(long, default_value_os_t = default_assets_dir())]
    assets: PathBuf,

    /// State directory: azalea.toml, tls/.
    #[arg(long, default_value_os_t = default_state_dir())]
    state_dir: PathBuf,

    /// Bind address; overrides azalea.toml.
    #[arg(long)]
    bind: Option<IpAddr>,

    /// HTTPS port; overrides azalea.toml.
    #[arg(long)]
    https_port: Option<u16>,

    /// Plaintext port, only used with `--dev-listen http`.
    #[arg(long, default_value_t = 8080)]
    http_port: u16,

    /// Listener set for development: `http`, `https`, or `http,https`.
    /// Default is https only.
    #[arg(long)]
    dev_listen: Option<String>,

    /// `user:password` accepted instead of /etc/shadow — development
    /// hosts. Never set on a router.
    #[arg(long)]
    dev_auth: Option<String>,

    /// Serve a built-in mock router instead of running VyOS op-mode.
    #[arg(long)]
    mock: bool,
}

fn default_assets_dir() -> PathBuf {
    if cfg!(unix) {
        "/usr/share/azalea/web".into()
    } else {
        "web/out".into()
    }
}

fn default_state_dir() -> PathBuf {
    if cfg!(unix) {
        azalea_common::STATE_DIR.into()
    } else {
        ".azalea-state".into()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Listeners {
    http: bool,
    https: bool,
}

fn parse_dev_listen(spec: &str) -> Result<Listeners> {
    let mut listeners = Listeners {
        http: false,
        https: false,
    };
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match part {
            "http" => listeners.http = true,
            "https" => listeners.https = true,
            other => bail!("bad --dev-listen entry {other:?} (http or https)"),
        }
    }
    Ok(listeners)
}

#[tokio::main]
async fn main() -> Result<()> {
    azalea_common::logging::init("info");
    let args = Args::parse();

    // rustls needs a process-wide crypto provider before any TLS config
    // is built; ring is the pure-build choice (no cmake/nasm).
    if rustls::crypto::ring::default_provider()
        .install_default()
        .is_err()
    {
        warn!("rustls crypto provider was already installed");
    }

    let settings = Settings::load(&args.state_dir)?;
    let bind = args.bind.unwrap_or(settings.listen.bind);
    let https_port = args.https_port.unwrap_or(settings.listen.https_port);

    let listeners = match &args.dev_listen {
        Some(spec) => parse_dev_listen(spec)?,
        None => Listeners {
            http: false,
            https: true,
        },
    };
    if !listeners.http && !listeners.https {
        bail!("--dev-listen names no listener");
    }

    let dev_auth = match &args.dev_auth {
        Some(spec) => match spec.split_once(':') {
            Some((user, password)) => {
                warn!(user, "development credential enabled (--dev-auth)");
                Some((user.to_string(), password.to_string()))
            }
            None => bail!("--dev-auth wants user:password"),
        },
        None => None,
    };

    if !args.assets.join("index.html").exists() {
        warn!(assets = %args.assets.display(), "no web UI build found; only /api will respond");
    }

    let (op, config): (Arc<dyn OpBackend>, Arc<dyn ConfigBackend>) = if args.mock {
        warn!("serving the mock router (--mock)");
        let mock = Arc::new(MockOp::new());
        (mock.clone(), mock)
    } else {
        if !azalea_vyos::config::available() {
            warn!(
                python = azalea_vyos::config::PYTHON,
                "not found; configuration edits will fail"
            );
        }
        (Arc::new(VyosOp), Arc::new(VyosConfig::new()))
    };
    let hostname = op
        .system_info()
        .await
        .map(|s| s.hostname)
        .unwrap_or_else(|_| azalea_vyos::real::hostname());

    let state: api::SharedState = Arc::new(api::AppState {
        op,
        config,
        hostname: hostname.clone(),
        sessions: auth::Sessions::new(),
        dev_auth,
        // Secure cookies only when no plaintext listener exists.
        secure_cookie: listeners.https && !listeners.http,
        state_dir: args.state_dir.clone(),
    });

    let static_files = ServeDir::new(&args.assets)
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(args.assets.join("404.html")));
    let app = api::router(state).fallback_service(static_files);

    let mut servers = tokio::task::JoinSet::new();
    if listeners.http {
        let addr = SocketAddr::new(bind, args.http_port);
        info!(%addr, "serving http");
        let app = app.clone();
        servers.spawn(async move { axum_server::bind(addr).serve(app.into_make_service()).await });
    }
    if listeners.https {
        let (cert, key) = tls::ensure_cert(&args.state_dir, &hostname)?;
        let config = RustlsConfig::from_pem_file(&cert, &key)
            .await
            .with_context(|| format!("loading TLS material from {}", cert.display()))?;
        let addr = SocketAddr::new(bind, https_port);
        let fingerprint = tls::current_fingerprint(&args.state_dir).unwrap_or_default();
        info!(%addr, cert = %cert.display(), fingerprint, "serving https");
        let app = app.clone();
        servers.spawn(async move {
            axum_server::bind_rustls(addr, config)
                .serve(app.into_make_service())
                .await
        });
    }

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutting down");
            Ok(())
        }
        Some(finished) = servers.join_next() => {
            match finished {
                Ok(Ok(())) => Ok(()),
                Ok(Err(err)) => Err(err).context("server error"),
                Err(err) => Err(err).context("server task panicked"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dev_listen() {
        assert_eq!(
            parse_dev_listen("http").ok(),
            Some(Listeners {
                http: true,
                https: false
            })
        );
        assert_eq!(
            parse_dev_listen("http, https").ok(),
            Some(Listeners {
                http: true,
                https: true
            })
        );
        assert!(parse_dev_listen("ftp").is_err());
    }
}
