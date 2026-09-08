//! Login roles. `admin` may change configuration; `operator` may look.

/// The refusal an operator sees on a privileged endpoint.
pub const PERMISSION_DENIED: &str = "permission denied (operator role)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Role {
    Admin,
    #[default]
    Operator,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Operator => "operator",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "admin" => Some(Role::Admin),
            "operator" => Some(Role::Operator),
            _ => None,
        }
    }

    pub fn is_admin(self) -> bool {
        matches!(self, Role::Admin)
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// webd API paths an operator may not POST to; webd's router test
/// walks its POST routes against it.
pub const ADMIN_WEB_PATHS: &[&str] = &[
    "/api/config/interfaces",
    "/api/config/nat",
    "/api/config/routing",
];

pub fn web_requires_admin(path: &str) -> bool {
    ADMIN_WEB_PATHS.contains(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_round_trip() {
        assert_eq!(Role::parse("admin"), Some(Role::Admin));
        assert_eq!(Role::parse("operator"), Some(Role::Operator));
        assert_eq!(Role::parse("Admin"), None);
        assert_eq!(Role::default(), Role::Operator);
        assert!(Role::Admin.is_admin());
        assert_eq!(Role::Admin.to_string(), "admin");
        assert!(!web_requires_admin("/api/interfaces"));
        assert!(web_requires_admin("/api/config/interfaces"));
    }
}
