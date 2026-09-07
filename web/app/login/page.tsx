'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Identity, Session } from '@/lib/types';
import { Button } from '@/components/ds/Button';
import { FormField, Input, Password } from '@/components/ds/forms';
import { Alert } from '@/components/ds/misc';
import { Wordmark } from '@/components/Brand';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hostname, setHostname] = useState('');

  useEffect(() => {
    api<Identity>('/api/identity')
      .then((id) => setHostname(id.hostname))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<Session>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      router.replace('/dashboard/');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Sign-in failed — check your username and password.'
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setBusy(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-brand">
        <div className="login-brand-title">
          <img src="/brand/azalea-mark.svg" alt="Azalea" />
          <Wordmark size={32} />
        </div>
        <div className="login-brand-sub" style={{ fontSize: 16, lineHeight: '24px' }}>
          Web management for VyOS.
        </div>
      </div>
      <form className="login" onSubmit={submit}>
        <div className="login-heading">
          <img src="/brand/azalea-mark.svg" alt="" style={{ height: 28 }} />
          <Wordmark size={22} color="var(--cds-alias-typography-color-450)" />
        </div>
        <div className="subtitle">
          Sign in to <span className="mono">{hostname || 'this router'}</span> with a VyOS local user.
        </div>
        {error && (
          <Alert status="danger" className="error">
            {error}
          </Alert>
        )}
        <FormField label="Username" htmlFor="username">
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ maxWidth: 'none' }}
          />
        </FormField>
        <FormField label="Password" htmlFor="password">
          <Password
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ maxWidth: 'none' }}
          />
        </FormField>
        <Button variant="primary" block type="submit" loading={busy} disabled={busy || !username}>
          Sign In
        </Button>
        <div className="signup">Locked out? Sign in on the console and reset the account.</div>
      </form>
    </div>
  );
}
