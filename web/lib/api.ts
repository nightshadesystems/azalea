'use client';

// Thin fetch wrapper for the azalea-webd JSON API. Every request is
// same-origin (webd serves both the UI and /api/*); a 401 anywhere
// outside the login page bounces to /login.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ErrorBody {
  error?: string;
  errors?: string[];
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/api/login')) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign('/login/');
    }
    throw new ApiError(401, 'not signed in');
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as ErrorBody;
      if (body && body.error) message = body.error;
      else if (body && Array.isArray(body.errors)) message = body.errors.join('; ');
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return null as T;
  const type = res.headers.get('content-type') || '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const formatUptime = (secs: number | null | undefined): string => {
  if (secs == null) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
};

// 1234567 → "1.2 MB"; bytes, decimal units as `show interfaces` prints.
export const formatBytes = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

// "forwarding" → "Forwarding"
export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Natural interface-name order: alphabetic prefix, then numeric suffix,
// then VIF (eth2 before eth10, eth1 before eth1.100).
export const compareNames = (a: string, b: string): number => {
  const parse = (n: string): [string, number, number] => {
    const m = /^(\D*)(\d*)(?:\.(\d+))?$/.exec(n);
    if (!m) return [n, -1, -1];
    return [m[1] ?? n, m[2] ? parseInt(m[2], 10) : -1, m[3] ? parseInt(m[3], 10) : -1];
  };
  const [ap, an, av] = parse(a);
  const [bp, bn, bv] = parse(b);
  if (ap !== bp) return ap < bp ? -1 : 1;
  if (an !== bn) return an - bn;
  return av - bv;
};
