import type { Metadata } from 'next';
import Script from 'next/script';

import '@fontsource/archivo/300.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@/styles/index.css';

export const metadata: Metadata = {
  title: 'Azalea',
  description: 'Azalea web UI for VyOS',
  icons: { icon: '/brand/icon.svg' },
};

// Applied before paint so a stored light-theme choice never flashes dark.
const themeInit = `try{var t=localStorage.getItem('azalea-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* Clarity Icons, pinned locally — the UI must work air-gapped. */}
        <link rel="stylesheet" href="/vendor/clr-icons/clr-icons.min.css" />
        <Script src="/vendor/clr-icons/clr-icons.min.js" strategy="beforeInteractive" />
      </head>
      <body>{children}</body>
    </html>
  );
}
