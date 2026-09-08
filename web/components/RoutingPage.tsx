'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useDetail } from '@/lib/detail';
import type { ConfigApplied, Interface, ScopeConfig, ScopeConfigChange } from '@/lib/types';
import { VYOS_PROTOCOLS } from '@/lib/vyos-protocols.generated';
import { diffTree, getIn, humanize, isTree, validateTree, type CfgTree, type SchemaNode } from '@/lib/vyos-schema';
import { basicSchema, countLeaves } from '@/lib/basic-options';
import { ROUTING_SPECS, type RoutingSlug } from '@/lib/routing-tables';
import { nounOf, type RuleTab } from '@/lib/config-tables';
import { Alert, Label } from '@/components/ds/misc';
import { Button } from '@/components/ds/Button';
import { Datagrid } from '@/components/ds/Datagrid';
import { Modal } from '@/components/ds/Modal';
import { Tabs } from '@/components/ds/Tabs';
import { SchemaEditor } from '@/components/SchemaEditor';
import { DeleteRulesModal, RuleEditModal, type RuleTarget } from '@/components/RuleEditModal';

const ENDPOINT = '/api/config/routing';
const SETTINGS = 'settings';

/** Walk a schema node down a path of child names. */
function schemaAt(node: SchemaNode | undefined, path: string[]): SchemaNode | undefined {
  let n = node;
  for (const name of path) n = n?.children?.find((c) => c.name === name);
  return n;
}

/**
 * The schema without the subtrees at `paths` (the tables edit those
 * themselves); a group left with nothing inside goes too.
 */
function without(node: SchemaNode, paths: string[][]): SchemaNode {
  if (!node.children) return node;
  const children = node.children.flatMap((c) => {
    if (paths.some((p) => p.length === 1 && p[0] === c.name)) return [];
    const deeper = paths.filter((p) => p.length > 1 && p[0] === c.name).map((p) => p.slice(1));
    if (!deeper.length) return [c];
    const trimmed = without(c, deeper);
    return c.kind !== 'leaf' && !trimmed.children?.length ? [] : [trimmed];
  });
  return { ...node, children };
}

interface Row {
  key: string;
  entry: CfgTree;
}

export interface RoutingPageProps {
  slug: RoutingSlug;
}

export function RoutingPage({ slug }: RoutingPageProps) {
  const spec = ROUTING_SPECS[slug];
  const protocol = useMemo(() => VYOS_PROTOCOLS.children?.find((c) => c.name === spec.scope), [spec.scope]);
  const settingsSchema = useMemo(
    () => (protocol ? without(protocol, [...spec.tables.map((t) => t.path), ...(spec.omit ?? []).map((n) => [n])]) : undefined),
    [protocol, spec],
  );
  const hasSettings = !spec.part && !!settingsSchema?.children?.length;
  const tabIds = useMemo(() => {
    const tables = spec.tables.map((t) => t.id);
    if (!hasSettings) return tables;
    return spec.tablesFirst ? [...tables, SETTINGS] : [SETTINGS, ...tables];
  }, [spec, hasSettings]);

  const [loaded, setLoaded] = useState<ScopeConfig | null>(null);
  const [interfaces, setInterfaces] = useState<Interface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);
  const [tabId, setTabId] = useState(tabIds[0] ?? SETTINGS);
  const [editing, setEditing] = useState<RuleTarget | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  // The Settings editor works on a copy of the whole subtree; the diff
  // only walks the settings schema, so the tables' entries ride along
  // untouched.
  const [tree, setTree] = useState<CfgTree>({});
  const [original, setOriginal] = useState<CfgTree>({});
  const clearSelection = useRef<() => void>(() => {});
  const admin = !!useSession()?.admin;
  const detail = useDetail();

  const load = useCallback(() => {
    api<ScopeConfig>(`${ENDPOINT}/${spec.scope}`)
      .then((c) => {
        setLoaded(c);
        const cfg = isTree(c.config) ? c.config : {};
        setTree(cfg);
        setOriginal(cfg);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    api<Interface[]>('/api/interfaces').then(setInterfaces).catch(() => {});
  }, [spec.scope]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!tabIds.includes(tabId)) setTabId(tabIds[0] ?? SETTINGS);
  }, [tabIds, tabId]);

  const config: CfgTree = loaded && isTree(loaded.config) ? loaded.config : {};
  const configured = Object.keys(config).length > 0;
  const tab: RuleTab | undefined = spec.tables.find((t) => t.id === tabId);
  const entriesOf = (t: RuleTab): CfgTree => {
    const n = getIn(config, t.path);
    return isTree(n) ? n : {};
  };
  const entries = tab ? entriesOf(tab) : {};
  const rows: Row[] = useMemo(() => {
    const compare = tab?.numeric ? (a: string, b: string) => Number(a) - Number(b) : compareNames;
    return Object.keys(entries)
      .sort(compare)
      .map((key) => ({ key, entry: isTree(entries[key]) ? (entries[key] as CfgTree) : {} }));
  }, [entries, tab?.numeric]);
  const tagSchema = tab ? schemaAt(protocol, tab.path) : undefined;
  const ctx = useMemo(() => ({ interfaces: interfaces.map((i) => i.name).sort(compareNames) }), [interfaces]);

  // Settings: trim to the detail level, validate, diff.
  const trimmed = useMemo(() => (settingsSchema ? (detail === 'basic' ? basicSchema(settingsSchema, spec.basic) : settingsSchema) : undefined), [settingsSchema, spec.basic, detail]);
  const hidden = settingsSchema && trimmed ? countLeaves(settingsSchema) - countLeaves(trimmed) : 0;
  const complaints = useMemo(() => (trimmed ? validateTree(trimmed, tree) : []), [trimmed, tree]);
  const changes = useMemo(() => (trimmed ? diffTree(trimmed, original, tree) : { set: [], delete: [] }), [trimmed, original, tree]);
  const nChanges = changes.set.length + changes.delete.length;

  const saved = (what: string, output: string) => {
    setEditing(null);
    setDeleting([]);
    setRemoving(false);
    clearSelection.current();
    setNotice({ text: `${what} committed and saved.`, detail: output.trim() || undefined });
    load();
  };
  const post = async (body: ScopeConfigChange, what: string) => {
    setBusy(true);
    try {
      const applied = await api<ConfigApplied>(ENDPOINT, { method: 'POST', body: JSON.stringify(body) });
      saved(what, applied.output);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveSettings = () => {
    if (nChanges === 0 || complaints.length) return;
    void post({ scope: spec.scope, set: changes.set, delete: changes.delete }, `${spec.title} settings`);
  };
  const removeProtocol = () => void post({ scope: spec.scope, set: [], delete: [[]] }, `${spec.title} removed:`);

  const needAdmin = !admin ? 'Needs an admin login' : null;
  const noun = tab ? nounOf(tab.keyLabel) : '';
  return (
    <Shell>
      <div className="page-header">
        <h2>{spec.title}</h2>
        {loaded && (configured ? <Label status="success">Configured</Label> : <Label>Not configured</Label>)}
        {loaded && configured && !spec.part && (
          <Button sm variant="danger-outline" icon="trash" disabled={!admin || busy} title={needAdmin ?? `Delete protocols ${spec.scope} and everything under it`} onClick={() => setRemoving(true)}>
            Remove {spec.title}
          </Button>
        )}
      </div>
      <p className="dim" style={{ margin: '-8px 0 12px', fontSize: 13 }}>
        {spec.intro}
      </p>
      {spec.note && (
        <Alert status="warning" style={{ marginBottom: 12 }}>
          {spec.note}
        </Alert>
      )}
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
      {tabIds.length > 1 && (
        <Tabs
          className="nat-tabs"
          tabs={tabIds.map((id) => {
            if (id === SETTINGS) {
              return { id, label: 'Settings', badge: nChanges > 0 ? <span className="cfg-group-count cfg-group-count-warn">{nChanges}</span> : undefined };
            }
            const t = spec.tables.find((x) => x.id === id)!;
            return { id, label: t.label, badge: <span className="cfg-group-count">{Object.keys(entriesOf(t)).length}</span> };
          })}
          active={tabId}
          onChange={(id) => {
            setTabId(id);
            clearSelection.current();
          }}
        />
      )}
      {!loaded && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {loaded && tabId === SETTINGS && trimmed && (
        <div className="routing-settings">
          <SchemaEditor schema={trimmed} hidden={hidden} tree={tree} onChange={setTree} path={loaded.path} changes={changes} complaints={complaints} ctx={ctx} />
          <div className="routing-save-bar">
            <span className="dim" style={{ marginRight: 'auto', fontSize: 12 }}>
              {nChanges === 0 ? 'No changes' : `${nChanges} change${nChanges === 1 ? '' : 's'} · commit and save`}
              {complaints.length > 0 && <span className="cfg-error"> · {complaints.length} to fix</span>}
            </span>
            <Button onClick={() => setTree(original)} disabled={nChanges === 0 || busy}>
              Discard
            </Button>
            <Button variant="primary" onClick={saveSettings} loading={busy} disabled={!admin || busy || nChanges === 0 || complaints.length > 0} title={needAdmin ?? undefined}>
              Save
            </Button>
          </div>
        </div>
      )}
      {loaded && tab && (
        <Datagrid<Row>
          key={tab.id}
          selectable
          rowKey={(r) => r.key}
          onRefresh={load}
          actionBar={({ selected, clear }) => {
            clearSelection.current = clear;
            const keys = [...selected].map(String);
            const one = keys.length === 1 ? keys[0]! : null;
            return (
              <>
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
          placeholder={`No ${tab.label.toLowerCase()} yet.`}
        />
      )}
      {loaded && tab && tagSchema && (
        <>
          <RuleEditModal
            target={editing}
            endpoint={ENDPOINT}
            scope={spec.scope}
            scopePath={loaded.path}
            tab={tab}
            schema={tagSchema}
            entries={entries}
            ctx={ctx}
            onClose={() => setEditing(null)}
            onSaved={(key, output) => saved(`${tab.keyLabel} ${key}`, output)}
          />
          <DeleteRulesModal endpoint={ENDPOINT} scope={spec.scope} tab={tab} keys={deleting} onClose={() => setDeleting([])} onDeleted={(keys, output) => saved(`Deleted ${keys.join(', ')}`, output)} />
        </>
      )}
      <Modal
        open={removing}
        title={`Remove ${spec.title}`}
        onClose={busy ? undefined : () => setRemoving(false)}
        footer={
          <>
            <Button onClick={() => setRemoving(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={removeProtocol} loading={busy} disabled={busy}>
              Remove
            </Button>
          </>
        }
      >
        <p style={{ margin: '0 0 8px' }}>
          This deletes <span className="mono">protocols {spec.scope}</span> with everything under it ({humanize(spec.scope)} stops running), then commits and saves.
        </p>
      </Modal>
    </Shell>
  );
}
