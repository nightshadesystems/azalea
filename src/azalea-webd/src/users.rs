//! The router's account database, read from /etc/passwd, /etc/group
//! and /etc/shadow. VyOS puts every `system login user` in
//! `vyattacfg` (admin); `vyattaop` is the legacy operator group.

/// Group that marks a VyOS administrator.
pub const ADMIN_GROUP: &str = "vyattacfg";
/// Group that marks a read-only operator (VyOS 1.3 and earlier).
pub const OPERATOR_GROUP: &str = "vyattaop";

/// Members of `group`: the member list plus every passwd account whose
/// primary gid matches.
pub fn group_members(group_text: &str, passwd_text: &str, group: &str) -> Vec<String> {
    let mut members: Vec<String> = Vec::new();
    let mut gid: Option<String> = None;
    for line in group_text.lines() {
        let mut fields = line.split(':');
        if fields.next() != Some(group) {
            continue;
        }
        let _password = fields.next();
        gid = fields.next().map(|g| g.trim().to_string());
        if let Some(list) = fields.next() {
            members.extend(
                list.split(',')
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .map(str::to_string),
            );
        }
        break;
    }
    if let Some(gid) = gid {
        for line in passwd_text.lines() {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() > 3
                && fields[3].trim() == gid
                && !members.iter().any(|m| m == fields[0])
            {
                members.push(fields[0].to_string());
            }
        }
    }
    members
}

/// The password field of `username` in shadow text.
pub fn shadow_hash(shadow_text: &str, username: &str) -> Option<String> {
    shadow_text.lines().find_map(|line| {
        let mut fields = line.split(':');
        (fields.next()? == username).then(|| fields.next().unwrap_or("").to_string())
    })
}

/// A snapshot of the three files. Missing files read as empty: on a
/// development host that simply means nobody can log in via shadow.
pub struct AccountDb {
    pub group: String,
    pub passwd: String,
    pub shadow: String,
}

impl AccountDb {
    pub fn read() -> Self {
        let read = |path: &str| std::fs::read_to_string(path).unwrap_or_default();
        Self {
            group: read("/etc/group"),
            passwd: read("/etc/passwd"),
            shadow: read("/etc/shadow"),
        }
    }

    pub fn is_member(&self, username: &str, group: &str) -> bool {
        group_members(&self.group, &self.passwd, group)
            .iter()
            .any(|m| m == username)
    }

    pub fn hash(&self, username: &str) -> Option<String> {
        shadow_hash(&self.shadow, username)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GROUP: &str = "sudo:x:27:vyos\nvyattacfg:x:1000:vyos,noc\nvyattaop:x:1001:\n";
    const PASSWD: &str = "root:x:0:0:root:/root:/bin/bash\n\
        vyos:x:1000:1000::/home/vyos:/bin/vbash\n\
        noc:x:1001:1001::/home/noc:/bin/vbash\n\
        svc:x:1002:1000::/home/svc:/usr/sbin/nologin\n\
        ro:x:1003:1001::/home/ro:/bin/vbash\n";
    const SHADOW: &str = "vyos:$6$abc$def:19000:0:99999:7:::\nnoc:!:19000:0:99999:7:::\n";

    #[test]
    fn members_include_primary_group() {
        let db = AccountDb {
            group: GROUP.into(),
            passwd: PASSWD.into(),
            shadow: SHADOW.into(),
        };
        assert_eq!(
            group_members(GROUP, PASSWD, ADMIN_GROUP),
            ["vyos", "noc", "svc"]
        );
        assert!(db.is_member("ro", OPERATOR_GROUP));
        assert!(!db.is_member("root", ADMIN_GROUP));
        assert_eq!(db.hash("vyos").as_deref(), Some("$6$abc$def"));
        assert_eq!(db.hash("noc").as_deref(), Some("!"));
        assert_eq!(db.hash("nobody"), None);
    }
}
