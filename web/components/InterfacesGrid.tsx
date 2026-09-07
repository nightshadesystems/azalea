'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames } from '@/lib/api';
import { useCounterStream } from '@/lib/stream';
import { useSession } from '@/lib/session';
import type { Interface, InterfaceKind } from '@/lib/types';
import { Alert, Label } from '@/components/ds/misc';
import { Button } from '@/components/ds/Button';
import { Datagrid } from '@/components/ds/Datagrid';
import { AdminLabel, KindLabel, KIND_LABEL, OperLabel } from '@/components/status';
import { DeleteInterfacesModal, InterfaceEditModal, type EditTarget } from '@/components/InterfaceEditModal';

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
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; detail?: string } | null>(null);
  // The datagrid owns its selection; keep its reset handy for after a delete.
  const clearSelection = useRef<() => void>(() => {});
  // One kind per page; everything but physical ports and `lo` can be made and unmade.
  const kind = kinds.length === 1 ? kinds[0] : null;
  const creatable = kind != null && kind !== 'ethernet' && kind !== 'loopback';
  const kindLabel = kind ? KIND_LABEL[kind] : 'interface';
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

  const deleted = (names: string[], failed: string | null) => {
    if (!failed) setDeleting([]);
    clearSelection.current();
    setNotice({ text: `Deleted ${names.join(', ')}.` });
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
          actionBar={({ selected, clear }) => {
            clearSelection.current = clear;
            const names = [...selected].map(String);
            const one = names.length === 1 ? names[0] : null;
            const needAdmin = !admin ? 'Needs an admin login' : null;
            return (
              <>
                {creatable && (
                  <Button sm icon="plus" disabled={!admin} title={needAdmin ?? `Add a ${kindLabel}`} onClick={() => setEditing({ create: kind! })}>
                    Add {kindLabel}
                  </Button>
                )}
                <Button
                  sm
                  icon="pencil"
                  disabled={!one || !admin}
                  title={needAdmin ?? (one ? `Edit ${one}` : 'Select one interface to edit')}
                  onClick={() => one && setEditing({ name: one })}
                >
                  Edit
                </Button>
                {creatable && (
                  <Button
                    sm
                    variant="danger-outline"
                    icon="trash"
                    disabled={names.length === 0 || !admin}
                    title={needAdmin ?? (names.length ? `Delete ${names.join(', ')}` : `Select ${kindLabel} interfaces to delete`)}
                    onClick={() => setDeleting(names)}
                  >
                    Delete
                  </Button>
                )}
              </>
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
          placeholder={creatable ? `No ${kindLabel} interfaces yet.` : 'No interfaces of this type.'}
        />
      )}
      <InterfaceEditModal target={editing} interfaces={interfaces || []} onClose={() => setEditing(null)} onSaved={saved} />
      <DeleteInterfacesModal names={deleting} onClose={() => setDeleting([])} onDeleted={deleted} />
    </Shell>
  );
}
