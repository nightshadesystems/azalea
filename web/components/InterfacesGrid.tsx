'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { api, compareNames, formatBytes } from '@/lib/api';
import { formatBitRate, useCounterStream } from '@/lib/stream';
import type { Interface, InterfaceDetail, InterfaceKind } from '@/lib/types';
import { Alert, Label } from '@/components/ds/misc';
import { Datagrid } from '@/components/ds/Datagrid';
import { AdminLabel, KindLabel, OperLabel } from '@/components/status';

// Without the stream (next dev cannot proxy WebSockets) refetch instead.
const POLL_MS = 5000;

const dash = <span className="dim">—</span>;

function Detail({ row }: { row: Interface }) {
  const [detail, setDetail] = useState<InterfaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<InterfaceDetail>(`/api/interfaces/${encodeURIComponent(row.name)}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [row.name]);
  const c = row.counters;
  return (
    <div className="card-grid">
      <div className="kv">
        <div className="k">Type</div>
        <div className="v"><KindLabel kind={row.kind} /></div>
        {row.parent && (
          <>
            <div className="k">Parent</div>
            <div className="v mono">{row.parent}</div>
          </>
        )}
        {row.vlan_id != null && (
          <>
            <div className="k">VLAN ID</div>
            <div className="v mono">{row.vlan_id}</div>
          </>
        )}
        {row.members.length > 0 && (
          <>
            <div className="k">Members</div>
            <div className="v mono">{row.members.join(', ')}</div>
          </>
        )}
        <div className="k">MAC</div>
        <div className="v mono">{row.mac || '—'}</div>
        <div className="k">MTU</div>
        <div className="v mono">{row.mtu}</div>
        <div className="k">Addresses</div>
        <div className="v mono">{row.addresses.length ? row.addresses.join(', ') : '—'}</div>
        <div className="k">RX</div>
        <div className="v mono">
          {formatBytes(c.rx_bytes)} · {c.rx_packets} pkts · {c.rx_errors} err · {c.rx_dropped} drop
        </div>
        <div className="k">TX</div>
        <div className="v mono">
          {formatBytes(c.tx_bytes)} · {c.tx_packets} pkts · {c.tx_errors} err · {c.tx_dropped} drop
        </div>
      </div>
      <div className="card-wide">
        {error && <Alert status="danger" sm>{error}</Alert>}
        {!detail && !error && (
          <span className="dim">
            <span className="spinner spinner-inline"></span>Loading show interfaces…
          </span>
        )}
        {detail && <pre style={{ margin: 0 }}>{detail.raw.trimEnd()}</pre>}
      </div>
    </div>
  );
}

export interface InterfacesGridProps {
  title: string;
  /** Kinds shown on this page; empty means every interface. */
  kinds: InterfaceKind[];
}

export function InterfacesGrid({ title, kinds }: InterfacesGridProps) {
  const [interfaces, setInterfaces] = useState<Interface[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { live, connected } = useCounterStream();

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

  // Live counters and link state overlay the last full fetch.
  const rows = (interfaces || [])
    .filter((i) => kinds.length === 0 || kinds.includes(i.kind))
    .map((i) => {
      const l = live.get(i.name);
      return l ? { ...i, oper_up: l.sample.oper_up, counters: l.sample.counters } : i;
    });

  const rate = (name: string, dir: 'rx' | 'tx') => {
    const l = live.get(name);
    const bps = l ? (dir === 'rx' ? l.rxBps : l.txBps) : null;
    return bps == null ? null : formatBitRate(bps);
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
      {!interfaces && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {interfaces && (
        <Datagrid<Interface>
          expandable
          rowKey={(r) => r.name}
          onRefresh={refresh}
          renderDetail={(r) => <Detail row={r} />}
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
            {
              key: 'rx',
              label: 'RX',
              sortable: true,
              compare: (a, b) => a.counters.rx_bytes - b.counters.rx_bytes,
              render: (r) => (
                <span className="cell-mono" style={{ whiteSpace: 'nowrap' }}>
                  {formatBytes(r.counters.rx_bytes)}
                  {rate(r.name, 'rx') && <span className="dim"> · {rate(r.name, 'rx')}</span>}
                </span>
              ),
            },
            {
              key: 'tx',
              label: 'TX',
              sortable: true,
              compare: (a, b) => a.counters.tx_bytes - b.counters.tx_bytes,
              render: (r) => (
                <span className="cell-mono" style={{ whiteSpace: 'nowrap' }}>
                  {formatBytes(r.counters.tx_bytes)}
                  {rate(r.name, 'tx') && <span className="dim"> · {rate(r.name, 'tx')}</span>}
                </span>
              ),
            },
          ]}
          rows={rows}
          pageSize={32}
          placeholder="No interfaces of this type."
        />
      )}
    </Shell>
  );
}
