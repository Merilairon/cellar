import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // e2e only: a second `next dev` (headless-on server) needs its own build dir or the dev lock refuses it.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Native modules are added in T2; listed now so they are never bundled.
  serverExternalPackages: ['better-sqlite3', 'argon2', 'sharp'],
  experimental: {
    // Next 16.4.5 experimental (verified there): proxy.ts buffers request bodies and silently
    // truncates above 10 MB (10 MiB, no error). Photo uploads are up to 10 MiB raw, so allow 11 MiB.
    proxyClientMaxBodySize: '11mb',
    // Behind a reverse proxy the server-action Origin check must accept the public host.
    ...(process.env.BASE_URL
      ? { serverActions: { allowedOrigins: [new URL(process.env.BASE_URL).host] } }
      : {}),
  },
};

export default withNextIntl(nextConfig);
