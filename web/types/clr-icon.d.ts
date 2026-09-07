// Clarity Icons custom element (public/vendor/clr-icons, pinned by
// scripts/copy-vendor.mjs). Attributes pass straight through.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type ClrIconProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  shape?: string;
  size?: string | number;
  dir?: 'up' | 'down' | 'left' | 'right';
  /** Custom elements take `class`, not `className`, for the is-solid modifier. */
  class?: string;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'clr-icon': ClrIconProps;
    }
  }
}
