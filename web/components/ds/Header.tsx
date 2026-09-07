'use client';
import React from 'react';

export interface NavItem {
  label: string;
  href?: string;
  active?: boolean;
}

export interface HeaderProps {
  logo?: string;
  /** Brand text; a node lets the caller render a wordmark. */
  title?: React.ReactNode;
  nav?: NavItem[];
  onNavigate?: (item: NavItem) => void;
  search?: boolean | string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  brand?: boolean;
  className?: string;
}

export function Header({
  logo,
  title = 'Nightshade',
  nav = [],
  onNavigate,
  search,
  actions,
  children,
  brand,
  className = '',
}: HeaderProps) {
  return (
    <header className={'header ' + className}>
      <div className="branding">
        {logo && <img src={logo} alt="" />}
        {title && <span className="title">{title}</span>}
        {!title && brand !== false && <span className="title">Nightshade</span>}
      </div>
      {(nav.length > 0 || children) && <span className="header-divider"></span>}
      {children}
      {nav.length > 0 && (
        <nav className="header-nav">
          {nav.map((n, i) => (
            <a
              key={i}
              href={n.href || '#'}
              className={'nav-link' + (n.active ? ' active' : '')}
              onClick={(e) => {
                if (onNavigate) {
                  e.preventDefault();
                  onNavigate(n);
                }
              }}
            >
              {n.label}
            </a>
          ))}
        </nav>
      )}
      <div className="header-actions">
        {search && (
          <div className="search">
            <clr-icon shape="search" size="14"></clr-icon>
            <input placeholder={typeof search === 'string' ? search : 'Search…'} />
          </div>
        )}
        {actions}
      </div>
    </header>
  );
}

export function HeaderDivider() {
  return <span className="header-divider"></span>;
}

export interface HeaderDropdownProps {
  label?: string;
  value: string;
  items?: string[];
  onSelect?: (item: string) => void;
}

export function HeaderDropdown({ label, value, items = [], onSelect }: HeaderDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [val, setVal] = React.useState(value);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="header-dropdown" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hd-text">
          {label && <span className="hd-label">{label}</span>}
          <span className="hd-value">{val}</span>
        </span>
        <clr-icon shape="angle" dir="down" size="12"></clr-icon>
      </button>
      {open && (
        <div className="dropdown-menu">
          {items.map((it, i) => (
            <button
              key={i}
              className="dropdown-item"
              onClick={() => {
                setVal(it);
                setOpen(false);
                if (onSelect) onSelect(it);
              }}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface HeaderActionProps {
  icon: string;
  badge?: React.ReactNode;
  label: string;
  onClick?: () => void;
  title?: string;
}

export function HeaderAction({ icon, badge, label, onClick, title }: HeaderActionProps) {
  return (
    <button
      className="nav-icon"
      aria-label={label}
      title={title || label}
      onClick={onClick}
      style={{ position: 'relative' }}
    >
      <clr-icon shape={icon} size="20"></clr-icon>
      {badge != null && (
        <span className="badge badge-danger" style={{ position: 'absolute', top: 4, right: 2 }}>
          {badge}
        </span>
      )}
    </button>
  );
}

export interface SubnavProps<T extends NavItem = NavItem> {
  items?: T[];
  onNavigate?: (item: T) => void;
  className?: string;
}

export function Subnav<T extends NavItem = NavItem>({
  items = [],
  onNavigate,
  className = '',
}: SubnavProps<T>) {
  return (
    <nav className={'subnav ' + className}>
      {items.map((n, i) => (
        <a
          key={i}
          href={n.href || '#'}
          className={'nav-link' + (n.active ? ' active' : '')}
          onClick={(e) => {
            if (onNavigate) {
              e.preventDefault();
              onNavigate(n);
            }
          }}
        >
          {n.label}
        </a>
      ))}
    </nav>
  );
}
