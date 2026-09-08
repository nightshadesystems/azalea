'use client';
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Identity, Session, SystemInfo } from '@/lib/types';
import { Header, HeaderAction, Subnav, type NavItem } from '@/components/ds/Header';
import { VerticalNav, type VerticalNavGroup, type VerticalNavItem } from '@/components/ds/VerticalNav';
import { Wordmark } from '@/components/Brand';
import { setDetail, useDetail } from '@/lib/detail';
import { available, setTrain, trainOf, TRAIN_LABEL, useTrain } from '@/lib/train';

interface Tab extends NavItem {
  href: string;
  root?: string;
}

// Top tab bar. Add a tab here and a SIDE_NAV entry for its left nav.
const TABS: Tab[] = [
  { label: 'Dashboard', href: '/dashboard/' },
  { label: 'Routing', href: '/routing/static/', root: '/routing' },
  { label: 'Interfaces', href: '/interfaces/bonding/', root: '/interfaces' },
  { label: 'NAT', href: '/nat/nat44/', root: '/nat' },
];

/** A left-nav entry; `node` is the config node it edits (alternatives separated by `|`), so releases without it don't list it. */
type SideItem = VerticalNavItem & { node?: string };

// Left-hand navigation per tab.
const SIDE_NAV: Record<string, { label: string; items: SideItem[] }> = {
  '/routing': {
    label: 'Routing',
    items: [
      { id: '/routing/static/', label: 'Static', icon: 'map', node: 'protocols static' },
      { id: '/routing/arp/', label: 'ARP', icon: 'tag', node: 'protocols static arp' },
      { id: '/routing/multicast/', label: 'Multicast', icon: 'share', node: 'protocols static multicast|protocols static mroute' },
      { id: '/routing/bgp/', label: 'BGP', icon: 'world', node: 'protocols bgp' },
      { id: '/routing/ospf/', label: 'OSPF', icon: 'nodes', node: 'protocols ospf' },
      { id: '/routing/ospfv3/', label: 'OSPFv3', icon: 'network-globe', node: 'protocols ospfv3' },
      { id: '/routing/isis/', label: 'IS-IS', icon: 'cluster', node: 'protocols isis' },
      { id: '/routing/openfabric/', label: 'OpenFabric', icon: 'layers', node: 'protocols openfabric' },
      { id: '/routing/rip/', label: 'RIP', icon: 'compass', node: 'protocols rip' },
      { id: '/routing/ripng/', label: 'RIPng', icon: 'crosshairs', node: 'protocols ripng' },
      { id: '/routing/babel/', label: 'Babel', icon: 'organization', node: 'protocols babel' },
      { id: '/routing/eigrp/', label: 'EIGRP', icon: 'tree-view', node: 'protocols eigrp' },
      { id: '/routing/bfd/', label: 'BFD', icon: 'bolt', node: 'protocols bfd' },
      { id: '/routing/mpls/', label: 'MPLS', icon: 'tags', node: 'protocols mpls' },
      { id: '/routing/segment-routing/', label: 'Segment Routing', icon: 'flag', node: 'protocols segment-routing' },
      { id: '/routing/traffic-engineering/', label: 'Traffic Engineering', icon: 'balance', node: 'protocols traffic-engineering' },
      { id: '/routing/pim/', label: 'PIM', icon: 'router', node: 'protocols pim' },
      { id: '/routing/pim6/', label: 'PIM6', icon: 'cloud-network', node: 'protocols pim6' },
      { id: '/routing/igmp-proxy/', label: 'IGMP Proxy', icon: 'two-way-arrows', node: 'protocols igmp-proxy' },
      { id: '/routing/rpki/', label: 'RPKI', icon: 'shield-check', node: 'protocols rpki' },
      { id: '/routing/failover/', label: 'Failover', icon: 'repeat', node: 'protocols failover' },
      { id: '/routing/nhrp/', label: 'NHRP', icon: 'target', node: 'protocols nhrp' },
    ],
  },
  '/nat': {
    label: 'NAT',
    items: [
      { id: '/nat/nat44/', label: 'NAT44', icon: 'two-way-arrows', node: 'nat' },
      { id: '/nat/nat64/', label: 'NAT64', icon: 'switch', node: 'nat64' },
      { id: '/nat/nat66/', label: 'NAT66', icon: 'network-globe', node: 'nat66' },
      { id: '/nat/cgnat/', label: 'CGNAT', icon: 'users', node: 'nat cgnat' },
    ],
  },
  '/interfaces': {
    label: 'Interfaces',
    items: [
      { id: '/interfaces/bonding/', label: 'Bond', icon: 'link', node: 'interfaces bonding' },
      { id: '/interfaces/bridge/', label: 'Bridge', icon: 'network-switch', node: 'interfaces bridge' },
      { id: '/interfaces/dummy/', label: 'Dummy', icon: 'circle', node: 'interfaces dummy' },
      { id: '/interfaces/ethernet/', label: 'Ethernet', icon: 'network-settings', node: 'interfaces ethernet' },
      { id: '/interfaces/geneve/', label: 'Geneve', icon: 'cloud-network', node: 'interfaces geneve' },
      { id: '/interfaces/l2tpv3/', label: 'L2TPv3', icon: 'connect', node: 'interfaces l2tpv3' },
      { id: '/interfaces/loopback/', label: 'Loopback', icon: 'host', node: 'interfaces loopback' },
      { id: '/interfaces/macsec/', label: 'MACsec', icon: 'lock', node: 'interfaces macsec' },
      { id: '/interfaces/openvpn/', label: 'OpenVPN', icon: 'shield', node: 'interfaces openvpn' },
      { id: '/interfaces/wireguard/', label: 'WireGuard', icon: 'shield-check', node: 'interfaces wireguard' },
      { id: '/interfaces/pppoe/', label: 'PPPoE', icon: 'phone-handset', node: 'interfaces pppoe' },
      { id: '/interfaces/macvlan/', label: 'MACVLAN', icon: 'clone', node: 'interfaces pseudo-ethernet' },
      { id: '/interfaces/sstp-client/', label: 'SSTP Client', icon: 'certificate', node: 'interfaces sstpc' },
      { id: '/interfaces/tunnel/', label: 'Tunnel', icon: 'switch', node: 'interfaces tunnel' },
      { id: '/interfaces/virtual-ethernet/', label: 'Virtual Ethernet', icon: 'two-way-arrows', node: 'interfaces virtual-ethernet' },
      { id: '/interfaces/vti/', label: 'VTI', icon: 'vm', node: 'interfaces vti' },
      { id: '/interfaces/vxlan/', label: 'VXLAN', icon: 'cloud', node: 'interfaces vxlan' },
      { id: '/interfaces/wireless/', label: 'Wireless LAN', icon: 'wifi', node: 'interfaces wireless' },
      { id: '/interfaces/wwan/', label: 'WWAN', icon: 'mobile', node: 'interfaces wwan' },
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
  const [system, setSystem] = useState<SystemInfo | null>(null);
  // Which VyOS release we are talking to decides what the UI offers;
  // nothing renders until that is known (or has failed).
  const [trainReady, setTrainReady] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const detail = useDetail();
  const train = useTrain();

  useEffect(() => {
    api<Session>('/api/session').then(setSession).catch(() => {});
    api<Identity>('/api/identity').then((s) => setHostname(s.hostname)).catch(() => {});
    api<SystemInfo>('/api/system')
      .then((s) => {
        setSystem(s);
        setTrain(trainOf(s));
      })
      .catch(() => {})
      .finally(() => setTrainReady(true));
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
  const group = sideKey ? SIDE_NAV[sideKey] : undefined;
  const side: VerticalNavGroup | undefined = group && {
    label: group.label,
    items: group.items.filter((it) => !it.node || it.node.split('|').some((n) => available(n.split(' '), train))),
  };

  if (!session || !trainReady) {
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
          <button style={{ cursor: 'default' }} tabIndex={-1} title={system ? `${TRAIN_LABEL[train]}; options this release lacks are hidden` : 'Release unknown; showing everything'}>
            <span className="hd-text">
              <span className="hd-label">VyOS</span>
              <span className="hd-value mono">{system ? system.version : '—'}</span>
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
