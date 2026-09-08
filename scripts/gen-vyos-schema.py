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
  web/lib/vyos-trains.generated.ts       which top-level nodes some trains
                                         lack - the navigation hides them
  web/lib/vyos-trains.generated.ts       which top-level nodes some trains
                                         lack - the navigation hides them
  src/azalea-vyos/schema/interfaces.json node kinds only (node / tag /
                                         leaf, multi, valueless) - the
                                         mock router's set/delete rules

The CLI differs between VyOS releases, so the three release trains are
read side by side and merged into one tree: a node (or enumerated
value) that not every train has carries `only` (`o` in the JSON) naming
the trains that do, and the UI hides it on the others. Where trains
disagree about a node's properties the newest wins; where they disagree
about its kind (a leaf that became a tag node) each kind is kept as its
own variant, tagged with its trains, so exactly one survives pruning.

Usage:  python3 scripts/gen-vyos-schema.py --sagitta DIR --circinus DIR --rolling DIR
        (sagitta is VyOS 1.4 LTS, circinus 1.5, rolling the development line;
         the checkout's branch and commit are recorded in the outputs)
"""

import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Oldest to newest; the order the UI and mock use too.
TRAINS = ["sagitta", "circinus", "rolling"]
TYPES = [
    "bonding", "bridge", "dummy", "ethernet", "geneve", "l2tpv3", "loopback",
    "macsec", "openvpn", "wireguard", "pppoe", "pseudo-ethernet", "sstpc",
    "tunnel", "virtual-ethernet", "vti", "vxlan", "wireless", "wwan",
]
PROTOCOLS = [
    "babel", "bfd", "bgp", "eigrp", "failover", "igmp-proxy", "isis", "mpls",
    "nhrp", "openfabric", "ospf", "ospfv3", "pim", "pim6", "rip", "ripng",
    "rpki", "segment-routing", "static", "static_arp", "static_multicast",
    "static_neighbor-proxy", "traffic_engineering",
]
# Top-level config node -> the definition files that contribute to it.
# Files for the same root are merged the way VyOS merges them; a file a
# train does not have is simply absent from that train.
ROOTS = {
    "interfaces": [f"interfaces_{t}.xml.in" for t in TYPES],
    "nat": ["nat.xml.in", "nat_cgnat.xml.in"],
    "nat64": ["nat64.xml.in"],
    "nat66": ["nat66.xml.in"],
    "protocols": [f"protocols_{p}.xml.in" for p in PROTOCOLS],
}
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


# ------------------------------------------------------------- trains

def merge_trains(per_train: dict, path: str, warnings: list) -> dict:
    """
    One node from the same node in several trains (`per_train` maps
    train -> parsed node, in TRAINS order). Properties come from the
    newest train; `only` lists the trains that have the node when that
    is not all of them; children and enumerated values are unioned the
    same way, each tagged relative to this node's trains.
    """
    trains = [t for t in TRAINS if t in per_train]
    newest = per_train[trains[-1]]
    out = {k: v for k, v in newest.items() if k not in ("children", "values")}
    assert len({n["kind"] for n in per_train.values()}) == 1, path
    if trains != TRAINS:
        out["only"] = trains

    # Values: newest order first, then anything an older train adds.
    if any("values" in n for n in per_train.values()):
        seen: dict = {}
        order: list = []
        for t in reversed(trains):
            for v in per_train[t].get("values", []):
                if v["value"] not in seen:
                    seen[v["value"]] = dict(v)
                    order.append(v["value"])
        for value in order:
            has = [t for t in trains if any(v["value"] == value for v in per_train[t].get("values", []))]
            if has != trains:
                seen[value]["only"] = has
        out["values"] = [seen[v] for v in order]

    # Children: the union, in the newest train's order with older-only
    # nodes appended, each merged across the trains that have it.
    if any("children" in n for n in per_train.values()):
        by_train = {t: {c["name"]: c for c in per_train[t].get("children", [])} for t in trains}
        order: list = []
        for t in reversed(trains):
            for name in by_train[t]:
                if name not in order:
                    order.append(name)
        children = []
        for name in order:
            variants = {t: by_train[t][name] for t in trains if name in by_train[t]}
            kinds = list(dict.fromkeys(variants[t]["kind"] for t in reversed(trains) if t in variants))
            if len(kinds) > 1:
                warnings.append(f"{path} {name}: kind differs between trains ({', '.join(f'{t}={variants[t]['kind']}' for t in trains if t in variants)}); kept as separate variants")
            for kind in kinds:
                children.append(merge_trains({t: n for t, n in variants.items() if n["kind"] == kind}, f"{path} {name}", warnings))
        out["children"] = children
    return out


def kinds_only(node: dict) -> dict:
    out = {"k": node["kind"][0]}
    if node.get("multi"):
        out["m"] = 1
    if node.get("valueless"):
        out["v"] = 1
    if node.get("only"):
        out["o"] = node["only"]
    if node.get("children"):
        # Same-named variants (a node whose kind changed between trains):
        # the newest is the entry, older ones ride along under `a`.
        c: dict = {}
        for child in node["children"]:
            k = kinds_only(child)
            if child["name"] in c:
                c[child["name"]].setdefault("a", []).append(k)
            else:
                c[child["name"]] = k
        out["c"] = c
    return out


def count(node: dict, train=None) -> int:
    if train and node.get("only") and train not in node["only"]:
        return 0
    return 1 + sum(count(c, train) for c in node.get("children", []))


def describe(src: Path) -> str:
    git = lambda *a: subprocess.check_output(["git", "-C", str(src), *a], text=True).strip()
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":  # detached (a worktree): name the branch it points at
        names = git("branch", "-r", "--points-at", "HEAD").split()
        branch = names[0].replace("origin/", "") if names else "detached"
    return f"{branch} {git('rev-parse', '--short=7', 'HEAD')} ({git('log', '-1', '--format=%cs')})"


def read_train(src: Path) -> dict:
    """Every root's tree as this train defines it."""
    defs = src / "interface-definitions"
    roots: dict = {}
    for root_name, files in ROOTS.items():
        merged = {"name": root_name, "kind": "node", "children": []}
        found = False
        for file in files:
            if not (defs / file).exists():
                continue
            found = True
            text = resolve((defs / file).read_text(encoding="utf-8"), defs)
            xml = ET.fromstring(text)
            top = xml.find(f"./node[@name='{root_name}']")
            if top is None:
                sys.exit(f"{file}: no top-level node {root_name}")
            merge_into(merged, parse_node(top, root_name))
        if found:
            roots[root_name] = merged
    return roots


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for t in TRAINS:
        ap.add_argument(f"--{t}", required=True, type=Path, metavar="DIR", help=f"vyos-1x checkout of the {t} branch")
    args = ap.parse_args()
    checkouts = {t: getattr(args, t) for t in TRAINS}
    origin = "; ".join(f"{t}: {describe(p)}" for t, p in checkouts.items())

    per_train = {t: read_train(p) for t, p in checkouts.items()}
    warnings: list = []
    roots: dict = {}
    for root_name in ROOTS:
        have = {t: per_train[t][root_name] for t in TRAINS if root_name in per_train[t]}
        roots[root_name] = merge_trains(have, root_name, warnings)
        for c in roots[root_name]["children"]:
            per = "  ".join(f"{t}:{count(c, t):4}" for t in TRAINS)
            tag = f"  only {','.join(c['only'])}" if c.get("only") else ""
            print(f"{root_name} {c['name']:20} {per}{tag}", file=sys.stderr)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)

    interfaces = {c["name"]: c for c in roots["interfaces"]["children"]}
    for t in TYPES:
        if t not in interfaces:
            sys.exit(f"{t}: no tagNode in any train")

    head = (
        "// GENERATED by scripts/gen-vyos-schema.py - do not edit.\n"
        f"// Source: vyos-1x {origin}; interface-definitions/*.xml.in\n"
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
    # The nodes near the top of the tree that not every train has, for
    # the navigation: "nat cgnat" -> [circinus, rolling]. A node with a
    # variant on every train is on every train.
    node_trains: dict = {}

    def collect(node: dict, path: str, depth: int) -> None:
        for c in node.get("children", []):
            p = f"{path} {c['name']}"
            node_trains.setdefault(p, set()).update(c.get("only") or TRAINS)
            if depth < 2:
                collect(c, p, depth + 1)

    for root_name, node in roots.items():
        node_trains.setdefault(root_name, set()).update(node.get("only") or TRAINS)
        collect(node, root_name, 1)
    partial = {p: [t for t in TRAINS if t in s] for p, s in sorted(node_trains.items()) if s != set(TRAINS)}
    ts3 = ROOT / "web" / "lib" / "vyos-trains.generated.ts"
    ts3.write_text(
        "// GENERATED by scripts/gen-vyos-schema.py - do not edit.\n"
        f"// Source: vyos-1x {origin}; interface-definitions/*.xml.in\n"
        "import type { VyosTrain } from './train';\n\n"
        "/** Config nodes (to three words deep) that only some release trains have. */\n"
        "export const VYOS_NODE_TRAINS: Record<string, VyosTrain[] | undefined> = "
        + dump(partial)
        + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    # The nodes near the top of the tree that not every train has, for
    # the navigation: "nat cgnat" -> [circinus, rolling]. A node with a
    # variant on every train is on every train.
    node_trains: dict = {}

    def collect(node: dict, path: str, depth: int) -> None:
        for c in node.get("children", []):
            p = f"{path} {c['name']}"
            node_trains.setdefault(p, set()).update(c.get("only") or TRAINS)
            if depth < 2:
                collect(c, p, depth + 1)

    for root_name, node in roots.items():
        node_trains.setdefault(root_name, set()).update(node.get("only") or TRAINS)
        collect(node, root_name, 1)
    partial = {p: [t for t in TRAINS if t in s] for p, s in sorted(node_trains.items()) if s != set(TRAINS)}
    ts3 = ROOT / "web" / "lib" / "vyos-trains.generated.ts"
    ts3.write_text(
        "// GENERATED by scripts/gen-vyos-schema.py - do not edit.\n"
        f"// Source: vyos-1x {origin}; interface-definitions/*.xml.in\n"
        "import type { VyosTrain } from './train';\n\n"
        "/** Config nodes (to three words deep) that only some release trains have. */\n"
        "export const VYOS_NODE_TRAINS: Record<string, VyosTrain[] | undefined> = "
        + dump(partial)
        + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    js = ROOT / "src" / "azalea-vyos" / "schema" / "interfaces.json"
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(
        json.dumps({"source": origin, "trains": TRAINS, "roots": {k: kinds_only(v) for k, v in roots.items()}}, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    for out in (ts, ts2, ts3, js):
        print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} kB)", file=sys.stderr)


if __name__ == "__main__":
    main()
