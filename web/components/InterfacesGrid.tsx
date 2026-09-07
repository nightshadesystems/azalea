'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames } from '@/lib/api';
import { useCounterStream } from '@/lib/stream';
import { useSession } from '@/lib/session';
import type { Interface, InterfaceKind } from '@/lib/types';
import { Alert, Label } from '@/components/ds/misc';
import { Button } from '@/components/ds/Button';
import { Datagrid } from '@/components/ds/Datagrid';
import { AdminLabel, KindLabel, OperLabel } from '@/components/status';
import { InterfaceEditModal } from '@/components/InterfaceEditModal';

// Without the stream (next dev cannot proxy WebSockets) refetch instead.
const POLL_MS = 5000;

const dash = <span className="dim">—</span>;

export interface InterfacesGridProps {
  title: string;
  /** Kinds shown on this page; empty means every interface. */
  kinds: InterfaceKind[];
}

export function InterfacesGrid({ title, kinds }: InterfacesGridProps) {
  const [interfaces, setInterfaces] = useState<Interface[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);
  const { live, connected } = useCounterStream();
  const admin = !!useSession()?.admin;

  const refresh = useCallback(() => {
    api<Interface[]>('/api/interfaces')
      .then((all) => {
        setInterfaces(all);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [connected, refresh]);

  // Live link state overlays the last full fetch.
  const rows = (interfaces || [])
    .filter((i) => kinds.length === 0 || kinds.includes(i.kind))
    .map((i) => {
      const l = live.get(i.name);
      return l ? { ...i, oper_up: l.sample.oper_up } : i;
    });

  const saved = (name: string, output: string) => {
    setEditing(null);
    setNotice({ text: `${name} committed and saved.`, detail: output.trim() || undefined });
    refresh();
  };

  return (
    <Shell>
      <div className="page-header">
        <h2>{title}</h2>
        {connected ? (
          <Label status="success">Live</Label>
        ) : (
          <Label title="Counters refresh every few seconds; the live stream is not connected.">Polling</Label>
        )}
      </div>
      {error && (
        <Alert status="danger" style={{ marginBottom: 16 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert status="success" closable onClose={() => setNotice(null)} style={{ marginBottom: 16 }}>
          {notice.text}
          {notice.detail && <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>{notice.detail}</pre>}
        </Alert>
      )}
      {!interfaces && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {interfaces && (
        <Datagrid<Interface>
          selectable
          rowKey={(r) => r.name}
          onRefresh={refresh}
          actionBar={({ selected }) => {
            const one = selected.size === 1 ? String([...selected][0]) : null;
            return (
              <Button
                sm
                icon="pencil"
                disabled={!one || !admin}
                title={!admin ? 'Editing needs an admin login' : one ? `Edit ${one}` : 'Select one interface to edit'}
                onClick={() => one && setEditing(one)}
              >
                Edit
              </Button>
            );
          }}
          columns={[
            {
              key: 'name',
              label: 'Interface',
              sortable: true,
              compare: (a, b) => compareNames(a.name, b.name),
              render: (r) => <span className="cell-mono">{r.name}</span>,
            },
            ...(kinds.length === 1 ? [] : [{ key: 'kind', label: 'Type', render: (r: Interface) => <KindLabel kind={r.kind} /> }]),
            { key: 'description', label: 'Description', render: (r) => r.description || dash },
            { key: 'admin_up', label: 'Admin', render: (r) => <AdminLabel up={r.admin_up} /> },
            { key: 'oper_up', label: 'Link', sortable: true, render: (r) => <OperLabel up={r.oper_up} /> },
            {
              key: 'addresses',
              label: 'Addresses',
              render: (r) => (r.addresses.length ? <span className="cell-mono">{r.addresses.join(', ')}</span> : dash),
            },
            { key: 'mtu', label: 'MTU', sortable: true, render: (r) => <span className="cell-mono">{r.mtu || '—'}</span> },
            { key: 'mac', label: 'MAC', render: (r) => (r.mac ? <span className="cell-mono">{r.mac}</span> : dash) },
          ]}
          rows={rows}
          pageSize={32}
          placeholder="No interfaces of this type."
        />
      )}
      <InterfaceEditModal name={editing} onClose={() => setEditing(null)} onSaved={saved} />
    </Shell>
  );
}
