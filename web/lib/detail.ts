'use client';
import { useSyncExternalStore } from 'react';

// Basic hides the options nobody touches day to day; Advanced shows
// everything VyOS has. Chosen in the header, remembered per browser.
export type Detail = 'basic' | 'advanced';

const KEY = 'azalea-detail';
let current: Detail | null = null;
const listeners = new Set<() => void>();

function read(): Detail {
  if (current) return current;
  try {
    current = localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'basic';
  } catch {
    current = 'basic';
  }
  return current;
}

export function setDetail(level: Detail): void {
  current = level;
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDetail(): Detail {
  // The server render has no storage; settle on basic there too.
  return useSyncExternalStore(subscribe, read, () => 'basic');
}
