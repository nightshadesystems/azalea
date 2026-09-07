//! webd's view of the TLS material; the implementation lives in
//! `azalea_common::cert` so the installer can print the same fingerprint.

pub use azalea_common::cert::{current_fingerprint, ensure_cert};
