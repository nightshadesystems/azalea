// Shared shape of the entry tables on the NAT and Routing pages: one
// tab per VyOS tag node (`nat source rule`, `protocols bgp neighbor`),
// with the columns that summarise an entry and the fields that count
// as Basic when editing one. The renderers here cover the common
// cases; each area adds its own beside its specs.

import React from 'react';
import type { CfgNode } from './types';
import { getIn, humanize, isTree, leafValues, type CfgTree } from './vyos-schema';
import { Label, type Status } from '@/components/ds/misc';

export interface RuleColumn {
  key: string;
  label: string;
  render: (entry: CfgTree) => React.ReactNode;
}

export interface RuleTab {
  id: string;
  label: string;
  /** Path of the tag node relative to the scope node, e.g. ["source", "rule"]. */
  path: string[];
  /** What the tag key is called: "Rule", "Neighbor". */
  keyLabel: string;
  /** Sort keys numerically (rule numbers) or by name. */
  numeric: boolean;
  columns: RuleColumn[];
  /** Basic-view rules relative to one entry; `*` shows everything. */
  basic: string[];
}

/** "Neighbor" → "neighbor" for prose, but "RP address" stays as it is. */
export const nounOf = (keyLabel: string): string => keyLabel.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());

export const dash = <span className="dim">—</span>;
export const mono = (s: string) => <span className="cell-mono">{s}</span>;

/** A leaf's values at a dotted path, joined. */
export const v = (t: CfgNode | undefined, path: string): string => leafValues(getIn(t, path.split('.'))).join(', ');

/** The keys of a tag node at a dotted path. */
export const keysAt = (t: CfgNode | undefined, path: string): string[] => {
  const n = getIn(t, path.split('.'));
  return isTree(n) ? Object.keys(n) : [];
};

/** A leaf's value at a dotted path, in monospace; a dash when unset. */
export function col(path: string, label: string = humanize(path.split('.').pop() ?? path)): RuleColumn {
  return { key: path, label, render: (t) => (v(t, path) ? mono(v(t, path)) : dash) };
}

/**
 * The keys of a tag node at a dotted path (the address families a BGP
 * neighbor activates, a route's next hops), each optionally summarised
 * with something from its entry.
 */
export function keysCol(path: string, label: string, summarise?: (key: string, entry: CfgTree) => string): RuleColumn {
  return {
    key: path,
    label,
    render: (t) => {
      const n = getIn(t, path.split('.'));
      if (!isTree(n)) return dash;
      const keys = Object.keys(n);
      if (!keys.length) return dash;
      return mono(keys.map((k) => (summarise ? summarise(k, isTree(n[k]) ? (n[k] as CfgTree) : {}) : k)).join(', '));
    },
  };
}

/** Which of the named flags (valueless leaves, or nodes) are present, as labels. */
export function flagsCol(names: string[], label = 'Flags', status: Partial<Record<string, Status>> = {}): RuleColumn {
  return {
    key: 'flags:' + names.join(','),
    label,
    render: (t) => {
      const out = names.filter((n) => getIn(t, n.split('.')) !== undefined);
      if (!out.length) return dash;
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {out.map((n) => (
            <Label key={n} status={status[n]}>
              {humanize(n.split('.').pop() ?? n)}
            </Label>
          ))}
        </span>
      );
    },
  };
}

export const description: RuleColumn = col('description', 'Description');
