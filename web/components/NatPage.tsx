'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useDetail } from '@/lib/detail';
import type { ConfigApplied, Interface, ScopeConfig, ScopeConfigChange } from '@/lib/types';
import { VYOS_ROOTS } from '@/lib/vyos-interfaces.generated';
import { basicSchema, countLeaves } from '@/lib/basic-options';
import { diffTree, isTree, validateTree, type CfgTree, type SchemaNode } from '@/lib/vyos-schema';
import { Alert, Label } from '@/components/ds/misc';
import { Button } from '@/components/ds/Button';
import { SchemaEditor } from '@/components/SchemaEditor';

export type NatScope = 'nat44' | 'nat64' | 'nat66' | 'cgnat';

/** The schema node each page edits, and what counts as Basic there. */
const SCOPES: Record<NatScope, { schema: () => SchemaNode | undefined; basic: string[]; intro: string }> = {
  nat44: {
    // `nat` minus `cgnat`, which has its own page.
    schema: () => {
      const nat = VYOS_ROOTS['nat'];
      return nat && { ...nat, children: (nat.children ?? []).filter((c) => c.name !== 'cgnat') };
    },
    basic: [
      'source.rule.description',
      'source.rule.disable',
      'source.rule.outbound-interface.name',
      'source.rule.source.address',
      'source.rule.source.port',
      'source.rule.destination.address',
      'source.rule.destination.port',
      'source.rule.protocol',
      'source.rule.translation.address',
      'source.rule.translation.port',
      'source.rule.exclude',
      'destination.rule.description',
      'destination.rule.disable',
      'destination.rule.inbound-interface.name',
      'destination.rule.source.address',
      'destination.rule.source.port',
      'destination.rule.destination.address',
      'destination.rule.destination.port',
      'destination.rule.protocol',
      'destination.rule.translation.address',
      'destination.rule.translation.port',
      'destination.rule.exclude',
      'static.rule.*',
    ],
    intro: 'IPv4 source (masquerade, SNAT), destination (port forwarding, DNAT) and static one-to-one rules.',
  },
  nat64: {
    schema: () => VYOS_ROOTS['nat64'],
    basic: ['*'],
    intro: 'Translate IPv6-only clients to IPv4: a source prefix (usually 64:ff9b::/96) and the IPv4 pool to map it onto.',
  },
  nat66: {
    schema: () => VYOS_ROOTS['nat66'],
    basic: [
      'source.rule.description',
      'source.rule.disable',
      'source.rule.outbound-interface.name',
      'source.rule.source.prefix',
      'source.rule.destination.prefix',
      'source.rule.translation.address',
      'source.rule.exclude',
      'destination.rule.description',
      'destination.rule.disable',
      'destination.rule.inbound-interface.name',
      'destination.rule.source.address',
      'destination.rule.destination.address',
      'destination.rule.translation.address',
      'destination.rule.exclude',
    ],
    intro: 'IPv6 prefix translation (NPTv6): source and destination rules rewriting prefixes between networks.',
  },
  cgnat: {
    schema: () => VYOS_ROOTS['nat']?.children?.find((c) => c.name === 'cgnat'),
    basic: ['*'],
    intro: 'Carrier-grade NAT: internal pools of subscriber addresses mapped onto external pools with per-user port allocations.',
  },
};

export interface NatPageProps {
  scope: NatScope;
  title: string;
}

export function NatPage({ scope, title }: NatPageProps) {
  const [loaded, setLoaded] = useState<ScopeConfig | null>(null);
  const [tree, setTree] = useState<CfgTree>({});
  const [interfaces, setInterfaces] = useState<Interface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);
  const admin = !!useSession()?.admin;
  const detail = useDetail();
  const spec = SCOPES[scope];

  const load = useCallback(() => {
    setError(null);
    api<ScopeConfig>(`/api/config/nat/${scope}`)
      .then((c) => {
        setLoaded(c);
        setTree(isTree(c.config) ? c.config : {});
      })
      .catch((e: Error) => setError(e.message));
    api<Interface[]>('/api/interfaces').then(setInterfaces).catch(() => {});
  }, [scope]);
  useEffect(load, [load]);

  const fullSchema = useMemo(() => spec.schema(), [spec]);
  const schema = useMemo(() => (fullSchema && detail === 'basic' ? basicSchema(fullSchema, spec.basic) : fullSchema), [fullSchema, detail, spec]);
  const hidden = fullSchema && schema ? countLeaves(fullSchema) - countLeaves(schema) : 0;
  const complaints = useMemo(() => (schema ? validateTree(schema, tree) : []), [schema, tree]);
  const changes = useMemo(() => (schema && loaded ? diffTree(schema, loaded.config, tree) : { set: [], delete: [] }), [schema, loaded, tree]);
  const nChanges = changes.set.length + changes.delete.length;
  const ctx = useMemo(() => ({ interfaces: interfaces.map((i) => i.name).sort(compareNames) }), [interfaces]);

  const save = async () => {
    if (!loaded || nChanges === 0 || complaints.length > 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const body: ScopeConfigChange = { scope, set: changes.set, delete: changes.delete };
      const applied = await api<ConfigApplied>('/api/config/nat', { method: 'POST', body: JSON.stringify(body) });
      setNotice({ text: `${title} committed and saved.`, detail: applied.output.trim() || undefined });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <div className="page-header">
        <h2>{title}</h2>
        {nChanges > 0 && <Label status="warning">{nChanges} unsaved</Label>}
        <Button onClick={() => loaded && setTree(isTree(loaded.config) ? loaded.config : {})} disabled={nChanges === 0 || saving}>
          Discard
        </Button>
        <Button
          variant="primary"
          onClick={save}
          loading={saving}
          disabled={!admin || !loaded || nChanges === 0 || complaints.length > 0 || saving}
          title={!admin ? 'Saving needs an admin login' : complaints.length ? `${complaints.length} value${complaints.length === 1 ? '' : 's'} to fix` : 'Commit and save'}
        >
          Save
        </Button>
      </div>
      <p className="dim" style={{ margin: '-8px 0 16px', fontSize: 13 }}>
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
      {!loaded && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {loaded && schema && (
        <div className="card cfg-page">
          <SchemaEditor schema={schema} hidden={hidden} tree={tree} onChange={setTree} path={loaded.path} changes={changes} complaints={complaints} ctx={ctx} />
        </div>
      )}
    </Shell>
  );
}
