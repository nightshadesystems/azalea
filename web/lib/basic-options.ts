// Which options count as Basic, per interface kind. Paths are schema
// names relative to the interface node with tag keys left out
// (`peer.allowed-ips`, not `peer.hq.allowed-ips`); `x.*` takes a whole
// subtree. Everything else is Advanced and only shown on request.

import type { InterfaceKind } from './types';
import type { SchemaNode } from './vyos-schema';

const COMMON = ['address', 'description', 'disable', 'mtu', 'mac', 'vrf'];

const BASIC: Partial<Record<InterfaceKind, string[]>> = {
  bonding: [...COMMON, 'mode', 'member', 'member.interface', 'hash-policy', 'lacp-rate', 'primary', 'min-links', 'mii-mon-interval', 'arp-monitor.*'],
  bridge: [
    ...COMMON,
    'member.interface',
    'member.interface.native-vlan',
    'member.interface.allowed-vlan',
    'member.interface.cost',
    'member.interface.priority',
    'stp',
    'enable-vlan',
    'priority',
    'aging',
    'forwarding-delay',
    'hello-time',
    'max-age',
  ],
  dummy: COMMON,
  ethernet: COMMON,
  geneve: [...COMMON, 'remote', 'vni'],
  l2tpv3: [...COMMON, 'source-address', 'remote', 'encapsulation', 'tunnel-id', 'peer-tunnel-id', 'session-id', 'peer-session-id', 'source-port', 'destination-port'],
  loopback: ['address', 'description'],
  macsec: [...COMMON, 'source-interface', 'security.cipher', 'security.encrypt', 'security.mka.cak', 'security.mka.ckn', 'security.static.*'],
  openvpn: [
    ...COMMON,
    'mode',
    'protocol',
    'device-type',
    'local-host',
    'local-port',
    'remote-host',
    'remote-port',
    'local-address.*',
    'remote-address',
    'shared-secret-key',
    'tls.certificate',
    'tls.ca-certificate',
    'tls.dh-params',
    'tls.role',
    'tls.auth-key',
    'tls.crypt-key',
    'tls.peer-fingerprint',
    'authentication.*',
    'server.subnet',
    'server.client-ip-pool.*',
    'server.name-server',
    'server.push-route.*',
    'server.domain-name',
    'server.topology',
    'server.max-connections',
    'server.client.*',
    'encryption.*',
    'hash',
  ],
  wireguard: [...COMMON, 'port', 'private-key', 'peer.public-key', 'peer.preshared-key', 'peer.allowed-ips', 'peer.address', 'peer.port', 'peer.persistent-keepalive', 'peer.description', 'peer.disable'],
  pppoe: [
    ...COMMON,
    'source-interface',
    'authentication.*',
    'no-default-route',
    'default-route-distance',
    'no-peer-dns',
    'service-name',
    'local-address',
    'remote-address',
    'connect-on-demand',
    'idle-timeout',
    'access-concentrator',
  ],
  'pseudo-ethernet': [...COMMON, 'source-interface', 'mode'],
  sstpc: [...COMMON, 'server', 'port', 'authentication.*', 'ssl.*', 'no-default-route', 'default-route-distance', 'no-peer-dns'],
  tunnel: [...COMMON, 'encapsulation', 'source-address', 'source-interface', 'remote', 'enable-multicast', '6rd-prefix', '6rd-relay-prefix'],
  'virtual-ethernet': [...COMMON, 'peer-name'],
  vti: COMMON,
  vxlan: [...COMMON, 'vni', 'remote', 'source-address', 'source-interface', 'port', 'group'],
  wireless: [...COMMON, 'ssid', 'channel', 'mode', 'type', 'physical-device', 'security.wpa.mode', 'security.wpa.passphrase', 'security.wpa.cipher', 'disable-broadcast-ssid', 'max-stations', 'isolate-stations'],
  wwan: [...COMMON, 'apn', 'authentication.*', 'connect-on-demand'],
  vlan: COMMON,
};

/** Whether a schema path (names only, no tag keys) is Basic for this kind. */
export function isBasic(kind: InterfaceKind, path: string[]): boolean {
  const rules = BASIC[kind] ?? COMMON;
  const key = path.join('.');
  return rules.some((rule) => {
    if (rule.endsWith('.*')) {
      const head = rule.slice(0, -2);
      return key === head || key.startsWith(head + '.');
    }
    // Exact, or an ancestor of something Basic (so the group is reachable).
    return rule === key || rule.startsWith(key + '.');
  });
}

/** The schema with only Basic children, recursively; the node itself is kept. */
export function basicSchema(node: SchemaNode, kind: InterfaceKind, path: string[] = []): SchemaNode {
  if (!node.children) return node;
  const children = node.children
    .filter((c) => isBasic(kind, [...path, c.name]))
    .map((c) => (c.kind === 'leaf' ? c : basicSchema(c, kind, [...path, c.name])));
  return { ...node, children };
}

/** Leaves under a node, counting through groups and tag lists. */
export function countLeaves(node: SchemaNode): number {
  return (node.children ?? []).reduce((n, c) => n + (c.kind === 'leaf' ? 1 : countLeaves(c)), 0);
}
