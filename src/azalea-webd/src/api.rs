//! The JSON API the web UI talks to. Every state endpoint asks the op
//! backend per request; webd holds no cache to go stale. Configuration
//! edits go to the config backend one interface subtree at a time.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Path, State};
use axum::http::{header, request::Parts, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, MethodRouter};
use axum::{Json, Router};
use azalea_common::types::{
    ConfigApplied, InterfaceConfig, InterfaceConfigChange, InterfaceKind, InterfaceSummary,
    StreamFrame,
};
use azalea_vyos::{ConfigBackend, ConfigBatch, ConfigError, OpBackend, OpError};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{self, Sessions};

pub struct AppState {
    pub op: Arc<dyn OpBackend>,
    pub config: Arc<dyn ConfigBackend>,
    /// Read once at start; shown on the login page before sign-in.
    pub hostname: String,
    pub sessions: Sessions,
    pub dev_auth: Option<(String, String)>,
    pub secure_cookie: bool,
    pub state_dir: PathBuf,
}

pub type SharedState = Arc<AppState>;

const SESSION_COOKIE: &str = "azalea_session";

/// Every read-only endpoint, as a table so the router and the
/// role-gate tests read the same list.
fn get_routes() -> Vec<(&'static str, MethodRouter<SharedState>)> {
    vec![
        ("/api/identity", get(identity)),
        ("/api/session", get(session)),
        ("/api/system", get(system)),
        ("/api/system/status", get(system_status)),
        ("/api/system/tls", get(system_tls)),
        ("/api/interfaces", get(interfaces)),
        ("/api/interfaces/{name}", get(interface_detail)),
        ("/api/config/interfaces/{name}", get(interface_config)),
        ("/api/stream", get(stream)),
    ]
}

/// Endpoints that change something. Everything here except the login
/// paths must appear in `azalea_common::role::ADMIN_WEB_PATHS`.
fn post_routes() -> Vec<(&'static str, MethodRouter<SharedState>)> {
    vec![
        ("/api/login", post(login)),
        ("/api/logout", post(logout)),
        ("/api/config/interfaces", post(interface_config_change)),
    ]
}

#[cfg_attr(not(test), allow(dead_code))]
pub const PUBLIC_POSTS: &[&str] = &["/api/login", "/api/logout"];

pub fn router(state: SharedState) -> Router {
    let mut api = Router::new();
    for (path, handler) in get_routes().into_iter().chain(post_routes()) {
        api = api.route(path, handler);
    }
    api.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        role_gate,
    ))
    .with_state(state)
}

// ---------------------------------------------------------------- errors

/// Backend trouble surfaces as 502 with the cause; a missing interface
/// as 404; a change VyOS refused, or one webd will not pass on, as 400
/// with the CLI's message.
#[derive(Debug)]
enum ApiError {
    Op(OpError),
    Config(ConfigError),
    BadRequest(String),
}

impl From<OpError> for ApiError {
    fn from(err: OpError) -> Self {
        Self::Op(err)
    }
}

impl From<ConfigError> for ApiError {
    fn from(err: ConfigError) -> Self {
        Self::Config(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Op(OpError::NoSuchInterface(_)) => StatusCode::NOT_FOUND,
            Self::Op(_) => StatusCode::BAD_GATEWAY,
            Self::Config(ConfigError::Rejected(_)) => StatusCode::BAD_REQUEST,
            Self::Config(_) => StatusCode::BAD_GATEWAY,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
        };
        let message = self.to_string();
        tracing::warn!(err = %message, "api request failed");
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Op(e) => e.fmt(f),
            Self::Config(e) => e.fmt(f),
            Self::BadRequest(m) => f.write_str(m),
        }
    }
}

// ------------------------------------------------------------ auth layer

fn cookie_token(headers: &header::HeaderMap) -> Option<String> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    cookies.split(';').find_map(|pair| {
        let (name, value) = pair.trim().split_once('=')?;
        (name == SESSION_COOKIE).then(|| value.to_string())
    })
}

/// Extractor gating every state endpoint on a live session.
struct Operator(auth::SessionInfo);

impl FromRequestParts<SharedState> for Operator {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SharedState,
    ) -> Result<Self, Self::Rejection> {
        cookie_token(&parts.headers)
            .and_then(|token| state.sessions.touch(&token))
            .map(Operator)
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "not signed in" })),
                )
                    .into_response()
            })
    }
}

/// Path-based role gate in front of every API route; the list is
/// `azalea_common::role::ADMIN_WEB_PATHS`.
async fn role_gate(
    State(state): State<SharedState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path();
    if !azalea_common::role::web_requires_admin(path) {
        return next.run(request).await;
    }
    let role = cookie_token(request.headers())
        .and_then(|token| state.sessions.touch(&token))
        .map(|session| session.role);
    match role {
        Some(role) if !role.is_admin() => (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": azalea_common::role::PERMISSION_DENIED })),
        )
            .into_response(),
        _ => next.run(request).await,
    }
}

// ----------------------------------------------------------------- login

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login(State(state): State<SharedState>, Json(req): Json<LoginRequest>) -> Response {
    match auth::verify(state.dev_auth.as_ref(), &req.username, &req.password).await {
        Ok(role) => {
            let token = state.sessions.create(
                auth::SessionInfo {
                    username: req.username.clone(),
                    role,
                },
                auth::SESSION_TIMEOUT_MINS,
            );
            tracing::info!(username = %req.username, %role, "web login");
            (
                [(header::SET_COOKIE, session_cookie(&state, &token, false))],
                Json(json!({ "username": req.username, "role": role.as_str(), "admin": role.is_admin() })),
            )
                .into_response()
        }
        Err(err) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

fn session_cookie(state: &AppState, token: &str, clear: bool) -> String {
    let mut cookie = format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax");
    if clear {
        cookie.push_str("; Max-Age=0");
    }
    if state.secure_cookie {
        cookie.push_str("; Secure");
    }
    cookie
}

async fn logout(State(state): State<SharedState>, parts: Parts) -> Response {
    if let Some(token) = cookie_token(&parts.headers) {
        state.sessions.remove(&token);
    }
    (
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, session_cookie(&state, "", true))],
    )
        .into_response()
}

/// The one unauthenticated read: what the login page shows. The
/// hostname is already in the certificate's CN.
async fn identity(State(state): State<SharedState>) -> Response {
    Json(json!({
        "hostname": state.hostname,
        "azalea_version": azalea_common::VERSION,
    }))
    .into_response()
}

async fn session(op: Operator) -> Response {
    Json(json!({
        "username": op.0.username,
        "role": op.0.role.as_str(),
        "admin": op.0.role.is_admin(),
    }))
    .into_response()
}

// ----------------------------------------------------------------- state

async fn system(_op: Operator, State(state): State<SharedState>) -> Result<Response, ApiError> {
    Ok(Json(state.op.system_info().await?).into_response())
}

async fn system_status(
    _op: Operator,
    State(state): State<SharedState>,
) -> Result<Response, ApiError> {
    let status = state.op.system_status().await?;
    let interfaces = state.op.interfaces().await?;
    Ok(Json(json!({
        "uptime_secs": status.uptime_secs,
        "load": status.load,
        "memory": status.memory,
        "disks": status.disks,
        "interfaces": InterfaceSummary::of(&interfaces),
    }))
    .into_response())
}

/// The certificate fingerprint, so the UI can show what the browser
/// should be warning about.
async fn system_tls(_op: Operator, State(state): State<SharedState>) -> Response {
    Json(json!({ "fingerprint": crate::tls::current_fingerprint(&state.state_dir) }))
        .into_response()
}

async fn interfaces(_op: Operator, State(state): State<SharedState>) -> Result<Response, ApiError> {
    Ok(Json(state.op.interfaces().await?).into_response())
}

async fn interface_detail(
    _op: Operator,
    State(state): State<SharedState>,
    Path(name): Path<String>,
) -> Result<Response, ApiError> {
    if !valid_interface_name(&name) {
        return Err(OpError::NoSuchInterface(name).into());
    }
    Ok(Json(state.op.interface_detail(&name).await?).into_response())
}

// ---------------------------------------------------------------- config

/// The interface's config path, or why it cannot be edited here.
fn editable_path(name: &str) -> Result<Vec<String>, ApiError> {
    if !valid_interface_name(name) {
        return Err(OpError::NoSuchInterface(name.to_string()).into());
    }
    InterfaceKind::config_path(name).ok_or_else(|| {
        ApiError::BadRequest(format!("{name}: not an interface Azalea can configure"))
    })
}

async fn interface_config(
    _op: Operator,
    State(state): State<SharedState>,
    Path(name): Path<String>,
) -> Result<Response, ApiError> {
    let path = editable_path(&name)?;
    let config = state.config.subtree(&path).await?;
    Ok(Json(InterfaceConfig {
        kind: InterfaceKind::from_name(&name),
        name,
        path,
        config,
    })
    .into_response())
}

/// Longest batch, path and word webd will pass on; VyOS validates the rest.
const MAX_CHANGES: usize = 200;
const MAX_PATH_WORDS: usize = 16;
const MAX_WORD_LEN: usize = 256;

/// The batch VyOS sees: every relative path prefixed with the
/// interface's own, so nothing outside that subtree is reachable. An
/// empty relative path is the interface node itself: `set` creates a
/// VLAN, `delete` removes one.
fn scoped_batch(change: &InterfaceConfigChange) -> Result<ConfigBatch, ApiError> {
    let base = editable_path(&change.interface)?;
    if change.set.len() + change.delete.len() > MAX_CHANGES {
        return Err(ApiError::BadRequest(format!(
            "too many changes in one request (max {MAX_CHANGES})"
        )));
    }
    if change.set.is_empty() && change.delete.is_empty() {
        return Err(ApiError::BadRequest("nothing to change".into()));
    }
    let scope = |paths: &[Vec<String>]| -> Result<Vec<Vec<String>>, ApiError> {
        paths
            .iter()
            .map(|rel| {
                if rel.len() > MAX_PATH_WORDS {
                    return Err(ApiError::BadRequest(format!(
                        "bad config path (at most {MAX_PATH_WORDS} words): {rel:?}"
                    )));
                }
                for word in rel {
                    if word.is_empty()
                        || word.len() > MAX_WORD_LEN
                        || word.chars().any(char::is_control)
                    {
                        return Err(ApiError::BadRequest(format!("bad config word in {rel:?}")));
                    }
                }
                Ok(base.iter().cloned().chain(rel.iter().cloned()).collect())
            })
            .collect()
    };
    Ok(ConfigBatch {
        set: scope(&change.set)?,
        delete: scope(&change.delete)?,
    })
}

async fn interface_config_change(
    op: Operator,
    State(state): State<SharedState>,
    Json(change): Json<InterfaceConfigChange>,
) -> Result<Response, ApiError> {
    let batch = scoped_batch(&change)?;
    tracing::info!(
        username = %op.0.username,
        interface = %change.interface,
        set = batch.set.len(),
        delete = batch.delete.len(),
        "config change"
    );
    let output = state.config.apply(&batch).await?;
    Ok(Json(ConfigApplied { output }).into_response())
}

// ---------------------------------------------------------------- stream

/// Counter samples every `STREAM_INTERVAL` while the socket is open.
const STREAM_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// `GET /api/stream` — WebSocket of `StreamFrame`s. The session cookie
/// rides on the upgrade request, so the `Operator` extractor gates it
/// like any other read.
async fn stream(_op: Operator, State(state): State<SharedState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| stream_loop(socket, state))
}

async fn stream_loop(mut socket: WebSocket, state: SharedState) {
    let mut ticker = tokio::time::interval(STREAM_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let samples = match state.op.interface_counters().await {
                    Ok(samples) => samples,
                    Err(err) => {
                        tracing::warn!(%err, "counter sample failed; closing stream");
                        break;
                    }
                };
                let frame = StreamFrame { t: unix_millis(), samples };
                let Ok(text) = serde_json::to_string(&frame) else { break };
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                // The client never sends anything meaningful; None or
                // Close ends the loop, pings are answered by axum.
                match incoming {
                    None | Some(Ok(Message::Close(_))) | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Interface names reach an argv; keep them to what VyOS itself allows.
fn valid_interface_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 15
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn every_post_route_is_gated() {
        let ungated: Vec<&str> = post_routes()
            .into_iter()
            .map(|(path, _)| path)
            .filter(|path| {
                !azalea_common::role::web_requires_admin(path) && !PUBLIC_POSTS.contains(path)
            })
            .collect();
        assert!(ungated.is_empty(), "ungated POST endpoints: {ungated:?}");
    }

    #[test]
    fn the_role_table_names_no_phantom_endpoints() {
        let served: Vec<&str> = get_routes()
            .into_iter()
            .chain(post_routes())
            .map(|(path, _)| path)
            .collect();
        let phantom: Vec<&&str> = azalea_common::role::ADMIN_WEB_PATHS
            .iter()
            .filter(|path| !served.contains(*path))
            .collect();
        assert!(phantom.is_empty(), "phantom entries: {phantom:?}");
    }

    #[test]
    fn no_read_only_route_is_gated() {
        let gated: Vec<&str> = get_routes()
            .into_iter()
            .map(|(path, _)| path)
            .filter(|path| azalea_common::role::web_requires_admin(path))
            .collect();
        assert!(
            gated.is_empty(),
            "read-only routes must stay open: {gated:?}"
        );
    }

    #[test]
    fn changes_are_scoped_to_the_interface() {
        let w = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
        let change = InterfaceConfigChange {
            interface: "eth1.100".into(),
            set: vec![w("description Guests"), w("address 10.0.0.1/24")],
            delete: vec![w("disable")],
        };
        let batch = scoped_batch(&change).unwrap();
        assert_eq!(
            batch.set[0].join(" "),
            "interfaces ethernet eth1 vif 100 description Guests"
        );
        assert_eq!(
            batch.delete[0].join(" "),
            "interfaces ethernet eth1 vif 100 disable"
        );

        let refused = |change: InterfaceConfigChange| {
            matches!(scoped_batch(&change), Err(ApiError::BadRequest(_)))
        };
        assert!(refused(InterfaceConfigChange {
            interface: "eth0".into(),
            ..Default::default()
        }));
        assert!(refused(InterfaceConfigChange {
            interface: "gre0".into(),
            set: vec![w("description x")],
            ..Default::default()
        }));
        assert!(refused(InterfaceConfigChange {
            interface: "eth0".into(),
            set: vec![vec!["description".into(), "a\nb".into()]],
            ..Default::default()
        }));
        // The bare node: create or remove a VLAN.
        let created = scoped_batch(&InterfaceConfigChange {
            interface: "eth0.300".into(),
            set: vec![vec![]],
            ..Default::default()
        })
        .unwrap();
        assert_eq!(created.set[0].join(" "), "interfaces ethernet eth0 vif 300");
        assert!(matches!(
            scoped_batch(&InterfaceConfigChange {
                interface: "eth0;x".into(),
                set: vec![w("description x")],
                ..Default::default()
            }),
            Err(ApiError::Op(OpError::NoSuchInterface(_)))
        ));
    }

    #[test]
    fn interface_names_are_validated() {
        assert!(valid_interface_name("eth0"));
        assert!(valid_interface_name("eth0.100"));
        assert!(valid_interface_name("wg0"));
        assert!(!valid_interface_name(""));
        assert!(!valid_interface_name("eth0; rm -rf /"));
        assert!(!valid_interface_name("../etc"));
    }
}
