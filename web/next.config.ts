import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV === 'development';

// Static export: azalea-webd serves web/out and /api/* from one origin.
// `next dev` has no webd behind it, so proxy /api/* to a locally running
// azalea-webd (rewrites are dev-only; not part of the exported output).
const nextConfig: NextConfig = {
  ...(dev
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination:
                (process.env.AZALEA_WEBD_URL || 'http://127.0.0.1:8080') + '/api/:path*',
            },
          ];
        },
      }
    : { output: 'export' }),
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
