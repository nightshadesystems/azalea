'use client';
import React from 'react';

// The Azalea wordmark as text: Archivo Bold, -0.015em (design/brand/README.md).
// Rendered in HTML rather than from the lockup SVG so it uses the
// self-hosted font on an air-gapped router.
export interface WordmarkProps {
  size?: number;
  color?: string;
}

export function Wordmark({ size = 17, color }: WordmarkProps) {
  return (
    <span
      style={{
        fontFamily: 'var(--ns-font-brand)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        fontSize: size,
        color: color || 'var(--ns-ink-11)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      Azalea
    </span>
  );
}

/** Company attribution: small Nightshade symbol + name. */
export function NightshadeCredit({ className = '' }: { className?: string }) {
  return (
    <span className={'nightshade-credit ' + className}>
      <img src="/brand/nightshade-symbol-on-dark.svg" alt="" />
      by Nightshade Systems
    </span>
  );
}
