// What each NAT page tabulates: one tab per rule table (a VyOS tag
// node such as `nat source rule`), with the columns that summarise a
// rule and the fields that count as Basic when editing one.

import React from 'react';
import { getIn, isTree, type CfgTree } from './vyos-schema';
import { Label } from '@/components/ds/misc';
import { dash, mono, v, type RuleColumn, type RuleTab } from './config-tables';

export type { RuleColumn, RuleTab } from './config-tables';

export type NatScope = 'nat44' | 'nat64' | 'nat66' | 'cgnat';

export interface NatSpec {
  scope: NatScope;
  title: string;
  intro: string;
  tabs: RuleTab[];
}

/** An interface match: a plain leaf, or a node with `name` / `group`. */
function iface(t: CfgTree, node: string): React.ReactNode {
  const n = getIn(t, [node]);
  if (typeof n === 'string') return mono(n);
  const name = v(n, 'name');
  const group = v(n, 'group');
  if (name) return mono(name);
  if (group) return mono(`group ${group}`);
  return dash;
}

/** `address[:port]` or `prefix` under a match node. */
function endpoint(t: CfgTree, node: string): React.ReactNode {
  const addr = v(t, `${node}.address`) || v(t, `${node}.prefix`);
  const port = v(t, `${node}.port`);
  if (!addr && !port) return dash;
  return mono(port ? `${addr || 'any'}:${port}` : addr);
}

function translation(t: CfgTree): React.ReactNode {
  const addr = v(t, 'translation.address');
  const port = v(t, 'translation.port');
  const redirect = v(t, 'translation.redirect.port');
  if (redirect) return mono(`redirect :${redirect}`);
  if (!addr && !port) return dash;
  return mono(port ? `${addr || 'same'}:${port}` : addr);
}

/** Disabled / exclude / log markers. */
function flags(t: CfgTree): React.ReactNode {
  const out: React.ReactNode[] = [];
  if (getIn(t, ['disable']) !== undefined) out.push(<Label key="d">Disabled</Label>);
  if (getIn(t, ['exclude']) !== undefined) out.push(<Label key="e" status="warning">Exclude</Label>);
  if (getIn(t, ['log']) !== undefined) out.push(<Label key="l" status="info">Log</Label>);
  return out.length ? <span style={{ display: 'inline-flex', gap: 4 }}>{out}</span> : dash;
}

const description: RuleColumn = { key: 'description', label: 'Description', render: (t) => v(t, 'description') || dash };
const protocol: RuleColumn = { key: 'protocol', label: 'Protocol', render: (t) => (v(t, 'protocol') ? mono(v(t, 'protocol')) : <span className="dim">all</span>) };
const state: RuleColumn = { key: 'state', label: 'Flags', render: flags };

const NAT44_SOURCE_BASIC = [
  'description',
  'disable',
  'outbound-interface.name',
  'source.address',
  'source.port',
  'destination.address',
  'destination.port',
  'protocol',
  'translation.address',
  'translation.port',
  'exclude',
];

export const NAT_SPECS: Record<NatScope, NatSpec> = {
  nat44: {
    scope: 'nat44',
    title: 'NAT44',
    intro: 'IPv4 source (masquerade, SNAT), destination (port forwarding, DNAT) and static one-to-one rules.',
    tabs: [
      {
        id: 'source',
        label: 'Source',
        path: ['source', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'out', label: 'Out interface', render: (t) => iface(t, 'outbound-interface') },
          { key: 'src', label: 'Source', render: (t) => endpoint(t, 'source') },
          { key: 'dst', label: 'Destination', render: (t) => endpoint(t, 'destination') },
          protocol,
          { key: 'xlate', label: 'Translation', render: translation },
          state,
        ],
        basic: NAT44_SOURCE_BASIC,
      },
      {
        id: 'destination',
        label: 'Destination',
        path: ['destination', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'in', label: 'In interface', render: (t) => iface(t, 'inbound-interface') },
          { key: 'src', label: 'Source', render: (t) => endpoint(t, 'source') },
          { key: 'dst', label: 'Destination', render: (t) => endpoint(t, 'destination') },
          protocol,
          { key: 'xlate', label: 'Translation', render: translation },
          state,
        ],
        basic: NAT44_SOURCE_BASIC.map((r) => r.replace('outbound-interface', 'inbound-interface')),
      },
      {
        id: 'static',
        label: 'Static',
        path: ['static', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'in', label: 'In interface', render: (t) => iface(t, 'inbound-interface') },
          { key: 'dst', label: 'Destination', render: (t) => endpoint(t, 'destination') },
          { key: 'xlate', label: 'Translation', render: (t) => (v(t, 'translation.address') ? mono(v(t, 'translation.address')) : dash) },
          state,
        ],
        basic: ['*'],
      },
    ],
  },
  nat64: {
    scope: 'nat64',
    title: 'NAT64',
    intro: 'Translate IPv6-only clients to IPv4: a source prefix (usually 64:ff9b::/96) and the IPv4 pool to map it onto.',
    tabs: [
      {
        id: 'source',
        label: 'Source',
        path: ['source', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'src', label: 'Source prefix', render: (t) => (v(t, 'source.prefix') ? mono(v(t, 'source.prefix')) : dash) },
          { key: 'mark', label: 'Match mark', render: (t) => (v(t, 'match.mark') ? mono(v(t, 'match.mark')) : dash) },
          {
            key: 'pools',
            label: 'Translation pools',
            render: (t) => {
              const pools = getIn(t, ['translation', 'pool']);
              if (!isTree(pools) || Object.keys(pools).length === 0) return dash;
              return mono(
                Object.entries(pools)
                  .map(([k, p]) => `${k}: ${v(p, 'address') || '?'}${v(p, 'port') ? ' ' + v(p, 'port') : ''}`)
                  .join(' · '),
              );
            },
          },
          state,
        ],
        basic: ['*'],
      },
    ],
  },
  nat66: {
    scope: 'nat66',
    title: 'NAT66',
    intro: 'IPv6 prefix translation (NPTv6): source and destination rules rewriting prefixes between networks.',
    tabs: [
      {
        id: 'source',
        label: 'Source',
        path: ['source', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'out', label: 'Out interface', render: (t) => iface(t, 'outbound-interface') },
          { key: 'src', label: 'Source', render: (t) => endpoint(t, 'source') },
          { key: 'dst', label: 'Destination', render: (t) => endpoint(t, 'destination') },
          protocol,
          { key: 'xlate', label: 'Translation', render: translation },
          state,
        ],
        basic: ['description', 'disable', 'outbound-interface.name', 'source.prefix', 'destination.prefix', 'translation.address', 'exclude'],
      },
      {
        id: 'destination',
        label: 'Destination',
        path: ['destination', 'rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          description,
          { key: 'in', label: 'In interface', render: (t) => iface(t, 'inbound-interface') },
          { key: 'src', label: 'Source', render: (t) => endpoint(t, 'source') },
          { key: 'dst', label: 'Destination', render: (t) => endpoint(t, 'destination') },
          protocol,
          { key: 'xlate', label: 'Translation', render: translation },
          state,
        ],
        basic: ['description', 'disable', 'inbound-interface.name', 'source.address', 'destination.address', 'translation.address', 'exclude'],
      },
    ],
  },
  cgnat: {
    scope: 'cgnat',
    title: 'CGNAT',
    intro: 'Carrier-grade NAT: internal pools of subscriber addresses mapped onto external pools with per-user port allocations.',
    tabs: [
      {
        id: 'rule',
        label: 'Rules',
        path: ['rule'],
        keyLabel: 'Rule',
        numeric: true,
        columns: [
          { key: 'src', label: 'Source pool', render: (t) => (v(t, 'source.pool') ? mono(v(t, 'source.pool')) : dash) },
          { key: 'xlate', label: 'Translation pool', render: (t) => (v(t, 'translation.pool') ? mono(v(t, 'translation.pool')) : dash) },
        ],
        basic: ['*'],
      },
      {
        id: 'external',
        label: 'External pools',
        path: ['pool', 'external'],
        keyLabel: 'Pool',
        numeric: false,
        columns: [
          {
            key: 'ranges',
            label: 'Address ranges',
            render: (t) => {
              const r = getIn(t, ['range']);
              return isTree(r) && Object.keys(r).length ? mono(Object.keys(r).join(', ')) : dash;
            },
          },
          { key: 'ports', label: 'External ports', render: (t) => (v(t, 'external-port-range') ? mono(v(t, 'external-port-range')) : dash) },
          { key: 'limit', label: 'Ports per user', render: (t) => (v(t, 'per-user-limit.port') ? mono(v(t, 'per-user-limit.port')) : dash) },
        ],
        basic: ['*'],
      },
      {
        id: 'internal',
        label: 'Internal pools',
        path: ['pool', 'internal'],
        keyLabel: 'Pool',
        numeric: false,
        columns: [{ key: 'range', label: 'Subscriber range', render: (t) => (v(t, 'range') ? mono(v(t, 'range')) : dash) }],
        basic: ['*'],
      },
    ],
  },
};
