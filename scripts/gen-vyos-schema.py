#!/usr/bin/env python3
"""Generate Azalea's configuration schema from vyos-1x.

VyOS describes its CLI in interface-definitions/*.xml.in (with #include
of interface-definitions/include/*.xml.i). This turns the definitions
Azalea edits - the nineteen `interfaces <type>` trees, the NAT trees
(`nat`, `nat cgnat`, `nat64`, `nat66`) and every `protocols <name>`
tree - into:

  web/lib/vyos-interfaces.generated.ts   full trees: help, values, ranges,
  web/lib/vyos-protocols.generated.ts    regexes, defaults - drive the
                                         schema-driven editors
  src/azalea-vyos/schema/interfaces.json node kinds only (node / tag /
                                         leaf, multi, valueless) - the
                                         mock router's set/delete rules

Usage:  python3 scripts/gen-vyos-schema.py /path/to/vyos-1x [/path/to/rolling]
The checkout's branch and commit are recorded in the outputs. The
optional second checkout supplies the few definitions (FALLBACK_FILES)
the 1.5 branch lacks but the 1.5 documentation lists; without it those
protocols are left out.
"""

import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = [
    "bonding", "bridge", "dummy", "ethernet", "geneve", "l2tpv3", "loopback",
    "macsec", "openvpn", "wireguard", "pppoe", "pseudo-ethernet", "sstpc",
    "tunnel", "virtual-ethernet", "vti", "vxlan", "wireless", "wwan",
]
# Top-level config node -> the definition files that contribute to it.
# Files for the same root are merged the way VyOS merges them.
PROTOCOLS = [
    "babel", "bfd", "bgp", "eigrp", "failover", "igmp-proxy", "isis", "mpls",
    "nhrp", "openfabric", "ospf", "ospfv3", "pim", "pim6", "rip", "ripng",
    "rpki", "segment-routing", "static", "static_arp", "static_multicast",
    "static_neighbor-proxy", "traffic_engineering",
]
ROOTS = {
    "interfaces": [f"interfaces_{t}.xml.in" for t in TYPES],
    "nat": ["nat.xml.in", "nat_cgnat.xml.in"],
    "nat64": ["nat64.xml.in"],
    "nat66": ["nat66.xml.in"],
    "protocols": [f"protocols_{p}.xml.in" for p in PROTOCOLS],
}
# Listed in the 1.5 documentation but only present in the rolling branch;
# taken from the second checkout when one is given.
FALLBACK_FILES = {"protocols_openfabric.xml.in", "protocols_traffic_engineering.xml.in"}
INCLUDE_RE = re.compile(r"^\s*#include\s+<(.+?)>\s*$", re.M)


def resolve(text: str, defs: Path, depth: int = 0) -> str:
    """Splice #include lines in, recursively."""
    if depth > 20:
        raise RuntimeError("include nesting too deep")

    def repl(m: re.Match) -> str:
        path = defs / m.group(1)
        return resolve(path.read_text(encoding="utf-8"), defs, depth + 1)

    return INCLUDE_RE.sub(repl, text)


def text_of(el, tag: str):
    node = el.find(tag)
    return node.text.strip() if node is not None and node.text else None


def parse_node(el, name: str) -> dict:
    kind = {"node": "node", "tagNode": "tag", "leafNode": "leaf"}[el.tag]
    out = {"name": name, "kind": kind}
    props = el.find("properties")
    if props is not None:
        help_ = text_of(props, "help")
        if help_:
            out["help"] = help_
        if props.find("valueless") is not None:
            out["valueless"] = True
        if props.find("multi") is not None:
            out["multi"] = True
        formats = []
        for vh in props.findall("valueHelp"):
            fmt = text_of(vh, "format")
            if fmt:
                formats.append({"format": fmt, "help": text_of(vh, "description") or ""})
        ch = props.find("completionHelp")
        values = []
        if ch is not None:
            for lst in ch.findall("list"):
                if lst.text:
                    values.extend(lst.text.split())
            path = text_of(ch, "path")
            if path:
                out["completionPath"] = path
        if values:
            by_fmt = {f["format"]: f["help"] for f in formats}
            out["values"] = [{"value": v, "help": by_fmt.get(v, "")} for v in values]
            formats = [f for f in formats if f["format"] not in values]
        if formats:
            out["formats"] = formats
        con = props.find("constraint")
        if con is not None:
            regexes = [r.text.strip() for r in con.findall("regex") if r.text]
            if regexes:
                out["regex"] = regexes
            validators = []
            ranges = []
            for v in con.findall("validator"):
                vname = v.get("name")
                arg = v.get("argument") or ""
                validators.append({"name": vname, "arg": arg} if arg else {"name": vname})
                if vname == "numeric":
                    # `--range 0-0 --range 34-177`: any range accepts.
                    ranges.extend([int(a), int(b)] for a, b in re.findall(r"--range\s+(-?\d+)-(-?\d+)", arg))
            if validators:
                out["validators"] = validators
            if ranges:
                out["ranges"] = ranges
        err = text_of(props, "constraintErrorMessage")
        if err:
            out["error"] = err
    default = text_of(el, "defaultValue")
    if default is not None:
        out["default"] = default
    children_el = el.find("children")
    if children_el is not None:
        out["children"] = merge_children(children_el)
    return out


def merge_into(a: dict, b: dict) -> dict:
    """VyOS merges same-named siblings: later properties win, children union."""
    for k, v in b.items():
        if k == "children":
            existing = {c["name"]: c for c in a.get("children", [])}
            for c in v:
                if c["name"] in existing:
                    merge_into(existing[c["name"]], c)
                else:
                    a.setdefault("children", []).append(c)
                    existing[c["name"]] = c
        else:
            a[k] = v
    return a


def merge_children(children_el) -> list:
    out: list = []
    index: dict = {}
    for child in children_el:
        if child.tag not in ("node", "tagNode", "leafNode"):
            continue
        name = child.get("name")
        parsed = parse_node(child, name)
        if name in index:
            merge_into(index[name], parsed)
        else:
            out.append(parsed)
            index[name] = parsed
    return out


def kinds_only(node: dict) -> dict:
    out = {"k": node["kind"][0]}
    if node.get("multi"):
        out["m"] = 1
    if node.get("valueless"):
        out["v"] = 1
    if node.get("children"):
        out["c"] = {c["name"]: kinds_only(c) for c in node["children"]}
    return out


def count(node: dict) -> int:
    return 1 + sum(count(c) for c in node.get("children", []))


def describe(src: Path) -> str:
    git = lambda *a: subprocess.check_output(["git", "-C", str(src), *a], text=True).strip()
    return f"{git('rev-parse', '--abbrev-ref', 'HEAD')} {git('rev-parse', '--short=7', 'HEAD')} ({git('log', '-1', '--format=%cs')})"


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    defs = src / "interface-definitions"
    origin = describe(src)
    fallback = Path(sys.argv[2]) / "interface-definitions" if len(sys.argv) == 3 else None
    if fallback:
        origin += f"; {', '.join(sorted(FALLBACK_FILES))} from {describe(Path(sys.argv[2]))}"

    roots: dict = {}
    for root_name, files in ROOTS.items():
        merged = {"name": root_name, "kind": "node", "children": []}
        for file in files:
            where = defs
            if file in FALLBACK_FILES and not (defs / file).exists():
                if fallback is None or not (fallback / file).exists():
                    print(f"{file}: not in this checkout, skipped (give a rolling checkout to include it)", file=sys.stderr)
                    continue
                where = fallback
            text = resolve((where / file).read_text(encoding="utf-8"), where)
            xml = ET.fromstring(text)
            top = xml.find(f"./node[@name='{root_name}']")
            if top is None:
                sys.exit(f"{file}: no top-level node {root_name}")
            merge_into(merged, parse_node(top, root_name))
        roots[root_name] = merged
        for c in merged["children"]:
            print(f"{root_name} {c['name']:18} {count(c):4} nodes", file=sys.stderr)

    interfaces = {c["name"]: c for c in roots["interfaces"]["children"]}
    for t in TYPES:
        if t not in interfaces:
            sys.exit(f"{t}: no tagNode in definition")

    head = (
        "// GENERATED by scripts/gen-vyos-schema.py - do not edit.\n"
        f"// Source: vyos-1x {origin}, interface-definitions/*.xml.in\n"
        "import type { SchemaNode } from './vyos-schema';\n\n"
    )
    dump = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    ts = ROOT / "web" / "lib" / "vyos-interfaces.generated.ts"
    ts.write_text(
        head
        + f"export const VYOS_SOURCE = {json.dumps(origin)};\n\n"
        "/** `interfaces <type>` nodes, by type word. */\n"
        "export const VYOS_INTERFACES: Record<string, SchemaNode> = "
        + dump(interfaces)
        + ";\n\n"
        "/** Other top-level config nodes Azalea edits: nat (with cgnat), nat64, nat66. */\n"
        "export const VYOS_ROOTS: Record<string, SchemaNode> = "
        + dump({k: v for k, v in roots.items() if k not in ("interfaces", "protocols")})
        + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    ts2 = ROOT / "web" / "lib" / "vyos-protocols.generated.ts"
    ts2.write_text(
        head
        + "/** The `protocols` node: one child per routing protocol. */\n"
        "export const VYOS_PROTOCOLS: SchemaNode = "
        + dump(roots["protocols"])
        + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    js = ROOT / "src" / "azalea-vyos" / "schema" / "interfaces.json"
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(
        json.dumps({"source": origin, "roots": {k: kinds_only(v) for k, v in roots.items()}}, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    for out in (ts, ts2, js):
        print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} kB)", file=sys.stderr)


if __name__ == "__main__":
    main()
