//! Config mode: read one subtree, apply a batch of set/delete paths.
//!
//! The real backend drives VyOS's own `vyos.configsession.ConfigSession`
//! (what the VyOS HTTP API uses) from a short embedded Python program,
//! so session setup, `my_set`/`my_delete`, commit, save and teardown are
//! whatever the running release does. The request travels in an
//! environment variable as JSON: nothing is ever interpolated into a
//! shell or an argv.

use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("cannot run {command}: {source}")]
    Spawn {
        command: String,
        #[source]
        source: std::io::Error,
    },
    /// VyOS refused the change (validation or commit failure); the
    /// message is what the CLI would have printed.
    #[error("{0}")]
    Rejected(String),
    #[error("unexpected output from {command}: {reason}")]
    Parse { command: String, reason: String },
}

/// A batch applied as one commit. Paths are full config paths
/// (`["interfaces", "ethernet", "eth0", "description", "WAN"]`);
/// deletes run before sets so a replaced single value lands cleanly.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigBatch {
    pub set: Vec<Vec<String>>,
    pub delete: Vec<Vec<String>>,
}

#[async_trait::async_trait]
pub trait ConfigBackend: Send + Sync + 'static {
    /// The running configuration under `path`, as VyOS's JSON rendering:
    /// leaves are a string or a list of strings, valueless nodes `{}`.
    /// An unconfigured path is `{}`.
    async fn subtree(&self, path: &[String]) -> Result<serde_json::Value, ConfigError>;

    /// Apply, commit and save. Returns what commit and save printed.
    async fn apply(&self, batch: &ConfigBatch) -> Result<String, ConfigError>;
}

// ------------------------------------------------------------- real

pub const PYTHON: &str = "/usr/bin/python3";
/// Group VyOS expects config-mode work to run under.
pub const CONFIG_GROUP: &str = "vyattacfg";
const REQUEST_ENV: &str = "AZALEA_REQ";

/// `vyos.config.Config().get_config_dict(path)` for the running config.
/// `key_mangling=None` keeps hyphens; `get_first_key` drops the path
/// itself; multi-value leaves come back as lists.
const READ_PROGRAM: &str = r#"
import json, os, sys
try:
    from vyos.config import Config
    req = json.loads(os.environ["AZALEA_REQ"])
    d = Config().get_config_dict(req["path"], effective=True, key_mangling=None, get_first_key=True)
    print(json.dumps(d if isinstance(d, dict) else {}))
except Exception as e:
    print(json.dumps({"error": "%s: %s" % (type(e).__name__, e)}))
    sys.exit(1)
"#;

/// One config session: deletes, sets, commit, save. Any failure
/// discards; the session is torn down when the interpreter exits.
const APPLY_PROGRAM: &str = r#"
import json, os, sys
try:
    from vyos.configsession import ConfigSession, ConfigSessionError
    req = json.loads(os.environ["AZALEA_REQ"])
    session = ConfigSession(os.getpid())
    try:
        for path in req["delete"]:
            session.delete(path)
        for path in req["set"]:
            session.set(path)
        output = session.commit() or ""
        saved = session.save() or ""
    except ConfigSessionError as e:
        try:
            session.discard()
        except Exception:
            pass
        print(json.dumps({"error": str(e).strip()}))
        sys.exit(1)
    text = "\n".join(t.strip() for t in (output, saved) if t and t.strip())
    print(json.dumps({"output": text}))
except Exception as e:
    print(json.dumps({"error": "%s: %s" % (type(e).__name__, e)}))
    sys.exit(1)
"#;

/// Config editing on the router itself.
pub struct VyosConfig {
    /// One commit at a time; VyOS serialises them anyway and a second
    /// session mid-commit only produces confusing errors.
    lock: tokio::sync::Mutex<()>,
    /// `vyattacfg`, so the files a commit writes carry the group VyOS's
    /// own CLI expects. Only applied on unix.
    #[cfg_attr(not(unix), allow(dead_code))]
    gid: Option<u32>,
}

impl Default for VyosConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl VyosConfig {
    pub fn new() -> Self {
        let gid = std::fs::read_to_string("/etc/group")
            .ok()
            .and_then(|text| group_gid(&text, CONFIG_GROUP));
        if gid.is_none() {
            tracing::warn!(
                group = CONFIG_GROUP,
                "group not found; config sessions run as root's own group"
            );
        }
        Self {
            lock: tokio::sync::Mutex::new(()),
            gid,
        }
    }

    async fn run(
        &self,
        program: &str,
        request: &serde_json::Value,
    ) -> Result<serde_json::Value, ConfigError> {
        let command = "python3 (vyos config)".to_string();
        let mut cmd = tokio::process::Command::new(PYTHON);
        cmd.arg("-c")
            .arg(program)
            .env(REQUEST_ENV, request.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        if let Some(gid) = self.gid {
            cmd.gid(gid);
        }
        let output = cmd.output().await.map_err(|source| ConfigError::Spawn {
            command: command.clone(),
            source,
        })?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        parse_program_output(&command, output.status.success(), &stdout, &stderr)
    }
}

/// The programs print exactly one JSON object; a non-zero exit carries
/// `{"error": ...}`. Anything else (a missing interpreter, an import
/// error before the try) is reported with whatever was printed.
fn parse_program_output(
    command: &str,
    success: bool,
    stdout: &str,
    stderr: &str,
) -> Result<serde_json::Value, ConfigError> {
    let last_line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'));
    let value: Option<serde_json::Value> = last_line.and_then(|l| serde_json::from_str(l).ok());
    match value {
        Some(v) if v.get("error").is_some() => Err(ConfigError::Rejected(
            v["error"]
                .as_str()
                .unwrap_or("configuration change failed")
                .to_string(),
        )),
        Some(v) if success => Ok(v),
        _ => {
            let detail = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };
            Err(ConfigError::Parse {
                command: command.to_string(),
                reason: if detail.is_empty() {
                    "no JSON result".into()
                } else {
                    detail
                },
            })
        }
    }
}

/// The gid of `group` in `/etc/group` text.
pub fn group_gid(group_text: &str, group: &str) -> Option<u32> {
    group_text.lines().find_map(|line| {
        let mut fields = line.split(':');
        (fields.next()? == group).then_some(())?;
        let _password = fields.next()?;
        fields.next()?.trim().parse().ok()
    })
}

/// Whether the box has what the backend runs.
pub fn available() -> bool {
    Path::new(PYTHON).exists()
}

#[async_trait::async_trait]
impl ConfigBackend for VyosConfig {
    async fn subtree(&self, path: &[String]) -> Result<serde_json::Value, ConfigError> {
        let v = self
            .run(READ_PROGRAM, &serde_json::json!({ "path": path }))
            .await?;
        Ok(if v.is_object() {
            v
        } else {
            serde_json::json!({})
        })
    }

    async fn apply(&self, batch: &ConfigBatch) -> Result<String, ConfigError> {
        let _serialised = self.lock.lock().await;
        let v = self
            .run(
                APPLY_PROGRAM,
                &serde_json::json!({ "set": batch.set, "delete": batch.delete }),
            )
            .await?;
        Ok(v["output"].as_str().unwrap_or_default().to_string())
    }
}

// ------------------------------------------------------------- tree

/// In-memory edits on the JSON shape `vyos.config.get_config_dict`
/// returns (what the real backend reads), used by the mock and tested
/// here so the shape the UI diffs against is pinned: a single-valued
/// leaf is a string, a multi-valued leaf always a list, a valueless
/// node `{}`.
pub mod tree {
    use serde_json::{json, Map, Value};

    fn child<'a>(node: &'a mut Value, key: &str) -> &'a mut Value {
        if !node.is_object() {
            *node = Value::Object(Map::new());
        }
        node.as_object_mut()
            .expect("just made an object")
            .entry(key.to_string())
            .or_insert_with(|| json!({}))
    }

    /// What the last word of a `set` path is; VyOS knows from its
    /// schema, callers here say so.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Leaf {
        /// A valueless node (`disable`, `offload gro`).
        Node,
        /// A single-valued leaf: the new value replaces the old.
        Single,
        /// A multi-valued leaf: the new value joins the list.
        Multi,
    }

    /// `set <path>`.
    pub fn set(root: &mut Value, path: &[String], leaf: Leaf) {
        if path.is_empty() {
            return;
        }
        let (last, parents) = path.split_last().expect("non-empty");
        let mut node = root;
        for key in parents {
            node = child(node, key);
        }
        match leaf {
            Leaf::Node => {
                child(node, last);
            }
            Leaf::Single => *node = json!(last),
            Leaf::Multi => match node {
                Value::String(existing) if existing != last => {
                    *node = json!([existing.clone(), last]);
                }
                Value::Array(values) => {
                    if !values.iter().any(|v| v == last) {
                        values.push(json!(last));
                    }
                }
                Value::String(_) => {}
                _ => *node = json!([last]),
            },
        }
    }

    /// `delete <path>`: a value out of a leaf, or a whole node.
    pub fn delete(root: &mut Value, path: &[String]) {
        if path.is_empty() {
            return;
        }
        let (last, parents) = path.split_last().expect("non-empty");
        let mut node = &mut *root;
        for key in parents {
            match node.get_mut(key) {
                Some(next) => node = next,
                None => return,
            }
        }
        let emptied = match node {
            Value::String(existing) if existing == last => {
                *node = json!({});
                true
            }
            Value::Array(values) => {
                values.retain(|v| v != last);
                if values.is_empty() {
                    *node = json!({});
                    true
                } else {
                    false
                }
            }
            Value::Object(children) => {
                children.remove(last);
                false
            }
            _ => false,
        };
        // A leaf emptied of its values is gone; an emptied container
        // stays (`ip { }`), as VyOS prints it.
        if emptied {
            prune_empty_leaf(root, parents);
        }
    }

    fn prune_empty_leaf(root: &mut Value, path: &[String]) {
        if path.is_empty() {
            return;
        }
        let (last, parents) = path.split_last().expect("non-empty");
        let mut node = &mut *root;
        for key in parents {
            match node.get_mut(key) {
                Some(next) => node = next,
                None => return,
            }
        }
        if let Some(children) = node.as_object_mut() {
            if matches!(children.get(last), Some(Value::Object(m)) if m.is_empty()) {
                children.remove(last);
            }
        }
    }

    pub fn get<'a>(root: &'a Value, path: &[String]) -> Option<&'a Value> {
        path.iter().try_fold(root, |node, key| node.get(key))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::tree::{delete, get, set, Leaf};
    use super::*;
    use serde_json::json;

    fn p(s: &str) -> Vec<String> {
        s.split(' ').map(str::to_string).collect()
    }

    #[test]
    fn program_output_is_parsed() {
        assert_eq!(
            parse_program_output("x", true, "{\"output\": \"ok\"}\n", "").unwrap()["output"],
            "ok"
        );
        assert!(matches!(
            parse_program_output("x", false, "{\"error\": \"Commit failed\"}\n", ""),
            Err(ConfigError::Rejected(m)) if m == "Commit failed"
        ));
        // A stray warning line before the JSON is fine.
        assert!(parse_program_output("x", true, "WARNING: foo\n{\"output\": \"\"}\n", "").is_ok());
        assert!(matches!(
            parse_program_output("x", false, "", "Traceback ..."),
            Err(ConfigError::Parse { reason, .. }) if reason.starts_with("Traceback")
        ));
    }

    #[test]
    fn gid_lookup() {
        let text = "root:x:0:\nvyattacfg:x:102:vyos,azalea\nvyattaop:x:103:\n";
        assert_eq!(group_gid(text, "vyattacfg"), Some(102));
        assert_eq!(group_gid(text, "nope"), None);
    }

    #[test]
    fn tree_edits_follow_vyos_shape() {
        let mut t = json!({});
        set(&mut t, &p("description WAN"), Leaf::Single);
        set(&mut t, &p("address 10.0.0.1/24"), Leaf::Multi);
        set(&mut t, &p("address 10.0.0.2/24"), Leaf::Multi);
        set(&mut t, &p("disable"), Leaf::Node);
        set(&mut t, &p("offload gro"), Leaf::Node);
        set(&mut t, &p("ip arp-cache-timeout 30"), Leaf::Single);
        assert_eq!(
            t,
            json!({
                "description": "WAN",
                "address": ["10.0.0.1/24", "10.0.0.2/24"],
                "disable": {},
                "offload": { "gro": {} },
                "ip": { "arp-cache-timeout": "30" }
            })
        );
        // Replacing a single value.
        set(&mut t, &p("description LAN"), Leaf::Single);
        assert_eq!(t["description"], "LAN");
        // Deleting one of several values, then the last.
        delete(&mut t, &p("address 10.0.0.1/24"));
        assert_eq!(t["address"], json!(["10.0.0.2/24"]));
        delete(&mut t, &p("address 10.0.0.2/24"));
        assert!(get(&t, &p("address")).is_none());
        // Deleting a valueless node and a whole subtree.
        delete(&mut t, &p("disable"));
        delete(&mut t, &p("offload"));
        delete(&mut t, &p("ip arp-cache-timeout"));
        assert_eq!(t, json!({ "description": "LAN", "ip": {} }));
        delete(&mut t, &p("nope deeper"));
    }
}
