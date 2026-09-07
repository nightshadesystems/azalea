'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Session } from './types';

// One /api/session fetch per page load, shared by whoever asks.
let cached: Promise<Session | null> | null = null;

export function fetchSession(): Promise<Session | null> {
  if (!cached) cached = api<Session>('/api/session').catch(() => null);
  return cached;
}

/** The signed-in session, or null until known (and when not signed in). */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    fetchSession().then((s) => live && setSession(s));
    return () => {
      live = false;
    };
  }, []);
  return session;
}
