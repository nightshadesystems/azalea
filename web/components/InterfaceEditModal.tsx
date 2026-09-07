'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api, compareNames } from '@/lib/api';
import type { ConfigApplied, Interface, InterfaceConfig, InterfaceConfigChange, InterfaceKind } from '@/lib/types';
import { VYOS_INTERFACES } from '@/lib/vyos-interfaces.generated';
import {
  diffTree,
  humanize,
  isTree,
  placeholderFor,
  renderCommands,
  validateTree,
  validateValue,
  type CfgTree,
  type Changes,
  type SchemaNode,
} from '@/lib/vyos-schema';
import { Modal } from '@/components/ds/Modal';
import { Button } from '@/components/ds/Button';
import { FormField, Input, Select } from '@/components/ds/forms';
import { Alert, Badge } from '@/components/ds/misc';
import { KindLabel, KIND_LABEL } from '@/components/status';
import { setDetail, useDetail } from '@/lib/detail';
import { basicSchema, countLeaves } from '@/lib/basic-options';
import { ChildrenEditor, GroupPanel, TagList, type EditorContext } from '@/components/ConfigTreeEditor';

/** Edit an existing interface, or create one of a kind. */
export type EditTarget = { name: string } | { create: InterfaceKind };

export interface InterfaceEditModalProps {
  /** What to open; null keeps the modal closed. */
  target: EditTarget | null;
  /** Every interface, for VLAN parents, completion and duplicate checks. */
  interfaces: Interface[];
  onClose: () => void;
  /** Called after a successful commit with what VyOS printed. */
  onSaved: (name: string, output: string) => void;
}

/** Kinds a `vif` can hang off, in the order offered. */
const VLAN_PARENTS: InterfaceKind[] = ['ethernet', 'bonding', 'bridge', 'pseudo-ethernet', 'virtual-ethernet', 'wireless'];

/** The schema node a config path lands on: the type's node, or its `vif`/`vif-c` child. */
function schemaAt(path: string[]): SchemaNode | undefined {
  const type = path[1];
  let node: SchemaNode | undefined = type ? VYOS_INTERFACES[type] : undefined;
  // path: interfaces <type> <name> [vif <id> | vif-s <id> vif-c <id>]
  for (let i = 3; i < path.length && node; i += 2) {
    const word = path[i];
    node = node.children?.find((c) => c.name === word);
  }
  return node;
}

export function InterfaceEditModal({ target, interfaces, onClose, onSaved }: InterfaceEditModalProps) {
  const creating = target != null && 'create' in target;
  const createKind: InterfaceKind | null = creating ? target.create : null;
  const [config, setConfig] = useState<InterfaceConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tree, setTree] = useState<CfgTree>({});
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Create mode: the new name, or for a VLAN its parent and tag.
  const [newName, setNewName] = useState('');
  const [parent, setParent] = useState('');
  const [vlanId, setVlanId] = useState('');
  const detail = useDetail();

  const parents = useMemo(
    () => interfaces.filter((i) => VLAN_PARENTS.includes(i.kind)).sort((a, b) => compareNames(a.name, b.name)),
    [interfaces],
  );

  useEffect(() => {
    setConfig(null);
    setLoadError(null);
    setSaveError(null);
    setTab('general');
    setTree({});
    if (!target) return;
    if ('create' in target) {
      setNewName('');
      setParent(parents[0]?.name ?? '');
      setVlanId('');
      setConfig({ name: '', kind: target.create, path: [], config: {} });
      return;
    }
    let cancelled = false;
    api<InterfaceConfig>(`/api/config/interfaces/${encodeURIComponent(target.name)}`)
      .then((c) => {
        if (cancelled) return;
        if (!schemaAt(c.path)) {
          setLoadError(`${c.name}: no schema for ${c.path.join(' ')}.`);
          return;
        }
        setTree(isTree(c.config) ? c.config : {});
        setConfig(c);
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
    // `parents` only matters for the initial pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Where the edited node lives, and the schema describing it.
  const parentRow = parents.find((p) => p.name === parent);
  const name = creating ? (createKind === 'vlan' ? (parent && vlanId ? `${parent}.${vlanId}` : '') : newName.trim()) : config?.name ?? '';
  const path = useMemo<string[]>(() => {
    if (!creating) return config?.path ?? [];
    if (createKind === 'vlan') return parentRow && vlanId ? ['interfaces', parentRow.kind, parentRow.name, 'vif', vlanId] : [];
    return name ? ['interfaces', createKind!, name] : [];
  }, [creating, createKind, config, parentRow, vlanId, name]);
  // The schema does not wait for a name: a new VLAN edits its parent
  // type's `vif` node, any other new interface its type's node.
  const fullSchema = useMemo(() => {
    if (!creating) return path.length ? schemaAt(path) : undefined;
    if (createKind === 'vlan') return parentRow ? schemaAt(['interfaces', parentRow.kind, parentRow.name, 'vif', '0']) : undefined;
    return VYOS_INTERFACES[createKind!];
  }, [creating, createKind, path, parentRow]);
  const kind: InterfaceKind = createKind ?? config?.kind ?? 'other';
  // Basic trims the schema; the diff and validation walk the trimmed
  // tree, so hidden options are neither shown nor touched.
  const schema = useMemo(() => (fullSchema && detail === 'basic' ? basicSchema(fullSchema, kind) : fullSchema), [fullSchema, detail, kind]);
  const hidden = fullSchema && schema ? countLeaves(fullSchema) - countLeaves(schema) : 0;
  const typeNode = createKind && createKind !== 'vlan' ? VYOS_INTERFACES[createKind] : undefined;

  const createError = useMemo(() => {
    if (!creating) return null;
    if (createKind === 'vlan') {
      if (!parent) return 'No interface to attach a VLAN to.';
      if (!/^\d+$/.test(vlanId) || Number(vlanId) < 0 || Number(vlanId) > 4094 || String(Number(vlanId)) !== vlanId) return 'VLAN ID must be 0–4094.';
    } else {
      if (!name) return `Enter a name (${typeNode ? placeholderFor(typeNode) : 'name'}).`;
      const m = typeNode ? validateValue(typeNode, name) : null;
      if (m) return m;
    }
    if (interfaces.some((i) => i.name === name)) return `${name} already exists; edit it instead.`;
    return null;
  }, [creating, createKind, parent, vlanId, name, typeNode, interfaces]);

  const complaints = useMemo(() => (schema ? validateTree(schema, tree) : []), [schema, tree]);
  const changes = useMemo<Changes>(() => {
    if (!config || !schema) return { set: [], delete: [] };
    const d = diffTree(schema, config.config, tree);
    // Creating: the bare node first, so an all-defaults interface still exists.
    return creating ? { set: [[], ...d.set], delete: d.delete } : d;
  }, [schema, config, tree, creating]);
  const nChanges = changes.set.length + changes.delete.length;
  const hasErrors = complaints.length > 0 || createError != null;

  const sections = useMemo(() => {
    const groups = (schema?.children ?? []).filter((c) => c.kind !== 'leaf' && (c.children?.length ?? 0) > 0);
    return [{ id: 'general', label: 'General', node: null as SchemaNode | null }, ...groups.map((g) => ({ id: g.name, label: humanize(g.name), node: g as SchemaNode | null }))];
  }, [schema]);
  const complaintsIn = (id: string) =>
    complaints.filter((c) => (id === 'general' ? !sections.some((s) => s.id !== 'general' && s.id === c.path[0]) : c.path[0] === id)).length + (id === 'general' && createError ? 1 : 0);

  const ctx: EditorContext = useMemo(() => ({ interfaces: interfaces.map((i) => i.name).sort(compareNames) }), [interfaces]);

  const save = async () => {
    if (!config || nChanges === 0 || hasErrors) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: InterfaceConfigChange = { interface: name, set: changes.set, delete: changes.delete };
      const applied = await api<ConfigApplied>('/api/config/interfaces', { method: 'POST', body: JSON.stringify(body) });
      onSaved(name, applied.output);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = createKind ? KIND_LABEL[createKind] : config ? KIND_LABEL[config.kind] : '';
  const createFields = creating ? (
    <div className="cfg-grid">
      {createKind === 'vlan' ? (
        <>
          <FormField label="Parent interface" htmlFor="cfg-parent" required helper="Interface carrying the tagged frames.">
            <Select id="cfg-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
              {parents.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.description ? ` — ${p.description}` : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="VLAN ID" htmlFor="cfg-vlan-id" required error={vlanId && createError ? createError : undefined} helper="802.1Q tag, 0–4094.">
            <Input id="cfg-vlan-id" className="mono" inputMode="numeric" placeholder="100" value={vlanId} onChange={(e) => setVlanId(e.target.value.trim())} autoFocus />
          </FormField>
        </>
      ) : (
        <FormField label="Name" htmlFor="cfg-name" required error={newName && createError ? createError : undefined} helper={typeNode?.help} className="cfg-full">
          <Input id="cfg-name" className="mono" placeholder={typeNode ? placeholderFor(typeNode) : ''} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </FormField>
      )}
    </div>
  ) : null;

  const active = sections.find((s) => s.id === tab) ?? sections[0]!;

  return (
    <Modal
      open={target != null}
      size="xl"
      onClose={saving ? undefined : onClose}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {creating ? `New ${kindLabel}` : 'Edit'}
          {name && <span className="cfg-title-name">{name}</span>}
          {config && !creating && <KindLabel kind={config.kind} />}
        </span>
      }
      footer={
        <>
          <span className="dim" style={{ marginRight: 'auto', fontSize: 12, alignSelf: 'center' }}>
            {config && (nChanges === 0 ? 'No changes' : `${nChanges} change${nChanges === 1 ? '' : 's'} · commit and save`)}
            {complaints.length > 0 && (
              <span className="cfg-error"> · {complaints.length} to fix</span>
            )}
          </span>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!config || saving || nChanges === 0 || hasErrors}>
            {creating ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      {loadError && <Alert status="danger">{loadError}</Alert>}
      {!config && !loadError && (
        <div className="page-loading" style={{ padding: 32 }}>
          <span className="spinner spinner-md"></span>Loading configuration…
        </div>
      )}
      {config && (
        <>
          {saveError && (
            <Alert status="danger">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{saveError}</pre>
            </Alert>
          )}
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
                  {createFields}
                  {schema && <ChildrenEditor node={schema} path={[]} value={tree} onChange={(v) => setTree(v ?? {})} ctx={ctx} only="leaves" />}
                  {!schema && createKind === 'vlan' && <Alert status="warning">No ethernet, bond, bridge, MACVLAN, virtual-ethernet or wireless interface to attach a VLAN to.</Alert>}
                </>
              )}
              {active.node && active.node.kind === 'tag' && (
                <TagList
                  node={active.node}
                  path={[active.node.name]}
                  value={isTree(tree[active.node.name]) ? (tree[active.node.name] as CfgTree) : undefined}
                  onChange={(v) => {
                    const next = { ...tree };
                    if (v === undefined) delete next[active.node!.name];
                    else next[active.node!.name] = v;
                    setTree(next);
                  }}
                  ctx={ctx}
                />
              )}
              {active.node && active.node.kind === 'node' && (
                <GroupPanel
                  node={active.node}
                  path={[active.node.name]}
                  value={isTree(tree[active.node.name]) ? (tree[active.node.name] as CfgTree) : undefined}
                  onChange={(v) => {
                    const next = { ...tree };
                    if (v === undefined) delete next[active.node!.name];
                    else next[active.node!.name] = v;
                    setTree(next);
                  }}
                  ctx={ctx}
                />
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
        </>
      )}
    </Modal>
  );
}

export interface DeleteInterfacesModalProps {
  /** Names to remove; empty keeps the modal closed. */
  names: string[];
  onClose: () => void;
  onDeleted: (names: string[], failed: string | null) => void;
}

/** Confirm and remove interfaces, one commit each. */
export function DeleteInterfacesModal({ names, onClose, onDeleted }: DeleteInterfacesModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [names]);
  const run = async () => {
    setBusy(true);
    setError(null);
    const done: string[] = [];
    try {
      for (const name of names) {
        await api<ConfigApplied>('/api/config/interfaces', {
          method: 'POST',
          body: JSON.stringify({ interface: name, set: [], delete: [[]] } satisfies InterfaceConfigChange),
        });
        done.push(name);
      }
      onDeleted(done, null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (done.length) onDeleted(done, message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={names.length > 0}
      title={`Delete ${names.length === 1 ? names[0] : `${names.length} interfaces`}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} loading={busy} disabled={busy}>
            Delete
          </Button>
        </>
      }
    >
      {error && (
        <Alert status="danger">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{error}</pre>
        </Alert>
      )}
      <p style={{ margin: '0 0 8px' }}>
        This removes the interface and everything configured under it, then commits and saves. Anything referring to it (firewall, DHCP
        server, routes, VLANs on it) will fail to commit.
      </p>
      <ul className="mono" style={{ margin: 0, paddingLeft: 20 }}>
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Modal>
  );
}
