// What the interface edit modals can change, as a declarative schema
// over the VyOS config tree (1.4 sagitta / 1.5 circinus
// `interfaces ethernet` and `vif`). Each field owns one config path
// relative to the interface node; the modal reads it, edits it and
// diffs it back into `set`/`delete` commands. Anything not listed here
// (vif subtrees, eapol, dhcpv6-options pd, evpn, …) is left untouched.

import type { CfgNode, InterfaceKind } from './types';

export type FieldType = 'text' | 'number' | 'select' | 'flag' | 'multi';

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  /** Config path relative to the interface node. */
  path: string[];
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  /** For `select`; the first option is the unset/default state (''). */
  options?: FieldOption[];
  min?: number;
  max?: number;
  /** Per-value check; returns the complaint or null. */
  validate?: (value: string) => string | null;
  mono?: boolean;
  /** Span both columns. */
  full?: boolean;
}

export interface Section {
  id: string;
  label: string;
  fields: Field[];
}

export type FormValue = string | string[] | boolean;
export type FormState = Record<string, FormValue>;

export const keyOf = (path: string[]): string => path.join(' ');

// ------------------------------------------------------------ validators

const ipv4 = (s: string): boolean => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
};
const ipv6 = (s: string): boolean =>
  /^[0-9a-fA-F:]+(?:\.\d{1,3}){0,3}$/.test(s) && s.includes(':') && s.split('::').length <= 2;

const cidr = (s: string, v4Only = false): boolean => {
  const [ip, len, extra] = s.split('/');
  if (!ip || len == null || extra != null || !/^\d{1,3}$/.test(len)) return false;
  const n = Number(len);
  if (ipv4(ip)) return n <= 32;
  return !v4Only && ipv6(ip) && n <= 128;
};

const validateAddress = (v: string): string | null =>
  v === 'dhcp' || v === 'dhcpv6' || cidr(v) ? null : 'Enter an address with prefix length (192.0.2.1/24, 2001:db8::1/64), dhcp or dhcpv6.';

const validatePrefix6 = (v: string): string | null =>
  cidr(v) && v.includes(':') ? null : 'Enter an IPv6 prefix (2001:db8::/64).';

const validateMac = (v: string): string | null =>
  /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v) ? null : 'Enter a MAC address (00:11:22:33:44:55).';

const validateMss = (v: string): string | null =>
  v === 'clamp-mss-to-pmtu' || (/^\d+$/.test(v) && Number(v) >= 500 && Number(v) <= 65535)
    ? null
    : 'Enter 500–65535 or clamp-mss-to-pmtu.';

const validateName = (v: string): string | null =>
  /^[A-Za-z0-9_.-]{1,15}$/.test(v) ? null : 'Enter an interface name (eth1, bond0, br0).';

const validateVrf = (v: string): string | null =>
  /^[A-Za-z0-9_.-]{1,15}$/.test(v) ? null : 'Enter a VRF name.';

const validateQos = (v: string): string | null =>
  /^[0-7]:[0-7](?: [0-7]:[0-7])*$/.test(v) ? null : 'Space-separated from:to pairs, each 0–7 (0:1 1:6).';

const validateReject = (v: string): string | null =>
  ipv4(v) || cidr(v, true) || /^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/.test(v)
    ? null
    : 'Enter an IPv4 address, prefix or range.';

// ---------------------------------------------------------------- fields

const text = (path: string[], label: string, extra: Partial<Field> = {}): Field => ({
  path,
  label,
  type: 'text',
  ...extra,
});
const number = (path: string[], label: string, min: number, max: number, extra: Partial<Field> = {}): Field => ({
  path,
  label,
  type: 'number',
  min,
  max,
  mono: true,
  ...extra,
});
const flag = (path: string[], label: string, help?: string): Field => ({ path, label, type: 'flag', help });
const select = (path: string[], label: string, options: FieldOption[], extra: Partial<Field> = {}): Field => ({
  path,
  label,
  type: 'select',
  options,
  ...extra,
});

const ADDRESS: Field = {
  path: ['address'],
  label: 'Addresses',
  type: 'multi',
  help: 'IPv4/IPv6 with prefix length, or dhcp / dhcpv6.',
  placeholder: '192.0.2.1/24',
  validate: validateAddress,
  mono: true,
  full: true,
};
const DESCRIPTION = text(['description'], 'Description', { placeholder: 'Free text', full: true });
const DISABLE = flag(['disable'], 'Disabled', 'Administratively down: no traffic, no routes.');
const LINK_DETECT = flag(['disable-link-detect'], 'Ignore link state', 'Keep routes and addresses up when carrier is lost.');
const MTU = number(['mtu'], 'MTU', 68, 16000, { placeholder: '1500', help: 'Bytes, 68–16000. Unset means 1500.' });
const MAC = text(['mac'], 'MAC address', { placeholder: '00:11:22:33:44:55', validate: validateMac, mono: true, help: 'Override the hardware address.' });
const VRF = text(['vrf'], 'VRF', { placeholder: 'default', validate: validateVrf, mono: true, help: 'Place the interface in a VRF.' });
const REDIRECT = text(['redirect'], 'Redirect ingress to', { placeholder: 'eth1', validate: validateName, mono: true, help: 'Send incoming packets to another interface.' });
const MIRROR_IN = text(['mirror', 'ingress'], 'Mirror ingress to', { placeholder: 'eth2', validate: validateName, mono: true });
const MIRROR_OUT = text(['mirror', 'egress'], 'Mirror egress to', { placeholder: 'eth2', validate: validateName, mono: true });
const POLICY4 = text(['policy', 'route'], 'Policy route (IPv4)', { placeholder: 'policy name', mono: true, help: 'Policy-based routing applied to ingress.' });
const POLICY6 = text(['policy', 'route6'], 'Policy route (IPv6)', { placeholder: 'policy name', mono: true });

const IP_SECTION: Section = {
  id: 'ip',
  label: 'IPv4',
  fields: [
    text(['ip', 'adjust-mss'], 'Adjust TCP MSS', { placeholder: 'clamp-mss-to-pmtu or 500–65535', validate: validateMss, mono: true }),
    number(['ip', 'arp-cache-timeout'], 'ARP cache timeout', 1, 86400, { placeholder: '30', help: 'Seconds.' }),
    select(['ip', 'source-validation'], 'Source validation (rp_filter)', [
      { value: '', label: 'Not set' },
      { value: 'strict', label: 'Strict' },
      { value: 'loose', label: 'Loose' },
      { value: 'disable', label: 'Disable' },
    ]),
    flag(['ip', 'disable-forwarding'], 'Disable forwarding', 'Do not route IPv4 through this interface.'),
    flag(['ip', 'disable-arp-filter'], 'Disable ARP filter', 'Answer ARP for any local address on any interface.'),
    flag(['ip', 'enable-arp-accept'], 'Accept gratuitous ARP', 'Learn neighbours from unsolicited ARP.'),
    flag(['ip', 'enable-arp-announce'], 'ARP announce', 'Prefer a source address on the target subnet when announcing.'),
    flag(['ip', 'enable-arp-ignore'], 'ARP ignore', 'Only answer ARP for addresses configured on this interface.'),
    flag(['ip', 'enable-directed-broadcast'], 'Directed broadcast', 'Forward directed broadcasts to this subnet.'),
    flag(['ip', 'enable-proxy-arp'], 'Proxy ARP', 'Answer ARP on behalf of hosts reachable through the router.'),
    flag(['ip', 'proxy-arp-pvlan'], 'Proxy ARP for private VLAN', 'Answer ARP for addresses on this same interface.'),
  ],
};

const IPV6_SECTION: Section = {
  id: 'ipv6',
  label: 'IPv6',
  fields: [
    {
      path: ['ipv6', 'address', 'eui64'],
      label: 'EUI-64 prefixes',
      type: 'multi',
      help: 'Prefixes to form an address from with the MAC-derived host part.',
      placeholder: '2001:db8::/64',
      validate: validatePrefix6,
      mono: true,
      full: true,
    },
    text(['ipv6', 'adjust-mss'], 'Adjust TCP MSS', { placeholder: 'clamp-mss-to-pmtu or 500–65535', validate: validateMss, mono: true }),
    number(['ipv6', 'dup-addr-detect-transmits'], 'DAD transmits', 0, 65535, { placeholder: '1', help: 'Duplicate address detection probes; 0 disables DAD.' }),
    number(['ipv6', 'accept-dad'], 'Accept DAD', 0, 2, { placeholder: '1', help: '0 disable, 1 enable, 2 also disable IPv6 on a duplicate link-local.' }),
    flag(['ipv6', 'address', 'autoconf'], 'SLAAC autoconfiguration', 'Form addresses from router advertisements.'),
    flag(['ipv6', 'address', 'no-default-link-local'], 'No default link-local', 'Do not assign the automatic fe80:: address.'),
    flag(['ipv6', 'disable-forwarding'], 'Disable forwarding', 'Do not route IPv6 through this interface.'),
  ],
};

const DHCP_SECTION: Section = {
  id: 'dhcp',
  label: 'DHCP',
  fields: [
    text(['dhcp-options', 'client-id'], 'DHCP client ID', { mono: true }),
    text(['dhcp-options', 'host-name'], 'DHCP host name', { mono: true }),
    text(['dhcp-options', 'vendor-class-id'], 'Vendor class ID', { mono: true }),
    text(['dhcp-options', 'user-class'], 'User class', { mono: true }),
    number(['dhcp-options', 'default-route-distance'], 'Default route distance', 1, 255, { placeholder: '210' }),
    {
      path: ['dhcp-options', 'reject'],
      label: 'Reject leases from',
      type: 'multi',
      help: 'Server addresses, prefixes or ranges whose offers are ignored.',
      placeholder: '192.0.2.0/24',
      validate: validateReject,
      mono: true,
      full: true,
    },
    flag(['dhcp-options', 'no-default-route'], 'No default route from DHCP', 'Ignore the offered gateway.'),
    flag(['dhcp-options', 'mtu'], 'MTU from DHCP', 'Apply the MTU option the server sends.'),
    text(['dhcpv6-options', 'duid'], 'DHCPv6 DUID', { mono: true, placeholder: '00:03:00:01:…' }),
    flag(['dhcpv6-options', 'parameters-only'], 'DHCPv6 parameters only', 'Stateless: request DNS and other options, no address.'),
    flag(['dhcpv6-options', 'rapid-commit'], 'DHCPv6 rapid commit', 'Two-message exchange.'),
    flag(['dhcpv6-options', 'temporary'], 'DHCPv6 temporary address', 'Request an IA_TA instead of an IA_NA.'),
    flag(['dhcpv6-options', 'no-release'], 'DHCPv6 no release', 'Do not release the lease on shutdown.'),
  ],
};

const SPEEDS = ['10', '100', '1000', '2500', '5000', '10000', '25000', '40000', '50000', '100000'];

const ETHERNET_SECTIONS: Section[] = [
  {
    id: 'general',
    label: 'General',
    fields: [
      DESCRIPTION,
      ADDRESS,
      MTU,
      VRF,
      MAC,
      text(['hw-id'], 'Hardware ID', {
        placeholder: '00:11:22:33:44:55',
        validate: validateMac,
        mono: true,
        help: 'Burned-in MAC that ties this name to the NIC.',
      }),
      REDIRECT,
      MIRROR_IN,
      MIRROR_OUT,
      POLICY4,
      POLICY6,
      DISABLE,
      LINK_DETECT,
    ],
  },
  {
    id: 'link',
    label: 'Link',
    fields: [
      select(['speed'], 'Speed', [{ value: '', label: 'Auto (default)' }, ...SPEEDS.map((s) => ({ value: s, label: `${s} Mbit/s` }))], {
        help: 'Speed and duplex must both be set, or both auto.',
      }),
      select(['duplex'], 'Duplex', [
        { value: '', label: 'Auto (default)' },
        { value: 'full', label: 'Full' },
        { value: 'half', label: 'Half' },
      ]),
      number(['ring-buffer', 'rx'], 'RX ring buffer', 80, 16384, { help: 'Descriptors; driver limits apply.' }),
      number(['ring-buffer', 'tx'], 'TX ring buffer', 80, 16384),
      flag(['disable-flow-control'], 'Disable flow control', 'Turn off Ethernet pause frames.'),
    ],
  },
  {
    id: 'offload',
    label: 'Offload',
    fields: [
      flag(['offload', 'gro'], 'GRO', 'Generic receive offload.'),
      flag(['offload', 'gso'], 'GSO', 'Generic segmentation offload.'),
      flag(['offload', 'lro'], 'LRO', 'Large receive offload.'),
      flag(['offload', 'sg'], 'Scatter-gather', 'Scatter-gather I/O.'),
      flag(['offload', 'tso'], 'TSO', 'TCP segmentation offload.'),
      flag(['offload', 'rps'], 'RPS', 'Receive packet steering across CPUs.'),
      flag(['offload', 'rfs'], 'RFS', 'Receive flow steering (needs RPS).'),
      flag(['offload', 'hw-tc-offload'], 'Hardware TC offload', 'Offload traffic-control flows to the NIC.'),
    ],
  },
  IP_SECTION,
  IPV6_SECTION,
  DHCP_SECTION,
];

const VLAN_SECTIONS: Section[] = [
  {
    id: 'general',
    label: 'General',
    fields: [
      DESCRIPTION,
      ADDRESS,
      MTU,
      VRF,
      MAC,
      text(['egress-qos'], 'Egress QoS map', { placeholder: '0:1 1:6', validate: validateQos, mono: true, help: 'skb priority → 802.1p, space-separated pairs.' }),
      text(['ingress-qos'], 'Ingress QoS map', { placeholder: '1:0', validate: validateQos, mono: true, help: '802.1p → skb priority.' }),
      REDIRECT,
      MIRROR_IN,
      MIRROR_OUT,
      POLICY4,
      POLICY6,
      DISABLE,
      LINK_DETECT,
    ],
  },
  IP_SECTION,
  IPV6_SECTION,
  DHCP_SECTION,
];

export function schemaFor(kind: InterfaceKind): Section[] | null {
  if (kind === 'ethernet') return ETHERNET_SECTIONS;
  if (kind === 'vlan') return VLAN_SECTIONS;
  return null;
}

// -------------------------------------------------------------- tree I/O

export function readNode(tree: CfgNode, path: string[]): CfgNode | undefined {
  let node: CfgNode | undefined = tree;
  for (const key of path) {
    if (node == null || typeof node === 'string' || Array.isArray(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** A leaf's values; `[]` when unset or not a leaf. */
export function readValues(tree: CfgNode, path: string[]): string[] {
  const n = readNode(tree, path);
  if (typeof n === 'string') return [n];
  if (Array.isArray(n)) return n;
  return [];
}

export function initialForm(sections: Section[], tree: CfgNode): FormState {
  const form: FormState = {};
  for (const s of sections) {
    for (const f of s.fields) {
      const k = keyOf(f.path);
      if (f.type === 'flag') form[k] = readNode(tree, f.path) !== undefined;
      else if (f.type === 'multi') form[k] = readValues(tree, f.path);
      else form[k] = readValues(tree, f.path)[0] ?? '';
    }
  }
  return form;
}

/** Complaints by field key. */
export function validateForm(sections: Section[], form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const s of sections) {
    for (const f of s.fields) {
      const k = keyOf(f.path);
      const v = form[k];
      if (f.type === 'flag') continue;
      if (f.type === 'multi') {
        for (const item of v as string[]) {
          const e = f.validate ? f.validate(item) : null;
          if (e) {
            errors[k] = `${item}: ${e}`;
            break;
          }
        }
        continue;
      }
      const text = String(v ?? '').trim();
      if (!text) continue;
      if (f.type === 'number') {
        if (!/^\d+$/.test(text) || Number(text) < (f.min ?? 0) || Number(text) > (f.max ?? Infinity)) {
          errors[k] = `Enter a number from ${f.min} to ${f.max}.`;
          continue;
        }
      }
      if (f.validate) {
        const e = f.validate(text);
        if (e) errors[k] = e;
      }
    }
  }
  return errors;
}

export interface Changes {
  set: string[][];
  delete: string[][];
}

/** Set/delete paths (relative to the interface) that turn `tree` into `form`. */
export function diffForm(sections: Section[], tree: CfgNode, form: FormState): Changes {
  const out: Changes = { set: [], delete: [] };
  for (const s of sections) {
    for (const f of s.fields) {
      const k = keyOf(f.path);
      const v = form[k];
      if (f.type === 'flag') {
        const was = readNode(tree, f.path) !== undefined;
        if (v && !was) out.set.push(f.path);
        if (!v && was) out.delete.push(f.path);
      } else if (f.type === 'multi') {
        const was = readValues(tree, f.path);
        const now = (v as string[]).map((x) => x.trim()).filter(Boolean);
        for (const x of was) if (!now.includes(x)) out.delete.push([...f.path, x]);
        for (const x of now) if (!was.includes(x)) out.set.push([...f.path, x]);
      } else {
        const was = readValues(tree, f.path)[0] ?? '';
        const now = String(v ?? '').trim();
        if (was === now) continue;
        if (!now) out.delete.push(f.path);
        else out.set.push([...f.path, now]);
      }
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
