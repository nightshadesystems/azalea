'use client';
import { InterfacesGrid } from '@/components/InterfacesGrid';

export default function Page() {
  return <InterfacesGrid title="MACVLAN" kinds={['pseudo-ethernet']} />;
}
