'use client';
import { InterfacesGrid } from '@/components/InterfacesGrid';

export default function Page() {
  return <InterfacesGrid title="Tunnels / WireGuard" kinds={['tunnel', 'wireguard']} />;
}
