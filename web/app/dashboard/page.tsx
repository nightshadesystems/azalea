'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { api, formatBytes, formatUptime } from '@/lib/api';
import type { SystemInfo, SystemStatus } from '@/lib/types';
import { Alert, Card, CardBlock } from '@/components/ds/misc';

const REFRESH_MS = 5000;

const pct = (used: number, total: number): string =>
  total > 0 ? `${Math.round((used / total) * 100)}%` : '—';

function Stat({ value, unit, label, sub }: { value: React.ReactNode; unit?: string; label: string; sub?: React.ReactNode }) {
  return (
    <Card className="stat-card">
      <div className="stat-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  );
}

export default function DashboardPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<SystemStatus>('/api/system/status')
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    api<SystemInfo>('/api/system').then(setInfo).catch((e: Error) => setError(e.message));
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const ifaces = status?.interfaces;
  const disk = status?.disks[0];

  return (
    <Shell>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>
      {error && (
        <Alert status="danger" style={{ marginBottom: 16 }}>
          {error}
        </Alert>
      )}
      {!status && !error && (
        <div className="page-loading">
          <span className="spinner spinner-md"></span>Loading…
        </div>
      )}
      {status && (
        <>
          <div className="stat-grid">
            <Stat value={formatUptime(status.uptime_secs)} label="Uptime" sub={info ? `Booted via ${info.boot_via}` : undefined} />
            <Stat
              value={status.load.one.toFixed(2)}
              label="Load average"
              sub={
                <span className="mono">
                  {status.load.five.toFixed(2)} · {status.load.fifteen.toFixed(2)} (5 / 15 min)
                </span>
              }
            />
            <Stat
              value={pct(status.memory.used, status.memory.total)}
              label="Memory used"
              sub={`${formatBytes(status.memory.used)} of ${formatBytes(status.memory.total)}`}
            />
            <Stat
              value={disk ? pct(disk.used, disk.total) : '—'}
              label="Disk used"
              sub={disk ? `${formatBytes(disk.used)} of ${formatBytes(disk.total)} on ${disk.filesystem}` : 'No persistent filesystem reported'}
            />
            <Stat
              value={ifaces ? ifaces.up : '—'}
              unit={ifaces ? `/ ${ifaces.total}` : undefined}
              label="Interfaces up"
              sub={ifaces ? `${ifaces.down} down · ${ifaces.admin_down} disabled` : undefined}
            />
          </div>
          <div className="card-grid">
            <Card header="System">
              <CardBlock>
                <div className="kv">
                  <div className="k">Hostname</div>
                  <div className="v mono">{info?.hostname || '—'}</div>
                  <div className="k">VyOS version</div>
                  <div className="v mono">{info?.version || '—'}</div>
                  <div className="k">Release train</div>
                  <div className="v">{info?.release_train || '—'}</div>
                  <div className="k">Built on</div>
                  <div className="v">{info?.built_on || '—'}</div>
                  <div className="k">Architecture</div>
                  <div className="v mono">{info?.architecture || '—'}</div>
                  <div className="k">System type</div>
                  <div className="v">{info?.system_type || '—'}</div>
                  <div className="k">Hardware</div>
                  <div className="v">{info ? [info.hardware_vendor, info.hardware_model].filter(Boolean).join(' · ') || '—' : '—'}</div>
                  <div className="k">Azalea</div>
                  <div className="v mono">{info?.azalea_version || '—'}</div>
                </div>
              </CardBlock>
            </Card>
            <Card header="Memory">
              <CardBlock>
                <div className="kv">
                  <div className="k">Total</div>
                  <div className="v mono">{formatBytes(status.memory.total)}</div>
                  <div className="k">Used</div>
                  <div className="v mono">{formatBytes(status.memory.used)}</div>
                  <div className="k">Available</div>
                  <div className="v mono">{formatBytes(status.memory.free)}</div>
                  <div className="k">Buffers</div>
                  <div className="v mono">{formatBytes(status.memory.buffers)}</div>
                  <div className="k">Cached</div>
                  <div className="v mono">{formatBytes(status.memory.cached)}</div>
                </div>
              </CardBlock>
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}
