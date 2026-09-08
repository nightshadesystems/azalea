'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ConfigApplied, Interface, ScopeConfig, ScopeConfigChange } from '@/lib/types';
import { VYOS_ROOTS } from '@/lib/vyos-interfaces.generated';
import { getIn, isTree, type CfgTree, type SchemaNode } from '@/lib/vyos-schema';
import { NAT_SPECS, type NatScope, type RuleTab } from '@/lib/nat-tables';
import { nounOf } from '@/lib/config-tables';
import { Alert } from '@/components/ds/misc';
import { Button } from '@/components/ds/Button';
import { Checkbox } from '@/components/ds/forms';
import { Datagrid } from '@/components/ds/Datagrid';
import { Tabs } from '@/components/ds/Tabs';
import { DeleteRulesModal, RuleEditModal, type RuleTarget } from '@/components/RuleEditModal';

/** The schema node each scope edits. */
function scopeSchema(scope: NatScope): SchemaNode | undefined {
  const nat = VYOS_ROOTS['nat'];
  if (scope === 'nat44') return nat;
  if (scope === 'cgnat') return nat?.children?.find((c) => c.name === 'cgnat');
  return VYOS_ROOTS[scope];
}

/** Walk a schema node down a path of child names. */
function schemaAt(node: SchemaNode | undefined, path: string[]): SchemaNode | undefined {
  let n = node;
  for (const name of path) n = n?.children?.find((c) => c.name === name);
  return n;
}

interface Row {
  key: string;
  entry: CfgTree;
}

export interface NatPageProps {
  scope: NatScope;
}

export function NatPage({ scope }: NatPageProps) {
  const spec = NAT_SPECS[scope];
  const [loaded, setLoaded] = useState<ScopeConfig | null>(null);
  const [interfaces, setInterfaces] = useState<Interface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);
  const [tabId, setTabId] = useState(spec.tabs[0]!.id);
  const [editing, setEditing] = useState<RuleTarget | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const clearSelection = useRef<() => void>(() => {});
  const admin = !!useSession()?.admin;

  const load = useCallback(() => {
    api<ScopeConfig>(`/api/config/nat/${scope}`)
      .then((c) => {
        setLoaded(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    api<Interface[]>('/api/interfaces').then(setInterfaces).catch(() => {});
  }, [scope]);
  useEffect(load, [load]);

  const tab: RuleTab = spec.tabs.find((t) => t.id === tabId) ?? spec.tabs[0]!;
  const config: CfgTree = loaded && isTree(loaded.config) ? loaded.config : {};
  const entriesOf = (t: RuleTab): CfgTree => {
    const n = getIn(config, t.path);
    return isTree(n) ? n : {};
  };
  const entries = entriesOf(tab);
  const rows: Row[] = useMemo(() => {
    const compare = tab.numeric ? (a: string, b: string) => Number(a) - Number(b) : compareNames;
    return Object.keys(entries)
      .sort(compare)
      .map((key) => ({ key, entry: isTree(entries[key]) ? (entries[key] as CfgTree) : {} }));
  }, [entries, tab.numeric]);
  const tagSchema = schemaAt(scopeSchema(scope), tab.path);
  const ctx = useMemo(() => ({ interfaces: interfaces.map((i) => i.name).sort(compareNames) }), [interfaces]);

  const saved = (what: string, output: string) => {
    setEditing(null);
    setDeleting([]);
    clearSelection.current();
    setNotice({ text: `${what} committed and saved.`, detail: output.trim() || undefined });
    load();
  };

  // CGNAT's one top-level switch lives beside the tables.
  const logAllocation = getIn(config, ['log-allocation']) !== undefined;
  const toggleLogAllocation = async (on: boolean) => {
    setBusy(true);
    try {
      const body: ScopeConfigChange = { scope, set: on ? [['log-allocation']] : [], delete: on ? [] : [['log-allocation']] };
      const applied = await api<ConfigApplied>('/api/config/nat', { method: 'POST', body: JSON.stringify(body) });
      saved(`Log allocation ${on ? 'on' : 'off'}`, applied.output);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const noun = nounOf(tab.keyLabel);
  return (
    <Shell>
      <div className="page-header">
        <h2>{spec.title}</h2>
      </div>
      <p className="dim" style={{ margin: '-8px 0 12px', fontSize: 13 }}>
        {spec.intro}
      </p>
      {error && (
        <Alert status="danger" closable onClose={() => setError(null)} style={{ marginBottom: 16 }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{error}</pre>
        </Alert>
      )}
      {notice && (
        <Alert status="success" closable onClose={() => setNotice(null)} style={{ marginBottom: 16 }}>
          {notice.text}
          {notice.detail && <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>{notice.detail}</pre>}
        </Alert>
      )}
      <Tabs
        className="nat-tabs"
        tabs={spec.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          badge: <span className="cfg-group-count">{Object.keys(entriesOf(t)).length}</span>,
        }))}
        active={tab.id}
        onChange={(id) => {
          setTabId(id);
          clearSelection.current();
        }}
      />
      {!loaded && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {loaded && (
        <Datagrid<Row>
          key={tab.id}
          selectable
          rowKey={(r) => r.key}
          onRefresh={load}
          actionBar={({ selected, clear }) => {
            clearSelection.current = clear;
            const keys = [...selected].map(String);
            const one = keys.length === 1 ? keys[0]! : null;
            const needAdmin = !admin ? 'Needs an admin login' : null;
            return (
              <>
                {scope === 'cgnat' && (
                  <Checkbox
                    label="Log allocation"
                    checked={logAllocation}
                    disabled={!admin || busy}
                    onChange={(e) => toggleLogAllocation(e.target.checked)}
                    className="nat-toggle"
                  />
                )}
                <Button sm icon="plus" disabled={!admin} title={needAdmin ?? `Add a ${noun}`} onClick={() => setEditing({ create: true })}>
                  Add {noun}
                </Button>
                <Button sm icon="pencil" disabled={!one || !admin} title={needAdmin ?? (one ? `Edit ${noun} ${one}` : `Select one ${noun} to edit`)} onClick={() => one && setEditing({ key: one })}>
                  Edit
                </Button>
                <Button
                  sm
                  variant="danger-outline"
                  icon="trash"
                  disabled={keys.length === 0 || !admin}
                  title={needAdmin ?? (keys.length ? `Delete ${keys.join(', ')}` : `Select ${noun}s to delete`)}
                  onClick={() => setDeleting(keys)}
                >
                  Delete
                </Button>
              </>
            );
          }}
          columns={[
            { key: 'key', label: tab.keyLabel, render: (r) => <span className="cell-mono">{r.key}</span> },
            ...tab.columns.map((c) => ({ key: c.key, label: c.label, render: (r: Row) => c.render(r.entry) })),
          ]}
          rows={rows}
          pageSize={50}
          placeholder={`No ${tab.label.toLowerCase()} ${noun}s yet.`}
        />
      )}
      {loaded && tagSchema && (
        <>
          <RuleEditModal
            target={editing}
            endpoint="/api/config/nat"
            scope={scope}
            scopePath={loaded.path}
            tab={tab}
            schema={tagSchema}
            entries={entries}
            ctx={ctx}
            onClose={() => setEditing(null)}
            onSaved={(key, output) => saved(`${tab.keyLabel} ${key}`, output)}
          />
          <DeleteRulesModal endpoint="/api/config/nat" scope={scope} tab={tab} keys={deleting} onClose={() => setDeleting([])} onDeleted={(keys, output) => saved(`Deleted ${keys.join(', ')}`, output)} />
        </>
      )}
    </Shell>
  );
}
