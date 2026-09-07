# Fixtures

Verbatim output the parsers in `src/parse.rs` are pinned to. One
directory per source:

- `linux/` — `/proc/uptime`, `/proc/loadavg`, `/proc/meminfo` from a
  Debian 12 kernel. Format is kernel-defined and identical on VyOS.
- `sagitta/`, `circinus/`, `rolling/` — `<script>.py show --raw` output
  of the real vyos-1x op-mode scripts (commits 64fba5e, b9b966a,
  b0fb31d), executed under Debian 12 in a container with `pyhumps`,
  `jinja2` and `requests` installed. Not a router: `storage` shows the
  container host disk, and `version` ran with a stub `hvinfo` and, for
  sagitta only, a `version.json` written from the template keys in
  `version.py` (circinus ran without one, so it lists the system fields
  only). Replace these with captures from a real box in M3; the shapes
  are what matter.

Notes the parsers rely on:

- `uptime.py` in rolling no longer emits `uptime_seconds`, and every
  train divides `load_average` by the core count. Azalea reads
  `/proc/uptime` and `/proc/loadavg` directly instead.
- `storage.py` returns the first ext4 filesystem only (`df -t ext4`),
  keys normalized by `vyos.opmode`: `filesystem`, `size`, `used`,
  `avail`, `use_percentage` (a string). Rolling prints a plain sentence
  when there is none — non-JSON means "no disks".
- `memory.py` values are bytes; `free` is `MemAvailable`.
