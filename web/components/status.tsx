'use client';
import React from 'react';
import { Label } from '@/components/ds/misc';
import type { InterfaceKind } from '@/lib/types';

const MONO: React.CSSProperties = { fontFamily: 'var(--ns-font-mono)', letterSpacing: '0.06em' };

export function OperLabel({ up }: { up: boolean }) {
  return (
    <Label status={up ? 'success' : 'danger'} style={MONO}>
      {up ? 'UP' : 'DOWN'}
    </Label>
  );
}

export function AdminLabel({ up }: { up: boolean }) {
  return up ? (
    <Label status="success" style={MONO}>
      ENABLED
    </Label>
  ) : (
    <Label style={MONO}>DISABLED</Label>
  );
}

const KIND_LABEL: Record<InterfaceKind, string> = {
  ethernet: 'Ethernet',
  vlan: 'VLAN',
  bridge: 'Bridge',
  bonding: 'Bond',
  tunnel: 'Tunnel',
  wireguard: 'WireGuard',
  loopback: 'Loopback',
  dummy: 'Dummy',
  other: 'Other',
};

export function KindLabel({ kind }: { kind: InterfaceKind }) {
  return <Label>{KIND_LABEL[kind]}</Label>;
}
