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

export const KIND_LABEL: Record<InterfaceKind, string> = {
  'bonding': 'Bond',
  'bridge': 'Bridge',
  'dummy': 'Dummy',
  'ethernet': 'Ethernet',
  'geneve': 'Geneve',
  'l2tpv3': 'L2TPv3',
  'loopback': 'Loopback',
  'macsec': 'MACsec',
  'openvpn': 'OpenVPN',
  'wireguard': 'WireGuard',
  'pppoe': 'PPPoE',
  'pseudo-ethernet': 'MACVLAN',
  'sstpc': 'SSTP Client',
  'tunnel': 'Tunnel',
  'virtual-ethernet': 'Virtual Ethernet',
  'vti': 'VTI',
  'vxlan': 'VXLAN',
  'wireless': 'Wireless LAN',
  'wwan': 'WWAN',
  'vlan': 'VLAN',
  other: 'Other',
};

export function KindLabel({ kind }: { kind: InterfaceKind }) {
  return <Label>{KIND_LABEL[kind]}</Label>;
}
