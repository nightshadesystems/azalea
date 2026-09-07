'use client';
import { useEffect, useRef, useState } from 'react';
import type { CounterSample, StreamFrame } from '@/lib/types';

/** What the UI keeps per interface from the live stream. */
export interface LiveCounters {
  sample: CounterSample;
  /** Bytes per second since the previous frame; null until two frames arrive. */
  rxBps: number | null;
  txBps: number | null;
}

export type LiveMap = Map<string, LiveCounters>;

// Reconnect backoff bounds.
const MIN_DELAY = 1000;
const MAX_DELAY = 15000;

/**
 * Subscribe to /api/stream. Frames carry absolute counters; rates are
 * derived here from consecutive frames. Reconnects with backoff, and
 * reports whether the socket is currently up so a page can fall back to
 * polling (`next dev` cannot proxy WebSockets).
 */
export function useCounterStream(enabled = true): { live: LiveMap; connected: boolean } {
  const [live, setLive] = useState<LiveMap>(() => new Map());
  const [connected, setConnected] = useState(false);
  const last = useRef<{ t: number; samples: Map<string, CounterSample> } | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = MIN_DELAY;
    let closed = false;

    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}/api/stream`);
      socket.onopen = () => {
        delay = MIN_DELAY;
        setConnected(true);
      };
      socket.onmessage = (ev: MessageEvent<string>) => {
        let frame: StreamFrame;
        try {
          frame = JSON.parse(ev.data) as StreamFrame;
        } catch {
          return;
        }
        const prev = last.current;
        const now = new Map(frame.samples.map((s) => [s.name, s]));
        const dt = prev ? (frame.t - prev.t) / 1000 : 0;
        const next: LiveMap = new Map();
        for (const s of frame.samples) {
          const p = prev?.samples.get(s.name);
          const rate = (a: number, b: number) => (p && dt > 0 && a >= b ? (a - b) / dt : null);
          next.set(s.name, {
            sample: s,
            rxBps: p ? rate(s.counters.rx_bytes, p.counters.rx_bytes) : null,
            txBps: p ? rate(s.counters.tx_bytes, p.counters.tx_bytes) : null,
          });
        }
        last.current = { t: frame.t, samples: now };
        setLive(next);
      };
      socket.onclose = () => {
        setConnected(false);
        last.current = null;
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(MAX_DELAY, delay * 2);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [enabled]);

  return { live, connected };
}

// 12_500_000 bytes/s → "100 Mb/s" (bits, decimal units, as links are rated).
export const formatBitRate = (bytesPerSec: number | null | undefined): string => {
  if (bytesPerSec == null) return '—';
  const units = ['b/s', 'kb/s', 'Mb/s', 'Gb/s', 'Tb/s'];
  let v = bytesPerSec * 8;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};
