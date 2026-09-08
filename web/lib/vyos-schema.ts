// The VyOS interface schema (generated into vyos-interfaces.generated.ts
// from vyos-1x's interface-definitions) and the tree operations the
// editor needs: read and write a config tree, validate values against
// the schema, and diff two trees into set/delete commands.

import type { CfgNode, InterfaceKind } from './types';
import type { VyosTrain } from './train';

/** One node of the VyOS config tree, as vyos-1x declares it. */
export interface SchemaNode {
  name: string;
  /** `node` groups children; `tag` is keyed (`peer <name>`); `leaf` holds values. */
  kind: 'node' | 'tag' | 'leaf';
  help?: string;
  /**
   * The release trains that have this node, when not all of them do.
   * Siblings may share a name with different `only` sets (a node whose
   * kind changed between releases); `forTrain` leaves exactly one.
   */
  only?: VyosTrain[];
  /** A leaf that is set or not, with no value. */
  valueless?: boolean;
  /** A leaf holding several values. */
  multi?: boolean;
  /** Enumerated choices (completionHelp list), with per-value help. */
  values?: { value: string; help: string; only?: VyosTrain[] }[];
  /** Free-form value formats (valueHelp), e.g. `ipv4net` or `u32:68-16000`. */
  formats?: { format: string; help: string }[];
  /** Completion from another config path, e.g. `interfaces ethernet`. */
  completionPath?: string;
  /** Full-match regexes a value must satisfy. */
  regex?: string[];
  validators?: { name: string; arg?: string }[];
  /** Accepted numeric ranges from the `numeric` validator; any one accepts. */
  ranges?: [number, number][];
  /** VyOS's own complaint for a bad value. */
  error?: string;
  default?: string;
  children?: SchemaNode[];
}

/** An object-shaped config node. */
export type CfgTree = { [key: string]: CfgNode };

export const isTree = (n: CfgNode | undefined): n is CfgTree => typeof n === 'object' && n !== null && !Array.isArray(n);

/** A leaf's values; `[]` when unset, valueless, or not a leaf. */
export const leafValues = (n: CfgNode | undefined): string[] => (typeof n === 'string' ? [n] : Array.isArray(n) ? n : []);

export function getIn(tree: CfgNode | undefined, path: string[]): CfgNode | undefined {
  let node: CfgNode | undefined = tree;
  for (const key of path) {
    if (!isTree(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Immutable set; `undefined` removes. Empty intermediate nodes are created. */
export function setIn(tree: CfgTree, path: string[], value: CfgNode | undefined): CfgTree {
  const [head, ...rest] = path;
  if (head === undefined) return isTree(value) ? value : tree;
  const next = { ...tree };
  if (rest.length === 0) {
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const child = isTree(tree[head]) ? (tree[head] as CfgTree) : {};
  next[head] = setIn(child, rest, value);
  return next;
}

export const schemaFor = (kind: InterfaceKind, all: Record<string, SchemaNode>): SchemaNode | undefined => all[kind];

const trainCache = new Map<VyosTrain, WeakMap<SchemaNode, SchemaNode | null>>();

/**
 * The schema as one release train sees it: nodes and enumerated values
 * the train lacks are gone, so the editors never offer them. Undefined
 * when the node itself is not on that train. Memoised per node and
 * train, so repeated calls hand back the same object.
 */
export function forTrain(node: SchemaNode | undefined, train: VyosTrain): SchemaNode | undefined {
  if (!node) return undefined;
  let cache = trainCache.get(train);
  if (!cache) {
    cache = new WeakMap();
    trainCache.set(train, cache);
  }
  const hit = cache.get(node);
  if (hit !== undefined) return hit ?? undefined;
  const has = (only?: VyosTrain[]) => !only || only.includes(train);
  let out: SchemaNode | null = null;
  if (has(node.only)) {
    out = { ...node };
    delete out.only;
    if (node.values) out.values = node.values.filter((v) => has(v.only)).map(({ only: _only, ...v }) => v);
    if (node.children) out.children = node.children.map((c) => forTrain(c, train)).filter((c): c is SchemaNode => c !== undefined);
  }
  cache.set(node, out);
  return out ?? undefined;
}

// --------------------------------------------------------------- labels

const ACRONYMS: Record<string, string> = {
  ip: 'IP',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  arp: 'ARP',
  mtu: 'MTU',
  mac: 'MAC',
  dhcp: 'DHCP',
  dhcpv6: 'DHCPv6',
  vrf: 'VRF',
  mss: 'MSS',
  qos: 'QoS',
  vif: 'VLAN',
  'vif-s': 'Service VLAN (QinQ)',
  'vif-c': 'Customer VLAN',
  id: 'ID',
  duid: 'DUID',
  dad: 'DAD',
  ttl: 'TTL',
  tos: 'ToS',
  vni: 'VNI',
  gro: 'GRO',
  gso: 'GSO',
  lro: 'LRO',
  tso: 'TSO',
  rps: 'RPS',
  rfs: 'RFS',
  sg: 'Scatter-gather',
  'hw-id': 'Hardware ID',
  'hw-tc-offload': 'Hardware TC offload',
  lacp: 'LACP',
  mii: 'MII',
  tls: 'TLS',
  ssl: 'SSL',
  ca: 'CA',
  dh: 'DH',
  crl: 'CRL',
  ssid: 'SSID',
  bssid: 'BSSID',
  wpa: 'WPA',
  radius: 'RADIUS',
  eapol: 'EAPoL',
  evpn: 'EVPN',
  mka: 'MKA',
  cak: 'CAK',
  ckn: 'CKN',
  apn: 'APN',
  pin: 'PIN',
  df: 'DF',
  gre: 'GRE',
  ipip: 'IPIP',
  sit: 'SIT',
  ecmp: 'ECMP',
  pmtu: 'PMTU',
  udp: 'UDP',
  tcp: 'TCP',
  ikev2: 'IKEv2',
  ht: 'HT',
  vht: 'VHT',
  he: 'HE',
  ldpc: 'LDPC',
  stbc: 'STBC',
  mfp: 'MFP',
  lzo: 'LZO',
  vxlan: 'VXLAN',
  geneve: 'Geneve',
  wwan: 'WWAN',
  pppoe: 'PPPoE',
  'eui64': 'EUI-64',
  'source-validation': 'Source validation (rp_filter)',
  // Routing
  as: 'AS',
  'system-as': 'System AS',
  'remote-as': 'Remote AS',
  'local-as': 'Local AS',
  bgp: 'BGP',
  ebgp: 'eBGP',
  ibgp: 'iBGP',
  ospf: 'OSPF',
  ospfv3: 'OSPFv3',
  ospf6: 'OSPFv3',
  isis: 'IS-IS',
  rip: 'RIP',
  ripng: 'RIPng',
  eigrp: 'EIGRP',
  babel: 'Babel',
  nhrp: 'NHRP',
  bfd: 'BFD',
  mpls: 'MPLS',
  'mpls-te': 'MPLS-TE',
  ldp: 'LDP',
  'ldp-sync': 'LDP-IGP sync',
  srv6: 'SRv6',
  sid: 'SID',
  usid: 'uSID',
  'behavior-usid': 'uSID behavior',
  rpki: 'RPKI',
  pim: 'PIM',
  pim6: 'PIM6',
  igmp: 'IGMP',
  mld: 'MLD',
  rp: 'RP',
  'dr-priority': 'DR priority',
  bsm: 'BSM',
  ssm: 'SSM',
  spt: 'SPT',
  nssa: 'NSSA',
  abr: 'ABR',
  lsa: 'LSA',
  lsp: 'LSP',
  spf: 'SPF',
  lfa: 'LFA',
  ietf: 'IETF',
  psnp: 'PSNP',
  csnp: 'CSNP',
  net: 'NET',
  med: 'MED',
  rd: 'RD',
  rt: 'RT',
  vpn: 'VPN',
  evi: 'EVI',
  ead: 'EAD',
  es: 'ES',
  pip: 'PIP',
  svi: 'SVI',
  gw: 'gateway',
  l2vpn: 'L2VPN',
  bmp: 'BMP',
  nbma: 'NBMA',
  ssh: 'SSH',
  md5: 'MD5',
  hmac: 'HMAC',
  fib: 'FIB',
  igp: 'IGP',
  rtt: 'RTT',
  te: 'TE',
  ifmtu: 'Interface MTU',
  v6only: 'IPv6 only',
  'rfc1583-compatibility': 'RFC 1583 compatibility',
  'no-v6-secondary': 'No IPv6 secondary',
};

/** `arp-cache-timeout` → "ARP cache timeout"; `ebgp-multihop` keeps its "eBGP". */
export function humanize(name: string): string {
  if (ACRONYMS[name]) return ACRONYMS[name];
  const parts = name.split('-');
  const words = parts.map((w) => ACRONYMS[w] ?? w);
  const text = words.join(' ');
  if (ACRONYMS[parts[0] ?? '']) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a value should look like, for a placeholder. */
const rangeText = (ranges: [number, number][]): string => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(' | ');

export function placeholderFor(node: SchemaNode): string {
  if (node.ranges?.length) return rangeText(node.ranges);
  if (node.formats?.length) return node.formats.map((f) => f.format).join(' | ');
  if (node.values?.length) return node.values.map((v) => v.value).join(' | ');
  return '';
}

/** Numeric leaf: the only valueHelp formats are numeric ranges. */
export const isNumeric = (node: SchemaNode): boolean =>
  !!node.ranges?.length && (!node.formats || node.formats.every((f) => /^u32|^number|^\d/.test(f.format)));

/**
 * VyOS regexes are Python `re` full-matches and may use POSIX classes;
 * translate what JavaScript lacks. Null when it still will not compile.
 */
const POSIX: Record<string, string> = {
  ascii: '\x00-\x7F',
  alnum: 'A-Za-z0-9',
  alpha: 'A-Za-z',
  digit: '0-9',
  xdigit: '0-9A-Fa-f',
  upper: 'A-Z',
  lower: 'a-z',
  space: '\s',
  blank: ' \t',
  punct: '!-\/:-@\[-`{-~',
  print: '\x20-\x7E',
  graph: '\x21-\x7E',
  word: '\w',
  cntrl: '\x00-\x1F\x7F',
};
const regexCache = new Map<string, RegExp | null>();
export function compileRegex(source: string): RegExp | null {
  const cached = regexCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    const js = source.replace(/\[:(\w+):\]/g, (m, name: string) => POSIX[name] ?? m);
    compiled = new RegExp(`^(?:${js})$`);
  } catch {
    compiled = null;
  }
  regexCache.set(source, compiled);
  return compiled;
}

/** Enumerated leaf: a fixed list and no free-form format. */
export const isEnum = (node: SchemaNode): boolean => !!node.values?.length && !node.formats?.length;

// ----------------------------------------------------------- validation

const ipv4 = (s: string): boolean => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
};
const ipv6 = (s: string): boolean => /^[0-9a-fA-F:]+(?:\.\d{1,3}){0,3}(?:%[\w.-]+)?$/.test(s) && s.includes(':') && s.split('::').length <= 2;
const prefix = (s: string, v: 4 | 6 | 0): boolean => {
  const [ip, len, extra] = s.split('/');
  if (!ip || len == null || extra != null || !/^\d{1,3}$/.test(len)) return false;
  const n = Number(len);
  if (ipv4(ip)) return v !== 6 && n <= 32;
  return v !== 4 && ipv6(ip) && n <= 128;
};

const SIMPLE: Record<string, (v: string) => boolean> = {
  'ipv4-address': ipv4,
  'ipv6-address': ipv6,
  'ip-address': (v) => ipv4(v) || ipv6(v),
  'ipv4-prefix': (v) => prefix(v, 4),
  'ipv6-prefix': (v) => prefix(v, 6),
  'ip-prefix': (v) => prefix(v, 0),
  'ipv4-host': (v) => prefix(v, 4),
  'ipv6-host': (v) => prefix(v, 6),
  'ip-host': (v) => prefix(v, 0),
  'ip-cidr': (v) => prefix(v, 0),
  'ipv4-range': (v) => /^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/.test(v),
  'mac-address': (v) => /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v),
  'ipv6-link-local': (v) => /^fe80:/i.test(v) && ipv6(v.split('%')[0] ?? ''),
  base64: (v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0,
  'interface-name': (v) => /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/.test(v),
  'port-range': (v) => /^\d{1,5}(-\d{1,5})?$/.test(v),
};

/** Whether a value passes what can be checked here; VyOS checks the rest at commit. */
export function validateValue(node: SchemaNode, value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter a value.';
  const complaint = () => node.error || `Expected ${placeholderFor(node) || 'a valid value'}.`;
  if (node.values?.some((o) => o.value === v)) return null;
  if (isEnum(node)) return `Choose one of ${node.values!.map((o) => o.value).join(', ')}.`;
  const regexes = (node.regex ?? []).map(compileRegex).filter((r): r is RegExp => r !== null);
  if (regexes.length && !regexes.some((r) => r.test(v))) {
    // A regex is one alternative; a validator may accept the value instead.
    if (!node.validators?.length) return complaint();
  }
  const vals = node.validators ?? [];
  if (vals.length === 0) return null;
  let checked = 0;
  let passed = 0;
  for (const val of vals) {
    if (val.name === 'numeric') {
      checked++;
      if (/^-?\d+$/.test(v) && (!node.ranges?.length || node.ranges.some(([a, b]) => Number(v) >= a && Number(v) <= b))) passed++;
      continue;
    }
    const fn = SIMPLE[val.name];
    if (fn) {
      checked++;
      if (fn(v)) passed++;
    }
  }
  // Validators are alternatives: any pass is a pass. Unknown validators
  // (file paths, PKI names, hostnames…) are left to VyOS.
  if (checked > 0 && passed === 0 && checked === vals.length) return complaint();
  return null;
}

export interface Complaint {
  /** Path relative to the interface node, including the offending value or key. */
  path: string[];
  message: string;
}

/** Every value and tag key in `tree` that the schema can fault. */
export function validateTree(schema: SchemaNode, tree: CfgNode | undefined, base: string[] = []): Complaint[] {
  const out: Complaint[] = [];
  if (!isTree(tree)) return out;
  for (const child of schema.children ?? []) {
    const value = tree[child.name];
    if (value === undefined) continue;
    const path = [...base, child.name];
    if (child.kind === 'leaf') {
      if (child.valueless) continue;
      for (const v of leafValues(value)) {
        const m = validateValue(child, v);
        if (m) out.push({ path: [...path, v], message: m });
      }
    } else if (child.kind === 'tag') {
      if (!isTree(value)) continue;
      for (const key of Object.keys(value)) {
        const m = validateValue(child, key);
        if (m) out.push({ path: [...path, key], message: m });
        out.push(...validateTree(child, value[key], [...path, key]));
      }
    } else {
      out.push(...validateTree(child, value, path));
    }
  }
  return out;
}

// ----------------------------------------------------------------- diff

export interface Changes {
  set: string[][];
  delete: string[][];
}

const trimmed = (n: CfgNode | undefined): string[] => leafValues(n).map((v) => v.trim()).filter(Boolean);

/**
 * Set/delete paths (relative to the interface) turning `before` into
 * `after`, walking only what the schema knows so unmodelled nodes are
 * left alone. Deletes come first in the result.
 */
export function diffTree(schema: SchemaNode, before: CfgNode | undefined, after: CfgNode | undefined, base: string[] = []): Changes {
  const out: Changes = { set: [], delete: [] };
  const b = isTree(before) ? before : {};
  const a = isTree(after) ? after : {};
  for (const child of schema.children ?? []) {
    const path = [...base, child.name];
    const was = b[child.name];
    const now = a[child.name];
    if (child.kind === 'leaf') {
      if (child.valueless) {
        if (now !== undefined && was === undefined) out.set.push(path);
        if (now === undefined && was !== undefined) out.delete.push(path);
        continue;
      }
      const wv = trimmed(was);
      const nv = trimmed(now);
      if (child.multi) {
        for (const v of wv) if (!nv.includes(v)) out.delete.push([...path, v]);
        for (const v of nv) if (!wv.includes(v)) out.set.push([...path, v]);
      } else if ((wv[0] ?? '') !== (nv[0] ?? '')) {
        if (nv[0]) out.set.push([...path, nv[0]]);
        else out.delete.push(path);
      }
    } else if (child.kind === 'tag') {
      const wk = isTree(was) ? Object.keys(was) : [];
      const nk = isTree(now) ? Object.keys(now) : [];
      for (const k of wk) if (!nk.includes(k)) out.delete.push([...path, k]);
      for (const k of nk) {
        const entry = [...path, k];
        if (!wk.includes(k)) out.set.push(entry);
        const sub = diffTree(child, wk.includes(k) ? (was as CfgTree)[k] : undefined, (now as CfgTree)[k], entry);
        out.delete.push(...sub.delete);
        out.set.push(...sub.set);
      }
    } else {
      if (was !== undefined && now === undefined) {
        out.delete.push(path);
        continue;
      }
      if (now === undefined) continue;
      const sub = diffTree(child, was, now, path);
      out.delete.push(...sub.delete);
      out.set.push(...sub.set);
      // A group turned on with nothing inside is still a node VyOS keeps.
      if (was === undefined && sub.set.length === 0 && isTree(now) && Object.keys(now).length === 0) out.set.push(path);
    }
  }
  return out;
}

/** The CLI form of a change, for the preview. */
export function renderCommands(base: string[], changes: Changes): string {
  const quote = (w: string) => (/^[A-Za-z0-9_./:@+-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);
  const line = (verb: string, p: string[]) => [verb, ...base, ...p].map(quote).join(' ');
  return [...changes.delete.map((p) => line('delete', p)), ...changes.set.map((p) => line('set', p))].join('\n');
}

/** Whether a subtree holds anything (a value, a flag, or a non-empty node). */
export function hasContent(n: CfgNode | undefined): boolean {
  if (n === undefined) return false;
  if (typeof n === 'string') return true;
  if (Array.isArray(n)) return n.length > 0;
  return true;
}
