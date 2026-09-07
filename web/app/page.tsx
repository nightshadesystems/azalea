'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Session } from '@/lib/types';

// Entry point: land on the dashboard when signed in, /login otherwise
// (the api helper redirects on 401).
export default function Index() {
  const router = useRouter();
  useEffect(() => {
    api<Session>('/api/session')
      .then(() => router.replace('/dashboard/'))
      .catch(() => {});
  }, [router]);
  return (
    <div className="page-loading">
      <span className="spinner spinner-md"></span>Loading…
    </div>
  );
}
