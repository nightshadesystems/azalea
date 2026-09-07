'use client';
import React from 'react';

export interface Tab {
  id: string;
  label: React.ReactNode;
  /** Small trailing marker, e.g. an error count. */
  badge?: React.ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div className={'clr-tabs ' + className}>
      <div className="clr-tabs-list" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="clr-tab-link"
            aria-selected={t.id === active}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.badge != null && t.badge}
          </button>
        ))}
      </div>
    </div>
  );
}
