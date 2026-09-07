'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { humanize, isTree, renderCommands, type CfgTree, type Changes, type Complaint, type SchemaNode } from '@/lib/vyos-schema';
import { setDetail } from '@/lib/detail';
import { Badge } from '@/components/ds/misc';
import { ChildrenEditor, GroupPanel, TagList, type EditorContext } from '@/components/ConfigTreeEditor';

export interface SchemaEditorProps {
  /** The node being edited, already trimmed to the detail level. */
  schema: SchemaNode;
  /** How many advanced leaves the trim hid. */
  hidden: number;
  tree: CfgTree;
  onChange: (tree: CfgTree) => void;
  /** Full config path of the node, for the command preview. Empty hides it. */
  path: string[];
  changes: Changes;
  complaints: Complaint[];
  ctx: EditorContext;
  /** Extra controls at the top of General (a new interface's name). */
  before?: React.ReactNode;
  /** Counts against General's badge (a bad new name). */
  generalError?: boolean;
}

/**
 * A section list on the left (General for the node's own leaves, one
 * entry per group or tag list) and the active section on the right,
 * with the hidden-option hint and the command preview underneath.
 */
export function SchemaEditor({ schema, hidden, tree, onChange, path, changes, complaints, ctx, before, generalError }: SchemaEditorProps) {
  const [tab, setTab] = useState('general');
  const sections = useMemo(() => {
    const children = schema.children ?? [];
    const groups = children.filter((c) => c.kind !== 'leaf' && (c.children?.length ?? 0) > 0);
    // General holds the node's own leaves; a node with none (NAT) starts at its first group.
    const general = children.some((c) => c.kind === 'leaf') || before ? [{ id: 'general', label: 'General', node: null as SchemaNode | null }] : [];
    return [...general, ...groups.map((g) => ({ id: g.name, label: humanize(g.name), node: g as SchemaNode | null }))];
  }, [schema, before]);
  // A section can vanish when the detail level changes.
  useEffect(() => {
    if (!sections.some((s) => s.id === tab)) setTab(sections[0]?.id ?? 'general');
  }, [sections, tab]);

  const complaintsIn = (id: string) =>
    complaints.filter((c) => (id === 'general' ? !sections.some((s) => s.id !== 'general' && s.id === c.path[0]) : c.path[0] === id)).length +
    (id === 'general' && generalError ? 1 : 0);
  const nChanges = changes.set.length + changes.delete.length;
  const active = sections.find((s) => s.id === tab) ?? sections[0]!;
  const setChild = (name: string, v: CfgTree | undefined) => {
    const next = { ...tree };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  const childTree = (name: string): CfgTree | undefined => (isTree(tree[name]) ? (tree[name] as CfgTree) : undefined);

  return (
    <div className="cfg-layout">
      <nav className="clr-tabs clr-tabs-vertical cfg-sections" aria-label="Sections">
        <div className="clr-tabs-list" role="tablist">
          {sections.map((s) => {
            const n = complaintsIn(s.id);
            const present = s.node ? tree[s.node.name] !== undefined : true;
            return (
              <button key={s.id} type="button" role="tab" className={'clr-tab-link' + (present ? '' : ' cfg-section-off')} aria-selected={s.id === tab} onClick={() => setTab(s.id)}>
                <span className="cfg-tab-label">{s.label}</span>
                {n > 0 && <Badge status="danger">{n}</Badge>}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="cfg-content">
        {active.id === 'general' && (
          <>
            {before}
            <ChildrenEditor node={schema} path={[]} value={tree} onChange={(v) => onChange(v ?? {})} ctx={ctx} only="leaves" />
          </>
        )}
        {active.node && active.node.kind === 'tag' && (
          <TagList node={active.node} path={[active.node.name]} value={childTree(active.node.name)} onChange={(v) => setChild(active.node!.name, v)} ctx={ctx} />
        )}
        {active.node && active.node.kind === 'node' && (
          <GroupPanel node={active.node} path={[active.node.name]} value={childTree(active.node.name)} onChange={(v) => setChild(active.node!.name, v)} ctx={ctx} />
        )}
        {hidden > 0 && (
          <p className="cfg-hidden">
            Basic view: {hidden} advanced option{hidden === 1 ? '' : 's'} hidden.{' '}
            <button type="button" className="cfg-link" onClick={() => setDetail('advanced')}>
              Show advanced
            </button>
          </p>
        )}
        {nChanges > 0 && path.length > 0 && (
          <details className="cfg-commands">
            <summary>Show the {nChanges === 1 ? 'command' : 'commands'} this will run</summary>
            <pre className="mono">{renderCommands(path, changes)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
