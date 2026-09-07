'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Identity, Session } from '@/lib/types';
import { Header, HeaderAction, Subnav, type NavItem } from '@/components/ds/Header';
import { VerticalNav, type VerticalNavGroup } from '@/components/ds/VerticalNav';
import { Wordmark } from '@/components/Brand';
import { setDetail, useDetail } from '@/lib/detail';

interface Tab extends NavItem {
  href: string;
  root?: string;
}

// Top tab bar. Add a tab here and a SIDE_NAV entry for its left nav.
const TABS: Tab[] = [
  { label: 'Dashboard', href: '/dashboard/' },
  { label: 'Interfaces', href: '/interfaces/bonding/', root: '/interfaces' },
  { label: 'NAT', href: '/nat/nat44/', root: '/nat' },
];

// Left-hand navigation per tab.
const SIDE_NAV: Record<string, VerticalNavGroup> = {
  '/nat': {
    label: 'NAT',
    items: [
      { id: '/nat/nat44/', label: 'NAT44', icon: 'two-way-arrows' },
      { id: '/nat/nat64/', label: 'NAT64', icon: 'switch' },
      { id: '/nat/nat66/', label: 'NAT66', icon: 'network-globe' },
      { id: '/nat/cgnat/', label: 'CGNAT', icon: 'users' },
    ],
  },
  '/interfaces': {
    label: 'Interfaces',
    items: [
      { id: '/interfaces/bonding/', label: 'Bond', icon: 'link' },
      { id: '/interfaces/bridge/', label: 'Bridge', icon: 'network-switch' },
      { id: '/interfaces/dummy/', label: 'Dummy', icon: 'circle' },
      { id: '/interfaces/ethernet/', label: 'Ethernet', icon: 'network-settings' },
      { id: '/interfaces/geneve/', label: 'Geneve', icon: 'cloud-network' },
      { id: '/interfaces/l2tpv3/', label: 'L2TPv3', icon: 'connect' },
      { id: '/interfaces/loopback/', label: 'Loopback', icon: 'host' },
      { id: '/interfaces/macsec/', label: 'MACsec', icon: 'lock' },
      { id: '/interfaces/openvpn/', label: 'OpenVPN', icon: 'shield' },
      { id: '/interfaces/wireguard/', label: 'WireGuard', icon: 'shield-check' },
      { id: '/interfaces/pppoe/', label: 'PPPoE', icon: 'phone-handset' },
      { id: '/interfaces/macvlan/', label: 'MACVLAN', icon: 'clone' },
      { id: '/interfaces/sstp-client/', label: 'SSTP Client', icon: 'certificate' },
      { id: '/interfaces/tunnel/', label: 'Tunnel', icon: 'switch' },
      { id: '/interfaces/virtual-ethernet/', label: 'Virtual Ethernet', icon: 'two-way-arrows' },
      { id: '/interfaces/vti/', label: 'VTI', icon: 'vm' },
      { id: '/interfaces/vxlan/', label: 'VXLAN', icon: 'cloud' },
      { id: '/interfaces/wireless/', label: 'Wireless LAN', icon: 'wifi' },
      { id: '/interfaces/wwan/', label: 'WWAN', icon: 'mobile' },
      { id: '/interfaces/vlan/', label: 'VLAN', icon: 'network-globe' },
    ],
  },
};

type Theme = 'dark' | 'light';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    try {
      setTheme(localStorage.getItem('azalea-theme') === 'light' ? 'light' : 'dark');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('azalea-theme', next);
    } catch {
      /* storage unavailable */
    }
  };
  return [theme, toggle];
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [session, setSession] = useState<Session | null>(null);
  const [hostname, setHostname] = useState('');
  const [theme, toggleTheme] = useTheme();
  const detail = useDetail();

  useEffect(() => {
    api<Session>('/api/session').then(setSession).catch(() => {});
    api<Identity>('/api/identity').then((s) => setHostname(s.hostname)).catch(() => {});
  }, []);

  const logout = async () => {
    try {
      await api<null>('/api/logout', { method: 'POST' });
    } finally {
      router.replace('/login/');
    }
  };

  const activeTab = TABS.find((t) => pathname.startsWith(t.root || t.href));
  const sideKey = Object.keys(SIDE_NAV).find((k) => pathname.startsWith(k));
  const side = sideKey ? SIDE_NAV[sideKey] : undefined;

  if (!session) {
    return (
      <div className="page-loading">
        <span className="spinner spinner-md"></span>Loading…
      </div>
    );
  }

  return (
    <div className="main-container">
      <Header
        logo="/brand/azalea-mark.svg"
        title={<Wordmark />}
        actions={
          <>
            <div className="detail-toggle" role="group" aria-label="Configuration detail" title="Basic shows the everyday options; Advanced shows everything VyOS has">
              <button type="button" className={detail === 'basic' ? 'active' : ''} onClick={() => setDetail('basic')}>
                Basic
              </button>
              <button type="button" className={detail === 'advanced' ? 'active' : ''} onClick={() => setDetail('advanced')}>
                Advanced
              </button>
            </div>
            <HeaderAction icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={toggleTheme} />
            <HeaderAction
              icon="logout"
              label={`Sign out ${session.username}`}
              title={`Sign out (${session.username})`}
              onClick={logout}
            />
          </>
        }
      >
        <div className="header-dropdown">
          <button style={{ cursor: 'default' }} tabIndex={-1}>
            <span className="hd-text">
              <span className="hd-label">Router</span>
              <span className="hd-value mono">{hostname || '—'}</span>
            </span>
          </button>
        </div>
        <span className="header-divider"></span>
        <div className="header-dropdown">
          <button style={{ cursor: 'default' }} tabIndex={-1}>
            <span className="hd-text">
              <span className="hd-label">Signed In</span>
              <span className="hd-value mono">
                {session.username}
                {session.role ? ` - ${session.role}` : ''}
              </span>
            </span>
          </button>
        </div>
        <span className="header-divider"></span>
      </Header>
      <Subnav items={TABS.map((t) => ({ ...t, active: t === activeTab }))} onNavigate={(t) => router.push(t.href)} />
      <div className="content-container">
        {side && (
          <VerticalNav collapsible activeId={pathname} groups={[side]} onNavigate={(it) => router.push(it.id)} />
        )}
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}
