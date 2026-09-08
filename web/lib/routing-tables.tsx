// What each Routing page shows: the protocol's subtree under
// `protocols`, its tag nodes as tables (neighbors, areas, interfaces,
// routes…) and the rest as a Settings editor, with the fields that
// count as Basic for each.

import { getIn, isTree, type CfgTree } from './vyos-schema';
import { col, dash, description, flagsCol, keysAt, keysCol, mono, v, type RuleColumn, type RuleTab } from './config-tables';

export type RoutingSlug =
  | 'static'
  | 'arp'
  | 'multicast'
  | 'bgp'
  | 'ospf'
  | 'ospfv3'
  | 'isis'
  | 'openfabric'
  | 'rip'
  | 'ripng'
  | 'babel'
  | 'eigrp'
  | 'bfd'
  | 'mpls'
  | 'segment-routing'
  | 'traffic-engineering'
  | 'pim'
  | 'pim6'
  | 'igmp-proxy'
  | 'rpki'
  | 'failover'
  | 'nhrp';

export interface RoutingSpec {
  slug: RoutingSlug;
  /** The `protocols <scope>` node the page edits (the API scope). */
  scope: string;
  title: string;
  intro: string;
  /** A caveat shown under the intro. */
  note?: string;
  /** Tag nodes shown as tables; paths relative to the scope node. */
  tables: RuleTab[];
  /** Basic-view rules for the Settings editor, relative to the scope node. */
  basic: string[];
  /** Children of the scope node left to another page (Static's ARP and multicast). */
  omit?: string[];
  /** A page for part of a protocol: no Settings editor, no Remove button. */
  part?: boolean;
  /** Show the tables before Settings (protocols that are mostly a list). */
  tablesFirst?: boolean;
}

// ---------------------------------------------------------- renderers

/** What a static route does: next hops, an interface, or a sink. */
function routeTarget(t: CfgTree): React.ReactNode {
  const parts: string[] = [];
  for (const [hop, e] of Object.entries(isTree(t['next-hop']) ? (t['next-hop'] as CfgTree) : {})) {
    const via = v(e, 'interface');
    const dist = v(e, 'distance');
    parts.push(hop + (via ? ` via ${via}` : '') + (dist ? ` (${dist})` : '') + (getIn(e, ['disable']) !== undefined ? ' [off]' : ''));
  }
  for (const [name, e] of Object.entries(isTree(t['interface']) ? (t['interface'] as CfgTree) : {})) {
    const dist = v(e, 'distance');
    parts.push(`dev ${name}` + (dist ? ` (${dist})` : ''));
  }
  if (v(t, 'dhcp-interface')) parts.push(`dhcp ${v(t, 'dhcp-interface')}`);
  if (getIn(t, ['blackhole']) !== undefined) parts.push('blackhole' + (v(t, 'blackhole.distance') ? ` (${v(t, 'blackhole.distance')})` : ''));
  if (getIn(t, ['reject']) !== undefined) parts.push('reject' + (v(t, 'reject.distance') ? ` (${v(t, 'reject.distance')})` : ''));
  return parts.length ? mono(parts.join(', ')) : dash;
}

const nextHops: RuleColumn = { key: 'target', label: 'Next hop', render: routeTarget };

/** A BFD peer's or profile's timers as `rx/tx ×mult`. */
const bfdInterval: RuleColumn = {
  key: 'interval',
  label: 'Interval (rx/tx ×n)',
  render: (t) => {
    const rx = v(t, 'interval.receive');
    const tx = v(t, 'interval.transmit');
    const mult = v(t, 'interval.multiplier');
    if (!rx && !tx && !mult) return dash;
    return mono(`${rx || '300'}/${tx || '300'} ×${mult || '3'}`);
  },
};

/** The BGP address families a neighbor or peer group activates. */
const addressFamilies = keysCol('address-family', 'Address families', (k) => k.replace('-unicast', ''));

/** An OSPF-style area type from its `area-type` node. */
const areaType: RuleColumn = {
  key: 'type',
  label: 'Type',
  render: (t) => {
    const kinds = keysAt(t, 'area-type');
    return kinds.length ? mono(kinds.join(', ')) : <span className="dim">normal</span>;
  },
};

/** Interface names bound under a node (`interface` multi leaf). */
const interfaces = (path: string, label = 'Interfaces'): RuleColumn => ({
  key: path,
  label,
  render: (t) => (v(t, path) ? mono(v(t, path)) : dash),
});

const count = (path: string, label: string): RuleColumn => ({
  key: 'count:' + path,
  label,
  render: (t) => {
    const n = keysAt(t, path).length;
    return n ? mono(String(n)) : dash;
  },
});

// --------------------------------------------------------- basic rules

const ROUTE_BASIC = [
  'description',
  'next-hop.distance',
  'next-hop.interface',
  'next-hop.disable',
  'next-hop.vrf',
  'interface.distance',
  'interface.disable',
  'blackhole.distance',
  'reject.distance',
  'dhcp-interface',
];

/** The per-neighbor address-family options most sessions touch. */
const afBasic = (family: string): string[] =>
  [
    'route-map.*',
    'prefix-list.*',
    'filter-list.*',
    'soft-reconfiguration.*',
    'nexthop-self.*',
    'default-originate.*',
    'route-reflector-client',
    'route-server-client',
    'maximum-prefix',
    'allowas-in.*',
    'as-override',
    'remove-private-as.*',
    'weight',
  ].map((r) => `address-family.${family}.${r}`);

const BGP_PEER_BASIC = [
  'description',
  'remote-as',
  'update-source',
  'ebgp-multihop',
  'password',
  'shutdown',
  'passive',
  'disable-connected-check',
  'timers.*',
  'bfd.*',
  'interface.*',
  ...afBasic('ipv4-unicast'),
  ...afBasic('ipv6-unicast'),
  ...afBasic('l2vpn-evpn'),
];

const OSPF_INTERFACE_BASIC = ['area', 'cost', 'network', 'passive', 'passive.disable', 'priority', 'hello-interval', 'dead-interval', 'authentication.*', 'bfd.*', 'mtu-ignore', 'bandwidth'];

// ---------------------------------------------------------------- specs

const table = (id: string, label: string, path: string[], keyLabel: string, columns: RuleColumn[], basic: string[] = ['*'], numeric = false): RuleTab => ({
  id,
  label,
  path,
  keyLabel,
  numeric,
  columns,
  basic,
});

export const ROUTING_SPECS: Record<RoutingSlug, RoutingSpec> = {
  static: {
    slug: 'static',
    scope: 'static',
    title: 'Static routes',
    intro: 'Fixed IPv4 and IPv6 routes with next-hop addresses or interfaces, blackhole and reject sinks, and extra routing tables for policy routing.',
    tablesFirst: true,
    omit: ['arp', 'multicast', 'mroute', 'neighbor-proxy'],
    tables: [
      table('route', 'IPv4 routes', ['route'], 'Route', [description, nextHops], ROUTE_BASIC),
      table('route6', 'IPv6 routes', ['route6'], 'Route', [description, nextHops], [...ROUTE_BASIC, 'next-hop.segments', 'interface.segments']),
      table('table', 'Tables', ['table'], 'Table', [description, count('route', 'IPv4 routes'), count('route6', 'IPv6 routes')], ['*'], true),
    ],
    basic: ['*'],
  },
  arp: {
    slug: 'arp',
    scope: 'static',
    part: true,
    title: 'ARP',
    intro: 'Static ARP entries per interface, and selective proxy ARP / neighbor discovery for individual addresses.',
    tables: [
      table('arp', 'Static ARP', ['arp', 'interface'], 'Interface', [keysCol('address', 'Entries', (ip, e) => `${ip} → ${v(e, 'mac') || '?'}`)]),
      table('proxy-arp', 'Proxy ARP', ['neighbor-proxy', 'arp'], 'Address', [interfaces('interface')]),
      table('proxy-nd', 'Proxy ND', ['neighbor-proxy', 'nd'], 'Address', [interfaces('interface')]),
    ],
    basic: ['*'],
  },
  multicast: {
    slug: 'multicast',
    scope: 'static',
    part: true,
    title: 'Multicast routes',
    intro: 'Static routes into the multicast RIB, used for reverse-path forwarding checks: by next-hop address or by interface.',
    tables: [
      // 1.4 and 1.5: `static multicast route` / `interface-route`; rolling folded both into `static mroute`.
      table('route', 'Routes', ['multicast', 'route'], 'Source prefix', [keysCol('next-hop', 'Next hops', (k, e) => k + (v(e, 'distance') ? ` (${v(e, 'distance')})` : ''))]),
      table('interface-route', 'Interface routes', ['multicast', 'interface-route'], 'Source prefix', [
        keysCol('next-hop-interface', 'Interfaces', (k, e) => k + (v(e, 'distance') ? ` (${v(e, 'distance')})` : '')),
      ]),
      table('mroute', 'Routes', ['mroute'], 'Source prefix', [
        keysCol('next-hop', 'Next hops', (k, e) => k + (v(e, 'distance') ? ` (${v(e, 'distance')})` : '')),
        keysCol('interface', 'Interfaces', (k, e) => k + (v(e, 'distance') ? ` (${v(e, 'distance')})` : '')),
      ]),
    ],
    basic: ['*'],
  },
  bgp: {
    slug: 'bgp',
    scope: 'bgp',
    title: 'BGP',
    intro: 'Border Gateway Protocol: the local AS, neighbors and peer groups, the networks and redistribution per address family, and route policy.',
    tables: [
      table(
        'neighbor',
        'Neighbors',
        ['neighbor'],
        'Neighbor',
        [description, col('remote-as', 'Remote AS'), col('peer-group', 'Peer group'), col('update-source', 'Update source'), addressFamilies, flagsCol(['shutdown', 'passive', 'bfd'], 'Flags', { bfd: 'info' })],
        ['peer-group', ...BGP_PEER_BASIC],
      ),
      table(
        'peer-group',
        'Peer groups',
        ['peer-group'],
        'Peer group',
        [description, col('remote-as', 'Remote AS'), col('update-source', 'Update source'), addressFamilies, flagsCol(['shutdown', 'passive', 'bfd'], 'Flags', { bfd: 'info' })],
        BGP_PEER_BASIC,
      ),
      table('interface', 'Interfaces', ['interface'], 'Interface', [flagsCol(['mpls.forwarding'], 'MPLS')]),
    ],
    basic: [
      'system-as',
      'parameters.router-id',
      'parameters.log-neighbor-changes',
      'parameters.ebgp-requires-policy',
      'parameters.default.*',
      'parameters.cluster-id',
      'parameters.graceful-restart.*',
      'parameters.shutdown',
      'address-family.ipv4-unicast.network.*',
      'address-family.ipv4-unicast.redistribute.*',
      'address-family.ipv4-unicast.aggregate-address.*',
      'address-family.ipv4-unicast.maximum-paths.*',
      'address-family.ipv6-unicast.network.*',
      'address-family.ipv6-unicast.redistribute.*',
      'address-family.ipv6-unicast.aggregate-address.*',
      'address-family.ipv6-unicast.maximum-paths.*',
      'timers.*',
      'listen.*',
    ],
  },
  ospf: {
    slug: 'ospf',
    scope: 'ospf',
    title: 'OSPF',
    intro: 'OSPFv2 for IPv4: areas and the networks in them, per-interface timers, costs and authentication, and what gets redistributed.',
    tables: [
      table('area', 'Areas', ['area'], 'Area', [areaType, col('network', 'Networks'), keysCol('range', 'Ranges'), col('authentication', 'Authentication')], ['area-type.*', 'network', 'range.cost', 'range.not-advertise', 'authentication', 'shortcut']),
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('area', 'Area'), col('cost', 'Cost'), col('network', 'Network type'), col('hello-interval', 'Hello'), col('dead-interval', 'Dead'), flagsCol(['passive', 'bfd', 'mtu-ignore'], 'Flags', { bfd: 'info' })],
        OSPF_INTERFACE_BASIC,
      ),
      table('neighbor', 'Neighbors', ['neighbor'], 'Neighbor', [col('priority', 'Priority'), col('poll-interval', 'Poll interval')]),
      table('summary-address', 'Summary addresses', ['summary-address'], 'Prefix', [col('tag', 'Tag'), flagsCol(['no-advertise'])]),
      table('access-list', 'Access lists', ['access-list'], 'Access list', [col('export', 'Export')], ['*'], true),
    ],
    basic: [
      'parameters.router-id',
      'parameters.abr-type',
      'default-information.originate.*',
      'redistribute.*',
      'passive-interface',
      'maximum-paths',
      'auto-cost.*',
      'log-adjacency-changes.*',
      'distance.*',
      'default-metric',
    ],
  },
  ospfv3: {
    slug: 'ospfv3',
    scope: 'ospfv3',
    title: 'OSPFv3',
    intro: 'OSPF for IPv6: areas, the interfaces that run in them, and redistribution into the IPv6 topology.',
    tables: [
      table('area', 'Areas', ['area'], 'Area', [areaType, keysCol('range', 'Ranges'), col('export-list', 'Export list'), col('import-list', 'Import list')], ['area-type.*', 'range.*', 'export-list', 'import-list']),
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('area', 'Area'), col('cost', 'Cost'), col('network', 'Network type'), col('hello-interval', 'Hello'), col('dead-interval', 'Dead'), flagsCol(['passive', 'bfd', 'mtu-ignore'], 'Flags', { bfd: 'info' })],
        [...OSPF_INTERFACE_BASIC, 'instance-id'],
      ),
    ],
    basic: ['parameters.router-id', 'default-information.originate.*', 'redistribute.*', 'auto-cost.*', 'log-adjacency-changes.*', 'distance.*'],
  },
  isis: {
    slug: 'isis',
    scope: 'isis',
    title: 'IS-IS',
    intro: 'Intermediate System to Intermediate System: the NET and level of this router, per-circuit settings, and redistribution into the link-state domain.',
    tables: [
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('circuit-type', 'Circuit type'), col('metric', 'Metric'), col('hello-interval', 'Hello'), col('priority', 'Priority'), flagsCol(['network.point-to-point', 'passive', 'bfd', 'hello-padding'], 'Flags', { bfd: 'info' })],
        ['circuit-type', 'metric', 'network.*', 'passive', 'hello-interval', 'hello-multiplier', 'priority', 'bfd.*', 'password.*'],
      ),
    ],
    basic: [
      'net',
      'level',
      'dynamic-hostname',
      'log-adjacency-changes',
      'metric-style',
      'redistribute.*',
      'default-information.*',
      'area-password.*',
      'domain-password.*',
      'lsp-mtu',
      'set-overload-bit',
      'topology',
    ],
  },
  openfabric: {
    slug: 'openfabric',
    scope: 'openfabric',
    title: 'OpenFabric',
    intro: 'Link-state routing for spine-leaf fabrics (FRR fabricd): one NET for the router, then one domain with the interfaces that take part.',
    tables: [
      table(
        'domain',
        'Domains',
        ['domain'],
        'Domain',
        [keysCol('interface', 'Interfaces'), col('fabric-tier', 'Tier'), flagsCol(['log-adjacency-changes', 'set-overload-bit'])],
        ['interface.metric', 'interface.passive', 'interface.hello-interval', 'interface.hello-multiplier', 'interface.address-family.*', 'domain-password.*', 'fabric-tier', 'log-adjacency-changes', 'set-overload-bit'],
      ),
    ],
    basic: ['*'],
  },
  rip: {
    slug: 'rip',
    scope: 'rip',
    title: 'RIP',
    intro: 'Routing Information Protocol for IPv4: the networks and neighbors to speak to, passive interfaces, per-interface authentication and versions, and redistribution.',
    tables: [
      table('interface', 'Interfaces', ['interface'], 'Interface', [col('receive.version', 'Receive'), col('send.version', 'Send'), flagsCol(['split-horizon.disable', 'split-horizon.poison-reverse', 'authentication'], 'Flags')]),
      table('network-distance', 'Network distances', ['network-distance'], 'Network', [col('distance', 'Distance'), col('access-list', 'Access list')]),
    ],
    basic: ['network', 'neighbor', 'passive-interface', 'redistribute.*', 'default-information.*', 'default-metric', 'default-distance', 'route', 'version', 'route-map'],
  },
  ripng: {
    slug: 'ripng',
    scope: 'ripng',
    title: 'RIPng',
    intro: 'RIP for IPv6: networks, passive interfaces, aggregate announcements and redistribution.',
    tables: [table('interface', 'Interfaces', ['interface'], 'Interface', [flagsCol(['split-horizon.disable', 'split-horizon.poison-reverse'], 'Split horizon')])],
    basic: ['network', 'passive-interface', 'redistribute.*', 'default-information.*', 'default-metric', 'route', 'aggregate-address', 'route-map'],
  },
  babel: {
    slug: 'babel',
    scope: 'babel',
    title: 'Babel',
    intro: 'Babel distance-vector routing for wired and wireless meshes: the interfaces it runs on and what is redistributed into it.',
    tables: [
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('type', 'Type'), col('split-horizon', 'Split horizon'), col('hello-interval', 'Hello'), col('rxcost', 'RX cost'), col('channel', 'Channel'), flagsCol(['enable-timestamps'], 'Flags')],
        ['type', 'split-horizon', 'hello-interval', 'update-interval', 'rxcost', 'enable-timestamps'],
      ),
    ],
    basic: ['*'],
  },
  eigrp: {
    slug: 'eigrp',
    scope: 'eigrp',
    title: 'EIGRP',
    intro: 'Enhanced Interior Gateway Routing Protocol (FRR eigrpd): the AS number, networks, passive interfaces and redistribution. VyOS ships it without documentation; treat it as experimental.',
    tables: [],
    basic: ['*'],
  },
  bfd: {
    slug: 'bfd',
    scope: 'bfd',
    title: 'BFD',
    intro: 'Bidirectional Forwarding Detection: peers to probe (referenced from BGP, OSPF, IS-IS and static routes) and reusable timer profiles.',
    tablesFirst: true,
    tables: [
      table(
        'peer',
        'Peers',
        ['peer'],
        'Peer',
        [col('source.interface', 'Source interface'), col('source.address', 'Source address'), col('profile', 'Profile'), bfdInterval, col('vrf', 'VRF'), flagsCol(['multihop', 'passive', 'echo-mode', 'shutdown'])],
      ),
      table('profile', 'Profiles', ['profile'], 'Profile', [bfdInterval, col('minimum-ttl', 'Min TTL'), flagsCol(['passive', 'echo-mode', 'shutdown'])]),
    ],
    basic: ['*'],
  },
  mpls: {
    slug: 'mpls',
    scope: 'mpls',
    title: 'MPLS',
    intro: 'Label switching: the interfaces that forward labelled packets, and LDP for distributing labels to neighbors.',
    tables: [table('neighbor', 'LDP neighbors', ['ldp', 'neighbor'], 'Neighbor', [col('session-holdtime', 'Session holdtime'), col('ttl-security', 'TTL security'), flagsCol(['password'], 'Auth')])],
    basic: [
      'interface',
      'ldp.interface',
      'ldp.router-id',
      'ldp.discovery.transport-ipv4-address',
      'ldp.discovery.transport-ipv6-address',
      'ldp.allocation.*',
      'ldp.export.*',
      'ldp.import.*',
      'ldp.parameters.*',
      'parameters.*',
    ],
  },
  'segment-routing': {
    slug: 'segment-routing',
    scope: 'segment-routing',
    title: 'Segment routing',
    intro: 'SRv6 locators this router owns, and how SR-enabled IPv6 packets are accepted per interface. IGP label ranges live under OSPF and IS-IS.',
    tablesFirst: true,
    tables: [
      table('locator', 'SRv6 locators', ['srv6', 'locator'], 'Locator', [col('prefix', 'Prefix'), col('block-len', 'Block bits'), col('node-len', 'Node bits'), col('func-bits', 'Function bits'), flagsCol(['behavior-usid'], 'uSID')]),
      table('interface', 'Interfaces', ['interface'], 'Interface', [col('srv6.hmac', 'HMAC policy')]),
    ],
    basic: ['*'],
  },
  'traffic-engineering': {
    slug: 'traffic-engineering',
    scope: 'traffic-engineering',
    title: 'Traffic engineering',
    intro: 'Link parameters advertised by the IGPs for MPLS-TE: per-interface metric and bandwidth, and the administrative groups interfaces belong to.',
    tablesFirst: true,
    tables: [
      table('interface', 'Interfaces', ['interface'], 'Interface', [col('metric', 'TE metric'), col('max-bandwidth', 'Max bandwidth'), col('max-reservable-bandwidth', 'Max reservable'), col('admin-group', 'Admin groups')]),
      table('admin-group', 'Admin groups', ['admin-group'], 'Group', [col('bit-position', 'Bit')]),
    ],
    basic: ['*'],
  },
  pim: {
    slug: 'pim',
    scope: 'pim',
    title: 'PIM',
    intro: 'Protocol Independent Multicast for IPv4 (sparse mode) with IGMP on the interfaces that face receivers, and the rendezvous points for group ranges.',
    tables: [
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('dr-priority', 'DR priority'), col('hello', 'Hello'), col('igmp.version', 'IGMP version'), keysCol('igmp.join', 'Joins'), flagsCol(['passive', 'bfd', 'igmp.disable'], 'Flags', { bfd: 'info' })],
        ['dr-priority', 'hello', 'passive', 'igmp.*', 'bfd.*', 'source-address'],
      ),
      table('rp', 'Rendezvous points', ['rp', 'address'], 'RP address', [col('group', 'Groups')]),
    ],
    basic: ['*'],
  },
  pim6: {
    slug: 'pim6',
    scope: 'pim6',
    title: 'PIM6',
    intro: 'Protocol Independent Multicast for IPv6 with MLD on receiver-facing interfaces, and the rendezvous points for group ranges.',
    tables: [
      table(
        'interface',
        'Interfaces',
        ['interface'],
        'Interface',
        [col('dr-priority', 'DR priority'), col('hello', 'Hello'), col('mld.version', 'MLD version'), keysCol('mld.join', 'Joins'), flagsCol(['passive', 'mld.disable'], 'Flags')],
        ['dr-priority', 'hello', 'passive', 'mld.*'],
      ),
      table('rp', 'Rendezvous points', ['rp', 'address'], 'RP address', [col('group', 'Groups'), col('prefix-list6', 'Prefix list')]),
    ],
    basic: ['*'],
  },
  'igmp-proxy': {
    slug: 'igmp-proxy',
    scope: 'igmp-proxy',
    title: 'IGMP proxy',
    intro: 'Forward multicast from one upstream interface to downstream interfaces by proxying IGMP membership, without running PIM.',
    tablesFirst: true,
    tables: [table('interface', 'Interfaces', ['interface'], 'Interface', [col('role', 'Role'), col('threshold', 'TTL threshold'), col('alt-subnet', 'Alternate subnets'), col('whitelist', 'Whitelist')])],
    basic: ['*'],
  },
  rpki: {
    slug: 'rpki',
    scope: 'rpki',
    title: 'RPKI',
    intro: 'Resource Public Key Infrastructure: the validating caches BGP asks about route origins, over plain TCP or SSH.',
    tablesFirst: true,
    tables: [table('cache', 'Cache servers', ['cache'], 'Cache', [col('port', 'Port'), col('preference', 'Preference'), col('ssh.username', 'SSH user'), col('ssh.key', 'SSH key')])],
    basic: ['*'],
  },
  failover: {
    slug: 'failover',
    scope: 'failover',
    title: 'Failover routes',
    intro: 'IPv4 routes whose next hops are health-checked (ICMP, ARP or TCP) and withdrawn when the check fails, for dual-WAN style setups.',
    tables: [
      table('route', 'Routes', ['route'], 'Route', [
        keysCol('next-hop', 'Next hops', (k, e) => k + (v(e, 'interface') ? ` via ${v(e, 'interface')}` : '') + (v(e, 'metric') ? ` metric ${v(e, 'metric')}` : '') + (v(e, 'check.target') ? ` → ${v(e, 'check.type') || 'icmp'} ${v(e, 'check.target')}` : '')),
      ]),
    ],
    basic: ['*'],
  },
  nhrp: {
    slug: 'nhrp',
    scope: 'nhrp',
    title: 'NHRP',
    intro: 'Next Hop Resolution Protocol on mGRE tunnels (DMVPN): hub mappings, shortcuts and redirects per tunnel interface.',
    tables: [
      table('tunnel', 'Tunnels', ['tunnel'], 'Tunnel', [
        keysCol('map', 'Hub maps', (k, e) => `${k} → ${v(e, 'nbma-address') || '?'}`),
        keysCol('dynamic-map', 'Dynamic maps', (k, e) => `${k} → ${v(e, 'nbma-domain-name') || '?'}`),
        col('multicast', 'Multicast'),
        col('holding-time', 'Holding time'),
        flagsCol(['shortcut', 'redirect', 'non-caching', 'shortcut-destination']),
      ]),
    ],
    basic: ['*'],
  },
};
