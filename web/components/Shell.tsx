'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Identity, Session } from '@/lib/types';
import { Header, HeaderAction, Subnav, type NavItem } from '@/components/ds/Header';
import { VerticalNav, type VerticalNavGroup } from '@/components/ds/VerticalNav';
import { Wordmark } from '@/components/Brand';

interface Tab extends NavItem {
  href: string;
  root?: string;
}

// Top tab bar. Add a tab here and a SIDE_NAV entry for its left nav.
const TABS: Tab[] = [
  { label: 'Dashboard', href: '/dashboard/' },
  { label: 'Interfaces', href: '/interfaces/all/', root: '/interfaces' },
];

// Left-hand navigation per tab.
const SIDE_NAV: Record<string, VerticalNavGroup> = {
  '/interfaces': {
    label: 'Interfaces',
    items: [
      { id: '/interfaces/all/', label: 'All Interfaces', icon: 'view-list' },
      { id: '/interfaces/ethernet/', label: 'Ethernet', icon: 'network-settings' },
      { id: '/interfaces/vlan/', label: 'VLAN', icon: 'network-globe' },
      { id: '/interfaces/bridge/', label: 'Bridge', icon: 'network-switch' },
      { id: '/interfaces/bonding/', label: 'Bonding', icon: 'link' },
      { id: '/interfaces/tunnels/', label: 'Tunnels / WireGuard', icon: 'shield' },
      { id: '/interfaces/loopback/', label: 'Loopback', icon: 'host' },
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
              <span className="hd-label">Signed in</span>
              <span className="hd-value mono">
                {session.username}
                {session.role ? ` · ${session.role}` : ''}
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
